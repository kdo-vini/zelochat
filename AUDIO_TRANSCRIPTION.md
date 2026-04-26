# Audio transcription via OpenAI Whisper

> Status: **Not implemented yet.** This document is a feature spec / implementation plan for the next iteration of the audio bubble.

## Why

Audio messages now render as a clean WhatsApp-style player (shipped in the mobile-responsive UX commit). Next step: surface **what was actually said** in the audio under the player, so an agent triaging the inbox doesn't have to play every voice note.

The biggest secondary win is *for the AI*: today the assistant only sees `[Áudio]` as the message content (see [`buildAttachmentPreview` in src/domain/chat.ts](src/domain/chat.ts)), so it can't reply meaningfully to a voice note. With the transcript flowing into `contentForModel`, the assistant becomes useful on voice-heavy customers.

OpenAI Whisper-1 handles Brazilian Portuguese very well at ~$0.006/minute. Most ZeloChat voice notes are 5–30 seconds, so per-audio cost is **<$0.003** and typically **<$0.0005**. Tenant doing 1,000 audios/month ≈ **$3/month**. No feature flag needed.

## Architecture

Persist-first, transcribe-async. The webhook returns immediately to Whatsmiau (no retry timeouts), and a background job fills the transcript in over a few seconds.

```
[Whatsmiau webhook]
        │
        ▼
server/messageHandler.ts      ←─── persists row, broadcasts message
        │
        ├─ fire-and-forget ──► server/transcription.ts (NEW)
        │                            │
        │                            ├─ set status='pending' + broadcast 'message_update'
        │                            ├─ fetch audio from Supabase Storage URL
        │                            ├─ openai.audio.transcriptions.create({ model:'whisper-1', language:'pt' })
        │                            ├─ set status='done' + transcript + broadcast 'message_update'
        │                            └─ on error: status='failed' + broadcast
        ▼
[frontend bubble re-renders with the transcript]
```

The frontend bubble starts as a plain audio player; a "Transcrevendo áudio…" placeholder appears while pending; the actual transcript replaces it on success.

## Changes

### 1. Database — new columns on `zelochat_messages`

```sql
ALTER TABLE zelochat_messages
  ADD COLUMN audio_transcript text,
  ADD COLUMN audio_transcript_status text
    CHECK (audio_transcript_status IN ('pending','done','failed'));
```

Migration name: `add_audio_transcript_to_zelochat_messages`. Apply via Supabase MCP. Both columns nullable so non-audio rows are unaffected.

> Per [CLAUDE.md](CLAUDE.md) §"Order confirmation flow", **do not narrow** the existing `role` CHECK constraint while editing this table. We're only adding columns.

### 2. New file — `server/transcription.ts`

Responsibilities:
- Accept `messageId` + audio source (Supabase public URL preferred — already uploaded by the existing media pipeline).
- Set `audio_transcript_status='pending'`, broadcast `message_update`.
- Stream the audio file → `openai.audio.transcriptions.create({ file, model: 'whisper-1', language: 'pt' })`.
- On success: write `audio_transcript` + `audio_transcript_status='done'`, broadcast `message_update`.
- On failure: write `audio_transcript_status='failed'`, log, broadcast.
- Wrap in try/catch — never let exceptions bubble back to the webhook handler.

**Cost guard:** skip transcription if `attachment.sizeBytes > 5 * 1024 * 1024` (5MB) or estimated duration > 10min — mark `failed` with a reason. Protects against runaway costs from oversized uploads.

OpenAI client init reuses `OPENAI_API_KEY` (already required for AI auto-reply).

### 3. `server/messageHandler.ts` — kick off async transcription

After the audio row is inserted, fire-and-forget `transcribeAudio(messageId, dataUrl)`. Do **not** `await` inside the webhook handler. Update `mapMessage()` to include the new fields so they flow through to the frontend.

### 4. WebSocket — new `message_update` event

In `server/ws.ts` (or wherever `broadcast()` lives):

```ts
{ type: 'message_update', data: { sessionId, messageId, patch: { audio_transcript, audio_transcript_status } } }
```

Frontend hook [`useWhatsAppSessions`](src/hooks/useWhatsAppSessions.ts) gains a handler that finds the session, finds the message by id, merges the patch, triggers a re-render.

### 5. Frontend types — `ChatMessage` adds two fields

In [src/types.ts](src/types.ts):

```ts
audio_transcript?: string | null;
audio_transcript_status?: 'pending' | 'done' | 'failed' | null;
```

### 6. Frontend rendering — `MessageBubble.tsx`

Inside the audio block (`{message.kind === 'audio' && (...)}`), under `<AudioPlayer />`:

- `status === 'pending'` → small italic muted text "Transcrevendo áudio…" with a tiny spinner.
- `status === 'done'` and transcript non-empty → italic small text. Style: `text-[12.5px] italic text-[var(--color-ink-muted)] leading-snug px-1 pt-1`. Optionally prefix with a 🗒 glyph.
- `status === 'failed'` → small "Não foi possível transcrever" with a retry chip (operator-only).
- `status` null/undefined → render nothing (legacy audios).

### 7. AI context — use the transcript

In [`buildAttachmentPreview` in src/domain/chat.ts](src/domain/chat.ts) (or wherever `contentForModel` is constructed):

- If audio has a `done` transcript → use `[Áudio: "${transcript}"]` as `contentForModel` (or just the transcript itself).
- If transcript is `pending`/missing → fall back to `[Áudio]` as today (don't block the AI on transcription).

This is the highest-leverage change in the whole feature — single line that makes the assistant 10× more useful on voice notes.

## Files touched

- [server/messageHandler.ts](server/messageHandler.ts) — wire async call, update `mapMessage`.
- `server/transcription.ts` — **new file**, Whisper client + status updates.
- [server/ws.ts](server/ws.ts) — add `message_update` event type.
- [src/hooks/useWhatsAppSessions.ts](src/hooks/useWhatsAppSessions.ts) — handle `message_update`.
- [src/components/views/MessageBubble.tsx](src/components/views/MessageBubble.tsx) — render transcript / status under the player.
- [src/types.ts](src/types.ts) — add transcript fields to `ChatMessage`.
- [src/domain/chat.ts](src/domain/chat.ts) — surface transcript in `contentForModel`.
- [server/ai.ts](server/ai.ts) — read-only check that `contentForModel` is the right hook.
- Supabase migration — `add_audio_transcript_to_zelochat_messages`.

## Verification

> ⚠️ Per [CLAUDE.md](CLAUDE.md) §"Local dev steals the production webhook", do **not** boot `dev:server` against the shared `.env` — it overwrites Whatsmiau's prod webhook URL. Use a sandbox Whatsmiau instance, set `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1`, or temporarily clear `WHATSMIAU_API_KEY`/`WHATSMIAU_INSTANCE` before running locally.

End-to-end:
1. From a real WhatsApp number, send a voice note ("Quero alterar o pedido para as 14h"). Bubble renders immediately with the audio player + "Transcrevendo áudio…".
2. Within ~5 seconds the placeholder is replaced with the actual transcribed text.
3. In Supabase: `audio_transcript_status='done'`, `audio_transcript` non-empty.
4. Send a follow-up text that depends on the audio context — verify the AI references it (proves Change 7 works).
5. Send a >5MB audio (or fake `sizeBytes`) — confirm it's marked `failed` and the cost guard log fires.
6. Disconnect OpenAI key → audio transcription marks `failed` cleanly, the rest of the pipeline (auto-reply, etc.) still works.

## Out of scope (future)

- **Retry button** on failed transcripts — defer until we see real failure rate.
- **Editable transcripts** (operator corrects Whisper's mistakes) — much bigger feature, keep read-only for v1.
- **Outbound audio transcription** (assistant-sent voice replies) — only inbound matters for inbox triage.
