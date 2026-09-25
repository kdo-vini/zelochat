import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const appShell = readFileSync(new URL('../src/AppShell.tsx', import.meta.url), 'utf8');
const driversView = readFileSync(new URL('../src/components/views/DriversView.tsx', import.meta.url), 'utf8');
const router = readFileSync(new URL('../server/router.ts', import.meta.url), 'utf8');

function sourceBlock(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle);
  assert.notEqual(start, -1, `bloco ${startNeedle} existe`);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `fim do bloco ${startNeedle} existe`);
  return source.slice(start, end);
}

const notifyDriverBlock = sourceBlock(
  driversView,
  'const notifyDriver = async',
  'const cycleStatus = async',
);
assert.match(
  notifyDriverBlock,
  /await dispatchDriver\(token, driver\.id, order\.id\)/,
  'despacho envia a mensagem ao entregador',
);
assert.doesNotMatch(
  notifyDriverBlock,
  /onDispatchSuccess|onUpdateStatus|updateOrderStatus/,
  'sucesso do envio ao entregador não altera o status do pedido',
);

assert.doesNotMatch(
  appShell,
  /handleDispatchSuccess[\s\S]*?updateOrderStatus\([^)]*['"]out_for_delivery['"]\)/,
  'AppShell não transforma despacho ao entregador em saída para entrega',
);

const driverDispatchRoute = sourceBlock(
  router,
  "router.post('/api/drivers/:id/dispatch'",
  "router.post('/api/orders/manual'",
);
assert.doesNotMatch(
  driverDispatchRoute,
  /transitionCanonicalOrder|order-status:|notify_customer_out_for_delivery|saiu pra entrega/i,
  'a rota de despacho envia somente ao entregador e não notifica o cliente',
);

const orderStatusRoute = sourceBlock(
  router,
  "router.patch('/api/orders/:id/status'",
  "router.get('/api/triggers'",
);
assert.match(
  orderStatusRoute,
  /status === 'out_for_delivery'[\s\S]*?notify_customer_out_for_delivery/,
  'a transição explícita continua sendo a responsável pela notificação configurável',
);

console.log('driver dispatch and order status remain separate: ok');
