import {
  clearZeloImpressaoPairing,
  detectZeloImpressao,
  fallbackToBrowserPrint,
  getConfig as getZeloImpressaoConfig,
  getZeloImpressaoFriendlyMessage,
  isPrintOutcomeUnknown,
  pairZeloImpressao,
  sendPrintJob,
  sendTestPrint,
} from './zeloImpressaoClient';
import type { Order } from '../types';

export { clearZeloImpressaoPairing as clearLocalPrintPairing };

const LINE_WIDTH = 32;

function fmtMoney(n: number): string {
  return `R$ ${Number(n || 0).toFixed(2).replace('.', ',')}`;
}

function line(value = ''): string {
  return value.slice(0, LINE_WIDTH);
}

function wrapText(value: string, width = LINE_WIDTH): string[] {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = '';
      }
      for (let offset = 0; offset < word.length; offset += width) {
        lines.push(word.slice(offset, offset + width));
      }
      continue;
    }

    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function wrapIndentedText(value: string, indent = '  '): string[] {
  return wrapText(value, Math.max(1, LINE_WIDTH - indent.length)).map((lineText) => `${indent}${lineText}`);
}

function itemReceiptLines(item: Order['items'][number]): string[] {
  const productName = item.productName || item.product;
  const lines = wrapText(`${item.quantity}x ${productName}`);
  for (const group of item.modifierGroups ?? []) {
    const options = group.optionNames.join(', ');
    if (!options) continue;
    lines.push(...wrapIndentedText(`${group.groupName}: ${options}`));
  }
  return lines;
}

function sep(char = '-'): string {
  return char.repeat(LINE_WIDTH);
}

function row(label: string, value: string): string {
  const left = String(label || '');
  const right = String(value || '');
  const gap = Math.max(1, LINE_WIDTH - left.length - right.length);
  return `${left}${' '.repeat(gap)}${right}`;
}

function browserHtmlFromText(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 3mm; }
    body { margin: 0; font: 12px/1.3 "Courier New", monospace; color: #000; background: #fff; }
    pre { white-space: pre-wrap; margin: 0; }
  </style></head><body><pre>${escaped}</pre><script>window.onload=function(){setTimeout(function(){window.print()},80)}</script></body></html>`;
}

export function buildOrderText(order: Order, businessName = 'ZeloChat'): string {
  const shortId = order.id.slice(-8).toUpperCase();
  const rows = [
    line(businessName.toUpperCase()),
    sep('='),
    `PEDIDO #${shortId}`,
    `Cliente: ${order.customerName}`,
    `Tel: ${order.customerPhone || '-'}`,
    sep(),
  ];

  for (const item of order.items) {
    rows.push(...itemReceiptLines(item));
  }

  rows.push(
    sep(),
    row('TOTAL:', fmtMoney(order.total)),
    `Pagamento: ${order.paymentMethod || '-'}`,
  );

  if (order.deliveryAddress) {
    rows.push('Entrega:', ...wrapText(order.deliveryAddress));
  } else {
    rows.push(`Retirada: ${order.pickupTime || '-'}`);
  }

  if (order.observations) {
    rows.push(sep(), ...wrapText(`Obs: ${order.observations}`));
  }

  return `${rows.join('\n')}\n\n\n`;
}

export function buildDayReportText(dateLabel: string, orders: Order[], businessName = 'ZeloChat'): string {
  const rows = [
    line(businessName.toUpperCase()),
    sep('='),
    'PEDIDOS DO DIA',
    dateLabel,
    `Total de pedidos: ${orders.length}`,
    sep(),
  ];

  let totalGeral = 0;
  for (const order of orders) {
    const shortId = order.id.slice(-8).toUpperCase();
    rows.push(`[${order.pickupTime || '--:--'}] ${order.customerName}`.slice(0, LINE_WIDTH));
    rows.push(`Ped #${shortId} | ${order.status}`.slice(0, LINE_WIDTH));
    for (const item of order.items) {
      rows.push(...itemReceiptLines(item));
    }
    if (order.deliveryAddress) rows.push('  Entrega');
    rows.push(row('  Total:', fmtMoney(order.total)), sep('-'));
    totalGeral += Number(order.total || 0);
  }

  rows.push(row('TOTAL GERAL:', fmtMoney(totalGeral)));
  return `${rows.join('\n')}\n\n\n`;
}

export async function getLocalPrintStatus(): Promise<{
  supported: boolean;
  connected: boolean;
  deviceName: string | null;
  error: string | null;
}> {
  const detection = await detectZeloImpressao();
  if (!detection.running) {
    return {
      supported: true,
      connected: false,
      deviceName: null,
      error: detection.message || 'Zelo Impressão indisponível.',
    };
  }

  try {
    const config = detection.paired ? await getZeloImpressaoConfig() : null;
    return {
      supported: true,
      connected: detection.paired,
      deviceName: config?.selectedPrinterName || 'Zelo Impressão',
      error: detection.paired ? null : 'A conexão automática não foi concluída. Se o aplicativo pedir, digite o código exibido no Zelo Impressão.',
    };
  } catch (error) {
    return {
      supported: true,
      connected: false,
      deviceName: null,
      error: getZeloImpressaoFriendlyMessage(error),
    };
  }
}

export function isPrinterSupported(): boolean {
  return typeof window !== 'undefined' && typeof fetch === 'function';
}

export async function pairLocalPrint(code: string): Promise<void> {
  await pairZeloImpressao(code);
}

export interface OrderPrintOptions {
  mode: 'automatic' | 'manual';
  companyStoreId: string;
}

export async function printOrder(order: Order, businessName = 'ZeloChat', options?: OrderPrintOptions): Promise<void> {
  const text = buildOrderText(order, businessName);
  await sendPrintJob({
    source: 'zelochat',
    companyStoreId: options?.companyStoreId,
    intent: options?.mode === 'automatic'
      ? { mode: 'automatic', orderId: order.id, purpose: 'order_ticket' }
      : { mode: 'manual' },
    type: 'kitchen_order',
    timestamp: new Date().toISOString(),
    content: { format: 'text', text },
    metadata: {
      orderId: order.id,
      status: order.status,
      customerPhone: order.customerPhone,
    },
  });
}

export async function printDayReport(
  dateLabel: string,
  orders: Order[],
  businessName = 'ZeloChat',
  options: { browserFallback?: boolean } = {},
): Promise<void> {
  const text = buildDayReportText(dateLabel, orders, businessName);
  try {
    await sendPrintJob({
      source: 'zelochat',
      type: 'receipt',
      timestamp: new Date().toISOString(),
      content: { format: 'text', text },
      metadata: { report: 'day', dateLabel, orderCount: orders.length },
    });
  } catch (error) {
    if (options.browserFallback && !isPrintOutcomeUnknown(error)) {
      await fallbackToBrowserPrint(browserHtmlFromText(text));
      return;
    }
    throw error;
  }
}

export async function printTest(): Promise<void> {
  await sendTestPrint();
}

export { getZeloImpressaoFriendlyMessage };
