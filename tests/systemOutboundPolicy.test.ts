import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { policyForOrigin, type OutboundOrigin } from '../src/domain/outbound.js';

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');

const systemOrigins: OutboundOrigin[] = [
  'system_transactional',
  'campaign',
  'automation',
  'internal_system',
];
for (const origin of systemOrigins) {
  assert.equal(policyForOrigin(origin), 'preserve_ai', `${origin} nunca toma o atendimento da IA`);
}

const customerFacingSources = [
  'server/messageHandler.ts',
  'server/router.ts',
  'server/whatsappOutreach.ts',
  'server/zelomenuCartSessions.ts',
];
for (const path of customerFacingSources) {
  const source = read(path);
  assert.doesNotMatch(
    source,
    /\b(?:sendTextMessage|sendButtonMessage|sendMediaMessage|sendWhatsAppAudio|sendContactMessage|sendListMessage|sendLocationMessage|sendReaction|sendPollMessage|sendStickerMessage)\s*\(/,
    `${path} não pode contornar o dispatcher durável`,
  );
  assert.match(source, /dispatchConversationOutbound\s*\(/, `${path} usa o dispatcher durável`);
}

const router = read('server/router.ts');
assert.match(router, /origin:\s*'internal_system'/, 'outreach interno usa origem internal_system');
assert.match(router, /origin:\s*'system_transactional'/, 'status do pedido e despacho usam origem transacional');
assert.match(router, /takeoverPolicy:\s*'preserve_ai'/, 'mensagens de sistema preservam a IA');

const messageHandler = read('server/messageHandler.ts');
assert.match(messageHandler, /origin:\s*'system_handoff'/, 'falha de transcrição usa o handoff durável');
assert.match(messageHandler, /takeoverPolicy:\s*'preserve_ai'/, 'handoff de transcrição não altera o modo');

const outreach = read('server/whatsappOutreach.ts');
assert.match(outreach, /origin:\s*'internal_system'/, 'follow-up interno usa origem internal_system');
assert.match(outreach, /takeoverPolicy:\s*'preserve_ai'/, 'follow-up interno preserva a IA');

const carts = read('server/zelomenuCartSessions.ts');
assert.match(carts, /origin:\s*'system_transactional'/, 'mensagens de pedido do ZeloMenu são transacionais');
assert.match(carts, /origin:\s*'internal_system'/, 'avisos internos do ZeloMenu têm origem separada');
assert.match(carts, /takeoverPolicy:\s*'preserve_ai'/, 'mensagens do ZeloMenu preservam a IA');
assert.doesNotMatch(carts, /\[FALHA NO ENVIO|reenviar manualmente|addAssistantMessage\s*\(/, 'lifecycle da fila substitui bolhas legadas de falha');

const systemEnqueueMigration = read('supabase/migrations/065_conversation_outbound_claims.sql');
const dispatcher = read('server/conversationOutbound.ts');
assert.match(dispatcher, /SystemOutboundOrigin[\s\S]*?'campaign'[\s\S]*?'automation'/, 'dispatcher aceita campanha e automação sem takeover');
assert.match(
  systemEnqueueMigration,
  /p_origin = 'system_transactional' and v_session_id is null/,
  'transacional para destinatário sem sessão segue pelo job não vinculado',
);
assert.match(
  systemEnqueueMigration,
  /hashtextextended\(p_empresa_id::text \|\| ':' \|\| p_remote_jid/,
  'destino sem sessão recebe lock tenant-scoped próprio',
);
assert.match(
  systemEnqueueMigration,
  /v_candidate\.destination_key[\s\S]*?status in \('sending','dispatch_started'\)/,
  'claim cross-replica revalida job ativo no mesmo destino sem sessão',
);
const worker = read('server/outbound/worker.ts');
assert.match(worker, /`destination:\$\{job\.empresaId\}:\$\{/, 'worker local serializa jobs não vinculados por tenant e destino');

const ai = read('server/ai.ts');
const escalation = read('server/escalation.ts');
assert.doesNotMatch(ai, /\bsendTextMessage\s*\(/, 'confirmações e tool follow-ups da IA não bypassam o dispatcher');
assert.doesNotMatch(escalation, /\bsendTextMessage\s*\(/, 'handoff e aviso ao gerente não bypassam o dispatcher');
assert.match(ai, /dispatchConversationOutbound\s*\(/, 'IA usa o dispatcher');
assert.match(escalation, /dispatchConversationOutbound\s*\(/, 'escalonamento usa o dispatcher');

const queueWriters = [
  'server/outbound/worker.ts',
  'server/automations/sweeper.ts',
  'server/campaigns/service.ts',
  'server/zelomenuCartSessions.ts',
];
for (const path of queueWriters) {
  const source = read(path);
  assert.doesNotMatch(source, /onConflict:\s*'idempotency_key'/, `${path} não usa conflito global`);
  assert.match(source, /onConflict:\s*'empresa_id,idempotency_key'/, `${path} cerca idempotência por tenant`);
}

for (const [path, origin] of [
  ['server/campaigns/service.ts', 'campaign'],
  ['server/automations/sweeper.ts', 'automation'],
] as const) {
  const source = read(path);
  assert.match(source, new RegExp(`outbound_origin:\\s*'${origin}'`), `${path} persiste a origem explícita`);
  assert.match(source, /takeover_policy:\s*'preserve_ai'/, `${path} persiste preserve_ai`);
  assert.match(source, /(?:payload:\s*\{\s*kind:\s*'text'|const payload = \{ kind: 'text')/, `${path} persiste o payload canônico`);
  assert.match(source, /payload_fingerprint:/, `${path} persiste o fingerprint idempotente`);
}

function listTypeScriptFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(path, entry.name);
    return entry.isDirectory() ? listTypeScriptFiles(absolute) : entry.name.endsWith('.ts') ? [absolute] : [];
  });
}

const transportBypass = /\b(?:sendTextMessage|sendButtonMessage|sendMediaMessage|sendWhatsAppAudio|sendContactMessage|sendListMessage|sendLocationMessage|sendReaction|sendPollMessage|sendStickerMessage)\s*\(/;
for (const absolute of listTypeScriptFiles(join(root, 'server'))) {
  const normalized = absolute.replaceAll('\\', '/');
  if (normalized.endsWith('/server/whatsapp.ts') || normalized.endsWith('/server/outbound/providerAdapter.ts')) continue;
  assert.doesNotMatch(readFileSync(absolute, 'utf8'), transportBypass, `${normalized} não cria mensagem direto no transporte`);
}

console.log('systemOutboundPolicy: ok');
