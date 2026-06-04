import {
  buildSystemInstruction,
  evaluateCreateOrderScheduleGuard,
  evaluateScheduleGuardForDryRun,
} from '../server/ai.js';
import { setConfig } from '../server/configStore.js';
import { assert, assertIncludes, runSuite } from './testHarness.js';

function atUtc(value: string): Date {
  return new Date(value);
}

function withMockedNow<T>(value: string, run: () => T): T {
  const RealDate = Date;
  class MockDate extends Date {
    constructor(input?: string | number | Date) {
      super(input ?? value);
    }

    static override now(): number {
      return new RealDate(value).getTime();
    }
  }
  globalThis.Date = MockDate as DateConstructor;
  try {
    return run();
  } finally {
    globalThis.Date = RealDate;
  }
}

function setupConfig(empresaId: string): void {
  setConfig(empresaId, {
    name: 'Casa dos Salgados',
    specialty: 'salgados',
    openTime: '09:00',
    closeTime: '18:00',
    closedDays: [],
    timezone: 'America/Sao_Paulo',
    address: 'Rua Teste, 123',
    pixKey: 'pix@teste.com.br',
    aiEnabled: true,
    aiMode: 'always_on',
    products: [
      { name: 'Cento Tradicionais Sortidos', price: 80, available: true, unitBased: true },
    ],
    blockedDates: [
      { date: '2026-06-04', reason: 'feriado' },
    ],
    dailyContext: [],
    aiInstructions: 'Atenda de forma curta.',
    deliveryConfig: { enabled: false, neighborhoods: [] },
    zelochatMode: 'restaurant',
  });
}

await runSuite('AI simulator schedule guardrails', [
  {
    name: 'simulator dry-run blocks implicit order when today is blocked',
    run: () => {
      const empresaId = `sim-schedule-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateScheduleGuardForDryRun(
        empresaId,
        [{ role: 'user', content: 'Oi, queria fazer um pedido' }],
        atUtc('2026-06-04T15:00:00.000Z'),
      );
      assert(guard?.type === 'blocked_date', 'implicit same-day order hits blocked-date guard');
      assertIncludes(guard?.reply ?? '', 'não estamos aceitando encomendas', 'blocked-date reply is returned before OpenAI');
      assertIncludes(guard?.reply ?? '', 'feriado', 'blocked-date reason is preserved');
    },
  },
  {
    name: 'simulator dry-run blocks menu availability when today is blocked and no future date is given',
    run: () => {
      const empresaId = `sim-product-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateScheduleGuardForDryRun(
        empresaId,
        [{ role: 'user', content: 'Bom dia, tem coxinha de carne?' }],
        atUtc('2026-06-04T13:30:00.000Z'),
      );
      assert(guard?.type === 'blocked_date', 'product availability without future date hits blocked-date guard');
      assertIncludes(guard?.reply ?? '', 'feriado', 'reply explains the holiday block');
    },
  },
  {
    name: 'simulator dry-run blocks Pix/pickup progression when today is blocked',
    run: () => {
      const empresaId = `sim-pix-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateScheduleGuardForDryRun(
        empresaId,
        [
          { role: 'user', content: 'Tem coxinha de carne?' },
          { role: 'assistant', content: 'Temos sim. Quer pedir alguma?' },
          { role: 'user', content: 'Vou mandar o pix e meu filho vai buscar' },
        ],
        atUtc('2026-06-04T13:32:00.000Z'),
      );
      assert(guard?.type === 'blocked_date', 'Pix and pickup flow is blocked before OpenAI');
      assertIncludes(guard?.reply ?? '', 'não estamos aceitando encomendas', 'blocked reply is used for order progression');
    },
  },
  {
    name: 'simulator dry-run blocks short continuation after pickup context when today is blocked',
    run: () => {
      const empresaId = `sim-context-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateScheduleGuardForDryRun(
        empresaId,
        [
          { role: 'user', content: 'Luis miguel' },
          { role: 'user', content: 'Retirada as 10:50Hs' },
          { role: 'assistant', content: 'Só pra confirmar, você quer 2 coxinhas de carne, retirada às 10h50, no nome do Luis Miguel. Gostaria de alterar algo?' },
          { role: 'user', content: 'Só isso' },
        ],
        atUtc('2026-06-04T13:41:00.000Z'),
      );
      assert(guard?.type === 'blocked_date', 'short continuation after pickup context is blocked');
      assertIncludes(guard?.reply ?? '', '04/06', 'blocked date is preserved in continuation reply');
    },
  },
  {
    name: 'simulator dry-run allows future order when only today is blocked',
    run: () => {
      const empresaId = `sim-future-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateScheduleGuardForDryRun(
        empresaId,
        [{ role: 'user', content: 'Quero encomendar para amanhã às 10h' }],
        atUtc('2026-06-04T15:00:00.000Z'),
      );
      assert(guard === null, 'future free date is not blocked by today holiday');
    },
  },
  {
    name: 'simulator create-order dry-run blocks pickupDate in blocked_dates',
    run: () => {
      const empresaId = `sim-tool-${Date.now()}`;
      setupConfig(empresaId);
      const guard = evaluateCreateOrderScheduleGuard(
        empresaId,
        '2026-06-04',
        '10:00',
        atUtc('2026-06-04T15:00:00.000Z'),
      );
      assert(guard?.type === 'blocked_date', 'criar_pedido tool args are checked against blocked_dates');
      assertIncludes(guard?.reply ?? '', '04/06', 'reply identifies the blocked date');
    },
  },
  {
    name: 'prompt marks today blocked date as critical context',
    run: () => {
      const empresaId = `prompt-today-blocked-${Date.now()}`;
      setupConfig(empresaId);
      const prompt = withMockedNow('2026-06-04T15:00:00.000Z', () => buildSystemInstruction(
        empresaId,
        '',
        '',
        [],
        '',
      ));
      assertIncludes(prompt, 'AVISO CRÍTICO — HOJE A LOJA NÃO ACEITA PEDIDOS', 'prompt has critical blocked-today warning');
      assertIncludes(prompt, 'porque é feriado', 'prompt includes blocked-date reason');
      assertIncludes(prompt, 'NUNCA chame criar_pedido com pickupDate=hoje', 'prompt blocks same-day tool call');
    },
  },
]);
