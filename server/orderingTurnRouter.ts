import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { APIConnectionTimeoutError, APIUserAbortError } from 'openai';
import { getOpenAIClient } from './openaiClient.js';
import {
  ORDERING_INTENTS,
  parseOrderingRoute,
  type OrderingRoute,
} from '../src/domain/orderingTurnRoute.js';

export interface OrderingTurnRouterInput {
  text: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  storeName?: string | null;
}

export type OrderingTurnRouter = (input: OrderingTurnRouterInput) => Promise<OrderingRoute | null>;

const clampTimeout = (value: number): number => Math.min(8000, Math.max(500, value));

function parseTimeout(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? clampTimeout(parsed) : 3000;
}

export const ORDERING_ROUTER_TIMEOUT_MS = parseTimeout(process.env.ZELOCHAT_ORDERING_ROUTER_TIMEOUT_MS);

export function isOrderingRouterEnabled(env = process.env): boolean {
  const value = env.ZELOCHAT_ORDERING_ROUTER?.trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'no' && value !== 'off';
}

const SYSTEM_PROMPT = `Você classifica a ÚLTIMA mensagem que um cliente mandou no WhatsApp de uma loja de comida. Não existe pedido em andamento. Responda só o JSON.
intents:
- pedido: quer comprar/pedir comida ou cita pratos/produtos para levar, mesmo sem verbo ("Macarrão, pene", "penne, molho branco, bacon", "2 coxinhas e uma coca", "o de sempre").
- duvida_cardapio: pergunta se a loja tem/vende algo, preço, tamanho ou opções de um produto ("tem caldo hoje?", "quanto é a marmita grande?").
- pedir_cardapio: pede o cardápio/menu/lista inteiro sem citar produto ("me manda o cardápio").
- atendente: pede para falar com uma pessoa.
- conversa: cumprimento, agradecimento, horário, endereço, taxa, status/reclamação de pedido anterior, ou qualquer papo que não é pedir comida agora.
- outro: não é cliente pedindo comida (fornecedor, pesquisa de satisfação, propaganda, cobrança, mensagem de sistema/empresa parceira).
Palavras como "pedir", "pedido" e "quero" sozinhas NÃO fazem um pedido: "queria te pedir um favor" e "quero falar sobre o pedido de ontem" são conversa; uma pesquisa com perguntas sobre o sistema/empresa é outro.
items: só os produtos/pratos/ingredientes que o cliente ESCREVEU nesta mensagem (ou no áudio transcrito), copiados como ele escreveu, sem inventar nem corrigir; vazio se não citou nenhum.
confidence: de 0 a 1, o quanto você tem certeza da intenção.`;

export function buildOrderingRouterMessages(input: OrderingTurnRouterInput): ChatCompletionMessageParam[] {
  const storeSuffix = input.storeName?.trim() ? ` (${input.storeName.trim()})` : '';
  const system = SYSTEM_PROMPT.replace('loja de comida.', `loja de comida${storeSuffix}.`);
  const history = input.history
    .filter((message) => message.content.trim())
    .slice(-6)
    .map((message) => ({
      role: message.role,
      content: message.content.slice(0, 500),
    } satisfies ChatCompletionMessageParam));

  return [
    { role: 'system', content: system },
    ...history,
    { role: 'user', content: input.text.slice(0, 2000) },
  ];
}

const orderingRouteSchema = {
  type: 'object',
  properties: {
    intent: { type: 'string', enum: [...ORDERING_INTENTS] },
    confidence: { type: 'number' },
    items: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'confidence', 'items'],
  additionalProperties: false,
};

export function failureReason(error: unknown): 'timeout' | 'request_failed' {
  const name = error !== null && typeof error === 'object' && 'name' in error
    ? String((error as { name?: unknown }).name)
    : '';
  return error instanceof APIUserAbortError
    || error instanceof APIConnectionTimeoutError
    || name === 'AbortError'
    || name === 'TimeoutError'
    || name === 'APIUserAbortError'
    || name === 'APIConnectionTimeoutError'
    ? 'timeout'
    : 'request_failed';
}

export const routeOrderingTurn: OrderingTurnRouter = async (input) => {
  try {
    const completion = await getOpenAIClient().chat.completions.create({
      model: process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 150,
      messages: buildOrderingRouterMessages(input),
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'ordering_route',
          strict: true,
          schema: orderingRouteSchema,
        },
      },
    }, { signal: AbortSignal.timeout(ORDERING_ROUTER_TIMEOUT_MS), maxRetries: 0 });

    const content = completion.choices[0]?.message.content;
    const route = parseOrderingRoute(content);
    if (!route) {
      console.warn('[OrderingRouter] failed', JSON.stringify({ reason: 'invalid_output' }));
      return null;
    }
    return route;
  } catch (error) {
    const reason = failureReason(error);
    console.warn('[OrderingRouter] failed', JSON.stringify({ reason }));
    return null;
  }
};
