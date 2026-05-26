# Codex prompt — Feature #2: Encaminhar pra outro número (redirect_contact trigger)

> Cole o conteúdo abaixo diretamente no Codex CLI:
> `codex < CODEX_FEATURE2_REDIRECT_CONTACT.md`
> ou passe como argumento:
> `codex "$(cat CODEX_FEATURE2_REDIRECT_CONTACT.md)"`

---

## Contexto do projeto

ZeloChat é uma plataforma de atendimento WhatsApp-native para lanchonetes brasileiras. Stack:
- **Frontend**: React 19 + Vite + TypeScript + Tailwind
- **Backend**: Express + TypeScript (`tsx`) + Whatsmiau (Evolution v2 wrapper para WhatsApp)
- **DB**: Supabase (PostgreSQL) — multi-tenant por `empresa_id`
- **IA**: OpenAI `gpt-4o-mini` via `server/ai.ts`
- **Auth**: JWT Supabase → `requireEmpresaId(req)` nos endpoints

Working dir: `/home/user/zelochat`
Branch de desenvolvimento: `claude/agreste-salgados-order-routing-rLoCQ`

---

## O que implementar

**Feature #2 — Encaminhar para outro número (redirect_contact)**

O dono cadastra um **número secundário + condição em português simples**
(ex: "quando o cliente mencionar Lagoa ou querer o trailer"). Quando a condição
ocorre em uma conversa, a IA envia automaticamente ao cliente uma mensagem com
o link `wa.me` para aquele número secundário.

**Caso real de origem:** Agreste Salgados usa um único WhatsApp para a loja + o
trailer de outra cidade. Os pedidos se misturam. Feature #1 (já entregue)
auto-classifica a conversa com uma tag. Feature #2 dá o passo extra: a IA redireciona
o cliente para o número certo.

**Escopo v1:**
- Novo tipo de gatilho: `redirect_contact`
- A IA dispara via a tool existente `dispatch_trigger` (sem nova tool)
- O handler envia ao cliente a mensagem com o link wa.me e **encerra o turno**
- Sessão NÃO fica escalada (auto_reply continua ativo — próximas mensagens são atendidas)
- Nenhum evento de escalação é criado
- UI amigável em `AIConfigsView` com campo de telefone dedicado

---

## Arquivos a modificar (em ordem de execução segura)

### 1. Migration de banco — `supabase/migrations/038_zelochat_trigger_redirect_contact.sql`

A tabela `zelochat_triggers` tem constraint `kind in ('notify_manager', 'escalate_human')`.
Precisamos ampliar o CHECK e adicionar duas colunas:

```sql
-- Ampliar constraint kind para aceitar o novo tipo
ALTER TABLE public.zelochat_triggers
  DROP CONSTRAINT IF EXISTS zelochat_triggers_kind_check;

ALTER TABLE public.zelochat_triggers
  ADD CONSTRAINT zelochat_triggers_kind_check
  CHECK (kind IN ('notify_manager', 'escalate_human', 'redirect_contact'));

-- Colunas usadas apenas por redirect_contact (null nos outros tipos)
ALTER TABLE public.zelochat_triggers
  ADD COLUMN IF NOT EXISTS redirect_phone TEXT,
  ADD COLUMN IF NOT EXISTS redirect_message TEXT;

-- Constraint: redirect_contact EXIGE redirect_phone
ALTER TABLE public.zelochat_triggers
  ADD CONSTRAINT zelochat_triggers_redirect_phone_required
  CHECK (kind != 'redirect_contact' OR redirect_phone IS NOT NULL);
```

**Aplicar no Supabase via MCP (`apply_migration`) ANTES de fazer merge do código**,
pois o backend passa a ler `redirect_phone` no hot path.

---

### 2. `server/triggers.ts` — tipo e CRUD

Arquivo: `/home/user/zelochat/server/triggers.ts`

**a) Expandir `TriggerKind`** (linha 6):
```ts
export type TriggerKind = 'notify_manager' | 'escalate_human' | 'redirect_contact';
```

**b) Adicionar campos em `TriggerRecord`** (após `active`, linha ~31):
```ts
redirectPhone: string | null;   // só em redirect_contact
redirectMessage: string | null; // template com {link} (opcional — tem default)
```

**c) Adicionar campos em `TriggerRow`** (após `active`, linha ~41):
```ts
redirect_phone: string | null;
redirect_message: string | null;
```

**d) `SELECT_COLS`** (linha ~58) — adicionar `redirect_phone, redirect_message`:
```ts
const SELECT_COLS = 'id, empresa_id, kind, name, condition_description, natural_input, active, redirect_phone, redirect_message, created_at';
```

**e) `mapTrigger`** — mapear os novos campos:
```ts
redirectPhone: row.redirect_phone ?? null,
redirectMessage: row.redirect_message ?? null,
```

**f) `assertValidKind`** — atualizar mensagem de erro (o tipo já passa a compilar via union).

**g) `parseTriggerProse`** — para `redirect_contact`, o natural input contém o número.
A função já extrai kind/name/condition via AI; adicionar extração de telefone:
```ts
// No objeto de resposta AI, pedir também redirect_phone se kind = redirect_contact
// Adicionar ao system prompt do parser:
// "Se kind = 'redirect_contact', inclua redirect_phone com o número detectado
//  no formato internacional sem '+' (ex: '5584999991234'). Se não houver
//  número no texto, redirect_phone = null."
```
Retornar `{ kind, name, condition_description, redirect_phone?: string | null }`.

**h) `createTrigger`** — aceitar `redirectPhone` e `redirectMessage` como parâmetros
opcionais; persistir no INSERT:
```ts
export async function createTrigger(
  empresaId: string,
  prose: string,
  kindOverride?: TriggerKind,
  redirectPhone?: string | null,
  redirectMessage?: string | null,
): Promise<TriggerRecord>
```
No INSERT, incluir `redirect_phone` e `redirect_message`.
Se `kind === 'redirect_contact'` e `redirectPhone` vazio → `throw new Error('REDIRECT_PHONE_REQUIRED')`.

**i) `updateTrigger`** — aceitar `redirectPhone` e `redirectMessage` no patch:
```ts
patch: {
  name?: string;
  conditionDescription?: string;
  active?: boolean;
  kind?: TriggerKind;
  redirectPhone?: string | null;
  redirectMessage?: string | null;
}
```

---

### 3. `server/router.ts` — endpoints de triggers

Arquivo: `/home/user/zelochat/server/router.ts`

**`POST /api/triggers`** (linha ~1734):
Ler `redirectPhone` e `redirectMessage` do `req.body` e repassar para `createTrigger`:
```ts
const { naturalInput, kind, redirectPhone, redirectMessage } = req.body as {
  naturalInput?: string;
  kind?: string;
  redirectPhone?: string | null;
  redirectMessage?: string | null;
};
const trigger = await createTrigger(empresaId, naturalInput, kind as TriggerKind | undefined, redirectPhone, redirectMessage);
```

**`PATCH /api/triggers/:id`** (linha ~1753):
O handler atual já passa `req.body` para `updateTrigger` — garantir que o tipo de patch
aceita `redirectPhone` e `redirectMessage`.

**Tratar erro `REDIRECT_PHONE_REQUIRED`** com resposta 400.

---

### 4. `server/ai.ts` — dispatch handler + planToolCallsForTurn

Arquivo: `/home/user/zelochat/server/ai.ts` (~4012 linhas)

⚠️ **Este arquivo é CRÍTICO.** Leia o CLAUDE.md §"Critical functions" antes de editar.
Edições devem ser **aditivas** — não remover nem alterar lógica existente de
`criar_pedido`, `escalate_human`, ou a ordem do `planToolCallsForTurn`.

#### 4a) Bloco de prompt — `buildSystemInstruction` (linha ~1966)

No bloco de GATILHOS ATIVOS (linha ~2107/2201), já existe texto explicando
`notify_manager` vs `escalate_human`. Adicionar linha de instrução para `redirect_contact`:

```
- Se for redirect_contact, envie a mensagem de encaminhamento com o link e encerre.
  Não continue com pedido ou atendimento normal após redirecionar.
```

#### 4b) `planToolCallsForTurn` (linha ~2348)

Localizar a função `planToolCallsForTurn`. Ela classifica chamadas de tools em:
- `safePrefixCalls`: não-terminais que podem rodar antes de um terminal (`aplicar_tag`, etc.)
- `supportedNonTerminal`: não-terminais standalone (`consultar_pedido`, `notify_manager`, `aplicar_tag`)
- terminais: `criar_pedido`, `escalate_human`

Para `redirect_contact`:
- É **terminal** para o turno (encerra a conversa do turno, como `escalate_human`)
- Mas tem precedência MENOR que `escalate_human` e NÃO flipa a sessão
- Adicionar ao grupo de "terminal que vence" **depois** do check de `escalate_human`:

No `isHumanHandoffWinning` (função interna, linha ~2402) que verifica se
`escalate_human` ganha sobre qualquer outra coisa:
```ts
// redirect_contact é terminal mas perde pra escalate_human
// Adicionar helper:
function isRedirectContactCall(toolCall: AiToolCall, triggers: TriggerRecord[]): boolean {
  const { trig } = resolveTriggerFromToolCall(toolCall, triggers);
  return toolCall.function.name === 'dispatch_trigger' && trig?.kind === 'redirect_contact';
}
```

No corpo do `planToolCallsForTurn`, após o check de `escalate_human` ganhar,
adicionar: se existe `redirect_contact` e NÃO existe `escalate_human`, o plano
vira `single_terminal` com apenas o `redirect_contact` (análogo ao que já acontece
com `escalate_human`):
```ts
// redirect_contact é terminal (encerra o turno, mas sem flipar sessão)
const redirectCall = toolCalls.find((tc) => isRedirectContactCall(tc, triggers));
if (redirectCall && !humanHandoffWins) {
  return {
    calls: [redirectCall],
    mode: 'single_terminal',
    reason: 'redirect_contact is turn-terminal',
  };
}
```

#### 4c) Handler de dispatch — `generateAndSendReply` (linha ~3230+)

No bloco `if (toolCall.function.name === 'dispatch_trigger')` (linha ~3230):

Após os branches existentes de `escalate_human` e `notify_manager`, adicionar:

```ts
if (trig?.kind === 'redirect_contact') {
  // Normalizar o telefone para JID internacional
  const rawPhone = trig.redirectPhone ?? '';
  const e164 = rawPhone.replace(/\D/g, '');
  if (!e164) {
    // Configuração incompleta — logar e seguir sem enviar
    console.warn(`[AI] redirect_contact trigger ${trig.id} sem redirectPhone configurado.`);
    await addToolMessage(jid, 'Encaminhamento configurado sem número — ignorado.', toolCall.id, resolvedEmpresaId);
    continue; // segue o loop de toolCalls (não termina o turno na prática)
  }
  const waLink = `https://wa.me/${e164}`;
  const template = trig.redirectMessage?.trim() || 'Para este tipo de pedido, entre em contato pelo nosso outro número: {link} 😊';
  const redirectMsg = template.replace('{link}', waLink);

  // Enviar ao cliente
  try {
    const waId = await sendTextMessage(jid, redirectMsg, resolvedEmpresaId);
    await addAssistantMessage(jid, redirectMsg, resolvedEmpresaId, waId ?? undefined);
  } catch (err) {
    console.error('[AI] redirect_contact sendTextMessage failed:', err);
  }

  // Persistir tool message para auditoria
  await addToolMessage(jid, `Encaminhado para ${e164}`, toolCall.id, resolvedEmpresaId);

  // NÃO flipar sessão (auto_reply continua ativo — próximas msgs são atendidas)
  // NÃO criar escalation event
  // NÃO chamar handoffMessageFor
  // Encerrar o turno (a mensagem já foi enviada)
  return redirectMsg;
}
```

**Para o caminho `sequential_then_terminal` (linha ~3351):**
Adicionar branch idêntico quando `prefixCall.function.name === 'dispatch_trigger'`
e `trig.kind === 'redirect_contact'`, ANTES do branch de terminal do `criar_pedido`.

**Importante:** `redirect_contact` que aparece como terminal NÃO chama
`generateAndSendReply` recursivamente — o handler já enviou a mensagem e retorna
o texto diretamente (igual ao que `escalate_human` faz com `handoffMessageFor`).

---

### 5. `src/types.ts` — interface `Trigger`

Arquivo: `/home/user/zelochat/src/types.ts`

Adicionar campos em `Trigger` (linha ~191):
```ts
export interface Trigger {
  id: string;
  empresaId: string;
  kind: TriggerKind;
  name: string;
  conditionDescription: string;
  naturalInput: string;
  active: boolean;
  createdAt: string;
  redirectPhone?: string | null;   // NEW — só em redirect_contact
  redirectMessage?: string | null; // NEW — template com {link}
}
```

Atualizar `TriggerKind`:
```ts
export type TriggerKind = 'notify_manager' | 'escalate_human' | 'redirect_contact';
```

---

### 6. `src/services/waApi.ts` — createTrigger / updateTrigger

Arquivo: `/home/user/zelochat/src/services/waApi.ts`

Nas funções que fazem POST/PATCH para `/api/triggers`, incluir
`redirectPhone` e `redirectMessage` no corpo quando fornecidos:

```ts
export async function createTrigger(
  token: string,
  naturalInput: string,
  kind?: TriggerKind,
  redirectPhone?: string | null,
  redirectMessage?: string | null,
): Promise<Trigger>
```

---

### 7. `src/components/views/AIConfigsView.tsx` — UI de triggers

Arquivo: `/home/user/zelochat/src/components/views/AIConfigsView.tsx`

**No formulário de criação/edição de gatilho:**

1. **Seletor de tipo** (já existe para `notify_manager`/`escalate_human`):
   Adicionar terceira opção "Encaminhar para outro número" com descrição:
   > "A IA avisa o cliente para entrar em contato pelo número que você informar."

2. **Campo condicional** — quando `kind === 'redirect_contact'`:
   ```
   Número para encaminhar *
   [campo de telefone — placeholder: "(84) 99999-9999 ou 5584999991234"]
   Formato: DDD + número. O link será gerado automaticamente.

   Mensagem de encaminhamento (opcional)
   [textarea — placeholder: "Para isto, fale conosco aqui: {link} 😊"]
   Dica: use {link} onde quer que o link do WhatsApp apareça. Padrão: "Para este tipo de pedido, entre em contato pelo nosso outro número: {link}"
   ```

3. **Modelo sugerido** (chip no painel de gatilhos):
   ```
   [📲 Encaminhar para outra linha]
   ```
   Clicando, pré-preenche o formulário com:
   - kind: `redirect_contact`
   - name: "Outra linha / delivery"
   - naturalInput: "Quando o cliente pedir para um número diferente, outra unidade ou pedir delivery"
   - redirectMessage: "Para pedidos de delivery, entre em contato pelo nosso número de entregas: {link} 🛵"
   
   (Dono ajusta o número antes de salvar — nada é ativado sem ele preencher.)

4. **Badge visual** na lista de gatilhos: ícone 📲 para `redirect_contact`.
   Mostrar os primeiros dígitos do número configurado (ex: "(84) 9999...").

---

## Padrões de código a seguir

| O que | Onde seguir |
|---|---|
| Novo campo nullable em triggers | Padrão `autoApplyCondition` em `server/tags.ts` (feature #1, migration 037) |
| Handler dispatch_trigger terminal | Bloco `escalate_human` em `server/ai.ts` ~linha 3230 |
| Tool não-terminal prefix | `aplicar_tag` em `planToolCallsForTurn` |
| Envio de texto para o cliente | `sendTextMessage(jid, text, empresaId)` em `server/whatsapp.ts:406` |
| Persistir mensagem de saída | `addAssistantMessage(jid, text, empresaId, waId)` em `server/messageHandler.ts` |
| Form de trigger existente | Seção de Gatilhos em `AIConfigsView.tsx` (~linha 800–980) |
| Parsing prosa→estruturado | `parseTriggerProse` em `server/triggers.ts:66` |

---

## Guardrails de segurança (NÃO negociável)

1. **`planToolCallsForTurn` — só adições.** Não alterar o check de `escalate_human`
   como winner. `redirect_contact` perde para `escalate_human` sempre. Se ambos
   aparecerem no mesmo turno, `escalate_human` ganha.

2. **`redirect_contact` NUNCA chama `createOrderInDb`**, `clearPendingOrder` ou
   `confirmPendingOrder`. O handler é puro: envia texto + retorna.

3. **Sessão NÃO flipa** `auto_reply = false` nem `status = 'escalated'`.
   O operador continua vendo a conversa ativa normalmente.

4. **Sem escalation event** — não chamar `escalateSession()`. O banco
   `zelochat_escalation_events` não deve ter nenhum row criado por `redirect_contact`.

5. **`zelochat_messages.role` CHECK** — a constraint já permite `'tool'` e `'assistant'`;
   `addToolMessage` e `addAssistantMessage` são seguros.

6. **Testes de regressão críticos após implementar:**
   - Mensagem de cliente que aciona `redirect_contact` **não** deve criar pedido.
   - Mensagem que aciona `redirect_contact` **e** `escalate_human` no mesmo turno:
     somente `escalate_human` executa.
   - Mensagem que aciona `redirect_contact` **e** `criar_pedido` no mesmo turno:
     somente `redirect_contact` executa (é terminal).
   - Mensagem seguinte após o redirect: IA responde normalmente (auto_reply ainda ativo).

7. **Lint antes do commit:** `npm run lint` (`tsc --noEmit`). Nenhum erro de tipo.

---

## Verificação ponta-a-ponta

1. `WHATSMIAU_DISABLE_WEBHOOK_REGISTER=1` no `.env` local antes de subir o backend.
2. Criar gatilho "Trailer / Lagoa" do tipo `redirect_contact` com número `(84) 99999-9999`.
3. Confirmar POST persiste `redirect_phone` e `redirect_message` no banco.
4. Simular mensagem "quero pedido pro trailer, sou de Lagoa" → confirmar nos logs:
   - `dispatch_trigger` chamada → `redirect_contact` handler → `sendTextMessage` com link wa.me
   - Nenhum `escalateSession` chamado
   - `auto_reply` continua `true`
5. Enviar nova mensagem → IA responde normalmente (turno seguinte não está bloqueado).
6. Criar gatilho `escalate_human` + `redirect_contact` na mesma empresa → mesma mensagem
   dispara ambos → confirmar que apenas `escalate_human` executa.

---

## O que NÃO fazer (fora de escopo v1)

- Não encaminhar a conversa inteira para outro operador interno (isso é `escalate_human`).
- Não registrar o segundo número como nova instância Whatsmiau (isso é Feature #3 — multi-número, decisão de produto + precificação separada).
- Não modificar o Kanban de pedidos.
- Não adicionar changelog (`src/data/changelog.ts`) — só quando for pra produção.
- Não abrir PR sem merge da migration primeiro.
