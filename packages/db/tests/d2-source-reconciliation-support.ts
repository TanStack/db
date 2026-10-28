// Shared fixtures for the D2 source reconciliation oracle and its ordinary tests.
import { expect } from 'vitest'
import { createCollection } from '../src/index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { flushPromises } from './utils.js'
import type { ChangeMessage, SyncConfig } from '../src/types.js'

export type SourceRow = {
  id: number
  revision: number
  value: number
}
export type SourceKey = string | number
export function rowIdentity(row: SourceRow): string {
  return `${row.id}:${row.revision}:${row.value}`
}
export function expectedWeightedRowIdentity(
  key: SourceKey,
  row: SourceRow,
): string {
  const sourceIdentity = [typeof key, String(key)].join(`:`)
  const payloadIdentity = [row.id, row.revision, row.value]
    .map(String)
    .join(`:`)
  return `${sourceIdentity}|${payloadIdentity}`
}
export function addWeight(
  relation: Map<string, number>,
  key: SourceKey,
  row: SourceRow,
  weight: 1 | -1,
): void {
  const identity = `${typeof key}:${String(key)}|${rowIdentity(row)}`
  const nextWeight = (relation.get(identity) ?? 0) + weight
  if (nextWeight === 0) relation.delete(identity)
  else relation.set(identity, nextWeight)
}

export type SourceSyncActions = Parameters<
  SyncConfig<SourceRow, number>[`sync`]
>[0]

export function createOrderedSourceHarness(
  id: string,
  autoIndex: `eager` | `off`,
) {
  // Intentional fault-injection boundary: substitute stale subscription events
  // while retaining the actual ordered Effect/live-query consumer. This does
  // not establish that a particular SDK emits these events naturally.
  // The Collection stays inert until initialize runs inside runWithCleanup;
  // source sync and consumer construction can then fail without losing cleanup.
  let sync!: SourceSyncActions
  let replayHeld = false
  const replayResolvers: Array<() => void> = []
  const contributed = { id: 1, revision: 1, value: 1 }
  const staleDelete = { id: 1, revision: 2, value: 1 }
  const replacement = { id: 1, revision: 3, value: 2 }
  const source = createCollection<SourceRow, number>({
    id,
    getKey: (row) => row.id,
    startSync: false,
    syncMode: `on-demand`,
    autoIndex,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (actions) => {
        sync = actions
        actions.markReady()
        return {
          loadSubset: () => {
            // Initial demand settles immediately on both routes. Truncate
            // replay demand remains held at the same public checkpoint.
            if (replayHeld) {
              return new Promise((resolve) => replayResolvers.push(resolve))
            }
            return true
          },
        }
      },
    },
  })
  let sourceCallback: Parameters<typeof source.subscribeChanges>[0] | undefined
  let suppressSourceChanges = false
  const settlePendingReplay = async () => {
    // Stop holding future acquisitions before releasing the current ones.
    // A graph continuation may request another page during this drain.
    replayHeld = false
    for (const resolve of replayResolvers.splice(0)) resolve()
    await flushPromises()
  }

  return {
    contributed,
    replacement,
    source,
    staleDelete,
    initialize: () => {
      const subscribeChanges = source.subscribeChanges.bind(source)
      source.subscribeChanges = ((callback, options) => {
        sourceCallback = callback
        return subscribeChanges((changes) => {
          if (!suppressSourceChanges) callback(changes)
        }, options)
      }) as typeof source.subscribeChanges
      source.startSyncImmediate()
      sync.begin()
      sync.write({ type: `insert`, value: contributed })
      expect(sync.commit()).toBe(true)
    },
    suppressSourceChanges: () => {
      suppressSourceChanges = true
    },
    publish: (changes: Array<ChangeMessage<SourceRow, number>>) => {
      if (sourceCallback === undefined) {
        throw new Error(`Query did not subscribe to its source`)
      }
      const publish = sourceCallback as unknown as (
        messages: Array<ChangeMessage<SourceRow, number>>,
      ) => void
      publish(changes)
    },
    truncate: () => {
      replayHeld = true
      sync.begin()
      sync.truncate()
      expect(sync.commit()).toBe(true)
    },
    pendingReplayCount: () => replayResolvers.length,
    settlePendingReplay,
    resolveReplay: async () => {
      if (replayResolvers.length === 0) {
        throw new Error(`No truncate replay is pending`)
      }
      await settlePendingReplay()
    },
  }
}

export async function runWithCleanup(
  check: () => Promise<void>,
  cleanups: ReadonlyArray<{
    resource: string
    release: () => void | Promise<void>
  }>,
): Promise<void> {
  let failed = false
  let primaryFailure: unknown
  try {
    await check()
  } catch (error) {
    failed = true
    primaryFailure = error
  }

  const cleanupFailures: Array<Error> = []
  for (const { resource, release } of cleanups) {
    try {
      await release()
    } catch (error) {
      cleanupFailures.push(
        new Error(`D2 oracle ${resource} cleanup failed`, { cause: error }),
      )
    }
  }

  if (failed && cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `D2 oracle cleanup failed`, {
      cause: primaryFailure,
    })
  }
  if (failed) throw primaryFailure
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `D2 oracle cleanup failed`)
  }
}
