import { OpenAI } from 'openai';

let ai: OpenAI | null = null;

export function getOpenAIClient(): OpenAI {
  if (!ai) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY not set');
    ai = new OpenAI({ apiKey: key, timeout: 45_000, maxRetries: 0 });
  }
  return ai;
}
