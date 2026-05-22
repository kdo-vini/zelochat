/**
 * Emergency repair — Whatsmiau silently renamed our instances.
 *
 * When Whatsmiau migrates instance IDs (e.g. appends a suffix like `_d3c6ca80`
 * to every instance name on their side), inbound webhook delivery stops even
 * though outbound sends keep working (they alias the old name internally).
 *
 * This script:
 *   1. Reads target empresa rows from Supabase
 *   2. For each target, renames `empresa_perfil.whatsmiau_instance` to the new
 *      upstream name
 *   3. Re-registers the webhook on the new name with the existing
 *      `webhook_token` (which we MUST keep — it authenticates inbound webhooks)
 *
 * Edit `TARGETS` below before running. Always dry-run with `DRY_RUN=1` first.
 *
 * Run inside the prod backend container:
 *   docker cp scripts/repair-whatsmiau-instances.ts <backend>:/app/scripts/
 *   docker exec <backend> sh -c 'cd /app && DRY_RUN=1 npx tsx scripts/repair-whatsmiau-instances.ts'
 *   docker exec <backend> sh -c 'cd /app && npx tsx scripts/repair-whatsmiau-instances.ts'
 *   docker restart <backend>   # flush instanceManager 60s cache
 *
 * See INCIDENTS.md → "Whatsmiau renamed instances upstream".
 */
import axios from 'axios';

const BASE_URL = (process.env.WHATSMIAU_BASE_URL || 'https://api.whatsmiau.dev').replace(/\/$/, '');
const API_KEY = process.env.WHATSMIAU_API_KEY || '';
const PUBLIC_URL = (process.env.WEBHOOK_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://chat.zelopdv.com.br').replace(/\/$/, '');
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
const DRY_RUN = ['1', 'true', 'yes'].includes((process.env.DRY_RUN || '').toLowerCase());

// EDIT THIS BLOCK before running for a new outage.
// Map current DB instance name → new upstream name.
const TARGETS: Array<{ oldName: string; newName: string }> = [
  // Example from the 2026-05-22 incident (kept here as a record):
  // { oldName: 'zelo-633a8fef-e449e08d171a0a11', newName: 'zelo-633a8fef-e449e08d171a0a11_d3c6ca80' },
];

if (!API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env: WHATSMIAU_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (TARGETS.length === 0) {
  console.error('TARGETS is empty — edit scripts/repair-whatsmiau-instances.ts before running.');
  process.exit(1);
}

async function supaGet(path: string): Promise<any[]> {
  const { data } = await axios.get(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
    timeout: 15_000,
  });
  return data;
}

async function supaPatch(path: string, body: any): Promise<any> {
  if (DRY_RUN) return { dryRun: true };
  const { data } = await axios.patch(`${SUPABASE_URL}/rest/v1/${path}`, body, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    timeout: 15_000,
  });
  return data;
}

const WEBHOOK_EVENTS = ['MESSAGES_UPSERT', 'MESSAGES_UPDATE', 'MESSAGES_DELETE', 'CONNECTION_UPDATE', 'CONTACTS_UPSERT'];

async function setWebhook(instanceName: string, webhookUrl: string): Promise<void> {
  if (DRY_RUN) return;
  await axios.post(
    `${BASE_URL}/webhook/set/${instanceName}`,
    {
      webhook: {
        enabled: true,
        url: webhookUrl,
        webhookByEvents: false,
        base64: true,
        events: WEBHOOK_EVENTS,
      },
    },
    { headers: { apikey: API_KEY }, timeout: 15_000 },
  );
  try {
    await axios.put(
      `${BASE_URL}/v2/instance/update/${instanceName}`,
      { webhook: { enabled: true, url: webhookUrl, base64: true, events: WEBHOOK_EVENTS } },
      { headers: { apikey: API_KEY, 'Content-Type': 'application/json' }, timeout: 15_000 },
    );
  } catch (e: any) {
    console.warn(`  v2/instance/update redundancy call failed (non-fatal): ${e?.response?.status || e?.message}`);
  }
}

async function verifyWebhook(instanceName: string): Promise<any> {
  const { data } = await axios.get(`${BASE_URL}/v2/webhook/find/${instanceName}`, {
    headers: { apikey: API_KEY },
    timeout: 15_000,
  });
  return data?.webhook ?? data;
}

(async () => {
  console.log(`=== Whatsmiau instance repair (${DRY_RUN ? 'DRY RUN' : 'LIVE'}) ===`);
  console.log(`Public URL: ${PUBLIC_URL}\n`);

  for (const { oldName, newName } of TARGETS) {
    console.log(`\n--- ${oldName}`);
    const rows = await supaGet(
      `empresa_perfil?select=id,nome_exibicao,whatsmiau_instance,webhook_token&whatsmiau_instance=eq.${encodeURIComponent(oldName)}`,
    );
    if (!rows?.length) {
      console.log(`  SKIP: not found in DB (already migrated?)`);
      continue;
    }
    const row = rows[0];
    console.log(`  Empresa: ${row.nome_exibicao} (${row.id})`);
    if (!row.webhook_token) {
      console.log(`  ABORT: webhook_token missing — cannot register safely`);
      continue;
    }
    const newWebhookUrl = `${PUBLIC_URL}/webhook/${newName}?token=${row.webhook_token}`;
    console.log(`  New name → ${newName}`);
    console.log(`  New URL  → ${newWebhookUrl.replace(row.webhook_token, '***')}`);

    await supaPatch(`empresa_perfil?id=eq.${row.id}`, { whatsmiau_instance: newName });
    console.log(`  [1/3] DB updated`);

    await setWebhook(newName, newWebhookUrl);
    console.log(`  [2/3] Webhook registered upstream`);

    if (!DRY_RUN) {
      const cfg = await verifyWebhook(newName);
      console.log(`  [3/3] Verify: enabled=${cfg?.enabled} url=${(cfg?.url || '').replace(row.webhook_token, '***')}`);
    } else {
      console.log(`  [3/3] (verify skipped in DRY_RUN)`);
    }
  }

  console.log(`\n=== ${DRY_RUN ? 'DRY RUN complete — re-run without DRY_RUN=1 to apply.' : 'Done. Restart backend to flush instanceManager cache.'} ===`);
})().catch((err) => {
  console.error('FATAL:', err?.response?.status, err?.response?.data || err?.message);
  process.exit(1);
});
