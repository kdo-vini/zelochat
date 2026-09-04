import assert from 'node:assert/strict';
import { describeAiWhatsAppOrdering } from '../src/domain/aiWhatsAppOrderingUi.js';

const active = describeAiWhatsAppOrdering(true);
assert.equal(active.title, 'IA monta pedidos pelo WhatsApp');
assert.equal(active.badge, 'Ativo');
assert.match(active.description, /própria conversa/);

const inactive = describeAiWhatsAppOrdering(false);
assert.equal(inactive.title, 'Pedidos pelo WhatsApp desativados');
assert.equal(inactive.badge, 'Desativado');
assert.match(inactive.description, /não monta nem confirma pedidos/);

for (const copy of [
  active.title, active.description, active.badge,
  inactive.title, inactive.description, inactive.badge,
]) {
  assert.doesNotMatch(copy, /\b(?:off|shadow|active|kill switch|rollout|flag|pilot)\b/i);
}

console.log('aiWhatsAppOrderingUi.test.ts: ok');
