import type { Request } from 'express';
import { randomBytes } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;
let boundEmpresaId: string | null = null;

const EMPRESA_CACHE_TTL_MS = 5 * 60 * 1000;
const empresaIdCache = new Map<string, { empresaId: string; userId: string; cachedAt: number }>();

function getSupabaseUrl(): string {
  const value = process.env.SUPABASE_URL;
  if (!value) {
    throw new Error('SUPABASE_URL not set');
  }
  return value;
}

function getServiceRoleKey(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set');
  }
  return value;
}

export function getServiceSupabase(): SupabaseClient {
  if (!serviceClient) {
    serviceClient = createClient(getSupabaseUrl(), getServiceRoleKey(), {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return serviceClient;
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice('Bearer '.length).trim();
  return token || null;
}

export async function resolveEmpresaIdFromToken(token: string): Promise<string> {
  return (await resolveEmpresaAndUserIdFromToken(token)).empresaId;
}

export async function resolveEmpresaAndUserIdFromToken(
  token: string,
): Promise<{ empresaId: string; userId: string }> {
  const supabase = getServiceSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    throw new Error('UNAUTHORIZED');
  }

  const userId = authData.user.id;

  const cached = empresaIdCache.get(userId);
  if (cached && Date.now() - cached.cachedAt < EMPRESA_CACHE_TTL_MS) {
    return { empresaId: cached.empresaId, userId: cached.userId };
  }

  const { data: empresa, error: empresaError } = await supabase
    .from('empresa_perfil')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();

  if (empresaError) {
    throw new Error(empresaError.message);
  }

  if (!empresa?.id) {
    throw new Error('EMPRESA_NOT_FOUND');
  }

  empresaIdCache.set(userId, { empresaId: empresa.id, userId, cachedAt: Date.now() });
  return { empresaId: empresa.id, userId };
}

export async function requireEmpresaId(req: Request): Promise<string> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }

  return resolveEmpresaIdFromToken(token);
}

export async function requireEmpresaAndUserId(
  req: Request,
): Promise<{ empresaId: string; userId: string }> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }

  return resolveEmpresaAndUserIdFromToken(token);
}

/**
 * Subscription state cache. Two purposes:
 *
 * 1. Fast-path: avoid hitting Supabase on every authenticated request. Positive
 *    results are reused for FRESH_TTL_MS without re-querying.
 * 2. Fail-closed-with-cache: if Supabase is down, we only honor a recent POSITIVE
 *    cache up to STALE_TTL_MS old. We never extend a negative-cached state, and
 *    we never default to "active" without a prior positive read.
 *
 * Pre-existing behavior was to fail OPEN on DB error — a Supabase outage
 * silently re-enabled cancelled customers across the entire fleet. See P0.17
 * in CODE_REVIEW.md.
 */
type SubscriptionCacheEntry = { active: boolean; checkedAt: number };
const subscriptionCache = new Map<string, SubscriptionCacheEntry>();
const SUBSCRIPTION_CACHE_FRESH_MS = 60 * 1000;       // serve from cache w/o DB call
const SUBSCRIPTION_CACHE_STALE_FALLBACK_MS = 5 * 60 * 1000; // honor positive cache on DB error

interface SubscriptionRow {
  status: string | null;
  plan_tier: string | null;
  current_period_end: string | null;
  manually_extended_until: string | null;
}

function isRowActive(row: SubscriptionRow | null | undefined): boolean {
  if (!row || row.status !== 'active') return false;
  const expiry = row.manually_extended_until ?? row.current_period_end;
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

/**
 * Resolve subscription state for a user_id with caching + fail-closed semantics.
 * Returns true only if we can prove the user is active (fresh DB read or recent
 * positive cache + transient DB error). Otherwise false.
 */
async function resolveActiveSubscription(userId: string): Promise<boolean> {
  const cached = subscriptionCache.get(userId);
  const now = Date.now();

  // Fast path — recent positive or negative cache, skip DB.
  if (cached && now - cached.checkedAt < SUBSCRIPTION_CACHE_FRESH_MS) {
    return cached.active;
  }

  try {
    const { data, error } = await getServiceSupabase()
      .from('subscriptions')
      .select('status, plan_tier, current_period_end, manually_extended_until')
      .eq('user_id', userId)
      .in('plan_tier', ['chat', 'bundle'])
      .order('current_period_end', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const active = isRowActive(data as SubscriptionRow | null);
    subscriptionCache.set(userId, { active, checkedAt: now });
    return active;
  } catch (err) {
    // DB error. Fall back to cache only if it was POSITIVE and recent — never
    // promote an unknown state to active. Log so fail-open / fail-stale events
    // are observable.
    if (cached && cached.active && now - cached.checkedAt < SUBSCRIPTION_CACHE_STALE_FALLBACK_MS) {
      console.warn(
        `[subscription] DB error, using stale positive cache for user=${userId} (age=${now - cached.checkedAt}ms):`,
        err,
      );
      return true;
    }
    console.error(`[subscription] DB error and no usable cache for user=${userId} — failing closed:`, err);
    return false;
  }
}

/**
 * Throws SUBSCRIPTION_INACTIVE if the authenticated user does not have an
 * active ZeloChat subscription (plan_tier in 'chat'/'bundle', status 'active',
 * not past the period end / manual extension).
 *
 * No free trial — 'trialing' is intentionally rejected.
 *
 * Uses the same cache layer as isEmpresaSubscriptionActive. On DB error, only
 * a recent positive cache is honored — never fail-open to unknown.
 */
export async function requireActiveZelochatSubscription(req: Request): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }

  const supabase = getServiceSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) {
    throw new Error('UNAUTHORIZED');
  }

  const active = await resolveActiveSubscription(authData.user.id);
  if (!active) {
    throw new Error('SUBSCRIPTION_INACTIVE');
  }
}

const MEDIA_BUCKET = 'zelochat-media';
const MEDIA_TTL_MS = 10 * 60 * 1000; // 10 minutes — enough for Whatsmiau to download

/**
 * P0.5 — Builds a per-empresa scoped object key with a 128-bit random slug.
 *
 * The previous pattern `send/${Date.now()}-${fileName}` was enumerable: an
 * attacker with one URL could scan timestamps milliseconds apart to discover
 * media uploaded by other tenants (customer photos, audios, PIX receipts).
 * The new pattern `${prefix}/${empresaId}/${randomHex16}-${fileName}` requires
 * BOTH the empresaId AND the 128-bit slug to guess a valid key — combinatorially
 * infeasible.
 *
 * Bucket stays public for backwards compatibility (existing URLs in chat
 * history rows must keep working — flipping to private would 403 every old
 * image/audio for Casa dos Salgados). Defense relies on unguessable paths,
 * not on auth at the bucket level. If we ever flip the bucket private, this
 * helper still works — Storage just serves via signed URLs instead.
 */
function buildScopedMediaKey(prefix: 'send' | 'received', empresaId: string, fileName: string): string {
  const slug = randomBytes(16).toString('hex'); // 128 bits of entropy
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${prefix}/${empresaId}/${slug}-${safe}`;
}

export async function uploadMediaForSend(
  dataUrl: string,
  fileName: string,
  mimeType: string,
  empresaId: string,
): Promise<string> {
  const supabase = getServiceSupabase();
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const buffer = Buffer.from(base64, 'base64');
  const key = buildScopedMediaKey('send', empresaId, fileName);

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(key, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(key);

  // Clean up after Whatsmiau has had time to download the file
  setTimeout(() => {
    void supabase.storage.from(MEDIA_BUCKET).remove([key]);
  }, MEDIA_TTL_MS);

  return data.publicUrl;
}

/**
 * Checks if an empresa has an active ZeloChat subscription without requiring
 * a JWT token. Used by the webhook handler (no auth header available).
 *
 * Fail-closed semantics with cache fallback — see resolveActiveSubscription.
 * On DB error: only return true if the empresa had a recent positive cache.
 * Never default-allow unknown empresas. Resolving the empresa→user_id mapping
 * itself failing is treated as fail-closed too.
 */
export async function isEmpresaSubscriptionActive(empresaId: string): Promise<boolean> {
  try {
    const { data: empresa } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('user_id')
      .eq('id', empresaId)
      .maybeSingle();
    const userId = (empresa as { user_id?: string } | null)?.user_id;
    if (!userId) return false;
    return resolveActiveSubscription(userId);
  } catch (err) {
    console.error(`[subscription] empresa→user_id lookup failed for empresa=${empresaId} — failing closed:`, err);
    return false;
  }
}

/**
 * P0.2 — `boundEmpresaId` is the legacy single-tenant singleton. Its scope
 * has been NARROWED: as of this commit, NO operational helper (message
 * persistence, AI dispatch, escalation, etc.) consults it. It exists ONLY
 * for the legacy WhatsApp connection-state broadcasts in `server/whatsapp.ts`
 * which were originally written for the Donutopia single-tenant beta.
 *
 * If you find yourself wanting to read this singleton from any new code path,
 * STOP and pass `empresaId` explicitly through the call chain instead. The
 * audit (CODE_REVIEW.md P0.2) flagged the previous singleton-defaulting
 * pattern as a cross-tenant leak waiting to happen the moment a 2nd customer
 * onboards. We now rely on TypeScript's required-parameter enforcement to
 * keep that surface closed.
 *
 * The setter is still wired to:
 *   • `server/index.ts` startup auto-bind when `count===1` (single-tenant)
 *   • `POST /api/bind-empresa` (legacy frontend bind, used by waApi.ts)
 *
 * Both are harmless today — the value is consulted only by
 * `broadcastLegacyLifecycleEvent` in whatsapp.ts.
 */
export function setBoundEmpresaId(empresaId: string): void {
  boundEmpresaId = empresaId;
}

export function getBoundEmpresaId(): string | null {
  return boundEmpresaId;
}

/**
 * Uploads received media (incoming messages) to Supabase Storage.
 *
 * Unlike uploadMediaForSend, these files are NOT auto-deleted — operators
 * need to view chat history later. That makes the enumeration risk worse:
 * `received/` files persist forever, so an attacker who learns the pattern
 * can scan ALL historical uploads. P0.5 closes this with the per-empresa +
 * random-slug path — see `buildScopedMediaKey` above for the rationale.
 *
 * CAVEAT: this fix only protects NEW uploads. Files uploaded before this
 * change are still at the old `received/${timestamp}-…` paths and remain
 * enumerable. A separate retroactive cleanup migration would need to re-
 * upload + update DB references to fully close the historical surface.
 * Tracked in FIXES_PROGRESS.md.
 */
export async function uploadReceivedMedia(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  empresaId: string,
): Promise<string> {
  const supabase = getServiceSupabase();
  const key = buildScopedMediaKey('received', empresaId, fileName);

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(key, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}
