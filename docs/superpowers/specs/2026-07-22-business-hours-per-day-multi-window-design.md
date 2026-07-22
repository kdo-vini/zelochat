# Horário de funcionamento — por dia, múltiplas janelas

**Data:** 2026-07-22
**Repos:** ZeloChat (painel + IA + fonte de dados) e ZeloMenu (bloqueio de pedido fora de horário — repo separado)
**Restrição dura:** o ZeloMenu **já bloqueia pedido fora de horário e funciona**. Nada pode quebrar isso.

## Problema

Hoje o horário é uma janela única igual todo dia (`horario_abertura`/`horario_fechamento`)
+ dias fechados (`dias_fechamento`). Não cobre almoço→fecha→jantar, nem horário
diferente por dia. Decisões aprovadas: modelo **por dia, com múltiplas janelas**;
papel da IA **informativo** (avisa que está fechada, não bloqueia duro — pedido é no ZeloMenu).

## Fonte de dados (nova coluna, ZeloChat-owned — ADD permitido em `empresa_perfil`)

Migração `046_empresa_horario_semanal.sql` — coluna **nullable** `horario_semanal JSONB`.
Shape (chaves = mesmas 3 letras do `ai_schedule_days`):

```json
{ "sun": [], "mon": [{"start":"11:00","end":"14:00"},{"start":"18:00","end":"23:00"}],
  "tue": [...], "wed": [...], "thu": [...], "fri": [...], "sat": [{"start":"18:00","end":"00:00"}] }
```

- Array vazio `[]` = **fechado** naquele dia.
- Janela `{start,end}` HH:MM. `end` = `"00:00"` significa **24:00 (meia-noite/fim do dia)**.
- Regra: `start < end` (com `00:00`→1440). **Sem wrap entre dias** — pra virar a
  madrugada, use duas janelas (ex.: `[{18:00,00:00}]` no sáb + `[{00:00,02:00}]` no dom).
- `horario_semanal = NULL` → deriva do legado (contas antigas seguem idênticas, igual
  padrão da migração 040 / `ai_schedule_days`).

## Contrato de compatibilidade (o que impede a quebra do ZeloMenu)

O ZeloMenu (`zelomenu/server/configStore.ts` + `zelomenuCartSessions.ts`) lê **as colunas
legadas** `horario_abertura`/`horario_fechamento`/`dias_fechamento` e valida:
- ASAP → `openNow` (aberto agora?)
- Agendado → `isBusinessWindowOpen(pickup, open, close)` + `closedDays.includes(businessDayLabel(date))`

`dias_fechamento` usa labels PT: `sun→'Dom' mon→'Seg' tue→'Ter' wed→'Qua' thu→'Qui' fri→'Sex' sat→'Sáb'`.

**Invariante:** toda vez que o painel salvar `horario_semanal`, o ZeloChat TAMBÉM reescreve
as colunas legadas (shadow), pra o ZeloMenu não quebrar mesmo antes de ser atualizado:
- `horario_abertura` = menor `start` entre todos os dias abertos
- `horario_fechamento` = maior `end` entre todos os dias abertos
- `dias_fechamento` = labels PT dos dias com `[]`
Para lojas de janela única (caso comum hoje), o shadow é **fiel** → ZeloMenu idêntico a hoje.
Para multi-janela, o shadow é lossy (abrange o vão almoço-jantar) até o ZeloMenu ler `horario_semanal`.

## Domínio (`src/domain/businessHours.ts` — zero deps de React/IA; espelhar no ZeloMenu)

```ts
export type DayKey = 'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat';
export interface HoursWindow { start: string; end: string; }   // HH:MM, end "00:00"=24:00
export type WeeklyHours = Record<DayKey, HoursWindow[]>;         // [] = fechado
export const DAY_KEYS: DayKey[];
export const CLOSED_DAY_LABELS: Record<DayKey,string>;          // sun→'Dom' ... sat→'Sáb'
export function normalizeWeeklyHours(raw: unknown): WeeklyHours | null;
export function deriveWeeklyFromLegacy(open: string|null, close: string|null, closedDays: string[]|null): WeeklyHours;
export function deriveLegacyFromWeekly(w: WeeklyHours): { openTime: string|null; closeTime: string|null; closedDays: string[] };
export function weekdayKeyInTz(date: Date, tz: string): DayKey;  // via Intl (padrão aiSchedule)
export function isOpenAt(w: WeeklyHours, date: Date, tz: string): { open: boolean; currentWindow: HoursWindow|null; nextOpen: { day: DayKey; start: string }|null };
export function isMinuteWithinDay(w: WeeklyHours, day: DayKey, minutes: number): boolean;  // validação de agendamento
export function summarizeWeekly(w: WeeklyHours): string;         // exibição
```

Testes: `tests/businessHours.test.ts` — vazio=fechado, multi-janela, `end=00:00`, isOpenAt
dentro/fora/no vão, deriveLegacy fiel p/ janela única, labels PT corretos, fuso.

## ZeloChat — servidor (informativo)

- `configStore.ts`: carregar `horario_semanal`; expor `weeklyHours` no config; quando null, `deriveWeeklyFromLegacy`.
- `server/ai.ts`: `getOperatingWindow`/`isWithinOperatingWindow` → passam a usar `isOpenAt(weekly, now, tz)`.
  Prompt recebe "aberto agora? / próxima abertura" e instrui a IA a **informar** (sem bloqueio duro),
  podendo mandar o link do cardápio pra agendar. Manter fallback legado.

## ZeloChat — UI (`SettingsView` "Horários e atendimento")

- Substituir Abre/Fecha único + botões de dia por editor de 7 linhas (Seg–Dom):
  toggle Aberto/Fechado + lista de faixas (início–fim) add/remove; atalhos "aplicar a todos"
  e "aplicar a seg–sex". Sem wizard de polaridade.
- Salvar grava `horario_semanal` **e** as colunas legadas (invariante acima).
- `useEmpresaPerfil.ts`: adicionar `horario_semanal` ao select/save (com fallback tolerante a coluna ausente, igual aos outros campos).

## ZeloMenu (repo separado) — influência real, sem quebrar

- Portar `businessHours.ts` (funções puras) pro domínio do ZeloMenu.
- `configStore.ts`: ler `horario_semanal`; se presente, usar como fonte; senão, comportamento legado atual.
- `zelomenuCartSessions.ts`: `buildPublicBusinessHoursStatus` (ASAP) e a validação de agendado
  passam a checar **as janelas do dia** (multi-janela) via `isOpenAt`/`isMinuteWithinDay`, com
  fallback legado quando `horario_semanal` é null. Comportamento atual preservado quando null.

## Validação

- ZeloChat: `npm run lint` + `tests/businessHours.test.ts` verdes; walkthrough de loja single-window (deve bater com hoje) e loja almoço+jantar.
- ZeloMenu: suíte de horário verde; loja single-window bloqueia igual a hoje; multi-janela bloqueia no vão.
- Migração só ADD nullable — contas com `horario_semanal=NULL` idênticas ao legado.
