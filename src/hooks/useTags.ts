import { useCallback, useEffect, useState } from 'react';
import type { Tag } from '../types';
import {
  listTags,
  createTag as createTagRequest,
  updateTag as updateTagRequest,
  deleteTag as deleteTagRequest,
  applyTagToSession as applyTagRequest,
  removeTagFromSession as removeTagRequest,
} from '../services/waApi';

export function useTags(token: string | null, options: { enabled?: boolean } = {}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = options.enabled ?? true;

  const refresh = useCallback(async () => {
    if (!token) { setTags([]); return; }
    setLoading(true);
    setError(null);
    try {
      const next = await listTags(token);
      setTags(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar as tags.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
  }, [enabled, refresh]);

  const createTag = useCallback(async (data: { name: string; color: string; aiInstructions: string | null }) => {
    if (!token) throw new Error('Faça login para criar tags.');
    const tag = await createTagRequest(token, data);
    setTags((prev) => [...prev, tag]);
    return tag;
  }, [token]);

  const updateTag = useCallback(async (
    tagId: string,
    patch: Partial<{ name: string; color: string; aiInstructions: string | null }>,
  ) => {
    if (!token) throw new Error('Faça login para editar tags.');
    const tag = await updateTagRequest(token, tagId, patch);
    setTags((prev) => prev.map((t) => (t.id === tagId ? tag : t)));
    return tag;
  }, [token]);

  const deleteTag = useCallback(async (tagId: string) => {
    if (!token) throw new Error('Faça login para remover tags.');
    await deleteTagRequest(token, tagId);
    setTags((prev) => prev.filter((t) => t.id !== tagId));
  }, [token]);

  return { tags, loading, error, refresh, createTag, updateTag, deleteTag };
}

export function useSessionTags(
  token: string | null,
  sessionId: string | null,
  allTags: Tag[],
) {
  const [sessionTagIds, setSessionTagIds] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  const sessionTags = allTags.filter((t) => sessionTagIds.has(t.id));

  const loadSessionTags = useCallback(async () => {
    if (!token || !sessionId) { setSessionTagIds(new Set()); return; }
    // tags come embedded on the session object from the sessions list;
    // here we sync from that list if available, otherwise fetch
    try {
      const response = await fetch(
        `/api/sessions/${encodeURIComponent(sessionId)}/tags`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) return;
      const body = await response.json() as { tags: Tag[] };
      setSessionTagIds(new Set(body.tags.map((t) => t.id)));
    } catch { /* ignore */ }
  }, [token, sessionId]);

  useEffect(() => {
    void loadSessionTags();
  }, [loadSessionTags]);

  const applyTag = useCallback(async (tagId: string) => {
    if (!token || !sessionId) return;
    setApplying(true);
    try {
      await applyTagRequest(token, sessionId, tagId);
      setSessionTagIds((prev) => new Set([...prev, tagId]));
    } finally {
      setApplying(false);
    }
  }, [token, sessionId]);

  const removeTag = useCallback(async (tagId: string) => {
    if (!token || !sessionId) return;
    setApplying(true);
    try {
      await removeTagRequest(token, sessionId, tagId);
      setSessionTagIds((prev) => { const next = new Set(prev); next.delete(tagId); return next; });
    } finally {
      setApplying(false);
    }
  }, [token, sessionId]);

  const initFromSession = useCallback((tags: Tag[]) => {
    setSessionTagIds(new Set(tags.map((t) => t.id)));
  }, []);

  return { sessionTags, sessionTagIds, applying, applyTag, removeTag, initFromSession, reload: loadSessionTags };
}
