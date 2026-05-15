import React, { useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  Clock,
  CornerUpLeft,
  ExternalLink,
  FileAudio,
  FileText,
  FileVideo,
  ImageOff,
  Loader2,
  MoreVertical,
  Package,
  Pause,
  Play,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import type { ChatMessage, MessageReaction, MessageStatus } from '../../types';
import { normalizeWhatsAppTextFormatting, parseStructuredMessage } from '../../domain/chat';
import { parseChatEventCard, type ChatEventCardData, type ChatEventTone } from '../../domain/chatFeedback';
import type { OrderFocusRequest } from '../../domain/orderFocus';
import { Modal, useModalTitleId } from '../Modal';

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatAttachmentSize(sizeBytes?: number): string {
  if (!sizeBytes) return 'Arquivo';
  if (sizeBytes < 1024 * 1024) return `${Math.max(sizeBytes / 1024, 1).toFixed(0)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Estimate audio duration from file size (~16 KB per second for ogg). */
function estimateAudioDuration(sizeBytes?: number): string {
  if (!sizeBytes) return '0:00';
  const seconds = Math.round(sizeBytes / 16384);
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Deterministic pseudo-random bar heights from a string seed (message id). */
function seededBars(seed: string, count: number): number[] {
  const bars: number[] = [];
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  for (let i = 0; i < count; i++) {
    h = (Math.imul(1664525, h) + 1013904223) | 0;
    bars.push(20 + (Math.abs(h) % 80));
  }
  return bars;
}

/* ─── Status ticks (WhatsApp-accurate SVGs) ──────────────────────── */

function MessageTicks({ status }: { status?: MessageStatus }) {
  if (!status || status === 'sent') {
    return (
      <svg width="16" height="11" viewBox="0 0 16 11" className="inline-block flex-shrink-0 ml-0.5">
        <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178L6.12 6.312 4.33 4.36a.453.453 0 0 0-.31-.154.5.5 0 0 0-.378.15.554.554 0 0 0-.163.39c0 .143.054.284.163.39l2.173 2.378a.463.463 0 0 0 .353.168.507.507 0 0 0 .37-.163l4.77-6.085a.553.553 0 0 0 .126-.373.485.485 0 0 0-.163-.358z"
          fill="#8696a0" />
      </svg>
    );
  }
  const color = status === 'read' ? '#53bdeb' : '#8696a0';
  return (
    <svg width="16" height="11" viewBox="0 0 16 11" className="inline-block flex-shrink-0 ml-0.5">
      <path d="M11.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178L6.12 6.312 4.33 4.36a.453.453 0 0 0-.31-.154.5.5 0 0 0-.378.15.554.554 0 0 0-.163.39c0 .143.054.284.163.39l2.173 2.378a.463.463 0 0 0 .353.168.507.507 0 0 0 .37-.163l4.77-6.085a.553.553 0 0 0 .126-.373.485.485 0 0 0-.163-.358z"
        fill={color} />
      <path d="M15.071.653a.457.457 0 0 0-.304-.102.493.493 0 0 0-.381.178l-4.266 5.583-1.41-1.543a.009.009 0 0 0-.003.003l-.353.462 1.391 1.52a.463.463 0 0 0 .353.168.507.507 0 0 0 .37-.163l4.77-6.085a.553.553 0 0 0 .126-.373.485.485 0 0 0-.163-.358z"
        fill={color} style={{ opacity: 1 }} />
    </svg>
  );
}

/* ─── Bubble tails (CSS triangles for pixel-perfect WhatsApp look) ── */

function TailOut() {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className="absolute -right-[8px] bottom-0"
      style={{ display: 'block' }}
    >
      <path d="M5 0L0 0L0 13C1 9 8 5.5 8 1C8 .4 6.7 0 5 0Z" fill="#d9fdd3" />
    </svg>
  );
}

function TailIn() {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      className="absolute -left-[8px] bottom-0"
      style={{ display: 'block' }}
    >
      <path d="M3 0L8 0L8 13C7 9 0 5.5 0 1C0 .4 1.3 0 3 0Z" fill="#ffffff" />
    </svg>
  );
}

/* ─── Audio Player (WhatsApp-style) ──────────────────────────────── */

function AudioPlayer({ src, messageId, isOutgoing }: { src: string; messageId: string; isOutgoing: boolean }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState('0:00');
  const bars = seededBars(messageId, 28);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) { el.pause(); setPlaying(false); }
    else { void el.play(); setPlaying(true); }
  };

  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    setProgress((el.currentTime / el.duration) * 100);
  };

  const handleLoadedMetadata = () => {
    const el = audioRef.current;
    if (!el || !isFinite(el.duration)) return;
    const m = Math.floor(el.duration / 60);
    const s = Math.floor(el.duration % 60);
    setDuration(`${m}:${s.toString().padStart(2, '0')}`);
  };

  const handleEnded = () => { setPlaying(false); setProgress(0); };

  const activeColor = isOutgoing ? '#3EB489' : '#8696A0';
  const inactiveColor = isOutgoing ? 'rgba(62,180,137,0.3)' : 'rgba(134,150,160,0.25)';

  return (
    <div className="flex items-center gap-2.5" style={{ minWidth: 200 }}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        className="hidden"
      />

      {/* Play/Pause circle */}
      <button
        onClick={togglePlay}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
        style={{ background: activeColor }}
      >
        {playing
          ? <Pause className="w-3.5 h-3.5 text-white" strokeWidth={2.5} fill="white" />
          : <Play className="w-3.5 h-3.5 text-white translate-x-px" strokeWidth={2.5} fill="white" />}
      </button>

      {/* Waveform */}
      <div className="flex-1 flex flex-col gap-1">
        <div className="flex items-end gap-[2px] h-[26px]">
          {bars.map((height, i) => {
            const pct = (i / bars.length) * 100;
            return (
              <div
                key={i}
                className="flex-1 rounded-full"
                style={{
                  height: `${height}%`,
                  minWidth: 2,
                  background: pct <= progress ? activeColor : inactiveColor,
                  transition: 'background 0.1s',
                }}
              />
            );
          })}
        </div>
        <span className="text-[10px] leading-none" style={{ color: '#8696a0' }}>{duration}</span>
      </div>
    </div>
  );
}

/* ─── Audio transcript (Whisper, optional) ──────────────────────── */

function AudioTranscript({
  status,
  transcript,
}: {
  status?: ChatMessage['audio_transcript_status'];
  transcript?: string | null;
}) {
  if (!status) return null;

  const baseStyle: React.CSSProperties = {
    marginTop: 6,
    paddingTop: 6,
    borderTop: '1px solid rgba(11,20,26,0.06)',
    fontSize: 12.5,
    lineHeight: 1.35,
    color: '#54656f',
    fontStyle: 'italic',
  };

  if (status === 'pending') {
    return (
      <div style={baseStyle}>
        <span aria-live="polite">Transcrevendo áudio…</span>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div style={{ ...baseStyle, color: '#8696a0' }}>
        Não foi possível transcrever
      </div>
    );
  }

  if (!transcript) return null;

  return (
    <div style={baseStyle}>
      <span aria-label="Transcrição do áudio">{transcript}</span>
    </div>
  );
}

/* ─── Lightbox (image/video full-screen viewer) ──────────────────── */

function Lightbox({ type, src, alt, onClose }: { type: 'image' | 'video'; src: string; alt?: string; onClose: () => void }) {
  const titleId = useModalTitleId();
  const title = type === 'image' ? 'Visualização da imagem' : 'Visualização do vídeo';

  return (
    <Modal
      open
      onClose={onClose}
      titleId={titleId}
      containerClassName="fixed inset-0 z-[200] flex items-center justify-center p-4"
      backdropClassName="absolute inset-0 bg-black/90"
      panelLayoutClassName="max-w-[90vw] max-h-[90vh]"
      panelClassName="outline-none"
    >
      <h3 id={titleId} className="sr-only">{title}</h3>
      <button
        onClick={onClose}
        aria-label="Fechar"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors z-10"
      >
        <X className="w-5 h-5" strokeWidth={2} />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="max-w-[90vw] max-h-[90vh]">
        {type === 'image' ? (
          <img src={src} alt={alt ?? 'Imagem'} className="max-w-full max-h-[90vh] rounded-lg object-contain" />
        ) : (
          <video src={src} controls autoPlay className="max-w-full max-h-[90vh] rounded-lg" />
        )}
      </div>
    </Modal>
  );
}

type WhatsAppTextPart =
  | { type: 'text'; text: string }
  | { type: 'bold' | 'italic' | 'strike' | 'code'; text: string };

function parseWhatsAppText(text: string): WhatsAppTextPart[] {
  const normalized = normalizeWhatsAppTextFormatting(text);
  const parts: WhatsAppTextPart[] = [];
  let i = 0;
  let buffer = '';

  const pushText = () => {
    if (buffer) {
      parts.push({ type: 'text', text: buffer });
      buffer = '';
    }
  };

  while (i < normalized.length) {
    if (normalized.startsWith('```', i)) {
      const end = normalized.indexOf('```', i + 3);
      if (end !== -1) {
        pushText();
        parts.push({ type: 'code', text: normalized.slice(i + 3, end) });
        i = end + 3;
        continue;
      }
    }

    const marker = normalized[i];
    const type = marker === '*' ? 'bold' : marker === '_' ? 'italic' : marker === '~' ? 'strike' : null;
    if (type) {
      const prev = i === 0 ? '' : normalized[i - 1];
      const next = normalized[i + 1] ?? '';
      const canOpen = !/\s/.test(next) && !/[A-Za-z0-9À-ÿ]/.test(prev);
      if (canOpen) {
        const end = normalized.indexOf(marker, i + 1);
        if (end !== -1 && end > i + 1 && !/\s/.test(normalized[end - 1] ?? '')) {
          pushText();
          parts.push({ type, text: normalized.slice(i + 1, end) });
          i = end + 1;
          continue;
        }
      }
    }

    buffer += normalized[i];
    i += 1;
  }

  pushText();
  return parts;
}

function WhatsAppText({ text }: { text: string }) {
  return (
    <>
      {parseWhatsAppText(text).map((part, index) => {
        const key = `${part.type}-${index}`;
        if (part.type === 'bold') return <strong key={key}>{part.text}</strong>;
        if (part.type === 'italic') return <em key={key}>{part.text}</em>;
        if (part.type === 'strike') return <s key={key}>{part.text}</s>;
        if (part.type === 'code') {
          return (
            <code key={key} className="rounded bg-black/5 px-1 py-0.5 font-mono text-[0.95em]">
              {part.text}
            </code>
          );
        }
        return <React.Fragment key={key}>{part.text}</React.Fragment>;
      })}
    </>
  );
}

/* ─── Document icon helper ───────────────────────────────────────── */

function docIcon(mimeType: string) {
  if (mimeType.startsWith('audio/')) return <FileAudio className="h-5 w-5" strokeWidth={1.8} />;
  if (mimeType.startsWith('video/')) return <FileVideo className="h-5 w-5" strokeWidth={1.8} />;
  return <FileText className="h-5 w-5" strokeWidth={1.8} />;
}

/* ─── Timestamp + Ticks row (reused in every bubble type) ────────── */

function formatClock(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return value; // legacy bare "HH:MM" — pass through
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
}

function MetaRow({ timestamp, isOutgoing, status }: { timestamp: string; isOutgoing: boolean; status?: MessageStatus }) {
  return (
    <span className="float-right relative ml-2 -mb-1 flex items-center gap-0.5 whitespace-nowrap" style={{ top: 5 }}>
      <span className="text-[11px] leading-none select-none" style={{ color: '#667781' }}>
        {formatClock(timestamp)}
      </span>
      {isOutgoing && <MessageTicks status={status} />}
    </span>
  );
}

function eventToneStyles(tone: ChatEventTone) {
  switch (tone) {
    case 'success':
      return {
        card: 'border-emerald-200 bg-emerald-50/95',
        icon: 'bg-emerald-100 text-emerald-700',
        badge: 'bg-emerald-100 text-emerald-800',
        subtitle: 'text-emerald-900/75',
        detailWrap: 'bg-white/75 border border-emerald-100',
        detailText: 'text-emerald-950',
        button: 'bg-emerald-600 text-white hover:bg-emerald-700',
      };
    case 'pending':
      return {
        card: 'border-amber-200 bg-amber-50/95',
        icon: 'bg-amber-100 text-amber-700',
        badge: 'bg-amber-100 text-amber-800',
        subtitle: 'text-amber-900/75',
        detailWrap: 'bg-white/75 border border-amber-100',
        detailText: 'text-amber-950',
        button: 'bg-amber-600 text-white hover:bg-amber-700',
      };
    case 'warning':
      return {
        card: 'border-orange-200 bg-orange-50/95',
        icon: 'bg-orange-100 text-orange-700',
        badge: 'bg-orange-100 text-orange-800',
        subtitle: 'text-orange-950/70',
        detailWrap: 'bg-white/75 border border-orange-100',
        detailText: 'text-orange-950',
        button: 'bg-orange-600 text-white hover:bg-orange-700',
      };
    case 'danger':
      return {
        card: 'border-rose-200 bg-rose-50/95',
        icon: 'bg-rose-100 text-rose-700',
        badge: 'bg-rose-100 text-rose-800',
        subtitle: 'text-rose-950/70',
        detailWrap: 'bg-white/75 border border-rose-100',
        detailText: 'text-rose-950',
        button: 'bg-rose-600 text-white hover:bg-rose-700',
      };
    case 'info':
    default:
      return {
        card: 'border-sky-200 bg-sky-50/95',
        icon: 'bg-sky-100 text-sky-700',
        badge: 'bg-sky-100 text-sky-800',
        subtitle: 'text-sky-950/70',
        detailWrap: 'bg-white/75 border border-sky-100',
        detailText: 'text-sky-950',
        button: 'bg-sky-600 text-white hover:bg-sky-700',
      };
  }
}

function EventIcon({ event }: { event: ChatEventCardData }) {
  const className = 'h-[18px] w-[18px]';
  switch (event.kind) {
    case 'order_confirmed':
    case 'order_already_confirmed':
      return <Check className={className} strokeWidth={2.3} />;
    case 'pending_confirmation':
    case 'pending_text_confirmation':
    case 'pending_order_echo':
      return <Clock className={className} strokeWidth={2.1} />;
    case 'pending_pix_receipt':
      return <Sparkles className={className} strokeWidth={2.1} />;
    case 'escalated':
    case 'tool_error':
      return <AlertTriangle className={className} strokeWidth={2.1} />;
    case 'manager_notified':
      return <Bell className={className} strokeWidth={2.1} />;
    default:
      return <Package className={className} strokeWidth={2.1} />;
  }
}

/* ─── Reaction badge ─────────────────────────────────────────────── */

function ReactionBadge({ reactions, isOutgoing }: { reactions: MessageReaction[]; isOutgoing: boolean }) {
  if (!reactions.length) return null;
  const grouped: Record<string, number> = {};
  for (const r of reactions) grouped[r.emoji] = (grouped[r.emoji] ?? 0) + 1;
  return (
    <div className={`flex gap-0.5 ${isOutgoing ? 'justify-end pr-1' : 'justify-start pl-1'}`} style={{ marginTop: -4 }}>
      {Object.entries(grouped).map(([emoji, count]) => (
        <span
          key={emoji}
          className="flex items-center gap-0.5 rounded-full bg-white border border-black/10 shadow-sm select-none"
          style={{ fontSize: 13, lineHeight: 1, padding: '2px 5px' }}
        >
          {emoji}
          {count > 1 && <span style={{ fontSize: 10, color: '#8696a0', marginLeft: 1 }}>{count}</span>}
        </span>
      ))}
    </div>
  );
}

/* ─── Quoted message preview (inside bubble) ─────────────────────── */

function QuotedPreview({ preview, fromMe, isOutgoing }: { preview: string; fromMe?: boolean; isOutgoing: boolean }) {
  const accentColor = fromMe ? '#3EB489' : '#8696a0';
  return (
    <div
      style={{
        borderLeft: `4px solid ${accentColor}`,
        background: isOutgoing ? 'rgba(0,0,0,0.06)' : 'rgba(0,0,0,0.04)',
        borderRadius: 6,
        padding: '5px 8px',
        marginBottom: 4,
        maxWidth: '100%',
        overflow: 'hidden',
      }}
    >
      <p style={{ fontSize: 12, color: accentColor, fontWeight: 600, margin: '0 0 1px 0' }}>
        {fromMe ? 'Você' : 'Cliente'}
      </p>
      <p
        style={{ fontSize: 12.5, color: '#111b21', margin: 0, opacity: 0.75, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {preview}
      </p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   Main MessageBubble component
   ═══════════════════════════════════════════════════════════════════ */

export interface MessageBubbleProps {
  message: ChatMessage;
  isLastInGroup: boolean;
  profilePicUrl?: string;
  customerName: string;
  sessionCustomerPhone?: string;
  onDelete?: (message: ChatMessage) => void | Promise<void>;
  isDeleting?: boolean;
  onOpenOrder?: (request: OrderFocusRequest) => void;
  onReply?: (message: ChatMessage) => void;
}

const DRAG_THRESHOLD = 60;

const MessageBubbleInner = React.memo(function MessageBubble({
  message,
  isLastInGroup,
  profilePicUrl,
  customerName,
  sessionCustomerPhone,
  onDelete,
  isDeleting = false,
  onOpenOrder,
  onReply,
}: MessageBubbleProps) {
  const isOutgoing = message.role === 'assistant';
  const [lightbox, setLightbox] = useState<{ type: 'image' | 'video'; src: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragX, setDragX] = useState(0);
  const touchStartX = useRef<number>(0);
  const dragging = useRef(false);

  /* System messages handled elsewhere */
  const isSystem = message.kind === 'text' && (message.content ?? '').includes('[SISTEMA]');
  if (isSystem) return null;

  const hasTail = isLastInGroup;

  const parsed = parseStructuredMessage(message.content ?? '');
  const displayText = parsed.text ?? '';
  const eventCard = parseChatEventCard(message, sessionCustomerPhone);

  const deleteMenuButton = isOutgoing && message.waMessageId && onDelete ? (
    <div className="absolute right-1 top-1 z-30">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setMenuOpen((open) => !open);
        }}
        disabled={isDeleting}
        title="Opções da mensagem"
        aria-label="Opções da mensagem"
        className="flex h-6 w-6 items-center justify-center rounded-md bg-white/75 text-[#667781] opacity-80 transition-all hover:bg-white hover:text-[#111b21] focus:opacity-100 disabled:cursor-wait disabled:opacity-70 group-hover/bubble:opacity-100"
      >
        {isDeleting
          ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.9} />
          : <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />}
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-label="Fechar menu"
            className="fixed inset-0 z-20 cursor-default"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-0 top-7 z-40 w-56 overflow-hidden rounded-lg border border-black/5 bg-white py-1 shadow-lg">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                void onDelete(message);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-[13px] font-medium text-[#b42318] transition-colors hover:bg-[#fee4e2]"
            >
              <Trash2 className="h-3.5 w-3.5 flex-shrink-0" strokeWidth={1.8} />
              <span>Apagar mensagem para todos</span>
            </button>
          </div>
        </>
      )}
    </div>
  ) : null;

  if (eventCard) {
    const styles = eventToneStyles(eventCard.tone);
    const isEventOutgoing = message.role === 'assistant';
    const canOpenOrder = Boolean(eventCard.focusRequest && eventCard.actionLabel && onOpenOrder);

    return (
      <div
        className={`flex ${isEventOutgoing ? 'justify-end' : 'justify-center'}`}
        style={{ paddingLeft: isEventOutgoing ? 63 : 24, paddingRight: isEventOutgoing ? 24 : 63 }}
      >
        <div className={`group/bubble relative w-full max-w-[430px] overflow-hidden rounded-[20px] border shadow-[0_8px_24px_rgba(15,23,42,0.08)] ${styles.card}`}>
          {deleteMenuButton}

          <div className="flex items-start gap-3 px-4 py-3.5">
            <div className={`mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl ${styles.icon}`}>
              <EventIcon event={eventCard} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[14px] font-semibold text-[var(--color-ink)]">{eventCard.title}</p>
                {eventCard.badge && (
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${styles.badge}`}>
                    {eventCard.badge}
                  </span>
                )}
                {eventCard.sendFailed && (
                  <span className="rounded-full bg-white/85 px-2 py-0.5 text-[10.5px] font-semibold text-orange-700">
                    Reenviar manualmente
                  </span>
                )}
              </div>
              {eventCard.subtitle && (
                <p className={`mt-1 text-[12.5px] leading-relaxed ${styles.subtitle}`}>
                  {eventCard.subtitle}
                </p>
              )}
            </div>
          </div>

          {eventCard.lines.length > 0 && (
            <div className="px-4 pb-3">
              <div className={`rounded-2xl px-3.5 py-3 ${styles.detailWrap}`}>
                <div className="space-y-1.5">
                  {eventCard.lines.map((line, index) => (
                    <p key={`${message.id}-line-${index}`} className={`text-[13px] leading-relaxed whitespace-pre-wrap break-words ${styles.detailText}`}>
                      <WhatsAppText text={line} />
                    </p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {canOpenOrder && eventCard.focusRequest && (
            <div className="px-4 pb-3">
              <button
                type="button"
                onClick={() => onOpenOrder(eventCard.focusRequest!)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[12.5px] font-semibold transition-colors ${styles.button}`}
              >
                <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.1} />
                {eventCard.actionLabel}
              </button>
            </div>
          )}

          <div className="flex items-center justify-end gap-1.5 px-4 pb-3 text-[11px] text-[var(--color-ink-faint)]">
            <span>{formatClock(message.timestamp)}</span>
            {isOutgoing && <MessageTicks status={message.status} />}
          </div>
        </div>
      </div>
    );
  }

  if (message.role === 'assistant' && message.tool_calls?.length && !displayText) {
    return null;
  }

  /* ── Bubble wrapper styles (WhatsApp-accurate) ── */
  const bubbleStyle: React.CSSProperties = {
    backgroundColor: isOutgoing ? '#d9fdd3' : '#ffffff',
    borderRadius: hasTail
      ? isOutgoing ? '7.5px 7.5px 0 7.5px' : '7.5px 7.5px 7.5px 0'
      : '7.5px',
    boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)',
    maxWidth: message.kind === 'image' || message.kind === 'video' ? 330 : undefined,
    position: 'relative',
  };

  const hasReactions = Boolean(message.reactions?.length);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!onReply) return;
    touchStartX.current = e.touches[0].clientX;
    dragging.current = false;
  };
  const handleTouchMove = (e: React.TouchEvent) => {
    if (!onReply) return;
    const dx = e.touches[0].clientX - touchStartX.current;
    if (dx > 0 && dx < 120) { setDragX(dx); dragging.current = true; }
  };
  const handleTouchEnd = () => {
    if (!onReply) return;
    if (dragX >= DRAG_THRESHOLD) onReply(message);
    setDragX(0);
    dragging.current = false;
  };

  return (
    <>
      {lightbox && (
        <Lightbox
          type={lightbox.type}
          src={lightbox.src}
          alt={message.attachment?.fileName}
          onClose={() => setLightbox(null)}
        />
      )}

      <div
        className={`flex group/row items-center ${isOutgoing ? 'justify-end' : 'justify-start'}`}
        style={{
          paddingLeft: isOutgoing ? 63 : 0,
          paddingRight: isOutgoing ? 0 : 63,
          marginBottom: hasReactions ? 10 : 0,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Desktop reply button — incoming side */}
        {onReply && !isOutgoing && (
          <button
            onClick={() => onReply(message)}
            title="Responder"
            className="mr-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-black/10 bg-white shadow-sm opacity-0 transition-opacity group-hover/row:opacity-100"
          >
            <CornerUpLeft className="h-3.5 w-3.5" style={{ color: '#8696a0' }} />
          </button>
        )}

        <div
          style={{ position: 'relative' }}
          className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
        >
        <div
          style={{
            ...bubbleStyle,
            transform: dragX ? `translateX(${dragX}px)` : undefined,
            transition: dragX ? 'none' : 'transform 0.2s ease-out',
          }}
          className="group/bubble relative"
        >
          {/* Tail */}
          {hasTail && (isOutgoing ? <TailOut /> : <TailIn />)}

          {deleteMenuButton}

          {/* ── Image ── */}
          {message.kind === 'image' && (
            <div style={{ borderRadius: hasTail
              ? isOutgoing ? '7.5px 7.5px 0 0' : '7.5px 7.5px 0 0'
              : '7.5px 7.5px 0 0', overflow: 'hidden', margin: 3 }}>
              {message.attachment?.dataUrl ? (
                <button
                  onClick={() => setLightbox({ type: 'image', src: message.attachment!.dataUrl! })}
                  className="block w-full cursor-pointer focus:outline-none"
                >
                  <img
                    src={message.attachment.dataUrl}
                    alt={message.attachment.fileName}
                    className="w-full object-cover"
                    style={{ maxWidth: 324, maxHeight: 280, borderRadius: 6, display: 'block' }}
                  />
                </button>
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{ width: 280, height: 180, background: '#f0f2f5', borderRadius: 6 }}
                >
                  <ImageOff className="w-8 h-8" strokeWidth={1.5} style={{ color: '#8696a0' }} />
                </div>
              )}
            </div>
          )}

          {/* ── Video ── */}
          {message.kind === 'video' && (
            <div style={{ borderRadius: '6px', overflow: 'hidden', margin: 3, position: 'relative' }}>
              {message.attachment?.dataUrl ? (
                <button
                  onClick={() => setLightbox({ type: 'video', src: message.attachment!.dataUrl! })}
                  className="block w-full cursor-pointer focus:outline-none relative"
                >
                  <video
                    src={message.attachment.dataUrl}
                    className="w-full object-cover"
                    style={{ maxWidth: 324, maxHeight: 280, display: 'block', borderRadius: 6 }}
                    muted
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div
                      className="flex items-center justify-center"
                      style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
                    >
                      <Play className="w-5 h-5 text-white" strokeWidth={2.5} fill="white" style={{ marginLeft: 2 }} />
                    </div>
                  </div>
                </button>
              ) : (
                <div
                  className="flex items-center justify-center"
                  style={{ width: 280, height: 180, background: '#f0f2f5', borderRadius: 6, position: 'relative' }}
                >
                  <div
                    className="flex items-center justify-center"
                    style={{ width: 48, height: 48, borderRadius: '50%', background: 'rgba(0,0,0,0.25)' }}
                  >
                    <Play className="w-5 h-5 text-white" strokeWidth={2.5} fill="white" style={{ marginLeft: 2 }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Audio ── */}
          {message.kind === 'audio' && (
            <div style={{ padding: '8px 10px 4px' }}>
              {message.attachment?.dataUrl ? (
                <AudioPlayer
                  src={message.attachment.dataUrl}
                  messageId={message.id}
                  isOutgoing={isOutgoing}
                />
              ) : (
                <div className="flex items-center gap-2" style={{ color: '#8696a0', fontSize: 12 }}>
                  <FileAudio className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                  <span>Áudio indisponível</span>
                  <span style={{ fontSize: 10.5, color: '#a0aab2' }}>
                    {estimateAudioDuration(message.attachment?.sizeBytes)}
                  </span>
                </div>
              )}
              <AudioTranscript
                status={message.audio_transcript_status}
                transcript={message.audio_transcript}
              />
            </div>
          )}

          {/* ── Document ── */}
          {message.kind === 'document' && message.attachment && (
            <div style={{ padding: '4px 4px 0' }}>
              {message.attachment.dataUrl ? (
                <a
                  href={message.attachment.dataUrl}
                  download={message.attachment.fileName}
                  className="flex items-center gap-3 no-underline"
                  style={{
                    background: isOutgoing ? 'rgba(0,0,0,0.04)' : '#f5f6f6',
                    borderRadius: 8,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{
                      width: 40, height: 40, borderRadius: 8,
                      background: '#00a884', color: 'white',
                    }}
                  >
                    {docIcon(message.attachment.mimeType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ fontSize: 13, fontWeight: 500, color: '#111b21', margin: 0 }}>
                      {message.attachment.fileName}
                    </p>
                    <p style={{ fontSize: 11, color: '#667781', margin: '2px 0 0' }}>
                      {formatAttachmentSize(message.attachment.sizeBytes)}
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className="flex items-center gap-3"
                  style={{
                    background: '#f5f6f6', borderRadius: 8, padding: '10px 12px', opacity: 0.5,
                  }}
                >
                  <div
                    className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 40, height: 40, borderRadius: 8, background: '#d1d7db', color: '#8696a0' }}
                  >
                    {docIcon(message.attachment.mimeType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate" style={{ fontSize: 13, fontWeight: 500, color: '#111b21', margin: 0 }}>
                      {message.attachment.fileName}
                    </p>
                    <p style={{ fontSize: 11, color: '#8696a0', margin: '2px 0 0' }}>
                      Arquivo indisponível
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Text / caption + meta ── */}
          <div style={{
            padding: message.kind === 'text' ? '6px 7px 8px 9px' : '3px 7px 8px 9px',
          }}>
            {message.quotedPreview && (
              <QuotedPreview
                preview={message.quotedPreview}
                fromMe={message.quotedFromMe}
                isOutgoing={isOutgoing}
              />
            )}
            {displayText && (
              <span
                className="break-words whitespace-pre-wrap"
                style={{ fontSize: 14.2, lineHeight: 1.35, color: '#111b21' }}
              >
                <WhatsAppText text={displayText} />
              </span>
            )}
            <MetaRow
              timestamp={message.timestamp}
              isOutgoing={isOutgoing}
              status={message.status}
            />
          </div>
        </div>

        {/* Reaction badges — below the bubble, overlapping slightly */}
        {hasReactions && (
          <ReactionBadge reactions={message.reactions!} isOutgoing={isOutgoing} />
        )}
        </div>

        {/* Desktop reply button — outgoing side */}
        {onReply && isOutgoing && (
          <button
            onClick={() => onReply(message)}
            title="Responder"
            className="ml-1 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border border-black/10 bg-white shadow-sm opacity-0 transition-opacity group-hover/row:opacity-100"
          >
            <CornerUpLeft className="h-3.5 w-3.5" style={{ color: '#8696a0' }} />
          </button>
        )}
      </div>
    </>
  );
});

export { MessageBubbleInner as MessageBubble };
