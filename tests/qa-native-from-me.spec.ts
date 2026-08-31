import { expect, request, test } from '@playwright/test';

const backend = process.env.ZELOCHAT_E2E_BACKEND_URL ?? 'http://localhost:3001';
const instance = process.env.ZELOCHAT_E2E_INSTANCE;
const webhookToken = process.env.ZELOCHAT_E2E_WEBHOOK_TOKEN;
const bearer = process.env.ZELOCHAT_E2E_BEARER_TOKEN;
const jidTemplate = process.env.ZELOCHAT_E2E_JID;
const enabled = process.env.ZELOCHAT_E2E_BACKEND === '1'
  && Boolean(instance && webhookToken && bearer && jidTemplate);

test.skip(!enabled, 'Requer backend/banco isolados, instância e token estável de E2E.');

test('fromMe novo muda causalmente IA para Manual, persiste mensagem/job e não escala', async ({}, testInfo) => {
  const api = await request.newContext({ baseURL: backend });
  const authenticated = await request.newContext({
    baseURL: backend,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
  const digits = jidTemplate!.split('@')[0].replace(/\D/g, '');
  const suffix = `${Date.now()}${testInfo.workerIndex}`.slice(-6);
  const jid = `${digits.slice(0, Math.max(0, digits.length - 6))}${suffix}@s.whatsapp.net`;
  const seedId = `INBOUND_NATIVE_E2E_${Date.now()}_${testInfo.workerIndex}`;
  const id = `NATIVE_E2E_${Date.now()}_${testInfo.workerIndex}`;
  try {
    const seed = await api.post(`/webhook/${encodeURIComponent(instance!)}?token=${encodeURIComponent(webhookToken!)}`, {
      data: {
        event: 'messages.upsert',
        data: {
          key: { remoteJid: jid, fromMe: false, id: seedId },
          pushName: 'Cliente E2E',
          messageTimestamp: Math.floor(Date.now() / 1000),
          message: { conversation: `Preparação ${seedId}` },
        },
      },
    });
    expect(seed.status()).toBe(200);
    await expect.poll(async () => (await authenticated.get(`/api/sessions/${encodeURIComponent(jid)}`)).status()).toBe(200);
    const prepareAi = await authenticated.post(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`, { data: { enabled: true } });
    expect(prepareAi.ok()).toBe(true);
    await expect.poll(async () => {
      const response = await authenticated.get(`/api/sessions/${encodeURIComponent(jid)}`);
      return response.ok() ? (await response.json()).session?.autoReply : null;
    }).toBe(true);
    const before = (await (await authenticated.get(`/api/sessions/${encodeURIComponent(jid)}`)).json()).session;
    expect(before.autoReply).toBe(true);
    const beforeMessageIds = new Set((before.messages ?? []).map((message: any) => message.id));
    const beforeJobIds = new Set((before.messages ?? []).map((message: any) => message.outboundJobId).filter(Boolean));

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

    await expect.poll(async () => {
      const response = await authenticated.get(`/api/sessions/${encodeURIComponent(jid)}`);
      if (!response.ok()) return null;
      const session = (await response.json()).session;
      const message = (session.messages ?? []).find((item: any) => item.waMessageId === id);
      return {
        autoReply: session.autoReply,
        status: session.status,
        escalatedAt: session.escalatedAt ?? null,
        messageId: message?.id ?? null,
        jobId: message?.outboundJobId ?? null,
        origin: message?.outboundOrigin ?? null,
      };
    }).toMatchObject({ autoReply: false, status: 'active', escalatedAt: null, origin: 'human_native_whatsapp' });
    const after = (await (await authenticated.get(`/api/sessions/${encodeURIComponent(jid)}`)).json()).session;
    const nativeMessage = (after.messages ?? []).find((item: any) => item.waMessageId === id);
    expect(nativeMessage?.id).toBeTruthy();
    expect(nativeMessage?.outboundJobId).toBeTruthy();
    expect(beforeMessageIds.has(nativeMessage.id)).toBe(false);
    expect(beforeJobIds.has(nativeMessage.outboundJobId)).toBe(false);
  } finally {
    await authenticated.delete(`/api/sessions/${encodeURIComponent(jid)}`).catch(() => undefined);
    await api.dispose();
    await authenticated.dispose();
  }
});
