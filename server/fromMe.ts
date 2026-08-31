import { createHash } from 'node:crypto';
import type { OutboundPayload, PersistedOutboundPayload } from '../src/domain/outbound.js';
import { fingerprintOutboundPayload } from './outbound/providerAdapter.js';

export type FromMeDecision =
  | { kind: 'duplicate' }
  | { kind: 'server_echo'; jobId: string; repair: boolean }
  | { kind: 'pending_correlation'; jobId: string }
  | { kind: 'native_human' }
  | { kind: 'ignore_protocol_artifact' };

export interface ExtractedFromMeMessage {
  waMessageId: string;
  remoteJid: string;
  payload: OutboundPayload | PersistedOutboundPayload | Record<string, unknown>;
  preview: string;
  sentAt: string;
  fingerprint: string;
  protocolArtifact: boolean;
}

export interface FromMeEvidence {
  existingMessage?: { origin: string | null; jobId: string | null } | null;
  providerJob?: { id: string; messageId: string | null } | null;
  legacyTracked?: boolean;
  pendingJob?: { id: string; payloadFingerprint: string | null; providerMessageId: string | null } | null;
}

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'documentWithCaptionMessage', 'editedMessage'] as const;
const clean = (value: unknown, max = 500): string => typeof value === 'string'
  ? value.replace(/[\r\n]+/g, ' ').replace(/[`<>]/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim().slice(0, max)
  : '';

function unwrap(message: any): { message: any; deviceSent: boolean } {
  let current = message;
  for (let depth = 0; depth < 8; depth += 1) {
    if (!current || typeof current !== 'object') break;
    if (current.deviceSentMessage?.message) return { message: current.deviceSentMessage.message, deviceSent: true };
    const wrapper = WRAPPERS.find((key) => current[key]?.message);
    if (wrapper) { current = current[wrapper].message; continue; }
    if (current.protocolMessage?.editedMessage) { current = current.protocolMessage.editedMessage; continue; }
    break;
  }
  return { message: current, deviceSent: false };
}

function sentAt(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const parsed = new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return new Date().toISOString();
}

function bytesFrom(data: any, message: any): Uint8Array | null {
  const raw = message?.base64 ?? data?.base64;
  if (typeof raw !== 'string' || !raw || raw.startsWith('[base64 stripped:')) return null;
  try { return Buffer.from(raw.replace(/^data:[^,]+,/, ''), 'base64'); } catch { return null; }
}

function mediaPayload(kind: 'media' | 'audio' | 'sticker', node: any, bytes: Uint8Array): PersistedOutboundPayload {
  const mimeType = clean(node?.mimetype, 120) || (kind === 'audio' ? 'audio/ogg; codecs=opus' : kind === 'sticker' ? 'image/webp' : 'application/octet-stream');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  const common = { storagePath: `native/${checksum}`, mimeType, fileName: clean(node?.fileName, 200) || `mensagem-${kind}`, sizeBytes: bytes.byteLength, checksum };
  if (kind === 'audio') return { kind, ...common, ptt: Boolean(node?.ptt) };
  if (kind === 'media') return { kind, ...common, caption: clean(node?.caption, 1000) || undefined };
  return { kind, ...common };
}

function safePreview(payload: OutboundPayload | PersistedOutboundPayload | Record<string, unknown>): string {
  const item = payload as any;
  switch (item.kind) {
    case 'text': return clean(item.text, 1000);
    case 'media': return clean(item.caption, 1000) || '[Mídia]';
    case 'audio': return '[Áudio]';
    case 'sticker': return '[Figurinha]';
    case 'buttons': return clean(item.text, 1000) || '[Botões]';
    case 'contact': return `[Contato] ${clean(item.displayName)}`.trim();
    case 'list': return clean(item.body, 1000) || '[Lista]';
    case 'location': return `[Localização] ${clean(item.name)}`.trim();
    case 'poll': return `[Enquete] ${clean(item.name)}`.trim();
    case 'reaction': return `[Reação] ${clean(item.emoji, 20)}`.trim();
    default: return '[Mensagem]';
  }
}

async function extractVisiblePayload(data: any, message: any): Promise<{ payload: any; fingerprint: string }> {
  let payload: any;
  let mediaBytes: Uint8Array | null = null;
  if (typeof message?.conversation === 'string' || typeof message?.extendedTextMessage?.text === 'string') {
    payload = { kind: 'text', text: message.conversation ?? message.extendedTextMessage.text };
  } else if (message?.imageMessage || message?.videoMessage || message?.documentMessage) {
    const node = message.imageMessage ?? message.videoMessage ?? message.documentMessage;
    mediaBytes = bytesFrom(data, node);
    if (!mediaBytes) throw new Error('FROM_ME_FINGERPRINT_UNAVAILABLE');
    payload = mediaPayload('media', node, mediaBytes);
  } else if (message?.audioMessage) {
    mediaBytes = bytesFrom(data, message.audioMessage);
    if (!mediaBytes) throw new Error('FROM_ME_FINGERPRINT_UNAVAILABLE');
    payload = mediaPayload('audio', message.audioMessage, mediaBytes);
  } else if (message?.stickerMessage) {
    mediaBytes = bytesFrom(data, message.stickerMessage);
    if (!mediaBytes) throw new Error('FROM_ME_FINGERPRINT_UNAVAILABLE');
    payload = mediaPayload('sticker', message.stickerMessage, mediaBytes);
  } else if (message?.buttonsMessage) {
    payload = { kind: 'buttons', text: message.buttonsMessage.contentText ?? message.buttonsMessage.text ?? '', buttons: (message.buttonsMessage.buttons ?? []).map((button: any) => ({ id: String(button.buttonId ?? button.id ?? ''), label: String(button.buttonText?.displayText ?? button.displayText ?? '') })) };
  } else if (message?.contactMessage || message?.contactsArrayMessage) {
    const contact = message.contactMessage ?? message.contactsArrayMessage.contacts?.[0];
    payload = { kind: 'contact', displayName: contact?.displayName ?? 'Contato', vcard: contact?.vcard ?? '' };
  } else if (message?.listMessage) {
    payload = { kind: 'list', body: message.listMessage.description ?? message.listMessage.text ?? '', buttonText: message.listMessage.buttonText ?? 'Ver opções', sections: message.listMessage.sections ?? [] };
  } else if (message?.locationMessage) {
    payload = { kind: 'location', latitude: Number(message.locationMessage.degreesLatitude), longitude: Number(message.locationMessage.degreesLongitude), name: clean(message.locationMessage.name), address: clean(message.locationMessage.address) };
  } else if (message?.pollCreationMessage || message?.pollCreationMessageV3) {
    const poll = message.pollCreationMessage ?? message.pollCreationMessageV3;
    payload = { kind: 'poll', name: poll.name ?? '', options: (poll.options ?? []).map((option: any) => String(option.optionName ?? option)), selectableCount: Number(poll.selectableOptionsCount ?? 1) };
  } else if (message?.reactionMessage) {
    payload = { kind: 'reaction', targetMessageId: message.reactionMessage.key?.id ?? '', emoji: message.reactionMessage.text ?? '', targetFromMe: Boolean(message.reactionMessage.key?.fromMe) };
  } else {
    throw new Error('FROM_ME_PROTOCOL_ARTIFACT');
  }
  const fingerprint = mediaBytes
    ? await fingerprintOutboundPayload(payload, { bytes: mediaBytes, mimeType: payload.mimeType, transportUrl: 'native://from-me' })
    : await fingerprintOutboundPayload(payload);
  return { payload, fingerprint };
}

export async function extractFromMeMessage(data: any): Promise<ExtractedFromMeMessage> {
  const remoteJid = typeof data?.key?.remoteJid === 'string' ? data.key.remoteJid : '';
  const waMessageId = typeof data?.key?.id === 'string' ? data.key.id : '';
  const { message, deviceSent } = unwrap(data?.message);
  const nonIndividual = !remoteJid.endsWith('@s.whatsapp.net') || remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast');
  const protocolOnly = deviceSent || nonIndividual || !data?.key?.fromMe || !message || Boolean(message.protocolMessage || message.senderKeyDistributionMessage || message.receiptMessage);
  if (protocolOnly) return { waMessageId, remoteJid, payload: { kind: 'protocol' }, preview: '', sentAt: sentAt(data?.messageTimestamp), fingerprint: '', protocolArtifact: true };
  if (!waMessageId || !remoteJid) throw new Error('FROM_ME_IDENTITY_MISSING');
  try {
    const { payload, fingerprint } = await extractVisiblePayload(data, message);
    return { waMessageId, remoteJid, payload, preview: safePreview(payload), sentAt: sentAt(data?.messageTimestamp), fingerprint, protocolArtifact: false };
  } catch (error) {
    if (error instanceof Error && error.message === 'FROM_ME_PROTOCOL_ARTIFACT') return { waMessageId, remoteJid, payload: { kind: 'protocol' }, preview: '', sentAt: sentAt(data?.messageTimestamp), fingerprint: '', protocolArtifact: true };
    throw error;
  }
}

export function classifyFromMe(message: ExtractedFromMeMessage, evidence: FromMeEvidence): FromMeDecision {
  if (message.protocolArtifact) return { kind: 'ignore_protocol_artifact' };
  if (evidence.existingMessage?.origin === 'human_native_whatsapp') return { kind: 'duplicate' };
  if (evidence.providerJob) return { kind: 'server_echo', jobId: evidence.providerJob.id, repair: !evidence.providerJob.messageId };
  if (evidence.existingMessage?.jobId) return { kind: 'server_echo', jobId: evidence.existingMessage.jobId, repair: false };
  if (evidence.existingMessage) return { kind: 'duplicate' };
  if (evidence.legacyTracked) return { kind: 'server_echo', jobId: `legacy:${message.waMessageId}`, repair: true };
  if (evidence.pendingJob && !evidence.pendingJob.providerMessageId && evidence.pendingJob.payloadFingerprint === message.fingerprint) return { kind: 'pending_correlation', jobId: evidence.pendingJob.id };
  return { kind: 'native_human' };
}
