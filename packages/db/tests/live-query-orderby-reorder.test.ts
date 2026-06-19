import { describe, expect, it } from 'vitest'
import { createCollection, createLiveQueryCollection } from '../src/index'
import type { SyncConfig } from '../src/types'

type Item = { id: string; name: string; value: number }

type SyncFns = Pick<
  Parameters<SyncConfig<Item, string>[`sync`]>[0],
  `begin` | `write` | `commit` | `markReady`
>

// The live query processes synchronously on commit, so tests assert directly
// after each write — no timing/sleep needed.
const idsOf = (live: { values: () => IterableIterator<unknown> }): Array<string> =>
  Array.from(live.values(), (v) => (v as { id: string }).id)

function manualCollection(id: string, initial: Array<Item>) {
  let fns: SyncFns | undefined
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
    if (!fns) throw new Error(`sync functions not initialized`)
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
  it(`select(id) + orderBy(value): a reorder emits a change and updates order`, () => {
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
    expect(idsOf(live)).toEqual([`b`, `a`])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    write(`update`, { id: `a`, name: `Alice`, value: 0 })

    expect(emitted).toBeGreaterThan(0)
    expect(idsOf(live)).toEqual([`a`, `b`])
    sub.unsubscribe()
  })

  it(`select(id, value) + orderBy(value): reorder emits EXACTLY one event for the moved key (no double-emit)`, () => {
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

    let eventsForA = 0
    const sub = live.subscribeChanges((changes) => {
      for (const c of changes) if (c.key === `a`) eventsForA++
    })

    // reorder by changing the (projected) sort field
    write(`update`, { id: `a`, name: `Alice`, value: 0 })

    expect(eventsForA).toBe(1) // state.ts emits once; direct-emit is gated off
    expect(idsOf(live)).toEqual([`a`, `b`])
    sub.unsubscribe()
  })

  it(`no reorder + unprojected field change: order-only path stays silent`, () => {
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

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    // change a non-projected, non-sort field; position is unchanged
    write(`update`, { id: `a`, name: `Alicia`, value: 2 })

    expect(emitted).toBe(0) // nothing visible changed
    expect(idsOf(live)).toEqual([`b`, `a`])
    sub.unsubscribe()
  })

  it(`select(id) + orderBy + limit: reorder within the window emits and reorders`, () => {
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
    expect(idsOf(live)).toEqual([`b`, `a`, `c`])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    // move c to the front (3 -> 0)
    write(`update`, { id: `c`, name: `Carol`, value: 0 })

    expect(emitted).toBeGreaterThan(0)
    expect(idsOf(live)).toEqual([`c`, `b`, `a`])
    sub.unsubscribe()
  })

  it(`limit(0): empty window stays empty and silent across a reorder`, () => {
    const { collection: source, write } = manualCollection(`reorder-limit0`, seed)
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .limit(0)
          .select(({ s }) => ({ id: s.id })),
    })
    expect(idsOf(live)).toEqual([])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    write(`update`, { id: `a`, name: `Alice`, value: 0 })

    expect(emitted).toBe(0)
    expect(idsOf(live)).toEqual([])
    sub.unsubscribe()
  })

  it(`offset beyond data length: empty window stays empty and silent across a reorder`, () => {
    const { collection: source, write } = manualCollection(`reorder-offset`, seed)
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ s: source })
          .orderBy(({ s }) => s.value)
          .offset(10)
          .limit(3)
          .select(({ s }) => ({ id: s.id })),
    })
    expect(idsOf(live)).toEqual([])

    let emitted = 0
    const sub = live.subscribeChanges(() => {
      emitted++
    })

    write(`update`, { id: `a`, name: `Alice`, value: 0 })

    expect(emitted).toBe(0)
    expect(idsOf(live)).toEqual([])
    sub.unsubscribe()
  })
})
