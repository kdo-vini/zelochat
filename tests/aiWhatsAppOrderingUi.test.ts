import assert from 'node:assert/strict';
import { describeAiWhatsAppOrdering } from '../src/domain/aiWhatsAppOrderingUi.js';

// PR 1.1/1.3: the card now reflects TWO independent backend facts —
// whether the private integration is configured at all, and whether this
// specific empresa's ai_hybrid_ordering_enabled flag is on. The card must
// never say "IA monta pedidos" when the flag is off, even if the
// integration itself is configured — that would be actively misleading to
// the operator once the flag exists to make this a controlled pilot.
const active = describeAiWhatsAppOrdering(true, true);
assert.equal(active.title, 'IA monta pedidos pelo WhatsApp');
assert.equal(active.badge, 'Ativo');
assert.match(active.description, /própria conversa/);

const configuredButNotEnabled = describeAiWhatsAppOrdering(true, false);
assert.notEqual(configuredButNotEnabled.title, active.title, 'must read differently from the fully-active state');
assert.notEqual(configuredButNotEnabled.badge, active.badge);
assert.notEqual(configuredButNotEnabled.badge, 'Desativado', 'must read differently from "integration not configured" too — different reason, different copy');
assert.doesNotMatch(configuredButNotEnabled.description, /IA monta|IA confirma/i, 'must not imply the AI is already placing orders here');

const inactive = describeAiWhatsAppOrdering(false, false);
assert.equal(inactive.title, 'Pedidos pelo WhatsApp desativados');
assert.equal(inactive.badge, 'Desativado');
assert.match(inactive.description, /não monta nem confirma pedidos/);

// Integration not configured always wins over the flag, regardless of the
// flag's own value — there is nothing to activate without the integration.
const notConfiguredButFlagOn = describeAiWhatsAppOrdering(false, true);
assert.deepEqual(notConfiguredButFlagOn, inactive);

for (const copy of [
  active.title, active.description, active.badge,
  configuredButNotEnabled.title, configuredButNotEnabled.description, configuredButNotEnabled.badge,
  inactive.title, inactive.description, inactive.badge,
]) {
  assert.doesNotMatch(copy, /\b(?:off|shadow|active|kill switch|rollout|flag|pilot)\b/i);
}

console.log('aiWhatsAppOrderingUi.test.ts: ok');
