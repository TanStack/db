/**
 * The source Collections and observed-query types that the source failure and
 * health oracle (source-health-oracle.test.ts) and its ordinary fixed tests
 * (source-health.test.ts) share. The driver controls one source Collection's
 * sync run, its adapter cleanup, and when its run calls `markReady()`.
 */
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import type { Collection } from '../src/collection/index.js'
import type { SyncConfig } from '../src/types.js'

// `tag` names the write that produced a row, so a read shows which write
// (and so which sync run) the row came from.
export type Row = { id: number; parentId: number; tag?: number }
export type SyncParams = Parameters<SyncConfig<Row, number>[`sync`]>[0]
export type SourceName = `A` | `B`

export function createSource(name: SourceName) {
  let params: SyncParams | undefined
  let failNextCleanup = false
  // A held adapter cleanup stays pending until the driver settles it.
  let held: ReturnType<typeof createDeferred<void>> | undefined
  // The next cleanup, a reload's retired run's, stays pending until the
  // driver rejects it.
  let holdNextCleanup = false
  let retiredHeld: ReturnType<typeof createDeferred<void>> | undefined
  // The next sync run calls markReady() inside sync().
  let readyInSync = false
  // Sync runs the adapter was asked to start, and those whose cleanup it was
  // asked to run: the difference is the runs still live at the adapter.
  const runs = { started: 0, ended: 0 }
  const collection = createCollection<Row, number>({
    id: `health-oracle-${name}-${Math.random().toString(36).slice(2)}`,
    getKey: (row) => row.id,
    startSync: false,
    gcTime: 0,
    sync: {
      sync: (next) => {
        params = next
        runs.started++
        if (readyInSync) {
          readyInSync = false
          next.markReady()
        }
        return () => {
          runs.ended++
          if (held) return held.promise
          if (holdNextCleanup) {
            holdNextCleanup = false
            retiredHeld ??= createDeferred<void>()
            return retiredHeld.promise
          }
          if (!failNextCleanup) return
          failNextCleanup = false
          return Promise.reject(new Error(`${name} cleanup failed`))
        }
      },
    },
  })
  return {
    collection,
    liveRuns: () => runs.started - runs.ended,
    failNextCleanup: (armed = true) => {
      failNextCleanup = armed
    },
    holdNextCleanup: (armed = true) => {
      holdNextCleanup = armed
    },
    markReadyInNextSync: (armed = true) => {
      readyInSync = armed
    },
    rejectRetiredCleanup: () => {
      retiredHeld?.reject(new Error(`${name} cleanup failed`))
      retiredHeld = undefined
    },
    holdCleanup: () => {
      held ??= createDeferred<void>()
    },
    settleCleanup: () => {
      held?.resolve()
      held = undefined
    },
    get params(): SyncParams {
      if (!params) throw new Error(`source ${name} has not started`)
      return params
    },
  }
}

// The observed query and how the driver starts and measures it. A live-query
// Collection starts with a preload; a pooled view starts when it has a
// subscriber, as an observer would subscribe.
export type Subject = {
  query: Pick<Collection<any, any>, `status` | `health` | `on` | `cleanup`>
  inner?: Collection<any, any>
  start: () => void
  size: () => number
}

export type PooledView = Subject[`query`] & {
  subscribeChanges: (listener: () => void) => { unsubscribe: () => void }
  entries: () => Iterable<unknown>
}
