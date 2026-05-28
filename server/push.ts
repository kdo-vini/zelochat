// Web Push (RFC 8030) — subscriptions per empresa + send hook.
//
// VAPID keys come from env (generate locally with `npx web-push generate-vapid-keys`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:contato@…)
// If any is missing, the module degrades gracefully: routes still respond but
// send becomes a no-op so the rest of the app keeps working.

import { Router, type Request, type Response } from 'express';
import webPush from 'web-push';
import { getServiceSupabase, requireEmpresaId } from './supabase.js';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contato@zelopdv.com.br';

let vapidReady = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  try {
    webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
    vapidReady = true;
  } catch (err) {
    console.warn('[push] VAPID setup failed — push disabled:', err);
  }
} else {
  console.warn('[push] VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY not set — push disabled');
}

export const pushRouter = Router();

pushRouter.get('/api/push/vapid-public-key', (_req, res: Response) => {
  if (!vapidReady) { res.json({ enabled: false }); return; }
  res.json({ enabled: true, key: VAPID_PUBLIC_KEY });
});

pushRouter.post('/api/push/subscribe', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { endpoint, keys, userAgent } = (req.body || {}) as {
      endpoint?: string;
      keys?: { p256dh?: string; auth?: string };
      userAgent?: string;
    };
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: 'invalid_subscription' });
      return;
    }
    const supabase = getServiceSupabase();
    const { error } = await supabase
      .from('zelochat_push_subscriptions')
      .upsert(
        {
          empresa_id: empresaId,
          endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          user_agent: userAgent || null,
          updated_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'empresa_id,endpoint' },
      );
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      res.status(401).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
  }
});

pushRouter.post('/api/push/unsubscribe', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { endpoint } = (req.body || {}) as { endpoint?: string };
    if (!endpoint) { res.status(400).json({ error: 'invalid_endpoint' }); return; }
    const supabase = getServiceSupabase();
    await supabase
      .from('zelochat_push_subscriptions')
      .delete()
      .eq('empresa_id', empresaId)
      .eq('endpoint', endpoint);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      res.status(401).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: err instanceof Error ? err.message : 'unknown' });
  }
});

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  sessionId?: string;
  tag?: string;
};

/**
 * Sends a push notification to every subscribed browser of an empresa.
 * On a 404/410 from the push service, the subscription is stale → delete it.
 * Failures never throw — push is best-effort.
 */
export async function sendPushToEmpresa(empresaId: string, payload: PushPayload): Promise<void> {
  if (!vapidReady) return;
  try {
    const supabase = getServiceSupabase();
    const { data, error } = await supabase
      .from('zelochat_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('empresa_id', empresaId);
    if (error) { console.warn('[push] fetch subs failed', error); return; }
    if (!data || data.length === 0) return;

    const json = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      sessionId: payload.sessionId || null,
      tag: payload.tag || `zelochat-${payload.sessionId || 'msg'}`,
    });

    const staleIds: string[] = [];
    await Promise.all(
      data.map(async (sub) => {
        try {
          await webPush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            json,
            { TTL: 60 },
          );
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) {
            staleIds.push(sub.id);
          } else {
            console.warn('[push] send failed', status, err);
          }
        }
      }),
    );

    if (staleIds.length > 0) {
      await supabase.from('zelochat_push_subscriptions').delete().in('id', staleIds);
    }
  } catch (err) {
    console.warn('[push] sendPushToEmpresa error', err);
  }
}
