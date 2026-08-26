import assert from 'node:assert/strict';
import { AUTOMATION_KINDS, canEnableAutomation, getAutomationLabel, type AutomationActivation } from '../src/domain/customerAutomation.ts';

assert.deepEqual(AUTOMATION_KINDS, ['birthday', 'reactivation', 'post_purchase', 'vip', 'abandoned_cart']);
assert.deepEqual(AUTOMATION_KINDS.map(getAutomationLabel), ['Aniversário', 'Reativação', 'Pós-compra', 'Clientes VIP', 'Carrinho abandonado']);

const valid: AutomationActivation = { message: 'Olá, {{nome}}!', sendStart: '09:00', sendEnd: '20:00', audience: 'clientes elegíveis', dailyLimit: 50 };
assert.equal(canEnableAutomation(valid), true);
assert.equal(canEnableAutomation({ ...valid, message: ' ' }), false);
assert.equal(canEnableAutomation({ ...valid, sendStart: '20:00', sendEnd: '09:00' }), false);
assert.equal(canEnableAutomation({ ...valid, audience: '' }), false);
assert.equal(canEnableAutomation({ ...valid, dailyLimit: 0 }), false);
assert.equal(canEnableAutomation({ ...valid, dailyLimit: 201 }), false);

console.log('automationUiGuardrails: ok');
