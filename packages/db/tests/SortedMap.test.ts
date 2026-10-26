/**
 * Unit tests for SortedMap: ordering edge cases, bulk-sync movement bounds, and
 * key iteration details that pin hand-written results. The law that every
 * ordering observation must refine a full recomputation is owned by
 * SortedMap-oracle.test.ts.
 */

import { describe, expect, it, vi } from 'vitest'
import { SortedMap } from '../src/SortedMap'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'
import type { SyncConfig } from '../src/types.js'

async function countDisplacedSlots(
  action: () => void | Promise<void>,
): Promise<number> {
  const splice = Array.prototype.splice
  let displaced = 0
  const spy = vi.spyOn(Array.prototype, `splice`).mockImplementation(function (
    this: Array<unknown>,
    start: number,
    deleteCount?: number,
    ...items: Array<unknown>
  ) {
    const removed = deleteCount ?? this.length - start
    displaced += Math.max(0, this.length - start - removed)
    return splice.call(this, start, removed, ...items)
  })
  try {
    await action()
  } finally {
    spy.mockRestore()
  }
  return displaced
}

describe(`SortedMap`, () => {
  it(`keeps ordered-key movement bounded during descending bulk inserts`, async () => {
    // This work counter records the array elements displaced by splice. The
    // old ordered-key array moves every earlier key on each descending insert.
    // It is a diagnostic for this work class, not a wall-clock threshold.
    async function displacedSlots(size: number) {
      const map = new SortedMap<number, number>()
      const displaced = await countDisplacedSlots(() => {
        for (let key = size - 1; key >= 0; key--) map.set(key, key, true)
      })
      return { map, displaced }
    }
    const small = await displacedSlots(512)
    const large = await displacedSlots(2048)
    expect(large.displaced).toBeLessThan(2048 * 64)
    if (small.displaced > 0)
      expect(large.displaced).toBeLessThan(small.displaced * 8)
    large.map.restoreOrder()
    expect([...large.map.keys()]).toEqual(
      Array.from({ length: 2048 }, (_, key) => key),
    )
  })

  it(`keeps a default-order key iterator live across set and delete`, () => {
    const map = new SortedMap<number, number>()
    map.set(1, 1).set(3, 3)
    const pending = map.keys()
    map.set(2, 2, true)
    map.restoreOrder()
    expect([...pending]).toEqual([1, 2, 3])

    const running = map.keys()
    expect(running.next().value).toBe(1)
    map.delete(2, true)
    map.restoreOrder()
    expect([...running]).toEqual([3])

    const resumed = map.keys()
    expect(resumed.next().value).toBe(1)
    map.set(2, 2, true)
    map.restoreOrder()
    expect([...resumed]).toEqual([2, 3])
  })

  it(`keeps mixed string, number, and NaN keys distinct in default order`, () => {
    const map = new SortedMap<string | number, number>()
    for (const key of [2, `2`, Number.NaN, -1, `a`, `0`, 0]) {
      map.set(key, 1, true)
    }
    expect([...map.keys()]).toEqual([`0`, `2`, `a`, -1, 0, 2, Number.NaN])
    map.delete(`2`, true)
    map.set(Number.NaN, 2, true)
    expect([...map.keys()]).toEqual([`0`, `a`, -1, 0, 2, Number.NaN])
    expect(map.size).toBe(6)
    expect(map.get(Number.NaN)).toBe(2)
  })

  it(`retains runtime undefined keys and does not resort clean scans`, () => {
    const compare = vi.fn((left: number, right: number) => left - right)
    const map = new SortedMap<string, number>(compare)
    const absent = undefined as unknown as string
    map.set(`a`, 2, true)
    map.set(absent, 1, true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual([absent, `a`])
    compare.mockClear()
    for (let scan = 0; scan < 20; scan++) {
      expect([...map.keys()]).toEqual([absent, `a`])
    }
    expect(compare).not.toHaveBeenCalled()
    expect(map.delete(absent, true)).toBe(true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual([`a`])
  })

  it(`preserves insertion behavior around transient nullish numeric keys`, () => {
    const map = new SortedMap<number, number>()
    const absent = undefined as unknown as number
    map.set(absent, 0, true)
    map.set(1, 0, true)
    expect([...map.keys()]).toEqual([absent, 1])
    expect(map.delete(absent, true)).toBe(true)
    for (let key = 128; key > 1; key--) map.set(key, 0, true)
    map.restoreOrder()
    expect([...map.keys()]).toEqual(
      Array.from({ length: 128 }, (_, i) => i + 1),
    )
  })

  it(`orders mutable comparator values at the batch checkpoint`, () => {
    const map = new SortedMap<string, { rank: number }>(
      (left, right) => left.rank - right.rank,
    )
    const first = { rank: 1 }
    map.set(`a`, first, true)
    map.set(`b`, { rank: 2 }, true)
    first.rank = 3
    map.restoreOrder()
    expect([...map.keys()]).toEqual([`b`, `a`])
    expect(map.delete(`a`)).toBe(true)
    expect([...map.keys()]).toEqual([`b`])
  })

  it(`bounds ordered-key movement in a bulk Collection sync commit`, async () => {
    type Row = { id: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    try {
      sync.begin()
      for (let id = 4095; id >= 0; id--)
        sync.write({ type: `insert`, value: { id } })
      const displaced = await countDisplacedSlots(() => {
        expect(sync.commit()).toBe(true)
      })
      expect(displaced).toBeLessThan(4096 * 64)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 4096 }, (_, id) => id),
      )

      sync.begin()
      for (let id = -1; id >= -1024; id--)
        sync.write({ type: `insert`, value: { id } })
      const retainedDisplaced = await countDisplacedSlots(() => {
        expect(sync.commit()).toBe(true)
      })
      expect(retainedDisplaced).toBeLessThan(4096 * 32)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 5120 }, (_, index) => index - 1024),
      )
    } finally {
      await collection.cleanup()
    }
  })

  it(`bounds ordered-key movement across queued sync transactions`, async () => {
    type Row = { id: number; value: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let release!: () => void
    const persistence = new Promise<void>((resolve) => {
      release = resolve
    })
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          sync = actions
          actions.begin()
          actions.write({ type: `insert`, value: { id: 0, value: 0 } })
          actions.commit()
          actions.markReady()
        },
      },
    })
    const blocker = createTransaction<Row>({
      autoCommit: false,
      mutationFn: () => persistence,
    })
    let blockerCommit: Promise<unknown> | undefined
    const receipts: Array<Promise<void>> = []
    try {
      await collection.stateWhenReady()
      blocker.mutate(() =>
        collection.update(0, (draft) => {
          draft.value = 1
        }),
      )
      blockerCommit = blocker.commit()
      await Promise.resolve()
      expect(blocker.state).toBe(`persisting`)

      for (let batch = 0; batch < 16; batch++) {
        sync.begin()
        for (let offset = 0; offset < 64; offset++) {
          const id = 1024 - batch * 64 - offset
          sync.write({ type: `insert`, value: { id, value: id } })
        }
        const receipt = sync.commit()
        expect(receipt).not.toBe(true)
        if (receipt !== true) {
          void receipt.catch(() => undefined)
          receipts.push(receipt)
        }
      }

      const displaced = await countDisplacedSlots(async () => {
        release()
        await blockerCommit
        await Promise.all(receipts)
      })
      expect(displaced).toBeLessThan(1024 * 64)
      expect([...collection.keys()]).toEqual(
        Array.from({ length: 1025 }, (_, id) => id),
      )
    } finally {
      release()
      if (blocker.state === `pending` || blocker.state === `persisting`)
        blocker.rollback()
      await blockerCommit?.catch(() => undefined)
      await Promise.allSettled(receipts)
      await collection.cleanup()
    }
  })

  it(`publishes a large sync transaction in comparator order`, async () => {
    type Row = { id: number; rank: number }
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const compare = vi.fn((left: Row, right: Row) => left.rank - right.rank)
    const collection = createCollection<Row, number>({
      getKey: (row) => row.id,
      compare,
      startSync: true,
      sync: {
        rowUpdateMode: `full`,
        sync: (actions) => {
          sync = actions
          actions.markReady()
        },
      },
    })
    const model = new Map<number, Row>()
    const expectedKeys = () =>
      [...model.values()]
        .sort((left, right) => left.rank - right.rank || left.id - right.id)
        .map((row) => row.id)
    const published: Array<Array<number>> = []
    const subscription = collection.subscribeChanges(
      () => published.push([...collection.keys()]),
      { includeInitialState: false },
    )
    try {
      const pending = collection.keys()
      sync.begin()
      for (let id = 127; id >= 0; id--) {
        const row = { id, rank: id % 7 }
        model.set(id, row)
        sync.write({ type: `insert`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect([...pending]).toEqual(expectedKeys())
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())

      sync.begin()
      for (let id = 0; id < 64; id++) {
        const row = { id, rank: -id }
        model.set(id, row)
        sync.write({ type: `update`, value: row })
      }
      for (let id = 64; id < 70; id++) {
        model.delete(id)
        sync.write({ type: `delete`, key: id })
      }
      expect(sync.commit()).toBe(true)
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())

      sync.begin()
      for (let id = 128; id < 10000; id++) {
        const row = { id, rank: id % 7 }
        model.set(id, row)
        sync.write({ type: `insert`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect([...collection.keys()]).toEqual(expectedKeys())

      // A small update batch in a large Collection should keep using
      // incremental ordering instead of sorting every retained row.
      compare.mockClear()
      sync.begin()
      for (let id = 0; id < 64; id++) {
        const row = { id, rank: -id - 100 }
        model.set(id, row)
        sync.write({ type: `update`, value: row })
      }
      expect(sync.commit()).toBe(true)
      expect(compare.mock.calls.length).toBeLessThan(5000)
      expect([...collection.keys()]).toEqual(expectedKeys())
      expect(published.at(-1)).toEqual(expectedKeys())
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`sorts by key by default, even when values have the opposite order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 1)
    map.set(`a`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`works with custom comparator`, () => {
    // Create a map that sorts numbers in descending order
    const map = new SortedMap<string, number>((a, b) => b - a)
    map.set(`a`, 1)
    map.set(`c`, 3)
    map.set(`b`, 2)

    const values = Array.from(map.values())
    expect(values).toEqual([3, 2, 1])
  })

  it(`correctly handles updates`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 3)
    map.set(`a`, 2) // update existing key

    expect(map.size).toBe(2)
    expect(map.get(`a`)).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([2, 3])
  })

  it(`correctly handles deletions`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)
    map.set(`c`, 3)

    map.delete(`b`)
    expect(map.size).toBe(2)
    const values = Array.from(map.values())
    expect(values).toEqual([1, 3])
  })

  it(`implements iteration methods correctly`, () => {
    const map = new SortedMap<string, number>()
    map.set(`b`, 2)
    map.set(`a`, 1)
    map.set(`c`, 3)

    // Test entries()
    const entries = Array.from(map.entries())
    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])

    // Test values()
    const values = Array.from(map.values())
    expect(values).toEqual([1, 2, 3])

    // Test forEach
    const forEachResults: Array<number> = []
    map.forEach((value) => forEachResults.push(value))
    expect(forEachResults).toEqual([1, 2, 3])
  })

  it(`orders string keys when no custom comparator is provided`, () => {
    const map = new SortedMap<string, string>()
    map.set(`c`, `charlie`)
    map.set(`a`, `alpha`)
    map.set(`b`, `bravo`)

    const values = Array.from(map.values())
    expect(values).toEqual([`alpha`, `bravo`, `charlie`])

    // Test with values that would be sorted differently by a custom comparator
    const numericMap = new SortedMap<string, string>()
    numericMap.set(`a`, `10`)
    numericMap.set(`b`, `2`)

    // Default string comparison will put '10' before '2'
    const numericValues = Array.from(numericMap.values())
    expect(numericValues).toEqual([`10`, `2`])
  })

  // Test for keys() method
  it(`provides keys in sorted order`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const keys = Array.from(map.keys())
    expect(keys).toEqual([`a`, `b`, `c`])
  })

  // Test for Symbol.iterator implementation
  it(`supports direct iteration with for...of`, () => {
    const map = new SortedMap<string, number>()
    map.set(`c`, 3)
    map.set(`a`, 1)
    map.set(`b`, 2)

    const entries: Array<[string, number]> = []
    for (const entry of map) {
      entries.push(entry)
    }

    expect(entries).toEqual([
      [`a`, 1],
      [`b`, 2],
      [`c`, 3],
    ])
  })

  // Test for clear method
  it(`clears all entries`, () => {
    const map = new SortedMap<string, number>()
    map.set(`a`, 1)
    map.set(`b`, 2)

    map.clear()
    expect(map.size).toBe(0)
    expect(Array.from(map.entries())).toEqual([])
  })
})
