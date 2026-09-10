import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { readFileSync } from 'node:fs';
import { ensureCustomerForSession } from '../server/customers/identity.js';
import { supabaseCustomerIdentityRepository } from '../server/customers/repository.js';
import { ensureSession, linkCustomerToSessionFamily } from '../server/messageHandler.js';

const previousFetch = globalThis.fetch;
const previousUrl = process.env.SUPABASE_URL;
const previousKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.SUPABASE_URL = 'https://customer-only-buyers.test';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

const base = {
  empresaId: 'empresa-only-buyers',
  ownerUserId: 'owner-only-buyers',
  jid: '5511913033826@s.whatsapp.net',
  phone: '5511913033826',
};

after(() => {
  globalThis.fetch = previousFetch;
  if (previousUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previousUrl;
  if (previousKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = previousKey;
});

test('conversa sem ficha não chama o RPC nem cria pessoa, mas preserva a sessão', async () => {
  let rpcCalls = 0;
  let persistedSession = false;
  const result = await ensureCustomerForSession({
    ...base,
    createIfMissing: false,
    persistPessoaId: async (pessoaId) => {
      assert.equal(pessoaId, null);
      persistedSession = true;
    },
  }, {
    repository: {
      findExistingByPhone: async () => [],
      ensureFromWhatsApp: async () => {
        rpcCalls += 1;
        return { status: 'created', pessoaId: 'must-not-exist' };
      },
    },
  });

  assert.deepEqual(result, { status: 'incomplete', pessoaId: null });
  assert.equal(rpcCalls, 0);
  assert.equal(persistedSession, true);
});

test('ficha legada com contato formatado é encontrada e só então vinculada', async () => {
  const requests: string[] = [];
  const previousTestFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url));
    requests.push(requestUrl.pathname);
    if (requestUrl.pathname.endsWith('/pessoa_identities')) return Response.json([]);
    if (requestUrl.pathname.endsWith('/pessoas')) {
      assert.equal(requestUrl.searchParams.get('id_usuario'), 'eq.owner-only-buyers');
      return Response.json([{ id: 'person-formatted', contato: '(11) 91303-3826' }]);
    }
    throw new Error(`unexpected request: ${requestUrl.pathname}`);
  };

  try {
    let rpcCalls = 0;
    const result = await ensureCustomerForSession({ ...base, createIfMissing: false }, {
      repository: {
        findExistingByPhone: (input) => supabaseCustomerIdentityRepository.findExistingByPhone!(input),
        ensureFromWhatsApp: async (input) => {
          rpcCalls += 1;
          assert.equal(input.phone, '5511913033826');
          return { status: 'linked', pessoaId: 'person-formatted' };
        },
      },
    });

    assert.equal(result.status, 'linked');
    assert.equal(result.pessoaId, 'person-formatted');
    assert.equal(rpcCalls, 1);
    assert.deepEqual(requests, [
      '/rest/v1/pessoa_identities',
      '/rest/v1/pessoas',
    ]);
  } finally {
    globalThis.fetch = previousTestFetch;
  }
});

test('sem createIfMissing continua criando para pedidos e backfill', async () => {
  let findCalls = 0;
  let ensureCalls = 0;
  const result = await ensureCustomerForSession(base, {
    repository: {
      findExistingByPhone: async () => {
        findCalls += 1;
        return [];
      },
      ensureFromWhatsApp: async () => {
        ensureCalls += 1;
        return { status: 'created', pessoaId: 'person-created-by-order' };
      },
    },
  });

  assert.equal(result.status, 'created');
  assert.equal(result.pessoaId, 'person-created-by-order');
  assert.equal(findCalls, 0);
  assert.equal(ensureCalls, 1);

  const canonicalSource = readFileSync(new URL('../server/canonicalOrders.ts', import.meta.url), 'utf8');
  const backfillSource = readFileSync(new URL('../server/customers/backfill.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(canonicalSource, /createIfMissing:\s*false/);
  assert.doesNotMatch(backfillSource, /createIfMissing:\s*false/);
});

test('falha na busca de identidade retorna failed e deixa a sessão seguir', async () => {
  let rpcCalls = 0;
  let persistedPessoaId: string | null | undefined;
  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    const result = await ensureCustomerForSession({
      ...base,
      createIfMissing: false,
      persistPessoaId: async (pessoaId) => { persistedPessoaId = pessoaId; },
    }, {
      repository: {
        findExistingByPhone: async () => { throw new Error('lookup unavailable'); },
        ensureFromWhatsApp: async () => {
          rpcCalls += 1;
          return { status: 'created', pessoaId: 'must-not-exist' };
        },
      },
    });

    assert.equal(result.status, 'failed');
    assert.equal(result.pessoaId, null);
    assert.equal(persistedPessoaId, null);
    assert.equal(rpcCalls, 0);
  } finally {
    console.error = previousConsoleError;
  }
});

test('falha na consulta nova preserva a gravação da sessão', async () => {
  const previousTestFetch = globalThis.fetch;
  const calls: string[] = [];
  let storedSession: Record<string, unknown> | null = null;
  const sessionId = 'session-fail-open';
  const snapshot = {
    conversationControlId: 'control-1',
    mode: 'ai',
    epoch: '1',
    remoteJids: [base.jid],
    changedAt: '2026-09-10T12:00:00.000Z',
  };

  globalThis.fetch = async (url, init) => {
    const requestUrl = new URL(String(url));
    const method = init?.method ?? 'GET';
    calls.push(`${method} ${requestUrl.pathname}`);

    if (requestUrl.pathname.endsWith('/empresa_perfil')) return Response.json({ user_id: base.ownerUserId });
    if (requestUrl.pathname.endsWith('/pessoa_identities')) return Response.json({ message: 'temporary lookup failure' }, { status: 503 });
    if (requestUrl.pathname.endsWith('/zelochat_sessions')) {
      if (method === 'GET') {
        if (requestUrl.searchParams.has('or')) return Response.json(storedSession ? [storedSession] : []);
        return Response.json(storedSession);
      }
      if (method === 'POST') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        storedSession = { ...body, id: sessionId, customer_profile: null };
        return Response.json(storedSession, { status: 201 });
      }
    }
    if (requestUrl.pathname.endsWith('/rpc/ensure_zelochat_conversation_control')) return Response.json(snapshot);
    throw new Error(`unexpected request: ${method} ${requestUrl.pathname}`);
  };

  const previousConsoleError = console.error;
  console.error = () => undefined;
  try {
    const session = await ensureSession({
      empresaId: base.empresaId,
      jid: base.jid,
      customerName: 'Cliente sem ficha',
      customerPhone: '(11) 91303-3826',
      lastMessage: 'Olá',
    });

    assert.equal(session.id, sessionId);
    assert.equal(storedSession?.pessoa_id, null);
    assert.ok(calls.includes('POST /rest/v1/zelochat_sessions'));
    assert.ok(!calls.some((call) => call.includes('/rpc/ensure_customer_from_whatsapp')));
  } finally {
    globalThis.fetch = previousTestFetch;
    console.error = previousConsoleError;
  }
});

test('pedido resolvido carimba somente sessões nulas da família na empresa correta', async () => {
  const previousTestFetch = globalThis.fetch;
  const updateRequests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const sameCompanyRows = [
    {
      id: 'session-company-a-1', remote_jid: base.jid, pessoa_id: null,
      customer_name: 'Cliente', customer_phone: '(11) 91303-3826', updated_at: '2026-09-10T12:00:00Z',
    },
    {
      id: 'session-company-a-2', remote_jid: '11913033826@s.whatsapp.net', pessoa_id: null,
      customer_name: 'Cliente', customer_phone: '(11) 91303-3826', updated_at: '2026-09-10T11:00:00Z',
    },
  ];

  globalThis.fetch = async (url, init) => {
    const requestUrl = new URL(String(url));
    const method = init?.method ?? 'GET';
    if (requestUrl.pathname.endsWith('/zelochat_sessions') && method === 'GET') {
      assert.equal(requestUrl.searchParams.get('empresa_id'), 'eq.empresa-c2');
      if (requestUrl.searchParams.has('or')) {
        assert.match(requestUrl.searchParams.get('or') ?? '', /customer_phone\.ilike\.\*1\*3\*0\*3\*3\*8\*2\*6/);
        return Response.json(sameCompanyRows);
      }
      return Response.json(null);
    }
    if (requestUrl.pathname.endsWith('/zelochat_sessions') && method === 'PATCH') {
      updateRequests.push({
        url: String(url),
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected request: ${method} ${requestUrl.pathname}`);
  };

  try {
    await linkCustomerToSessionFamily({ empresaId: 'empresa-c2', phone: '(11) 91303-3826', pessoaId: 'person-c2' });
    assert.equal(updateRequests.length, 1);
    assert.equal(updateRequests[0].body.pessoa_id, 'person-c2');
    assert.match(updateRequests[0].url, /empresa_id=eq\.empresa-c2/);
    assert.match(updateRequests[0].url, /pessoa_id=is\.null/);
    assert.match(updateRequests[0].url, /id=in\./);
    assert.match(updateRequests[0].url, /session-company-a-1/);
    assert.match(updateRequests[0].url, /session-company-a-2/);
    assert.doesNotMatch(updateRequests[0].url, /company-b/);
  } finally {
    globalThis.fetch = previousTestFetch;
  }
});

test('os dois caminhos de pedido mantêm o carimbo como enriquecimento', () => {
  const canonicalSource = readFileSync(new URL('../server/canonicalOrders.ts', import.meta.url), 'utf8');
  const zeloMenuSource = readFileSync(new URL('../server/zelomenuCartSessions.ts', import.meta.url), 'utf8');
  assert.match(canonicalSource, /linkCustomerToSessionFamily/);
  assert.match(zeloMenuSource, /linkCustomerToSessionFamily/);
  assert.match(canonicalSource, /session-linking failure must not invalidate the order/);
  assert.match(zeloMenuSource, /session-linking failure must not invalidate the order/);
});
