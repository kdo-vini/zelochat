import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { supabaseCustomerIdentityRepository } from '../server/customers/repository';
import { ensureCustomerForSession } from '../server/customers/identity';

// Contract from PDV migration 20260825120000_customer_identity_foundation.sql:
// three named arguments; JSONB uses pessoaId and invalid/linked/created/conflict.
const previousFetch = globalThis.fetch;
const previousUrl = process.env.SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://identity-contract.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
let responseBody: Record<string, unknown>;
let responseStatus = 200;
let requests: Array<Record<string, unknown>>;
const input = { ownerUserId: 'owner-test', phone: '5511999999999', jid: '5511999999999@s.whatsapp.net', observedName: 'Cliente teste', source: 'whatsapp' } as const;

beforeEach(() => {
  requests = [];
  responseStatus = 200;
  responseBody = { status: 'linked', pessoaId: 'person-test', reason: null };
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://identity-contract.test/rest/v1/rpc/ensure_customer_from_whatsapp');
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    assert.deepEqual(Object.keys(body).sort(), ['p_observed_name', 'p_owner_user_id', 'p_phone']);
    return Response.json(responseBody, { status: responseStatus });
  };
});
after(() => {
  globalThis.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('adapta assinatura real de três argumentos e preserva pessoaId da resposta canônica', async () => {
  assert.deepEqual(await supabaseCustomerIdentityRepository.ensureFromWhatsApp(input), {
    status: 'linked', pessoaId: 'person-test', reason: null, candidatePersonIds: [],
  });
  assert.deepEqual(requests, [{ p_owner_user_id: input.ownerUserId, p_phone: input.phone, p_observed_name: input.observedName }]);
});

test('cliente criado pelo contrato canônico é vinculado à sessão', async () => {
  responseBody = { status: 'created', pessoaId: 'person-created', reason: null };
  const persisted: Array<string | null> = [];
  const result = await ensureCustomerForSession({ ...input, empresaId: 'company-test', persistPessoaId: async (id) => { persisted.push(id); } });
  assert.equal(result.status, 'created');
  assert.deepEqual(persisted, ['person-created']);
});

test('retorno invalid do banco é identidade incompleta e não vínculo bem-sucedido', async () => {
  responseBody = { status: 'invalid', pessoaId: null, reason: 'owner_or_phone_invalid' };
  const result = await supabaseCustomerIdentityRepository.ensureFromWhatsApp(input);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.pessoaId, null);
});

test('conflito permanece conflito mesmo quando a resposta identifica uma pessoa', async () => {
  responseBody = { status: 'conflict', pessoaId: 'employee-test', reason: 'phone_belongs_to_employee' };
  const persisted: Array<string | null> = [];
  let conflicts = 0;
  const result = await ensureCustomerForSession({ ...input, empresaId: 'company-test', persistPessoaId: async (id) => { persisted.push(id); } }, {
    repository: { ensureFromWhatsApp: supabaseCustomerIdentityRepository.ensureFromWhatsApp, recordConflict: async () => { conflicts++; } },
  });
  assert.equal(result.status, 'conflict');
  assert.equal(result.reason, 'phone_belongs_to_employee');
  assert.equal(conflicts, 1);
  assert.deepEqual(persisted, [], 'identidade conflitante nunca deve ser vinculada automaticamente');
});

test('erro do banco não é repetido como outra assinatura ou ignorado pelo adaptador', async () => {
  responseStatus = 400;
  responseBody = { code: 'PGRST202', message: 'missing function signature' };
  await assert.rejects(supabaseCustomerIdentityRepository.ensureFromWhatsApp(input), { code: 'PGRST202' });
  assert.equal(requests.length, 1);
});
