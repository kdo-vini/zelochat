import assert from 'node:assert/strict';
import { registerOutboundWorkerWaker } from '../server/outbound/wake.js';
import {
  releaseStaleUncertainHolds,
  selectReleasableHolds,
  type ConversationHold,
  type HoldJobState,
  type UncertainHoldStore,
} from '../server/outbound/uncertainHoldRelease.js';

const now = new Date('2026-09-14T16:40:00.000Z');
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const GRACE = 3 * 60_000;

const hold = (controlId: string, holdJobId: string, holdReason: string | null = 'delivery_uncertain'): ConversationHold => ({
  controlId, empresaId: 'empresa-1', holdJobId, holdReason,
});

// The Bem Servido driver conversation: a 15 s provider timeout on 10/09 left a
// hold that blocked every later "Nova entrega" for four days.
{
  const holds = [
    hold('driver', 'job-timeout-4-days'),
    hold('fresh', 'job-uncertain-1-min'),
    hold('echo', 'job-awaiting-echo', 'from_me_pending_correlation'),
    hold('resolved', 'job-already-sent'),
    hold('orphan', 'job-deleted'),
  ];
  const jobs: HoldJobState[] = [
    { id: 'job-timeout-4-days', status: 'delivery_uncertain', updatedAt: minutesAgo(4 * 24 * 60) },
    { id: 'job-uncertain-1-min', status: 'delivery_uncertain', updatedAt: minutesAgo(1) },
    { id: 'job-awaiting-echo', status: 'dispatch_started', updatedAt: minutesAgo(60) },
    { id: 'job-already-sent', status: 'sent', updatedAt: minutesAgo(1) },
  ];
  assert.deepEqual(
    selectReleasableHolds(holds, jobs, now, GRACE).map((candidate) => candidate.controlId),
    ['driver', 'resolved', 'orphan'],
    'old uncertain holds and holds protecting nothing are released; fresh uncertainty and echo correlation are kept',
  );
  assert.deepEqual(
    selectReleasableHolds([hold('edge', 'job-edge')], [{ id: 'job-edge', status: 'delivery_uncertain', updatedAt: minutesAgo(3) }], now, GRACE).map((c) => c.controlId),
    ['edge'],
    'the grace period is inclusive',
  );
}

// End to end against a fake store: releases through the RPC, keeps going when
// one release fails, and wakes the worker so the queued messages go out now.
{
  const released: string[] = [];
  let listCalls = 0;
  const store: UncertainHoldStore = {
    listHolds: async () => { listCalls += 1; return [hold('driver', 'job-a'), hold('broken', 'job-b'), hold('fresh', 'job-c')]; },
    getJobs: async (ids) => {
      assert.deepEqual([...ids].sort(), ['job-a', 'job-b', 'job-c'], 'hold jobs are fetched once, deduplicated');
      return [
        { id: 'job-a', status: 'delivery_uncertain', updatedAt: minutesAgo(30) },
        { id: 'job-b', status: 'delivery_uncertain', updatedAt: minutesAgo(30) },
        { id: 'job-c', status: 'delivery_uncertain', updatedAt: minutesAgo(1) },
      ];
    },
    release: async (candidate) => {
      if (candidate.controlId === 'broken') throw new Error('rpc down');
      released.push(candidate.controlId);
      return null;
    },
  };
  let wakes = 0;
  registerOutboundWorkerWaker(() => { wakes += 1; });
  const count = await releaseStaleUncertainHolds(store, now, GRACE);
  assert.equal(listCalls, 1);
  assert.deepEqual(released, ['driver'], 'only the stale hold is released; a failing release does not stop the sweep');
  assert.equal(count, 1);
  assert.equal(wakes, 1, 'the worker is woken so messages behind the hold are claimed immediately');

  const idle = await releaseStaleUncertainHolds({ listHolds: async () => [], getJobs: async () => { throw new Error('no holds, no job lookup'); }, release: async () => null }, now, GRACE);
  assert.equal(idle, 0);
  assert.equal(wakes, 1, 'nothing released, no wake');
  registerOutboundWorkerWaker(null);
}

console.log('uncertainHoldRelease tests passed');
