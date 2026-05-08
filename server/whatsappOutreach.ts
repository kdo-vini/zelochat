import { sendTextMessage, fetchInstanceConnectionState } from './whatsapp.js';
import { getOrCreateOwnInstanceForEmpresa } from './instanceManager.js';
import { getServiceSupabase } from './supabase.js';

/**
 * Outreach WhatsApp — server-to-server messaging from the Téchne empresa
 * (`+5514991537503`) to ZeloChat users. Used by the onboarding follow-up
 * sequence (Day 0 welcome, Day 14 check-in, Day 28 last-chance).
 *
 * The Téchne empresa is set up via migration 025 with `zelochat_mode='general'`
 * and an internal Whatsmiau instance always-connected. We resolve its empresa
 * id once per process and cache it — DB lookup at startup, then in-memory.
 *
 * `/internal/whatsapp/send-text` (router.ts) does the same thing for external
 * callers (zelopdv etc) over HTTP. This module is the in-process equivalent
 * for the cron + welcome trigger.
 */

let cachedTechneEmpresaId: string | null = null;
let cachedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveTechneEmpresaId(): Promise<string | null> {
  const now = Date.now();
  if (cachedTechneEmpresaId && now - cachedAt < CACHE_TTL_MS) {
    return cachedTechneEmpresaId;
  }

  const fromEnv = (process.env.TECHNE_EMPRESA_ID || '').trim();
  if (fromEnv) {
    cachedTechneEmpresaId = fromEnv;
    cachedAt = now;
    return fromEnv;
  }

  const { data, error } = await getServiceSupabase()
    .from('empresa_perfil')
    .select('id')
    .eq('zelochat_mode', 'general')
    .limit(2);

  if (error) {
    console.error('[whatsappOutreach] resolveTechneEmpresaId query error:', error.message);
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  if (rows.length === 0) {
    console.warn('[whatsappOutreach] no empresa with zelochat_mode=general found — cannot send outreach');
    return null;
  }
  if (rows.length > 1) {
    console.warn('[whatsappOutreach] multiple empresas with zelochat_mode=general — set TECHNE_EMPRESA_ID env to disambiguate');
    return null;
  }
  cachedTechneEmpresaId = (rows[0] as { id: string }).id;
  cachedAt = now;
  return cachedTechneEmpresaId;
}

/** Normalizes raw input into a WhatsApp JID. Mirrors normalizeInternalWhatsAppJid in router.ts. */
function toJid(raw: string): string | null {
  const value = raw.trim();
  if (/^\d+@s\.whatsapp\.net$/i.test(value)) return value.toLowerCase();
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const withCountry = digits.startsWith('55') ? digits : `55${digits}`;
  if (withCountry.length < 12 || withCountry.length > 13) return null;
  return `${withCountry}@s.whatsapp.net`;
}

export interface OutreachResult {
  ok: boolean;
  reason?: 'INVALID_PHONE' | 'TECHNE_NOT_CONFIGURED' | 'INSTANCE_DISCONNECTED' | 'SEND_FAILED';
}

/**
 * Sends an outreach text message FROM the Téchne WhatsApp number TO an end
 * user. Returns ok=false (with a reason) on any failure — caller decides
 * whether to log/retry. Never throws.
 */
export async function sendOutreachMessage(phone: string, body: string): Promise<OutreachResult> {
  const jid = toJid(phone);
  if (!jid) {
    console.warn(`[whatsappOutreach] invalid phone, skipping: ${phone}`);
    return { ok: false, reason: 'INVALID_PHONE' };
  }

  const empresaId = await resolveTechneEmpresaId();
  if (!empresaId) return { ok: false, reason: 'TECHNE_NOT_CONFIGURED' };

  let instance: string;
  try {
    instance = await getOrCreateOwnInstanceForEmpresa(empresaId);
  } catch (err) {
    console.error('[whatsappOutreach] failed to resolve Téchne instance:', err instanceof Error ? err.message : err);
    return { ok: false, reason: 'TECHNE_NOT_CONFIGURED' };
  }

  const state = await fetchInstanceConnectionState(instance).catch(() => 'unknown');
  if (state !== 'connected') {
    console.warn(`[whatsappOutreach] Téchne instance not connected (state=${state}) — skipping send to ${jid}`);
    return { ok: false, reason: 'INSTANCE_DISCONNECTED' };
  }

  try {
    await sendTextMessage(jid, body, empresaId);
    return { ok: true };
  } catch (err) {
    console.error(`[whatsappOutreach] sendTextMessage failed to ${jid}:`, err instanceof Error ? err.message : err);
    return { ok: false, reason: 'SEND_FAILED' };
  }
}
