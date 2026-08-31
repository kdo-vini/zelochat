import { getServiceSupabase, isEmpresaSubscriptionActive } from './supabase.js';
import { sendEmail } from './email.js';
import { sendOutreachMessage } from './whatsappOutreach.js';
import {
  dayZeroEmail,
  dayThreeEmail,
  daySevenEmail,
  dayTwentyOneEmail,
  dayTwentyEightEmail,
  dayZeroWhatsApp,
  dayFourteenWhatsApp,
  dayTwentyEightWhatsApp,
} from './onboardingEmailTemplates.js';

/**
 * Onboarding follow-up sequence — disparada após `zelochat_onboarding_done=true`.
 *
 * Trilha comum (todos):
 *   - Day 0 — WhatsApp + Email (boas-vindas + 3 próximos passos)
 *   - Day 3 — Email (recursos pouco descobertos)
 *
 * Trilha de conversão (apenas usuários SEM assinatura ativa):
 *   - Day 7 — Email
 *   - Day 14 — WhatsApp
 *   - Day 21 — Email
 *   - Day 28 — Email + WhatsApp
 *
 * Idempotência: cada envio loga em `zelochat_email_onboarding_logs` ou
 * `zelochat_whatsapp_onboarding_logs` com UNIQUE(user_id, day). Re-execução
 * do cron com Day já registrado é no-op.
 */

interface UserContext {
  userId: string;
  empresaId: string;
  email: string;
  firstName: string;
  contato: string | null;
  doneAt: Date;
}

const FIRST_NAME_FALLBACK = 'tudo bem';

function firstName(displayName: string | null | undefined): string {
  if (!displayName) return FIRST_NAME_FALLBACK;
  const trimmed = displayName.trim();
  if (!trimmed) return FIRST_NAME_FALLBACK;
  return trimmed.split(/\s+/)[0];
}

async function resolveUserContext(userId: string): Promise<UserContext | null> {
  const supabase = getServiceSupabase();

  const { data: empresaRow, error: empresaError } = await supabase
    .from('empresa_perfil')
    .select('id, nome_exibicao, contato, zelochat_onboarding_done_at, zelochat_onboarding_done')
    .eq('user_id', userId)
    .maybeSingle();

  if (empresaError) {
    console.error(`[onboardingFollowup] empresa lookup failed for user ${userId}:`, empresaError.message);
    return null;
  }
  if (!empresaRow) return null;
  const empresa = empresaRow as {
    id: string;
    nome_exibicao: string | null;
    contato: string | null;
    zelochat_onboarding_done_at: string | null;
    zelochat_onboarding_done: boolean | null;
  };

  if (!empresa.zelochat_onboarding_done) return null;

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    console.warn(`[onboardingFollowup] no email for user ${userId}`);
    return null;
  }

  const doneAt = empresa.zelochat_onboarding_done_at
    ? new Date(empresa.zelochat_onboarding_done_at)
    : new Date();

  return {
    userId,
    empresaId: empresa.id,
    email: userData.user.email,
    firstName: firstName(empresa.nome_exibicao),
    contato: empresa.contato,
    doneAt,
  };
}

/** Tries to insert a log row. Returns true if inserted (= we should send), false if duplicate or error. */
async function claimEmailSend(userId: string, day: number, email: string): Promise<boolean> {
  const { error } = await getServiceSupabase()
    .from('zelochat_email_onboarding_logs')
    .insert({ user_id: userId, email_day: day, recipient_email: email });
  if (error) {
    if (error.code !== '23505') {
      console.error(`[onboardingFollowup] email log insert failed (user=${userId} day=${day}):`, error.message);
    }
    return false;
  }
  return true;
}

async function claimWhatsAppSend(userId: string, day: number, phone: string): Promise<boolean> {
  const { error } = await getServiceSupabase()
    .from('zelochat_whatsapp_onboarding_logs')
    .insert({ user_id: userId, message_day: day, recipient_phone: phone });
  if (error) {
    if (error.code !== '23505') {
      console.error(`[onboardingFollowup] whatsapp log insert failed (user=${userId} day=${day}):`, error.message);
    }
    return false;
  }
  return true;
}

async function unclaimEmailSend(userId: string, day: number): Promise<void> {
  await getServiceSupabase()
    .from('zelochat_email_onboarding_logs')
    .delete()
    .eq('user_id', userId)
    .eq('email_day', day);
}

async function unclaimWhatsAppSend(userId: string, day: number): Promise<void> {
  await getServiceSupabase()
    .from('zelochat_whatsapp_onboarding_logs')
    .delete()
    .eq('user_id', userId)
    .eq('message_day', day);
}

/**
 * Sends Day 0 (WhatsApp + Email) for a user who just finished onboarding.
 * Called by `POST /api/onboarding/welcome` synchronously after the frontend
 * upserts `zelochat_onboarding_done=true`.
 *
 * Errors are logged but never thrown — the user shouldn't be blocked from
 * entering the app because Resend is down or the Téchne instance is offline.
 */
export async function sendWelcomePack(userId: string): Promise<{ email: boolean; whatsapp: boolean }> {
  const ctx = await resolveUserContext(userId);
  if (!ctx) return { email: false, whatsapp: false };

  let emailSent = false;
  let whatsappSent = false;

  if (await claimEmailSend(ctx.userId, 0, ctx.email)) {
    const tpl = dayZeroEmail({ firstName: ctx.firstName });
    const ok = await sendEmail({ to: ctx.email, subject: tpl.subject, html: tpl.html, text: tpl.text });
    if (!ok) {
      await unclaimEmailSend(ctx.userId, 0);
    } else {
      emailSent = true;
    }
  }

  if (ctx.contato && (await claimWhatsAppSend(ctx.userId, 0, ctx.contato))) {
    const result = await sendOutreachMessage(ctx.contato, dayZeroWhatsApp(ctx.firstName), `onboarding-whatsapp:${ctx.userId}:0`);
    if (!result.ok) {
      await unclaimWhatsAppSend(ctx.userId, 0);
    } else {
      whatsappSent = true;
    }
  }

  return { email: emailSent, whatsapp: whatsappSent };
}

interface PendingEmpresaRow {
  user_id: string;
  zelochat_onboarding_done_at: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysSince(doneAt: Date, now: Date): number {
  return Math.floor((now.getTime() - doneAt.getTime()) / MS_PER_DAY);
}

const ENGAGEMENT_DAYS = new Set([3]);
const CONVERSION_DAYS = new Set([7, 14, 21, 28]);

/**
 * Daily scan — for every empresa that finished onboarding, check what stage
 * of the sequence they're in and dispatch what's due. Idempotent: log table
 * UNIQUE constraint catches re-runs.
 */
export async function runDailyOnboardingFollowup(): Promise<{
  scanned: number;
  emailsSent: number;
  whatsappsSent: number;
}> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('empresa_perfil')
    .select('user_id, zelochat_onboarding_done_at')
    .eq('zelochat_onboarding_done', true)
    .not('zelochat_onboarding_done_at', 'is', null);

  if (error) {
    console.error('[onboardingFollowup] scan query failed:', error.message);
    return { scanned: 0, emailsSent: 0, whatsappsSent: 0 };
  }
  const rows = (data ?? []) as PendingEmpresaRow[];
  const now = new Date();
  let emailsSent = 0;
  let whatsappsSent = 0;

  for (const row of rows) {
    if (!row.zelochat_onboarding_done_at) continue;
    const doneAt = new Date(row.zelochat_onboarding_done_at);
    const day = daysSince(doneAt, now);

    if (day < 1) continue;
    if (!ENGAGEMENT_DAYS.has(day) && !CONVERSION_DAYS.has(day)) continue;

    const ctx = await resolveUserContext(row.user_id);
    if (!ctx) continue;

    const isConversionDay = CONVERSION_DAYS.has(day);
    if (isConversionDay) {
      const subscribed = await isEmpresaSubscriptionActive(ctx.empresaId).catch(() => false);
      if (subscribed) continue;
    }

    const sent = await sendStep(ctx, day);
    emailsSent += sent.email ? 1 : 0;
    whatsappsSent += sent.whatsapp ? 1 : 0;
  }

  return { scanned: rows.length, emailsSent, whatsappsSent };
}

async function sendStep(ctx: UserContext, day: number): Promise<{ email: boolean; whatsapp: boolean }> {
  let email = false;
  let whatsapp = false;

  const emailTemplate = pickEmailTemplate(day, ctx.firstName);
  if (emailTemplate) {
    if (await claimEmailSend(ctx.userId, day, ctx.email)) {
      const ok = await sendEmail({
        to: ctx.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text,
      });
      if (ok) email = true;
      else await unclaimEmailSend(ctx.userId, day);
    }
  }

  const whatsappBody = pickWhatsAppBody(day, ctx.firstName);
  if (whatsappBody && ctx.contato) {
    if (await claimWhatsAppSend(ctx.userId, day, ctx.contato)) {
      const result = await sendOutreachMessage(ctx.contato, whatsappBody, `onboarding-whatsapp:${ctx.userId}:${day}`);
      if (result.ok) whatsapp = true;
      else await unclaimWhatsAppSend(ctx.userId, day);
    }
  }

  return { email, whatsapp };
}

function pickEmailTemplate(day: number, firstName: string) {
  switch (day) {
    case 3: return dayThreeEmail({ firstName });
    case 7: return daySevenEmail({ firstName });
    case 21: return dayTwentyOneEmail({ firstName });
    case 28: return dayTwentyEightEmail({ firstName });
    default: return null;
  }
}

function pickWhatsAppBody(day: number, firstName: string): string | null {
  switch (day) {
    case 14: return dayFourteenWhatsApp(firstName);
    case 28: return dayTwentyEightWhatsApp(firstName);
    default: return null;
  }
}

let loopHandle: ReturnType<typeof setInterval> | null = null;
const LOOP_STARTUP_DELAY_MS = 2 * 60 * 1000;
const LOOP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Schedules the daily follow-up scan. Mirrors `startSubscriptionSweepLoop`
 * pattern (setTimeout for first run, setInterval for daily cadence). Idempotent:
 * calling twice is a no-op.
 *
 * Disabled when `ENABLE_ONBOARDING_FOLLOWUP=0` to avoid hitting Resend +
 * Whatsmiau in dev. Enabled by default in prod.
 */
export function startOnboardingFollowupLoop(): void {
  if (loopHandle) return;
  if (process.env.ENABLE_ONBOARDING_FOLLOWUP === '0') {
    console.log('[onboardingFollowup] loop disabled via ENABLE_ONBOARDING_FOLLOWUP=0');
    return;
  }

  const tick = () => {
    runDailyOnboardingFollowup()
      .then((r) => {
        console.log(`[onboardingFollowup] scanned=${r.scanned} emails=${r.emailsSent} whatsapps=${r.whatsappsSent}`);
      })
      .catch((err) => {
        console.error('[onboardingFollowup] tick failed:', err instanceof Error ? err.message : err);
      });
  };

  setTimeout(tick, LOOP_STARTUP_DELAY_MS).unref?.();
  loopHandle = setInterval(tick, LOOP_INTERVAL_MS);
  loopHandle.unref?.();
}
