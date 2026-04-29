import { useCallback, useEffect, useRef, useState } from 'react';

const UNLOCK_KEY = 'zelochat_sound_unlocked';
const MUTE_KEY = 'zelochat_sound_muted';
const ALERT_THROTTLE_MS = 3000;

export type SoundKind = 'bubble' | 'alert';

const SOUND_PATHS: Record<SoundKind, string> = {
  bubble: '/sounds/bubble.mp3',
  alert: '/sounds/alert.mp3',
};

function readBool(key: string, defaultValue: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return defaultValue;
    return raw === '1' || raw === 'true';
  } catch {
    return defaultValue;
  }
}

function writeBool(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // localStorage may be unavailable (private mode) — silently degrade
  }
}

/**
 * Plays a short sound for normal vs. urgent message events. Browsers block
 * `Audio.play()` until the user has interacted with the page at least once
 * (autoplay policy), so we expose `unlock()` for a CTA the user clicks. After
 * the first successful unlock the flag persists in localStorage so subsequent
 * sessions don't need re-unlocking unless the user clears storage.
 */
export function useNotificationSound() {
  const [unlocked, setUnlocked] = useState<boolean>(() => readBool(UNLOCK_KEY, false));
  const [muted, setMutedState] = useState<boolean>(() => readBool(MUTE_KEY, false));
  const audioRefs = useRef<Partial<Record<SoundKind, HTMLAudioElement>>>({});
  const lastAlertAtRef = useRef<number>(0);
  // P1.39 — antes UM único play() falhando flipava unlocked=false e mostrava
  // o banner novamente. Falhas transitórias (ex: garbage collection do audio
  // element, throttling momentâneo) faziam o banner aparecer de novo
  // erroneamente. Agora exigimos N consecutivas falhas pra considerar que o
  // unlock realmente expirou.
  const consecutiveFailRef = useRef<number>(0);
  const PLAY_FAIL_THRESHOLD = 3;

  // Lazy-instantiate one Audio element per kind. They're tiny (a few KB) and
  // reused for every play() call — recreating per-event would re-fetch the file.
  const getAudio = useCallback((kind: SoundKind): HTMLAudioElement => {
    let el = audioRefs.current[kind];
    if (!el) {
      el = new Audio(SOUND_PATHS[kind]);
      el.preload = 'auto';
      el.volume = kind === 'alert' ? 0.9 : 0.6;
      audioRefs.current[kind] = el;
    }
    return el;
  }, []);

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    writeBool(MUTE_KEY, next);
  }, []);

  const unlock = useCallback(async (): Promise<boolean> => {
    // Trigger a silent play+pause on each Audio element while we still have a
    // user-gesture stack frame — that satisfies the browser's autoplay policy
    // for subsequent programmatic plays.
    const probes: Promise<unknown>[] = [];
    (Object.keys(SOUND_PATHS) as SoundKind[]).forEach((kind) => {
      const el = getAudio(kind);
      el.muted = true;
      probes.push(
        el
          .play()
          .then(() => {
            el.pause();
            el.currentTime = 0;
            el.muted = false;
          })
          .catch(() => {
            el.muted = false;
          }),
      );
    });
    await Promise.allSettled(probes);
    setUnlocked(true);
    writeBool(UNLOCK_KEY, true);
    return true;
  }, [getAudio]);

  const play = useCallback(
    (kind: SoundKind): void => {
      if (muted || !unlocked) return;
      if (kind === 'alert') {
        const now = Date.now();
        if (now - lastAlertAtRef.current < ALERT_THROTTLE_MS) return;
        lastAlertAtRef.current = now;
      }
      const el = getAudio(kind);
      try {
        el.currentTime = 0;
        void el.play().then(() => {
          // P1.39 — sucesso reseta o contador de falhas
          consecutiveFailRef.current = 0;
        }).catch(() => {
          // Autoplay can still fail (e.g. user revoked, GC do audio element,
          // throttling). Só flipamos unlocked=false após N consecutivas pra
          // não mostrar o banner em hiccups transitórios.
          consecutiveFailRef.current += 1;
          if (consecutiveFailRef.current >= PLAY_FAIL_THRESHOLD) {
            setUnlocked(false);
            writeBool(UNLOCK_KEY, false);
            consecutiveFailRef.current = 0;
          }
        });
      } catch {
        /* ignore */
      }
    },
    [muted, unlocked, getAudio],
  );

  return { unlocked, muted, setMuted, unlock, play };
}
