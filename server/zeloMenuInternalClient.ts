import { randomUUID } from 'node:crypto';
import type {
  CatalogReplyResult,
  OrderingDraft,
  OrderingSnapshot,
} from '../src/domain/aiWhatsAppOrdering.js';
import { OrderingWireUnsupportedError, parseOrderingSnapshotWire } from './zeloMenuOrderingWire.js';
import { orderingCircuitBreaker, type OrderingCircuitBreaker } from './orderingCircuitBreaker.js';
import { getConfig } from './configStore.js';
import { validateManagerPhone } from './escalation.js';
import { dispatchConversationOutbound } from './conversationOutbound.js';

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

/**
 * FIX 2026-09-04 (PR I-5): the ONE manager notification a circuit-breaker
 * opening sends — not per conversation, not per turn. Best-effort: a
 * failure here must never surface as a customer-facing error, and it must
 * never block the caller (the throw the breaker's `isOpen`/`recordFailure`
 * check triggers already happens independently of this).
 */
async function notifyManagerOfOrderingOutage(empresaId: string): Promise<void> {
  try {
    const managerPhone = validateManagerPhone(getConfig(empresaId).managerPhone);
    if (managerPhone.ok !== true) return;
    const body = 'A confirmação automática de pedidos pelo WhatsApp está temporariamente instável. '
      + 'Os clientes estão recebendo aviso para tentar de novo em instantes. Se persistir, acompanhe as conversas manualmente.';
    await dispatchConversationOutbound({
      empresaId,
      remoteJid: managerPhone.jid,
      actorUserId: null,
      origin: 'internal_system',
      takeoverPolicy: 'preserve_ai',
      idempotencyKey: `internal:ordering-circuit-open:${empresaId}:${Date.now()}`,
      payload: { kind: 'text', text: body },
    });
  } catch (err) {
    console.warn('[ZeloMenuInternalClient] failed to notify manager of circuit breaker opening:', err);
  }
}

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
  /**
   * PR I-5 — defaults to the shared process-wide singleton. Override only in
   * tests that need a fresh, fake-clocked breaker isolated from other tests.
   */
  circuitBreaker?: OrderingCircuitBreaker;
  /**
   * PR I-5 — fires exactly once, the call that trips a given empresa's
   * breaker from closed to open. Defaults to the real manager notification;
   * override in tests to observe it without touching Supabase/WhatsApp.
   */
  onCircuitOpen?: (empresaId: string) => void;
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
  private readonly circuitBreaker: OrderingCircuitBreaker;
  private readonly onCircuitOpen: (empresaId: string) => void;

  constructor(private readonly options: ClientOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestIdFactory = options.requestIdFactory ?? randomUUID;
    this.circuitBreaker = options.circuitBreaker ?? orderingCircuitBreaker;
    this.onCircuitOpen = options.onCircuitOpen ?? ((empresaId) => { void notifyManagerOfOrderingOutage(empresaId); });
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
    }, input.empresaId);
  }

  async updateDraft(input: UpdateDraftInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'open_or_update_draft', ...input }, input.empresaId);
  }

  async confirmDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'confirm_draft', ...input }, input.empresaId, { timeoutMs: this.options.confirmTimeoutMs });
  }

  async cancelDraft(input: DeterministicCommandInput): Promise<OrderingSnapshot> {
    requireIdentity(input.empresaId, input.remoteJid, this.requestIdFactory());
    return this.orderingCommand({ type: 'cancel_draft', ...input }, input.empresaId);
  }

  async getOrdering(orderingId: string, empresaId: string, remoteJid: string): Promise<OrderingSnapshot> {
    requireIdentity(empresaId, remoteJid, this.requestIdFactory());
    return this.request(`/internal/ordering/${encodeURIComponent(orderingId)}?empresaId=${encodeURIComponent(empresaId)}&remoteJid=${encodeURIComponent(remoteJid)}`, { method: 'GET', parseSnapshot: true }, empresaId);
  }

  private async orderingCommand(body: Record<string, unknown>, empresaId: string, overrides: { timeoutMs?: number } = {}): Promise<OrderingSnapshot> {
    return this.request('/internal/ordering/commands', { method: 'POST', body: JSON.stringify(body), parseSnapshot: true, ...overrides }, empresaId);
  }

  /**
   * FIX 2026-09-04 (PR I-5): `empresaId` is the circuit breaker's key. Every
   * public method above passes its own, so a run of transport failures for
   * ONE tenant's ordering integration trips only that tenant's breaker —
   * never a healthy tenant sharing the same client/process.
   */
  private async request<T>(path: string, init: RequestInit & { parseSnapshot?: boolean; timeoutMs?: number }, empresaId?: string): Promise<T> {
    const requestId = this.requestIdFactory();
    if (empresaId && this.circuitBreaker.isOpen(empresaId)) {
      throw new ZeloMenuInternalError('INDISPONIVEL_CIRCUITO_ABERTO', 503, requestId, null, 'Não foi possível consultar o pedido agora.');
    }
    const controller = new AbortController();
    const timeoutMs = init.timeoutMs ?? this.options.timeoutMs;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const { parseSnapshot, timeoutMs: _ignoredTimeoutMs, ...fetchInit } = init;
    const recordFailure = () => {
      if (!empresaId) return;
      if (this.circuitBreaker.recordFailure(empresaId)) this.onCircuitOpen(empresaId);
    };
    const recordSuccess = () => { if (empresaId) this.circuitBreaker.recordSuccess(empresaId); };
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
        // Only a transport-y failure (rate-limited or the server itself
        // erroring) counts toward the breaker — a domain 4xx (validation,
        // conflict, not-found) means ZeloMenu answered fine, it just said no.
        if (response.status === 429 || response.status >= 500) recordFailure();
        else recordSuccess();
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
      recordSuccess();
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
      recordFailure();
      const code = error instanceof Error && error.name === 'AbortError' ? 'TIMEOUT' : 'INDISPONIVEL';
      throw new ZeloMenuInternalError(code, 503, requestId);
    } finally {
      clearTimeout(timeout);
    }
  }
}
