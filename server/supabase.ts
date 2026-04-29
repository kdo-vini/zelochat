import type { Request } from 'express';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let serviceClient: SupabaseClient | null = null;
let boundEmpresaId: string | null = null;

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
  const supabase = getServiceSupabase();
  const { data: authData, error: authError } = await supabase.auth.getUser(token);

  if (authError || !authData.user) {
    throw new Error('UNAUTHORIZED');
  }

  const { data: empresa, error: empresaError } = await supabase
    .from('empresa_perfil')
    .select('id')
    .eq('user_id', authData.user.id)
    .maybeSingle();

  if (empresaError) {
    throw new Error(empresaError.message);
  }

  if (!empresa?.id) {
    throw new Error('EMPRESA_NOT_FOUND');
  }

  return empresa.id;
}

export async function requireEmpresaId(req: Request): Promise<string> {
  const token = extractBearerToken(req);
  if (!token) {
    throw new Error('UNAUTHORIZED');
  }

  return resolveEmpresaIdFromToken(token);
}

/**
 * Throws SUBSCRIPTION_INACTIVE if the authenticated user does not have an
 * active ZeloChat subscription (plan_tier in 'chat'/'bundle', status 'active',
 * not past the period end / manual extension).
 *
 * No free trial — 'trialing' is intentionally rejected.
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

  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, plan_tier, current_period_end, manually_extended_until')
    .eq('user_id', authData.user.id)
    .in('plan_tier', ['chat', 'bundle'])
    .order('current_period_end', { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data || data.status !== 'active') {
    throw new Error('SUBSCRIPTION_INACTIVE');
  }

  const expiry = data.manually_extended_until ?? data.current_period_end;
  if (!expiry || new Date(expiry).getTime() <= Date.now()) {
    throw new Error('SUBSCRIPTION_INACTIVE');
  }
}

const MEDIA_BUCKET = 'zelochat-media';
const MEDIA_TTL_MS = 10 * 60 * 1000; // 10 minutes — enough for Whatsmiau to download

export async function uploadMediaForSend(
  dataUrl: string,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const supabase = getServiceSupabase();
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const buffer = Buffer.from(base64, 'base64');
  const key = `send/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

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
 * On DB error, returns true (fail-open) to avoid blocking legitimate traffic.
 */
export async function isEmpresaSubscriptionActive(empresaId: string): Promise<boolean> {
  try {
    const supabase = getServiceSupabase();
    const { data: empresa } = await supabase
      .from('empresa_perfil')
      .select('user_id')
      .eq('id', empresaId)
      .maybeSingle();
    const userId = (empresa as { user_id?: string } | null)?.user_id;
    if (!userId) return false;

    const { data } = await supabase
      .from('subscriptions')
      .select('status, plan_tier, current_period_end, manually_extended_until')
      .eq('user_id', userId)
      .in('plan_tier', ['chat', 'bundle'])
      .order('current_period_end', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (!data || data.status !== 'active') return false;
    const expiry = data.manually_extended_until ?? data.current_period_end;
    if (!expiry || new Date(expiry).getTime() <= Date.now()) return false;
    return true;
  } catch {
    return true;
  }
}

export function setBoundEmpresaId(empresaId: string): void {
  boundEmpresaId = empresaId;
}

export function getBoundEmpresaId(): string | null {
  return boundEmpresaId;
}

/**
 * Uploads received media (incoming messages) to Supabase Storage.
 * Unlike uploadMediaForSend, these files are NOT auto-deleted — users need to view them later.
 */
export async function uploadReceivedMedia(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const supabase = getServiceSupabase();
  const key = `received/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(key, buffer, { contentType: mimeType, upsert: false });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);

  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(key);
  return data.publicUrl;
}
