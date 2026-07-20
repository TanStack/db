import { describe, expect, it } from 'vitest'
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

  it(`defers the initial notify to a microtask when deferInitialNotify is set`, async () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any, {
      deferInitialNotify: true,
    })
    let notified = false
    observer.subscribe(() => {
      notified = true
    })
    // Not synchronous during subscribe (protects React's useSyncExternalStore)...
    expect(notified).toBe(false)
    await Promise.resolve()
    // ...delivered on the next microtask.
    expect(notified).toBe(true)
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

  it(`does not flush a superseded deferred initial notify (deferInitialNotify)`, async () => {
    const observer = createLiveQueryObserver<Row, string>(makeSource() as any, {
      deferInitialNotify: true,
    })

    // Subscribe then unsubscribe before the microtask flush, then resubscribe.
    observer.subscribe(() => {})()

    let notifications = 0
    observer.subscribe(() => {
      notifications++
    })
    await Promise.resolve()

    // Only the current subscription's deferred initial notify should flush,
    // not the stale one queued by the first (superseded) attach.
    expect(notifications).toBe(1)
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

    let lateListenerCalls = 0
    observer.subscribe((changes) => {
      // Add the late listener only while the row-4 delta is being dispatched.
      if (changes?.some((c) => c.key === `4`)) {
        observer.subscribe(() => {
          lateListenerCalls++
        })
      }
    })

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `4`, name: `D` } })
    source.utils.commit()

    expect(lateListenerCalls).toBe(0)
    observer.dispose()
  })

  it(`still delivers the in-flight publication to a listener removed during dispatch`, () => {
    const source = makeSource()
    const observer = createLiveQueryObserver<Row, string>(source as any)

    let existingListenerCalls = 0
    let unsubB: (() => void) | null = null
    observer.subscribe(() => {
      unsubB?.()
      unsubB = null
    })
    unsubB = observer.subscribe(() => {
      existingListenerCalls++
    })

    source.utils.begin()
    source.utils.write({ type: `insert`, value: { id: `5`, name: `E` } })
    source.utils.commit()

    // A removed B while the publication was in flight; B still receives it.
    expect(existingListenerCalls).toBe(1)
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
