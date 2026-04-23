import { Router, Request, Response } from 'express';
import { getStatus, getQR, getSocket } from './whatsapp.js';
import { getAllSessions, getSession, addAssistantMessage, setAutoReply } from './messageHandler.js';
import { generateAndSendReply } from './ai.js';

const router = Router();

/**
 * GET /api/status — Returns the current WhatsApp connection status.
 */
router.get('/api/status', (_req: Request, res: Response) => {
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
 * GET /api/sessions — Returns all active WhatsApp sessions.
 */
router.get('/api/sessions', (_req: Request, res: Response) => {
  res.json({ sessions: getAllSessions() });
});

/**
 * GET /api/sessions/:jid — Returns a specific session with its messages.
 */
router.get('/api/sessions/:jid', (req: Request, res: Response) => {
  const session = getSession(req.params.jid);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session });
});

/**
 * POST /api/send — Sends a text message to a WhatsApp contact.
 * Body: { to: string (jid), message: string }
 */
router.post('/api/send', async (req: Request, res: Response) => {
  const { to, message } = req.body;

  if (!to || !message) {
    res.status(400).json({ error: 'Missing "to" or "message" field' });
    return;
  }

  const sock = getSocket();
  if (!sock) {
    res.status(503).json({ error: 'WhatsApp not connected' });
    return;
  }

  try {
    await sock.sendMessage(to, { text: message });
    addAssistantMessage(to, message);
    res.json({ ok: true });
  } catch (error: any) {
    console.error('[Router] Send error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/ai/reply — Generates an AI reply for a session and sends it.
 * Body: { jid: string }
 */
router.post('/api/ai/reply', async (req: Request, res: Response) => {
  const { jid } = req.body;

  if (!jid) {
    res.status(400).json({ error: 'Missing "jid" field' });
    return;
  }

  const reply = await generateAndSendReply(jid);
  if (reply) {
    res.json({ ok: true, reply });
  } else {
    res.status(500).json({ error: 'Failed to generate reply' });
  }
});

/**
 * POST /api/sessions/:jid/auto-reply — Toggle auto-reply for a session.
 * Body: { enabled: boolean }
 */
router.post('/api/sessions/:jid/auto-reply', (req: Request, res: Response) => {
  const { enabled } = req.body;
  setAutoReply(req.params.jid, !!enabled);
  res.json({ ok: true });
});

export default router;
