const DEFAULT_BASE_URL = 'http://127.0.0.1:17321';
const TOKEN_KEY = 'zelo_impressao_token_v1';
const TIMEOUT_MS = 1800;

export const ZELO_IMPRESSAO_DOWNLOAD_PAGE_URL = 'https://zelopdv.com.br/zelo-impressao';
export const ZELO_IMPRESSAO_DOWNLOADS_BASE_URL = 'https://zelopdv.com.br/downloads/zelo-impressao';
export const ZELO_IMPRESSAO_INSTALLER_FILENAME = 'Zelo-Impressao-Setup.exe';
export const ZELO_IMPRESSAO_INSTALLER_DOWNLOAD_URL = `${ZELO_IMPRESSAO_DOWNLOADS_BASE_URL}/latest/${ZELO_IMPRESSAO_INSTALLER_FILENAME}`;

export const ZELO_IMPRESSAO_UNAVAILABLE_MESSAGE =
  'O Zelo Impressão não está aberto neste computador. Abra o aplicativo ou use a impressão pelo navegador.';

export const ZELO_IMPRESSAO_PRINTER_UNAVAILABLE_MESSAGE =
  'Não conseguimos acessar a impressora selecionada. Verifique se ela está ligada e conectada.';

export const ZELO_IMPRESSAO_OUTCOME_UNKNOWN_MESSAGE =
  'Não foi possível confirmar a impressão. Confira a saída antes de tentar novamente.';

export const ZELO_IMPRESSAO_AUTO_CONNECT_FALLBACK_MESSAGE =
  'A conexão automática não foi concluída. Se o aplicativo pedir, digite o código exibido no Zelo Impressão.';

export type ZeloImpressaoSource = 'zelopdv' | 'zelochat';
export type ZeloImpressaoJobType = 'receipt' | 'kitchen_order' | 'test' | 'raw_escpos';

export interface ZeloImpressaoPrinter {
  id: string;
  name: string;
  isDefault: boolean;
  isOffline: boolean;
  status: string;
  driverName?: string;
  portName?: string;
}

export interface ZeloImpressaoPrintJob {
  jobId?: string;
  source: ZeloImpressaoSource;
  companyStoreId?: string;
  intent?: { mode: 'automatic'; orderId: string; purpose: 'order_ticket' } | { mode: 'manual' };
  type: ZeloImpressaoJobType;
  printerId?: string;
  printerName?: string;
  timestamp?: string;
  content:
    | { format: 'text'; text: string }
    | { format: 'html'; html: string }
    | { format: 'raw_escpos_base64'; base64: string };
  metadata?: Record<string, unknown>;
}

function getStoredToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

async function request(
  path: string,
  options: {
    token?: string;
    body?: unknown;
    method?: string;
    baseUrl?: string;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const token = options.token ?? getStoredToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'X-Zelo-Impressao-Token': token } : {}),
  };

  const body = options.body ? JSON.stringify(options.body) : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const isPrint = path === '/print' || path === '/test-print';
  let response: Response;
  let data: Record<string, unknown> | null = null;
  try {
    response = await fetch(`${options.baseUrl || DEFAULT_BASE_URL}${path}`, {
      method: options.method || 'GET', headers, body, signal: controller.signal,
    });
    try { data = await response.json() as Record<string, unknown>; }
    catch (error) { if (response.ok || controller.signal.aborted) throw error; }
    if (response.ok && (!data || typeof data.ok !== 'boolean')) {
      throw new Error('Invalid response from local printer');
    }
  } catch (error) {
    throw Object.assign(new Error(isPrint ? ZELO_IMPRESSAO_OUTCOME_UNKNOWN_MESSAGE : ZELO_IMPRESSAO_UNAVAILABLE_MESSAGE), {
      code: isPrint ? 'PRINT_OUTCOME_UNKNOWN' : 'ZELO_IMPRESSAO_UNAVAILABLE',
      retrySafe: !isPrint,
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok || data?.ok === false) {
    let code =
      (data?.code as string) ||
      (response.status === 401 ? 'PAIRING_REQUIRED' : 'ZELO_IMPRESSAO_ERROR');
    // Older native versions returned generic HTTP 400 even after the spooler
    // started. Only explicit retrySafe or a pre-dispatch HTTP refusal is safe.
    const retrySafe = typeof data?.retrySafe === 'boolean'
      ? data.retrySafe
      : isPrint ? [401, 403, 404, 413, 415].includes(response.status) : response.status < 500;
    if (isPrint && !retrySafe) code = 'PRINT_OUTCOME_UNKNOWN';
    if (code === 'PAIRING_REQUIRED') {
      // Stale token rejected — wipe it so the pairing UI shows immediately
      try { localStorage.removeItem(TOKEN_KEY); } catch {}
    }
    const message =
      code === 'PRINT_OUTCOME_UNKNOWN' ? ZELO_IMPRESSAO_OUTCOME_UNKNOWN_MESSAGE : code === 'PAIRING_REQUIRED'
        ? ZELO_IMPRESSAO_AUTO_CONNECT_FALLBACK_MESSAGE
        : friendlyMessage((data?.message as string) || response.statusText);
    throw Object.assign(new Error(message), {
      code,
      status: response.status,
      data,
      retrySafe,
    });
  }

  return data;
}

function friendlyMessage(message: string): string {
  const raw = String(message || '');
  if (/offline|unavailable|printer|impressora/i.test(raw)) {
    return ZELO_IMPRESSAO_PRINTER_UNAVAILABLE_MESSAGE;
  }
  if (/fetch|refused|network|failed|abort|localhost/i.test(raw)) {
    return ZELO_IMPRESSAO_UNAVAILABLE_MESSAGE;
  }
  return raw || 'Não conseguimos concluir a impressão agora.';
}

export async function connectZeloImpressao(
  options: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const response = await request('/connect', {
    ...options,
    method: 'POST',
    token: '',
    body: {},
  }) as Record<string, unknown>;
  if (!response.token) {
    throw Object.assign(new Error(ZELO_IMPRESSAO_AUTO_CONNECT_FALLBACK_MESSAGE), {
      code: 'AUTO_CONNECT_INVALID_RESPONSE',
      data: response,
    });
  }
  setStoredToken(response.token as string);
  return response;
}

export async function detectZeloImpressao(
  options: Record<string, unknown> = {},
): Promise<{
  installed: boolean;
  running: boolean;
  paired: boolean;
  health?: unknown;
  error?: unknown;
  message?: string;
  autoConnected?: boolean;
  autoConnectError?: unknown;
}> {
  try {
    const health = await request('/health', { ...options, token: '' });
    const hasToken = !!getStoredToken();
    const h = health as Record<string, unknown>;
    let autoConnected = false;
    let autoConnectError: unknown = null;
    let alreadyPaired = !h.pairingRequired;
    if (hasToken) {
      try { await request('/config', options); alreadyPaired = true; }
      catch (error) { autoConnectError = error; }
    }

    if (!alreadyPaired && options.autoConnect !== false) {
      try {
        await connectZeloImpressao(options);
        autoConnected = true;
      } catch (error) {
        autoConnectError = error;
      }
    }

    const paired = alreadyPaired || autoConnected;
    return {
      installed: true,
      running: true,
      paired,
      autoConnected,
      autoConnectError,
      health,
      message: paired ? undefined : ZELO_IMPRESSAO_AUTO_CONNECT_FALLBACK_MESSAGE,
    };
  } catch (error) {
    return {
      installed: false,
      running: false,
      paired: false,
      error,
      message: ZELO_IMPRESSAO_UNAVAILABLE_MESSAGE,
    };
  }
}

export async function pairZeloImpressao(
  code: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await request('/pair', {
    ...options,
    method: 'POST',
    token: '',
    body: { code: String(code || '').trim() },
  }) as Record<string, unknown>;
  if (response.token) setStoredToken(response.token as string);
  return response;
}

export async function getPrinters(
  options: Record<string, unknown> = {},
): Promise<ZeloImpressaoPrinter[]> {
  const response = await request('/printers', options) as Record<string, unknown>;
  return (response.printers as ZeloImpressaoPrinter[]) || [];
}

export async function getConfig(
  options: Record<string, unknown> = {},
): Promise<{
  selectedPrinterId: string | null;
  selectedPrinterName: string | null;
  startWithWindows: boolean;
  requirePairing: boolean;
  allowedOrigins: string[];
}> {
  const response = await request('/config', options) as Record<string, unknown>;
  return response.config as ReturnType<typeof getConfig> extends Promise<infer T> ? T : never;
}

export async function saveConfig(
  config: Record<string, unknown>,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  const response = await request('/config', {
    ...options,
    method: 'POST',
    body: config,
  }) as Record<string, unknown>;
  return response.config;
}

export async function sendPrintJob(
  job: ZeloImpressaoPrintJob,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  let health: { capabilities?: { canonicalAutoPrint?: boolean; persistentPrintDeduplication?: boolean } } | undefined;
  try { health = await request('/health', { ...options, token: '' }) as typeof health; }
  catch (error) { if (job.intent?.mode !== 'automatic') throw error; }
  if (job.intent?.mode === 'automatic' && (
    health?.capabilities?.canonicalAutoPrint !== true ||
    health?.capabilities?.persistentPrintDeduplication !== true
  )) {
    throw Object.assign(new Error('Abra ou atualize o Zelo Impressão para coordenar a impressão automática entre PDV e Chat.'), {
      code: 'AUTO_PRINT_COORDINATION_REQUIRED', retrySafe: false,
    });
  }
  return request('/print', {
    ...options,
    method: 'POST',
    timeoutMs: (options.timeoutMs as number) || 12000,
    body: {
      ...job,
      jobId: job.jobId || globalThis.crypto?.randomUUID?.(),
      timestamp: job.timestamp || new Date().toISOString(),
    },
  });
}

export async function sendTestPrint(
  printerId?: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
  await request('/health', { ...options, token: '' });
  return request('/test-print', {
    ...options,
    method: 'POST',
    timeoutMs: (options.timeoutMs as number) || 10000,
    body: { printerId },
  });
}

export function fallbackToBrowserPrint(html: string): Promise<void> {
  return new Promise((resolve) => {
    const iframe = document.createElement('iframe');
    iframe.style.cssText =
      'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;visibility:hidden;';
    document.body.appendChild(iframe);
    const cleanup = () =>
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {}
        resolve();
      }, 500);
    try {
      (iframe.contentWindow as Window).addEventListener('afterprint', cleanup);
    } catch {}
    setTimeout(cleanup, 15000);
    const doc = iframe.contentDocument || (iframe.contentWindow as Window).document;
    doc.open();
    doc.write(html);
    doc.close();
    if (!/window\.print\s*\(/i.test(html)) {
      setTimeout(() => {
        try {
          (iframe.contentWindow as Window).focus();
          (iframe.contentWindow as Window).print();
        } catch {}
      }, 150);
    }
  });
}

export function getZeloImpressaoFriendlyMessage(error: unknown): string {
  if ((error as { code?: string })?.code === 'AUTO_PRINT_COORDINATION_REQUIRED') {
    return 'Abra ou atualize o Zelo Impressão para coordenar a impressão automática entre PDV e Chat.';
  }
  if (isPrintOutcomeUnknown(error)) return ZELO_IMPRESSAO_OUTCOME_UNKNOWN_MESSAGE;
  return friendlyMessage((error as { message?: string })?.message || String(error || ''));
}

export function isPrintOutcomeUnknown(error: unknown): boolean {
  const failure = error as { code?: string; retrySafe?: boolean } | null;
  return failure?.code === 'PRINT_OUTCOME_UNKNOWN' || failure?.retrySafe === false;
}

export function clearZeloImpressaoPairing(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
