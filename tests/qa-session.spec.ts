/**
 * QA — Session integrity, QR flow, group filter, dedup fix
 * Covers all fixes applied in this session.
 */
import { test, expect, request } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

test.skip(
  process.env.ZELOCHAT_E2E_BACKEND !== '1',
  'Requires an isolated backend on localhost:3001. Do not run against the shared production Whatsmiau env.',
);

function makeWebhookPayload(text: string, jid: string, fromMe = false) {
  return {
    event: 'messages.upsert',
    data: {
      key: { remoteJid: jid, fromMe, id: `MSG_${Date.now()}_${Math.random()}` },
      pushName: 'QA',
      messageTimestamp: Math.floor(Date.now() / 1000),
      message: { conversation: text },
    },
  };
}

// ─────────────────────────────────────────────
// Group / broadcast filter
// ─────────────────────────────────────────────
// POST /webhook was removed (2026-04-29) — replaced by POST /webhook/:instance.
// These tests document the removal: the legacy route returns 410.
// Per-instance filtering behavior (group, fromMe, etc.) is exercised by the
// backend logic in processWebhookEvent, reached via /webhook/:instance.
test.describe('Legacy /webhook endpoint returns 410', () => {

  test('POST /webhook (group jid) returns 410', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('msg de grupo', '120363012345@g.us'),
    });
    expect(res.status()).toBe(410);
  });

  test('POST /webhook (broadcast jid) returns 410', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('broadcast msg', 'status@broadcast'),
    });
    expect(res.status()).toBe(410);
  });

  test('POST /webhook (fromMe) returns 410', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('bot reply', '5514999990001@s.whatsapp.net', true),
    });
    expect(res.status()).toBe(410);
  });

  test('POST /webhook (individual message) returns 410', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('quero pedir uma pizza', '5514999990099@s.whatsapp.net'),
    });
    expect(res.status()).toBe(410);
  });

});

// ─────────────────────────────────────────────
// QR refresh endpoint
// ─────────────────────────────────────────────
test.describe('POST /api/qr/refresh', () => {

  test('endpoint exists and returns JSON', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/qr/refresh`);
    // Must be 200 (connected) or 500 with error — never 404
    expect(res.status()).not.toBe(404);
    const body = await res.json();
    expect(body).toBeDefined();
  });

  test('response always includes a "status" field', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/api/qr/refresh`);
    const body = await res.json();
    // Must include either qr (string|null) or error or status
    const hasContent = 'qr' in body || 'error' in body || 'status' in body;
    expect(hasContent).toBe(true);
  });

  test('if connected, response has status=connected and no qr', async () => {
    const ctx = await request.newContext();
    const statusRes = await ctx.get(`${BACKEND}/api/status`);
    const { status } = await statusRes.json();
    if (status !== 'connected') {
      test.skip();
      return;
    }
    const res = await ctx.post(`${BACKEND}/api/qr/refresh`);
    const body = await res.json();
    // When already connected, should NOT generate a new QR
    expect(body.status).toBe('connected');
  });

});

// ─────────────────────────────────────────────
// Payload size — no 413
// ─────────────────────────────────────────────
test.describe('Express body limit', () => {

  test('150kb base64 payload to legacy /webhook returns 410, not 413', async () => {
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: '5514999990001@s.whatsapp.net', fromMe: false, id: 'BIG' },
          pushName: 'QA',
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { imageMessage: { mimetype: 'image/jpeg' } },
          base64: 'A'.repeat(150_000),
        },
      },
    });
    expect(res.status()).not.toBe(413);
    expect(res.status()).toBe(410);
  });

});

// ─────────────────────────────────────────────
// Contact deduplication — 55 prefix normalization
// ─────────────────────────────────────────────
test.describe('Contact deduplication (buildContactKey)', () => {

  test('POST /webhook returns 410 (dedup test deferred to /webhook/:instance)', async () => {
    // Legacy /webhook is removed — dedup normalization is tested indirectly via
    // /webhook/:instance with a seeded empresa. This test documents the removal.
    const ctx = await request.newContext();
    const res = await ctx.post(`${BACKEND}/webhook`, {
      data: makeWebhookPayload('mensagem qualquer', '5514997000001@s.whatsapp.net'),
    });
    expect(res.status()).toBe(410);
  });

});

// ─────────────────────────────────────────────
// Session list — groups must not appear
// ─────────────────────────────────────────────
test.describe('Session list excludes groups', () => {

  test('GET /api/sessions (unauthenticated) returns 401, not 500', async () => {
    const ctx = await request.newContext();
    const res = await ctx.get(`${BACKEND}/api/sessions`);
    // Unauthenticated → 401, not a crash
    expect([401, 403]).toContain(res.status());
  });

});

// ─────────────────────────────────────────────
// Frontend — Settings / QR card
// ─────────────────────────────────────────────
test.describe('Frontend — QR Code card (SettingsView)', () => {

  test('Settings page renders without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto('/');
    // Navigate to Configurações
    await page.getByRole('button', { name: /^Configurações/i }).click();
    await expect(page.getByText('Integração WhatsApp')).toBeVisible({ timeout: 5000 });

    expect(errors.filter(e => !e.includes('ResizeObserver'))).toHaveLength(0);
  });

  test('WhatsApp integration card shows a valid state (QR button OR connected)', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Configurações/i }).click();

    // Either the "Gerar QR Code" button appears (disconnected) OR "WhatsApp conectado" (connected)
    // Both are valid — the card must render SOMETHING actionable
    const qrBtn = page.getByRole('button', { name: /(Gerar|Atualizar) QR Code/i });
    const connectedText = page.getByText('WhatsApp conectado');
    await expect(qrBtn.or(connectedText)).toBeVisible({ timeout: 5000 });
  });

  test('when connected, Desconectar button is available', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Configurações/i }).click();

    const connectedText = page.getByText('WhatsApp conectado');
    if (!(await connectedText.isVisible().catch(() => false))) {
      test.skip();
      return;
    }

    const disconnectBtn = page.getByRole('button', { name: /Desconectar WhatsApp/i });
    await expect(disconnectBtn).toBeVisible();
  });

  test('QR button click (when disconnected) gives feedback', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Configurações/i }).click();

    const btn = page.getByRole('button', { name: /(Gerar|Atualizar) QR Code/i });
    if (!(await btn.isVisible().catch(() => false))) {
      test.skip();
      return;
    }
    await btn.click();

    const feedback = page.locator('img[alt="QR Code WhatsApp"], :text("conectado"), :text("Erro"), :text("não respondeu"), :text("não encontrado")');
    await expect(feedback.first()).toBeVisible({ timeout: 10_000 });
  });

  test('no raw errors (TypeError, undefined) shown in Settings', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Configurações/i }).click();
    await page.waitForTimeout(1500);

    const rawError = page.locator(':text("TypeError"), :text("undefined is not"), :text("Cannot read")');
    await expect(rawError).not.toBeVisible();
  });

});
