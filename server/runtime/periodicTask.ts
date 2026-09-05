export interface PeriodicTask {
  stop(): Promise<void>;
}

/** Delay is measured after completion: a slow cycle never overlaps its successor. */
export function createPeriodicTask(
  run: () => Promise<unknown>,
  { intervalMs, initialDelayMs = intervalMs, onError = console.error }: {
    intervalMs: number;
    initialDelayMs?: number;
    onError?: (error: unknown) => void;
  },
): PeriodicTask {
  let stopped = false;
  let active: Promise<unknown> | undefined;
  let timer: ReturnType<typeof setTimeout>;
  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      active = Promise.resolve().then(run).catch(onError).finally(() => {
        active = undefined;
        if (!stopped) schedule(intervalMs);
      });
    }, delay);
    timer.unref?.();
  };
  schedule(initialDelayMs);
  return { async stop() { stopped = true; clearTimeout(timer); await active; } };
}

const tasks = new Map<string, PeriodicTask>();
let shuttingDown = false;
export function startPeriodicTask(name: string, run: () => Promise<unknown>, initialDelayMs: number, intervalMs: number): void {
  if (shuttingDown || tasks.has(name)) return;
  tasks.set(name, createPeriodicTask(run, {
    initialDelayMs, intervalMs,
    onError: (error) => console.error(`[${name}] cycle failed`, error instanceof Error ? error.message : 'unknown'),
  }));
}
export async function stopPeriodicTask(name: string): Promise<void> {
  const task = tasks.get(name);
  tasks.delete(name);
  await task?.stop();
}
export async function stopPeriodicTasks(): Promise<void> {
  shuttingDown = true;
  const results = await Promise.allSettled([...tasks.values()].map((task) => task.stop()));
  tasks.clear();
  const failed = results.find((result) => result.status === 'rejected');
  if (failed?.status === 'rejected') throw failed.reason;
}
