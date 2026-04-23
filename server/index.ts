import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { createWsServer } from './ws.js';
import { startWhatsApp, onIncomingMessage, getStatus } from './whatsapp.js';
import { handleIncomingMessage, getSession } from './messageHandler.js';
import { generateAndSendReply } from './ai.js';
import router from './router.js';

const PORT = parseInt(process.env.SERVER_PORT || '3001', 10);

const app = express();
app.use(express.json());
app.use(router);

const httpServer = createServer(app);
createWsServer(httpServer);

// --- Wire up incoming messages → store + auto-reply ---
onIncomingMessage(async (msg) => {
  // 1. Normalize and store the message
  handleIncomingMessage(msg);

  // 2. Auto-reply if enabled for this session
  const jid = msg.key.remoteJid;
  if (!jid) return;

  const session = getSession(jid);
  if (session?.autoReply && process.env.OPENAI_API_KEY) {
    // Small delay to feel more natural
    setTimeout(async () => {
      try {
        await generateAndSendReply(jid);
      } catch (err) {
        console.error('[AutoReply] Error:', err);
      }
    }, 1500);
  }
});

// --- Start server ---
httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
  console.log(`[Server] WebSocket on ws://localhost:${PORT}/ws`);

  // Start WhatsApp connection
  startWhatsApp().catch((err) => {
    console.error('[Server] WhatsApp startup error:', err);
  });
});
