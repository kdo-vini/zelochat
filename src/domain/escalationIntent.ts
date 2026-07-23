export type DetectedEscalationCategory =
  | 'frustration'
  | 'complaint'
  | 'explicit_human_request'
  | 'offensive_language';

export interface DetectedEscalationIntent {
  category: DetectedEscalationCategory;
  triggerName: string;
  reasonText: string;
}

function normalizeEscalationText(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[\s\p{P}\p{S}]+$/u, '');
}

/**
 * Detects only explicit signals in the customer's latest message.
 * A generic order summary must not be interpreted as dissatisfaction just
 * because the model saw a complaint trigger in the conversation context.
 */
export function detectEscalationIntentFromText(value: string): DetectedEscalationIntent | null {
  const normalized = normalizeEscalationText(value);
  if (!normalized) return null;

  if (/\b(humano|atendente|gerente|pessoa real|alguem de verdade|falar com alguem|chama alguem|chamar alguem)\b/.test(normalized)) {
    return {
      category: 'explicit_human_request',
      triggerName: 'Cliente pediu atendente humano',
      reasonText: 'Cliente pediu atendimento humano enquanto havia um fluxo automatico em andamento.',
    };
  }

  if (/\b(reclam\w*|insatisfeit\w*|pessim\w*|horrivel|veio errado|veio sem|faltou|demorou demais|atrasou)\b/.test(normalized)) {
    return {
      category: 'complaint',
      triggerName: 'Reclamacao durante atendimento automatico',
      reasonText: 'Cliente trouxe uma reclamacao junto de outra intencao; automacao interrompida por seguranca.',
    };
  }

  if (/\b(ofens\w*|xing\w*|palavr\w*|idiot\w*|burro|merda|porra|caralho|frustra\w*|raiva|irritad\w*|nervos\w*)\b/.test(normalized)) {
    return {
      category: /frustra|raiva|irritad|nervos/.test(normalized) ? 'frustration' : 'offensive_language',
      triggerName: 'Cliente irritado ou ofensivo',
      reasonText: 'Cliente demonstrou irritacao ou linguagem ofensiva; automacao interrompida por seguranca.',
    };
  }

  return null;
}

/**
 * Built-in escalation triggers are safety-critical, so a model-selected
 * trigger must also have a matching signal in the latest customer message.
 * Custom triggers remain owner-defined and are intentionally not second-guessed
 * here because their condition language is not machine-readable by this rule.
 */
export function isBuiltinEscalationSupportedByMessage(
  triggerId: string,
  latestCustomerMessage: string,
): boolean {
  const intent = detectEscalationIntentFromText(latestCustomerMessage);
  if (triggerId === 'builtin:complaint') return intent !== null;
  if (triggerId === 'builtin:explicit_human') return intent?.category === 'explicit_human_request';
  if (triggerId === 'builtin:offensive') return intent?.category === 'offensive_language';
  return true;
}
