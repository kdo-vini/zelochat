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
  source: ZeloImpressaoSource;
  companyStoreId?: string;
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

function normalizeReleaseChannel(channel: string | undefined): string {
  const value = String(channel || 'latest').trim();
  return value || 'latest';
}

export function getZeloImpressaoInstallerUrl(channel = 'latest'): string {
  const normalizedChannel = normalizeReleaseChannel(channel);
  if (normalizedChannel === 'latest') return ZELO_IMPRESSAO_INSTALLER_DOWNLOAD_URL;
  return `${ZELO_IMPRESSAO_DOWNLOADS_BASE_URL}/${encodeURIComponent(normalizedChannel)}/${ZELO_IMPRESSAO_INSTALLER_FILENAME}`;
}

export function getZeloImpressaoDownloadPageUrl(): string {
  return ZELO_IMPRESSAO_DOWNLOAD_PAGE_URL;
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

function withTimeout<T>(
  promise: (signal: AbortSignal) => Promise<T>,
  timeoutMs = TIMEOUT_MS,
): { signal: AbortSignal; run: Promise<T> } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    run: promise(controller.signal).finally(() => clearTimeout(timeout)),
  };
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

  const task = withTimeout(
    (signal) =>
      fetch(`${options.baseUrl || DEFAULT_BASE_URL}${path}`, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal,
      }),
    options.timeoutMs,
  );

  let response: Response;
  try {
    response = await task.run;
  } catch (error) {
    throw Object.assign(new Error(ZELO_IMPRESSAO_UNAVAILABLE_MESSAGE), {
      code: 'ZELO_IMPRESSAO_UNAVAILABLE',
      cause: error,
    });
  }

  let data: Record<string, unknown> | null = null;
  try {
    data = await response.json() as Record<string, unknown>;
  } catch {}

  if (!response.ok || data?.ok === false) {
    const code =
      (data?.code as string) ||
      (response.status === 401 ? 'PAIRING_REQUIRED' : 'ZELO_IMPRESSAO_ERROR');
    const message =
      code === 'PAIRING_REQUIRED'
        ? 'Conecte este navegador ao Zelo Impressão usando o código exibido no aplicativo.'
        : friendlyMessage((data?.message as string) || response.statusText);
    throw Object.assign(new Error(message), {
      code,
      status: response.status,
      data,
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

export async function detectZeloImpressao(
  options: Record<string, unknown> = {},
): Promise<{
  installed: boolean;
  running: boolean;
  paired: boolean;
  health?: unknown;
  error?: unknown;
  message?: string;
}> {
  try {
    const health = await request('/health', { ...options, token: '' });
    const hasToken = !!getStoredToken();
    const h = health as Record<string, unknown>;
    return {
      installed: true,
      running: true,
      paired: !h.pairingRequired || (!!h.paired && hasToken),
      health,
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
  return request('/print', {
    ...options,
    method: 'POST',
    timeoutMs: (options.timeoutMs as number) || 12000,
    body: {
      ...job,
      timestamp: job.timestamp || new Date().toISOString(),
    },
  });
}

export async function sendTestPrint(
  printerId?: string,
  options: Record<string, unknown> = {},
): Promise<unknown> {
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
  return friendlyMessage((error as { message?: string })?.message || String(error || ''));
}

export function clearZeloImpressaoPairing(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}
