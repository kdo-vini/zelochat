import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const aiPath = fileURLToPath(new URL('../server/ai.ts', import.meta.url));
const escalationPath = fileURLToPath(new URL('../server/escalation.ts', import.meta.url));
const indexPath = fileURLToPath(new URL('../server/index.ts', import.meta.url));
const routerPath = fileURLToPath(new URL('../server/router.ts', import.meta.url));
const debouncerPath = fileURLToPath(new URL('../server/replyDebouncer.ts', import.meta.url));
const dispatcherPath = fileURLToPath(new URL('../server/conversationOutbound.ts', import.meta.url));
const workerPath = fileURLToPath(new URL('../server/outbound/worker.ts', import.meta.url));

const ai = readFileSync(aiPath, 'utf8');
const escalation = readFileSync(escalationPath, 'utf8');
const index = readFileSync(indexPath, 'utf8');
const router = readFileSync(routerPath, 'utf8');
const debouncer = readFileSync(debouncerPath, 'utf8');
const dispatcher = readFileSync(dispatcherPath, 'utf8');
const worker = readFileSync(workerPath, 'utf8');

for (const forbidden of ['sendTextMessage', 'sendButtonMessage', 'sendMediaMessage', 'sendWhatsAppAudio']) {
  assert.doesNotMatch(ai, new RegExp(`\\b${forbidden}\\s*\\(`), `ai.ts não chama ${forbidden}`);
}
assert.doesNotMatch(escalation, /\bsendTextMessage\s*\(/, 'escalation.ts não contorna o dispatcher');

assert.match(ai, /dispatchConversationOutbound\s*\(/, 'AI usa o dispatcher único');
assert.match(ai, /generateAndSendReply\s*\([\s\S]*?permit:\s*AiTurnPermit/, 'entrypoint exige AiTurnPermit');
assert.match(index, /beginAiTurn\s*\(/, 'inbound cria permit somente depois de persistir');
assert.match(index, /generateAndSendReply\s*\([^)]*scheduledPermit/, 'scheduler entrega permit ao modelo');
assert.match(debouncer, /permit:\s*AiTurnPermit/, 'debouncer carrega o permit tipado');
assert.match(router, /\/api\/ai\/reply[\s\S]*?beginAiTurn\s*\(/, 'endpoint direto obtém permit vigente');

assert.match(escalation, /origin:\s*'system_handoff'/, 'handoff ao cliente usa origem explícita');
assert.match(escalation, /origin:\s*'internal_system'/, 'aviso ao gerente usa destino/origem separados');
assert.match(escalation, /dispatchConversationOutbound\s*\(/, 'escalonamento usa dispatcher');
assert.match(dispatcher, /enqueue_zelochat_system_outbound/, 'dispatcher enfileira origens system de forma durável');
assert.match(worker, /job\.origin\s*!==\s*'internal_system'/, 'notificação interna não depende do rollout de CRM');

// Presença, recibo de leitura e revogação não criam mensagens novas e podem
// continuar no transporte direto. O guardrail não proíbe esses símbolos.
assert.match(ai, /sendPresence\s*\(/, 'presença continua como efeito de protocolo permitido');

console.log('aiOutboundGuardrails: ok');
