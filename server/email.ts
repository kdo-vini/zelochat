import axios from 'axios';
import { getServiceSupabase } from './supabase.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'ZeloChat <no-reply@zelochat.com.br>';

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  /** Plain-text fallback for clients that don't render HTML. */
  text?: string;
}

/**
 * Sends a transactional email via the Resend REST API. No-ops (with a warn log)
 * when `RESEND_API_KEY` is not set so dev/staging don't crash. Returns true on
 * success, false otherwise — caller decides whether to retry or surface.
 */
export async function sendEmail(params: EmailParams): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn(
      `[email] RESEND_API_KEY not set — would send to ${params.to}: "${params.subject}"`,
    );
    return false;
  }

  try {
    await axios.post(
      'https://api.resend.com/emails',
      {
        from: EMAIL_FROM,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.text ? { text: params.text } : {}),
      },
      {
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout: 10_000,
      },
    );
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    const body = err?.response?.data;
    console.error(
      `[email] Resend send failed (${status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`,
    );
    return false;
  }
}

/** Resolves the owner's email for an empresa from auth.users. */
async function getOwnerEmail(empresaId: string): Promise<string | null> {
  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('user_id, nome_exibicao')
      .eq('id', empresaId)
      .maybeSingle();
    if (!data?.user_id) return null;
    const { data: userData } = await getServiceSupabase()
      .auth.admin.getUserById(data.user_id);
    return userData?.user?.email ?? null;
  } catch (err) {
    console.error('[email] getOwnerEmail failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

async function getEmpresaName(empresaId: string): Promise<string> {
  try {
    const { data } = await getServiceSupabase()
      .from('empresa_perfil')
      .select('nome_exibicao')
      .eq('id', empresaId)
      .maybeSingle();
    return (data as { nome_exibicao?: string } | null)?.nome_exibicao ?? 'sua empresa';
  } catch {
    return 'sua empresa';
  }
}
