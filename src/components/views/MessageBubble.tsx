import React, { useRef, useState } from 'react';
import { FileAudio, FileText, FileVideo, ImageOff, Pause, Play, X } from 'lucide-react';
import type { ChatMessage, MessageStatus } from '../../types';

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

/* ─── Status ticks ────────────────────────────────────────────────── */

interface TicksProps {
  status?: MessageStatus;
}

function MessageTicks({ status }: TicksProps) {
  if (!status || status === 'sent') {
    // Single grey tick
    return (
      <svg width="14" height="10" viewBox="0 0 14 10" fill="none" className="inline-block flex-shrink-0">
        <path d="M1 5L5 9L13 1" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === 'delivered') {
    // Double grey ticks
    return (
      <svg width="18" height="10" viewBox="0 0 18 10" fill="none" className="inline-block flex-shrink-0">
        <path d="M1 5L5 9L13 1" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M5 5L9 9L17 1" stroke="#8696A0" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  // read — double blue ticks
  return (
    <svg width="18" height="10" viewBox="0 0 18 10" fill="none" className="inline-block flex-shrink-0">
      <path d="M1 5L5 9L13 1" stroke="#53BDEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5 5L9 9L17 1" stroke="#53BDEB" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/* ─── Bubble tail SVGs ─────────────────────────────────────────────── */

function TailOut() {
  return (
    <svg
      className="absolute -right-2 bottom-0"
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M0 14 L0 0 Q10 8 0 14Z" fill="var(--color-wa-bubble-out)" />
    </svg>
  );
}

function TailIn() {
  return (
    <svg
      className="absolute -left-2 bottom-0"
      width="10"
      height="14"
      viewBox="0 0 10 14"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M10 14 L10 0 Q0 8 10 14Z" fill="var(--color-wa-bubble-in)" />
    </svg>
  );
}

/* ─── Audio Player ─────────────────────────────────────────────────── */

interface AudioPlayerProps {
  src: string;
  messageId: string;
  isOutgoing: boolean;
}

function AudioPlayer({ src, messageId, isOutgoing }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const bars = seededBars(messageId, 20);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (playing) {
      el.pause();
      setPlaying(false);
    } else {
      void el.play();
      setPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    const el = audioRef.current;
    if (!el || !el.duration) return;
    setProgress((el.currentTime / el.duration) * 100);
  };

  const handleEnded = () => {
    setPlaying(false);
    setProgress(0);
  };

  const barActiveColor = isOutgoing ? '#25D366' : '#8696A0';
  const barInactiveColor = isOutgoing ? '#25D36660' : '#8696A040';

  return (
    <div className="flex items-center gap-2 w-[220px]">
      <audio
        ref={audioRef}
        src={src}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        className="hidden"
      />
      <button
        onClick={togglePlay}
        aria-label={playing ? 'Pausar áudio' : 'Reproduzir áudio'}
        className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 transition-colors"
        style={{ background: isOutgoing ? '#25D366' : '#8696A0' }}
      >
        {playing
          ? <Pause className="w-4 h-4 text-white" strokeWidth={2} />
          : <Play className="w-4 h-4 text-white translate-x-px" strokeWidth={2} />}
      </button>

      {/* Waveform bars */}
      <div className="flex items-end gap-px flex-1 h-8">
        {bars.map((height, i) => {
          const pct = i / bars.length * 100;
          const active = pct <= progress;
          return (
            <div
              key={i}
              className="flex-1 rounded-sm transition-all duration-75"
              style={{
                height: `${height}%`,
                background: active ? barActiveColor : barInactiveColor,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ─── Lightbox ─────────────────────────────────────────────────────── */

interface LightboxProps {
  type: 'image' | 'video';
  src: string;
  alt?: string;
  onClose: () => void;
}

function Lightbox({ type, src, alt, onClose }: LightboxProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Visualizar mídia"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
      <button
        onClick={onClose}
        aria-label="Fechar"
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X className="w-5 h-5" strokeWidth={2} />
      </button>
      <div onClick={(e) => e.stopPropagation()} className="max-w-[90vw] max-h-[90vh]">
        {type === 'image' ? (
          <img
            src={src}
            alt={alt ?? 'Imagem'}
            className="max-w-full max-h-[90vh] rounded-xl object-contain"
          />
        ) : (
          <video
            src={src}
            controls
            autoPlay
            className="max-w-full max-h-[90vh] rounded-xl"
          />
        )}
      </div>
    </div>
  );
}

/* ─── Document bubble content ──────────────────────────────────────── */

function docIcon(mimeType: string) {
  if (mimeType.startsWith('audio/')) return <FileAudio className="h-5 w-5" strokeWidth={1.8} />;
  if (mimeType.startsWith('video/')) return <FileVideo className="h-5 w-5" strokeWidth={1.8} />;
  return <FileText className="h-5 w-5" strokeWidth={1.8} />;
}

/* ─── Main bubble component ─────────────────────────────────────────── */

export interface MessageBubbleProps {
  message: ChatMessage;
  isLastInGroup: boolean;
  profilePicUrl?: string;
  customerName: string;
}

export function MessageBubble({ message, isLastInGroup, profilePicUrl, customerName }: MessageBubbleProps) {
  const isOutgoing = message.role === 'assistant';
  const [lightbox, setLightbox] = useState<{ type: 'image' | 'video'; src: string } | null>(null);

  const isSystem = message.kind === 'text' && message.content.includes('[SISTEMA]');
  if (isSystem) return null; // System messages rendered separately

  const displayText = message.content;

  /* ── Outgoing bubble (sent by assistant/owner) ── */
  const outgoingBg = 'bg-[var(--color-wa-bubble-out)]';
  const incomingBg = 'bg-[var(--color-wa-bubble-in)]';

  const bubbleBg = isOutgoing ? outgoingBg : incomingBg;
  const bubbleRadius = isOutgoing
    ? 'rounded-2xl rounded-br-sm'
    : 'rounded-2xl rounded-bl-sm';

  /* ── Avatar for incoming messages ── */
  const showAvatar = !isOutgoing && isLastInGroup;

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

      <div className={`flex items-end gap-1.5 ${isOutgoing ? 'justify-end' : 'justify-start'}`}>
        {/* Incoming avatar placeholder — keeps alignment even when not shown */}
        {!isOutgoing && (
          <div className="w-7 h-7 flex-shrink-0 self-end">
            {showAvatar && (
              <div className="w-7 h-7 rounded-full bg-[var(--color-surface-muted)] border border-[var(--color-line)] overflow-hidden flex items-center justify-center">
                {profilePicUrl ? (
                  <img src={profilePicUrl} alt={customerName} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-[10px] font-bold text-[var(--color-ink-faint)] uppercase">
                    {customerName.charAt(0)}
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bubble */}
        <div
          className={`relative max-w-[72%] ${bubbleBg} ${bubbleRadius} shadow-sm`}
          style={{ maxWidth: message.kind === 'image' || message.kind === 'video' ? '280px' : '72%' }}
        >
          {/* Tail */}
          {isLastInGroup && (isOutgoing ? <TailOut /> : <TailIn />)}

          {/* ── Image content ── */}
          {message.kind === 'image' && (
            <div className="overflow-hidden rounded-2xl rounded-b-none">
              {message.attachment?.dataUrl ? (
                <button
                  onClick={() => setLightbox({ type: 'image', src: message.attachment!.dataUrl! })}
                  className="block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  aria-label="Ampliar imagem"
                >
                  <img
                    src={message.attachment.dataUrl}
                    alt={message.attachment.fileName}
                    className="w-full max-h-64 object-cover"
                    style={{ maxWidth: 280 }}
                  />
                </button>
              ) : (
                <div className="flex h-40 w-[280px] items-center justify-center bg-[var(--color-surface-muted)]">
                  <ImageOff className="w-8 h-8 text-[var(--color-ink-faint)]" strokeWidth={1.5} />
                </div>
              )}
            </div>
          )}

          {/* ── Video content ── */}
          {message.kind === 'video' && (
            <div className="overflow-hidden rounded-2xl rounded-b-none relative">
              {message.attachment?.dataUrl ? (
                <button
                  onClick={() => setLightbox({ type: 'video', src: message.attachment!.dataUrl! })}
                  className="relative block w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand)]"
                  aria-label="Reproduzir vídeo"
                >
                  <video
                    src={message.attachment.dataUrl}
                    className="w-full max-h-64 object-cover"
                    style={{ maxWidth: 280 }}
                    muted
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <div className="w-12 h-12 rounded-full bg-white/80 flex items-center justify-center">
                      <Play className="w-5 h-5 text-black translate-x-0.5" strokeWidth={2} />
                    </div>
                  </div>
                </button>
              ) : (
                <div className="relative flex h-40 w-[280px] items-center justify-center bg-[var(--color-surface-muted)]">
                  <div className="w-12 h-12 rounded-full bg-[var(--color-surface)] flex items-center justify-center shadow">
                    <Play className="w-5 h-5 text-[var(--color-ink-muted)] translate-x-0.5" strokeWidth={2} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Audio content ── */}
          {message.kind === 'audio' && (
            <div className="px-3 pt-2.5 pb-1">
              {message.attachment?.dataUrl ? (
                <AudioPlayer
                  src={message.attachment.dataUrl}
                  messageId={message.id}
                  isOutgoing={isOutgoing}
                />
              ) : (
                <div className="flex items-center gap-2 text-[12px] text-[var(--color-ink-muted)]">
                  <FileAudio className="h-4 w-4 flex-shrink-0" strokeWidth={1.8} />
                  <span>Áudio indisponível</span>
                  <span className="text-[10.5px] text-[var(--color-ink-faint)]">
                    {estimateAudioDuration(message.attachment?.sizeBytes)}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Document content ── */}
          {message.kind === 'document' && message.attachment && (
            <div className="px-2 pt-2">
              {message.attachment.dataUrl ? (
                <a
                  href={message.attachment.dataUrl}
                  download={message.attachment.fileName}
                  className="flex items-center gap-3 rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2.5 transition-colors hover:bg-black/10 dark:hover:bg-white/10"
                  aria-label={`Baixar ${message.attachment.fileName}`}
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-brand-soft)] text-[var(--color-brand-deep)]">
                    {docIcon(message.attachment.mimeType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-[var(--color-ink)]">
                      {message.attachment.fileName}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">
                      {formatAttachmentSize(message.attachment.sizeBytes)}
                    </p>
                  </div>
                </a>
              ) : (
                <div
                  className="flex items-center gap-3 rounded-xl bg-black/5 dark:bg-white/5 px-3 py-2.5 opacity-50"
                  aria-disabled="true"
                >
                  <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-[var(--color-surface-muted)] text-[var(--color-ink-faint)]">
                    {docIcon(message.attachment.mimeType)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-semibold text-[var(--color-ink)]">
                      {message.attachment.fileName}
                    </p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">Arquivo indisponível</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Text / caption ── */}
          <div className={`px-3 ${message.kind === 'text' ? 'pt-2' : 'pt-1.5'} pb-1`}>
            {displayText && (
              <p className="text-[13.5px] leading-relaxed text-[var(--color-ink)] break-words whitespace-pre-wrap">
                {displayText}
              </p>
            )}

            {/* Timestamp + ticks row */}
            <div className="flex items-center justify-end gap-1 mt-0.5 -mb-0.5">
              <span className="text-[10.5px] text-[var(--color-ink-faint)] leading-none select-none">
                {message.timestamp}
              </span>
              {isOutgoing && <MessageTicks status={message.status} />}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
