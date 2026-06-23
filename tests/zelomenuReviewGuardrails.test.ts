import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cartSessions = readFileSync(new URL('../server/zelomenuCartSessions.ts', import.meta.url), 'utf8');
const router = readFileSync(new URL('../server/router.ts', import.meta.url), 'utf8');
const chatView = readFileSync(new URL('../src/components/views/ChatView.tsx', import.meta.url), 'utf8');
const chatFeedback = readFileSync(new URL('../src/domain/chatFeedback.ts', import.meta.url), 'utf8');

const checks = [
  {
    name: 'backend expõe review + accept do ZeloMenu no chat autenticado',
    run() {
      assert.match(router, /router\.get\('\/api\/zelomenu\/cart-sessions\/review'/);
      assert.match(router, /router\.post\('\/api\/zelomenu\/cart-sessions\/:id\/accept'/);
    },
  },
  {
    name: 'aceite cria produção real e arquiva a sessão do carrinho',
    run() {
      assert.match(cartSessions, /createAcceptedOrderRecord/);
      assert.match(cartSessions, /state:\s*'accepted'/);
      assert.match(cartSessions, /archived_at:\s*now/);
      assert.match(cartSessions, /productionOrderId/);
      assert.match(cartSessions, /buildAcceptedCartCustomerMessage/);
    },
  },
  {
    name: 'aceite bloqueia pix pendente e revalidação quebrada',
    run() {
      assert.match(cartSessions, /REVIEW_NEEDS_ADJUSTMENT/);
      assert.match(cartSessions, /PIX_RECEIPT_PENDING/);
      assert.match(cartSessions, /state:\s*'needs_customer_adjustment'/);
    },
  },
  {
    name: 'card do chat abre revisão do ZeloMenu em vez de forçar kanban',
    run() {
      assert.match(chatFeedback, /source:\s*'zelomenu_review'/);
      assert.match(chatFeedback, /Revisar pedido/);
      assert.match(chatView, /if \(request\.source === 'zelomenu_review'\)/);
      assert.match(chatView, /acceptZeloMenuReviewSession/);
    },
  },
];

let failures = 0;

for (const check of checks) {
  try {
    check.run();
    console.log(`ok - ${check.name}`);
  } catch (error) {
    failures++;
    console.error(`not ok - ${check.name}`);
    console.error(error);
  }
}

if (failures > 0) {
  process.exit(1);
}
