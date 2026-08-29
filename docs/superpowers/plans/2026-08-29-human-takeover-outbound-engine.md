# Human Takeover and Outbound Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** garantir que toda atuação humana conversacional assuma a conversa antes do envio e que nenhuma resposta de IA possa ultrapassar essa tomada, inclusive com múltiplas réplicas.

**Architecture:** um módulo profundo de controle de conversa mantém modo e epoch duráveis; todo outbound passa por um dispatcher/fila persistente serializado por identidade canônica da conversa; jobs de IA exigem um permit vigente no enqueue e no claim. O webhook `fromMe` usa correlação/replay duráveis e executa persistência + takeover atomicamente quando o envio veio do WhatsApp nativo.

**Tech Stack:** PostgreSQL/Supabase RPC e RLS, Express/TypeScript, worker durável, React 19, WebSocket, harness `tsx`, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-human-takeover-outbound-engine-design.md`

## Global Constraints

- Todo texto consumido pelo operador é português brasileiro e não menciona fornecedores, endpoints, webhooks, upstream, timeout ou erro bruto.
- `auto_reply` permanece uma projeção compatível; somente o módulo `conversationControl` pode mudar modo/epoch.
- Takeover comum não muda `status`, `escalated_at` ou SLA; escalonamento continua um conceito separado.
- Nenhuma rota ou fluxo customer-facing pode chamar o transporte diretamente depois da Task 9.
- `cancelPendingReply` continua local e best-effort; correção vem de epoch, fila e claim no banco.
- Migrações são forward-only, tenant-safe, server-only e aplicadas antes do backend que depende delas.
- A migration `015` não é evidência de deploy; os gates verificam o índice real `(empresa_id, wa_message_id)`.
- Não usar `/api/healthz` para validar WhatsApp, fila, banco ou worker.
- Não mutar `sessions` diretamente no React; usar `useWhatsAppSessions`.
- Cada task começa com teste vermelho, termina com testes verdes e um commit pequeno.
- Ao entregar fix P1, atualizar `FIXES_PROGRESS.md`, `CURRENT.md`, `INCIDENTS.md` e comentários críticos exigidos pelo `AGENTS.md`.

## Mapa de arquivos

### Criar

- `src/domain/outbound.ts` — tipos discriminados e política pura por origem.
- `server/conversationControl.ts` — interface de modo/epoch/família.
- `server/conversationOutbound.ts` — interface única para enqueue e espera terminal.
- `server/outbound/providerAdapter.ts` — único adapter que chama funções de `server/whatsapp.ts`.
- `server/outbound/mediaStore.ts` — assets imutáveis de mídia ligados ao job, sem Data URL no banco.
- `server/fromMe.ts` — extração e classificação pura.
- `server/fromMeProcessor.ts` — orquestra persistência, takeover e reparo de eco.
- `server/webhookReplayWorker.ts` — claim/backoff/dead-letter de raw events pendentes.
- `supabase/migrations/063_conversation_outbound_foundation.sql` — tabelas/colunas/índices.
- `supabase/migrations/064_conversation_control_rpcs.sql` — RPCs de epoch/takeover/resume/enqueue.
- `supabase/migrations/065_conversation_outbound_claims.sql` — claim/lease/finalização serializados.
- `supabase/migrations/066_native_from_me_takeover.sql` — RPC idempotente de envio nativo.
- `supabase/migrations/067_conversation_outbound_rolling_cleanup.sql` — remove compatibilidade somente após todas as réplicas novas.
- `supabase/verification/conversation_outbound_engine.sql` — probe transacional de invariantes.
- testes focados listados nas tasks.

### Modificar

- `server/messageHandler.ts` — origem/lifecycle, família e persistência nativa.
- `server/replyDebouncer.ts` — carregar permit no debounce.
- `server/index.ts` — criar permit após inbound deduplicado.
- `server/ai.ts` — enfileirar todos os outbounds da IA.
- `server/router.ts` — rotas humanas, toggle, webhook e rotas especiais.
- `server/customers/router.ts` — CRM pelo dispatcher.
- `server/escalation.ts` — takeover comum + handoff autorizado.
- `server/outbound/queue.ts` e `server/outbound/worker.ts` — job discriminado e claim cross-replica.
- `server/whatsapp.ts` — transporte fica atrás do adapter e mantém tracking legado durante rollout.
- `server/zelomenuCartSessions.ts`, `server/whatsappOutreach.ts` — origens transacionais.
- `src/types.ts`, `src/hooks/useWhatsAppSessions.ts`, `src/services/waApi.ts`, `src/services/customerApi.ts` — contrato de modo/lifecycle.
- `src/components/views/ChatView.tsx`, `src/components/views/MessageBubble.tsx`, `src/components/customers/CustomerMessagesTab.tsx` — UX Manual e entrega incerta.

---

### Task 1: Fixar o contrato de origem, payload e política

**Files:**

- Create: `src/domain/outbound.ts`
- Create: `tests/outboundContract.test.ts`
- Modify: `src/types.ts:24`

**Interfaces:**

- Consumes: nenhum módulo novo.
- Produces: `OutboundOrigin`, `TakeoverPolicy`, `OutboundPayload`, `policyForOrigin` e estados usados por todas as tasks seguintes.

- [ ] **Step 1: Write the failing contract test**

```ts
import assert from 'node:assert/strict';
import { policyForOrigin, type OutboundOrigin } from '../src/domain/outbound.js';

const takeover: OutboundOrigin[] = ['human_zelochat', 'human_native_whatsapp'];
for (const origin of takeover) assert.equal(policyForOrigin(origin), 'take_over');

const preserve: OutboundOrigin[] = [
  'ai_auto', 'ai_followup', 'system_handoff', 'system_transactional',
  'campaign', 'automation', 'internal_system',
];
for (const origin of preserve) assert.equal(policyForOrigin(origin), 'preserve_ai');
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx tests/outboundContract.test.ts`  
Expected: FAIL with module `src/domain/outbound.ts` missing.

- [ ] **Step 3: Implement the discriminated contract**

```ts
import type { ChatAttachment } from '../types.js';

export type OutboundOrigin =
  | 'human_zelochat' | 'human_native_whatsapp'
  | 'ai_auto' | 'ai_followup' | 'system_handoff'
  | 'system_transactional' | 'campaign' | 'automation' | 'internal_system';

export type TakeoverPolicy = 'take_over' | 'preserve_ai';
export type OutboundState =
  | 'preparing' | 'queued' | 'sending' | 'dispatch_started' | 'sent' | 'failed_before_dispatch'
  | 'delivery_uncertain' | 'cancelled';

export interface QuotedContext {
  waMessageId: string;
  fromMe: boolean;
  remoteJid: string;
  previewText?: string;
}

export type OutboundPayload =
  | { kind: 'text'; text: string; quoted?: QuotedContext | null }
  | { kind: 'media'; attachment: ChatAttachment; caption?: string; quoted?: QuotedContext | null }
  | { kind: 'audio'; attachment: ChatAttachment; ptt: boolean; quoted?: QuotedContext | null }
  | { kind: 'sticker'; attachment: ChatAttachment }
  | { kind: 'buttons'; text: string; buttons: Array<{ id: string; label: string }> }
  | { kind: 'contact'; displayName: string; vcard: string }
  | { kind: 'list'; body: string; buttonText: string; sections: unknown[] }
  | { kind: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { kind: 'reaction'; targetMessageId: string; emoji: string; targetFromMe: boolean }
  | { kind: 'poll'; name: string; options: string[]; selectableCount: number };

export type PersistedOutboundPayload =
  | Exclude<OutboundPayload, { kind: 'media' | 'audio' | 'sticker' }>
  | { kind: 'media' | 'audio' | 'sticker'; storagePath: string; mimeType: string; fileName: string; sizeBytes: number; checksum: string; ptt?: boolean; caption?: string };

export const policyForOrigin = (origin: OutboundOrigin): TakeoverPolicy =>
  origin === 'human_zelochat' || origin === 'human_native_whatsapp'
    ? 'take_over'
    : 'preserve_ai';
```

- [ ] **Step 4: Test valid/invalid payload bounds**

Add assertions for blank text, empty poll, invalid latitude/longitude, reaction without target and attachment without MIME. Export `validateOutboundPayload(payload): string | null` returning a stable internal error code.

- [ ] **Step 5: Run focused checks**

Run: `npx tsx tests/outboundContract.test.ts && npm run lint`  
Expected: PASS and zero TypeScript errors.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/outbound.ts src/types.ts tests/outboundContract.test.ts
git commit -m "feat(outbound): define durable origin and payload contract"
```

---

### Task 2: Criar a fundação persistente e os guardrails de schema

**Files:**

- Create: `supabase/migrations/063_conversation_outbound_foundation.sql`
- Create: `tests/conversationOutboundSchema.test.ts`
- Modify: `supabase/migrations/063_conversation_outbound_foundation.sql`

**Interfaces:**

- Consumes: enums da Task 1 como contrato de nomes.
- Produces: controle, auditoria, origem em mensagens e jobs conversacionais disponíveis para RPCs.

- [ ] **Step 1: Write a source-level migration test**

O teste deve ler a migration e exigir literalmente:

```ts
assert.match(sql, /create table public\.zelochat_conversation_ai_control/i);
assert.match(sql, /identity_key text not null/i);
assert.match(sql, /unique \(empresa_id, identity_key\)/i);
assert.match(sql, /mode text not null default 'ai'.*'ai','human'/is);
assert.match(sql, /epoch bigint not null default 0/i);
assert.match(sql, /create table public\.zelochat_conversation_control_events/i);
assert.match(sql, /add column if not exists outbound_origin text/i);
assert.match(sql, /add column if not exists conversation_control_id uuid/i);
assert.match(sql, /where status in \('sending','dispatch_started'\)/i);
assert.match(sql, /grant all on table .* to service_role/i);
assert.doesNotMatch(sql, /grant .* to (anon|authenticated)/i);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx tsx tests/conversationOutboundSchema.test.ts`  
Expected: FAIL because migration `063` does not exist.

- [ ] **Step 3: Implement migration `063`**

Criar:

```sql
create table public.zelochat_conversation_ai_control (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresa_perfil(id) on delete cascade,
  identity_key text not null,
  mode text not null default 'ai' check (mode in ('ai','human')),
  epoch bigint not null default 0 check (epoch >= 0),
  hold_reason text,
  hold_job_id uuid,
  latest_inbound_message_id uuid references public.zelochat_messages(id) on delete set null,
  latest_takeover_message_id uuid references public.zelochat_messages(id) on delete set null,
  changed_by_actor uuid references auth.users(id) on delete set null,
  changed_source text not null default 'bootstrap',
  changed_at timestamptz not null default now(),
  unique (empresa_id, identity_key)
);
```

Adicionar tabela de eventos com FK composta para controle, `event_type`, `epoch`, `actor_user_id`, `source`, `message_id`, `job_id` nullable e `created_at`.

Estender `zelochat_messages` com:

```sql
outbound_origin text,
outbound_actor_user_id uuid references auth.users(id) on delete set null,
outbound_job_id uuid,
```

Adicionar `conversation_control_id` a `zelochat_sessions`. Criar a função SQL `zelochat_conversation_identity_key(p_pessoa_id, p_customer_phone, p_remote_jid)` equivalente a `buildContactKey`, com fixtures compartilhadas de DDI e nono dígito. Backfill agrupa por identity key e usa “humano vence” quando `auto_reply` diverge; depois torna a FK obrigatória.

Estender `zelochat_outbound_jobs` com `job_type='conversation'`, `conversation_control_id`, `conversation_jid` de transporte, `message_id`, `outbound_origin`, `takeover_policy`, `payload jsonb`, `payload_fingerprint`, `control_epoch`, `transport_started_at`, `suppression_reason`; adicionar a unicidade tenant-scoped `(empresa_id, idempotency_key)` sem remover ainda a constraint global usada pelas réplicas antigas. Ampliar estados aceitos com `dispatch_started`, `failed_before_dispatch` e `delivery_uncertain`, mantendo `failed` somente para rolling deploy.

- [ ] **Step 4: Add defensive indexes and backfill**

```sql
create unique index zelochat_outbound_jobs_one_sending_conversation
  on public.zelochat_outbound_jobs (conversation_control_id)
  where status in ('sending','dispatch_started') and conversation_control_id is not null;

create unique index zelochat_outbound_jobs_message_unique
  on public.zelochat_outbound_jobs (message_id)
  where message_id is not null;
```

Backfill jobs existentes com origem `campaign` ou `automation`; não lhes atribuir controle nesta task. Criar um controle por família canônica; se qualquer sessão da família tiver `auto_reply=false`, o controle e todas as sessões ficam em modo humano.

- [ ] **Step 5: Add RLS/grants and rollback-safe comments**

Ativar RLS nas novas tabelas, revogar `public`, `anon`, `authenticated`, conceder apenas `service_role`. Não remover colunas ou constraints antigas utilizadas durante rolling deploy.

- [ ] **Step 6: Run focused checks**

Run: `npx tsx tests/conversationOutboundSchema.test.ts && npx tsx tests/customerRelationshipSchema.test.ts`  
Expected: PASS; o guardrail de numeração continua aceitando uma única `063`.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/063_conversation_outbound_foundation.sql tests/conversationOutboundSchema.test.ts
git commit -m "db: add conversation control and outbound ledger"
```

---

### Task 3: Implementar takeover, resume e epoch em uma única interface

**Files:**

- Create: `supabase/migrations/064_conversation_control_rpcs.sql`
- Create: `server/conversationControl.ts`
- Create: `tests/conversationControl.test.ts`
- Modify: `server/messageHandler.ts:1015`
- Modify: `server/messageHandler.ts:2610`
- Modify: `server/escalation.ts:195`

**Interfaces:**

- Consumes: tabelas da Task 2 e `fetchSessionFamily` encapsulado por adapter interno.
- Produces: `beginAiTurn`, `claimHumanTakeover`, `resumeAiConversation`, `isAiPermitCurrent`.

- [ ] **Step 1: Write fake-repository tests**

```ts
const result = await control.claimHumanTakeover({
  empresaId: 'e1', remoteJid: '551499@s.whatsapp.net',
  actorUserId: 'u1', source: 'zelochat_operator',
});
assert.equal(result.mode, 'human');
assert.equal(result.epoch, '8');
assert.equal(result.conversationControlId, 'control-1');
assert.deepEqual(repo.updatedFamilyJids, ['551499@s.whatsapp.net', '551498@s.whatsapp.net']);
assert.equal(repo.cancelledAiJobs, 2);
```

Cobrir também takeover repetido, resume incrementando epoch, inbound duplicado não incrementando, falha de RPC fail-closed, JID de outra conversa no mesmo tenant não alterado e criação simultânea de nova variação herdando o mesmo controle/modo humano.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/conversationControl.test.ts`  
Expected: FAIL with `server/conversationControl.ts` missing.

- [ ] **Step 3: Implement RPCs in migration `064`**

Criar funções service-role-only:

```sql
advance_zelochat_ai_epoch_for_inbound(
  p_empresa_id uuid, p_remote_jid text, p_message_id uuid
)

pause_zelochat_ai_for_human(
  p_empresa_id uuid, p_remote_jid text, p_actor_user_id uuid,
  p_source text, p_message_id uuid default null
)

resume_zelochat_ai(
  p_empresa_id uuid, p_remote_jid text, p_actor_user_id uuid
)

check_zelochat_ai_epoch(
  p_empresa_id uuid, p_remote_jid text, p_expected_epoch bigint
)
```

Cada função resolve o controle canônico no banco a partir do JID, bloqueia a row de controle, incrementa epoch, projeta `auto_reply` para todas as sessões ligadas e registra evento. Nenhuma RPC aceita array de família fornecido pelo caller. `pause` cancela somente jobs `queued` de origem `ai_auto|ai_followup`; `resume` nunca restaura jobs.

Adicionar `ensure_zelochat_conversation_control(p_empresa_id uuid, p_remote_jid text)`: usa advisory transaction lock da identity key, anexa todas as sessões com mesma pessoa/contact key e funde controles duplicados sob locks ordenados. Na fusão, modo humano vence, epoch vira `greatest(epoch)+1`, jobs/sessões são reatribuídos e um evento `controls_merged` é gravado. `ensureSession` chama essa RPC antes de devolver uma sessão elegível para IA.

- [ ] **Step 4: Implement the module interface**

```ts
export interface ConversationControlSnapshot {
  conversationControlId: string;
  mode: 'ai' | 'human';
  epoch: string;
  remoteJids: string[];
  changedAt: string;
}

export interface AiTurnPermit {
  empresaId: string;
  conversationControlId: string;
  remoteJid: string;
  epoch: string;
  triggerMessageId: string;
}
```

Injetar `resolveFamilyJids` e `rpc` para testes. O adapter real reutiliza `fetchSessionFamily`; mover/exportar somente a consulta necessária, sem expor detalhes para rotas.

- [ ] **Step 5: Replace direct mode writes**

Transformar `setAutoReply` em wrapper:

- `enabled=false` → `claimHumanTakeover(source='explicit_manual_toggle')`;
- `enabled=true` → `resumeAiConversation`;
- `escalateSession` chama takeover antes de gravar `status='escalated'`;
- após commit, chamar `cancelPendingReply` e emitir `conversation_mode_changed`.

- [ ] **Step 6: Run focused tests**

Run: `npx tsx tests/conversationControl.test.ts && npx tsx tests/replyDebouncer.test.ts && npx tsx tests/auditFixGuardrails.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/064_conversation_control_rpcs.sql server/conversationControl.ts server/messageHandler.ts server/escalation.ts tests/conversationControl.test.ts
git commit -m "feat(chat): add atomic human takeover and AI epoch"
```

---

### Task 4: Tornar a fila serial por conversa e segura entre réplicas

**Files:**

- Create: `supabase/migrations/065_conversation_outbound_claims.sql`
- Create: `server/outbound/providerAdapter.ts`
- Create: `tests/conversationOutboundWorker.test.ts`
- Modify: `server/outbound/queue.ts:3`
- Modify: `server/outbound/worker.ts:7`
- Modify: `tests/outboundQueue.test.ts`

**Interfaces:**

- Consumes: `OutboundPayload`, job schema e controle/epoch.
- Produces: claim/finalização condicionados por lease e adapter de transporte único.

- [ ] **Step 1: Write two-worker concurrency tests**

Com um store fake compartilhado e duas instâncias de `OutboundWorker`, provar:

```ts
assert.deepEqual(await Promise.all([workerA.runOnce('a'), workerB.runOnce('b')]), [true, false]);
assert.equal(transport.callsFor('e1:j1'), 1);
```

Adicionar casos:

- dois jobs da mesma conversa, mesmo em JIDs alternativos, nunca ficam `sending|dispatch_started` juntos;
- takeover epoch 7→8 cancela job AI queued 7;
- lease AI expirada antes de transporte pode ser reclamada; depois de `dispatch_started` vira incerta sem segundo POST;
- AI já `dispatch_started` termina/reconcilia antes de job humano;
- conversas diferentes podem progredir independentemente;
- finalização por worker diferente do `lease_owner` falha.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/conversationOutboundWorker.test.ts`  
Expected: FAIL porque claim atual não serializa por conversa.

- [ ] **Step 3: Replace claim RPC in migration `065`**

`claim_zelochat_outbound_job` deve:

1. lease vencida em `sending` pode voltar a queued; lease vencida em `dispatch_started` vira `delivery_uncertain` e cria hold;
2. bloquear a row de `zelochat_conversation_ai_control` antes de selecionar/alterar o job;
3. reavaliar elegibilidade após o lock e retornar vazio, nunca `unique_violation`, para a segunda worker;
4. ordenar por `next_attempt_at, created_at, id`;
5. comparar `control_epoch` e `mode` para IA sob o mesmo lock;
6. cancelar job stale em vez de retorná-lo;
7. manter regras de campanha/automação;
8. retornar no máximo um job.

Criar `begin_zelochat_human_outbound`, `start_zelochat_outbound_transport`, `complete_zelochat_outbound_job`, `fail_zelochat_outbound_job` e `suppress_zelochat_outbound_job`. `begin...` reserva `(empresa_id,idempotency_key)` antes do takeover e somente o primeiro writer muda epoch/cria evento/mensagem/job; mídia nasce `preparing`, texto pode nascer `queued`. As demais funções são condicionadas por `id`, `empresa_id` e `lease_owner`; `start...` grava `dispatch_started_at` antes do POST. Adicionar teste com banco/RPC real em que pause tenta commitar entre candidate e claim: o lock do controle decide a ordem e nunca autoriza snapshot antigo.

- [ ] **Step 4: Generalize queue types**

```ts
export interface OutboundJob {
  id: string;
  empresaId: string;
  jobType: 'conversation' | 'campaign' | 'automation';
  conversationControlId?: string;
  conversationJid?: string;
  messageId?: string;
  origin: OutboundOrigin;
  payload: OutboundPayload;
  payloadFingerprint: string;
  controlEpoch?: string;
  status: OutboundState;
  leaseOwner?: string | null;
  attempts: number;
}
```

Remover decisões de rollout CRM do caminho `conversation`; elas continuam aplicadas somente a `campaign|automation`.

- [ ] **Step 5: Implement provider adapter**

O adapter faz switch exaustivo em `payload.kind` e chama somente a função correspondente de `server/whatsapp.ts`. Antes do transporte, calcula SHA-256 da representação canônica: texto normalizado, bytes+MIME da mídia, vCard, coordenadas, opções da enquete ou alvo+emoji da reação. Cada wrapper precisa extrair um ID real; resposta 2xx/void/ID ausente vira `delivery_uncertain`, nunca `sent`. Antes de implementar o switch, criar um teste-probe por helper (`text`, mídia, áudio, contato, lista, localização, reação, poll, buttons, sticker) que fixa o shape de ID retornado.

Criar `server/outbound/mediaStore.ts`: faz upload do asset antes do enqueue para `zelochat-media/outbound/<empresa>/<job>/<checksum>`, persiste somente referência/checksum e remove após estado terminal + grace period. Teste rejeita `data:` dentro de `payload jsonb` e prova envio depois do TTL temporário atual.

- [ ] **Step 6: Run focused tests**

Run: `npx tsx tests/conversationOutboundWorker.test.ts && npx tsx tests/outboundQueue.test.ts && npx tsx tests/auditFixGuardrails.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add supabase/migrations/065_conversation_outbound_claims.sql server/outbound/queue.ts server/outbound/worker.ts server/outbound/providerAdapter.ts server/outbound/mediaStore.ts tests/conversationOutboundWorker.test.ts tests/outboundQueue.test.ts
git commit -m "feat(outbound): serialize conversation sends across workers"
```

---

### Task 5: Criar o dispatcher único e semântica de falha

**Files:**

- Create: `server/conversationOutbound.ts`
- Create: `tests/conversationOutbound.test.ts`
- Modify: `server/messageHandler.ts:1188`
- Modify: `server/index.ts:484`

**Interfaces:**

- Consumes: controle, queue, payload e lifecycle.
- Produces: `dispatchConversationOutbound` usado por rotas e IA.

- [ ] **Step 1: Write orchestration tests with injected dependencies**

Casos obrigatórios:

```ts
await dispatchConversationOutbound({
  empresaId: 'e1', remoteJid: 'j1', actorUserId: 'u1',
  origin: 'human_zelochat', takeoverPolicy: 'take_over',
  idempotencyKey: 'request-1', payload: { kind: 'text', text: 'Olá' },
});
assert.deepEqual(calls.slice(0, 3), ['begin-human-outbound', 'cancel-debounce', 'wait-terminal']);
```

- takeover falha → nenhuma intenção ou chamada externa;
- envio falha → conversa permanece humana;
- mesma chave concorrente → um job;
- mesma chave concorrente → exatamente um incremento de epoch e um evento de takeover;
- resposta terminal em até 10 s → `sent|failed_before_dispatch|delivery_uncertain`;
- prazo excedido → `queued` e WebSocket conclui depois;
- origem AI sem permit → `suppressed` sem job enviável.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/conversationOutbound.test.ts`  
Expected: FAIL with module missing.

- [ ] **Step 3: Implement dispatcher in this exact order**

1. validar payload e idempotency key;
2. chamar `begin_zelochat_human_outbound` quando policy=`take_over`; a reserva idempotente, takeover, bolha e job são uma única transação;
3. cancelar debounce local somente quando a RPC informar `takeoverApplied=true`;
4. para mídia, fazer upload no asset imutável e mudar `preparing→queued`; falha muda para `failed_before_dispatch` sem reativar IA;
5. para IA, exigir epoch string esperado na RPC de enqueue;
6. aguardar terminal por até `CONVERSATION_SEND_WAIT_MS`, default `10_000`;
7. retornar resultado discriminado sem erro técnico.

- [ ] **Step 4: Extend message lifecycle**

`createAssistantMessageIntent` recebe `origin`, `actorUserId`, `initialStatus='queued'`; `mark...Succeeded/Failed` passam a ser atualizações disparadas pelo worker. Adicionar `markAssistantMessageDeliveryUncertain` e `markAssistantMessageCancelled`.

- [ ] **Step 5: Start worker compatibly**

Manter um worker singleton por processo, mas deixar toda exclusão mútua cross-replica no banco. O processo pode executar mais de um job por tick apenas quando pertencem a conversas diferentes e o limite global da instância permitir.

- [ ] **Step 6: Run focused tests**

Run: `npx tsx tests/conversationOutbound.test.ts && npx tsx tests/customerMessages.test.ts && npm run lint`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/conversationOutbound.ts server/messageHandler.ts server/index.ts tests/conversationOutbound.test.ts
git commit -m "feat(outbound): coordinate takeover intent and terminal delivery"
```

---

### Task 6: Enfileirar todos os caminhos customer-facing da IA

**Files:**

- Create: `tests/aiTakeoverRace.test.ts`
- Create: `tests/aiOutboundGuardrails.test.ts`
- Modify: `server/index.ts:238`
- Modify: `server/replyDebouncer.ts:39`
- Modify: `server/ai.ts:111`
- Modify: `server/ai.ts:3315`
- Modify: `server/router.ts:2500`
- Modify: `server/escalation.ts:233`

**Interfaces:**

- Consumes: `AiTurnPermit` e dispatcher.
- Produces: nenhum envio automático customer-facing fora da fila.

- [ ] **Step 1: Write deterministic race tests**

Usar um `Deferred` para segurar o modelo:

```ts
const model = deferred<ModelReply>();
const ai = startAiTurn({ permit: epoch7, model: () => model.promise });
await takeover({ source: 'zelochat_operator' });
model.resolve({ text: 'Resposta antiga' });
assert.equal(await ai, null);
assert.equal(transport.calls.length, 0);
```

Repetir para takeover via `fromMe`, toggle Manual e escalonamento. Cobrir também pre-model guards, tool follow-up e fallback de trigger.

- [ ] **Step 2: Write a bypass guardrail**

O teste lê `server/ai.ts` e falha se houver chamada de mensagem a `sendTextMessage`, `sendMediaMessage` ou `sendWhatsAppAudio`. Notificações a gerente também usam dispatcher com `internal_system`; a allowlist cobre somente presença/read receipt/revogação, que não são mensagens novas.

- [ ] **Step 3: Run and verify RED**

Run: `npx tsx tests/aiTakeoverRace.test.ts && npx tsx tests/aiOutboundGuardrails.test.ts`  
Expected: FAIL porque `sendAndPersistText` chama o transporte diretamente.

- [ ] **Step 4: Carry permit from inbound to model**

- após `handleIncomingMessage` persistir uma mensagem nova, chamar `beginAiTurn`;
- adicionar `permit` a `scheduleReply`;
- `generateAndSendReply(jid, empresaId, permit)` exige permit;
- redelivery, reação ou evento sem resposta não cria permit;
- endpoint `/api/ai/reply` obtém permit vigente e falha fechado se modo Manual.

- [ ] **Step 5: Replace every customer-facing send**

Trocar `sendAndPersistText` por `enqueueAutomatedText`. `AiTurnPermit` é argumento obrigatório de todo helper mutante/customer-facing. Cobrir resposta simples, validação/clear/confirm/cancel de pending/Pix, consulta de pedido, tag, notify follow-up, fallback de trigger, redirect, escalonamento e mensagens de erro automáticas. Cada teste pausa entre `beginAiTurn` e o helper e exige zero write automático e zero job AI.

- [ ] **Step 6: Adapt escalation**

Escalonamento executa takeover, atualiza status e enfileira a mensagem ao cliente como `system_handoff`, explicitamente permitida em modo humano. Notificação ao gerente usa destino separado e não participa do controle da conversa do cliente.

- [ ] **Step 7: Run the critical regression set**

Run:

```powershell
npx tsx tests/aiTakeoverRace.test.ts
npx tsx tests/aiOutboundGuardrails.test.ts
npx tsx tests/aiToolPlan.test.ts
npx tsx tests/conversationState.test.ts
npx tsx tests/replyDebouncer.test.ts
npm run lint
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```powershell
git add server/index.ts server/replyDebouncer.ts server/ai.ts server/router.ts server/escalation.ts tests/aiTakeoverRace.test.ts tests/aiOutboundGuardrails.test.ts
git commit -m "fix(ai): fence every automatic conversation outbound"
```

---

### Task 7: Migrar todos os envios humanos do ZeloChat

**Files:**

- Create: `tests/manualOutboundRoutes.test.ts`
- Modify: `server/router.ts:1449`
- Modify: `server/router.ts:1532`
- Modify: `server/router.ts:3334`
- Modify: `server/router.ts:3445`
- Modify: `server/customers/router.ts:60`
- Modify: `src/services/waApi.ts:275`
- Modify: `src/services/customerApi.ts:179`

**Interfaces:**

- Consumes: dispatcher e origem `human_zelochat`.
- Produces: todos os caminhos manuais assumem antes de enfileirar.

- [ ] **Step 1: Write a route matrix test**

Tabela parametrizada:

```ts
const routes = [
  '/api/send', '/api/customers/:personId/messages', '/api/send-contact',
  '/api/send/list', '/api/send/location', '/api/send/reaction', '/api/send/poll',
  '/api/messages/:id/retry',
];
```

Para cada rota, exigir `origin='human_zelochat'`, `takeoverPolicy='take_over'`, permissão de comunicação e ausência de chamada direta ao transporte.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/manualOutboundRoutes.test.ts`  
Expected: FAIL for every current route.

- [ ] **Step 3: Migrate composer and CRM**

Frontend/hook gera UUID por intenção de envio, persiste a mesma chave enquanto a operação é repetida após resposta perdida e a envia no body/header. Backend aceita fallback gerado pelo servidor apenas para clientes legados. `/api/send` e CRM passam ator autenticado e retornam:

```json
{ "status": "sent|queued|failed_before_dispatch|delivery_uncertain", "messageId": "uuid", "jobId": "uuid" }
```

CRM deixa de transformar falha de persistência pós-transporte em 502 retryable.

Adicionar teste: primeira chamada cria/envia mas a resposta HTTP é perdida; segunda chamada com a mesma chave retorna o mesmo job/mensagem, com uma chamada externa e um takeover/evento.

- [ ] **Step 4: Migrate special payloads**

Contato, lista, localização, reação e enquete usam payload discriminado e ledger mesmo quando não há bolha rica. Texto, mídia, documento, vídeo, áudio, quote, resposta rápida e nova conversa continuam passando pela mesma rota principal.

- [ ] **Step 5: Harden retry semantics**

- `failed_before_dispatch`: retry idempotente permitido;
- `delivery_uncertain`: botão padrão de retry proibido;
- “Enviar uma nova cópia” exige confirmação e cria nova idempotency key ligada ao job anterior;
- retry nunca reativa a IA.

- [ ] **Step 6: Run focused checks**

Run: `npx tsx tests/manualOutboundRoutes.test.ts && npx tsx tests/retryFailedMessage.test.ts && npx tsx tests/customerMessages.test.ts && npx tsx tests/auditFixGuardrails.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/router.ts server/customers/router.ts src/services/waApi.ts src/services/customerApi.ts tests/manualOutboundRoutes.test.ts tests/retryFailedMessage.test.ts
git commit -m "fix(chat): take over before every operator outbound"
```

---

### Task 8: Processar `fromMe` nativo com reconciliação persistente

**Files:**

- Create: `supabase/migrations/066_native_from_me_takeover.sql`
- Create: `server/fromMe.ts`
- Create: `server/fromMeProcessor.ts`
- Create: `server/webhookReplayWorker.ts`
- Create: `tests/fromMeClassifier.test.ts`
- Create: `tests/fromMeProcessor.test.ts`
- Create: `tests/webhookReplayWorker.test.ts`
- Modify: `server/router.ts:491`
- Modify: `server/messageHandler.ts:2409`
- Modify: `server/whatsapp.ts:38`

**Interfaces:**

- Consumes: job ledger, controle, persistência de mensagens e cancelamento local.
- Produces: `processFromMeUpsert` aguardado pelo webhook.

- [ ] **Step 1: Write classifier tests**

```ts
export type FromMeDecision =
  | { kind: 'duplicate' }
  | { kind: 'server_echo'; jobId: string; repair: boolean }
  | { kind: 'pending_correlation'; jobId: string }
  | { kind: 'native_human' }
  | { kind: 'ignore_protocol_artifact' };
```

Cobrir: ID já persistido; job `dispatch_started` com fingerprint igual mas sem ID vira `pending_correlation`, nunca eco definitivo; texto/mídia byte-idênticos enviados por humano durante esse job; fingerprint diferente; tracking legado; humano desconhecido; redelivery humano; `deviceSentMessage`; grupo; broadcast; receipt e presença.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/fromMeClassifier.test.ts`  
Expected: FAIL with module missing.

- [ ] **Step 3: Implement extraction for all visible payloads**

Desembrulhar `deviceSentMessage`, `ephemeral`, `viewOnce`, `edited` e `documentWithCaption` antes de classificar. Suportar texto, imagem, áudio/PTT, documento, vídeo, sticker, buttons, contato, lista, localização, poll e reação. Calcular o mesmo fingerprint canônico da Task 4; tipos sem representação rica persistem preview seguro. Receipt/presença não persistem nem assumem. Um payload visível sem fingerprint reproduzível retorna erro de processamento/replay e não pode ser liberado em `enforce` até existir fixture real validada.

- [ ] **Step 4: Add atomic native RPC**

Migration `066` cria:

```sql
record_zelochat_native_outbound_takeover(
  p_empresa_id uuid, p_remote_jid text,
  p_wa_message_id text, p_payload jsonb, p_preview text, p_sent_at timestamptz
)
```

A RPC resolve o controle canônico no banco, insere mensagem/job `sent` com origem `human_native_whatsapp`, usa conflito `(empresa_id, wa_message_id)` como idempotência e só executa takeover quando a inserção é nova. Ela não muda `status` nem cria escalonamento.

- [ ] **Step 5: Implement echo repair**

Ordem definitiva: lookup por provider ID e tracking local depois da resposta externa. Job `dispatch_started` com fingerprint igual e sem ID cria `from_me_pending_correlation`, coloca hold no controle e aguarda o ID; fingerprint nunca prova eco sozinho, nem quando o conteúdo é idêntico. Se o job receber o mesmo ID, reparar sem takeover; se receber ID diferente, processar como humano. Se o wrapper permanecer sem ID, manter hold/dead-letter e bloquear `enforce` desse tipo. Nunca reconciliar apenas por JID/kind.

- [ ] **Step 6: Await webhook processing**

Preservar ack HTTP rápido depois de gravar o raw event. No processor assíncrono, substituir o fire-and-forget interno por `await processFromMeUpsert`; falha sobe para o lifecycle do raw event e grava `processing_error`. Após commit humano, cancelar debounce e emitir `message_sent` + `conversation_mode_changed`.

Takeover `fromMe` em `enforce` exige `auth_status='token_match'`. Token ausente/inválido para instância conhecida grava shadow/alerta, mas nunca altera `auto_reply` nem persiste origem humana definitiva.

- [ ] **Step 7: Implement at-least-once replay**

Migration `066` adiciona a `zelochat_webhook_events_raw`: `attempt_count`, `next_attempt_at`, `lease_owner`, `lease_expires_at`, `dead_lettered_at`, `auth_status`, `correlation_state`. Criar RPC `claim_zelochat_webhook_replay(worker, lease_seconds)` com `FOR UPDATE SKIP LOCKED`. `WebhookReplayWorker` aplica backoff, dead-letter após limite e usa a idempotência por `wa_message_id`; crash depois do takeover e antes de completion não cria segundo takeover/evento.

- [ ] **Step 8: Run the race matrix**

Run:

```powershell
npx tsx tests/fromMeClassifier.test.ts
npx tsx tests/fromMeProcessor.test.ts
npx tsx tests/webhookReplayWorker.test.ts
npx tsx tests/routerWebhookGuardrails.test.ts
npx tsx tests/messageHandlerMedia.test.ts
```

Expected: all PASS, incluindo conteúdo idêntico, eco na réplica B do job enviado pela A, token ausente forjado, replay concorrente e atraso do webhook. O teste de atraso documenta a limitação física: a garantia começa no commit do takeover.

- [ ] **Step 9: Commit**

```powershell
git add supabase/migrations/066_native_from_me_takeover.sql server/fromMe.ts server/fromMeProcessor.ts server/webhookReplayWorker.ts server/router.ts server/messageHandler.ts server/whatsapp.ts tests/fromMeClassifier.test.ts tests/fromMeProcessor.test.ts tests/webhookReplayWorker.test.ts
git commit -m "fix(webhook): distinguish native human sends from server echoes"
```

---

### Task 9: Migrar transacionais, campanhas e integrações sem falso takeover

**Files:**

- Create: `tests/systemOutboundPolicy.test.ts`
- Modify: `server/router.ts:359`
- Modify: `server/router.ts:1863`
- Modify: `server/router.ts:2097`
- Modify: `server/messageHandler.ts`
- Modify: `server/ai.ts`
- Modify: `server/escalation.ts`
- Modify: `server/zelomenuCartSessions.ts`
- Modify: `server/whatsappOutreach.ts`
- Modify: `server/outbound/worker.ts`
- Modify: `server/automations/sweeper.ts`
- Modify: `server/campaigns/service.ts`

**Interfaces:**

- Consumes: dispatcher e origens `system_transactional|campaign|automation|internal_system`.
- Produces: ausência de sends customer-facing fora do adapter.

- [ ] **Step 1: Write policy tests**

Exigir:

- status/aceite de pedido → `system_transactional + preserve_ai`;
- despacho ao entregador → `system_transactional + preserve_ai` no JID do entregador;
- campanhas → `campaign + preserve_ai`;
- automações → `automation + preserve_ai`;
- internal send/outreach → `internal_system + preserve_ai`;
- nenhum desses chama takeover.

Fixar também no teste: ack “pedido já confirmado” em `server/router.ts`; falha de transcrição em `server/messageHandler.ts`; pending confirm/cancel, notificações gerenciais e tool follow-ups em `server/ai.ts`; handoff/gerente em `server/escalation.ts`; aceite manual, confirmação pública, confirmação WhatsApp, gerente e recovery de carrinho em `server/zelomenuCartSessions.ts`.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/systemOutboundPolicy.test.ts`  
Expected: FAIL because paths call the transport directly.

- [ ] **Step 3: Migrate order and driver notifications**

Transição do pedido permanece comprometida mesmo se notificação falhar. Remover marcador persistido `[FALHA… reenviar manualmente]`; usar lifecycle real. Aceite de carrinho envia mensagem visível, mas preserva IA conforme a política aprovada. Despacho ao entregador não cria nem altera o controle da conversa do cliente. Destino transacional sem sessão prévia pode enfileirar por destination key sem criar controle até uma conversa real existir.

- [ ] **Step 4: Migrate campaigns/automations without losing current leases**

Resolver/anexar `conversation_control_id` quando existe sessão; sem sessão, usar uma destination lock key tenant-scoped. Manter supressão, opt-out, rollout e idempotência existentes. A validação de epoch não se aplica a essas origens. Campanha/automação já `dispatch_started` pode fazer a mensagem humana aguardar; a UI mantém `202/queued` e mostra que há um envio anterior em processamento.

Atualizar todos os upserts em `server/outbound/worker.ts`, `server/automations/sweeper.ts`, `server/campaigns/service.ts` e `server/zelomenuCartSessions.ts` para `onConflict: 'empresa_id,idempotency_key'` enquanto a constraint global ainda existe. Testar mesma chave em empresas diferentes e retry concorrente na mesma empresa.

- [ ] **Step 5: Add a global transport bypass guardrail**

O teste percorre `server/**/*.ts` e permite imports/chamadas de transporte apenas em:

- `server/outbound/providerAdapter.ts`;
- código de conexão/QR, presença, read receipt e revogação que não cria mensagem nova.

Mensagens a gerente e integrações internas também usam jobs com origem `internal_system`; não existe allowlist de destinatário que contorne origem/lifecycle/idempotência.

- [ ] **Step 6: Run focused checks**

Run: `npx tsx tests/systemOutboundPolicy.test.ts && npx tsx tests/customerCampaignSchema.test.ts && npx tsx tests/customerAutomations.test.ts && npx tsx tests/outboundQueue.test.ts`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/router.ts server/messageHandler.ts server/ai.ts server/escalation.ts server/zelomenuCartSessions.ts server/whatsappOutreach.ts server/outbound/worker.ts server/automations/sweeper.ts server/campaigns/service.ts tests/systemOutboundPolicy.test.ts
git commit -m "refactor(outbound): route transactional sends through coordinator"
```

---

### Task 10: Atualizar realtime e UX de tomada automática

**Files:**

- Create: `tests/conversationModeUiGuardrails.test.ts`
- Modify: `server/ws.ts:5`
- Modify: `src/types.ts:24`
- Modify: `src/hooks/useWhatsAppSessions.ts:97`
- Modify: `src/components/views/ChatView.tsx:2190`
- Modify: `src/components/views/MessageBubble.tsx`
- Modify: `src/components/customers/CustomerMessagesTab.tsx`
- Modify: `src/services/errorMessages.ts`

**Interfaces:**

- Consumes: eventos e estados do backend.
- Produces: modo/lifecycle consistente em todas as telas.

- [ ] **Step 1: Write UI source and reducer tests**

Exigir evento:

```ts
type ConversationModeChanged = {
  type: 'conversation_mode_changed';
  data: {
    sessionIds: string[];
    mode: 'ai' | 'human';
    epoch: string;
    source: TakeoverSource | 'resume';
    changedAt: string;
  };
};
```

Provar que todas as sessões da família mudam juntas, sem mutação direta fora do hook.

- [ ] **Step 2: Run and verify RED**

Run: `npx tsx tests/conversationModeUiGuardrails.test.ts`  
Expected: FAIL because event/state fields do not exist.

- [ ] **Step 3: Extend types and WebSocket reducer**

Adicionar `conversationMode`, `conversationEpoch`, `takeoverSource`, `takeoverAt` a `ChatSession`, mantendo `autoReply` derivado para compatibilidade. Evento do servidor atualiza a família imediatamente.

Durante rolling deploy, mapear status legado `failed` para a apresentação `failed_before_dispatch`; somente a migration `067` remove esse valor do banco.

- [ ] **Step 4: Implement operator feedback**

- modo muda para “Manual” assim que o takeover retorna;
- feedback discreto: “Conversa assumida automaticamente após sua mensagem.”;
- toggle para IA permanece explícito;
- takeover nativo muda a UI sem badge de escalonamento;
- `preparing/queued/sending/dispatch_started`: “Enviando…”;
- `failed_before_dispatch`: “Mensagem não enviada.” + retry;
- `delivery_uncertain`: “Não foi possível confirmar a entrega.” + ação “Enviar uma nova cópia”.

Enquanto houver hold de entrega incerta/correlação, novas mensagens ficam queued com “Estamos confirmando um envio anterior.” A liberação manual exige confirmação explícita e registra o ator; a UI não promete que a mensagem anterior foi cancelada.

- [ ] **Step 5: Handle `202 queued`**

`waApi` e `customerApi` aceitam `sent|queued`; a bolha otimista usa o `messageId` do backend, e o WebSocket faz upsert, nunca append cego.

- [ ] **Step 6: Run frontend checks**

Run: `npx tsx tests/conversationModeUiGuardrails.test.ts && npx tsx tests/customerUiGuardrails.test.ts && npm run lint && npm run build`  
Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/ws.ts src/types.ts src/hooks/useWhatsAppSessions.ts src/components/views/ChatView.tsx src/components/views/MessageBubble.tsx src/components/customers/CustomerMessagesTab.tsx src/services/errorMessages.ts tests/conversationModeUiGuardrails.test.ts
git commit -m "feat(chat): show automatic human takeover and delivery states"
```

---

### Task 11: Provar as invariantes no banco, integração e E2E

**Files:**

- Create: `supabase/verification/conversation_outbound_engine.sql`
- Create: `tests/conversationOutboundIntegration.test.ts`
- Create: `tests/qa-human-takeover.spec.ts`
- Create: `tests/qa-native-from-me.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: sistema completo das Tasks 1–10.
- Produces: gates executáveis de rollout.

- [ ] **Step 1: Write a transactional SQL probe**

Dentro de `BEGIN ... ROLLBACK`, provar:

- takeover atualiza todos os JIDs e incrementa epoch;
- resume incrementa novamente;
- job AI stale não é claimado;
- dois claims concorrentes não produzem dois `sending|dispatch_started` no mesmo controle, inclusive JIDs alternativos;
- ator/empresa cruzados são rejeitados;
- RPCs não são executáveis por `anon|authenticated`;
- `wa_message_id` é único por empresa;
- redelivery nativo não repete takeover/evento.

- [ ] **Step 2: Write backend integration races**

Usar banco de teste/RPC adapter e transport fake com barreiras. Matriz:

1. inbound → debounce → `/api/send` → zero AI;
2. modelo bloqueado → `/api/send` → liberar modelo → zero AI;
3. AI já `dispatch_started` → humano ZeloChat queued → ordem `[ai, human]`;
4. native `fromMe` durante debounce/modelo → zero novo AI após commit; atraso antes do commit registra a limitação física;
5. eco rápido → uma mensagem, IA preservada;
6. duas réplicas/worker IDs → um send;
7. falha humana → modo continua Manual;
8. transacional → modo continua IA.
9. lease expira após `dispatch_started` → zero segundo POST, estado incerto e fila em hold;
10. mesmo texto/mídia no job e no celular → correlação pendente, nunca eco presumido;
11. JID alternativo criado durante takeover → mesmo controle em modo humano;
12. request HTTP repetido com mesma chave → um epoch/evento/job/send;
13. mídia queued além do TTL legado → asset ainda disponível;
14. `fromMe` sem token forte → zero takeover.

- [ ] **Step 3: Replace obsolete Playwright coverage**

Os novos testes usam `/webhook/:instance` isolado; não consideram o `410` da rota legada como cobertura. E2E prova compositor → modo Manual, retomada explícita, mensagem nativa e ausência de escalonamento.

- [ ] **Step 4: Add test scripts**

```json
{
  "test:takeover": "tsx tests/conversationControl.test.ts && tsx tests/conversationOutboundWorker.test.ts && tsx tests/aiTakeoverRace.test.ts && tsx tests/fromMeProcessor.test.ts",
  "test:e2e:takeover": "playwright test tests/qa-human-takeover.spec.ts tests/qa-native-from-me.spec.ts"
}
```

- [ ] **Step 5: Run the full verification gate**

```powershell
npm run test:takeover
npx tsx tests/auditFixGuardrails.test.ts
npx tsx tests/routerWebhookGuardrails.test.ts
npm run lint
npx tsc --noEmit -p server/tsconfig.json
npm test
npm run build
npm run test:e2e:takeover
```

Expected: all new tests PASS. Qualquer falha preexistente da suíte global deve ser reproduzida no commit-base e documentada com comando/saída; não pode ser atribuída à engine sem evidência.

- [ ] **Step 6: Commit**

```powershell
git add supabase/verification/conversation_outbound_engine.sql tests/conversationOutboundIntegration.test.ts tests/qa-human-takeover.spec.ts tests/qa-native-from-me.spec.ts package.json
git commit -m "test(chat): prove takeover ordering and multi-replica fencing"
```

---

### Task 12: Fazer rollout observável e documentar o fix crítico

**Files:**

- Create: `docs/runbooks/HUMAN_TAKEOVER_OUTBOUND.md`
- Modify: `CURRENT.md`
- Modify: `FIXES_PROGRESS.md`
- Modify: `INCIDENTS.md`
- Modify: `docs/ai/ZeloChat.memory.md`
- Modify: `src/data/changelog.ts` only if fewer than four entries exist for the delivery date
- Modify: critical functions touched in `server/index.ts`, `server/ai.ts`, `server/router.ts`, `server/messageHandler.ts`

**Interfaces:**

- Consumes: métricas, flags e probes.
- Produces: rollout/rollback repetível e memória arquitetural atualizada.

- [ ] **Step 1: Add rollout modes**

```ts
export type ConversationOutboundEngineMode = 'shadow' | 'enforce';
```

`shadow` grava somente eventos `would_takeover|would_suppress|would_correlate`, sem takeover, timer cancel, job conversacional ou alteração de entrega; ele valida classificação, não ordering/lease. Mantém temporariamente o transporte legado. `enforce` usa somente o dispatcher. A flag é server-side e pode ser resolvida por empresa; ausência preserva explicitamente `shadow` durante rolling deploy. Depois do cutover global, rollback para `shadow` exige desligar auto-replies como ação operacional explícita.

- [ ] **Step 2: Add operational metrics**

Registrar contadores de takeover por fonte, AI stale suprimida, decisões `fromMe`, entrega incerta, jobs/leases stuck e idade da fila. Logs usam IDs e JID redigido.

- [ ] **Step 3: Apply Gate A — database**

1. backup/restore point conforme runbook Supabase;
2. aplicar `063–066`;
3. executar `supabase/verification/conversation_outbound_engine.sql`;
4. confirmar grants, índices, equivalência SQL/TypeScript do contact key e nenhuma alteração em tabelas PDV-owned;
5. publicar backend ainda em `shadow`.

- [ ] **Step 4: Apply Gate B — tenant de teste**

Capturar payloads sanitizados reais de texto, áudio/PTT, mídia, sticker, buttons, contato, localização, reação, poll e wrappers `deviceSentMessage|ephemeral|viewOnce|edited|documentWithCaption`. Comparar shadow decisions com origem conhecida. Shadow não valida ordering; essa validação acontece somente em tenant isolado. Takeover nativo exige token válido e todos os tipos customer-facing server-side já migrados.

- [ ] **Step 5: Apply Gate C — staged enforcement**

1. compositor principal e CRM em tenant isolado;
2. IA customer-facing;
3. payloads especiais, gerenciais e internos;
4. transacionais/campanhas/automações;
5. guardrail global sem bypass + wrappers retornando ID/uncertain;
6. WhatsApp nativo com token forte;
7. global após 24 h sem job stuck, duplicata ou divergência de eco.

- [ ] **Step 6: Remove rolling compatibility only after old replicas drain**

Criar `067_conversation_outbound_rolling_cleanup.sql`. Atualizar primeiro todos os writers para `onConflict: 'empresa_id,idempotency_key'`; confirmar que nenhuma réplica antiga usa o alvo global; então derrubar `zelochat_outbound_jobs_idempotency_key_key`, migrar `outbound_status='failed'` para `failed_before_dispatch` e substituir constraints para remover o valor legado. Provar duas empresas com a mesma chave e retry concorrente na mesma empresa.

- [ ] **Step 7: Document rollback**

Rollback muda para `shadow`, desliga globalmente os auto-replies enquanto o caminho de emergência estiver ativo, para o worker conversacional e preserva ledger/modo humano. Não apagar eventos, não reverter migration e não reativar IA em massa.

- [ ] **Step 8: Update project documentation**

Em `FIXES_PROGRESS.md`, registrar cada P fechado com arquivo:linha. Em `INCIDENTS.md`, registrar sintoma, causa e fix desta classe P1. Nos pontos críticos, adicionar:

```ts
// FIX 2026-08-29: outbounds humanos não invalidavam respostas automáticas em corrida → takeover e dispatch agora são serializados por epoch/fila durável.
```

Atualizar `CURRENT.md` e `ZeloChat.memory.md`; changelog PT-BR somente para a entrega user-facing.

- [ ] **Step 9: Final verification and commit**

Run: `npm run test:takeover && npm run lint && npm run build`  
Expected: PASS.

```powershell
git add supabase/migrations/067_conversation_outbound_rolling_cleanup.sql docs/runbooks/HUMAN_TAKEOVER_OUTBOUND.md CURRENT.md FIXES_PROGRESS.md INCIDENTS.md docs/ai/ZeloChat.memory.md src/data/changelog.ts server/index.ts server/ai.ts server/router.ts server/messageHandler.ts
git commit -m "docs(chat): record human takeover engine rollout"
```

## Execution gates and stop conditions

- **Gate 1 — after Task 3:** mode/epoch works atomically and toggle/escalation share the seam.
- **Gate 2 — after Task 5:** one-sending-per-conversation and delivery states are proven with two workers.
- **Gate 3 — after Task 6:** no AI customer-facing bypass remains.
- **Gate 4 — after Task 8:** native human and server echo are correctly distinguished.
- **Gate 5 — after Task 11:** SQL, integration, multi-replica and E2E all pass.
- Stop rollout immediately on false takeover de eco, AI send after human job, duplicate provider call, job `sending` stuck beyond lease, or cross-tenant event.

## Recommended execution order

Tasks 1–5 are the shared foundation and must run sequentially. After Gate 2, Tasks 6, 7, 8 and 9 can be implemented in separate workstreams against the same frozen interfaces, but merge 6 → 7 → 9 → 8: primeiro removemos bypasses da IA, depois migramos todo transporte server-side, e só então o classificador nativo pode sair de shadow. Task 10 follows the backend event contract, and Tasks 11–12 close verification and rollout.
