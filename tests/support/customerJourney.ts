export type CustomerJourneyConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      baseUrl: string;
      apiUrl: string;
      email: string;
      password: string;
      instance: string;
      webhookToken: string;
      jid: string;
      phone: string;
      customerPhone: string;
      expectedSupabaseRef: string;
      expectedEmpresaId: string;
    };

const REQUIRED_ENV = [
  'E2E_BASE_URL',
  'ZELOCHAT_E2E_API_URL',
  'ZELOCHAT_E2E_EMAIL',
  'ZELOCHAT_E2E_PASSWORD',
  'ZELOCHAT_E2E_INSTANCE',
  'ZELOCHAT_E2E_WEBHOOK_TOKEN',
  'ZELOCHAT_E2E_JID',
  'ZELOCHAT_E2E_EXPECTED_SUPABASE_REF',
  'ZELOCHAT_E2E_EXPECTED_EMPRESA_ID',
] as const;

const FORBIDDEN_SHARED_SUPABASE_REFS = new Set(['xnnjyrblpvsqrtsshawa']);

function required(env: NodeJS.ProcessEnv, name: typeof REQUIRED_ENV[number]): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Defina ${name} para executar o fluxo completo.`);
  return value;
}

export function loadCustomerJourneyConfig(env: NodeJS.ProcessEnv = process.env): CustomerJourneyConfig {
  if (env.ZELOCHAT_E2E_CUSTOMER_JOURNEY !== '1') {
    return {
      enabled: false,
      reason: 'Defina ZELOCHAT_E2E_CUSTOMER_JOURNEY=1 para executar o fluxo completo.',
    };
  }
  if (env.ZELOCHAT_E2E_ALLOW_WRITES !== '1') {
    throw new Error('O fluxo cria dados reais; confirme com ZELOCHAT_E2E_ALLOW_WRITES=1.');
  }

  const baseUrl = required(env, 'E2E_BASE_URL').replace(/\/$/u, '');
  const apiUrl = required(env, 'ZELOCHAT_E2E_API_URL').replace(/\/$/u, '');
  const isProduction = [baseUrl, apiUrl].some((url) => new URL(url).hostname === 'chat.zelopdv.com.br');
  if (isProduction) {
    throw new Error('O fluxo destrutivo de jornada não pode rodar contra produção; use um tenant E2E isolado.');
  }

  const jid = required(env, 'ZELOCHAT_E2E_JID').toLowerCase();
  const match = jid.match(/^(\d{10,15})@s\.whatsapp\.net$/u);
  if (!match) {
    throw new Error('ZELOCHAT_E2E_JID deve ser um número dedicado no formato 5511999999999@s.whatsapp.net.');
  }
  const instance = required(env, 'ZELOCHAT_E2E_INSTANCE');
  if (!instance.startsWith('e2e-')) {
    throw new Error('ZELOCHAT_E2E_INSTANCE deve usar o prefixo e2e- reservado ao ambiente isolado.');
  }
  const expectedSupabaseRef = required(env, 'ZELOCHAT_E2E_EXPECTED_SUPABASE_REF').toLowerCase();
  if (!/^[a-z]{20}$/u.test(expectedSupabaseRef)) {
    throw new Error('ZELOCHAT_E2E_EXPECTED_SUPABASE_REF deve ser o ref de 20 letras do projeto descartável.');
  }
  if (FORBIDDEN_SHARED_SUPABASE_REFS.has(expectedSupabaseRef)) {
    throw new Error('O projeto Supabase compartilhado ZeloPDV não pode ser usado no fluxo destrutivo.');
  }
  const expectedEmpresaId = required(env, 'ZELOCHAT_E2E_EXPECTED_EMPRESA_ID').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(expectedEmpresaId)) {
    throw new Error('ZELOCHAT_E2E_EXPECTED_EMPRESA_ID deve ser o UUID do tenant descartável.');
  }

  return {
    enabled: true,
    baseUrl,
    apiUrl,
    email: required(env, 'ZELOCHAT_E2E_EMAIL'),
    password: required(env, 'ZELOCHAT_E2E_PASSWORD'),
    instance,
    webhookToken: required(env, 'ZELOCHAT_E2E_WEBHOOK_TOKEN'),
    jid,
    phone: match[1],
    customerPhone: match[1].startsWith('55') ? match[1].slice(2) : match[1],
    expectedSupabaseRef,
    expectedEmpresaId,
  };
}
