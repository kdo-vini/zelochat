import assert from 'node:assert/strict';
import {
  CONVERSATION_IDLE_RESET_HOURS,
  messagesSinceConversationBreak,
  startsNewConversation,
} from '../src/domain/conversationContinuity.js';

const at = (iso: string, content = 'x') => ({ timestamp: iso, content });

// REGRESSION 2026-09-09: um cliente escreveu "Atendendo ainda" às 12h53 de
// terça, voltou às 20h51 do dia seguinte com "Boa" / "Noite", e a IA respondeu
// "Que bom! Se precisar de algo é só avisar" — leu a saudação como resposta ao
// que ela mesma tinha dito 32 horas antes.
{
  const messages = [
    at('2026-09-08T15:53:00Z', 'Boa tarde'),
    at('2026-09-08T15:53:30Z', 'Atendendo ainda'),
    at('2026-09-08T15:54:00Z', 'Hoje a gente não atende, mas posso agendar'),
    at('2026-09-09T23:51:00Z', 'Boa'),
    at('2026-09-09T23:52:00Z', 'Noite'),
  ];
  const kept = messagesSinceConversationBreak(messages);
  assert.deepEqual(kept.map((m) => m.content), ['Boa', 'Noite'], 'a conversa de ontem não continua hoje');
}

// Idas e vindas ao longo de dias mantêm só o trecho mais recente.
{
  const messages = [
    at('2026-09-01T12:00:00Z', 'dia 1'),
    at('2026-09-03T12:00:00Z', 'dia 3'),
    at('2026-09-03T12:05:00Z', 'dia 3 resposta'),
    at('2026-09-07T12:00:00Z', 'dia 7'),
  ];
  assert.deepEqual(messagesSinceConversationBreak(messages).map((m) => m.content), ['dia 7']);
}

// Uma conversa contínua não é cortada no meio.
{
  const messages = [
    at('2026-09-09T20:00:00Z', 'oi'),
    at('2026-09-09T20:02:00Z', 'quero uma marmita'),
    at('2026-09-09T20:03:00Z', 'qual você quer?'),
    at('2026-09-09T20:04:00Z', 'frango'),
  ];
  assert.equal(messagesSinceConversationBreak(messages).length, 4, 'pedido em andamento fica inteiro');
}

// Uma pausa longa DENTRO do dia também abre conversa nova (almoço x jantar).
{
  const messages = [
    at('2026-09-09T14:00:00Z', 'almoço'),
    at('2026-09-09T23:00:00Z', 'jantar'),
  ];
  assert.deepEqual(messagesSinceConversationBreak(messages).map((m) => m.content), ['jantar']);
}

// Sem hora legível o histórico é mantido: perder o contexto de um pedido em
// andamento é pior que uma saudação fora de lugar.
{
  const messages = [
    { timestamp: null, content: 'sem hora' },
    { timestamp: undefined, content: 'também sem' },
    at('2026-09-09T20:00:00Z', 'com hora'),
  ];
  assert.equal(messagesSinceConversationBreak(messages).length, 3);
  assert.deepEqual(messagesSinceConversationBreak([at('invalido' as string, 'a'), at('2026-09-09T20:00:00Z', 'b')]).length, 2);
}

// Casos degenerados não explodem.
assert.deepEqual(messagesSinceConversationBreak([]), []);
assert.deepEqual(messagesSinceConversationBreak([at('2026-09-09T20:00:00Z', 'só uma')]).length, 1);
assert.equal(messagesSinceConversationBreak([at('2026-09-01T12:00:00Z'), at('2026-09-09T12:00:00Z')], 0).length, 2,
  'janela inválida não corta nada');

// O limiar é configurável e o padrão está documentado.
assert.equal(CONVERSATION_IDLE_RESET_HOURS, 6);
assert.equal(
  messagesSinceConversationBreak([at('2026-09-09T20:00:00Z'), at('2026-09-09T23:00:00Z')], 2).length,
  1,
  'três horas de silêncio com janela de duas abre conversa nova',
);

// `startsNewConversation` decide sem cortar a lista.
{
  const now = Date.parse('2026-09-09T23:00:00Z');
  assert.equal(startsNewConversation([at('2026-09-09T22:00:00Z')], now), false);
  assert.equal(startsNewConversation([at('2026-09-08T22:00:00Z')], now), true);
  assert.equal(startsNewConversation([], now), false, 'conversa vazia não é "nova" nem "velha"');
  assert.equal(startsNewConversation([{ timestamp: null }], now), false, 'sem hora, não afirma nada');
}

console.log('conversationContinuity tests passed');
