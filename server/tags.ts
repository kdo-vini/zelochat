import { getServiceSupabase } from './supabase.js';

export interface TagRecord {
  id: string;
  empresaId: string;
  name: string;
  color: string;
  aiInstructions: string | null;
  createdAt: string;
}

type TagRow = {
  id: string;
  empresa_id: string;
  name: string;
  color: string;
  ai_instructions: string | null;
  created_at: string;
};

function mapTag(row: TagRow): TagRecord {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    name: row.name,
    color: row.color,
    aiInstructions: row.ai_instructions,
    createdAt: row.created_at,
  };
}

const SELECT_COLS = 'id, empresa_id, name, color, ai_instructions, created_at';

export class TagTenantMismatchError extends Error {
  constructor() {
    super('Tag não encontrada para esta empresa.');
    this.name = 'TagTenantMismatchError';
  }
}

/**
 * Resolve a session identifier that may be a UUID or a WhatsApp JID into
 * the canonical `zelochat_sessions.id` UUID. The frontend uses
 * `remote_jid` as the canonical session id (see `mapSession` in
 * messageHandler), so the tag routes accept JIDs and resolve here before
 * touching `zelochat_session_tags`, which references the UUID column.
 */
async function resolveSessionUuid(empresaId: string, sessionIdOrJid: string): Promise<string | null> {
  const sb = getServiceSupabase();
  let query = sb
    .from('zelochat_sessions')
    .select('id')
    .eq('empresa_id', empresaId);
  query = sessionIdOrJid.includes('@')
    ? query.eq('remote_jid', sessionIdOrJid)
    : query.eq('id', sessionIdOrJid);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return (data as { id: string } | null)?.id ?? null;
}

async function ensureTagBelongsToEmpresa(empresaId: string, tagId: string): Promise<void> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_tags')
    .select('id')
    .eq('id', tagId)
    .eq('empresa_id', empresaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new TagTenantMismatchError();
}

export async function listTags(empresaId: string): Promise<TagRecord[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_tags')
    .select(SELECT_COLS)
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []).map(mapTag);
}

export async function createTag(
  empresaId: string,
  name: string,
  color: string,
  aiInstructions: string | null,
): Promise<TagRecord> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_tags')
    .insert({ empresa_id: empresaId, name: name.trim(), color, ai_instructions: aiInstructions || null })
    .select(SELECT_COLS)
    .single();
  if (error) throw error;
  return mapTag(data as TagRow);
}

export async function updateTag(
  empresaId: string,
  tagId: string,
  patch: Partial<{ name: string; color: string; aiInstructions: string | null }>,
): Promise<TagRecord | null> {
  const sb = getServiceSupabase();
  const update: Record<string, unknown> = {};
  if (patch.name !== undefined) update.name = patch.name.trim();
  if (patch.color !== undefined) update.color = patch.color;
  if (patch.aiInstructions !== undefined) update.ai_instructions = patch.aiInstructions || null;

  const { data, error } = await sb
    .from('zelochat_tags')
    .update(update)
    .eq('id', tagId)
    .eq('empresa_id', empresaId)
    .select(SELECT_COLS)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    throw error;
  }
  return mapTag(data as TagRow);
}

export async function deleteTag(empresaId: string, tagId: string): Promise<boolean> {
  const sb = getServiceSupabase();
  const { error, count } = await sb
    .from('zelochat_tags')
    .delete({ count: 'exact' })
    .eq('id', tagId)
    .eq('empresa_id', empresaId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function getSessionTagIds(sessionId: string): Promise<string[]> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_session_tags')
    .select('tag_id')
    .eq('session_id', sessionId);
  if (error) throw error;
  return (data ?? []).map((r: { tag_id: string }) => r.tag_id);
}

export async function getSessionTagsFull(empresaId: string, sessionIdOrJid: string): Promise<TagRecord[]> {
  const sessionId = await resolveSessionUuid(empresaId, sessionIdOrJid);
  if (!sessionId) return [];
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_session_tags')
    .select(`zelochat_tags(${SELECT_COLS})`)
    .eq('session_id', sessionId)
    .eq('empresa_id', empresaId);
  if (error) throw error;
  return ((data ?? []) as unknown as { zelochat_tags: TagRow | null }[])
    .map((r) => r.zelochat_tags)
    .filter((t): t is TagRow => t !== null && t.empresa_id === empresaId)
    .map(mapTag);
}

export async function applyTagToSession(
  empresaId: string,
  sessionIdOrJid: string,
  tagId: string,
): Promise<void> {
  const sessionId = await resolveSessionUuid(empresaId, sessionIdOrJid);
  if (!sessionId) throw new Error('Sessão não encontrada para aplicar tag.');
  await ensureTagBelongsToEmpresa(empresaId, tagId);
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('zelochat_session_tags')
    .upsert({ session_id: sessionId, tag_id: tagId, empresa_id: empresaId }, { onConflict: 'session_id,tag_id' });
  if (error) throw error;
}

export async function removeTagFromSession(
  empresaId: string,
  sessionIdOrJid: string,
  tagId: string,
): Promise<void> {
  const sessionId = await resolveSessionUuid(empresaId, sessionIdOrJid);
  if (!sessionId) return;
  await ensureTagBelongsToEmpresa(empresaId, tagId);
  const sb = getServiceSupabase();
  const { error } = await sb
    .from('zelochat_session_tags')
    .delete()
    .eq('session_id', sessionId)
    .eq('tag_id', tagId)
    .eq('empresa_id', empresaId);
  if (error) throw error;
}

export async function getAllSessionTagsForEmpresa(
  empresaId: string,
): Promise<Map<string, TagRecord[]>> {
  const sb = getServiceSupabase();
  // Join with zelochat_sessions so we can key the resulting map by the JID
  // (`remote_jid`), which is what the frontend uses as `ChatSession.id`.
  const { data, error } = await sb
    .from('zelochat_session_tags')
    .select(`zelochat_tags(${SELECT_COLS}), zelochat_sessions!inner(remote_jid)`)
    .eq('empresa_id', empresaId);
  if (error) throw error;

  const map = new Map<string, TagRecord[]>();
  for (const row of (data ?? []) as unknown as { zelochat_tags: TagRow | null; zelochat_sessions: { remote_jid: string } | null }[]) {
    if (!row.zelochat_tags || row.zelochat_tags.empresa_id !== empresaId || !row.zelochat_sessions?.remote_jid) continue;
    const jid = row.zelochat_sessions.remote_jid;
    const existing = map.get(jid) ?? [];
    existing.push(mapTag(row.zelochat_tags));
    map.set(jid, existing);
  }
  return map;
}

export async function getTagsForSessions(
  empresaId: string,
  sessionIds: string[],
): Promise<Map<string, TagRecord[]>> {
  if (sessionIds.length === 0) return new Map();
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from('zelochat_session_tags')
    .select(`session_id, zelochat_tags(${SELECT_COLS})`)
    .eq('empresa_id', empresaId)
    .in('session_id', sessionIds);
  if (error) throw error;

  const map = new Map<string, TagRecord[]>();
  for (const row of (data ?? []) as unknown as { session_id: string; zelochat_tags: TagRow | null }[]) {
    if (!row.zelochat_tags || row.zelochat_tags.empresa_id !== empresaId) continue;
    const existing = map.get(row.session_id) ?? [];
    existing.push(mapTag(row.zelochat_tags));
    map.set(row.session_id, existing);
  }
  return map;
}
