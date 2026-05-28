// Web Push subscription helpers.
// Talks to /api/push/* on the backend (see server/push.ts).

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || '';
const apiUrl = (path: string) => `${API_BASE}${path}`;

export type PushStatus =
  | 'unsupported'        // browser has no Push API / SW
  | 'disabled-server'    // backend VAPID not configured
  | 'denied'             // user blocked notifications
  | 'default'            // user hasn't been asked yet
  | 'subscribed';        // active subscription exists

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg;
  } catch {
    return null;
  }
}

export async function getPushStatus(token: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const vapid = await fetchVapidPublicKey(token);
  if (!vapid) return 'disabled-server';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) return 'subscribed';
  return Notification.permission === 'default' ? 'default' : 'default';
}

async function fetchVapidPublicKey(token: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl('/api/push/vapid-public-key'), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as { enabled?: boolean; key?: string };
    return data.enabled && data.key ? data.key : null;
  } catch {
    return null;
  }
}

export async function subscribeToPush(token: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  const vapid = await fetchVapidPublicKey(token);
  if (!vapid) return 'disabled-server';

  const permission = await Notification.requestPermission();
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'default';

  const reg = await getRegistration();
  if (!reg) return 'unsupported';

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });
  }

  const json = sub.toJSON();
  const res = await fetch(apiUrl('/api/push/subscribe'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      endpoint: json.endpoint,
      keys: json.keys,
      userAgent: navigator.userAgent,
    }),
  });
  if (!res.ok) throw new Error(`Subscribe failed: ${res.status}`);
  return 'subscribed';
}

export async function unsubscribeFromPush(token: string): Promise<PushStatus> {
  const reg = await getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    try {
      await fetch(apiUrl('/api/push/unsubscribe'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
    } catch { /* ignore */ }
    await sub.unsubscribe();
  }
  return Notification.permission === 'default' ? 'default' : Notification.permission === 'denied' ? 'denied' : 'default';
}
