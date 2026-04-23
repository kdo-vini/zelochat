import { getServiceSupabase } from './supabase.js';
import { getAI } from './ai.js';

export type TriggerKind = 'notify_manager' | 'escalate_human';

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

kind = "escalate_human" quando o dono quer que a IA pare e chame um humano
  (reclamação, cliente irritado, confirmar pedido para entrega, perguntas fora do escopo).
kind = "notify_manager" quando é só avisar o gerente sem interromper o atendimento da IA
  (pedido grande, volume alto, cliente VIP mencionado).

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

  return { kind: parsed.kind, name, condition_description: condition };
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

export async function fetchActiveTriggers(empresaId: string): Promise<TriggerRecord[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_triggers')
    .select(SELECT_COLS)
    .eq('empresa_id', empresaId)
    .eq('active', true)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []).map((row) => mapTrigger(row as TriggerRow));
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
