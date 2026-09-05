const active = new Set<Promise<unknown>>();
let stopping = false;
export function isShuttingDown(): boolean { return stopping; }
export function beginShutdown(): void { stopping = true; }

/** Observe detached work so a deploy can await it without changing its result. */
export function trackBackgroundWork<T>(work: Promise<T>): Promise<T> {
  active.add(work);
  void work.finally(() => active.delete(work)).catch(() => {});
  return work;
}
export async function drainBackgroundWork(): Promise<void> {
  while (active.size) await Promise.allSettled([...active]);
}
