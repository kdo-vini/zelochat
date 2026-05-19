/**
 * notify-customers-outage.ts — one-shot outage apology mailer
 * ============================================================================
 *
 * Envia um email pros donos de empresas com assinatura ZeloChat ativa avisando
 * sobre a instabilidade do dia. Usa o sendEmail() do server/email.ts (Resend).
 *
 * Uso:
 *   npx tsx scripts/notify-customers-outage.ts --dry-run    # preview only
 *   npx tsx scripts/notify-customers-outage.ts              # envia de verdade
 *   npx tsx scripts/notify-customers-outage.ts --only=email@x.com  # 1 destinatário (deve ser assinante ativo)
 *   npx tsx scripts/notify-customers-outage.ts --test-to=email@x.com  # 1 envio cru, sem checar Supabase
 *
 * Comportamento:
 *  - Busca todas as empresas com plano 'chat' ou 'bundle' status 'active'
 *  - Resolve o email do dono via auth.users
 *  - Envia sequencialmente (sem paralelismo) pra evitar rate-limit do Resend
 *  - Dedup por email (uma pessoa com 2 empresas recebe 1 email só)
 *  - Loga sucesso/falha; sai com código 1 se houver qualquer falha
 *
 * Texto do email: transparente, curto, sem jargão técnico, sem prometer nada
 * que não podemos garantir (Whatsmiau não documenta retry de webhook).
 */

import 'dotenv/config';
import { getServiceSupabase } from '../server/supabase.js';
import { sendEmail } from '../server/email.js';

interface Args {
  dryRun: boolean;
  only: string | null;
  testTo: string | null;
}

function parseArgs(argv: string[]): Args {
  const dryRun = argv.includes('--dry-run');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const testArg = argv.find((a) => a.startsWith('--test-to='));
  const only = onlyArg ? onlyArg.split('=').slice(1).join('=').trim().toLowerCase() : null;
  const testTo = testArg ? testArg.split('=').slice(1).join('=').trim().toLowerCase() : null;
  return { dryRun, only: only || null, testTo: testTo || null };
}

interface Recipient {
  email: string;
  empresaName: string;
}

const SUBJECT = 'Sobre a instabilidade no ZeloChat hoje';

function buildHtml(empresaName: string): string {
  const safeName = empresaName.replace(/[<>&]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;',
  );
  return `<!doctype html>
<html lang="pt-BR">
  <body style="font-family: -apple-system, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; line-height: 1.55; max-width: 560px; margin: 0 auto; padding: 24px;">
    <p>Olá, ${safeName}.</p>
    <p>
      Hoje o ZeloChat ficou fora do ar por algumas horas. A causa foi uma falha no
      provedor que hospeda nosso servidor — não foi nada na sua conta nem no seu
      WhatsApp.
    </p>
    <p>
      Já está tudo de volta no ar. Pedimos desculpa pelo transtorno: sabemos que
      cada minuto offline é uma conversa de cliente que pode ter ficado sem
      resposta na hora certa.
    </p>
    <p>
      Se você notar qualquer coisa estranha agora que voltou — uma conexão de
      WhatsApp pedindo QR Code de novo, algum pedido fora do lugar, mensagem que
      parece ter sumido — é só responder esse email que a gente resolve direto
      com você.
    </p>
    <p>Obrigado pela paciência.</p>
    <p>— Equipe ZeloChat</p>
  </body>
</html>`;
}

function buildText(empresaName: string): string {
  return [
    `Olá, ${empresaName}.`,
    '',
    'Hoje o ZeloChat ficou fora do ar por algumas horas. A causa foi uma falha no provedor que hospeda nosso servidor — não foi nada na sua conta nem no seu WhatsApp.',
    '',
    'Já está tudo de volta no ar. Pedimos desculpa pelo transtorno: sabemos que cada minuto offline é uma conversa de cliente que pode ter ficado sem resposta na hora certa.',
    '',
    'Se você notar qualquer coisa estranha agora que voltou — uma conexão de WhatsApp pedindo QR Code de novo, algum pedido fora do lugar, mensagem que parece ter sumido — é só responder esse email que a gente resolve direto com você.',
    '',
    'Obrigado pela paciência.',
    '',
    '— Equipe ZeloChat',
  ].join('\n');
}

async function loadRecipients(): Promise<Recipient[]> {
  const supabase = getServiceSupabase();

  // 1. Active ZeloChat subscriptions (chat or bundle, status active).
  const { data: subs, error: subsErr } = await supabase
    .from('subscriptions')
    .select('user_id, status, plan_tier')
    .in('plan_tier', ['chat', 'bundle'])
    .eq('status', 'active');
  if (subsErr) throw new Error(`subscriptions query failed: ${subsErr.message}`);
  const activeUserIds = Array.from(new Set((subs ?? []).map((s) => s.user_id).filter(Boolean)));
  if (activeUserIds.length === 0) return [];

  // 2. Empresa profile (nome_exibicao + user_id) for each active user.
  const { data: empresas, error: empresasErr } = await supabase
    .from('empresa_perfil')
    .select('user_id, nome_exibicao')
    .in('user_id', activeUserIds);
  if (empresasErr) throw new Error(`empresa_perfil query failed: ${empresasErr.message}`);

  const empresaByUser = new Map<string, string>();
  for (const e of empresas ?? []) {
    if (e.user_id && !empresaByUser.has(e.user_id)) {
      empresaByUser.set(e.user_id, (e as { nome_exibicao?: string }).nome_exibicao || 'pessoal');
    }
  }

  // 3. Resolve emails via auth admin API (one call per user — there's no bulk).
  const recipients: Recipient[] = [];
  const seenEmail = new Set<string>();
  for (const userId of activeUserIds) {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error || !data?.user?.email) continue;
      const email = data.user.email.toLowerCase();
      if (seenEmail.has(email)) continue;
      seenEmail.add(email);
      recipients.push({
        email,
        empresaName: empresaByUser.get(userId) ?? 'pessoal',
      });
    } catch (err) {
      console.warn(`[notify] could not resolve email for user=${userId}:`, err);
    }
  }
  return recipients;
}

async function main() {
  const { dryRun, only, testTo } = parseArgs(process.argv.slice(2));
  console.log(
    `[notify] starting (dryRun=${dryRun}${only ? `, only=${only}` : ''}${testTo ? `, testTo=${testTo}` : ''})`,
  );

  // --test-to bypasses the Supabase lookup entirely so we can verify the email
  // pipeline (Resend creds, HTML render) without depending on the recipient
  // already being an active subscriber.
  if (testTo) {
    if (dryRun) {
      console.log(`  would send → ${testTo} (test mode)`);
      return;
    }
    const ok = await sendEmail({
      to: testTo,
      subject: `[TESTE] ${SUBJECT}`,
      html: buildHtml('teste'),
      text: buildText('teste'),
    });
    console.log(ok ? `  ✓ ${testTo}` : `  ✗ ${testTo}`);
    process.exit(ok ? 0 : 1);
  }

  let recipients = await loadRecipients();
  if (only) {
    recipients = recipients.filter((r) => r.email === only);
    if (recipients.length === 0) {
      console.error(`[notify] --only=${only} did not match any active subscriber`);
      process.exit(1);
    }
  }

  console.log(`[notify] ${recipients.length} recipient(s) resolved`);

  if (dryRun) {
    for (const r of recipients) {
      console.log(`  would send → ${r.email} (${r.empresaName})`);
    }
    console.log('[notify] dry run complete — no emails sent');
    return;
  }

  let sent = 0;
  const failed: { email: string; reason: string }[] = [];
  for (const r of recipients) {
    const ok = await sendEmail({
      to: r.email,
      subject: SUBJECT,
      html: buildHtml(r.empresaName),
      text: buildText(r.empresaName),
    });
    if (ok) {
      sent += 1;
      console.log(`  ✓ ${r.email}`);
    } else {
      failed.push({ email: r.email, reason: 'sendEmail returned false (see [email] log above)' });
      console.log(`  ✗ ${r.email}`);
    }
    // Rate-limit cushion — Resend default is 2 req/s on the free tier.
    await new Promise((res) => setTimeout(res, 600));
  }

  console.log(`\n[notify] done: ${sent} sent, ${failed.length} failed`);
  if (failed.length > 0) {
    for (const f of failed) console.error(`  - ${f.email}: ${f.reason}`);
    process.exit(1);
  }
}

void main().catch((err) => {
  console.error('[notify] fatal:', err);
  process.exit(1);
});
