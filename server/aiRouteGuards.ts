import type { Request } from 'express';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions.js';

type AiRouteKind = 'complete' | 'generate-instructions';

type GuardFailure = {
  ok: false;
  status: 400 | 413 | 429;
  error: string;
  retryAfterSeconds?: number;
};

type GuardSuccess<T> = {
  ok: true;
  value: T;
};

type GuardResult<T> = GuardSuccess<T> | GuardFailure;

export type ValidatedAiCompletePayload = {
  messages: ChatCompletionCreateParamsNonStreaming['messages'];
  temperature: number;
  responseFormat?: 'json';
};

export type ValidatedGenerateInstructionsPayload = {
  hint?: string;
};

const COMPLETE_RATE_LIMIT = { max: 40, windowMs: 5 * 60 * 1000 };
const GENERATE_INSTRUCTIONS_RATE_LIMIT = { max: 12, windowMs: 60 * 60 * 1000 };

const MAX_COMPLETE_BODY_BYTES = 64 * 1024;
const MAX_GENERATE_INSTRUCTIONS_BODY_BYTES = 4 * 1024;

const MAX_COMPLETE_MESSAGES = 40;
const MAX_COMPLETE_TOTAL_CHARS = 32_000;
const MAX_COMPLETE_MESSAGE_CHARS = 12_000;
const MAX_GENERATE_INSTRUCTIONS_HINT_CHARS = 1_000;

const AI_MESSAGE_ROLES = new Set(['system', 'user', 'assistant']);

const aiRouteUsage = new Map<string, { count: number; resetAt: number }>();

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of aiRouteUsage) {
    if (entry.resetAt <= now) aiRouteUsage.delete(key);
  }
}, 10 * 60 * 1000);
cleanupTimer.unref?.();

function getRateLimit(kind: AiRouteKind): { max: number; windowMs: number } {
  return kind === 'complete' ? COMPLETE_RATE_LIMIT : GENERATE_INSTRUCTIONS_RATE_LIMIT;
}

function getBodySizeBytes(body: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(body ?? {}), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function fail(status: GuardFailure['status'], error: string, retryAfterSeconds?: number): GuardFailure {
  return { ok: false, status, error, retryAfterSeconds };
}

export function checkAiRouteRateLimit(empresaId: string, kind: AiRouteKind): GuardResult<true> {
  const limit = getRateLimit(kind);
  const key = `${empresaId}:${kind}`;
  const now = Date.now();
  const entry = aiRouteUsage.get(key);

  if (!entry || entry.resetAt <= now) {
    aiRouteUsage.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true, value: true };
  }

  if (entry.count >= limit.max) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return fail(
      429,
      'Limite de uso da IA atingido para esta empresa. Tente novamente em alguns minutos.',
      retryAfterSeconds,
    );
  }

  entry.count += 1;
  return { ok: true, value: true };
}

export function validateAiCompletePayload(req: Request): GuardResult<ValidatedAiCompletePayload> {
  if (getBodySizeBytes(req.body) > MAX_COMPLETE_BODY_BYTES) {
    return fail(413, 'Pedido muito grande. Reduza o tamanho da conversa e tente novamente.');
  }

  const { messages, temperature = 0.7, responseFormat } = (req.body ?? {}) as {
    messages?: unknown;
    temperature?: unknown;
    responseFormat?: unknown;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return fail(400, 'Campo "messages" é obrigatório e deve ser um array.');
  }

  if (messages.length > MAX_COMPLETE_MESSAGES) {
    return fail(413, `Envie no máximo ${MAX_COMPLETE_MESSAGES} mensagens por chamada de IA.`);
  }

  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 1) {
    return fail(400, 'Campo "temperature" deve ser um número entre 0 e 1.');
  }

  if (responseFormat !== undefined && responseFormat !== 'json') {
    return fail(400, 'Formato de resposta inválido.');
  }

  let totalChars = 0;
  const sanitizedMessages: ChatCompletionCreateParamsNonStreaming['messages'] = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return fail(400, 'Cada mensagem da IA deve ter role e content em texto.');
    }

    const candidate = message as { role?: unknown; content?: unknown };
    if (typeof candidate.role !== 'string' || !AI_MESSAGE_ROLES.has(candidate.role)) {
      return fail(400, 'Mensagem da IA com role inválido.');
    }
    if (typeof candidate.content !== 'string') {
      return fail(400, 'Mensagem da IA com conteúdo inválido.');
    }

    const contentLength = candidate.content.length;
    if (contentLength > MAX_COMPLETE_MESSAGE_CHARS) {
      return fail(413, `Uma das mensagens passou de ${MAX_COMPLETE_MESSAGE_CHARS} caracteres.`);
    }

    totalChars += contentLength;
    if (totalChars > MAX_COMPLETE_TOTAL_CHARS) {
      return fail(413, `A conversa enviada para a IA passou de ${MAX_COMPLETE_TOTAL_CHARS} caracteres.`);
    }

    sanitizedMessages.push({ role: candidate.role as 'system' | 'user' | 'assistant', content: candidate.content });
  }

  return {
    ok: true,
    value: {
      messages: sanitizedMessages,
      temperature,
      responseFormat: responseFormat === 'json' ? 'json' : undefined,
    },
  };
}

export function validateGenerateInstructionsPayload(req: Request): GuardResult<ValidatedGenerateInstructionsPayload> {
  if (getBodySizeBytes(req.body) > MAX_GENERATE_INSTRUCTIONS_BODY_BYTES) {
    return fail(413, 'Pedido muito grande. Reduza o texto e tente novamente.');
  }

  const { hint } = (req.body ?? {}) as { hint?: unknown };
  if (hint === undefined || hint === null) {
    return { ok: true, value: {} };
  }

  if (typeof hint !== 'string') {
    return fail(400, 'Campo "hint" deve ser um texto.');
  }

  const trimmedHint = hint.trim();
  if (!trimmedHint) {
    return { ok: true, value: {} };
  }

  if (trimmedHint.length > MAX_GENERATE_INSTRUCTIONS_HINT_CHARS) {
    return fail(413, `Pedido extra deve ter no máximo ${MAX_GENERATE_INSTRUCTIONS_HINT_CHARS} caracteres.`);
  }

  return { ok: true, value: { hint: trimmedHint } };
}
