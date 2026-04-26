import React, { useRef, useState } from 'react';
import { FileAudio, FileText, FileVideo, ImageOff, Pause, Play, X } from 'lucide-react';
import type { ChatMessage, MessageStatus } from '../../types';
import { parseStructuredMessage } from '../../domain/chat';

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

/* ─── Lightbox (image/video full-screen viewer) ──────────────────── */

function Lightbox({ type, src, alt, onClose }: { type: 'image' | 'video'; src: string; alt?: string; onClose: () => void }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90"
      onClick={onClose}
    >
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
    </div>
  );
}

/* ─── Document icon helper ───────────────────────────────────────── */

function docIcon(mimeType: string) {
  if (mimeType.startsWith('audio/')) return <FileAudio className="h-5 w-5" strokeWidth={1.8} />;
  if (mimeType.startsWith('video/')) return <FileVideo className="h-5 w-5" strokeWidth={1.8} />;
  return <FileText className="h-5 w-5" strokeWidth={1.8} />;
}

/* ─── Timestamp + Ticks row (reused in every bubble type) ────────── */

function MetaRow({ timestamp, isOutgoing, status }: { timestamp: string; isOutgoing: boolean; status?: MessageStatus }) {
  return (
    <span className="float-right relative ml-2 -mb-1 flex items-center gap-0.5 whitespace-nowrap" style={{ top: 5 }}>
      <span className="text-[11px] leading-none select-none" style={{ color: '#667781' }}>
        {timestamp}
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
}

export function MessageBubble({ message, isLastInGroup, profilePicUrl, customerName }: MessageBubbleProps) {
  const isOutgoing = message.role === 'assistant';
  const [lightbox, setLightbox] = useState<{ type: 'image' | 'video'; src: string } | null>(null);

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
        <div style={bubbleStyle} className="relative">
          {/* Tail */}
          {hasTail && (isOutgoing ? <TailOut /> : <TailIn />)}

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
                {displayText}
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
}
