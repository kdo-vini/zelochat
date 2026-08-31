import { expect, request, test } from '@playwright/test';

const backend = process.env.ZELOCHAT_E2E_BACKEND_URL ?? 'http://localhost:3001';
const instance = process.env.ZELOCHAT_E2E_INSTANCE;
const webhookToken = process.env.ZELOCHAT_E2E_WEBHOOK_TOKEN;
const bearer = process.env.ZELOCHAT_E2E_BEARER_TOKEN;
const jid = process.env.ZELOCHAT_E2E_JID;
const enabled = process.env.ZELOCHAT_E2E_BACKEND === '1'
  && Boolean(instance && webhookToken && bearer && jid);

test.skip(!enabled, 'Requer backend/banco isolados, instância e token estável de E2E.');

test('fromMe autenticado no endpoint por instância assume Manual sem escalar', async () => {
  const api = await request.newContext({ baseURL: backend });
  const id = `NATIVE_E2E_${Date.now()}`;
  const webhook = await api.post(`/webhook/${encodeURIComponent(instance!)}?token=${encodeURIComponent(webhookToken!)}`, {
    data: {
      event: 'messages.upsert',
      data: {
        key: { remoteJid: jid, fromMe: true, id },
        pushName: 'Operador E2E',
        messageTimestamp: Math.floor(Date.now() / 1000),
        message: { conversation: `Mensagem nativa ${id}` },
      },
    },
  });
  expect(webhook.status()).toBe(200);

  const authenticated = await request.newContext({
    baseURL: backend,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
  await expect.poll(async () => {
    const response = await authenticated.get(`/api/sessions/${encodeURIComponent(jid!)}`);
    if (!response.ok()) return null;
    const session = (await response.json()).session;
    return { mode: session?.conversationMode, status: session?.status };
  }).toEqual({ mode: 'human', status: 'active' });
  await api.dispose();
  await authenticated.dispose();
});
