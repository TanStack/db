import type { Collection } from '../../collection/index.js'
import type {
  TrackedSourceRecord,
  TrackedSourceRecordsChange,
} from '../../types.js'

type Entry = { refCount: number }

/**
 * Per-live-query aggregator for tracked source records.
 *
 * Lives on a single sync session — dies with it. Refcounts over aliases
 * within one query (a self-join references the same base collection under
 * multiple aliases, so the same (collectionId, key) pair can be added
 * multiple times). Net 0↔1 transitions are:
 *   1. propagated to each source collection's `_trackedSourceRecords`
 *      manager (so consumers reading the base-collection view see them)
 *   2. fanned out to `listeners` (so consumers reading the per-query view
 *      via `liveQuery.subscribeTrackedSourceRecords` see them)
 *
 * `listeners` is held by reference. The builder owns a long-lived listener
 * Set that survives sync sessions; aggregator instances come and go but the
 * Set persists, so external subscribers don't need to re-attach across
 * session boundaries.
 *
 * `exposed` gates both propagation and listener fan-out: only emit while
 * the live query has active subscribers. Flipping `exposed` replays the
 * current snapshot as added/removed so downstream views stay consistent.
 */
export class LiveQueryTrackedSourceRecordsAggregator {
  // Nested map avoids serializing (collectionId, key) composites. Outer key
  // is collectionId; inner key is the source record's key (primitive).
  private readonly entries = new Map<string, Map<string | number, Entry>>()
  private exposed = false

  constructor(
    private readonly sourceCollections: Record<
      string,
      Collection<any, any, any>
    >,
    private readonly listeners: ReadonlySet<
      (change: TrackedSourceRecordsChange) => void
    >,
  ) {}

  /**
   * Record a membership change from one `CollectionSubscriber`. All keys in
   * a single call share the same collectionId, so propagation to the source
   * collection's manager is a direct call — no grouping needed.
   */
  apply(
    collectionId: string,
    added: Iterable<string | number>,
    removed: Iterable<string | number>,
  ): void {
    let byKey = this.entries.get(collectionId)
    if (!byKey) {
      byKey = new Map()
      this.entries.set(collectionId, byKey)
    }

    const netAdded: Array<string | number> = []
    const netRemoved: Array<string | number> = []

    for (const key of added) {
      const existing = byKey.get(key)
      if (existing) {
        existing.refCount++
      } else {
        byKey.set(key, { refCount: 1 })
        netAdded.push(key)
      }
    }

    for (const key of removed) {
      const existing = byKey.get(key)
      if (!existing) continue
      if (existing.refCount === 1) {
        byKey.delete(key)
        netRemoved.push(key)
      } else {
        existing.refCount--
      }
    }

    // Drop an emptied bucket so `entries.size === 0` correctly reflects
    // "nothing tracked" for setExposed.
    if (byKey.size === 0) {
      this.entries.delete(collectionId)
    }

    if (!this.exposed) return
    if (netAdded.length === 0 && netRemoved.length === 0) return

    this.sourceCollections[collectionId]?._trackedSourceRecords.apply(
      netAdded,
      netRemoved,
    )
    if (this.listeners.size === 0) return
    const change: TrackedSourceRecordsChange = {
      added: netAdded.map((key) => ({ collectionId, key })),
      removed: netRemoved.map((key) => ({ collectionId, key })),
    }
    for (const listener of this.listeners) listener(change)
  }

  setExposed(exposed: boolean): void {
    if (this.exposed === exposed) return
    this.exposed = exposed
    if (this.entries.size === 0) return

    const hasListeners = this.listeners.size > 0
    const added: Array<TrackedSourceRecord> = []
    const removed: Array<TrackedSourceRecord> = []
    for (const [collectionId, byKey] of this.entries) {
      const keys = Array.from(byKey.keys())
      const collection = this.sourceCollections[collectionId]
      if (exposed) {
        collection?._trackedSourceRecords.apply(keys, [])
        if (hasListeners) {
          for (const key of keys) added.push({ collectionId, key })
        }
      } else {
        collection?._trackedSourceRecords.apply([], keys)
        if (hasListeners) {
          for (const key of keys) removed.push({ collectionId, key })
        }
      }
    }

    if (!hasListeners) return
    const change: TrackedSourceRecordsChange = { added, removed }
    for (const listener of this.listeners) listener(change)
  }

  snapshot(): Array<TrackedSourceRecord> {
    if (!this.exposed) return []
    const records: Array<TrackedSourceRecord> = []
    for (const [collectionId, byKey] of this.entries) {
      for (const key of byKey.keys()) records.push({ collectionId, key })
    }
    return records
  }
}
