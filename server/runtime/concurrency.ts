/** Preserve order while keeping both successful and failing tasks inside the limit. */
export async function mapConcurrent<T, R>(items: T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const count = Number.isFinite(limit) ? Math.min(8, Math.max(1, Math.floor(limit))) : 1;
  const workers = await Promise.allSettled(Array.from({ length: Math.min(items.length, count) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  const failure = workers.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return results;
}
