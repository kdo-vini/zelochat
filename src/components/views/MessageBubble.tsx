import React, { useRef, useState } from 'react';
import { FileAudio, FileText, FileVideo, ImageOff, Loader2, MoreVertical, Pause, Play, Trash2, X } from 'lucide-react';
import type { ChatMessage, MessageStatus } from '../../types';
import { normalizeWhatsAppTextFormatting, parseStructuredMessage } from '../../domain/chat';
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

/* ═══════════════════════════════════════════════════════════════════
   Main MessageBubble component
   ═══════════════════════════════════════════════════════════════════ */

export interface MessageBubbleProps {
  message: ChatMessage;
  isLastInGroup: boolean;
  profilePicUrl?: string;
  customerName: string;
  onDelete?: (message: ChatMessage) => void | Promise<void>;
  isDeleting?: boolean;
}

const MessageBubbleInner = React.memo(function MessageBubble({ message, isLastInGroup, profilePicUrl, customerName, onDelete, isDeleting = false }: MessageBubbleProps) {
  const isOutgoing = message.role === 'assistant';
  const [lightbox, setLightbox] = useState<{ type: 'image' | 'video'; src: string } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  /* System messages handled elsewhere */
  const isSystem = message.kind === 'text' && (message.content ?? '').includes('[SISTEMA]');
  if (isSystem) return null;

  const hasTail = isLastInGroup;

  const parsed = parseStructuredMessage(message.content ?? '');
  const displayText = parsed.text ?? '';

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
        className={`flex ${isOutgoing ? 'justify-end' : 'justify-start'}`}
        style={{ paddingLeft: isOutgoing ? 63 : 0, paddingRight: isOutgoing ? 0 : 63 }}
      >
        <div style={bubbleStyle} className="group/bubble relative">
          {/* Tail */}
          {hasTail && (isOutgoing ? <TailOut /> : <TailIn />)}

          {isOutgoing && message.waMessageId && onDelete && (
            <div className="absolute right-1 top-1 z-30">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((open) => !open);
                }}
                disabled={isDeleting}
                title="OpÃ§Ãµes da mensagem"
                aria-label="OpÃ§Ãµes da mensagem"
                className="flex h-6 w-6 items-center justify-center rounded-md bg-[#d9fdd3]/80 text-[#667781] opacity-70 transition-all hover:bg-white/90 hover:text-[#111b21] focus:opacity-100 disabled:cursor-wait disabled:opacity-70 group-hover/bubble:opacity-100"
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
          )}

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
      </div>
    </>
  );
});

export { MessageBubbleInner as MessageBubble };
