/**
 * Webhook health diagnostic — first stop when inbound messages stop arriving.
 *
 * Covers every known failure mode from the 2026-05-21 outage. See INCIDENTS.md
 * for the playbook each row maps to.
 *
 * Checks per empresa with whatsmiau_instance set:
 *  1. Does the instance name in our DB match the upstream Whatsmiau list?
 *     (Whatsmiau silently renamed instances by appending suffixes during a
 *     migration — DB and upstream drifted, inbound delivery stopped.)
 *  2. Is the webhook URL registered upstream the one we expect?
 *  3. Does our public URL actually accept POSTs, or does it return 405/404?
 *     (Traefik routing skipping /webhook is the other class of failure —
 *     POST hits nginx frontend which serves SPA → 405.)
 *
 * Run from inside the prod backend container (env vars already loaded):
 *   docker exec <backend> sh -c 'cd /app && npx tsx scripts/diagnose-webhooks.ts'
 *
 * Or locally with the prod env vars exported.
 */
import axios from 'axios';

const BASE_URL = (process.env.WHATSMIAU_BASE_URL || 'https://api.whatsmiau.dev').replace(/\/$/, '');
const API_KEY = process.env.WHATSMIAU_API_KEY || '';
const PUBLIC_URL = (process.env.WEBHOOK_PUBLIC_URL || process.env.PUBLIC_APP_URL || 'https://chat.zelopdv.com.br').replace(/\/$/, '');
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';

if (!API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  const missing = [
    !API_KEY && 'WHATSMIAU_API_KEY',
    !SUPABASE_URL && 'SUPABASE_URL',
    !SUPABASE_SERVICE_KEY && 'SUPABASE_SERVICE_ROLE_KEY',
  ].filter(Boolean).join(', ');
  console.error(`Missing env vars: ${missing}`);
  process.exit(1);
}

async function supabaseRest<T = any>(path: string): Promise<T> {
  const { data } = await axios.get(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
    timeout: 15_000,
  });
  return data as T;
}

function redactToken(url: string): string {
  try {
    const u = new URL(url);
    if (u.searchParams.has('token')) u.searchParams.set('token', '***');
    return u.toString();
  } catch {
    return url;
  }
}

async function findWebhook(instance: string): Promise<any> {
  try {
    const { data } = await axios.get(`${BASE_URL}/v2/webhook/find/${instance}`, {
      headers: { apikey: API_KEY },
      timeout: 10_000,
    });
    return data;
  } catch (err: any) {
    return { error: err?.response?.status || err?.message || 'unknown' };
  }
}

async function fetchInstanceList(): Promise<any[]> {
  try {
    const { data } = await axios.get(`${BASE_URL}/evolution/instances`, {
      headers: { apikey: API_KEY },
      timeout: 10_000,
    });
    return Array.isArray(data) ? data : (data?.data ?? []);
  } catch (err: any) {
    console.error('Failed to fetch instance list:', err?.response?.status, err?.message);
    return [];
  }
}

async function probePublicEndpoint(instance: string, token: string | null): Promise<{ httpCode: number; body: string }> {
  const url = `${PUBLIC_URL}/webhook/${encodeURIComponent(instance)}${token ? `?token=${token}` : ''}`;
  try {
    const res = await axios.post(url, {}, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10_000,
      validateStatus: () => true,
    });
    const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return { httpCode: res.status, body: body.slice(0, 200) };
  } catch (err: any) {
    return { httpCode: 0, body: err?.message || 'network error' };
  }
}

(async () => {
  console.log('\n=== Webhook diagnostic ===');
  console.log(`Whatsmiau base:   ${BASE_URL}`);
  console.log(`Expected public:  ${PUBLIC_URL}\n`);

  // -- Probe 1: is the public /webhook path even reachable? --
  console.log('--- Public endpoint reachability ---');
  const probe = await probePublicEndpoint('__diagnostic__', 'invalid');
  console.log(`POST ${PUBLIC_URL}/webhook/__diagnostic__ → HTTP ${probe.httpCode}`);
  if (probe.httpCode === 405) {
    console.log('⚠️  HTTP 405 means /webhook is being routed to the nginx frontend, not the Express backend.');
    console.log('   Fix: ensure Traefik has a PathPrefix(`/webhook`) rule for the backend service.');
    console.log('   See INCIDENTS.md → "POST /webhook returns 405".');
  } else if (probe.httpCode === 404) {
    console.log('   HTTP 404 is expected for an unknown instance — backend is reachable.');
  } else if (probe.httpCode === 200) {
    console.log('   HTTP 200 — backend is reachable and accepting empty payloads.');
  } else {
    console.log(`   Unexpected status. Body: ${probe.body}`);
  }
  console.log('');

  // -- Probe 2: instance state vs DB --
  let empresas: Array<{ id: string; nome_exibicao: string | null; whatsmiau_instance: string | null; webhook_token: string | null }> = [];
  try {
    empresas = await supabaseRest(
      'empresa_perfil?select=id,nome_exibicao,whatsmiau_instance,webhook_token&whatsmiau_instance=not.is.null&order=nome_exibicao.asc',
    );
  } catch (err: any) {
    console.error('Supabase query failed:', err?.response?.status, err?.response?.data ?? err?.message);
    process.exit(1);
  }

  console.log(`--- Per-empresa check (${empresas?.length ?? 0} empresa(s)) ---`);
  if (!empresas?.length) return;

  const upstreamInstances = await fetchInstanceList();
  const upstreamNames = new Set<string>();
  for (const inst of upstreamInstances) {
    const name = inst?.whatsmiau_instance_id ?? inst?.name ?? inst?.instanceName;
    if (name) upstreamNames.add(name);
  }
  console.log(`Upstream instance count: ${upstreamNames.size}`);

  for (const e of empresas) {
    const instance = e.whatsmiau_instance as string;
    const token = e.webhook_token as string | null;
    const expectedUrl = `${PUBLIC_URL}/webhook/${encodeURIComponent(instance)}${token ? `?token=${token}` : ''}`;

    console.log(`\n  ▸ ${e.nome_exibicao || '<no name>'} (${e.id})`);
    console.log(`    DB instance:     ${instance}`);
    console.log(`    Token set:       ${token ? 'YES' : 'NO ⚠️  (webhook re-register sweep skips this empresa)'}`);

    // Instance-name drift detection (Whatsmiau silently renamed in 2026-05).
    if (!upstreamNames.has(instance)) {
      const candidates = [...upstreamNames].filter((n) => n.startsWith(instance) || instance.startsWith(n.split('_').slice(0, -1).join('_')));
      if (candidates.length) {
        console.log(`    Upstream match:  NO ⚠️  — closest upstream name: ${candidates[0]}`);
        console.log(`    Hint: Whatsmiau may have renamed the instance. Run scripts/repair-whatsmiau-instances.ts.`);
      } else {
        console.log(`    Upstream match:  NO ⚠️  — instance not found in upstream list at all (may have been deleted)`);
      }
    } else {
      console.log(`    Upstream match:  YES`);
    }

    const webhookConfig = await findWebhook(instance);
    if (webhookConfig?.error) {
      console.log(`    Registered URL:  <error: ${webhookConfig.error}>`);
    } else {
      const registeredUrl: string =
        webhookConfig?.url ?? webhookConfig?.webhook?.url ?? webhookConfig?.data?.url ?? '<no url>';
      const enabled = webhookConfig?.enabled ?? webhookConfig?.webhook?.enabled ?? '<unknown>';
      console.log(`    Registered URL:  ${redactToken(registeredUrl)}`);
      console.log(`    Enabled:         ${enabled}`);
      const matches = registeredUrl.split('?')[0] === expectedUrl.split('?')[0];
      console.log(`    Matches expect:  ${matches ? 'YES' : 'NO ⚠️'}`);
      if (!matches) console.log(`    Expected URL:    ${redactToken(expectedUrl)}`);
    }

    // Per-empresa public probe — catches token mismatch or service down for ONE empresa.
    const empProbe = await probePublicEndpoint(instance, token);
    const probeOk = empProbe.httpCode === 200 || empProbe.httpCode === 400;
    console.log(`    POST probe:      HTTP ${empProbe.httpCode} ${probeOk ? '' : '⚠️'}`);
    if (!probeOk && empProbe.httpCode !== 0) {
      console.log(`    Probe body:      ${empProbe.body}`);
    }
  }
  console.log('\n=== Done. See INCIDENTS.md for triage flowchart. ===\n');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
