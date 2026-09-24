import assert from 'node:assert/strict';
import {
  buildOrderingRouterMessages,
  isOrderingRouterEnabled,
  routeOrderingTurn,
} from '../server/orderingTurnRouter.js';
import { ORDERING_INTENTS } from '../src/domain/orderingTurnRoute.js';

assert.equal(isOrderingRouterEnabled({}), true);
assert.equal(isOrderingRouterEnabled({ ZELOCHAT_ORDERING_ROUTER: undefined }), true);
assert.equal(isOrderingRouterEnabled({ ZELOCHAT_ORDERING_ROUTER: '1' }), true);
assert.equal(isOrderingRouterEnabled({ ZELOCHAT_ORDERING_ROUTER: '0' }), false);
assert.equal(isOrderingRouterEnabled({ ZELOCHAT_ORDERING_ROUTER: 'false' }), false);
assert.equal(isOrderingRouterEnabled({ ZELOCHAT_ORDERING_ROUTER: ' OFF ' }), false);

const messages = buildOrderingRouterMessages({
  storeName: 'Lanchonete do Vini',
  history: [
    { role: 'user', content: 'vazio 1' },
    { role: 'assistant', content: 'vazio 2' },
    { role: 'user', content: 'um' },
    { role: 'assistant', content: 'dois' },
    { role: 'user', content: 'três' },
    { role: 'assistant', content: 'quatro' },
    { role: 'user', content: 'cinco' },
    { role: 'assistant', content: 'seis' },
    { role: 'user', content: 'sete' },
    { role: 'assistant', content: 'oito' },
  ],
  text: 'x'.repeat(2500),
});
assert.equal(messages.length, 8);
assert.deepEqual(messages.slice(1, 7).map((message) => message.content), ['três', 'quatro', 'cinco', 'seis', 'sete', 'oito']);
assert.equal(messages.at(-1)?.role, 'user');
assert.equal((messages.at(-1)?.content as string).length, 2000);
assert.equal((messages[1].content as string).length, 4);
assert.match(messages[0].content as string, /Lanchonete do Vini/);
for (const intent of ORDERING_INTENTS) assert.match(messages[0].content as string, new RegExp(intent));

const truncated = buildOrderingRouterMessages({
  history: [{ role: 'user', content: 'a'.repeat(700) }],
  text: 'texto',
});
assert.equal((truncated[1].content as string).length, 500);

const originalKey = process.env.OPENAI_API_KEY;
try {
  delete process.env.OPENAI_API_KEY;
  assert.equal(await routeOrderingTurn({ text: 'Bom dia', history: [] }), null);
} finally {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
}

console.log('orderingTurnRouter tests passed');
