import { planToolCallsForTurn, type AiToolCall } from '../server/ai.js';
import type { TriggerRecord } from '../server/triggers.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

function tool(name: string, args: Record<string, unknown> = {}, id = `${name}-${Math.random()}`): AiToolCall {
  return {
    id,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

const notifyTrigger: TriggerRecord = {
  id: 'notify-manager',
  empresaId: 'empresa-1',
  kind: 'notify_manager',
  name: 'Avisar gerente',
  conditionDescription: 'Pedido grande',
  naturalInput: 'Avise o gerente quando tiver pedido grande',
  active: true,
  redirectPhone: null,
  redirectMessage: null,
  createdAt: '2026-05-17T00:00:00.000Z',
};

const escalateTrigger: TriggerRecord = {
  ...notifyTrigger,
  id: 'escalate-human',
  kind: 'escalate_human',
  name: 'Chamar atendente',
  conditionDescription: 'Cliente pediu humano',
};

const redirectTrigger: TriggerRecord = {
  ...notifyTrigger,
  id: 'redirect-contact',
  kind: 'redirect_contact',
  name: 'Trailer Lagoa',
  conditionDescription: 'Cliente quer atendimento do trailer em Lagoa',
  redirectPhone: '5584999991234',
  redirectMessage: 'Fale com o trailer por aqui: {link}',
};

await runSuite('AI tool-call planner', [
  {
    name: 'drops malformed and unsupported tool calls',
    run: () => {
      const malformed = [{ type: 'function', id: 'bad', function: { name: 'criar_pedido', arguments: 123 } }];
      const unsupported = [tool('apagar_banco_inteiro')];
      assertEqual(planToolCallsForTurn(malformed, [notifyTrigger]), null, 'malformed call returns null');
      assertEqual(planToolCallsForTurn(unsupported, [notifyTrigger]), null, 'unsupported call returns null');
    },
  },
  {
    name: 'human escalation wins over order creation and notifications',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('consultar_pedido'),
        tool('criar_pedido', { customerName: 'Vini' }, 'create-1'),
        tool('dispatch_trigger', { trigger_id: redirectTrigger.id }, 'redirect-1'),
        tool('dispatch_trigger', { trigger_id: escalateTrigger.id }, 'escalate-1'),
        tool('dispatch_trigger', { trigger_id: notifyTrigger.id }, 'notify-1'),
      ], [notifyTrigger, escalateTrigger, redirectTrigger]);
      assert(plan !== null, 'planner returns a plan');
      assertEqual(plan?.mode, 'single_terminal', 'escalation is terminal');
      assertEqual(plan?.calls.length, 1, 'only escalation call is kept');
      assertEqual(plan?.calls[0]?.id, 'escalate-1', 'kept call is the escalation trigger');
    },
  },
  {
    name: 'redirect_contact wins over order creation and notifications',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('consultar_pedido', {}, 'consult-1'),
        tool('dispatch_trigger', { trigger_id: notifyTrigger.id }, 'notify-1'),
        tool('criar_pedido', { customerName: 'Vini' }, 'create-1'),
        tool('dispatch_trigger', { trigger_id: redirectTrigger.id }, 'redirect-1'),
      ], [notifyTrigger, redirectTrigger]);
      assert(plan !== null, 'planner returns a plan');
      assertEqual(plan?.mode, 'single_terminal', 'redirect is terminal');
      assertEqual(plan?.calls.length, 1, 'only redirect call is kept');
      assertEqual(plan?.calls[0]?.id, 'redirect-1', 'kept call is the redirect trigger');
    },
  },
  {
    name: 'redirect_contact alone is terminal',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('dispatch_trigger', { trigger_id: redirectTrigger.id }, 'redirect-1'),
      ], [redirectTrigger]);
      assertEqual(plan?.mode, 'single_terminal', 'redirect-only plan is terminal');
      assertEqual(plan?.calls.map((c) => c.id).join(','), 'redirect-1', 'only redirect runs');
    },
  },
  {
    name: 'keeps safe prefix calls before criar_pedido',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('consultar_pedido', {}, 'consult-1'),
        tool('dispatch_trigger', { trigger_id: notifyTrigger.id }, 'notify-1'),
        tool('criar_pedido', { customerName: 'Vini' }, 'create-1'),
      ], [notifyTrigger]);
      assertEqual(plan?.mode, 'sequential_then_terminal', 'safe prefix calls run before terminal order creation');
      assertEqual(plan?.calls.map((c) => c.id).join(','), 'consult-1,notify-1,create-1', 'prefix order is preserved');
    },
  },
  {
    name: 'drops duplicate criar_pedido calls after the first',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('criar_pedido', { total: 10 }, 'create-1'),
        tool('criar_pedido', { total: 20 }, 'create-2'),
      ], []);
      assertEqual(plan?.mode, 'single_terminal', 'single create order is terminal');
      assertEqual(plan?.calls.length, 1, 'only one create-order call remains');
      assertEqual(plan?.calls[0]?.id, 'create-1', 'first create-order call wins');
      assert(plan?.reason.includes('dropped 1 duplicate'), 'reason documents dropped duplicate');
    },
  },
  {
    name: 'allows multiple safe non-terminal calls',
    run: () => {
      const plan = planToolCallsForTurn([
        tool('consultar_pedido', {}, 'consult-1'),
        tool('dispatch_trigger', { trigger_id: notifyTrigger.id }, 'notify-1'),
      ], [notifyTrigger]);
      assertEqual(plan?.mode, 'sequential_non_terminal', 'multiple safe calls are sequential non-terminal');
      assertEqual(plan?.calls.length, 2, 'both safe calls are kept');
    },
  },
]);
