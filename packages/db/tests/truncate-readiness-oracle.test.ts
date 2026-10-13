/**
 * Replacement rows and readiness are independent sync observations. A truncate
 * promises readiness by default; markReady:false preserves the current status.
 * This owner supplies the core boundary required by the IndexedDB retirement
 * model. It does not change the optimistic history model's row/settlement laws.
 *
 * The reference fold is a sequence of authored replacements and status signals.
 * Every last truncate in one source transaction supplies that replacement's
 * readiness intent. Repeated transactions compose in publication order. We
 * cross initial loading/ready, all two-truncate intent pairs, and a held
 * optimistic transaction. Checks run inside public notifications as well as
 * after commit, so transient false readiness cannot hide behind a later status.
 *
 * An initial error is final for its sync attempt, so a replacement that
 * promises readiness after it is a contract violation and throws. Only a
 * restart begins a new attempt.
 */
import { expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { InvalidCollectionStatusTransitionError } from '../src/errors.js'
import type { SyncConfig } from '../src/types.js'

type Row = { id: number; value: string }
type Sync = Parameters<SyncConfig<Row, number>['sync']>[0]
type Intent = undefined | boolean
const intents: Array<Intent> = [undefined, true, false]
const cells = (['loading', 'ready'] as const).flatMap((status) =>
  [false, true].flatMap((held) =>
    intents.flatMap((first) =>
      intents.map((last) => ({ status, held, first, last })),
    ),
  ),
)
it.each(cells)(
  'replacement readiness follows the final authored intent: %j',
  async ({ status, held, first, last }) => {
    let sync!: Sync
    const finish = createDeferred<void>()
    const c = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      gcTime: Infinity,
      sync: {
        sync: (params) => {
          sync = params
        },
      },
      onInsert: () => finish.promise,
    })
    const observed: Array<string> = []
    const stop = c.subscribeChanges(() => {
      observed.push(c.status)
    })
    c.on('status:change', ({ status: next }) => {
      observed.push(next)
    })
    try {
      sync.begin()
      sync.write({ type: 'insert', value: { id: 1, value: 'initial' } })
      sync.commit()
      if (status === 'ready') sync.markReady()
      // Loading admits edits after sync entry.
      const optimistic = held
        ? c.insert({ id: 9, value: 'optimistic' })
        : undefined
      observed.length = 0
      // Structural callable widening makes the pre-fix run reach assertions:
      // an ignored option is a semantic failure, never a compiler-error witness.
      const truncate: (options?: { markReady?: boolean }) => void =
        sync.truncate
      sync.begin()
      truncate(first === undefined ? undefined : { markReady: first })
      sync.write({ type: 'insert', value: { id: 2, value: 'discarded' } })
      truncate(last === undefined ? undefined : { markReady: last })
      sync.write({ type: 'insert', value: { id: 3, value: 'replacement' } })
      const receipt = sync.commit()
      const expectedStatus = last === false ? status : 'ready'
      expect.soft(c.status).toBe(expectedStatus)
      expect
        .soft(
          observed.every((value) => value === expectedStatus),
          'status at publication',
        )
        .toBe(true)
      expect(
        [...c.base.values()].map((row) => ({ id: row.id, value: row.value })),
      ).toEqual([{ id: 3, value: 'replacement' }])
      await receipt
      if (held) expect(c.get(9)?.value).toBe('optimistic')
      finish.resolve()
      await optimistic?.isPersisted.promise
      expect.soft(c.status).toBe(expectedStatus)
      // A later independent ordinary replacement is ready.
      sync.begin()
      sync.truncate()
      sync.commit()
      expect(c.status).toBe('ready')
      expect(c.size).toBe(0)
    } finally {
      finish.resolve()
      stop.unsubscribe()
      await c.cleanup()
    }
  },
)

it.each(intents)(
  'rejects a ready-promising replacement after the initial error: markReady %s',
  async (markReady) => {
    let sync!: Sync
    const c = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      gcTime: Infinity,
      sync: {
        sync: (params) => {
          sync = params
        },
      },
    })
    try {
      sync.markError(new Error('initial sync failed'))
      sync.begin()
      sync.truncate(markReady === undefined ? undefined : { markReady })
      sync.write({ type: 'insert', value: { id: 1, value: 'late' } })
      if (markReady === false) {
        // A replacement that keeps the status leaves the attempt in error.
        sync.commit()
      } else {
        expect(() => sync.commit()).toThrow(
          InvalidCollectionStatusTransitionError,
        )
      }
      expect(c.status).toBe('error')
    } finally {
      await c.cleanup()
    }
  },
)

// Reentrant commits queue behind the publication currently notifying observers.
// Their final replacement determines the next published batch, including its
// readiness intent. An earlier replaced snapshot must not make that batch ready.
// The Collection starts loading, so only a replacement can make it ready.
it.each(intents.flatMap((first) => intents.map((last) => ({ first, last }))))(
  'composes readiness of reentrant replacement batches: %j',
  async ({ first, last }) => {
    let sync!: Sync
    const c = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      gcTime: Infinity,
      sync: {
        sync: (params) => {
          sync = params
        },
      },
    })
    let entered = false
    const receipts: Array<ReturnType<Sync['commit']>> = []
    const statuses: Array<string> = []
    c.on('status:change', ({ status }) => {
      statuses.push(status)
    })
    const subscription = c.subscribeChanges(() => {
      if (entered) return
      entered = true
      for (const [index, markReady] of [first, last].entries()) {
        sync.begin()
        sync.truncate(markReady === undefined ? undefined : { markReady })
        sync.write({
          type: 'insert',
          value: { id: index + 2, value: 'replacement' },
        })
        receipts.push(sync.commit())
      }
    })
    try {
      sync.begin()
      sync.write({ type: 'insert', value: { id: 1, value: 'trigger' } })
      sync.commit()
      await Promise.all(receipts)
      expect(entered).toBe(true)
      expect(c.status).toBe(last === false ? 'loading' : 'ready')
      expect(statuses).toEqual(last === false ? [] : ['ready'])
      expect([...c.keys()]).toEqual([3])
    } finally {
      subscription.unsubscribe()
      await c.cleanup()
    }
  },
)
