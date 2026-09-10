import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

// REGRESSION 2026-09-10: o guard de agendamento lia `session.messages` cru e
// sem filtro de papel. Um cliente escreveu "Boa noite! Ainda esta aberto?" as
// 21:30 e recebeu "Esse horario ja passou hoje: 18:00" -- o 18:00 saiu de uma
// resposta da PROPRIA LOJA enviada 47 dias antes, a unica outra mensagem da
// conversa. Duas defesas: a conversa velha nao entra, e mensagem nossa nunca
// e lida como horario pedido.
{
  const sessionMessages = [
    { role: 'user', content: 'Boa tarde!\nVc tem alguma coisa ainda pro almoco?', timestamp: '2026-07-25T17:25:47Z' },
    { role: 'assistant', content: 'Ola tudo bem ?? Hoje nosso atendimento comeca as 18:00 hs bjs e ate la', timestamp: '2026-07-25T17:25:51Z' },
    { role: 'user', content: 'Boa noite!\nAinda esta aberto?', timestamp: '2026-09-10T00:30:20Z' },
  ];
  const current = messagesSinceConversationBreak(sessionMessages);
  assert.deepEqual(
    current.map((m) => m.role),
    ['user'],
    'a conversa de 47 dias atras nao entra no turno de hoje',
  );
  assert.equal(
    current.some((m) => (m.content ?? '').includes('18:00')),
    false,
    'o 18:00 de julho nao alcanca o guard de hoje',
  );
}

const guardSource = readFileSync(new URL('../server/ai.ts', import.meta.url), 'utf8');
assert.match(
  guardSource,
  /findRecentTodayBlockedOperationalGuard\(resolvedEmpresaId, currentConversation\)/,
  'o guard de data bloqueada le so a conversa atual',
);
assert.match(
  guardSource,
  /findRecentScheduleContextGuard\(\s*resolvedEmpresaId,\s*isGeneralMode \? \[\] : currentConversation,/,
  'o guard de agendamento le so a conversa atual',
);

console.log('conversationContinuity tests passed');
