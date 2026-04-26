import type { TriggerRecord } from './triggers.js';

export const BUILTIN_TRIGGER_PREFIX = 'builtin:';

export const BUILTIN_COMPLAINT_ID = 'builtin:complaint';
export const BUILTIN_EXPLICIT_HUMAN_ID = 'builtin:explicit_human';
export const BUILTIN_OFFENSIVE_ID = 'builtin:offensive';

const FAR_PAST = '1970-01-01T00:00:00Z';

export const BUILTIN_TRIGGERS: TriggerRecord[] = [
  {
    id: BUILTIN_COMPLAINT_ID,
    empresaId: '',
    kind: 'escalate_human',
    name: 'Reclamação ou cliente irritado',
    conditionDescription:
      'O cliente está fazendo uma reclamação clara, demonstrando insatisfação, frustração ou raiva — exemplos: "quero reclamar", "estou insatisfeito", "veio errado", "veio sem recheio", "atendimento péssimo", "demorou demais".',
    naturalInput: '[gatilho do sistema] Reclamações e clientes insatisfeitos',
    active: true,
    createdAt: FAR_PAST,
  },
  {
    id: BUILTIN_EXPLICIT_HUMAN_ID,
    empresaId: '',
    kind: 'escalate_human',
    name: 'Cliente pediu atendente humano',
    conditionDescription:
      'O cliente está pedindo explicitamente para falar com um humano, atendente, gerente ou pessoa real — exemplos: "quero falar com atendente", "chama um humano", "atendente por favor", "quero falar com o gerente", "fala com gente de verdade".',
    naturalInput: '[gatilho do sistema] Pedido explícito de atendimento humano',
    active: true,
    createdAt: FAR_PAST,
  },
  {
    id: BUILTIN_OFFENSIVE_ID,
    empresaId: '',
    kind: 'escalate_human',
    name: 'Linguagem ofensiva ou agressiva',
    conditionDescription:
      'O cliente está usando linguagem ofensiva, palavrões, xingamentos, ameaças ou comportamento agressivo.',
    naturalInput: '[gatilho do sistema] Linguagem ofensiva',
    active: true,
    createdAt: FAR_PAST,
  },
];

export function isBuiltinTriggerId(id: string | null | undefined): boolean {
  return !!id && id.startsWith(BUILTIN_TRIGGER_PREFIX);
}

export function getBuiltinTrigger(id: string): TriggerRecord | null {
  return BUILTIN_TRIGGERS.find((t) => t.id === id) ?? null;
}

export function mergeWithBuiltins(
  custom: TriggerRecord[],
  empresaId: string,
  disabledIds: string[],
): TriggerRecord[] {
  const disabledSet = new Set(disabledIds);
  const enabledBuiltins = BUILTIN_TRIGGERS
    .filter((t) => !disabledSet.has(t.id))
    .map((t) => ({ ...t, empresaId }));
  return [...enabledBuiltins, ...custom];
}
