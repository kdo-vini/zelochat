/**
 * Tier-S edge coverage do atendimento IA para horário/agenda, pensando em como
 * o brasileiro fala informalmente no WhatsApp: "pra já", "20h", "8 da noite",
 * "amanhã", "a 5 reais" (que NÃO é horário), etc.
 *
 * Foco: nunca mandar mensagem sem sentido pro cliente ("esse horário já passou:
 * 20:08" quando são 20:09) e nunca confundir preço/quantidade com horário.
 *
 * Superfície testada:
 *  - parseTimeToMinutes / collectRequestedTimeMinutes / collectRequestedDateIsos
 *  - evaluateCreateOrderScheduleGuard (guard do criar_pedido)
 *  - findBusinessHoursIssueFromCustomerText (guard sobre texto livre do cliente)
 */
import {
  __aiScheduleGuardsForTests,
  evaluateCreateOrderScheduleGuard,
  minutesToDisplay,
  parseTimeToMinutes,
} from '../server/ai.js';
import { setConfig } from '../server/configStore.js';
import { assert, assertIncludes, runSuite } from './testHarness.js';

const { collectRequestedTimeMinutes, collectRequestedDateIsos, findBusinessHoursIssueFromCustomerText } =
  __aiScheduleGuardsForTests;

type AnyGuard =
  | { type: string; reply?: string; issue?: { kind?: string; timeMinutes?: number } }
  | null;

function atUtc(value: string): Date {
  return new Date(value);
}

// Bem Servido: atende 11:00–23:00, fuso America/Sao_Paulo (UTC-3).
function setup(empresaId: string, overrides: Record<string, unknown> = {}): void {
  setConfig(empresaId, {
    name: 'Bem Servido',
    specialty: 'lanches',
    openTime: '11:00',
    closeTime: '23:00',
    closedDays: [],
    timezone: 'America/Sao_Paulo',
    address: 'Rua Teste, 123',
    pixKey: 'pix@teste.com.br',
    aiEnabled: true,
    aiMode: 'always_on',
    products: [{ name: 'X-Burguer', price: 20, available: true }],
    blockedDates: [],
    aiInstructions: 'Atenda de forma curta.',
    deliveryConfig: { enabled: false, neighborhoods: [] },
    zelochatMode: 'restaurant',
    ...overrides,
  });
}

// 20:09 em America/Sao_Paulo == 23:09 UTC (sexta-feira 2026-07-24).
const NOW = '2026-07-24T23:09:00.000Z';
const TODAY = '2026-07-24';
const TOMORROW = '2026-07-25';

function sameSet(a: number[], b: number[]): boolean {
  const sa = [...a].sort((x, y) => x - y);
  const sb = [...b].sort((x, y) => x - y);
  return sa.length === sb.length && sa.every((v, i) => v === sb[i]);
}

function labels(mins: number[]): string {
  return mins.map(minutesToDisplay).join(', ') || '(nenhum)';
}

function guardOrder(pickupDate: string, pickupTime: string, overrides: Record<string, unknown> = {}): AnyGuard {
  const empresaId = `edge-${Math.random().toString(36).slice(2)}`;
  setup(empresaId, overrides);
  return evaluateCreateOrderScheduleGuard(empresaId, pickupDate, pickupTime, atUtc(NOW)) as unknown as AnyGuard;
}

function issueFromText(text: string, overrides: Record<string, unknown> = {}): AnyGuard {
  const empresaId = `edge-txt-${Math.random().toString(36).slice(2)}`;
  setup(empresaId, overrides);
  const issue = findBusinessHoursIssueFromCustomerText(empresaId, text, atUtc(NOW));
  return (issue ? { type: 'business_hours', issue } : null) as AnyGuard;
}

// ── helpers de asserção sobre parsing de horário ─────────────────────────────
const timeParsesTo = (phrase: string, expected: number[]) => ({
  name: `hora: "${phrase}" -> ${labels(expected)}`,
  run: () => {
    const got = collectRequestedTimeMinutes(phrase);
    assert(sameSet(got, expected), `esperava ${labels(expected)}, veio ${labels(got)}`);
  },
});

const timeIsEmpty = (phrase: string) => ({
  name: `NÃO é horário: "${phrase}"`,
  run: () => {
    const got = collectRequestedTimeMinutes(phrase);
    assert(got.length === 0, `"${phrase}" não devia virar horário, veio ${labels(got)}`);
  },
});

const parsingHorario = [
  timeParsesTo('20:08', [1208]),
  timeParsesTo('quero pra 20:08', [1208]),
  timeParsesTo('20h08', [1208]),
  timeParsesTo('20h', [1200]),
  timeParsesTo('20hs', [1200]),
  timeParsesTo('20hrs', [1200]),
  timeParsesTo('20 horas', [1200]),
  timeParsesTo('pode ser 21hrs', [1260]),
  timeParsesTo('19:30', [1170]),
  timeParsesTo('19h30', [1170]),
  timeParsesTo('12h30', [750]),
  timeParsesTo('chego 20h05', [1205]),
  timeParsesTo('meio dia', [720]),
  timeParsesTo('meio-dia', [720]),
  timeParsesTo('8 da noite', [1200]),
  timeParsesTo('oito', []), // número por extenso não é suportado (documenta o limite)
  timeParsesTo('10 da noite', [1320]),
  timeParsesTo('11 da noite', [1380]),
  timeParsesTo('3 da tarde', [900]),
  timeParsesTo('6 da tarde', [1080]),
  timeParsesTo('9 da manha', [540]),
  timeParsesTo('9 da manhã', [540]),
  timeParsesTo('às 19h', [1140]),
  timeParsesTo('as 19', [1140]),
  timeParsesTo('a 8', [480]),
  timeParsesTo('as 5 da tarde', [1020]), // só 17:00, sem o falso 05:00
  timeParsesTo('entre 19h e 21h', [1140, 1260]),
];

const precoNaoHorario = [
  timeIsEmpty('quero 2 coxinhas a 5 reais'),
  timeIsEmpty('me ve 3 a 10 reais'),
  timeIsEmpty('pode fazer a 15 reais?'),
  timeIsEmpty('daqui a 20 minutos'),
  timeIsEmpty('chego a 10 min'),
  timeIsEmpty('a 12 unidades'),
  timeIsEmpty('vou querer 6 pessoas'),
  timeIsEmpty('me ve a 2 caixas'),
];

const parsingDatas = [
  {
    name: 'data: "hoje" -> 24/07',
    run: () => assert(collectRequestedDateIsos('hoje', atUtc(NOW), 'America/Sao_Paulo').includes(TODAY), 'hoje'),
  },
  {
    name: 'data: "amanhã" -> 25/07',
    run: () => assert(collectRequestedDateIsos('amanhã', atUtc(NOW), 'America/Sao_Paulo').includes(TOMORROW), 'amanhã'),
  },
  {
    name: 'data: "amanha" (sem til) -> 25/07',
    run: () => assert(collectRequestedDateIsos('amanha', atUtc(NOW), 'America/Sao_Paulo').includes(TOMORROW), 'amanha'),
  },
  {
    name: 'data: "depois de amanhã" -> 26/07 e NÃO 25/07',
    run: () => {
      const isos = collectRequestedDateIsos('depois de amanha', atUtc(NOW), 'America/Sao_Paulo');
      assert(isos.includes('2026-07-26'), 'depois de amanhã = 26/07');
      assert(!isos.includes(TOMORROW), 'não deve incluir amanhã');
    },
  },
  {
    name: 'data: "sabado" -> próximo sábado 25/07',
    run: () => assert(collectRequestedDateIsos('sabado', atUtc(NOW), 'America/Sao_Paulo').includes('2026-07-25'), 'sábado'),
  },
  {
    name: 'data: "25/12" -> 25/12 do ano corrente',
    run: () => assert(collectRequestedDateIsos('25/12', atUtc(NOW), 'America/Sao_Paulo').includes('2026-12-25'), '25/12'),
  },
  {
    name: 'data: "dia 25 de dezembro" -> 25/12',
    run: () => assert(collectRequestedDateIsos('dia 25 de dezembro', atUtc(NOW), 'America/Sao_Paulo').includes('2026-12-25'), 'nome do mês'),
  },
];

const pedidoPraJa = [
  {
    name: 'pickup 20:08 quando são 20:09 (bug reportado Bem Servido)',
    run: () => assert(guardOrder(TODAY, '20:08') === null, 'não pode rejeitar pedido imediato'),
  },
  {
    name: 'pickup no minuto exato 20:09',
    run: () => assert(guardOrder(TODAY, '20:09') === null, 'minuto atual não é passado'),
  },
  {
    name: 'pickup 20:05 (latência multi-turno, 4 min atrás)',
    run: () => assert(guardOrder(TODAY, '20:05') === null, 'dentro da tolerância'),
  },
  {
    name: 'pickup 19:55 (14 min atrás, ainda ~agora)',
    run: () => assert(guardOrder(TODAY, '19:55') === null, 'dentro da tolerância de 15 min'),
  },
  {
    name: 'pickup 22:30 hoje (dentro do horário)',
    run: () => assert(guardOrder(TODAY, '22:30') === null, 'horário válido dentro da janela'),
  },
  {
    name: 'pickup "20h" (formato informal) hoje',
    run: () => assert(guardOrder(TODAY, '20h') === null, '20h ~ agora, válido'),
  },
];

const horariosInvalidos = [
  {
    name: 'pickup 14:00 hoje (6h atrás) -> já passou',
    run: () => {
      const g = guardOrder(TODAY, '14:00');
      assert(g?.type === 'business_hours' && g.issue?.kind === 'past_time', 'past_time');
      assertIncludes(g?.reply ?? '', 'já passou', 'mensagem de horário passado');
    },
  },
  {
    name: 'pickup 19:40 hoje (29 min atrás, além da tolerância) -> já passou',
    run: () => assert(guardOrder(TODAY, '19:40')?.issue?.kind === 'past_time', 'past_time além da graça'),
  },
  {
    name: 'pickup 08:00 amanhã (antes de abrir) -> before_open',
    run: () => assert(guardOrder(TOMORROW, '08:00')?.issue?.kind === 'before_open', 'before_open'),
  },
  {
    name: 'pickup 23:30 amanhã (depois de fechar) -> after_close',
    run: () => assert(guardOrder(TOMORROW, '23:30')?.issue?.kind === 'after_close', 'after_close'),
  },
  {
    name: 'pickup 12:00 amanhã (dentro do horário) -> ok',
    run: () => assert(guardOrder(TOMORROW, '12:00') === null, 'horário futuro válido'),
  },
  {
    name: 'pickup em data bloqueada -> blocked_date',
    run: () => {
      const g = guardOrder('2026-12-25', '12:00', { blockedDates: [{ date: '2026-12-25', reason: 'Natal' }] });
      assert(g?.type === 'blocked_date', 'blocked_date');
      assertIncludes(g?.reply ?? '', 'Natal', 'motivo preservado');
    },
  },
];

const textoLivre = [
  {
    name: '"quero retirar hoje as 14h" -> já passou',
    run: () => {
      const g = issueFromText('quero retirar hoje as 14h');
      assert(g?.issue?.kind === 'past_time', 'past_time no texto');
    },
  },
  {
    name: '"vou querer as 22h hoje" -> sem problema (dentro do horário)',
    run: () => assert(issueFromText('vou querer as 22h hoje') === null, 'horário válido'),
  },
  {
    name: '"quero pra retirar 20:08" (~agora) -> não é passado',
    run: () => {
      const g = issueFromText('quero pra retirar 20:08');
      assert(g === null || g.issue?.kind !== 'past_time', 'nunca "já passou" pra horário ~agora');
    },
  },
  {
    name: '"quero 2 coxinhas a 5 reais" -> preço não vira horário passado',
    run: () => {
      const g = issueFromText('quero 2 coxinhas a 5 reais');
      assert(g === null || g.issue?.kind !== 'past_time', 'preço não pode gerar "já passou"');
    },
  },
  {
    name: '"me ve 3 a 10 reais pra buscar" -> preço/quantidade não vira horário',
    run: () => {
      const g = issueFromText('me ve 3 a 10 reais pra buscar');
      assert(g === null || g.issue?.kind !== 'past_time', 'sem falso past_time');
    },
  },
  {
    name: '"quero pra amanha as 9h" -> antes de abrir (não passado, dia futuro)',
    run: () => {
      const g = issueFromText('quero pra amanha as 9h');
      assert(g?.issue?.kind === 'before_open', 'before_open no dia futuro');
    },
  },
];

await runSuite('IA horário/agenda — edge cases de comunicação informal (BR)', [
  ...parsingHorario,
  ...precoNaoHorario,
  ...parsingDatas,
  ...pedidoPraJa,
  ...horariosInvalidos,
  ...textoLivre,
]);
