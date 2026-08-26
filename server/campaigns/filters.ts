export type SegmentDefinition = {
  activityState?: 'active' | 'inactive' | 'never';
  hasPhone?: boolean;
  tagIds?: string[];
  birthdayMonth?: number;
  origin?: string;
  vip?: boolean;
  minOrders?: number;
  minTotalValue?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_KEYS = new Set<keyof SegmentDefinition>(['activityState', 'hasPhone', 'tagIds', 'birthdayMonth', 'origin', 'vip', 'minOrders', 'minTotalValue']);

export function parseSegmentDefinition(value: unknown): SegmentDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Os filtros do segmento são inválidos.');
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key as keyof SegmentDefinition)) throw new Error(`Filtro não permitido: ${key}`);
  const result: SegmentDefinition = {};
  if (input.activityState !== undefined) {
    if (input.activityState !== 'active' && input.activityState !== 'inactive' && input.activityState !== 'never') throw new Error('Estado do cliente inválido.');
    result.activityState = input.activityState;
  }
  if (input.hasPhone !== undefined) { if (typeof input.hasPhone !== 'boolean') throw new Error('Filtro de telefone inválido.'); result.hasPhone = input.hasPhone; }
  if (input.tagIds !== undefined) {
    if (!Array.isArray(input.tagIds) || input.tagIds.length > 30 || input.tagIds.some((tag) => typeof tag !== 'string' || !UUID.test(tag))) throw new Error('Tags do segmento inválidas.');
    result.tagIds = [...new Set(input.tagIds as string[])];
  }
  if (input.birthdayMonth !== undefined) { if (!Number.isInteger(input.birthdayMonth) || Number(input.birthdayMonth) < 1 || Number(input.birthdayMonth) > 12) throw new Error('Mês de aniversário inválido.'); result.birthdayMonth = Number(input.birthdayMonth); }
  if (input.origin !== undefined) { if (typeof input.origin !== 'string' || input.origin.length > 80) throw new Error('Origem inválida.'); result.origin = input.origin.trim(); }
  if (input.vip !== undefined) { if (typeof input.vip !== 'boolean') throw new Error('Filtro VIP inválido.'); result.vip = input.vip; }
  for (const key of ['minOrders', 'minTotalValue'] as const) if (input[key] !== undefined) { if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || input[key] < 0) throw new Error('Limite do segmento inválido.'); result[key] = input[key]; }
  return result;
}

export interface AudiencePerson {
  id: string; name: string; phone: string | null; activityState: 'active' | 'inactive' | 'never'; orderCount: number; totalValue: number;
  isEmployee: boolean; hasConflict: boolean; blocked: boolean; optedOut: boolean;
  suppressionReason?: SuppressionReason;
}
export type SuppressionReason = 'sem_telefone' | 'funcionario' | 'conflito_identidade' | 'bloqueado' | 'opt_out';
export interface AudienceResult { eligible: AudiencePerson[]; suppressed: Array<AudiencePerson & { suppressionReason: SuppressionReason }>; }

function matches(person: AudiencePerson, definition: SegmentDefinition): boolean {
  if (definition.activityState && person.activityState !== definition.activityState) return false;
  if (definition.hasPhone !== undefined && Boolean(person.phone) !== definition.hasPhone) return false;
  if (definition.minOrders !== undefined && person.orderCount < definition.minOrders) return false;
  if (definition.minTotalValue !== undefined && person.totalValue < definition.minTotalValue) return false;
  return true;
}

export function evaluateAudience(people: AudiencePerson[], rawDefinition: unknown): AudienceResult {
  const definition = parseSegmentDefinition(rawDefinition);
  const eligible: AudiencePerson[] = [];
  const suppressed: AudienceResult['suppressed'] = [];
  for (const person of people) {
    if (!matches(person, definition)) continue;
    const suppressionReason: SuppressionReason | undefined = !person.phone ? 'sem_telefone' : person.isEmployee ? 'funcionario' : person.hasConflict ? 'conflito_identidade' : person.blocked ? 'bloqueado' : person.optedOut ? 'opt_out' : undefined;
    if (suppressionReason) suppressed.push({ ...person, suppressionReason }); else eligible.push(person);
  }
  return { eligible, suppressed };
}

export { isOptOutMessage, normalizeOptOutText, OPT_OUT_PHRASES } from '../../src/domain/optOut.js';
