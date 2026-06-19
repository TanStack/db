import { describe, expect, it } from 'vitest'
import { createCollection, createLiveQueryCollection } from '../src/index'

const flush = () => new Promise((r) => setTimeout(r, 20))

type Item = { id: string; name: string; value: number }

function manualCollection(id: string, initial: Array<Item>) {
  let fns: any
  const collection = createCollection<Item, string>({
    id,
    getKey: (i) => i.id,
    sync: {
      sync: (params) => {
        fns = params
        params.begin()
        for (const item of initial) params.write({ type: `insert`, value: item })
        params.commit()
        params.markReady()
      },
    },
  })
  collection.startSyncImmediate()
  const write = (type: `insert` | `update` | `delete`, value: Item) => {
    fns.begin()
    fns.write({ type, value })
    fns.commit()
  }
  return { collection, write }
}

const seed: Array<Item> = [
  { id: `a`, name: `Alice`, value: 2 },
  { id: `b`, name: `Bob`, value: 1 },
  { id: `c`, name: `Carol`, value: 3 },
]

describe(`live query orderBy: order-only reorder must emit a change`, () => {
  it(`select(id) + orderBy(value): a reorder emits a change and updates order`, async () => {
    const { collection: source, write } = manualCollection(`reorder-emit-src`, [
      seed[0]!,
      seed[1]!,
    ])
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .select(({ s }) => ({ id: s.id })),
    })
    await flush()

    const orderOf = () => Array.from(live.values(), (v: any) => v.id as string)
    expect(orderOf()).toEqual([`b`, `a`])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    write(`update`, { id: `a`, name: `Alice`, value: 0 })
    await flush()

    expect(emitted).toBeGreaterThan(0)
    expect(orderOf()).toEqual([`a`, `b`])
    sub.unsubscribe()
  })

  it(`select(id, value) + orderBy(value): reorder emits EXACTLY one event for the moved key (no double-emit)`, async () => {
    const { collection: source, write } = manualCollection(`reorder-single`, [
      seed[0]!,
      seed[1]!,
    ])
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .select(({ s }) => ({ id: s.id, value: s.value })),
    })
    await flush()

    let eventsForA = 0
    const sub = live.subscribeChanges((changes) => {
      for (const c of changes) if (c.key === `a`) eventsForA++
    })

    // reorder by changing the (projected) sort field
    write(`update`, { id: `a`, name: `Alice`, value: 0 })
    await flush()

    expect(eventsForA).toBe(1) // state.ts emits once; direct-emit is gated off
    expect(Array.from(live.values(), (v: any) => v.id)).toEqual([`a`, `b`])
    sub.unsubscribe()
  })

  it(`no reorder + unprojected field change: order-only path stays silent`, async () => {
    const { collection: source, write } = manualCollection(`no-move`, [
      seed[0]!,
      seed[1]!,
    ])
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .select(({ s }) => ({ id: s.id })),
    })
    await flush()

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    // change a non-projected, non-sort field; position is unchanged
    write(`update`, { id: `a`, name: `Alicia`, value: 2 })
    await flush()

    expect(emitted).toBe(0) // nothing visible changed
    expect(Array.from(live.values(), (v: any) => v.id)).toEqual([`b`, `a`])
    sub.unsubscribe()
  })

  it(`select(id) + orderBy + limit: reorder within the window emits and reorders`, async () => {
    const { collection: source, write } = manualCollection(`reorder-limit`, seed)
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .limit(3)
          .select(({ s }) => ({ id: s.id })),
    })
    await flush()
    expect(Array.from(live.values(), (v: any) => v.id)).toEqual([`b`, `a`, `c`])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    // move c to the front (3 -> 0)
    write(`update`, { id: `c`, name: `Carol`, value: 0 })
    await flush()

    expect(emitted).toBeGreaterThan(0)
    expect(Array.from(live.values(), (v: any) => v.id)).toEqual([`c`, `b`, `a`])
    sub.unsubscribe()
  })
})
