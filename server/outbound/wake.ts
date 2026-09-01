// Wake hook for the outbound worker.
//
// The worker polls `claim_zelochat_outbound_job` slowly while idle (see
// OUTBOUND_WORKER_IDLE_INTERVAL_MS) to keep Supabase API egress low. Whenever
// this process enqueues a job it calls `wakeOutboundWorker()` so the job is
// claimed immediately instead of waiting for the next idle poll. Human sends
// block on the job reaching a terminal state (CONVERSATION_SEND_WAIT_MS), so
// every enqueue path in this process must wake the worker.
//
// This module has no imports on purpose: it can be pulled in from any enqueue
// site without creating import cycles with worker.ts.

type Waker = () => void;

let waker: Waker | null = null;

export function registerOutboundWorkerWaker(fn: Waker | null): void {
  waker = fn;
}

export function wakeOutboundWorker(): void {
  if (!waker) return;
  try {
    waker();
  } catch (error) {
    console.warn('[outbound] wake failed', error instanceof Error ? error.message : 'unknown');
  }
}
