import { randomUUID } from 'node:crypto';
import type {
  CatalogReplyResult,
  OrderingDraft,
  OrderingSnapshot,
} from '../src/domain/aiWhatsAppOrdering.js';
import { OrderingWireUnsupportedError, parseOrderingSnapshotWire } from './zeloMenuOrderingWire.js';

export const DEFAULT_ZELOMENU_INTERNAL_BASE_URL = 'http://127.0.0.1:3101';
export const DEFAULT_ZELOMENU_INTERNAL_TIMEOUT_MS = 4000;
/**
 * `confirm_draft` performs 5+ sequential Supabase round trips on the
 * authority side (order materialization, insert, re-reads, auto-accept) —
 * the generic 4s budget aborted mid-mutation and told the customer "não
 * consegui conferir" while the order had already been created (CT #9).
 * Confirm gets its own, larger budget; search/get/update keep the tight one.
 */
export const DEFAULT_ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS = 12000;

export function resolveZeloMenuInternalBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.ZELOMENU_INTERNAL_BASE_URL?.trim() || DEFAULT_ZELOMENU_INTERNAL_BASE_URL;
}

/**
 * FIX 2026-09-04 (FN I5): `buscar_cardapio` and `consultar_carrinho` used to
 * be offered to the model but were never executed — ZeloChat already
 * performs a deterministic `client.searchCatalog` call BEFORE invoking the
 * model and feeds the result into the system prompt as "CATÁLOGO CANÔNICO",
 * and the canonical snapshot is loaded and fed in as "CARRINHO ATUAL" the
 * same way. The model had no code path that would ever see a result from
 * either tool (`planDraft` only ever reads an `alterar_carrinho` call).
 * Ruling: removed rather than wired — writing a real handler for a lookup
 * the deterministic pipeline already performs would just be two ways to do
 * the same thing with two different consistency guarantees. The one tool the
 * model actually uses is built fresh per call by
 * `buildOrderingPatchTool()` (`server/orderingPatchPlanner.ts`), which is
 * also the single source of truth for its schema — no static duplicate of
 * it lives here anymore.
 */

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
  /** Larger budget for `confirm_draft` specifically — see CT #9. */
  confirmTimeoutMs?: number;
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

function requireIdentity(empresaId: string, remoteJid: string, requestId: string): void {
  // FIX 2026-09-04 (B1 "validate empresaId/remoteJid presence"): fail
  // locally, before spending a round trip, on the same boundary ZeloMenu
  // itself enforces (`EMPRESA_INVALIDA` / `CONVERSA_INVALIDA`).
  if (!empresaId?.trim() || !remoteJid?.trim()) {
    throw new ZeloMenuInternalError('COMANDO_INVALIDO', 400, requestId, null, 'Não foi possível identificar esta conversa agora.');
  }
}

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
    const timeoutMs = Number(env.ZELOMENU_INTERNAL_TIMEOUT_MS ?? String(DEFAULT_ZELOMENU_INTERNAL_TIMEOUT_MS));
    const confirmTimeoutMs = Number(env.ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS ?? String(DEFAULT_ZELOMENU_INTERNAL_CONFIRM_TIMEOUT_MS));
    if (!baseUrl || !apiKey || !Number.isFinite(timeoutMs) || timeoutMs < 100) return null;
    if (!Number.isFinite(confirmTimeoutMs) || confirmTimeoutMs < 100) return null;
    return new ZeloMenuInternalClient({ baseUrl, apiKey, timeoutMs, confirmTimeoutMs });
  }

  async searchCatalog(input: { empresaId: string; query: string; limit?: number }): Promise<CatalogReplyResult> {
    return this.request('/internal/catalog/search', {
      method: 'POST', body: JSON.stringify({ ...input, limit: Math.min(12, input.limit ?? 12) }),
    });
  }

  async updateDraft(input: UpdateDraftInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'open_or_update_draft', ...input });
  }

  async confirmDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'confirm_draft', ...input }, { timeoutMs: this.options.confirmTimeoutMs });
  }

  async cancelDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'cancel_draft', ...input });
  }

  async getOrdering(orderingId: string, empresaId: string, remoteJid: string): Promise<OrderingSnapshot> {
    requireIdentity(empresaId, remoteJid, this.requestIdFactory());
    return this.request(`/internal/ordering/${encodeURIComponent(orderingId)}?empresaId=${encodeURIComponent(empresaId)}&remoteJid=${encodeURIComponent(remoteJid)}`, { method: 'GET', parseSnapshot: true });
  }

  private async orderingCommand(body: Record<string, unknown>, overrides: { timeoutMs?: number } = {}): Promise<OrderingSnapshot> {
    return this.request('/internal/ordering/commands', { method: 'POST', body: JSON.stringify(body), parseSnapshot: true, ...overrides });
  }

  private async request<T>(path: string, init: RequestInit & { parseSnapshot?: boolean; timeoutMs?: number }): Promise<T> {
    const requestId = this.requestIdFactory();
    const controller = new AbortController();
    const timeoutMs = init.timeoutMs ?? this.options.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const { parseSnapshot, timeoutMs: _ignoredTimeoutMs, ...fetchInit } = init;
    try {
      const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        ...fetchInit,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-zelo-internal-key': this.options.apiKey,
          'x-request-id': requestId,
        },
      });
      const rawPayload = await response.json().catch(() => ({})) as {
        error?: string; requestId?: string; current?: unknown;
      } & Record<string, unknown>;
      if (!response.ok) {
        let current: OrderingSnapshot | null = null;
        if (parseSnapshot && rawPayload.current) {
          try {
            current = parseOrderingSnapshotWire(rawPayload.current);
          } catch (parseError) {
            // Never let a malformed `current` snapshot mask the original
            // error code — log (no PII: request id + reason only) and
            // proceed with `current: null`, same as if it had been absent.
            console.warn('[ZeloMenuInternalClient] ORDERING_WIRE_UNSUPPORTED (error.current)', {
              requestId,
              path,
              reason: parseError instanceof OrderingWireUnsupportedError ? parseError.reason : 'unknown',
            });
          }
        }
        throw new ZeloMenuInternalError(
          typeof rawPayload.error === 'string' ? rawPayload.error : 'PEDIDO_INDISPONIVEL',
          response.status,
          typeof rawPayload.requestId === 'string' ? rawPayload.requestId : requestId,
          current,
        );
      }
      if (parseSnapshot) {
        try {
          return parseOrderingSnapshotWire(rawPayload) as T;
        } catch (parseError) {
          console.warn('[ZeloMenuInternalClient] ORDERING_WIRE_UNSUPPORTED', {
            requestId,
            path,
            reason: parseError instanceof OrderingWireUnsupportedError ? parseError.reason : 'unknown',
          });
          throw new ZeloMenuInternalError('ORDERING_WIRE_UNSUPPORTED', 503, requestId, null, 'Não foi possível consultar o pedido agora.');
        }
      }
      return rawPayload as T;
    } catch (error) {
      if (error instanceof ZeloMenuInternalError) throw error;
      const code = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'INDISPONIVEL';
      throw new ZeloMenuInternalError(code, 503, requestId);
    } finally {
      clearTimeout(timeout);
    }
  }
}
