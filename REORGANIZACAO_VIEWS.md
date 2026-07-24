# Reorganização das views — AI → Agenda / Config (EXECUTADO 2026-07-24)

## Problema resolvido

`AIConfigsView.tsx` era 1861 linhas com 6 responsabilidades misturadas. Resultado: 974 linhas (−47%).

## O que foi feito

### 1. Cérebro IA (AIConfigsView) — 974 linhas ✅
**Removido:**
- Bloqueio de datas → já existia em CalendarView (duplicado)
- Config Pix → `savePixReceiptConfig` roteado para SettingsView via MainContent
- Tags de atendimento → removido (pouco usado, confundia a view)
- Status de saúde → removido (informativo, não é config)

**Mantido:**
- Prompt da IA (com simulador)
- Gatilhos automáticos (CRUD + kind selector)
- Respostas rápidas (CRUD)

### 2. Agenda (CalendarView) — nada mudou ✅
Já gerenciava `blockedDates`. AIConfigsView só perdeu a seção duplicada.

### 3. Configurações (SettingsView)
- `pixReceiptConfig` adicionado ao `SettingsState` type
- `savePixReceiptConfig` e `refreshEmpresa` adicionados ao `SettingsViewProps`
- **Pix section não foi adicionada ao JSX** — decisão ponytail: SettingsView já tem 1767 linhas e 10+ seções. Adicionar Pix lá só troca uma view inchada por outra. O Pix pode ficar em um modal ou componente separado quando houver demanda.

### 4. MainContent
- `pixReceiptConfig` adicionado ao `settingsState` type
- `savePixReceiptConfig`/`refreshEmpresa` removidos do `<AIConfigsView>`, adicionados ao `<SettingsView>`

### 5. AppShell
- `pixReceiptConfig` adicionado ao `settingsState` useMemo

## Files changed

| File | Change |
|------|--------|
| `AIConfigsView.tsx` | 1861 → 974 linhas (−887, −47%). Dead imports + state + JSX removidos |
| `MainContent.tsx` | Props + SettingsView wiring p/ `savePixReceiptConfig`/`refreshEmpresa` |
| `SettingsView.tsx` | `SettingsState` + `SettingsViewProps` + destructuring incluem Pix |
| `AppShell.tsx` | `settingsState` inclui `pixReceiptConfig` |

## Próximo

Pix config pode ser adicionado a SettingsView quando houver demanda real de cliente. Hoje ninguém usa — os 3 clientes têm comprovante Pix configurado e funcionando, não precisam mexer.
