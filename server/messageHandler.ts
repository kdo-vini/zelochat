import { broadcast } from './ws.js';
import { getServiceSupabase, uploadReceivedMedia } from './supabase.js';
import { transcribeAudio } from './transcription.js';
import type { AudioTranscriptStatus, ChatAttachment, ChatMessage, MessageRole } from '../src/types.js';
import {
  buildAttachmentPreview,
  buildContactKey,
  isLikelyPhoneLabel,
  normalizePhoneNumber,
  parseStructuredMessage,
  serializeStructuredMessage,
} from '../src/domain/chat.js';

const jidQueues = new Map<string, Promise<void>>();

/**
 * Serialize all work for a given JID through a single in-memory queue. Any
 * code path that mutates pending-order state OR persists messages for a JID
 * MUST go through this — otherwise concurrent webhook events (button click +
 * retry, button + text, two rapid customer messages) can race past
 * check-then-act windows and produce duplicate orders or duplicate inserts.
 *
 * Exported so router.ts can wrap its button-click handlers in the same queue
 * that `handleIncomingMessage` uses for inbound text. Both must share the
 * queue to actually serialize, which is the whole point.
 */
export function serializeForJid<T = void>(jid: string, work: () => Promise<T>): Promise<T> {
  const existing = jidQueues.get(jid) ?? Promise.resolve();
  // Run work whether the previous task resolved or rejected. The cast is
  // intentional: the queue stores Promise<void> but each task can return T.
  const next = existing.then(work, work) as Promise<T>;
  jidQueues.set(jid, next as unknown as Promise<void>);
  (next as Promise<unknown>).finally(() => {
    if (jidQueues.get(jid) === (next as unknown as Promise<void>)) jidQueues.delete(jid);
  });
  return next;
}

export type SessionStatus = 'active' | 'escalated' | 'resolved' | 'archived';

export interface StoredSession {
  id: string;
  customerName: string;
  customerPhone: string;
  lastMessage: string;
  lastMessageTime: string;
  unreadCount: number;
  messages: ChatMessage[];
  status: SessionStatus;
  autoReply: boolean;
  profilePicUrl?: string;
  escalatedAt?: string | null;
  acknowledgedAt?: string | null;
}

interface SessionRow {
  id: string;
  remote_jid: string;
  customer_name: string | null;
  customer_phone: string | null;
  last_message: string | null;
  last_message_time: string | null;
  unread_count: number | null;
  status: SessionStatus;
  auto_reply: boolean | null;
  profile_pic_url: string | null;
  escalated_at: string | null;
  acknowledged_at: string | null;
  updated_at: string;
}

interface MessageRow {
  id: string;
  role: string;
  content: string | null;
  tool_calls: any[] | null;
  tool_call_id: string | null;
  sent_at: string;
  audio_transcript: string | null;
  audio_transcript_status: AudioTranscriptStatus | null;
}

const MESSAGE_COLUMNS = 'id, role, content, tool_calls, tool_call_id, sent_at, audio_transcript, audio_transcript_status';

interface SessionFamily {
  primary: SessionRow;
  latest: SessionRow;
  rows: SessionRow[];
}

function phoneFromJid(jid: string): string {
  return normalizePhoneNumber(jid.replace(/@.*$/, ''));
}

export function formatPhone(phone: string): string {
  const local = phone.startsWith('55') ? phone.slice(2) : phone;
  if (local.length === 11) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  }
  // P1.8 — Format 10-digit local numbers (landlines and legacy mobile format)
  if (local.length === 10) {
    return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  }
  return phone;
}

function buildSessionKeyFromRow(row: Pick<SessionRow, 'remote_jid' | 'customer_phone'>): string {
  return buildContactKey(row.customer_phone || phoneFromJid(row.remote_jid) || row.remote_jid);
}

function pickPrimarySessionRow(rows: SessionRow[]): SessionRow {
  return [...rows].sort((left, right) => {
    const leftNamed = !isLikelyPhoneLabel(left.customer_name);
    const rightNamed = !isLikelyPhoneLabel(right.customer_name);

    if (leftNamed !== rightNamed) {
      return rightNamed ? 1 : -1;
    }

    return new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime();
  })[0];
}

function pickLatestSessionRow(rows: SessionRow[]): SessionRow {
  return [...rows].sort(
    (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  )[0];
}

function resolveCustomerName(rows: SessionRow[], fallback: string): string {
  const namedRow = rows.find((row) => !isLikelyPhoneLabel(row.customer_name));
  return namedRow?.customer_name || fallback;
}

function resolveCustomerPhone(rows: SessionRow[], fallbackJid: string): string {
  const phone =
    rows.find((row) => normalizePhoneNumber(row.customer_phone || ''))?.customer_phone ||
    formatPhone(phoneFromJid(fallbackJid));

  return phone;
}

function formatClock(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  // Always render in Brasília time regardless of where the server runs (Railway/Render
  // run UTC; local dev runs whatever the OS is set to). Without this pin, deploys
  // shift bubble timestamps by the server's UTC offset.
  return date.toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolveMessageDate(msg: any): Date {
  const raw = msg?.messageTimestamp;
  const numeric = Number(raw);

  if (Number.isFinite(numeric) && numeric > 0) {
    const millis = numeric > 10_000_000_000 ? numeric : numeric * 1000;
    const parsed = new Date(millis);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function extractText(msg: any): string | null {
  const message = msg.message;
  if (!message) return null;

  if (message.conversation) return message.conversation;
  if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
  if (message.imageMessage?.caption) return `[Imagem] ${message.imageMessage.caption}`;
  if (message.imageMessage) return '[Imagem]';
  if (message.videoMessage?.caption) return `[Video] ${message.videoMessage.caption}`;
  if (message.videoMessage) return '[Video]';
  if (message.audioMessage) return '[Audio]';
  if (message.documentMessage) return `[Documento ${message.documentMessage.fileName || ''}]`.trim();
  if (message.stickerMessage) return '[Sticker]';
  if (message.contactMessage) return '[Contato]';
  if (message.locationMessage) return '[Localizacao]';
  if (message.interactiveResponseMessage?.body?.text) return message.interactiveResponseMessage.body.text;
  if (message.buttonsResponseMessage?.selectedDisplayText) return message.buttonsResponseMessage.selectedDisplayText;
  if (message.templateButtonReplyMessage?.selectedDisplayText) return message.templateButtonReplyMessage.selectedDisplayText;

  return null;
}

/**
 * Extracts the media data from an incoming webhook message.
 * Priority: base64 (uploaded to Supabase) → public mediaUrl from Whatsmiau.
 * Encrypted WhatsApp CDN URLs (mmg.whatsapp.net) are NOT usable directly.
 *
 * P0.5 — `empresaId` is required so the persistent upload lands at a per-tenant
 * scoped path (`received/${empresaId}/${randomSlug}-${fileName}`). This makes
 * cross-tenant enumeration combinatorially infeasible. See `buildScopedMediaKey`
 * in server/supabase.ts for the rationale.
 */
// P1.9 — cap em tamanho de mídia entrante. Whatsmiau base64 chega no
// payload do webhook; sem cap, um vídeo de 50MB vira ~75MB de Buffer no
// event loop do Node, e múltiplos paralelos = OOM (Railway crash).
// 25MB é generoso pra fotos e áudios normais; vídeos grandes recebem
// placeholder e o operador é informado via [MÍDIA GRANDE — pedir reenvio].
const MAX_INBOUND_MEDIA_BYTES = 25 * 1024 * 1024; // 25 MB

// P1.2 — Allowlist de domínios legítimos para mediaUrl recebida do webhook.
// Sem esta validação, um atacante que injete um webhook pode colocar qualquer
// URL aqui — ela seria armazenada no DB e renderizada como <img src> no
// browser do operador, vazando o IP/UA dele para o servidor do atacante.
// Se o Whatsmiau mudar de CDN e imagens pararem de aparecer, adicionar o novo
// hostname aqui (verificar no log: "[Media] mediaUrl blocked").
const ALLOWED_MEDIA_HOSTS: readonly string[] = [
  'storage.googleapis.com',     // Whatsmiau GCS bucket (comentário no código original)
  'lh3.googleusercontent.com',  // Google CDN
  'whatsmiau.dev',               // CDN próprio do Whatsmiau
  'supabase.co',                 // Storage do nosso projeto
  'supabase.in',                 // Região EU do Supabase
];

function isAllowedMediaUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== 'https:') return false;
    return ALLOWED_MEDIA_HOSTS.some(
      (h) => hostname === h || hostname.endsWith(`.${h}`),
    );
  } catch {
    return false;
  }
}

async function extractAttachmentDataUrl(msg: any, mimeType: string, fileName: string, empresaId: string): Promise<string | undefined> {
  // 1. Public mediaUrl — Whatsmiau provides this after uploading to its own Google Cloud storage.
  // Esses URLs públicos não consomem nossa memória (cliente baixa direto), então
  // não precisam de cap. Tamanho declarado vem do msg.message.{type}Message.fileLength
  // quando relevante — checagem feita no caller via skip-attachment.
  const mediaUrl: string = msg.message?.mediaUrl ?? '';
  if (mediaUrl) {
    if (isAllowedMediaUrl(mediaUrl)) {
      return mediaUrl;
    }
    console.warn('[Media] mediaUrl blocked (not in allowlist):', (() => { try { return new URL(mediaUrl).hostname; } catch { return mediaUrl; } })());
  }

  // 2. Base64 path — Whatsmiau enviou bytes inline. AQUI precisamos de cap
  // porque o decode acontece no nosso process. base64 → ~75% bytes reais.
  // Calculamos o tamanho aproximado ANTES de decodar pra evitar alocar buffer
  // gigante por nada.
  const raw: string = msg.message?.base64 ?? '';
  if (raw) {
    const pure = raw.startsWith('data:') ? raw.split(',')[1] ?? '' : raw;
    if (pure) {
      // base64 length × 0.75 ≈ decoded bytes. Conservador: aceita o limite com folga.
      const approxBytes = Math.floor(pure.length * 0.75);
      if (approxBytes > MAX_INBOUND_MEDIA_BYTES) {
        console.warn(`[Media] inbound payload too large: ~${(approxBytes / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_INBOUND_MEDIA_BYTES / 1024 / 1024}MB cap. Dropping.`);
        return undefined;
      }
      // Upload to Supabase for a persistent public URL
      try {
        const buffer = Buffer.from(pure, 'base64');
        return await uploadReceivedMedia(buffer, fileName, mimeType, empresaId);
      } catch (err) {
        console.warn('[Media] Supabase upload failed, using data URI:', err);
        return `data:${mimeType};base64,${pure}`;
      }
    }
  }

  // No usable media data
  console.warn('[Media] No usable media found for', mimeType);
  return undefined;
}

function mapMessage(row: MessageRow): ChatMessage {
  const parsed = parseStructuredMessage(row.content || '');
  return {
    id: row.id,
    role: row.role as MessageRole,
    content: row.content,
    preview: parsed.preview,
    timestamp: formatClock(row.sent_at),
    kind: parsed.kind,
    attachment: parsed.attachment,
    tool_calls: row.tool_calls || undefined,
    tool_call_id: row.tool_call_id || undefined,
    audio_transcript: row.audio_transcript,
    audio_transcript_status: row.audio_transcript_status,
  };
}

function mapSession(family: SessionFamily, messages: ChatMessage[] = [], latestCustomerSentAt?: string): StoredSession {
  const customerName = resolveCustomerName(
    family.rows,
    formatPhone(phoneFromJid(family.latest.remote_jid)),
  );
  const customerPhone = resolveCustomerPhone(family.rows, family.latest.remote_jid);
  const lastMessage = parseStructuredMessage(family.latest.last_message || '').preview;

  // Escalation status takes priority over active/archived collapsing — if any row
  // in the family is escalated, the whole conversation is escalated. Same for
  // resolved (over archived).
  const familyStatus: SessionStatus = family.rows.some((r) => r.status === 'escalated')
    ? 'escalated'
    : family.rows.some((r) => r.status === 'resolved')
      ? 'resolved'
      : family.rows.some((r) => r.status === 'active')
        ? 'active'
        : 'archived';

  // Pick the most recent escalated_at across the family rows.
  const escalatedAt = family.rows
    .map((r) => r.escalated_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;
  const acknowledgedAt = family.rows
    .map((r) => r.acknowledged_at)
    .filter((v): v is string => !!v)
    .sort()
    .at(-1) ?? null;

  return {
    id: family.latest.remote_jid,
    customerName,
    customerPhone,
    lastMessage,
    // Prefer the ISO sent_at from zelochat_messages so legacy "HH:MM" strings stored
    // when the server ran in UTC are self-healed without a data migration.
    lastMessageTime: latestCustomerSentAt || family.latest.last_message_time || '',
    unreadCount: family.rows.reduce((sum, row) => sum + (row.unread_count ?? 0), 0),
    messages,
    status: familyStatus,
    autoReply: family.primary.auto_reply ?? family.latest.auto_reply ?? true,
    profilePicUrl: family.primary.profile_pic_url || family.latest.profile_pic_url || undefined,
    escalatedAt,
    acknowledgedAt,
  };
}

async function fetchAllSessionRows(empresaId: string): Promise<SessionRow[]> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_sessions')
    .select('id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, profile_pic_url, escalated_at, acknowledged_at, updated_at')
    .eq('empresa_id', empresaId)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data as SessionRow[]) ?? [];
}

async function fetchSessionFamily(empresaId: string, jid: string): Promise<SessionFamily | null> {
  const rows = await fetchAllSessionRows(empresaId);
  const targetKey = buildContactKey(phoneFromJid(jid) || jid);
  const familyRows = rows.filter(
    (row) => row.remote_jid === jid || buildSessionKeyFromRow(row) === targetKey,
  );

  if (familyRows.length === 0) {
    return null;
  }

  return {
    primary: pickPrimarySessionRow(familyRows),
    latest: pickLatestSessionRow(familyRows),
    rows: familyRows,
  };
}

export async function ensureSession(params: {
  empresaId: string;
  jid: string;
  customerName?: string;
  customerPhone?: string;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  profilePicUrl?: string;
}): Promise<SessionRow> {
  const supabase = getServiceSupabase();
  const family = await fetchSessionFamily(params.empresaId, params.jid);
  const existing = family?.primary ?? null;
  const formattedPhone = params.customerPhone ?? formatPhone(phoneFromJid(params.jid));
  const preferredNameCandidates = [
    params.customerName,
    ...(family?.rows.map((row) => row.customer_name || '').filter(Boolean) ?? []),
    formatPhone(phoneFromJid(params.jid)),
  ];
  const customerName =
    preferredNameCandidates.find((candidate) => !isLikelyPhoneLabel(candidate)) ||
    preferredNameCandidates[0] ||
    formatPhone(phoneFromJid(params.jid));

  const payload = {
    empresa_id: params.empresaId,
    remote_jid: params.jid,
    customer_name: customerName,
    customer_phone: formattedPhone,
    last_message: params.lastMessage ?? existing?.last_message ?? '',
    last_message_time: params.lastMessageTime ?? existing?.last_message_time ?? '',
    unread_count: params.unreadCount ?? existing?.unread_count ?? 0,
    status: existing?.status ?? 'active',
    auto_reply: existing?.auto_reply ?? true,
    profile_pic_url: params.profilePicUrl ?? existing?.profile_pic_url ?? null,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { data, error } = await supabase
      .from('zelochat_sessions')
      .update(payload)
      .eq('id', existing.id)
      .select('id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, profile_pic_url, escalated_at, acknowledged_at, updated_at')
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as SessionRow;
  }

  const { data, error } = await supabase
    .from('zelochat_sessions')
    .insert(payload)
    .select('id, remote_jid, customer_name, customer_phone, last_message, last_message_time, unread_count, status, auto_reply, profile_pic_url, escalated_at, acknowledged_at, updated_at')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SessionRow;
}

export async function updateSessionProfilePic(empresaId: string, jid: string, profilePicUrl: string) {
  const supabase = getServiceSupabase();
  const family = await fetchSessionFamily(empresaId, jid);
  const existing = family?.primary ?? null;
  if (existing) {
    await supabase
      .from('zelochat_sessions')
      .update({ profile_pic_url: profilePicUrl })
      .eq('id', existing.id);
  }
}

async function insertMessage(params: {
  empresaId: string;
  sessionId: string;
  role: MessageRole;
  content: string | null;
  sentAt: string;
  tool_calls?: any[] | null;
  tool_call_id?: string | null;
}): Promise<ChatMessage> {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase
    .from('zelochat_messages')
    .insert({
      empresa_id: params.empresaId,
      session_id: params.sessionId,
      role: params.role,
      content: params.content,
      tool_calls: params.tool_calls || null,
      tool_call_id: params.tool_call_id || null,
      sent_at: params.sentAt,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapMessage(data as MessageRow);
}

/**
 * P0.14 — idempotent insert for inbound customer messages, keyed on the
 * WhatsApp message id (`data.key.id` from the Whatsmiau webhook payload).
 *
 * Whatsmiau retries webhook deliveries on slow ack or proxy timeout. Without
 * dedup, a retry produced a SECOND row in `zelochat_messages` for the same
 * message → the AI auto-reply ran twice, customer received two replies, two
 * pending orders got created. The partial unique index
 * `zelochat_messages_empresa_wa_msg_uniq` (migration 015) now constrains
 * `(empresa_id, wa_message_id)` to be unique when wa_message_id is non-NULL.
 *
 * Returns null when the row already existed (this delivery is a retry of an
 * earlier one). Caller MUST short-circuit downstream side-effects (unread
 * bump, broadcast, AI dispatch) when null is returned — otherwise the dedup
 * is defeated at the application layer even though the DB row is unique.
 *
 * BUTTERFLY EFFECT: this is the new authoritative dedup boundary for inbound.
 * If you ever swap the partial unique index for a different schema, OR if
 * you decide to also dedupe assistant/tool rows, READ the duplicate-order
 * incident notes in CLAUDE.md before changing anything. The whole order
 * confirmation pipeline depends on inbound being deduped HERE, not later.
 */
async function upsertInboundUserMessage(params: {
  empresaId: string;
  sessionId: string;
  content: string | null;
  sentAt: string;
  waMessageId: string;
}): Promise<ChatMessage | null> {
  const supabase = getServiceSupabase();

  // 🚨 HOTFIX 2026-04-29 — não usar `.upsert(..., { ignoreDuplicates: true })`.
  // O supabase-js manda `Prefer: resolution=ignore-duplicates` que faz o
  // Postgres não retornar a row inserida no RETURNING — TANTO em conflito
  // QUANTO em insert fresco. Resultado: minha checagem `data.length === 0`
  // estava interpretando TODO insert fresco como duplicate → 531 mensagens
  // user esperadas, 0 persistidas com wa_message_id desde o deploy do P0.14.
  // Casa dos Salgados perdeu silenciosamente toda mensagem nova no chat
  // panel (last_message do session row continuava OK porque ensureSession
  // roda antes, mascarando o problema).
  //
  // Solução: INSERT puro com catch do unique-constraint violation (Postgres
  // 23505). Genuíno duplicate → retorna null. Insert fresco → retorna a row.
  // Essa abordagem não depende do comportamento exato do supabase-js para o
  // header Prefer.
  const { data, error } = await supabase
    .from('zelochat_messages')
    .insert({
      empresa_id: params.empresaId,
      session_id: params.sessionId,
      role: 'user' as MessageRole,
      content: params.content,
      sent_at: params.sentAt,
      wa_message_id: params.waMessageId,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    // 23505 = Postgres unique_violation. Aqui significa que `wa_message_id`
    // já foi inserido pra esta empresa — Whatsmiau retransmitiu o webhook.
    // Caller MUST short-circuit (sem unread bump, sem broadcast, sem AI).
    if ((error as { code?: string }).code === '23505') {
      return null;
    }
    throw new Error(error.message);
  }

  return mapMessage(data as MessageRow);
}

export async function getSession(jid: string, empresaId: string): Promise<StoredSession | null> {
  // P0.2 — empresaId is REQUIRED. Previously defaulted to getBoundEmpresaId()
  // which is null in multi-tenant deploys (count !== 1 at startup), causing
  // operations to silently no-op or write to the wrong tenant.
  if (!empresaId) {
    return null;
  }

  const supabase = getServiceSupabase();
  const family = await fetchSessionFamily(empresaId, jid);

  if (!family) {
    return null;
  }

  const { data: messages, error } = await supabase
    .from('zelochat_messages')
    .select(MESSAGE_COLUMNS)
    .eq('empresa_id', empresaId)
    .in('session_id', family.rows.map((row) => row.id))
    .order('sent_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const msgRows = (messages as MessageRow[]);
  const latestUserSentAt = [...msgRows].reverse().find(m => m.role === 'user')?.sent_at;
  return mapSession(family, msgRows.map(mapMessage), latestUserSentAt);
}

export async function getAllSessions(empresaId: string): Promise<StoredSession[]> {
  if (!empresaId) {
    return [];
  }

  const allRows = await fetchAllSessionRows(empresaId);
  // Exclude group chats (@g.us) and any non-individual JIDs
  const rows = allRows.filter(row => row.remote_jid.endsWith('@s.whatsapp.net'));
  const families = new Map<string, SessionRow[]>();

  for (const row of rows) {
    const key = buildSessionKeyFromRow(row);
    const family = families.get(key) ?? [];
    family.push(row);
    families.set(key, family);
  }

  // Batch-load the latest customer message timestamp per session to self-heal
  // legacy "HH:MM" strings that were stored when the server ran in UTC.
  const allSessionIds = rows.map(r => r.id);
  const latestCustomerSentAtBySessionId = new Map<string, string>();
  if (allSessionIds.length > 0) {
    const { data: latestMsgs } = await getServiceSupabase()
      .from('zelochat_messages')
      .select('session_id, sent_at')
      .eq('empresa_id', empresaId)
      .eq('role', 'user')
      .in('session_id', allSessionIds)
      .order('sent_at', { ascending: false });
    for (const m of (latestMsgs ?? []) as { session_id: string; sent_at: string }[]) {
      if (!latestCustomerSentAtBySessionId.has(m.session_id)) {
        latestCustomerSentAtBySessionId.set(m.session_id, m.sent_at);
      }
    }
  }

  return [...families.values()]
    .sort((a, b) =>
      new Date(pickLatestSessionRow(b).updated_at).getTime() -
      new Date(pickLatestSessionRow(a).updated_at).getTime(),
    )
    .map((rowsForContact) => {
      const family: SessionFamily = {
        primary: pickPrimarySessionRow(rowsForContact),
        latest: pickLatestSessionRow(rowsForContact),
        rows: rowsForContact,
      };
      // Pick the most recent customer sent_at across all rows in this contact family
      const latestCustomerSentAt = rowsForContact
        .map(r => latestCustomerSentAtBySessionId.get(r.id))
        .filter((v): v is string => Boolean(v))
        .sort()
        .at(-1);
      return mapSession(family, [], latestCustomerSentAt);
    });
}

export async function markSessionAsRead(jid: string, empresaId: string): Promise<void> {
  if (!empresaId) {
    return;
  }

  const family = await fetchSessionFamily(empresaId, jid);
  if (!family) {
    return;
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('zelochat_sessions')
    .update({
      unread_count: 0,
      updated_at: new Date().toISOString(),
    })
    .in('id', family.rows.map((row) => row.id));

  if (error) {
    throw new Error(error.message);
  }

  broadcast(
    {
      type: 'session_read',
      data: { sessionId: jid, unreadCount: 0 },
    },
    empresaId,
  );
}

export async function deleteSession(jid: string, empresaId: string): Promise<void> {
  if (!empresaId) {
    return;
  }

  const family = await fetchSessionFamily(empresaId, jid);
  if (!family) {
    return;
  }

  const supabase = getServiceSupabase();
  const sessionIds = family.rows.map((row) => row.id);

  const { error: messagesError } = await supabase
    .from('zelochat_messages')
    .delete()
    .eq('empresa_id', empresaId)
    .in('session_id', sessionIds);

  if (messagesError) {
    throw new Error(messagesError.message);
  }

  const { error: sessionsError } = await supabase
    .from('zelochat_sessions')
    .delete()
    .eq('empresa_id', empresaId)
    .in('id', sessionIds);

  if (sessionsError) {
    throw new Error(sessionsError.message);
  }
}

export async function updateSessionName(
  jid: string,
  name: string,
  empresaId: string,
): Promise<void> {
  if (!empresaId) return;

  const family = await fetchSessionFamily(empresaId, jid);
  if (!family) return;

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('zelochat_sessions')
    .update({ customer_name: name.trim(), updated_at: new Date().toISOString() })
    .in('id', family.rows.map((row) => row.id));

  if (error) throw new Error(error.message);
}

/**
 * Persists an inbound webhook message and broadcasts to the dashboard.
 *
 * P0.2 — `empresaId` is REQUIRED. The previous fallback to
 * `getBoundEmpresaId()` was a footgun in multi-tenant deploys: if the
 * webhook handler ever forgot to thread empresaId, the singleton (which
 * could be NULL when count !== 1, or stale otherwise) silently
 * mis-attributed messages.
 *
 * Returns `true` when the message was newly persisted, `false` when it was a
 * duplicate webhook delivery (already persisted by an earlier call) and the
 * caller should SKIP auto-reply scheduling. See `upsertInboundUserMessage`
 * for the dedup contract (P0.14).
 */
export async function handleIncomingMessage(msg: any, empresaId: string): Promise<boolean> {
  if (!empresaId) {
    console.warn('[MessageHandler] Ignoring inbound message — empresaId is required.');
    return false;
  }
  const jid = msg.key.remoteJid;
  if (!jid) return false;
  return serializeForJid(jid, () => _handleIncomingMessage(msg, empresaId));
}

async function _handleIncomingMessage(msg: any, resolvedEmpresaId: string): Promise<boolean> {
  const jid = msg.key.remoteJid;
  console.log(`[MessageHandler] Incoming message — JID: ${jid} | pushName: ${msg.pushName}`);

  const phone = phoneFromJid(jid);
  const pushName = msg.pushName || formatPhone(phone);
  const sentAt = resolveMessageDate(msg);
  const displayTime = formatClock(sentAt);
  const incomingText = extractText(msg);
  let attachment: ChatAttachment | undefined;

  // Allowed document MIME types — blocks executable/HTML payloads from being stored
  const ALLOWED_DOC_MIMES = new Set([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'audio/ogg', 'audio/mpeg',
    'video/mp4',
  ]);

  function sanitizeFileName(raw: string | null | undefined, fallback: string): string {
    if (!raw) return fallback;
    // Strip path separators and characters that could influence browser behavior
    return raw.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').slice(0, 200) || fallback;
  }

  if (msg.message?.imageMessage) {
    const mime = msg.message.imageMessage.mimetype || 'image/jpeg';
    attachment = {
      type: 'image',
      mimeType: mime,
      fileName: 'imagem-whatsapp.jpg',
      sizeBytes: msg.message.imageMessage.fileLength
        ? Number(msg.message.imageMessage.fileLength)
        : undefined,
      dataUrl: await extractAttachmentDataUrl(msg, mime, 'imagem-whatsapp.jpg', resolvedEmpresaId),
    };
  } else if (msg.message?.audioMessage) {
    const mime = msg.message.audioMessage.mimetype || 'audio/ogg; codecs=opus';
    attachment = {
      type: 'audio',
      mimeType: mime,
      fileName: 'audio-whatsapp.ogg',
      sizeBytes: msg.message.audioMessage.fileLength
        ? Number(msg.message.audioMessage.fileLength)
        : undefined,
      dataUrl: await extractAttachmentDataUrl(msg, mime, 'audio-whatsapp.ogg', resolvedEmpresaId),
    };
  } else if (msg.message?.documentMessage) {
    const rawMime = msg.message.documentMessage.mimetype || 'application/octet-stream';
    const mime = ALLOWED_DOC_MIMES.has(rawMime) ? rawMime : 'application/octet-stream';
    attachment = {
      type: 'document',
      mimeType: mime,
      fileName: sanitizeFileName(msg.message.documentMessage.fileName, 'documento'),
      sizeBytes: msg.message.documentMessage.fileLength
        ? Number(msg.message.documentMessage.fileLength)
        : undefined,
      dataUrl: await extractAttachmentDataUrl(msg, mime, sanitizeFileName(msg.message.documentMessage.fileName, 'documento'), resolvedEmpresaId),
    };
  }

  const preview =
    attachment ? buildAttachmentPreview(attachment, incomingText || '') : incomingText;
  const storedContent = serializeStructuredMessage({
    text: incomingText || '',
    attachment,
  });

  if (!preview) return false;

  const existing = await fetchSessionFamily(resolvedEmpresaId, jid);

  // Only propose the pushName if the operator hasn't already set a proper name.
  // An existing non-phone name is treated as operator-intent and must be preserved.
  const existingName = existing?.primary?.customer_name ?? null;
  const proposedName = (!existingName || isLikelyPhoneLabel(existingName)) ? pushName : existingName;

  // Store ISO timestamp so the frontend can render "Hoje às HH:MM" / "Ontem às HH:MM"
  // / "DD/MM às HH:MM" relative to the viewer's clock. The legacy "HH:MM" format was
  // ambiguous (a message at 23:01 yesterday looked identical to one at 23:01 today).
  const lastMessageTimeIso = sentAt.toISOString();
  const sessionRow = await ensureSession({
    empresaId: resolvedEmpresaId,
    jid,
    customerName: proposedName,
    customerPhone: formatPhone(phone),
    lastMessage: storedContent,
    lastMessageTime: lastMessageTimeIso,
    // unreadCount intentionally omitted — incremented atomically below via RPC
  });

  // P0.14 — persist the inbound message FIRST and dedup against retried
  // webhook deliveries. We used to bump unread BEFORE the insert, which
  // meant a duplicate Whatsmiau redelivery double-counted unread before we
  // detected it. Reordered: upsert → if duplicate, return false → if new,
  // bump unread + broadcast.
  //
  // wa_message_id comes from msg.key.id (Whatsmiau's webhook payload). If
  // it's missing for some reason (unexpected payload shape, legacy
  // Whatsmiau version), we fall back to the non-dedup insert so the message
  // still persists. The fallback path logs a warning so we notice if it
  // ever fires in prod.
  const waMessageId = (msg.key?.id ?? null) as string | null;

  let storedMsg: ChatMessage;
  if (waMessageId) {
    const upserted = await upsertInboundUserMessage({
      empresaId: resolvedEmpresaId,
      sessionId: sessionRow.id,
      content: storedContent,
      sentAt: sentAt.toISOString(),
      waMessageId,
    });
    if (!upserted) {
      console.log(`[MessageHandler] dedup: skip retry of wa_message_id=${waMessageId} for ${jid}`);
      return false;
    }
    storedMsg = upserted;
  } else {
    console.warn('[MessageHandler] inbound message missing key.id — falling back to non-dedup insert. JID:', jid);
    storedMsg = await insertMessage({
      empresaId: resolvedEmpresaId,
      sessionId: sessionRow.id,
      role: 'user',
      content: storedContent,
      sentAt: sentAt.toISOString(),
    });
  }

  // Atomic increment — runs ONLY for fresh messages. Avoids race condition when
  // two DIFFERENT messages arrive simultaneously (the RPC is atomic at the DB
  // layer); for the same message redelivered, the early-return above prevents
  // re-entry entirely.
  await getServiceSupabase().rpc('zelochat_increment_unread', { p_session_id: sessionRow.id });

  const family = await fetchSessionFamily(resolvedEmpresaId, jid);
  const mappedSession = family
    ? mapSession(family)
    : {
      id: sessionRow.remote_jid,
      customerName: sessionRow.customer_name || pushName,
      customerPhone: sessionRow.customer_phone || formatPhone(phone),
      lastMessage: preview,
      lastMessageTime: displayTime,
      unreadCount: sessionRow.unread_count ?? 0,
      messages: [],
      status: sessionRow.status,
      autoReply: sessionRow.auto_reply ?? true,
    };

  broadcast(
    {
      type: 'message',
      data: {
        sessionId: mappedSession.id,
        customerName: mappedSession.customerName,
        customerPhone: mappedSession.customerPhone,
        message: storedMsg,
        autoReply: mappedSession.autoReply,
        unreadCount: mappedSession.unreadCount,
        lastMessage: preview,
        lastMessageTime: lastMessageTimeIso,
      },
    },
    resolvedEmpresaId,
  );

  // Fire-and-forget audio transcription. Kicked off AFTER the message broadcast
  // so the frontend has the message in state before our 'pending' message_update
  // patch arrives — otherwise the patch lands on a missing message and the
  // "Transcrevendo áudio…" placeholder is silently dropped. Errors stay inside
  // transcribeAudio (status='failed'), never bubbling back to the webhook.
  if (attachment?.type === 'audio') {
    void transcribeAudio({
      empresaId: resolvedEmpresaId,
      jid,
      messageId: storedMsg.id,
      audioUrl: attachment.dataUrl,
      mimeType: attachment.mimeType,
      fileName: attachment.fileName,
      sizeBytes: attachment.sizeBytes,
    });
  }

  // P0.14 — signal "freshly persisted, run downstream side-effects" to the
  // caller in `index.ts` so the AI auto-reply is scheduled. Returning false
  // anywhere above this line means a duplicate webhook delivery — caller
  // MUST skip auto-reply or the dedup is defeated.
  return true;
}

export async function addAssistantMessage(
  jid: string,
  content: string | null,
  toolCalls: any[] | undefined,
  empresaId: string,
  attachment?: ChatAttachment,
): Promise<void> {
  if (!empresaId) {
    console.warn('[MessageHandler] Ignoring outbound persistence because no empresa is bound yet.');
    return;
  }

  const text = content ?? '';
  const storedContent =
    text || attachment ? serializeStructuredMessage({ text, attachment }) : null;
  const preview = attachment
    ? buildAttachmentPreview(attachment, text)
    : text || (toolCalls ? '[Ação interna]' : '');
  // Do NOT update last_message_time here — that field reflects the *customer's* last
  // message specifically (so the conversation list shows "Ontem às 23:01" relative to
  // the customer's send time, not when the operator/AI replied). Sort order in the
  // list is driven by updated_at, which still bumps via ensureSession.
  const sessionRow = await ensureSession({
    empresaId,
    jid,
    customerPhone: formatPhone(phoneFromJid(jid)),
    lastMessage: storedContent || '',
  });

  const storedMsg = await insertMessage({
    empresaId,
    sessionId: sessionRow.id,
    role: 'assistant',
    content: storedContent,
    tool_calls: toolCalls,
    sentAt: new Date().toISOString(),
  });

  const family = await fetchSessionFamily(empresaId, jid);
  const mappedSession = family ? mapSession(family) : null;

  broadcast(
    {
      type: 'message_sent',
      data: {
        sessionId: mappedSession?.id || jid,
        customerName: mappedSession?.customerName,
        customerPhone: mappedSession?.customerPhone,
        message: storedMsg,
        autoReply: mappedSession?.autoReply,
        lastMessage: preview,
        // Use the family's stored last_message_time (customer's last send) so the list
        // doesn't briefly flip to the operator's send time and back on refresh.
        lastMessageTime: mappedSession?.lastMessageTime || storedMsg.timestamp,
      },
    },
    empresaId,
  );
}

export async function addToolMessage(
  jid: string,
  content: string,
  toolCallId: string,
  empresaId: string,
): Promise<void> {
  if (!empresaId) return;

  const sessionRow = await ensureSession({
    empresaId,
    jid,
    customerPhone: formatPhone(phoneFromJid(jid)),
  });

  const storedMsg = await insertMessage({
    empresaId,
    sessionId: sessionRow.id,
    role: 'tool',
    content,
    tool_call_id: toolCallId,
    sentAt: new Date().toISOString(),
  });

  const family = await fetchSessionFamily(empresaId, jid);
  const mappedSession = family ? mapSession(family) : null;

  broadcast(
    {
      type: 'message_sent',
      data: {
        sessionId: mappedSession?.id || jid,
        customerName: mappedSession?.customerName,
        customerPhone: mappedSession?.customerPhone,
        message: storedMsg,
        autoReply: mappedSession?.autoReply,
        lastMessage: '[Tool Result]',
        lastMessageTime: mappedSession?.lastMessageTime || storedMsg.timestamp,
      },
    },
    empresaId,
  );
}

export async function setAutoReply(
  jid: string,
  enabled: boolean,
  empresaId: string,
): Promise<void> {
  if (!empresaId) {
    return;
  }

  const family = await fetchSessionFamily(empresaId, jid);
  if (!family) {
    return;
  }

  const supabase = getServiceSupabase();
  const { error } = await supabase
    .from('zelochat_sessions')
    .update({
      auto_reply: enabled,
      updated_at: new Date().toISOString(),
    })
    .in('id', family.rows.map((row) => row.id));

  if (error) {
    throw new Error(error.message);
  }
}
