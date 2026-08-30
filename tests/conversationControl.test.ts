// Standalone behavior tests for the conversation mode/epoch seam.
// Run from zelochat/: npx tsx tests/conversationControl.test.ts

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createConversationControl,
  type ConversationControlSnapshot,
} from '../server/conversationControl.js';

type Mode = 'ai' | 'human';

interface FakeControl {
  id: string;
  mode: Mode;
  epoch: bigint;
  remoteJids: string[];
  seenInboundIds: Set<string>;
}

class FakeRepo {
  readonly controls = new Map<string, FakeControl>();
  readonly jidToControl = new Map<string, string>();
  readonly failedRpcs = new Set<string>();
  updatedFamilyJids: string[] = [];
  cancelledAiJobs = 0;

  addControl(control: FakeControl): void {
    this.controls.set(control.id, control);
    for (const jid of control.remoteJids) {
      this.jidToControl.set(jid, control.id);
    }
  }

  fail(name: string): void {
    this.failedRpcs.add(name);
  }

  async rpc(name: string, args: Record<string, unknown>) {
    if (this.failedRpcs.has(name)) {
      return { data: null, error: { message: `${name} failed` } };
    }

    const jid = String(args.p_remote_jid);
    const control = this.controlFor(jid);

    if (name === 'ensure_zelochat_conversation_control') {
      this.attachJid(control, jid);
      return { data: this.snapshot(control), error: null };
    }

    if (name === 'pause_zelochat_ai_for_human') {
      const alreadyHuman = control.mode === 'human';
      control.mode = 'human';
      if (!alreadyHuman) {
        control.epoch += 1n;
        this.cancelledAiJobs += 2;
      }
      this.updatedFamilyJids = [...control.remoteJids];
      return { data: this.snapshot(control), error: null };
    }

    if (name === 'resume_zelochat_ai') {
      if (control.mode !== 'ai') {
        control.epoch += 1n;
      }
      control.mode = 'ai';
      this.updatedFamilyJids = [...control.remoteJids];
      return { data: this.snapshot(control), error: null };
    }

    if (name === 'advance_zelochat_ai_epoch_for_inbound') {
      if (control.mode !== 'ai') return { data: this.snapshot(control), error: null };
      const messageId = String(args.p_message_id);
      if (!control.seenInboundIds.has(messageId)) {
        control.seenInboundIds.add(messageId);
        control.epoch += 1n;
      }
      return { data: this.snapshot(control), error: null };
    }

    if (name === 'check_zelochat_ai_epoch') {
      return {
        data: control.mode === 'ai' && control.epoch === BigInt(String(args.p_expected_epoch)),
        error: null,
      };
    }

    throw new Error(`Unexpected RPC ${name}`);
  }

  private controlFor(jid: string): FakeControl {
    const id = this.jidToControl.get(jid) ?? this.findControlByContactKey(jid);
    if (!id) throw new Error(`No control for ${jid}`);
    const control = this.controls.get(id);
    if (!control) throw new Error(`Missing control ${id}`);
    return control;
  }

  private attachJid(control: FakeControl, jid: string): void {
    if (!control.remoteJids.includes(jid)) control.remoteJids.push(jid);
    this.jidToControl.set(jid, control.id);
  }

  private findControlByContactKey(jid: string): string | undefined {
    const targetKey = contactKeyFromJid(jid);
    for (const control of this.controls.values()) {
      if (control.remoteJids.some((remoteJid) => contactKeyFromJid(remoteJid) === targetKey)) {
        return control.id;
      }
    }
    return undefined;
  }

  private snapshot(control: FakeControl): ConversationControlSnapshot {
    return {
      conversationControlId: control.id,
      mode: control.mode,
      epoch: control.epoch.toString(),
      remoteJids: [...control.remoteJids],
      changedAt: '2026-08-29T00:00:00.000Z',
    };
  }
}

function contactKeyFromJid(jid: string): string {
  let digits = jid.replace(/@.*$/, '').replace(/\D/g, '');
  if (digits.startsWith('55') && digits.length >= 12) digits = digits.slice(2);
  if (digits.length === 11 && digits[2] === '9') digits = `${digits.slice(0, 2)}${digits.slice(3)}`;
  return digits;
}

function makeRepo(): FakeRepo {
  const repo = new FakeRepo();
  repo.addControl({
    id: 'control-1',
    mode: 'ai',
    epoch: 7n,
    remoteJids: ['551499@s.whatsapp.net', '551498@s.whatsapp.net'],
    seenInboundIds: new Set(),
  });
  repo.addControl({
    id: 'control-2',
    mode: 'ai',
    epoch: 3n,
    remoteJids: ['551477@s.whatsapp.net'],
    seenInboundIds: new Set(),
  });
  return repo;
}

console.log('\nConversation control');

console.log('\nTest 1: human takeover pauses the canonical family and cancels queued AI');
{
  const repo = makeRepo();
  let cancelled = 0;
  const control = createConversationControl({
    rpc: repo.rpc.bind(repo),
    resolveFamilyJids: async () => ['551499@s.whatsapp.net', '551498@s.whatsapp.net'],
    cancelPendingReply: () => { cancelled += 1; },
  });

  const result = await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'zelochat_operator',
  });

  assert.equal(result.mode, 'human');
  assert.equal(result.epoch, '8');
  assert.equal(result.conversationControlId, 'control-1');
  assert.deepEqual(repo.updatedFamilyJids, ['551499@s.whatsapp.net', '551498@s.whatsapp.net']);
  assert.equal(repo.cancelledAiJobs, 2);
  assert.equal(cancelled, 2);
}

console.log('\nTest 2: repeated takeover is idempotent while already human');
{
  const repo = makeRepo();
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });
  await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'zelochat_operator',
  });
  const repeated = await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '551498@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'zelochat_operator',
  });

  assert.equal(repeated.mode, 'human');
  assert.equal(repeated.epoch, '8');
  assert.equal(repo.cancelledAiJobs, 2);
}

console.log('\nTest 3: resume explicitly returns the family to AI and advances epoch');
{
  const repo = makeRepo();
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });
  await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'explicit_manual_toggle',
  });
  const resumed = await control.resumeAiConversation({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    actorUserId: 'u1',
  });

  assert.equal(resumed.mode, 'ai');
  assert.equal(resumed.epoch, '9');
}

console.log('\nTest 4: duplicated inbound message does not advance epoch twice');
{
  const repo = makeRepo();
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });
  const first = await control.beginAiTurn({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    inboundMessageId: 'msg-1',
  });
  const duplicate = await control.beginAiTurn({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    inboundMessageId: 'msg-1',
  });

  assert.equal(first?.epoch, '8');
  assert.equal(duplicate?.epoch, '8');
  assert.equal(duplicate?.triggerMessageId, 'msg-1');
}

console.log('\nTest 5: RPC failures fail closed for AI permits');
{
  const repo = makeRepo();
  repo.fail('advance_zelochat_ai_epoch_for_inbound');
  repo.fail('check_zelochat_ai_epoch');
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });

  const permit = await control.beginAiTurn({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    inboundMessageId: 'msg-1',
  });
  assert.equal(permit, null);

  const current = await control.isAiPermitCurrent({
    empresaId: 'e1',
    conversationControlId: 'control-1',
    remoteJid: '551499@s.whatsapp.net',
    epoch: '8',
    triggerMessageId: 'msg-1',
  });
  assert.equal(current, false);
}

console.log('\nTest 6: a different conversation in the same tenant is not changed');
{
  const repo = makeRepo();
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });
  await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '551499@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'zelochat_operator',
  });
  const other = await control.beginAiTurn({
    empresaId: 'e1',
    remoteJid: '551477@s.whatsapp.net',
    inboundMessageId: 'msg-other',
  });

  assert.equal(other?.conversationControlId, 'control-2');
  assert.equal(other?.epoch, '4');
  assert.deepEqual(repo.controls.get('control-2')?.remoteJids, ['551477@s.whatsapp.net']);
}

console.log('\nTest 7: a new simultaneous JID variation inherits the canonical human control');
{
  const repo = new FakeRepo();
  repo.addControl({
    id: 'control-1',
    mode: 'ai',
    epoch: 7n,
    remoteJids: ['5511999999999@s.whatsapp.net'],
    seenInboundIds: new Set(),
  });
  const control = createConversationControl({ rpc: repo.rpc.bind(repo) });
  await control.claimHumanTakeover({
    empresaId: 'e1',
    remoteJid: '5511999999999@s.whatsapp.net',
    actorUserId: 'u1',
    source: 'zelochat_operator',
  });
  const ensured = await control.ensureConversationControl({
    empresaId: 'e1',
    remoteJid: '551199999999@s.whatsapp.net',
  });

  assert.equal(ensured.conversationControlId, 'control-1');
  assert.equal(ensured.mode, 'human');
  assert.equal(ensured.epoch, '8');
  assert.deepEqual(ensured.remoteJids, [
    '5511999999999@s.whatsapp.net',
    '551199999999@s.whatsapp.net',
  ]);
}

console.log('\nTest 8: numeric epochs from RPC responses are rejected');
{
  const control = createConversationControl({
    rpc: async () => ({
      data: {
        conversation_control_id: 'control-1',
        mode: 'ai',
        epoch: 8,
        remote_jids: ['551499@s.whatsapp.net'],
        changed_at: '2026-08-29T00:00:00.000Z',
      },
      error: null,
    }),
  });

  await assert.rejects(
    () => control.ensureConversationControl({
      empresaId: 'e1',
      remoteJid: '551499@s.whatsapp.net',
    }),
    /epoch/,
  );
}

console.log('\nTest 9: migration 064 exposes service-role-only canonical RPCs and review guardrails');
{
  const sql = readFileSync('supabase/migrations/064_conversation_control_rpcs.sql', 'utf8');
  const router = readFileSync('server/router.ts', 'utf8');
  assert.match(sql, /create or replace function public\.ensure_zelochat_conversation_control/i);
  assert.match(sql, /create or replace function public\.zelochat_lock_conversation_session_family/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /for v_identity_key in\s+select unnest\(v_identity_keys\) order by 1/is);
  assert.match(sql, /controls_merged/i);
  assert.match(sql, /controls_merged_active_job/i);
  assert.match(sql, /status = 'delivery_uncertain'/i);
  assert.match(sql, /status in \('sending','dispatch_started'\)/i);
  assert.match(sql, /pessoa_id = v_canonical_pessoa_id/i);
  assert.match(sql, /zelochat_conversation_identity_key\(null, s\.customer_phone, s\.remote_jid\) = v_target_contact_key/i);
  assert.match(sql, /zelochat_conversation_control_session_bridge/i);
  assert.match(sql, /legacy_auto_reply_update/i);
  assert.match(sql, /after insert or update of auto_reply/i);
  assert.match(sql, /MESSAGE_NOT_IN_TENANT/i);
  assert.match(sql, /ACTOR_NOT_IN_TENANT/i);
  assert.match(sql, /access_users/i);
  assert.match(sql, /create or replace function public\.advance_zelochat_ai_epoch_for_inbound/i);
  assert.match(sql, /create or replace function public\.pause_zelochat_ai_for_human/i);
  assert.match(sql, /create or replace function public\.resume_zelochat_ai/i);
  assert.match(sql, /create or replace function public\.check_zelochat_ai_epoch/i);
  assert.match(sql, /for update/i);
  assert.match(sql, /outbound_origin in \('ai_auto','ai_followup'\)/i);
  assert.doesNotMatch(sql, /grant execute on function .* to (anon|authenticated)/i);
  assert.match(sql, /grant execute on function .* to service_role/i);
  assert.match(router, /const access = await requireActorAccess\(req\);[\s\S]*setAutoReply\(req\.params\.jid, !!enabled, access\.empresaId, access\.actorUserId\)/i);
}

console.log('\nTest 10: migration 064 keeps rolling-deploy lock order session-first');
{
  const sql = readFileSync('supabase/migrations/064_conversation_control_rpcs.sql', 'utf8');

  const ensureStart = sql.indexOf('create or replace function public.ensure_zelochat_conversation_control');
  const ensureEnd = sql.indexOf('revoke all on function public.ensure_zelochat_conversation_control', ensureStart);
  assert.notEqual(ensureStart, -1);
  assert.notEqual(ensureEnd, -1);
  const ensureBody = sql.slice(ensureStart, ensureEnd);

  const sessionFamilyLock = ensureBody.indexOf('zelochat_lock_conversation_session_family');
  const advisoryLock = ensureBody.indexOf('pg_advisory_xact_lock');
  const controlRowLock = ensureBody.indexOf('LOCK ORDER STEP 3: control rows are locked last');
  assert.ok(sessionFamilyLock >= 0, 'ensure must lock the session family first');
  assert.ok(advisoryLock > sessionFamilyLock, 'ensure must take advisory locks after session locks');
  assert.ok(controlRowLock > advisoryLock, 'ensure must lock control rows after advisory locks');

  const bridgeStart = sql.indexOf('create or replace function public.zelochat_conversation_control_session_bridge');
  const bridgeEnd = sql.indexOf('revoke all on function public.zelochat_conversation_control_session_bridge', bridgeStart);
  assert.notEqual(bridgeStart, -1);
  assert.notEqual(bridgeEnd, -1);
  const bridgeBody = sql.slice(bridgeStart, bridgeEnd);

  const bridgeSessionLock = bridgeBody.indexOf('LOCK ORDER: bridge already holds NEW');
  const bridgeControlLock = bridgeBody.indexOf('from public.zelochat_conversation_ai_control c');
  assert.ok(bridgeSessionLock >= 0, 'legacy bridge must document the pre-held session row lock');
  assert.ok(bridgeControlLock > bridgeSessionLock, 'legacy bridge must lock session family before control rows');

  const lockHelperStart = sql.indexOf('create or replace function public.zelochat_lock_conversation_session_family');
  const lockHelperEnd = sql.indexOf('revoke all on function public.zelochat_lock_conversation_session_family', lockHelperStart);
  assert.notEqual(lockHelperStart, -1);
  assert.notEqual(lockHelperEnd, -1);
  const lockHelperBody = sql.slice(lockHelperStart, lockHelperEnd);
  assert.match(lockHelperBody, /order by s\.id\s+for update/is);
  assert.match(lockHelperBody, /s\.conversation_control_id = p_conversation_control_id/i);
}

console.log('\nConversation control tests passed');
