import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../server/aiTurnTrace.ts', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/069_ai_turn_traces.sql', import.meta.url), 'utf8');
const aiSource = readFileSync(new URL('../server/ai.ts', import.meta.url), 'utf8');

// O rastro guarda PII (histórico, nome, telefone, endereço do cliente). Só a
// service role pode chegar nele: RLS ligada e nenhuma policy que exponha a
// tabela para o frontend.
assert.match(migration, /enable row level security/i);
assert.doesNotMatch(migration, /create policy/i, 'nenhuma policy expõe o rastro ao frontend');
assert.match(migration, /revoke all on public\.zelochat_ai_turn_traces from anon, authenticated/i);
assert.match(migration, /zelochat_prune_ai_turn_traces/, 'retenção faz parte da migration, não é opcional');

// Uma falha ao gravar o rastro nunca pode custar a resposta ao cliente.
assert.match(source, /catch \(error\) \{[\s\S]*console\.warn\('\[AiTurnTrace\]/, 'falha de gravação é engolida');
assert.doesNotMatch(source, /await recordAiTurnTrace/, 'gravação nunca bloqueia o turno');

// Desligável por variável de ambiente, sem deploy de código.
assert.match(source, /ZELOCHAT_AI_TRACE/);
assert.match(source, /ZELOCHAT_AI_TRACE_KEEP_DAYS/);

// A linha de log continua sem PII — o texto vai só para a tabela.
const decisionFn = aiSource.slice(
  aiSource.indexOf('export function logAiTurnDecision'),
  aiSource.indexOf('/** Há quantas horas esta mensagem chegou'),
);
assert.match(decisionFn, /conversationKey: createHash\('sha256'\)/, 'conversa identificada por hash no log');
const loggedLine = decisionFn.slice(decisionFn.indexOf('const line = {'), decisionFn.indexOf('console.log'));
assert.doesNotMatch(loggedLine, /inboundText|replyText/, 'texto da conversa nunca entra na linha de log');
assert.match(decisionFn, /recordAiTurnTrace\(\{[\s\S]*inboundText: input\.inboundText/, 'o texto vai para o rastro');

// O turno do modelo grava o prompt exato que foi enviado.
assert.match(aiSource, /path: 'model',[\s\S]*systemPrompt: systemInstruction,[\s\S]*runtimeMessages: messages,/);

console.log('aiTurnTrace tests passed');
