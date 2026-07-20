import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from './utils.js'
import type { ChangeMessage } from '../src/types.js'

interface Row {
  id: string
  name: string
}

const SEED: Array<Row> = [
  { id: `1`, name: `A` },
  { id: `2`, name: `B` },
]

let seq = 0
function makeSource(data: Array<Row> = SEED) {
  return createCollection(
    mockSyncCollectionOptions<Row>({
      id: `observer-test-${seq++}`,
      getKey: (r) => r.id,
      initialData: data,
    }),
  )
}

/** A collection that is syncing but not yet ready, with a manual `markReady`. */
function makeLoadingSource() {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<Row>({
      id: `observer-loading-${seq++}`,
      getKey: (r) => r.id,
    }),
  )
  collection.startSyncImmediate()
  return collection
}

/** An on-demand collection whose sync exposes a loadSubset spy. */
function makeLoadSubsetSource() {
  const loadSubsetCalls: Array<unknown> = []
  let writeRow: (type: `insert` | `delete`, row: Row) => void
  const collection = createCollection<Row, string>({
    id: `observer-loadsubset-${seq++}`,
    getKey: (r) => r.id,
    startSync: false,
    syncMode: `on-demand`,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const row of SEED) write({ type: `insert`, value: row })
        commit()
        markReady()
        writeRow = (type, row) => {
          begin()
          write({ type, value: row })
          commit()
        }
        return {
          loadSubset: (options: unknown) => {
            loadSubsetCalls.push(options)
            return true as const
          },
        }
      },
    },
  })
  return {
    collection,
    loadSubsetCalls,
    writeRow: (type: `insert` | `delete`, row: Row) => writeRow(type, row),
  }
}

describe(`createLiveQueryObserver`, () => {
  it(`exposes a stable snapshot of a ready collection (wholesale path)`, () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any)

    const snap = observer.getSnapshot()
    expect(snap.isEnabled).toBe(true)
    expect(snap.isReady).toBe(true)
    expect(snap.status).toBe(`ready`)
    expect(snap.data).toHaveLength(2)
    expect(snap.state?.get(`1`)).toMatchObject({ name: `A` })
    // Same identity when nothing changed.
    expect(observer.getSnapshot()).toBe(snap)
    observer.dispose()
  })

  it(`delivers initial state then change deltas to subscribers (granular path)`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    const deltas: Array<ChangeMessage<Row, string>> = []
    const unsub = observer.subscribe((changes) => {
      if (changes) deltas.push(...changes)
    })
    // Initial rows arrive synchronously as inserts (includeInitialState).
    expect(
      deltas
        .filter((c) => c.type === `insert`)
        .map((c) => c.key)
        .sort(),
    ).toEqual([`1`, `2`])

    const before = observer.getSnapshot()
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `3`, name: `C` } })
    source.utils.commit()

    // Subsequent deltas keep flowing synchronously...
    expect(deltas.some((c) => c.type === `insert` && c.key === `3`)).toBe(true)
    // ...and wholesale consumers see a fresh, updated snapshot.
    const after = observer.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.data).toHaveLength(3)

    unsub()
    observer.dispose()
  })

  it(`stops notifying after unsubscribe / dispose`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    let count = 0
    const unsub = observer.subscribe(() => {
      count++
    })
    unsub()
    const countAfterUnsub = count // initial-state notify may have fired

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `9`, name: `Z` } })
    source.utils.commit()

    // No further notifications after unsubscribe.
    expect(count).toBe(countAfterUnsub)
    observer.dispose()
  })

  it(`represents a disabled query (null collection)`, () => {
    const observer = createLiveQueryObserver<Row, string>(null)
    const snap = observer.getSnapshot()
    expect(snap.isEnabled).toBe(false)
    expect(snap.status).toBe(`disabled`)
    expect(snap.data).toBeUndefined()
    expect(snap.state).toBeUndefined()
    observer.dispose()
  })

  it(`delivers nothing synchronously during a wholesale subscribe`, () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any, {
      mode: `wholesale`,
    })
    let notified = false
    observer.subscribe(() => {
      notified = true
    })
    // No bootstrap replay in wholesale mode: useSyncExternalStore-style
    // consumers are never notified inside their own subscribe call.
    expect(notified).toBe(false)
    expect(observer.getSnapshot().data).toHaveLength(2)
    observer.dispose()
  })

  it(`delivers events in commit order — no notify can overtake an older one`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    const order: Array<string> = []
    observer.subscribe((changes) => {
      for (const c of changes ?? []) order.push(`${c.type}:${c.key}`)
    })
    order.length = 0 // drop the bootstrap

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `v1`, name: `V1` } })
    source.utils.commit()
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `v2`, name: `V2` } })
    source.utils.commit()

    expect(order).toEqual([`insert:v1`, `insert:v2`])
    observer.dispose()
  })

  it(`fires the ready notify once after unsubscribe-before-ready then resubscribe`, () => {
    const collection = makeLoadingSource()
    const observer = createLiveQueryObserver<Row, string>(collection as any)

    // Subscribe then unsubscribe while still loading — this registers an
    // onFirstReady callback that detach() can't remove.
    observer.subscribe(() => {})()

    let readyNotifications = 0
    observer.subscribe((changes) => {
      if (changes === undefined) readyNotifications++
    })

    collection.utils.markReady()

    // Only the current subscription's ready callback should fire, not the
    // stale one left behind by the first (already unsubscribed) attach.
    expect(readyNotifications).toBe(1)
    observer.dispose()
  })

  it(`a resubscribe before a microtask cannot leak a stale bootstrap`, async () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any)

    // Subscribe then unsubscribe immediately, then resubscribe. All delivery
    // is synchronous now, so nothing deferred can flush later.
    observer.subscribe(() => {})()

    let notifications = 0
    observer.subscribe(() => {
      notifications++
    })
    expect(notifications).toBe(1) // the synchronous bootstrap replay
    await Promise.resolve()
    expect(notifications).toBe(1) // and nothing else afterwards
    observer.dispose()
  })

  it(`dispatches nested publications FIFO, never reentrantly`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    // Listener A reacts to the insert of row 3 by synchronously deleting it —
    // a nested publication while the insert is still being delivered.
    observer.subscribe((changes) => {
      if (changes?.some((c) => c.type === `insert` && c.key === `3`)) {
        source.utils.begin()
        source.utils.write({ type: `delete`, value: { id: `3`, name: `C` } })
        source.utils.commit()
      }
    })

    const listenerBEvents: Array<string> = []
    observer.subscribe((changes) => {
      for (const c of changes ?? []) {
        if (c.key === `3`) listenerBEvents.push(c.type)
      }
    })

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `3`, name: `C` } })
    source.utils.commit()

    // B must observe the insert before the (nested) delete.
    expect(listenerBEvents).toEqual([`insert`, `delete`])
    observer.dispose()
  })

  it(`does not deliver an in-flight publication to a listener added during dispatch`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    let lateListenerRow4Deliveries = 0
    observer.subscribe((changes) => {
      // Add the late listener only while the row-4 delta is being dispatched.
      if (changes?.some((c) => c.key === `4`)) {
        observer.subscribe((lateChanges) => {
          if (lateChanges?.some((c) => c.key === `4`)) {
            lateListenerRow4Deliveries++
          }
        })
      }
    })

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `4`, name: `D` } })
    source.utils.commit()

    // The late subscriber receives row 4 exactly once — via its seed of the
    // already-committed state, NOT additionally via the in-flight publication.
    expect(lateListenerRow4Deliveries).toBe(1)
    observer.dispose()
  })

  it(`still delivers the in-flight publication to a listener removed during dispatch`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    let row5Deliveries = 0
    let unsubB: (() => void) | null = null
    observer.subscribe(() => {
      unsubB?.()
      unsubB = null
    })
    unsubB = observer.subscribe((changes) => {
      if (changes?.some((c) => c.key === `5`)) row5Deliveries++
    })

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `5`, name: `E` } })
    source.utils.commit()

    // A removed B while the publication was in flight; B still receives it.
    expect(row5Deliveries).toBe(1)
    observer.dispose()
  })

  it(`treats two subscriptions with the same callback as independent`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    let calls = 0
    const shared = () => {
      calls++
    }
    const unsubFirst = observer.subscribe(shared)
    const unsubSecond = observer.subscribe(shared)

    unsubFirst()
    calls = 0
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `6`, name: `F` } })
    source.utils.commit()

    // The second subscription survives the first one's teardown.
    expect(calls).toBe(1)
    unsubSecond()

    calls = 0
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `7`, name: `G` } })
    source.utils.commit()
    expect(calls).toBe(0)
    observer.dispose()
  })

  it(`releases the collection subscription when a listener disposes during initial replay`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    // The initial-state replay is delivered synchronously inside subscribe();
    // disposing from the listener must not leak the collection subscription.
    observer.subscribe(() => observer.dispose())

    expect(source.subscriberCount).toBe(0)
  })

  it(`seeds a second concurrent subscriber with the current rows`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    observer.subscribe(() => {})

    // The attach (and its initial-state replay) already happened; a late
    // subscriber must still receive the current rows as inserts.
    const secondSubscriberKeys: Array<string> = []
    observer.subscribe((changes) => {
      for (const c of changes ?? []) {
        if (c.type === `insert`) secondSubscriberKeys.push(c.key)
      }
    })

    expect(secondSubscriberKeys.sort()).toEqual([`1`, `2`])
    observer.dispose()
  })

  it(`throws when subscribing after dispose`, () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any)
    observer.dispose()
    expect(() => observer.subscribe(() => {})).toThrow(
      /disposed LiveQueryObserver/,
    )
  })

  it(`preserves snapshot identity across subscribe/unsubscribe cycles`, () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any)

    const before = observer.getSnapshot()
    observer.subscribe(() => {})()
    observer.subscribe(() => {})()

    // Bootstrap replay is per-subscriber delivery, not a semantic revision:
    // nothing observable changed, so the snapshot identity must not change.
    expect(observer.getSnapshot()).toBe(before)
    observer.dispose()
  })

  it(`emits exactly one post-bootstrap notification for a readiness transition`, () => {
    const collection = makeLoadingSource()
    const observer = createLiveQueryObserver<Row, string>(collection as any)

    const events: Array<unknown> = []
    observer.subscribe((changes) => events.push(changes))

    collection.utils.markReady()

    // Not the old [[], undefined, []]: empty batches carry no semantic change,
    // so one readiness transition publishes exactly once.
    expect(events).toEqual([undefined])
    observer.dispose()
  })

  it(`serves a fresh snapshot for rows changed while detached`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    const unsubscribe = observer.subscribe(() => {})
    const before = observer.getSnapshot()
    unsubscribe()

    // Mutate while nothing is attached; the status does not change.
    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `8`, name: `H` } })
    source.utils.commit()

    const after = observer.getSnapshot()
    expect(after).not.toBe(before)
    expect(after.state?.has(`8`)).toBe(true)
    expect(after.data).toHaveLength(3)
    observer.dispose()
  })

  it(`wholesale mode does not request an initial snapshot (no unfiltered loadSubset)`, () => {
    const { collection, loadSubsetCalls, writeRow } = makeLoadSubsetSource()
    const observer = createLiveQueryObserver<Row, string>(collection as any, {
      mode: `wholesale`,
    })

    const notifies: Array<unknown> = []
    observer.subscribe((changes) => notifies.push(changes))

    // No initial-state request, so no loadSubset({ where: undefined }) — the
    // pre-observer React/Angular loading policy.
    expect(loadSubsetCalls).toHaveLength(0)
    // No bootstrap replay either (only status wake-ups, which carry no
    // changes); wholesale consumers read getSnapshot().
    expect(notifies.filter((n) => n !== undefined)).toHaveLength(0)
    expect(observer.getSnapshot().data).toHaveLength(2)

    // Deltas — including deletes — still wake the consumer.
    const notifiesBefore = notifies.length
    writeRow(`delete`, { id: `1`, name: `A` })

    expect(notifies.length).toBe(notifiesBefore + 1)
    expect(observer.getSnapshot().data).toHaveLength(1)
    observer.dispose()
  })

  it(`granular mode still seeds from an initial snapshot`, () => {
    const { collection, loadSubsetCalls } = makeLoadSubsetSource()
    const observer = createLiveQueryObserver<Row, string>(collection as any)

    const inserted: Array<string> = []
    observer.subscribe((changes) => {
      for (const c of changes ?? []) {
        if (c.type === `insert`) inserted.push(c.key)
      }
    })

    expect(inserted.sort()).toEqual([`1`, `2`])
    expect(loadSubsetCalls).toHaveLength(1)
    observer.dispose()
  })

  it(`does not enumerate entries for a status-only snapshot read`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    const entriesSpy = vi.spyOn(source, `entries`)
    expect(observer.getSnapshot().status).toBe(`ready`)
    expect(entriesSpy).not.toHaveBeenCalled()

    // Materialization happens on first data/state access, once per revision.
    expect(observer.getSnapshot().data).toHaveLength(2)
    expect(observer.getSnapshot().state?.size).toBe(2)
    expect(entriesSpy).toHaveBeenCalledTimes(1)
    observer.dispose()
  })

  it(`does not activate sync at construction — only on first subscribe`, () => {
    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<Row>({
        id: `observer-idle-${seq++}`,
        getKey: (r) => r.id,
      }),
    )
    const observer = createLiveQueryObserver<Row, string>(collection as any)

    // Construction (e.g. in an abandoned React render) is inert.
    expect(collection.status).toBe(`idle`)
    expect(observer.getSnapshot().status).toBe(`idle`)

    const unsubscribe = observer.subscribe(() => {})
    expect(collection.status).not.toBe(`idle`)
    unsubscribe()
    observer.dispose()
  })

  it(`wakes consumers on status-only transitions (error, cleaned-up)`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    const statuses: Array<string> = []
    observer.subscribe(() => {
      statuses.push(observer.getSnapshot().status)
    })

    // Status transitions carry no row changes; the observer must publish
    // them through the same canonical path as data changes.
    source._lifecycle.setStatus(`error`)
    source._lifecycle.setStatus(`cleaned-up`)

    expect(statuses).toContain(`error`)
    expect(statuses).toContain(`cleaned-up`)
    observer.dispose()
  })

  it(`refreshes the snapshot when status changes without a version bump`, () => {
    // A status-only loading→ready transition with no active subscription: the
    // cached snapshot must not stay stale (covers the preload() case too).
    const collection = makeLoadingSource()
    const observer = createLiveQueryObserver<Row, string>(collection as any)

    expect(observer.getSnapshot().isReady).toBe(false)
    expect(observer.getSnapshot().status).toBe(`loading`)

    collection.utils.markReady()

    expect(observer.getSnapshot().isReady).toBe(true)
    expect(observer.getSnapshot().status).toBe(`ready`)
    observer.dispose()
  })
})
