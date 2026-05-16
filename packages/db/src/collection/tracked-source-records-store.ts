import type { TrackedSourceRecordsManager } from './tracked-source-records.js'

const trackedSourceRecordsManagers = new WeakMap<
  object,
  TrackedSourceRecordsManager
>()

export function registerTrackedSourceRecordsManager(
  collection: object,
  manager: TrackedSourceRecordsManager,
): void {
  trackedSourceRecordsManagers.set(collection, manager)
}

export function applyTrackedSourceRecordDelta(
  collection: object | undefined,
  added: Iterable<string | number>,
  removed: Iterable<string | number>,
): void {
  if (!collection) return
  trackedSourceRecordsManagers.get(collection)?.apply(added, removed)
}
