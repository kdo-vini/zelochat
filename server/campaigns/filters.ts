import {
  matchesCustomerSegment,
  parseCustomerSegment,
  type CustomerSegment,
  type CustomerSegmentSubject,
} from '../../src/domain/customerSegment.js';

export type SegmentDefinition = CustomerSegment & {
  activityState?: 'active' | 'inactive' | 'never';
  hasPhone?: boolean;
  birthdayOnly?: boolean;
  vip?: boolean;
};

const ALLOWED_KEYS = new Set([
  'search', 'buyers', 'minOrders', 'maxOrders', 'minTotalValue',
  'minDaysSinceLastOrder', 'maxDaysSinceLastOrder', 'hasWhatsApp', 'tagIds',
  'birthdayMonth', 'origin', 'activityState', 'hasPhone', 'birthdayOnly', 'vip',
]);

export function parseSegmentDefinition(value: unknown): SegmentDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Os filtros do segmento são inválidos.');
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!ALLOWED_KEYS.has(key)) throw new Error(`Filtro não permitido: ${key}`);

  const canonical: Record<string, unknown> = {};
  for (const key of ['search', 'buyers', 'minOrders', 'maxOrders', 'minTotalValue', 'minDaysSinceLastOrder', 'maxDaysSinceLastOrder', 'hasWhatsApp', 'tagIds', 'birthdayMonth', 'origin']) {
    if (input[key] !== undefined) canonical[key] = input[key];
  }
  if (input.hasPhone !== undefined) {
    if (typeof input.hasPhone !== 'boolean') throw new Error('Filtro de telefone inválido.');
    if (canonical.hasWhatsApp === undefined) canonical.hasWhatsApp = input.hasPhone;
  }
  const result: SegmentDefinition = { ...parseCustomerSegment(canonical) };
  if (input.activityState !== undefined) {
    if (input.activityState !== 'active' && input.activityState !== 'inactive' && input.activityState !== 'never') throw new Error('Estado do cliente inválido.');
    result.activityState = input.activityState;
  }
  if (input.hasPhone !== undefined) result.hasPhone = input.hasPhone as boolean;
  if (input.hasPhone !== undefined && input.hasWhatsApp === undefined) delete result.hasWhatsApp;
  if (input.birthdayOnly !== undefined) {
    if (typeof input.birthdayOnly !== 'boolean') throw new Error('Filtro de aniversário inválido.');
    result.birthdayOnly = input.birthdayOnly;
  }
  if (input.vip !== undefined) {
    if (typeof input.vip !== 'boolean') throw new Error('Filtro VIP inválido.');
    result.vip = input.vip;
  }
  return result;
}

export function segmentDefinitionToCustomerSegment(definition: SegmentDefinition): CustomerSegment {
  const { activityState: _activityState, hasPhone, birthdayOnly: _birthdayOnly, vip: _vip, ...canonical } = definition;
  return parseCustomerSegment({ ...canonical, hasWhatsApp: canonical.hasWhatsApp ?? hasPhone });
}

export interface AudiencePerson extends CustomerSegmentSubject {
  id: string;
  name: string;
  phone: string | null;
  tagIds?: string[];
  birthdayMonth?: number | null;
  origin?: string | null;
  lastOrderAt?: string | null;
  isEmployee: boolean;
  hasConflict: boolean;
  blocked: boolean;
  optedOut: boolean;
  isVip?: boolean;
  activityState: 'active' | 'inactive' | 'never';
  suppressionReason?: SuppressionReason;
}
export type SuppressionReason = 'sem_telefone' | 'funcionario' | 'conflito_identidade' | 'bloqueado' | 'opt_out';
export interface AudienceResult { eligible: AudiencePerson[]; suppressed: Array<AudiencePerson & { suppressionReason: SuppressionReason }>; }

function matchesLegacyCriteria(person: AudiencePerson, definition: SegmentDefinition): boolean {
  if (definition.activityState && person.activityState !== definition.activityState) return false;
  if (definition.birthdayOnly && person.birthdayMonth == null) return false;
  if (definition.vip && !person.isVip) return false;
  return true;
}

export function evaluateAudience(people: AudiencePerson[], rawDefinition: unknown): AudienceResult {
  const definition = parseSegmentDefinition(rawDefinition);
  const segment = segmentDefinitionToCustomerSegment(definition);
  const eligible: AudiencePerson[] = [];
  const suppressed: AudienceResult['suppressed'] = [];
  for (const person of people) {
    if (!matchesCustomerSegment(person, segment) || !matchesLegacyCriteria(person, definition)) continue;
    const suppressionReason: SuppressionReason | undefined = !person.phone ? 'sem_telefone' : person.isEmployee ? 'funcionario' : person.hasConflict ? 'conflito_identidade' : person.blocked ? 'bloqueado' : person.optedOut ? 'opt_out' : undefined;
    if (suppressionReason) suppressed.push({ ...person, suppressionReason }); else eligible.push(person);
  }
  return { eligible, suppressed };
}

export { isOptOutMessage, normalizeOptOutText, OPT_OUT_PHRASES } from '../../src/domain/optOut.js';
