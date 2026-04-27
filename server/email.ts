import axios from 'axios';
import { getServiceSupabase } from './supabase.js';

const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || 'ZeloChat <no-reply@zelochat.com.br>';
const APP_URL = (process.env.WEBHOOK_PUBLIC_URL || 'https://zelochat.com.br').replace('/webhook', '');

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

/**
 * Sends a WhatsApp disconnect alert to the empresa owner. Called from
 * handleConnectionUpdate on state === 'close' when empresaId is known.
 * No-ops silently when owner email can't be resolved or RESEND_API_KEY is unset.
 */
export async function sendDisconnectAlert(empresaId: string): Promise<void> {
  const [email, name] = await Promise.all([
    getOwnerEmail(empresaId),
    getEmpresaName(empresaId),
  ]);
  if (!email) {
    console.warn(`[email] sendDisconnectAlert — no email found for empresa ${empresaId}`);
    return;
  }

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7">
        <tr><td style="background:#ef4444;padding:20px 28px">
          <p style="margin:0;color:#fff;font-size:18px;font-weight:700">⚠️ WhatsApp desconectado</p>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;color:#18181b;font-size:15px">Olá! O WhatsApp de <strong>${name}</strong> acabou de desconectar.</p>
          <p style="margin:0 0 24px;color:#52525b;font-size:14px">Enquanto estiver offline, <strong>sua IA não consegue responder clientes</strong> nem receber novos pedidos pelo WhatsApp.</p>
          <table cellpadding="0" cellspacing="0"><tr><td>
            <a href="${APP_URL}/settings" style="display:inline-block;background:#18181b;color:#fff;font-size:14px;font-weight:600;padding:12px 24px;border-radius:8px;text-decoration:none">Reconectar agora →</a>
          </td></tr></table>
          <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px">Se você desconectou intencionalmente, pode ignorar este email.</p>
        </td></tr>
        <tr><td style="padding:16px 28px;border-top:1px solid #f4f4f5">
          <p style="margin:0;color:#a1a1aa;font-size:12px">ZeloChat · <a href="${APP_URL}" style="color:#a1a1aa">zelochat.com.br</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`.trim();

  await sendEmail({
    to: email,
    subject: `⚠️ WhatsApp desconectado — ${name}`,
    text: `Seu WhatsApp (${name}) desconectou. Acesse ${APP_URL}/settings para reconectar.`,
    html,
  });
}

/**
 * Sends a WhatsApp reconnected confirmation. Called on state === 'open'
 * only if the empresa was previously flagged as disconnected.
 */
export async function sendReconnectConfirmation(empresaId: string): Promise<void> {
  const [email, name] = await Promise.all([
    getOwnerEmail(empresaId),
    getEmpresaName(empresaId),
  ]);
  if (!email) return;

  await sendEmail({
    to: email,
    subject: `✅ WhatsApp reconectado — ${name}`,
    html: `<p>Boa notícia! O WhatsApp de <strong>${name}</strong> voltou a ficar online. Sua IA já está recebendo e respondendo mensagens normalmente.</p>`,
    text: `Boa notícia! O WhatsApp de ${name} voltou a ficar online.`,
  });
}
