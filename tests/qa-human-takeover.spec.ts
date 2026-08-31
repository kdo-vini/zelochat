import { expect, request, test } from '@playwright/test';

const backend = process.env.ZELOCHAT_E2E_BACKEND_URL ?? 'http://localhost:3001';
const bearer = process.env.ZELOCHAT_E2E_BEARER_TOKEN;
const jid = process.env.ZELOCHAT_E2E_JID;
const enabled = process.env.ZELOCHAT_E2E_BACKEND === '1' && Boolean(bearer && jid);

test.skip(!enabled, 'Requer backend/banco isolados e credenciais explícitas de E2E.');

test('composer assume Manual, falha permanece Manual e retomada explícita volta para IA', async () => {
  const api = await request.newContext({
    baseURL: backend,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
  const key = `e2e-human-${Date.now()}`;
  const send = await api.post('/api/send', {
    headers: { 'Idempotency-Key': key },
    data: { to: jid, message: `Takeover E2E ${key}` },
  });
  expect([200, 202, 409, 500]).toContain(send.status());

  await expect.poll(async () => {
    const response = await api.get(`/api/sessions/${encodeURIComponent(jid!)}`);
    if (!response.ok()) return null;
    return (await response.json()).session?.conversationMode;
  }).toBe('human');

  const resume = await api.post(`/api/sessions/${encodeURIComponent(jid!)}/auto-reply`, {
    data: { enabled: true },
  });
  expect(resume.ok()).toBe(true);
  await expect.poll(async () => {
    const response = await api.get(`/api/sessions/${encodeURIComponent(jid!)}`);
    return response.ok() ? (await response.json()).session?.conversationMode : null;
  }).toBe('ai');
  await api.dispose();
});
