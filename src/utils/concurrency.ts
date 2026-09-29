/**
 * Runs `worker` for each item with at most `limit` calls in flight at once.
 * Results keep the order of `items`; the first error raised rejects the
 * returned promise (in-flight work settles, no further items are started).
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('mapWithConcurrency: limit must be an integer >= 1');
  }

  const results: R[] = new Array<R>(items.length);
  const errors: unknown[] = [];
  let nextIndex = 0;

  const run = async (): Promise<void> => {
    while (errors.length === 0 && nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        errors.push(error);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));

  if (errors.length > 0) throw errors[0];
  return results;
}
