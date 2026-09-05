/** Abort includes consumption of the response body, and preserves caller cancellation. */
export function createFetchWithDeadline(timeoutMs = 15_000): typeof fetch { return (input, init) => {
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
  const deadline = AbortSignal.timeout(timeoutMs);
  return globalThis.fetch(input, { ...init, signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline });
}; }
export const fetchWithDeadline = createFetchWithDeadline();
