import { apiUrl, apiFetch, WaServerOfflineError } from '../config';

export type PlanTier = 'pdv' | 'chat' | 'bundle';
export type ChangePlanTarget = 'chat' | 'bundle';

export class BillingError extends Error {
  code?: string;
  status?: number;
  constructor(message: string, init?: { code?: string; status?: number }) {
    super(message);
    this.name = 'BillingError';
    this.code = init?.code;
    this.status = init?.status;
  }
}

export interface ChangePlanResult {
  ok: true;
  planTier: ChangePlanTarget;
  status: string;
  currentPeriodEnd: string | null;
  prorationBRL?: number;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalResult {
  url: string;
}

function authHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function callBilling<T>(
  path: 'checkout' | 'portal' | 'sync' | 'change-plan',
  token: string,
  body?: Record<string, unknown>,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetch(apiUrl(`/api/billing/${path}`), {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(body ?? {}),
    });
  } catch (err) {
    if (err instanceof WaServerOfflineError) {
      throw new BillingError(err.message);
    }
    throw new BillingError('Falha ao conectar no servidor. Tente novamente.');
  }

  const data = (await response.json().catch(() => ({}))) as
    | { error?: string; code?: string }
    | Record<string, unknown>;

  if (!response.ok) {
    const errorBody = data as { error?: string; code?: string };
    throw new BillingError(
      errorBody.error || `HTTP ${response.status}`,
      { code: errorBody.code, status: response.status },
    );
  }

  return data as T;
}

export async function changePlan(
  token: string,
  targetPlan: ChangePlanTarget,
): Promise<ChangePlanResult> {
  return callBilling<ChangePlanResult>('change-plan', token, { targetPlan });
}

export async function startCheckout(
  token: string,
  planTier: ChangePlanTarget,
): Promise<CheckoutResult> {
  return callBilling<CheckoutResult>('checkout', token, { planTier });
}

export async function openPortal(token: string): Promise<PortalResult> {
  return callBilling<PortalResult>('portal', token);
}
