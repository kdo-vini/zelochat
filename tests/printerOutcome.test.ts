import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { sendPrintJob, sendTestPrint } from '../src/services/zeloImpressaoClient';
import { printDayReport, printOrder, type OrderPrintOptions } from '../src/services/printerService';
import { useAutoPrint, PendingAutoPrintOrders } from '../src/hooks/useAutoPrint';
import type { Order } from '../src/types';

const originalFetch = globalThis.fetch;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const storage = new Map<string, string>();
const job = { source: 'zelochat', type: 'kitchen_order', content: { format: 'text', text: 'Pedido de teste' } } as const;
const unknownOutcome = () => Object.assign(new Error('Resultado incerto'), { code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false });
const ok = () => Response.json({ ok: true });

beforeEach(() => {
  storage.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } });
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

test('aplicativo fechado é detectado antes de enviar o pedido', async () => {
  const paths: string[] = [];
  globalThis.fetch = async (url) => { paths.push(new URL(String(url)).pathname); throw new TypeError('offline'); };
  await assert.rejects(sendPrintJob(job), { code: 'ZELO_IMPRESSAO_UNAVAILABLE', retrySafe: true });
  assert.deepEqual(paths, ['/health']);
});

for (const [name, send] of [
  ['pedido', () => sendPrintJob(job)],
  ['teste', () => sendTestPrint()],
] as const) {
  test(`interrupção depois de iniciar impressão de ${name} exige conferir a saída`, async () => {
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/health')) return ok();
      throw new TypeError('connection interrupted');
    };
    await assert.rejects(send(), { code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false });
  });
}

test('erro de impressão só permite repetição quando o aplicativo garante que é seguro', async () => {
  let retrySafe: boolean | undefined;
  globalThis.fetch = async (url) => String(url).endsWith('/health') ? ok() : Response.json(
    { ok: false, code: 'PRINT_FAILED', retrySafe }, { status: 503 },
  );
  await assert.rejects(sendPrintJob(job), { code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false });
  retrySafe = true;
  await assert.rejects(sendPrintJob(job), { code: 'PRINT_FAILED', retrySafe: true });
});

test('prazo da impressão cobre também a leitura da resposta', { timeout: 1000 }, async () => {
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/health')) return ok();
    return {
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => reject(new Error('response interrupted')), { once: true });
      }),
    } as Response;
  };
  await assert.rejects(sendPrintJob(job, { timeoutMs: 10 }), {
    code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false,
  });
});

test('HTTP 400 do aplicativo antigo sem garantia de repetição mantém resultado incerto', async () => {
  globalThis.fetch = async (url) => String(url).endsWith('/health') ? ok() : Response.json(
    { ok: false, message: 'Falha de impressão' }, { status: 400 },
  );
  await assert.rejects(sendPrintJob(job), { code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false });
});

test('segunda via explícita recebe outro identificador; identificador fornecido é preservado', async () => {
  const ids: string[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/print')) ids.push(JSON.parse(String(init?.body)).jobId);
    return ok();
  };
  await sendPrintJob(job);
  await sendPrintJob(job);
  await sendPrintJob({ ...job, jobId: 'pedido-tentativa-conhecida' });
  assert.ok(ids[0]);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(ids[2], 'pedido-tentativa-conhecida');
});

test('relatório diário não abre fallback quando a impressão pode já ter ocorrido', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/health')) return ok();
    throw new TypeError('connection interrupted');
  };
  // Não há document neste teste: qualquer tentativa de abrir fallback falharia.
  await assert.rejects(printDayReport('04/09/2026', [], 'Loja teste', { browserFallback: true }), {
    code: 'PRINT_OUTCOME_UNKNOWN', retrySafe: false,
  });
});

test('impressão automática preserva dedupe persistido quando o resultado é incerto', async () => {
  let calls = 0;
  let api: ReturnType<typeof useAutoPrint>;
  const errors: string[] = [];
  const printer = { connected: true, print: async () => { calls++; throw unknownOutcome(); } };
  const toast = { success: () => {}, info: () => {}, error: (message: string) => errors.push(message) };
  function Harness() { api = useAutoPrint(printer, 'Loja teste', toast, 'owner-audit'); return null; }
  const order = { id: 'order-audit' } as Order;
  renderToStaticMarkup(createElement(Harness));
  api!.autoPrintOrder(order);
  await new Promise(setImmediate);
  api!.autoPrintOrder(order);
  renderToStaticMarkup(createElement(Harness));
  api!.autoPrintOrder(order);
  assert.equal(calls, 1);
  assert.match(errors[0], /Confira a saída/);
});

test('falha anterior à impressão libera uma nova tentativa automática', async () => {
  let calls = 0;
  let api: ReturnType<typeof useAutoPrint>;
  const printer = { connected: true, print: async () => { calls++; throw Object.assign(new Error('Impressora indisponível'), { retrySafe: true }); } };
  function Harness() { api = useAutoPrint(printer, 'Loja teste', { success: () => {}, info: () => {}, error: () => {} }, 'owner-audit'); return null; }
  renderToStaticMarkup(createElement(Harness));
  api!.autoPrintOrder({ id: 'order-audit' } as Order);
  await new Promise(setImmediate);
  api!.autoPrintOrder({ id: 'order-audit' } as Order);
  await new Promise(setImmediate);
  assert.equal(calls, 2);
});

test('automática exige coordenação persistente antes do POST, inclusive se app fechar', async () => {
  for (const health of [null, {}, { canonicalAutoPrint: true }]) {
    const paths: string[] = [];
    globalThis.fetch = async (url) => {
      paths.push(new URL(String(url)).pathname);
      if (health === null) throw new TypeError('offline');
      return Response.json({ ok: true, capabilities: health });
    };
    await assert.rejects(sendPrintJob({ ...job, companyStoreId: 'owner', intent: { mode: 'automatic', orderId: 'canonical-order', purpose: 'order_ticket' } }), { code: 'AUTO_PRINT_COORDINATION_REQUIRED', retrySafe: false });
    assert.deepEqual(paths, ['/health']);
  }
});

test('serviço transmite owner e pedido canônico; deduplicated pelo PDV é sucesso', async () => {
  const sent: any[] = [];
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/health')) return Response.json({ ok: true, capabilities: { canonicalAutoPrint: true, persistentPrintDeduplication: true } });
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, status: 'deduplicated', arbitration: { source: 'zelopdv', duplicate: true } });
  };
  const order = { id: 'canonical-order', items: [], customerName: 'Teste' } as unknown as Order;
  await printOrder(order, 'Loja', { mode: 'automatic', companyStoreId: 'owner' });
  await printOrder(order, 'Loja', { mode: 'manual', companyStoreId: 'owner' });
  assert.equal(sent[0].companyStoreId, 'owner');
  assert.deepEqual(sent[0].intent, { mode: 'automatic', orderId: order.id, purpose: 'order_ticket' });
  assert.deepEqual(sent[1].intent, { mode: 'manual' });
  assert.notEqual(sent[0].jobId, sent[1].jobId);
});

test('hook não imprime antes de resolver owner; separa automática de segunda via', async () => {
  let api: ReturnType<typeof useAutoPrint>; let owner: string | null = null;
  const sent: Array<OrderPrintOptions | undefined> = [];
  const printer = { connected: true, print: async (_order: Order, _name?: string, options?: OrderPrintOptions) => { sent.push(options); } };
  function Harness() { api = useAutoPrint(printer, 'Loja', { success() {}, info() {}, error() {} }, owner); return null; }
  const order = { id: 'canonical-order' } as Order;
  renderToStaticMarkup(createElement(Harness)); api!.autoPrintOrder(order); assert.equal(sent.length, 0);
  owner = 'owner'; renderToStaticMarkup(createElement(Harness)); api!.autoPrintOrder(order); await new Promise(setImmediate); await api!.reprintOrder(order);
  assert.deepEqual(sent, [{ mode: 'automatic', companyStoreId: 'owner' }, { mode: 'manual', companyStoreId: 'owner' }]);
});

test('eventos aguardam owner/pareamento, expiram e não cruzam logins', () => {
  const pending = new PendingAutoPrintOrders(); const order = { id: 'one' } as Order;
  pending.setActor('actor-a'); pending.add(order, 100);
  assert.deepEqual(pending.take(200), [order]); assert.deepEqual(pending.take(300), []);
  pending.add(order, 100); assert.deepEqual(pending.take(16 * 60_000), []);
  pending.add(order, 100); pending.setActor('actor-b'); assert.deepEqual(pending.take(200), []);
  for (let i = 0; i < 1100; i++) pending.add({ id: String(i) } as Order, 100);
  const bounded = pending.take(200); assert.equal(bounded.length, 1000); assert.equal(bounded[0].id, '100');
});
