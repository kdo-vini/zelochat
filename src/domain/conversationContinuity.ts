/**
 * Onde uma conversa termina e outra começa.
 *
 * FIX 2026-09-09: o histórico ia inteiro para o modelo, então uma conversa de
 * ontem continuava hoje. Um cliente escreveu "Atendendo ainda" às 12h53 de
 * terça, voltou às 20h51 do dia seguinte com "Boa" / "Noite", e a IA respondeu
 * "Que bom! Se precisar de algo é só avisar" — leu a saudação como resposta ao
 * que ela mesma dissera 32 horas antes. O mesmo histórico velho mantinha
 * `isOrderingFollowUp` verdadeiro: um "Qual você quer?" de ontem transformava
 * o "oi" de hoje em resposta de opção.
 *
 * A regra é a que qualquer atendente usa: passou tempo demais, é uma conversa
 * nova. Não apaga nada — o resumo do cliente continua no system prompt, e as
 * mensagens seguem no banco e na tela do operador. Só deixa de fingir que a
 * frase de hoje responde a pergunta de ontem.
 */

/** Silêncio a partir do qual a próxima mensagem abre uma conversa nova. */
export const CONVERSATION_IDLE_RESET_HOURS = 6;

type TimestampedMessage = { timestamp?: string | null };

function timeOf(message: TimestampedMessage): number | null {
  if (!message.timestamp) return null;
  const parsed = Date.parse(message.timestamp);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * As mensagens desde a última quebra de conversa. Uma quebra é um intervalo
 * maior que `idleHours` entre duas mensagens consecutivas; vale a última, então
 * várias idas e vindas ao longo de dias devolvem só o trecho mais recente.
 *
 * Mensagem sem timestamp legível não cria quebra: sem hora confiável, manter o
 * histórico é o lado seguro do erro — perder contexto de um pedido em
 * andamento é pior que uma saudação um pouco fora de lugar.
 */
export function messagesSinceConversationBreak<T extends TimestampedMessage>(
  messages: readonly T[],
  idleHours: number = CONVERSATION_IDLE_RESET_HOURS,
): T[] {
  if (messages.length < 2 || !(idleHours > 0)) return [...messages];
  const idleMs = idleHours * 60 * 60 * 1000;
  let breakIndex = 0;
  let previous = timeOf(messages[0]);
  for (let index = 1; index < messages.length; index += 1) {
    const current = timeOf(messages[index]);
    if (previous != null && current != null && current - previous > idleMs) breakIndex = index;
    if (current != null) previous = current;
  }
  return messages.slice(breakIndex);
}

/**
 * True quando a última mensagem conhecida é antiga o bastante para que a
 * próxima abra uma conversa nova — para quem precisa da decisão sem cortar a
 * lista (a saudação de entrada, por exemplo).
 */
export function startsNewConversation(
  messages: readonly TimestampedMessage[],
  now: number = Date.now(),
  idleHours: number = CONVERSATION_IDLE_RESET_HOURS,
): boolean {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const at = timeOf(messages[index]);
    if (at == null) continue;
    return now - at > idleHours * 60 * 60 * 1000;
  }
  return false;
}
