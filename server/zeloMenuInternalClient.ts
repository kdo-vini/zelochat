import { randomUUID } from 'node:crypto';
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions.js';
import type {
  CatalogReplyResult,
  OrderingDraft,
  OrderingRequirement,
  OrderingSnapshot,
} from '../src/domain/aiWhatsAppOrdering.js';

export const DEFAULT_ZELOMENU_INTERNAL_BASE_URL = 'http://127.0.0.1:3101';

export function resolveZeloMenuInternalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZELOMENU_INTERNAL_BASE_URL?.trim() || DEFAULT_ZELOMENU_INTERNAL_BASE_URL;
}

export const ORDERING_MODEL_TOOLS: ChatCompletionFunctionTool[] = [
  {
    type: 'function',
    function: {
      name: 'buscar_cardapio',
      description: 'Busca produtos e opções disponíveis no cardápio canônico.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['query'],
        properties: { query: { type: 'string', minLength: 1, maxLength: 240 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'alterar_carrinho',
      description: 'Abre ou altera um rascunho usando somente IDs retornados pela busca.',
      parameters: {
        type: 'object', additionalProperties: false, required: ['items'],
        properties: {
          items: {
            type: 'array', minItems: 1, maxItems: 50,
            items: {
              type: 'object', additionalProperties: false, required: ['productId', 'quantity'],
              properties: {
                lineId: { type: 'string', minLength: 1, maxLength: 64 },
                productId: { type: 'integer', minimum: 1 },
                quantity: { type: 'integer', minimum: 1, maximum: 999 },
                notes: { type: 'string', maxLength: 200 },
                selectedOptions: {
                  type: 'array',
                  items: {
                    type: 'object', additionalProperties: false, required: ['groupId', 'optionSelections'],
                    properties: {
                      groupId: { type: 'string', minLength: 1, maxLength: 64 },
                      optionSelections: {
                        type: 'array', items: {
                          type: 'object', additionalProperties: false, required: ['optionId', 'quantity'],
                          properties: { optionId: { type: 'string', minLength: 1, maxLength: 64 }, quantity: { type: 'integer', minimum: 1, maximum: 99 } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          fulfillment: {
            type: 'object', additionalProperties: false,
            properties: {
              type: { type: 'string', enum: ['pickup', 'delivery'] },
              asap: { type: 'boolean' }, pickupDate: { type: 'string' }, pickupTime: { type: 'string' },
              deliveryAddress: { type: 'string' }, deliveryNeighborhood: { type: 'string' },
              deliveryPostalCode: { type: 'string' }, deliveryNumber: { type: 'string' }, deliveryComplement: { type: 'string' },
            },
          },
          paymentMethod: { type: 'string', maxLength: 40 },
          observations: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'consultar_carrinho',
      description: 'Consulta o rascunho canônico aberto desta conversa.',
      parameters: { type: 'object', additionalProperties: false, properties: {} },
    },
  },
];

export class ZeloMenuInternalError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly requestId: string,
    public readonly current: OrderingSnapshot | null = null,
    message = 'Não foi possível consultar o pedido agora.',
  ) {
    super(message);
    this.name = 'ZeloMenuInternalError';
  }
}

interface ClientOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
  requestIdFactory?: () => string;
}

export interface UpdateDraftInput {
  empresaId: string;
  remoteJid: string;
  messageId: string;
  conversationControlId: string;
  conversationEpoch: string;
  orderingId?: string;
  expectedRevision?: number;
  draft: OrderingDraft;
}

export interface DeterministicCommandInput {
  empresaId: string;
  remoteJid: string;
  messageId: string;
  conversationControlId: string;
  conversationEpoch: string;
  orderingId: string;
  expectedRevision: number;
  confirmationToken?: string;
}

interface OrderingRequirementWire extends Omit<OrderingRequirement, 'kind' | 'label'> {
  type: OrderingRequirement['kind'];
  name: string;
}

type OrderingSnapshotWire = Omit<OrderingSnapshot, 'requirements'> & {
  requirements: OrderingRequirementWire[];
};

export class ZeloMenuInternalClient {
  private readonly fetchImpl: typeof fetch;
  private readonly requestIdFactory: () => string;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
  }

  static fromEnv(env: NodeJS.ProcessEnv = process.env): ZeloMenuInternalClient | null {
    const baseUrl = resolveZeloMenuInternalBaseUrl(env);
    const apiKey = env.ZELO_INTERNAL_API_KEY?.trim();
    const timeoutMs = Number(env.ZELOMENU_INTERNAL_TIMEOUT_MS ?? '4000');
    if (!baseUrl || !apiKey || !Number.isFinite(timeoutMs) || timeoutMs < 100) return null;
    return new ZeloMenuInternalClient({ baseUrl, apiKey, timeoutMs });
  }

  async searchCatalog(input: { empresaId: string; query: string; limit?: number }): Promise<CatalogReplyResult> {
    return this.request('/internal/catalog/search', {
      method: 'POST', body: JSON.stringify({ ...input, limit: Math.min(12, input.limit ?? 12) }),
    });
  }

  async updateDraft(input: UpdateDraftInput): Promise<OrderingSnapshot> {
    return this.orderingCommand({ type: 'open_or_update_draft', ...input });
  }

  async confirmDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    return this.orderingCommand({ type: 'confirm_draft', ...input });
  }

  async cancelDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    return this.orderingCommand({ type: 'cancel_draft', ...input });
  }

  async getOrdering(orderingId: string, empresaId: string): Promise<OrderingSnapshot> {
    return this.request(`/internal/ordering/${encodeURIComponent(orderingId)}?empresaId=${encodeURIComponent(empresaId)}`, { method: 'GET' });
  }

  private async orderingCommand(body: Record<string, unknown>): Promise<OrderingSnapshot> {
    return this.request('/internal/ordering/commands', { method: 'POST', body: JSON.stringify(body) });
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const requestId = this.requestIdFactory();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-zelo-internal-key': this.options.apiKey,
          'x-request-id': requestId,
        },
      });
      const payload = await response.json().catch(() => ({})) as {
        error?: string; requestId?: string; current?: OrderingSnapshot;
      } & T;
      if (!response.ok) {
        throw new ZeloMenuInternalError(
          payload.error || 'PEDIDO_INDISPONIVEL',
          response.status,
          payload.requestId || requestId,
          payload.current ?? null,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof ZeloMenuInternalError) throw error;
      const code = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'INDISPONIVEL';
      throw new ZeloMenuInternalError(code, 503, requestId);
    } finally {
      clearTimeout(timeout);
    }
  }
}
