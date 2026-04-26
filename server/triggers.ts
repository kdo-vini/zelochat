import { getServiceSupabase } from './supabase.js';
import { getAI } from './ai.js';
import { mergeWithBuiltins } from './builtinTriggers.js';

export type TriggerKind = 'notify_manager' | 'escalate_human';

/**
 * Keywords that describe an *escalation-worthy customer state*. When the prose
 * parser (or an operator) tries to file one of these as `notify_manager`, we
 * force-promote to `escalate_human` — the verb ("avisar") is a phrasing habit;
 * the condition is what determines kind. Caused the donut-bug screenshot:
 * "avise o gerente se houver frustração" was filed as notify_manager, so a
 * complaint never silenced the AI.
 */
const ESCALATION_KEYWORDS_RX =
  /(reclam|insatisfa|frustra|raiva|irritad|nervos|xingam|ofens|agress|palavr.o|insult|atendente humano|falar com humano|falar com gente|gerente urgente|pessoa de verdade)/i;

export function shouldForceEscalateHuman(condition: string): boolean {
  return ESCALATION_KEYWORDS_RX.test(condition);
}

export interface TriggerRecord {
  id: string;
  empresaId: string;
  kind: TriggerKind;
  name: string;
  conditionDescription: string;
  naturalInput: string;
  active: boolean;
  createdAt: string;
}

type TriggerRow = {
  id: string;
  empresa_id: string;
  kind: TriggerKind;
  name: string;
  condition_description: string;
  natural_input: string;
  active: boolean;
  created_at: string;
};

function mapTrigger(row: TriggerRow): TriggerRecord {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    kind: row.kind,
    name: row.name,
    conditionDescription: row.condition_description,
    naturalInput: row.natural_input,
    active: row.active,
    createdAt: row.created_at,
  };
}

const SELECT_COLS = 'id, empresa_id, kind, name, condition_description, natural_input, active, created_at';

function assertValidKind(kind: string): asserts kind is TriggerKind {
  if (kind !== 'notify_manager' && kind !== 'escalate_human') {
    throw new Error('INVALID_TRIGGER_KIND');
  }
}

export async function parseTriggerProse(prose: string): Promise<{
  kind: TriggerKind;
  name: string;
  condition_description: string;
}> {
  const input = prose.trim();
  if (!input) throw new Error('INVALID_TRIGGER_PAYLOAD');

  const openai = getAI();
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Você converte instruções em português de um dono de lanchonete em um gatilho estruturado.
Responda APENAS em JSON válido com as chaves: kind, name, condition_description.

REGRA CRÍTICA — classifique pela CONDIÇÃO do cliente, não pelo verbo do dono:
- Mesmo que o dono diga "avise o gerente quando o cliente reclamar", isso é escalate_human
  porque a CONDIÇÃO é uma reclamação (estado emocional do cliente que exige humano).
- "Avisar" é só uma forma de falar — o que importa é o que está acontecendo na conversa.

kind = "escalate_human" SEMPRE QUE a condição envolver:
  - reclamação, insatisfação, frustração, raiva, irritação
  - linguagem ofensiva, xingamentos, agressividade, ameaças
  - pedido explícito para falar com atendente humano / gerente / pessoa real
  - situações que pedem intervenção humana sensível (cancelamento conflituoso, problema com pedido entregue)
  Quando isso acontecer, a IA PARA e o atendente assume.

kind = "notify_manager" APENAS quando é alerta operacional sem interromper o atendimento:
  - pedido grande, pedido com valor alto, volume incomum
  - cliente VIP mencionado por nome
  - eventos rotineiros que o gerente quer acompanhar (ex: novo pedido, primeira compra)
  A IA continua a conversa normalmente após avisar.

name: rótulo curto até 40 caracteres.
condition_description: frase imperativa em 1 linha que a IA de atendimento vai usar para decidir se dispara o gatilho. Seja específico.`,
      },
      { role: 'user', content: input },
    ],
  });

  const raw = response.choices[0]?.message?.content ?? '';
  let parsed: { kind?: string; name?: string; condition_description?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('INVALID_TRIGGER_PARSE');
  }

  if (!parsed.kind || !parsed.name || !parsed.condition_description) {
    throw new Error('INVALID_TRIGGER_PARSE');
  }

  assertValidKind(parsed.kind);

  const name = String(parsed.name).trim().slice(0, 60);
  const condition = String(parsed.condition_description).trim();
  if (!name || !condition) throw new Error('INVALID_TRIGGER_PARSE');

  // Defense in depth: even if the parser came back with notify_manager, a
  // condition that mentions a customer state (frustration / complaint /
  // explicit-human-request / offensive language) MUST escalate. Without this
  // override, an owner phrasing like "avise o gerente quando reclamarem" gets
  // filed as notify_manager and the AI keeps replying after the customer
  // complained — which is exactly the donut-bug failure mode.
  let kind: TriggerKind = parsed.kind;
  if (kind === 'notify_manager' && shouldForceEscalateHuman(condition)) {
    console.warn(
      `[Triggers] Overriding notify_manager → escalate_human (condition: "${condition.slice(0, 80)}")`,
    );
    kind = 'escalate_human';
  }

  return { kind, name, condition_description: condition };
}

export async function listTriggers(empresaId: string): Promise<TriggerRecord[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_triggers')
    .select(SELECT_COLS)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapTrigger(row as TriggerRow));
}

export async function fetchDisabledBuiltinIds(empresaId: string): Promise<string[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('empresa_perfil')
    .select('zelochat_disabled_builtin_triggers')
    .eq('id', empresaId)
    .maybeSingle();
  if (error || !data) return [];
  return (data as { zelochat_disabled_builtin_triggers?: string[] | null })
    .zelochat_disabled_builtin_triggers ?? [];
}

export async function setBuiltinTriggerDisabled(
  empresaId: string,
  builtinId: string,
  disabled: boolean,
): Promise<string[]> {
  const current = await fetchDisabledBuiltinIds(empresaId);
  const set = new Set(current);
  if (disabled) set.add(builtinId);
  else set.delete(builtinId);
  const next = [...set];

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('empresa_perfil')
    .update({ zelochat_disabled_builtin_triggers: next })
    .eq('id', empresaId);
  if (error) throw new Error(error.message);
  return next;
}

export async function fetchActiveTriggers(empresaId: string): Promise<TriggerRecord[]> {
  const supabase = getServiceSupabase();
  const [{ data, error }, disabledIds] = await Promise.all([
    supabase
      .from('zelochat_triggers')
      .select(SELECT_COLS)
      .eq('empresa_id', empresaId)
      .eq('active', true)
      .order('created_at', { ascending: true }),
    fetchDisabledBuiltinIds(empresaId),
  ]);

  const custom = error ? [] : (data ?? []).map((row) => mapTrigger(row as TriggerRow));
  return mergeWithBuiltins(custom, empresaId, disabledIds);
}

export async function createTrigger(empresaId: string, prose: string): Promise<TriggerRecord> {
  const naturalInput = prose.trim();
  if (!naturalInput) throw new Error('INVALID_TRIGGER_PAYLOAD');

  const parsed = await parseTriggerProse(naturalInput);

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_triggers')
    .insert({
      empresa_id: empresaId,
      kind: parsed.kind,
      name: parsed.name,
      condition_description: parsed.condition_description,
      natural_input: naturalInput,
      active: true,
    })
    .select(SELECT_COLS)
    .single();

  if (error) throw new Error(error.message);
  return mapTrigger(data as TriggerRow);
}

export async function updateTrigger(
  empresaId: string,
  triggerId: string,
  patch: { name?: string; conditionDescription?: string; active?: boolean; kind?: TriggerKind },
): Promise<TriggerRecord | null> {
  const nextPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (patch.name !== undefined) {
    const n = patch.name.trim();
    if (!n) throw new Error('INVALID_TRIGGER_PAYLOAD');
    nextPatch.name = n.slice(0, 60);
  }
  if (patch.conditionDescription !== undefined) {
    const c = patch.conditionDescription.trim();
    if (!c) throw new Error('INVALID_TRIGGER_PAYLOAD');
    nextPatch.condition_description = c;
  }
  if (patch.active !== undefined) {
    nextPatch.active = !!patch.active;
  }
  if (patch.kind !== undefined) {
    assertValidKind(patch.kind);
    nextPatch.kind = patch.kind;
  }

  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_triggers')
    .update(nextPatch)
    .eq('id', triggerId)
    .eq('empresa_id', empresaId)
    .select(SELECT_COLS)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapTrigger(data as TriggerRow) : null;
}

export async function deleteTrigger(empresaId: string, triggerId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_triggers')
    .delete()
    .eq('id', triggerId)
    .eq('empresa_id', empresaId)
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data?.id;
}
