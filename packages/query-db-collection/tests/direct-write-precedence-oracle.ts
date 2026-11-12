/**
 * A complete fetched result supplies untouched keys. An accepted direct write
 * authored after that fetch started supplies its own key, including absence
 * after deletion. A later physical fetch may replace that write. Authority:
 * query-collection.md, Direct Writes and Query Sync. This is the ownership
 * oracle's existing overlay judgment, shared with its persisted receivers.
 * It models authored rows and writes, never Query generations or cache events.
 */

export type MergeRow<Value = string> = { id: string; value: Value }
export type PrecedenceWrite<Value> =
  MergeRow<Value> | { id: string; deleted: true }

export function mergeDirectWritesOverFetch<Value>(
  fetched: Array<MergeRow<Value>>,
  writes: Array<PrecedenceWrite<Value>>,
): Record<string, Value> {
  const rows = new Map(fetched.map((row) => [row.id, row]))
  for (const row of writes) {
    if (`deleted` in row) rows.delete(row.id)
    else rows.set(row.id, row)
  }
  return Object.fromEntries(
    [...rows.values()].map((row) => [row.id, row.value]),
  )
}
