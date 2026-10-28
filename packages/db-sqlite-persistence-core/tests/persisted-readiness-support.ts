import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../src/index.js'
import type { PersistenceAdapter } from '../src/index.js'
import type { SyncConfig } from '@tanstack/db'

// The controlled persistence adapter and network-first Collection that the
// persisted-readiness oracle drives, shared with its fixed examples in
// persisted-readiness.test.ts. They compare nothing.

export type Row = { id: string; value: string }
export type Restore = `rows` | `empty` | `failed`
// One adapter call. The calls of one event happen in the same tick.
export type Call = `ready` | `report` | `fail`

export const TIMEOUT = 100
export const DISK_ROW: Row = { id: `disk`, value: `restored` }
export const REMOTE_ROW: Row = { id: `remote`, value: `synced` }
export const RESTORE_FAILURE = `restore failed`
export const REMOTE_FAILURE = `remote gave up`
export const REMOTE_REPORT = `remote retrying`

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

// A persistence adapter whose restore read waits for the history to settle it.
export function controlledAdapter() {
  const load = deferred<ReadonlyArray<Row>>()
  void load.promise.catch(() => undefined)
  const adapter: PersistenceAdapter = {
    loadSubset: async () =>
      (await load.promise).map((value) => ({ key: value.id, value })),
    loadResumeSnapshot: async (_id, options) => {
      const rows = options?.includeRows === false ? [] : await load.promise
      return {
        rows: rows.map((value) => ({ key: value.id, value })),
        keySet: { status: `consistent` },
        collectionMetadata: [],
        latestTerm: 0,
        latestSeq: 0,
        latestRowVersion: 0,
        resetEpoch: 0,
      }
    },
    applyCommittedTx: async () => {},
    ensureIndex: async () => {},
  }
  return { adapter, load }
}

export function networkFirst(id: string, initialRender = true) {
  const fixture = controlledAdapter()
  let remote: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const collection = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence: { adapter: fixture.adapter },
      ...(initialRender
        ? {
            initialRender: {
              strategy: `network-first` as const,
              networkTimeoutMs: TIMEOUT,
            },
          }
        : {}),
      sync: {
        sync: (params) => {
          remote = params
        },
      },
    }),
  )
  return {
    collection,
    restore: (outcome: Restore) =>
      outcome === `failed`
        ? fixture.load.reject(new Error(RESTORE_FAILURE))
        : fixture.load.resolve(outcome === `rows` ? [DISK_ROW] : []),
    // One adapter call, as the remote makes it.
    call: (call: Call) => {
      if (call === `ready`) {
        remote!.begin()
        remote!.write({ type: `insert`, value: REMOTE_ROW })
        remote!.commit()
        remote!.markReady()
      } else if (call === `report`) {
        remote!.reportError(new Error(REMOTE_REPORT))
      } else {
        remote!.fail(new Error(REMOTE_FAILURE))
      }
    },
  }
}
