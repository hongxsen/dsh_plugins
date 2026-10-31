/**
 * Tiny bounded-concurrency map used by the download pipeline.
 * Kept dependency-free and pure so it can be unit-tested directly.
 */

/**
 * Run an async worker over items with a concurrency limit.
 * @param items - input items.
 * @param limit - maximum workers, at least one.
 * @param worker - async `(item, index) => result`.
 * @returns results in input order.
 */
export async function runPool(items, limit, worker) {
  const list = Array.from(items)
  if (list.length === 0) return []
  const concurrency = Math.max(1, Math.min(Math.floor(limit) || 1, list.length))
  const results = new Array(list.length)
  let cursor = 0
  const run = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= list.length) return
      results[index] = await worker(list[index], index)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, run))
  return results
}
