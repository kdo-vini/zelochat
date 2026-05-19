import { OpenAI, toFile } from 'openai';
import { broadcast } from './ws.js';
import { getServiceSupabase } from './supabase.js';
import { recordAiUsage } from './aiUsage.js';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5 MB cost guard
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe';
const TRANSCRIPTION_PROMPT = [
  'Áudio de cliente brasileiro falando com uma lanchonete pelo WhatsApp.',
  'Preserve números, datas e horários com clareza.',
  'Termos comuns: cento de salgado, coxinha, empada, pastel, bolo, Pix, retirada, entrega.',
].join(' ');

let whisperClient: OpenAI | null = null;

function getWhisperClient(): OpenAI {
  if (!whisperClient) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    whisperClient = new OpenAI({ apiKey: key });
  }
  return whisperClient;
}

export interface TranscribeParams {
  empresaId: string;
  jid: string;
  messageId: string;
  audioUrl: string | undefined;
  mimeType: string;
  fileName: string;
  sizeBytes?: number;
}

type TranscriptStatus = 'pending' | 'done' | 'failed';

async function persistAndBroadcast(
  params: { empresaId: string; jid: string; messageId: string },
  patch: {
    audio_transcript_status: TranscriptStatus;
    audio_transcript?: string | null;
    audio_transcript_error?: string | null;
  },
): Promise<void> {
  const dbPatch: Record<string, unknown> = {
    audio_transcript_status: patch.audio_transcript_status,
    audio_transcript: patch.audio_transcript ?? null,
  };
  if (patch.audio_transcript_status === 'failed') {
    dbPatch.audio_transcript_error = patch.audio_transcript_error ?? null;
  } else {
    dbPatch.audio_transcript_error = null;
  }

  const { error } = await getServiceSupabase()
    .from('zelochat_messages')
    .update(dbPatch)
    .eq('id', params.messageId)
    .eq('empresa_id', params.empresaId);

  if (error) {
    console.error('[Transcription] Failed to persist patch for', params.messageId, error.message);
    return;
  }

  broadcast(
    {
      type: 'message_update',
      data: {
        sessionId: params.jid,
        messageId: params.messageId,
        patch: {
          audio_transcript: patch.audio_transcript ?? null,
          audio_transcript_status: patch.audio_transcript_status,
        },
      },
    },
    params.empresaId,
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : '';
    return `${name}${err.message}`.slice(0, 1000);
  }
  try {
    return String(err).slice(0, 1000);
  } catch {
    return 'unknown error';
  }
}

/**
 * Persist-first, transcribe-async. Never throws — failures land as status='failed'
 * so the webhook handler can fire-and-forget without risking the response.
 */
export async function transcribeAudio(params: TranscribeParams): Promise<void> {
  const { empresaId, jid, messageId, audioUrl, mimeType, fileName, sizeBytes } = params;

  if (!process.env.OPENAI_API_KEY) {
    console.warn('[Transcription] OPENAI_API_KEY not set — skipping transcription');
    return;
  }

  if (!audioUrl) {
    await persistAndBroadcast({ empresaId, jid, messageId }, {
      audio_transcript_status: 'failed',
      audio_transcript: null,
      audio_transcript_error: 'missing audio URL',
    });
    return;
  }

  if (sizeBytes && sizeBytes > MAX_AUDIO_BYTES) {
    console.warn(`[Transcription] Skipping ${messageId} — audio is ${sizeBytes} bytes (>${MAX_AUDIO_BYTES})`);
    await persistAndBroadcast({ empresaId, jid, messageId }, {
      audio_transcript_status: 'failed',
      audio_transcript: null,
      audio_transcript_error: `audio too large: ${sizeBytes} bytes (limit ${MAX_AUDIO_BYTES})`,
    });
    return;
  }

  await persistAndBroadcast({ empresaId, jid, messageId }, {
    audio_transcript_status: 'pending',
    audio_transcript: null,
  });

  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) {
      throw new Error(`Audio fetch failed: ${audioRes.status} ${audioRes.statusText}`);
    }
    const audioBlob = await audioRes.blob();

    if (audioBlob.size > MAX_AUDIO_BYTES) {
      console.warn(`[Transcription] Downloaded audio exceeds size guard (${audioBlob.size} bytes) for ${messageId}`);
      await persistAndBroadcast({ empresaId, jid, messageId }, {
        audio_transcript_status: 'failed',
        audio_transcript: null,
        audio_transcript_error: `downloaded audio too large: ${audioBlob.size} bytes (limit ${MAX_AUDIO_BYTES})`,
      });
      return;
    }

    const file = await toFile(audioBlob, fileName, { type: mimeType });

    const result = await getWhisperClient().audio.transcriptions.create({
      file,
      model: OPENAI_TRANSCRIPTION_MODEL,
      language: 'pt',
      prompt: TRANSCRIPTION_PROMPT,
    });
    recordAiUsage({
      empresaId,
      feature: 'ai_transcription',
      model: OPENAI_TRANSCRIPTION_MODEL,
      status: 'success',
    });

    const transcript = (result.text ?? '').trim();

    await persistAndBroadcast({ empresaId, jid, messageId }, {
      audio_transcript_status: 'done',
      audio_transcript: transcript || null,
    });
  } catch (err) {
    console.error('[Transcription] Whisper call failed for', messageId, err);
    recordAiUsage({
      empresaId,
      feature: 'ai_transcription',
      model: OPENAI_TRANSCRIPTION_MODEL,
      status: 'error',
    });
    await persistAndBroadcast({ empresaId, jid, messageId }, {
      audio_transcript_status: 'failed',
      audio_transcript: null,
      audio_transcript_error: describeError(err),
    });
  }
}
