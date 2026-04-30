import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from 'react';

/**
 * Persists an unsaved form draft to localStorage (debounced).
 * When the user returns after a session expiry, the draft is automatically
 * restored so they don't lose in-progress edits.
 *
 * Usage:
 *   const { draft, setDraft, clearDraft, hasStoredDraft } = useLocalDraft('business', serverValue);
 *   // After successful save:
 *   clearDraft();
 */
export function useLocalDraft<T>(
  key: string,
  serverValue: T,
  debounceMs = 400,
): {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  clearDraft: () => void;
  isDirtyVsServer: boolean;
  hasStoredDraft: boolean;
} {
  const storageKey = `zelochat:draft:${key}`;

  const readStored = useCallback((): T | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }, [storageKey]);

  // Initialise from localStorage if a draft was saved, otherwise from serverValue.
  const [draft, setDraft] = useState<T>(() => readStored() ?? serverValue);
  // Capture at mount-time so the toast fires only once per page load.
  const [hasStoredDraft] = useState<boolean>(() => readStored() !== null);

  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  // When serverValue arrives from Supabase after mount, sync the draft ONLY if
  // there is no locally-stored version — do not overwrite in-progress user edits.
  const serverJson = JSON.stringify(serverValue);
  useEffect(() => {
    if (!readStored()) {
      setDraft(serverValue);
    }
    // We intentionally depend on the serialized value, not the object reference,
    // so structural changes trigger the sync while reference churn does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverJson, readStored]);

  // Debounced persistence: write when dirty, remove when back to server state.
  const draftJson = JSON.stringify(draft);
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (draftJson !== serverJson) {
        localStorage.setItem(storageKey, draftJson);
      } else {
        localStorage.removeItem(storageKey);
      }
    }, debounceMs);
    return () => clearTimeout(timerRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftJson, serverJson, storageKey, debounceMs]);

  const clearDraft = useCallback(() => {
    clearTimeout(timerRef.current);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const isDirtyVsServer = draftJson !== serverJson;

  return { draft, setDraft, clearDraft, isDirtyVsServer, hasStoredDraft };
}
