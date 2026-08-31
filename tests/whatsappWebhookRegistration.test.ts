import assert from 'node:assert/strict';
import axios from 'axios';

// Regression: re-registering the provider webhook on every QR polling request
// can restart a session moments after the phone has accepted the pairing.
process.env.WHATSMIAU_BASE_URL = 'https://whatsmiau.test';
process.env.PUBLIC_APP_URL = 'https://chat.zelopdv.com.br';
process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
delete process.env.WHATSMIAU_DISABLE_WEBHOOK_REGISTER;

const originalFetch = globalThis.fetch;
const previousAdapter = axios.defaults.adapter;
const paths: string[] = [];

globalThis.fetch = async () => new Response('[]', {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
axios.defaults.adapter = async (config) => {
  paths.push(String(config.url));
  return {
    data: { ok: true },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  };
};

try {
  const { setWebhookForInstance } = await import('../server/whatsapp.js');

  await setWebhookForInstance('qr-refresh-regression');
  await setWebhookForInstance('qr-refresh-regression');

  assert.equal(
    paths.filter((path) => path.includes('/webhook/set/qr-refresh-regression')).length,
    1,
    'a QR polling retry must not re-register an already configured instance webhook',
  );
  assert.equal(
    paths.filter((path) => path.includes('/v2/instance/update/qr-refresh-regression')).length,
    1,
    'the redundant provider update must run only once per configured instance',
  );
  console.log('PASS whatsapp webhook registration is idempotent during QR polling');
} finally {
  axios.defaults.adapter = previousAdapter;
  globalThis.fetch = originalFetch;
}
