import "./fake-db"
import { afterEach, describe, expect, it } from "vitest"
import {
  cleanupTestResources,
  createMultiTabState,
  waitForBothCollections,
  waitForKey,
  waitForNoKey,
} from "./test-helpers"
import type { TestItem } from "./test-helpers"

describe(`Dexie Multi-tab Race Conditions`, () => {
  afterEach(cleanupTestResources)

  it(`handles concurrent inserts with same keys (last writer wins)`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    // Both collections try to insert the same key concurrently
    const txA = colA.insert({ id: `race-1`, name: `Collection A` })
    const txB = colB.insert({ id: `race-1`, name: `Collection B` })

    await Promise.all([txA.isPersisted.promise, txB.isPersisted.promise])

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await waitForKey(colA, `race-1`, 1000)
    await waitForKey(colB, `race-1`, 1000)

    // Both collections should see the same final value (last writer wins)
    const finalValueA = colA.get(`race-1`)
    const finalValueB = colB.get(`race-1`)
    expect(finalValueA).toEqual(finalValueB)
    expect(finalValueA?.name).toMatch(/Collection [AB]/)

    // Verify the data is actually persisted in the database
    const dbRow = await dbA.table(`test`).get(`race-1`)
    // Strip metadata fields for comparison since database now stores internal metadata
    const cleanDbRow = dbRow ? { id: dbRow.id, name: dbRow.name } : dbRow
    expect(cleanDbRow).toEqual(finalValueA)

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`handles concurrent delete operations on same key`, async () => {
    const initialData = [{ id: `delete-me`, name: `To be deleted` }]
    const { colA, colB, dbA, dbB } = await createMultiTabState(
      initialData,
      initialData
    )

    await waitForKey(colA, `delete-me`, 1000)
    await waitForKey(colB, `delete-me`, 1000)

    // Both collections try to delete the same key
    colA.delete(`delete-me`)
    colB.delete(`delete-me`)

    await colA.stateWhenReady()
    await colB.stateWhenReady()

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await waitForNoKey(colA, `delete-me`, 1000)
    await waitForNoKey(colB, `delete-me`, 1000)

    // Both should agree the item is gone
    expect(colA.has(`delete-me`)).toBe(false)
    expect(colB.has(`delete-me`)).toBe(false)

    // Verify deletion is persisted
    const dbRow = await dbA.table(`test`).get(`delete-me`)
    expect(dbRow).toBeUndefined()

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`handles rapid alternating inserts and deletes`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    // Collection A: Insert, Delete, Insert
    // Collection B: Insert different values for same key
    const operations = [
      () => colA.insert({ id: `flip-flop`, name: `A-insert-1` }),
      () => colB.insert({ id: `flip-flop`, name: `B-insert-1` }),
      () => colA.delete(`flip-flop`),
      () => colB.insert({ id: `flip-flop`, name: `B-insert-2` }),
      () => colA.insert({ id: `flip-flop`, name: `A-insert-2` }),
    ]

    // Execute operations with small delays to create race conditions
    const promises = operations.map(
      (op, i) =>
        new Promise<void>((resolve) => {
          setTimeout(async () => {
            try {
              const tx = op()
              if (`isPersisted` in tx) {
                await tx.isPersisted.promise
              } else {
                // If op returned undefined (e.g. delete), just wait briefly
                await new Promise((r) => setTimeout(r, 20))
              }
            } catch {}
            resolve()
          }, i * 50)
        })
    )

    await Promise.all(promises)

    // Wait for both collections to converge on the same final state
    // for the flip-flop key. Retry until either both see the key with
    // same value or both don't have it.
    const start = Date.now()
    let finalA: any = null
    let finalB: any = null
    for (;;) {
      finalA = colA.get(`flip-flop`)
      finalB = colB.get(`flip-flop`)
      const same =
        (finalA === undefined && finalB === undefined) ||
        (finalA && finalB && JSON.stringify(finalA) === JSON.stringify(finalB))
      if (same) break
      if (Date.now() - start > 2000) break
      await new Promise((r) => setTimeout(r, 50))
    }

    expect(JSON.stringify(finalA)).toEqual(JSON.stringify(finalB))

    if (finalA) {
      expect(finalA.name).toMatch(/[AB]-insert-2/)
    }

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`handles bulk insert race conditions with overlapping keys`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    // Collection A inserts items 1-10
    const itemsA = Array.from({ length: 10 }, (_, i) => ({
      id: String(i + 1),
      name: `Item ${i + 1} from A`,
    }))

    // Collection B inserts items 5-15 (overlapping 5-10)
    const itemsB = Array.from({ length: 11 }, (_, i) => ({
      id: String(i + 5),
      name: `Item ${i + 5} from B`,
    }))

    // Execute bulk inserts concurrently
    const bulkPromises = [
      Promise.all(
        itemsA.map(async (item) => {
          const tx = colA.insert(item)
          await tx.isPersisted.promise
        })
      ),
      Promise.all(
        itemsB.map(async (item) => {
          const tx = colB.insert(item)
          await tx.isPersisted.promise
        })
      ),
    ]

    await Promise.all(bulkPromises)

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await waitForBothCollections(colA, colB, 15, 2000)

    // Both collections should have all 15 items (1-15)
    expect(colA.size).toBe(15)
    expect(colB.size).toBe(15)

    // For overlapping keys (5-10), last writer should win
    for (let i = 5; i <= 10; i++) {
      const valueA = colA.get(String(i))
      const valueB = colB.get(String(i))
      expect(valueA).toEqual(valueB)
      expect(valueA?.name).toMatch(/Item \d+ from [AB]/)
    }

    // Non-overlapping keys should have expected values
    expect(colA.get(`1`)?.name).toBe(`Item 1 from A`)
    expect(colA.get(`15`)?.name).toBe(`Item 15 from B`)

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`handles concurrent updates with refetch coordination`, async () => {
    const initialData = [
      { id: `update-me`, name: `Initial`, count: 0 } as TestItem & {
        count: number
      },
    ]
    const { colA, colB, dbA, dbB } = await createMultiTabState(
      initialData,
      initialData
    )

    await waitForKey(colA, `update-me`, 1000)
    await waitForKey(colB, `update-me`, 1000)

    // Both collections try to update the same item
    colA.update(`update-me`, (item) => {
      ;(item as any).name = `Updated by A`
      ;(item as any).count = ((item as any).count || 0) + 1
    })

    colB.update(`update-me`, (item) => {
      ;(item as any).name = `Updated by B`
      ;(item as any).count = ((item as any).count || 0) + 10
    })

    await colA.stateWhenReady()
    await colB.stateWhenReady()

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await new Promise((r) => setTimeout(r, 100))

    // Both collections should see the same final value
    const finalValueA = colA.get(`update-me`)
    const finalValueB = colB.get(`update-me`)
    expect(finalValueA).toEqual(finalValueB)

    // Should have one of the updates (last writer wins)
    expect(finalValueA?.name).toMatch(/Updated by [AB]/)

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`maintains cross-instance consistency with awaitIds`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    // Insert from collection A
    const txA = colA.insert({ id: `await-test`, name: `From A` })
    await txA.isPersisted.promise

    // Use awaitIds on collection B to wait for the item
    const utilsBAwait = colB.utils as unknown as {
      awaitIds?: (ids: Array<string>, timeout?: number) => Promise<void>
    }

    if (utilsBAwait.awaitIds) {
      await utilsBAwait.awaitIds([`await-test`], 2000)
    } else {
      // Fallback to refetch + waitForKey
      const utilsB = colB.utils as unknown as {
        refetch?: () => Promise<void>
      }
      if (utilsB.refetch) await utilsB.refetch()
      await waitForKey(colB, `await-test`, 2000)
    }

    // Following RxDB pattern: Wait for database to have the data first
    await dbB.table(`test`).get(`await-test`)

    // Then check collection state - give reactive layer a moment to process
    await waitForKey(colB, `await-test`, 1000)

    // Collection B should now see the item
    expect(colB.has(`await-test`)).toBe(true)
    expect(colB.get(`await-test`)?.name).toBe(`From A`)

    // Now delete from collection B
    colB.delete(`await-test`)
    await colB.stateWhenReady()

    // Collection A should eventually see the deletion
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    await waitForNoKey(colA, `await-test`, 2000)

    expect(colA.has(`await-test`)).toBe(false)

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })

  it(`handles rapid fire operations between multiple instances`, async () => {
    const { colA, colB, dbA, dbB } = await createMultiTabState()

    const operationCount = 50
    const promises: Array<Promise<void>> = []

    // Alternate between collections for rapid operations
    for (let i = 0; i < operationCount; i++) {
      const collection = i % 2 === 0 ? colA : colB
      const itemId = String(i)

      promises.push(
        (async () => {
          const tx = collection.insert({
            id: itemId,
            name: `Rapid item ${i}`,
          })
          await tx.isPersisted.promise
        })()
      )
    }

    await Promise.all(promises)

    // Force refetch to ensure both see final state
    const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
    const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
    if (utilsA.refetch) await utilsA.refetch()
    if (utilsB.refetch) await utilsB.refetch()

    await waitForBothCollections(colA, colB, operationCount, 5000)

    // Both collections should have all items
    expect(colA.size).toBe(operationCount)
    expect(colB.size).toBe(operationCount)

    // Verify all items are present and consistent
    for (let i = 0; i < operationCount; i++) {
      const itemId = String(i)
      expect(colA.has(itemId)).toBe(true)
      expect(colB.has(itemId)).toBe(true)
      expect(colA.get(itemId)).toEqual(colB.get(itemId))
    }

    await dbA.close()
    await dbB.close()
    try {
      const { default: Dexie } = await import(`dexie`)
      await Dexie.delete(dbA.name)
    } catch {
      // ignore
    }
  })
})
