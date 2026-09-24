import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { classifyOrderingTurn, mentionsMenu } from '../src/domain/aiWhatsAppOrdering.js';
import {
  decideOrderingEntry,
  ORDERING_INTENTS,
  type OrderingEntryDecision,
  type OrderingIntent,
  type OrderingRoute,
} from '../src/domain/orderingTurnRoute.js';
import { routeOrderingTurn } from '../server/orderingTurnRouter.js';

export interface OrderingEvalRow {
  text: string;
  expected: OrderingIntent;
  source: string;
}

export interface RouterEvalResult {
  route: OrderingRoute | null;
  latencyMs: number;
}

export interface OrderingGateMetrics {
  routerMissedOrders: number;
  keywordMissedOrders: number;
  routerAccuracy: number;
  keywordAccuracy: number;
  routerFalseOrdersInSafetyRows: number;
}

export function expectedDecision(intent: OrderingIntent): OrderingEntryDecision {
  switch (intent) {
    case 'pedido':
    case 'duvida_cardapio':
      return 'order';
    case 'pedir_cardapio':
      return 'menu_request';
    case 'conversa':
    case 'atendente':
    case 'outro':
      return 'generic';
  }
}

export function keywordDecision(text: string): OrderingEntryDecision {
  if (classifyOrderingTurn(text, false).kind !== 'catalog_or_order') return 'generic';
  return mentionsMenu(text) ? 'menu_request' : 'order';
}

export function percentile(values: readonly number[], percentileRank: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(1, Math.max(0, percentileRank));
  const index = (sorted.length - 1) * rank;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

export function computeGate(metrics: OrderingGateMetrics): boolean {
  return metrics.routerMissedOrders <= metrics.keywordMissedOrders
    && metrics.routerFalseOrdersInSafetyRows === 0
    && metrics.routerAccuracy >= metrics.keywordAccuracy;
}

function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(value: number, total: number): string {
  return `${(total === 0 ? 0 : (value / total) * 100).toFixed(1)}%`;
}

function loadFixture(): OrderingEvalRow[] {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../tests/fixtures/ordering-router-eval/v1.jsonl');
  return readFileSync(fixturePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      const row = JSON.parse(line) as Partial<OrderingEvalRow>;
      if (typeof row.text !== 'string' || typeof row.expected !== 'string' || typeof row.source !== 'string') {
        throw new Error(`Invalid fixture row ${index + 1}`);
      }
      if (!(ORDERING_INTENTS as readonly string[]).includes(row.expected)) {
        throw new Error(`Invalid expected intent on fixture row ${index + 1}: ${row.expected}`);
      }
      return row as OrderingEvalRow;
    });
}

async function mapWithConcurrency<T, U>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function formatItems(items: string[] | null): string {
  return items === null ? '-' : items.length === 0 ? '[]' : `[${items.join(', ')}]`;
}

async function main(): Promise<number> {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY não encontrada. Defina a chave no ambiente ou no arquivo .env para executar esta avaliação.');
    return 1;
  }

  const rows = loadFixture();
  const keywordDecisions = rows.map((row) => keywordDecision(row.text));
  const results = await mapWithConcurrency(rows, 5, async (row) => {
    const started = performance.now();
    const route = await routeOrderingTurn({ text: row.text, history: [], storeName: null });
    return { route, latencyMs: performance.now() - started } satisfies RouterEvalResult;
  });

  const expectedDecisions = rows.map((row) => expectedDecision(row.expected));
  const routerDecisions = results.map(({ route }) => route ? decideOrderingEntry(route) : 'generic');
  const keywordCorrect = keywordDecisions.filter((decision, index) => decision === expectedDecisions[index]).length;
  const routerCorrect = routerDecisions.filter((decision, index) => decision === expectedDecisions[index]).length;
  const perDecision = (decision: OrderingEntryDecision) => {
    const indexes = expectedDecisions.flatMap((expected, index) => expected === decision ? [index] : []);
    return `${decision}: keyword ${pct(indexes.filter((index) => keywordDecisions[index] === decision).length, indexes.length)}, router ${pct(indexes.filter((index) => routerDecisions[index] === decision).length, indexes.length)} (n=${indexes.length})`;
  };

  const falseOrders = (decisions: readonly OrderingEntryDecision[]) => decisions.filter((decision, index) => expectedDecisions[index] === 'generic' && decision === 'order').length;
  const missedOrders = (decisions: readonly OrderingEntryDecision[]) => decisions.filter((decision, index) => expectedDecisions[index] === 'order' && decision === 'generic').length;
  const routerFailed = results.filter(({ route }) => route === null).length;
  const intentCorrect = results.filter(({ route }, index) => route?.intent === rows[index].expected).length;
  const matrix = new Map<string, number>();
  for (const expected of ORDERING_INTENTS) for (const actual of ORDERING_INTENTS) matrix.set(`${expected}:${actual}`, 0);
  results.forEach(({ route }, index) => {
    if (route) matrix.set(`${rows[index].expected}:${route.intent}`, (matrix.get(`${rows[index].expected}:${route.intent}`) ?? 0) + 1);
  });
  const safetyFalseOrders = rows.filter((row, index) => (row.source === 'incident-2026-09-24' || row.expected === 'outro') && routerDecisions[index] === 'order').length;
  const gateMetrics: OrderingGateMetrics = {
    routerMissedOrders: missedOrders(routerDecisions),
    keywordMissedOrders: missedOrders(keywordDecisions),
    routerAccuracy: routerCorrect / rows.length,
    keywordAccuracy: keywordCorrect / rows.length,
    routerFalseOrdersInSafetyRows: safetyFalseOrders,
  };
  const latencies = results.map(({ latencyMs }) => latencyMs);
  const correctConfidences = results.flatMap(({ route }, index) => route && routerDecisions[index] === expectedDecisions[index] ? [route.confidence] : []);
  const incorrectConfidences = results.flatMap(({ route }, index) => route && routerDecisions[index] !== expectedDecisions[index] ? [route.confidence] : []);

  console.log(`Decision accuracy: keyword ${pct(keywordCorrect, rows.length)} (${keywordCorrect}/${rows.length}), router ${pct(routerCorrect, rows.length)} (${routerCorrect}/${rows.length})`);
  console.log(`Per expected decision: ${perDecision('order')}; ${perDecision('menu_request')}; ${perDecision('generic')}`);
  console.log(`Keyword baseline note: the real baseline also had a catalog probe; this offline script cannot reproduce it.`);
  console.log(`Router intent accuracy: ${pct(intentCorrect, rows.length)} (${intentCorrect}/${rows.length})`);
  console.log('Intent confusion matrix (rows=expected, columns=router):');
  console.log(`expected\\router\t${ORDERING_INTENTS.join('\t')}`);
  for (const expected of ORDERING_INTENTS) console.log(`${expected}\t${ORDERING_INTENTS.map((actual) => matrix.get(`${expected}:${actual}`) ?? 0).join('\t')}`);
  console.log(`False orders: keyword ${falseOrders(keywordDecisions)}, router ${falseOrders(routerDecisions)}; missed orders: keyword ${missedOrders(keywordDecisions)}, router ${missedOrders(routerDecisions)}`);
  console.log(`Router latency ms: p50=${percentile(latencies, 0.5).toFixed(1)}, p95=${percentile(latencies, 0.95).toFixed(1)}, max=${Math.max(...latencies).toFixed(1)}; router_failed=${routerFailed}`);
  console.log(`Mean confidence: correct decisions ${mean(correctConfidences).toFixed(3)} (n=${correctConfidences.length}), incorrect decisions ${mean(incorrectConfidences).toFixed(3)} (n=${incorrectConfidences.length})`);
  console.log('Wrong router decisions:');
  rows.forEach((row, index) => {
    if (routerDecisions[index] === expectedDecisions[index]) return;
    const route = results[index].route;
    const text = row.text.replace(/\s+/g, ' ').slice(0, 120);
    console.log(`- expected=${row.expected} router=${route?.intent ?? 'null'} confidence=${route?.confidence.toFixed(3) ?? '-'} items=${formatItems(route?.items ?? null)} text=${text}`);
  });
  const passed = computeGate(gateMetrics);
  console.log(`GATE: ${passed ? 'PASS' : 'FAIL'}`);
  return passed ? 0 : 2;
}

const invokedScript = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedScript) {
  main().then((code) => process.exit(code)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
