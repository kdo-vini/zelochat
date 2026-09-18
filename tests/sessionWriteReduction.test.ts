import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  sessionRowsNeedingArchive,
  sessionRowsNeedingPin,
  sessionRowsNeedingRead,
  sessionRowsNeedingRename,
  sessionValueChanged,
} from '../server/messageHandler.js';

const rows = [
  { id: 'already', unread_count: 0, status: 'archived', escalated_at: null, pinned: true, customer_name: 'Ana' },
  { id: 'changed', unread_count: 2, status: 'active', escalated_at: '2026-09-18T10:00:00Z', pinned: false, customer_name: 'Telefone' },
] as any[];

test('ações idempotentes escrevem somente as linhas cujo estado muda', () => {
  assert.deepEqual(sessionRowsNeedingRead(rows).map((row) => row.id), ['changed']);
  assert.deepEqual(sessionRowsNeedingArchive(rows).map((row) => row.id), ['changed']);
  assert.deepEqual(sessionRowsNeedingPin(rows, true).map((row) => row.id), ['changed']);
  assert.deepEqual(sessionRowsNeedingRename(rows, 'Ana').map((row) => row.id), ['changed']);
});

test('comparação de sessão ignora update quando o valor persistido já é igual', () => {
  assert.equal(sessionValueChanged('mesmo', 'mesmo'), false);
  assert.equal(sessionValueChanged(null, null), false);
  assert.equal(sessionValueChanged('antes', 'depois'), true);
});

test('dedupe inbound acontece antes de baixar mídia e antes de garantir a sessão', () => {
  const source = readFileSync(new URL('../server/messageHandler.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function _handleIncomingMessage');
  const end = source.indexOf('export async function addAssistantMessage', start);
  const handler = source.slice(start, end);
  const dedupe = handler.indexOf('messageExistsByWhatsAppId');
  assert.ok(dedupe >= 0);
  assert.ok(dedupe < handler.indexOf('extractAttachmentDataUrl'));
  assert.ok(dedupe < handler.indexOf('ensureSession({'));
});

test('preview e não lidos são aplicados juntos somente após a mensagem nova', () => {
  const source = readFileSync(new URL('../server/messageHandler.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function _handleIncomingMessage');
  const end = source.indexOf('export async function addAssistantMessage', start);
  const handler = source.slice(start, end);
  const insert = handler.indexOf('const upserted = await upsertInboundUserMessage');
  const activity = handler.indexOf("'zelochat_apply_inbound_session_activity'");
  assert.ok(insert >= 0 && activity > insert);
  assert.equal(handler.includes("rpc('zelochat_increment_unread'"), false);
  const ensureStart = handler.indexOf('const sessionRow = await ensureSession({');
  const ensureEnd = handler.indexOf('});', ensureStart);
  const ensureCall = handler.slice(ensureStart, ensureEnd);
  assert.equal(ensureCall.includes('lastMessage:'), false);
  assert.equal(ensureCall.includes('lastMessageTime:'), false);
});
