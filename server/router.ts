import { Router, Request, Response } from 'express';
import axios from 'axios';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';
import { broadcast } from './ws.js';
import {
  getStatus,
  getQR,
  fetchQR,
  disconnectWhatsApp,
  reconnectWhatsApp,
  sendTextMessage,
  sendMediaMessage,
  sendWhatsAppAudio,
  fetchProfilePicture,
  handleConnectionUpdate,
  dispatchIncomingMessage,
  getOwnJid,
  markWhatsAppMessageAsRead,
  validateWhatsAppNumbers,
  sendListMessage,
  sendLocationMessage,
  sendReaction,
  sendPollMessage,
  revokeMessage,
  syncStatusFromUpstream,
} from './whatsapp.js';
import {
  getAllSessions,
  getSession,
  addAssistantMessage,
  updateSessionProfilePic,
  setAutoReply,
  markSessionAsRead,
  deleteSession,
  updateSessionName,
} from './messageHandler.js';
import { generateAndSendReply, getAI, confirmPendingOrder, cancelPendingOrder, getPendingOrder } from './ai.js';
import { getConfig, setConfig } from './configStore.js';
import { createDriver, deleteDriver, listDrivers, updateDriver } from './drivers.js';
import { createTrigger, deleteTrigger, listTriggers, updateTrigger } from './triggers.js';
import { requireEmpresaId, getBoundEmpresaId, setBoundEmpresaId, uploadMediaForSend, getServiceSupabase } from './supabase.js';
import type { ChatAttachment } from '../src/types.js';

const router = Router();

// JIDs that recently had a button action handled — used to suppress duplicate text events
// that WhatsApp/Whatsmiau sends for the same button click (within 5-second window)
const recentlyHandled = new Map<string, number>();

/**
 * POST /webhook — Receives events from Whatsmiau (Evolution API v2 format).
 * Must respond quickly (200) before processing to avoid webhook timeouts.
 */
router.post('/webhook', (req: Request, res: Response) => {
  res.json({ ok: true });

  const event: string = (req.body?.event ?? '').toLowerCase().replace(/_/g, '.');
  const data = req.body?.data;

  if (!data) return;

  if (event === 'messages.upsert') {
    if (!data.message) return;
    if (data.key?.fromMe) return;
    // Secondary guard: outbound messages wrapped by multi-device protocol
    if (data.message?.deviceSentMessage) return;
    const remoteJid: string = data.key?.remoteJid ?? '';
    if (remoteJid === 'status@broadcast') return;
    if (remoteJid.endsWith('@g.us')) return;   // ignore group messages
    if (remoteJid.endsWith('@broadcast')) return; // ignore broadcast lists
    if (!remoteJid.endsWith('@s.whatsapp.net')) return; // only individual chats
    const botJid = getOwnJid();
    if (botJid && remoteJid === botJid) return;

    const interactiveId = data.message?.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson
      ? JSON.parse(data.message.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson).id
      : '';
    const buttonId: string =
      data.message?.buttonsResponseMessage?.selectedButtonId ??
      data.message?.templateButtonReplyMessage?.selectedId ??
      interactiveId ?? '';
    if (buttonId) {
      const pending = getPendingOrder(remoteJid);
      if (pending) {
        recentlyHandled.set(remoteJid, Date.now()); // mark before async to block duplicate events
        if (buttonId === 'CONFIRM_ORDER') {
          void confirmPendingOrder(remoteJid);
        } else if (buttonId === 'CANCEL_ORDER') {
          void cancelPendingOrder(remoteJid, pending.empresaId);
        }
        return;
      }
    }

    // Also catch button clicks that arrive as plain text (WhatsApp sends the event twice)
    const interactiveText = data.message?.interactiveResponseMessage?.body?.text ?? '';
    const msgText = (
      data.message?.conversation ??
      data.message?.extendedTextMessage?.text ??
      interactiveText
    ).trim();
    const pendingForText = getPendingOrder(remoteJid);
    if (pendingForText && msgText) {
      if (msgText === '✅ Confirmar' || msgText === 'CONFIRM_ORDER') {
        recentlyHandled.set(remoteJid, Date.now());
        void confirmPendingOrder(remoteJid);
        return;
      }
      if (msgText === '❌ Cancelar' || msgText === 'CANCEL_ORDER') {
        recentlyHandled.set(remoteJid, Date.now());
        void cancelPendingOrder(remoteJid, pendingForText.empresaId);
        return;
      }
    }

    // Suppress any further duplicate events within 5 seconds of a button action
    const handledTs = recentlyHandled.get(remoteJid);
    if (handledTs) {
      if (Date.now() - handledTs < 5000) return; // duplicate — skip AI
      recentlyHandled.delete(remoteJid);
    }

    dispatchIncomingMessage(data);
  } else if (event === 'connection.update') {
    handleConnectionUpdate(data);
  } else if (event === 'messages.update') {
    // Delivery / read receipts — broadcast to frontend so it can update message ticks
    const updates = Array.isArray(data) ? data : [data];
    for (const u of updates) {
      if (!u?.keyId && !u?.messageId) continue;
      broadcast({
        type: 'message_status',
        data: {
          messageId: u.keyId ?? u.messageId,
          remoteJid: u.remoteJid,
          status: u.status, // 'DELIVERY_ACK' | 'READ'
        },
      });
    }
  } else if (event === 'messages.delete') {
    const deletions = Array.isArray(data) ? data : [data];
    for (const d of deletions) {
      if (!d?.id) continue;
      broadcast({ type: 'message_deleted', data: { messageId: d.id, remoteJid: d.remoteJid } });
    }
  } else if (event === 'contacts.upsert') {
    const contacts = Array.isArray(data) ? data : [data];
    for (const c of contacts) {
      const remoteJid: string = c?.remoteJid ?? '';
      const pushName: string = c?.pushName ?? '';
      if (remoteJid && pushName) {
        broadcast({ type: 'contact_update', data: { remoteJid, pushName, profilePicUrl: c?.profilePicUrl } });
        
        // Save profile picture to database
        const empresaId = getBoundEmpresaId();
        if (empresaId && c?.profilePicUrl) {
          updateSessionProfilePic(empresaId, remoteJid, c.profilePicUrl).catch(err => {
            console.error('[Webhook] Failed to save profile picture:', err);
          });
        }
      }
    }
  }
});


function sendAuthError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED') {
    res.status(401).json({ error: 'Não autenticado' });
    return;
  }

  if (message === 'EMPRESA_NOT_FOUND') {
    res.status(403).json({ error: 'Empresa não encontrada para este usuário' });
    return;
  }

  res.status(500).json({ error: message });
}

function sendDriverError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND') {
    sendAuthError(res, error);
    return;
  }

  if (message === 'INVALID_DRIVER_PAYLOAD') {
    res.status(400).json({ error: 'Nome e WhatsApp do entregador são obrigatórios.' });
    return;
  }

  if (message === 'INVALID_DRIVER_STATUS') {
    res.status(400).json({ error: 'Status de entregador inválido.' });
    return;
  }

  if (message.includes('zelochat_drivers_empresa_id_phone_key')) {
    res.status(409).json({ error: 'Já existe um entregador com esse WhatsApp nesta empresa.' });
    return;
  }

  res.status(500).json({ error: message });
}

function sendTriggerError(res: Response, error: unknown): void {
  const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

  if (message === 'UNAUTHORIZED' || message === 'EMPRESA_NOT_FOUND') {
    sendAuthError(res, error);
    return;
  }

  if (message === 'INVALID_TRIGGER_PAYLOAD') {
    res.status(400).json({ error: 'Descrição do gatilho não pode ser vazia.' });
    return;
  }

  if (message === 'INVALID_TRIGGER_PARSE') {
    res.status(400).json({ error: 'Não consegui entender esse gatilho. Tente descrever com mais detalhes.' });
    return;
  }

  if (message === 'INVALID_TRIGGER_KIND') {
    res.status(400).json({ error: 'Tipo de gatilho inválido.' });
    return;
  }

  res.status(500).json({ error: message });
}

/**
 * GET /api/status — Returns the current WhatsApp connection status.
 * Pass `?verify=1` to re-query Whatsmiau for ground truth before responding;
 * the frontend uses this after disconnect/connect actions so the UI never
 * sits on a stale in-memory cache.
 */
router.get('/api/status', async (req: Request, res: Response) => {
  if (req.query.verify === '1') {
    const status = await syncStatusFromUpstream();
    res.json({ status });
    return;
  }
  res.json({ status: getStatus() });
});

/**
 * GET /api/qr — Returns the QR code as a base64 data URI.
 */
router.get('/api/qr', (_req: Request, res: Response) => {
  const qr = getQR();
  if (qr) {
    res.json({ qr });
  } else {
    const status = getStatus();
    res.json({ qr: null, status });
  }
});

/**
 * POST /api/whatsapp/disconnect — Logs out from WhatsApp. Requires auth.
 *
 * Awaits the upstream Whatsmiau logout so the device is actually revoked
 * before we respond. Safe to call multiple times (idempotent).
 */
router.post('/api/whatsapp/disconnect', async (req: Request, res: Response) => {
  try {
    await requireEmpresaId(req);
    await disconnectWhatsApp();
    res.json({ ok: true, status: getStatus() });
  } catch (err) {
    if (err instanceof Error && (err.message === 'UNAUTHORIZED' || err.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, err);
      return;
    }
    const msg = err instanceof Error ? err.message : 'Erro ao desconectar.';
    res.status(500).json({ error: msg, status: getStatus() });
  }
});

/**
 * POST /api/qr/refresh — Requests a fresh QR code from Whatsmiau.
 *
 * Also re-arms the connection logic: if the user previously clicked
 * "Desconectar" we need to clear the manually-disconnected flag before
 * fetchQR() will actually do anything.
 */
router.post('/api/qr/refresh', async (_req: Request, res: Response) => {
  try {
    await reconnectWhatsApp();
    await fetchQR();
    const qr = getQR();
    const status = getStatus();
    res.json({ qr, status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: msg, status: getStatus() });
  }
});

/**
 * GET /api/sessions — Returns all active WhatsApp sessions.
 */
router.get('/api/sessions', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const sessions = await getAllSessions(empresaId);
    res.json({ sessions });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/sessions/:jid — Returns a specific session with its messages.
 */
router.get('/api/sessions/:jid', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const session = await getSession(req.params.jid, empresaId);
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json({ session });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/send — Sends a text message to a WhatsApp contact.
 * Body: { to: string (jid), message?: string, attachment?: ChatAttachment }
 */
router.post('/api/send', async (req: Request, res: Response) => {
  const { to, message, attachment } = req.body as {
    to?: string;
    message?: string;
    attachment?: ChatAttachment;
  };

  if (!to || (!message?.trim() && !attachment)) {
    res.status(400).json({ error: 'Missing "to" and message content' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    const trimmedMessage = message?.trim() ?? '';

    if (attachment?.dataUrl) {
      // Whatsmiau only accepts public URLs — upload to Supabase Storage first
      const mediaUrl = await uploadMediaForSend(
        attachment.dataUrl,
        attachment.fileName,
        attachment.mimeType,
      );
      if (attachment.type === 'audio') {
        // Audio PTT uses a dedicated endpoint with different params (no mediatype/caption)
        await sendWhatsAppAudio(to, mediaUrl);
      } else {
        await sendMediaMessage(to, {
          mediatype: attachment.type === 'image' ? 'image' : 'document',
          mimetype: attachment.mimeType,
          media: mediaUrl,
          caption: trimmedMessage || undefined,
          fileName: attachment.fileName,
        });
      }
    } else {
      await sendTextMessage(to, trimmedMessage);
    }

    await addAssistantMessage(to, trimmedMessage, attachment, empresaId);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[Router] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/api/bind-empresa', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    setBoundEmpresaId(empresaId);
    // Hydrate the in-memory kill-switch from the DB so restarts preserve the dono's choice
    try {
      const { data } = await getServiceSupabase()
        .from('empresa_perfil')
        .select('ai_enabled')
        .eq('id', empresaId)
        .maybeSingle();
      const enabled = (data as { ai_enabled?: boolean } | null)?.ai_enabled;
      if (typeof enabled === 'boolean') setConfig(empresaId, { aiEnabled: enabled });
    } catch (err) {
      // Column may not exist yet (migration 008 not applied) — default true
      console.warn('[Router] ai_enabled column unavailable:', err);
    }
    res.json({ ok: true, empresaId });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/ai-enabled — returns the empresa's global AI kill-switch state.
 */
router.get('/api/ai-enabled', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    res.json({ enabled: getConfig(empresaId).aiEnabled !== false });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai-enabled — toggles the global AI kill-switch. Persisted in empresa_perfil.
 * Body: { enabled: boolean }
 */
router.post('/api/ai-enabled', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const enabled = Boolean(req.body?.enabled);
    setConfig(empresaId, { aiEnabled: enabled });
    try {
      await getServiceSupabase()
        .from('empresa_perfil')
        .update({ ai_enabled: enabled, updated_at: new Date().toISOString() })
        .eq('id', empresaId);
    } catch (err) {
      console.warn('[Router] ai_enabled persist failed (column missing?):', err);
    }
    broadcast({ type: 'ai_enabled', data: { enabled } });
    res.json({ ok: true, enabled });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/reply — Generates an AI reply for a session and sends it.
 * Body: { jid: string }
 */
router.get('/api/drivers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const drivers = await listDrivers(empresaId);
    res.json({ drivers });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.post('/api/drivers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const driver = await createDriver(empresaId, req.body ?? {});
    res.status(201).json({ driver });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.put('/api/drivers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const driver = await updateDriver(empresaId, req.params.id, req.body ?? {});

    if (!driver) {
      res.status(404).json({ error: 'Entregador não encontrado.' });
      return;
    }

    res.json({ driver });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.delete('/api/drivers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const deleted = await deleteDriver(empresaId, req.params.id);

    if (!deleted) {
      res.status(404).json({ error: 'Entregador não encontrado.' });
      return;
    }

    res.json({ ok: true });
  } catch (error) {
    sendDriverError(res, error);
  }
});

router.get('/api/triggers', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const triggers = await listTriggers(empresaId);
    res.json({ triggers });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.post('/api/triggers', async (req: Request, res: Response) => {
  const { naturalInput } = (req.body ?? {}) as { naturalInput?: string };
  if (!naturalInput?.trim()) {
    res.status(400).json({ error: 'Descreva o gatilho em português.' });
    return;
  }
  try {
    const empresaId = await requireEmpresaId(req);
    const trigger = await createTrigger(empresaId, naturalInput);
    res.status(201).json({ trigger });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.patch('/api/triggers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const trigger = await updateTrigger(empresaId, req.params.id, req.body ?? {});
    if (!trigger) {
      res.status(404).json({ error: 'Gatilho não encontrado.' });
      return;
    }
    res.json({ trigger });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.delete('/api/triggers/:id', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const deleted = await deleteTrigger(empresaId, req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'Gatilho não encontrado.' });
      return;
    }
    res.json({ ok: true });
  } catch (error) {
    sendTriggerError(res, error);
  }
});

router.post('/api/ai/reply', async (req: Request, res: Response) => {
  const { jid } = req.body;

  if (!jid) {
    res.status(400).json({ error: 'Missing "jid" field' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    const reply = await generateAndSendReply(jid, empresaId);
    if (reply) {
      res.json({ ok: true, reply });
    } else {
      res.status(500).json({ error: 'Failed to generate reply' });
    }
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/sessions/:jid/auto-reply — Toggle auto-reply for a session.
 * Body: { enabled: boolean }
 */
router.post('/api/sessions/:jid/auto-reply', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { enabled } = req.body;
    await setAutoReply(req.params.jid, !!enabled, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.post('/api/sessions/:jid/read', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await markSessionAsRead(req.params.jid, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// Mark a specific WhatsApp message as read (requires the WA message ID, not the DB UUID)
router.post('/api/sessions/:jid/mark-read', async (req: Request, res: Response) => {
  const { messageId } = req.body as { messageId?: string };
  if (!messageId) {
    res.status(400).json({ error: 'Campo obrigatório: messageId.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await markWhatsAppMessageAsRead(req.params.jid, messageId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.delete('/api/sessions/:jid', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    await deleteSession(req.params.jid, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * POST /api/ai/generate-instructions — Generates a starter master prompt for the agent.
 * Uses the business profile on the server so a blank textarea can be filled with one click.
 * Body: { hint?: string } — optional extra guidance from the user.
 */
router.post('/api/ai/generate-instructions', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { hint } = (req.body ?? {}) as { hint?: string };
    const cfg = getConfig(empresaId);

    const openai = getAI();
    const systemInstruction = `Você é um engenheiro de prompts. Sua tarefa é escrever DIRETRIZES OPERACIONAIS (NÃO uma mensagem de boas-vindas, NÃO uma resposta ao cliente) que serão usadas como system prompt de um agente de IA que atende clientes de uma lanchonete brasileira no WhatsApp.

O QUE VOCÊ DEVE ESCREVER:
Uma lista de regras de comportamento em segunda pessoa ("Seja ...", "Responda ...", "Escale ...", "Nunca ..."), curta e direta, 6 a 12 linhas, entre 300 e 900 caracteres.

EXEMPLO DE FORMATO ESPERADO (imite este estilo de imperativos):
Seja simpático, direto e informal — tom de WhatsApp brasileiro, com emojis moderados.
Mantenha respostas curtas (1-3 frases).
Sempre colete nome, produto, quantidade, data e horário de retirada antes de confirmar encomendas.
Se o cliente demonstrar frustração, raiva ou pedir explicitamente para falar com uma pessoa, escale para atendimento humano.
Nunca invente preços, horários ou produtos que não estejam no cardápio.
Confirme os dados do pedido no final, repetindo-os, antes de finalizar.

REGRAS DE SAÍDA:
- Escreva APENAS as diretrizes, uma por linha, em imperativo.
- NUNCA escreva uma saudação, apresentação ou mensagem dirigida ao cliente (ex: "Oi!", "Bem-vindo", "Estou aqui pra te ajudar").
- NÃO use Markdown (sem "#", "-", "*", "•").
- NÃO use aspas envolvendo o texto, sem preâmbulos tipo "Aqui estão:".
- Se a lanchonete tiver nome/especialidade, pode mencionar no contexto da diretriz (ex: "Represente a padaria X com orgulho"), mas o foco é COMO se comportar, não O QUE falar.`;

    const userContext = `Contexto da lanchonete (use só para ajustar tom e foco das diretrizes):
Nome: ${cfg.name || 'não informado'}
Especialidade: ${cfg.specialty || 'não informada'}
${hint ? `\nPedido extra do dono: ${hint}` : ''}

Escreva agora as diretrizes operacionais do agente.`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.85,
      messages: [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: userContext },
      ],
    });

    const content = response.choices[0]?.message?.content?.trim() || '';
    res.json({ instructions: content });
  } catch (error) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Generate Instructions] Error:', error);
    res.status(500).json({ error: 'Falha ao gerar instruções.' });
  }
});

/**
 * POST /api/ai/complete — Proxy for frontend AI calls. Requires auth.
 * Body: { messages: array, temperature?: number, responseFormat?: 'json' }
 */
router.post('/api/ai/complete', async (req: Request, res: Response) => {
  const { messages, temperature = 0.7, responseFormat } = req.body;

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'Missing messages array' });
    return;
  }

  try {
    await requireEmpresaId(req);
    const openai = getAI();
    const params: ChatCompletionCreateParamsNonStreaming = {
      model: 'gpt-4o-mini',
      messages,
      temperature,
    };
    if (responseFormat === 'json') {
      params.response_format = { type: 'json_object' };
    }
    const response = await openai.chat.completions.create(params);
    res.json({ content: response.choices[0].message.content });
  } catch (error: unknown) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    console.error('[AI Proxy] Error:', error);
    res.status(500).json({ error: 'AI request failed' });
  }
});

router.get('/api/sessions/:jid/profile-picture', async (req: Request, res: Response) => {
  try {
    await requireEmpresaId(req);
    const url = await fetchProfilePicture(req.params.jid);
    res.json({ url });
  } catch (error) {
    sendAuthError(res, error);
  }
});

router.patch('/api/sessions/:jid/name', async (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: 'Nome não pode ser vazio.' });
    return;
  }

  try {
    const empresaId = await requireEmpresaId(req);
    await updateSessionName(req.params.jid, name, empresaId);
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

/**
 * GET /api/produtos — Proxy para zelopdv.com.br (evita CORS no frontend).
 * Requer Authorization: Bearer <token> — repassa diretamente para a API.
 */
router.get('/api/produtos', async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header ausente.' });
    return;
  }

  try {
    const onlyVisible = req.query.onlyVisible ?? 'true';
    const url = new URL('https://www.zelopdv.com.br/api/produtos');
    url.searchParams.set('onlyVisible', String(onlyVisible));

    const upstream = await axios.get(url.toString(), {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });

    res.json(upstream.data);
  } catch (err: any) {
    const status = err?.response?.status ?? 502;
    const msg = err?.response?.data?.error ?? err?.message ?? 'Upstream error';
    res.status(status).json({ error: msg });
  }
});

/**
 * POST /api/sync-config — Syncs business config from the frontend per-empresa. Requires auth.
 */
router.post('/api/sync-config', async (req: Request, res: Response) => {
  try {
    const empresaId = await requireEmpresaId(req);
    const { name, specialty, hours, closedDays, address, pixKey,
            products, catalogHierarchy, blockedDates, dailyContext, aiInstructions, managerPhone, aiEnabled } = req.body;
    setConfig(empresaId, { name, specialty, hours, closedDays, address, pixKey,
                           products, catalogHierarchy, blockedDates, dailyContext, aiInstructions, managerPhone,
                           ...(typeof aiEnabled === 'boolean' ? { aiEnabled } : {}) });
    res.json({ ok: true });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// ─── Validate WhatsApp numbers ────────────────────────────────────────────────

router.post('/api/whatsapp/validate-numbers', async (req: Request, res: Response) => {
  const { numbers } = req.body as { numbers?: string[] };
  if (!Array.isArray(numbers) || numbers.length === 0) {
    res.status(400).json({ error: 'Campo "numbers" é obrigatório e deve ser um array.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    const result = await validateWhatsAppNumbers(numbers);
    res.json({ result });
  } catch (error) {
    sendAuthError(res, error);
  }
});

// ─── Send interactive list ────────────────────────────────────────────────────

router.post('/api/send/list', async (req: Request, res: Response) => {
  const { to, title, description, buttonText, footerText, sections } = req.body ?? {};
  if (!to || !description || !buttonText || !Array.isArray(sections)) {
    res.status(400).json({ error: 'Campos obrigatórios: to, description, buttonText, sections.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await sendListMessage(to, { title, description, buttonText, footerText, sections });
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send location ────────────────────────────────────────────────────────────

router.post('/api/send/location', async (req: Request, res: Response) => {
  const { to, latitude, longitude, name, address } = req.body ?? {};
  if (!to || latitude == null || longitude == null) {
    res.status(400).json({ error: 'Campos obrigatórios: to, latitude, longitude.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await sendLocationMessage(to, { latitude, longitude, name, address });
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send reaction ────────────────────────────────────────────────────────────

router.post('/api/send/reaction', async (req: Request, res: Response) => {
  const { to, messageId, reaction, fromMe } = req.body ?? {};
  if (!to || !messageId || !reaction) {
    res.status(400).json({ error: 'Campos obrigatórios: to, messageId, reaction.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await sendReaction(to, messageId, reaction, fromMe ?? false);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Send poll ────────────────────────────────────────────────────────────────

router.post('/api/send/poll', async (req: Request, res: Response) => {
  const { to, name, values, selectableCount } = req.body ?? {};
  if (!to || !name || !Array.isArray(values) || values.length === 0) {
    res.status(400).json({ error: 'Campos obrigatórios: to, name, values (array).' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await sendPollMessage(to, { name, values, selectableCount });
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

// ─── Revoke message ───────────────────────────────────────────────────────────

router.delete('/api/messages/:id', async (req: Request, res: Response) => {
  const { remoteJid, fromMe } = req.body ?? {};
  if (!remoteJid) {
    res.status(400).json({ error: 'Campo obrigatório: remoteJid.' });
    return;
  }
  try {
    await requireEmpresaId(req);
    await revokeMessage(remoteJid, req.params.id, fromMe ?? true);
    res.json({ ok: true });
  } catch (error: any) {
    if (error instanceof Error && (error.message === 'UNAUTHORIZED' || error.message === 'EMPRESA_NOT_FOUND')) {
      sendAuthError(res, error);
      return;
    }
    res.status(500).json({ error: error.message });
  }
});

export default router;
