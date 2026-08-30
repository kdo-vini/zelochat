import assert from 'node:assert/strict';
import type { AiTurnPermit, TakeoverSource } from '../server/conversationControl.js';
import {
  confirmPendingOrderUnderPermit,
  enqueueAutomatedText,
  runAiModelStep,
} from '../server/ai.js';

class Deferred<T> {
  readonly promise: Promise<T>;
  private resolvePromise!: (value: T) => void;

  constructor() {
    this.promise = new Promise<T>((resolve) => {
      this.resolvePromise = resolve;
    });
  }

  resolve(value: T): void {
    this.resolvePromise(value);
  }
}

const permit: AiTurnPermit = {
  empresaId: '00000000-0000-4000-8000-000000000001',
  conversationControlId: '00000000-0000-4000-8000-000000000002',
  remoteJid: '5511999999999@s.whatsapp.net',
  epoch: '7',
  triggerMessageId: '00000000-0000-4000-8000-000000000003',
};

{
  let current = true;
  let inserts = 0;
  let pendingDeletes = 0;
  const enteredTransaction = new Deferred<void>();
  const releaseTransaction = new Deferred<void>();
  const confirmation = confirmPendingOrderUnderPermit(permit, 'pending-1', async ({ idempotencyKey }) => {
    assert.equal(idempotencyKey, `ai-pending:${permit.triggerMessageId}:pending-1`);
    enteredTransaction.resolve();
    await releaseTransaction.promise;
    if (!current) return null;
    inserts += 1;
    pendingDeletes += 1;
    return 'order-1';
  });
  await enteredTransaction.promise;
  current = false;
  releaseTransaction.resolve();
  assert.equal(await confirmation, null, 'takeover intercalado suprime transação pending');
  assert.equal(inserts, 0, 'takeover intercalado cria zero pedido');
  assert.equal(pendingDeletes, 0, 'takeover intercalado não consome pending');
}

for (const source of [
  'zelochat_operator',
  'native_whatsapp',
  'explicit_manual_toggle',
  'escalation',
] satisfies TakeoverSource[]) {
  let current = true;
  let modelCalls = 0;
  let jobWrites = 0;
  const model = new Deferred<{ text: string }>();

  const turn = runAiModelStep(
    permit,
    `model:${source}`,
    async () => {
      modelCalls += 1;
      return model.promise;
    },
    async () => current,
  );

  await Promise.resolve();
  current = false; // claimHumanTakeover(source) advanced the durable epoch.
  model.resolve({ text: 'Resposta antiga' });

  const reply = await turn;
  if (reply) {
    await enqueueAutomatedText({
      permit,
      text: reply.text,
      origin: 'ai_auto',
      purpose: `race-${source}`,
    }, {
      isPermitCurrent: async () => current,
      dispatch: async () => {
        jobWrites += 1;
        return { state: 'queued', jobId: 'job-1', messageId: 'message-1' };
      },
    });
  }

  assert.equal(modelCalls, 1, `${source}: model iniciou antes do takeover`);
  assert.equal(reply, null, `${source}: resposta antiga foi descartada`);
  assert.equal(jobWrites, 0, `${source}: nenhum job AI foi criado`);
}

{
  let modelCalls = 0;
  const result = await runAiModelStep(
    permit,
    'pre-model guard',
    async () => {
      modelCalls += 1;
      return { text: 'não deve rodar' };
    },
    async () => false,
  );
  assert.equal(result, null);
  assert.equal(modelCalls, 0, 'permit revogado bloqueia antes do modelo');
}

for (const purpose of ['tool-followup', 'trigger-fallback', 'pix-helper', 'pending-confirm']) {
  let jobWrites = 0;
  const result = await enqueueAutomatedText({
    permit,
    text: `Mensagem de ${purpose}`,
    origin: purpose === 'tool-followup' ? 'ai_followup' : 'ai_auto',
    purpose,
  }, {
    isPermitCurrent: async () => false,
    dispatch: async () => {
      jobWrites += 1;
      return { state: 'queued', jobId: 'job-1', messageId: 'message-1' };
    },
  });
  assert.equal(result, null, `${purpose}: helper falha fechado`);
  assert.equal(jobWrites, 0, `${purpose}: zero write automático e zero job AI`);
}

for (const context of ['pending-pix-validator', 'active-order-pix-validator']) {
  let current = true;
  let mutations = 0;
  const validator = new Deferred<{ approved: boolean }>();
  const validation = runAiModelStep(permit, context, () => validator.promise, async () => current);
  await Promise.resolve();
  current = false;
  validator.resolve({ approved: true });
  const result = await validation;
  if (result) mutations += 1;
  assert.equal(result, null, `${context}: resultado externo obsoleto é descartado`);
  assert.equal(mutations, 0, `${context}: zero mutação após takeover durante validador`);
}

console.log('aiTakeoverRace: ok');
