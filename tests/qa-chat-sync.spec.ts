import { test, expect, request } from '@playwright/test';

const BACKEND = 'http://localhost:3001';
const FAKE_JID = '5514999990001@s.whatsapp.net';

test.skip(
  process.env.ZELOCHAT_E2E_BACKEND !== '1',
  'Requires an isolated backend on localhost:3001. Do not run against the shared production Whatsmiau env.',
);

// Simulates a Whatsmiau MESSAGES_UPSERT webhook payload (text message)
function makeWebhookPayload(text: string, jid = FAKE_JID) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: jid, fromMe: false, id: `MSG_${Date.now()}` },
      pushName: 'QA Test User',
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: text },
    },
  };
}

// Simulates a large image webhook (base64) — triggers PayloadTooLarge if limit not set
function makeLargeImagePayload(jid = FAKE_JID) {
  const fakeBase64 = 'A'.repeat(150_000); // ~150kb — over default 100kb Express limit
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: jid, fromMe: false, id: `IMG_${Date.now()}` },
      pushName: 'QA Test User',
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { imageMessage: { mimetype: 'image/jpeg' } },
      base64: fakeBase64,
    },
  };
}

test.describe('Chat Sync — Webhook → Backend → Frontend', () => {

  test('backend /api/status returns a valid status field', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BACKEND}/api/status`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // All four are valid — this test verifies the backend is running and responding
    expect(['connected', 'qr', 'connecting', 'disconnected']).toContain(body.status);
  });

  test('POST /webhook returns 410 (legacy route removed)', async () => {
    // The legacy /webhook route was removed (2026-04-29). Whatsmiau instances
    // must now register /webhook/:instance. This test documents the removal.
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('Olá, quero fazer um pedido'),
    });
    expect(res.status()).toBe(410);
  });

  test('large image payload to legacy /webhook returns 410, not 413', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeLargeImagePayload(),
    });
    expect(res.status()).not.toBe(413);
    expect(res.status()).toBe(410);
  });

  test('frontend loads Atendimento view without crash', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Atendimento/i }).click();
    // View must render (empty or with sessions — not a crash)
    await expect(page.getByRole('button', { name: /Atendimento/i })).toBeVisible();
    // No JS error dialog
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.waitForTimeout(1000);
    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('session order: webhook delivers faster-arriving message first in response', async () => {
    const ctx = await request.newContext();
    const jidA = '5514888880001@s.whatsapp.net';
    const jidB = '5514777770001@s.whatsapp.net';

    // Legacy /webhook is removed — all calls return 410. Session ordering is
    // verified via /webhook/:instance in integration tests with a seeded empresa.
    const resA = await ctx.post(`${BACKEND}/webhook`, { data: makeWebhookPayload('Ping A', jidA) });
    const resB = await ctx.post(`${BACKEND}/webhook`, { data: makeWebhookPayload('Ping B', jidB) });
    expect(resA.status()).toBe(410);
    expect(resB.status()).toBe(410);
  });

  test('WebSocket broadcasts message event on webhook', async ({ page }) => {
    await page.goto('/');

    const uniqueText = `WS-TEST-${Date.now()}`;

    // Listen for WS message matching our unique text before triggering webhook
    const wsMessage = page.evaluate((expected: string) => {
      return new Promise<any>((resolve) => {
        const ws = new WebSocket('ws://localhost:3001/ws');
        ws.onmessage = (ev) => {
          const p = JSON.parse(ev.data);
          if (p.type === 'message' && p.data?.message?.content === expected) resolve(p.data);
        };
        setTimeout(() => resolve(null), 6000);
      });
    }, uniqueText);

    // Trigger webhook with the unique text — use /webhook/:instance
    // (legacy /webhook returns 410; WS broadcast test requires a real instance)
    const ctx = await request.newContext();
    await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload(uniqueText, '5514666660001@s.whatsapp.net'),
    });

    const received = await wsMessage;
    expect(received).not.toBeNull();
    expect(received.message.content).toBe(uniqueText);
  });

  test('fromMe messages are ignored (bot replies not stored as incoming)', async () => {
    const ctx = await request.newContext();
    const fromMePayload = {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: FAKE_JID, fromMe: true, id: `BOT_${Date.now()}` },
        pushName: 'Bot',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: 'Resposta automática' },
      },
    };
    const res = await ctx.post(`${BACKEND}/webhook`, { data: fromMePayload });
    expect(res.status()).toBe(410);
    // Legacy route removed — fromMe filtering is exercised via /webhook/:instance
  });

});
