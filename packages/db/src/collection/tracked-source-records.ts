import type {
  SubscribeTrackedSourceRecordsOptions,
  TrackedSourceRecord,
  TrackedSourceRecordsChange,
} from '../types.js'

type Entry<TKey> = { key: TKey; refCount: number }

/**
 * Per-base-collection tracked source records manager.
 *
 * Refcounts over active live queries that depend on this collection. Each
 * live query's aggregator pushes its net alias-level transitions here; this
 * manager dedupes across queries and emits to subscribers only on true 0↔1
 * transitions.
 */
export class TrackedSourceRecordsManager<
  TKey extends string | number = string | number,
> {
  // Keys are primitives; use them directly as the Map key. No serialization.
  private readonly entries = new Map<TKey, Entry<TKey>>()
  private readonly listeners = new Set<
    (change: TrackedSourceRecordsChange) => void
  >()

  constructor(private readonly collectionId: string) {}

  apply(added: Iterable<TKey>, removed: Iterable<TKey>): void {
    const netAdded: Array<TKey> = []
    const netRemoved: Array<TKey> = []

    for (const key of added) {
      const existing = this.entries.get(key)
      if (existing) {
        existing.refCount++
      } else {
        this.entries.set(key, { key, refCount: 1 })
        netAdded.push(key)
      }
    }

    for (const key of removed) {
      const existing = this.entries.get(key)
      if (!existing) continue
      if (existing.refCount === 1) {
        this.entries.delete(key)
        netRemoved.push(existing.key)
      } else {
        existing.refCount--
      }
    }

    if (netAdded.length === 0 && netRemoved.length === 0) return
    if (this.listeners.size === 0) return
    const change: TrackedSourceRecordsChange = {
      added: netAdded.map((key) => this.toRecord(key)),
      removed: netRemoved.map((key) => this.toRecord(key)),
    }
    for (const listener of this.listeners) listener(change)
  }

  get(): Array<TrackedSourceRecord> {
    return Array.from(this.entries.values(), ({ key }) => this.toRecord(key))
  }

  subscribe(
    callback: (change: TrackedSourceRecordsChange) => void,
    options?: SubscribeTrackedSourceRecordsOptions,
  ): () => void {
    this.listeners.add(callback)
    if (options?.includeInitialState && this.entries.size > 0) {
      callback({ added: this.get(), removed: [] })
    }
    return () => {
      this.listeners.delete(callback)
    }
  }

  private toRecord(key: TKey): TrackedSourceRecord {
    return { collectionId: this.collectionId, key }
  }
}
