import type { Request } from 'express';
import {
  checkAiRouteRateLimit,
  validateAiCompletePayload,
  validateGenerateInstructionsPayload,
} from '../server/aiRouteGuards.js';
import { assert, assertEqual, runSuite } from './testHarness.js';

function req(body: unknown): Request {
  return { body } as Request;
}

function assertFailure(result: { ok: boolean }, status: number, message: string): void {
  assert(!result.ok && (result as { status?: number }).status === status, message);
}

await runSuite('AI route guards', [
  {
    name: 'accepts a minimal valid chat-completion payload',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [
          { role: 'system', content: 'Responda em portugues brasileiro.' },
          { role: 'user', content: 'Oi, qual o horario?' },
        ],
        temperature: 0.3,
        responseFormat: 'json',
      }));
      assert(result.ok, 'valid payload is accepted');
      if (result.ok) {
        assertEqual(result.value.temperature, 0.3, 'temperature is preserved');
        assertEqual(result.value.responseFormat, 'json', 'json response format is preserved');
      }
    },
  },
  {
    name: 'rejects missing or empty messages',
    run: () => {
      const result = validateAiCompletePayload(req({ messages: [] }));
      assertFailure(result, 400, 'empty messages return 400');
    },
  },
  {
    name: 'rejects tool/system-tool roles from frontend proxy',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [{ role: 'tool', content: 'resultado interno' }],
      }));
      assertFailure(result, 400, 'tool role is rejected');
    },
  },
  {
    name: 'rejects non-string content',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'oi' }] }],
      }));
      assertFailure(result, 400, 'multimodal/non-string content is rejected on this route');
    },
  },
  {
    name: 'rejects excessive message count',
    run: () => {
      const messages = Array.from({ length: 61 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `msg ${i}` }));
      const result = validateAiCompletePayload(req({ messages }));
      assertFailure(result, 413, 'more than 60 messages returns 413');
    },
  },
  {
    name: 'rejects one huge message',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [{ role: 'user', content: 'x'.repeat(30_001) }],
      }));
      assertFailure(result, 413, 'single message over 30k chars returns 413');
    },
  },
  {
    name: 'rejects huge total conversation',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: Array.from({ length: 4 }, () => ({ role: 'user', content: 'x'.repeat(25_000) })),
      }));
      assertFailure(result, 413, 'conversation over 80k chars returns 413');
    },
  },
  {
    name: 'rejects giant JSON bodies before parsing semantics',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [{ role: 'user', content: 'oi' }],
        ignoredButStillCounts: 'x'.repeat(513 * 1024),
      }));
      assertFailure(result, 413, 'body over 512kb returns 413');
    },
  },
  {
    name: 'rejects temperatures outside 0..1',
    run: () => {
      const low = validateAiCompletePayload(req({ messages: [{ role: 'user', content: 'oi' }], temperature: -0.1 }));
      const high = validateAiCompletePayload(req({ messages: [{ role: 'user', content: 'oi' }], temperature: 1.1 }));
      assertFailure(low, 400, 'temperature below zero is rejected');
      assertFailure(high, 400, 'temperature above one is rejected');
    },
  },
  {
    name: 'rejects unsupported response format',
    run: () => {
      const result = validateAiCompletePayload(req({
        messages: [{ role: 'user', content: 'oi' }],
        responseFormat: 'xml',
      }));
      assertFailure(result, 400, 'unsupported responseFormat is rejected');
    },
  },
  {
    name: 'normalizes optional instruction hints',
    run: () => {
      const empty = validateGenerateInstructionsPayload(req({ hint: '   ' }));
      const valid = validateGenerateInstructionsPayload(req({ hint: '  Quero tom mais informal  ' }));
      const huge = validateGenerateInstructionsPayload(req({ hint: 'x'.repeat(1001) }));
      assert(empty.ok && !('hint' in empty.value), 'blank hint is omitted');
      assert(valid.ok && valid.value.hint === 'Quero tom mais informal', 'hint is trimmed');
      assertFailure(huge, 413, 'hint over 1000 chars is rejected');
    },
  },
  {
    name: 'enforces per-user rate limit',
    run: () => {
      const empresaId = `empresa-user-limit-${Date.now()}`;
      const userId = 'user-a';
      let last = checkAiRouteRateLimit(empresaId, userId, 'complete');
      for (let i = 1; i < 40; i++) {
        last = checkAiRouteRateLimit(empresaId, userId, 'complete');
      }
      const blocked = checkAiRouteRateLimit(empresaId, userId, 'complete');
      assert(last.ok, '40th user call is still accepted');
      assertFailure(blocked, 429, '41st user call is blocked');
    },
  },
  {
    name: 'enforces empresa-wide rate limit across many users',
    run: () => {
      const empresaId = `empresa-wide-limit-${Date.now()}`;
      let last = checkAiRouteRateLimit(empresaId, 'user-0', 'complete');
      for (let i = 1; i < 200; i++) {
        last = checkAiRouteRateLimit(empresaId, `user-${i}`, 'complete');
      }
      const blocked = checkAiRouteRateLimit(empresaId, 'user-200', 'complete');
      assert(last.ok, '200th empresa call is still accepted');
      assertFailure(blocked, 429, '201st empresa call is blocked');
    },
  },
]);
