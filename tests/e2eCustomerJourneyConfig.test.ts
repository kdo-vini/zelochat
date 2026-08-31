import assert from 'node:assert/strict';
import { loadCustomerJourneyConfig } from './support/customerJourney.js';

const completeEnv = {
  ZELOCHAT_E2E_CUSTOMER_JOURNEY: '1',
  ZELOCHAT_E2E_ALLOW_WRITES: '1',
  E2E_BASE_URL: 'http://127.0.0.1:3000',
  ZELOCHAT_E2E_API_URL: 'http://127.0.0.1:3001',
  ZELOCHAT_E2E_EMAIL: 'e2e@example.test',
  ZELOCHAT_E2E_PASSWORD: 'secret-from-env',
  ZELOCHAT_E2E_INSTANCE: 'e2e-isolated-instance',
  ZELOCHAT_E2E_WEBHOOK_TOKEN: 'isolated-webhook-token',
  ZELOCHAT_E2E_JID: '5511999999999@s.whatsapp.net',
  ZELOCHAT_E2E_EXPECTED_SUPABASE_REF: 'abcdefghijklmnopqrst',
  ZELOCHAT_E2E_EXPECTED_EMPRESA_ID: '00000000-0000-4000-8000-000000000001',
} satisfies NodeJS.ProcessEnv;

assert.deepEqual(loadCustomerJourneyConfig({}), {
  enabled: false,
  reason: 'Defina ZELOCHAT_E2E_CUSTOMER_JOURNEY=1 para executar o fluxo completo.',
});

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_ALLOW_WRITES: undefined }),
  /ZELOCHAT_E2E_ALLOW_WRITES=1/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_JID: '5511999999999@s.whatsapp.net', E2E_BASE_URL: 'https://chat.zelopdv.com.br' }),
  /não pode rodar contra produção/,
);

assert.throws(
  () => loadCustomerJourneyConfig({
    ...completeEnv,
    E2E_BASE_URL: 'https://chat.zelopdv.com.br',
    ZELOCHAT_E2E_ALLOW_PRODUCTION: '1',
  }),
  /não pode rodar contra produção/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_JID: 'invalid-jid' }),
  /ZELOCHAT_E2E_JID/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_INSTANCE: 'cliente-real' }),
  /prefixo e2e-/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_EXPECTED_SUPABASE_REF: undefined }),
  /ZELOCHAT_E2E_EXPECTED_SUPABASE_REF/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_EXPECTED_EMPRESA_ID: 'empresa-e2e' }),
  /ZELOCHAT_E2E_EXPECTED_EMPRESA_ID/,
);

assert.throws(
  () => loadCustomerJourneyConfig({ ...completeEnv, ZELOCHAT_E2E_EXPECTED_SUPABASE_REF: 'xnnjyrblpvsqrtsshawa' }),
  /projeto Supabase compartilhado/,
);

const config = loadCustomerJourneyConfig(completeEnv);
assert.equal(config.enabled, true);
if (config.enabled) {
  assert.equal(config.baseUrl, 'http://127.0.0.1:3000');
  assert.equal(config.apiUrl, 'http://127.0.0.1:3001');
  assert.equal(config.jid, '5511999999999@s.whatsapp.net');
  assert.equal(config.phone, '5511999999999');
  assert.equal(config.customerPhone, '11999999999');
  assert.equal(config.email, 'e2e@example.test');
  assert.equal(config.password, 'secret-from-env');
  assert.equal(config.expectedSupabaseRef, 'abcdefghijklmnopqrst');
  assert.equal(config.expectedEmpresaId, '00000000-0000-4000-8000-000000000001');
}

console.log('e2eCustomerJourneyConfig: ok');
