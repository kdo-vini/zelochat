import { expect, request, test } from '@playwright/test';

const backend = process.env.ZELOCHAT_E2E_BACKEND_URL ?? 'http://localhost:3001';
const instance = process.env.ZELOCHAT_E2E_INSTANCE;
const webhookToken = process.env.ZELOCHAT_E2E_WEBHOOK_TOKEN;
const bearer = process.env.ZELOCHAT_E2E_BEARER_TOKEN;
const jidTemplate = process.env.ZELOCHAT_E2E_JID;
const enabled = process.env.ZELOCHAT_E2E_BACKEND === '1'
  && Boolean(instance && webhookToken && bearer && jidTemplate);

test.skip(!enabled, 'Requer backend/banco isolados e credenciais explícitas de E2E.');

test('composer muda causalmente IA para Manual e cria mensagem/job novos', async ({}, testInfo) => {
  const api = await request.newContext({
    baseURL: backend,
    extraHTTPHeaders: { Authorization: `Bearer ${bearer}` },
  });
  const digits = jidTemplate!.split('@')[0].replace(/\D/g, '');
  const suffix = `${Date.now()}${testInfo.workerIndex}`.slice(-6);
  const jid = `${digits.slice(0, Math.max(0, digits.length - 6))}${suffix}@s.whatsapp.net`;
  const seedId = `INBOUND_HUMAN_E2E_${Date.now()}_${testInfo.workerIndex}`;
  const key = `e2e-human-${Date.now()}-${testInfo.workerIndex}`;
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
    await expect.poll(async () => (await api.get(`/api/sessions/${encodeURIComponent(jid)}`)).status()).toBe(200);

    const prepareAi = await api.post(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`, { data: { enabled: true } });
    expect(prepareAi.ok()).toBe(true);
    await expect.poll(async () => {
      const response = await api.get(`/api/sessions/${encodeURIComponent(jid)}`);
      if (!response.ok()) return null;
      const session = (await response.json()).session;
      return session?.autoReply === true ? session : null;
    }).not.toBeNull();
    const before = (await (await api.get(`/api/sessions/${encodeURIComponent(jid)}`)).json()).session;
    expect(before.autoReply).toBe(true);
    const beforeMessageIds = new Set((before.messages ?? []).map((message: any) => message.id));
    const beforeJobIds = new Set((before.messages ?? []).map((message: any) => message.outboundJobId).filter(Boolean));

    const send = await api.post('/api/send', {
      headers: { 'Idempotency-Key': key },
      data: { to: jid, message: `Takeover E2E ${key}` },
    });
    expect([200, 202]).toContain(send.status());
    const sent = await send.json();
    expect(sent.messageId).toBeTruthy();
    expect(sent.jobId).toBeTruthy();
    expect(beforeMessageIds.has(sent.messageId)).toBe(false);
    expect(beforeJobIds.has(sent.jobId)).toBe(false);

    await expect.poll(async () => {
      const response = await api.get(`/api/sessions/${encodeURIComponent(jid)}`);
      if (!response.ok()) return null;
      const session = (await response.json()).session;
      const message = (session.messages ?? []).find((item: any) => item.id === sent.messageId);
      return { autoReply: session.autoReply, messageJobId: message?.outboundJobId ?? null };
    }).toEqual({ autoReply: false, messageJobId: sent.jobId });

    const resume = await api.post(`/api/sessions/${encodeURIComponent(jid)}/auto-reply`, { data: { enabled: true } });
    expect(resume.ok()).toBe(true);
    await expect.poll(async () => {
      const response = await api.get(`/api/sessions/${encodeURIComponent(jid)}`);
      return response.ok() ? (await response.json()).session?.autoReply : null;
    }).toBe(true);
  } finally {
    await api.delete(`/api/sessions/${encodeURIComponent(jid)}`).catch(() => undefined);
    await api.dispose();
  }
});
