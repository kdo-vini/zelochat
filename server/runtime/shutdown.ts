import type { Server } from 'node:http';
import type { Socket } from 'node:net';

/** Stops accepting requests immediately; bounds draining without retrying work. */
export function installShutdown(server: Server, options: {
  stop: () => Promise<unknown>;
  drain?: () => Promise<unknown>;
  closeConnections: () => void;
  timeoutMs?: number;
  exit?: (code: number) => void;
}) {
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  const exit = options.exit ?? ((code: number) => process.exit(code));
  let completion: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    if (completion) return completion;
    completion = (async () => {
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<number>((resolve) => { timer = setTimeout(() => resolve(1), options.timeoutMs ?? 55_000); });
      const drained = Promise.allSettled([
        new Promise<void>((resolve) => server.close(() => resolve())),
        Promise.resolve().then(options.stop),
        Promise.resolve().then(options.closeConnections),
        Promise.resolve().then(() => server.closeIdleConnections()),
      ]);
      const outcome = await Promise.race([
        drained.then(async (results) => {
          // A request admitted before server.close may start detached work late.
          // Inspect the background registry only after those requests finish.
          await options.drain?.();
          return results.every((result) => result.status === 'fulfilled') ? 0 : 1;
        }).catch(() => 1),
        deadline,
      ]);
      clearTimeout(timer!);
      for (const socket of sockets) socket.destroy();
      console.log(`[shutdown] ${outcome === 0 ? 'drained' : 'deadline or drain failure'}`);
      exit(outcome);
    })();
    return completion;
  };
  const onSignal = () => { void shutdown(); };
  process.once('SIGTERM', onSignal);
  process.once('SIGINT', onSignal);
  return { shutdown, dispose() { process.off('SIGTERM', onSignal); process.off('SIGINT', onSignal); } };
}
