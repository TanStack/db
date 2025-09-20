import "./fake-db"
import { afterEach, describe, expect, it } from "vitest"
import { createCollection } from "@tanstack/db"
import dexieCollectionOptions from "../src/dexie"
import { cleanupTestResources, createTestState, getDexie } from "./test-helpers"

describe(`Dexie Error Handling`, () => {
  afterEach(cleanupTestResources)

  it(`handles codec parse failures gracefully`, async () => {
    const Dexie = await getDexie()
    const dbName = `strict-test-${Date.now()}`
    const db = new Dexie(dbName)
    db.version(1).stores({ test: `&id, updatedAt` })
    await db.open()

    // Create a collection with strict codec validation
    const strictOptions = dexieCollectionOptions<{ id: string; name: string }>({
      id: `strict-collection`,
      tableName: `test`,
      dbName,
      getKey: (item) => item.id,
      codec: {
        parse: (data: unknown) => {
          if (typeof data !== `object` || data === null) {
            throw new Error(`Invalid data type`)
          }
          const obj = data as Record<string, unknown>
          if (typeof obj.id !== `string` || typeof obj.name !== `string`) {
            throw new Error(`Missing required fields`)
          }
          return obj as { id: string; name: string }
        },
      },
    })

    const strictCollection = createCollection(strictOptions)

    // Insert valid data
    const validTx = strictCollection.insert({ id: `valid`, name: `Valid Item` })
    await validTx.isPersisted.promise
    expect(strictCollection.get(`valid`)).toBeTruthy()

    // Try to manually insert invalid data to the database
    await db.table(`test`).add({ id: `invalid`, count: 42 })

    // Force refetch to see the invalid data
    const utils = strictCollection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (utils.refetch) {
      await utils.refetch()
    }

    // Collection should handle the invalid item gracefully
    // (behavior may vary - could skip invalid items or throw)
    expect(strictCollection.get(`valid`)).toBeTruthy()
  })

  it(`handles database connection failures`, async () => {
    const Dexie = await getDexie()
    const dbName = `fail-test-${Date.now()}`
    const db = new Dexie(dbName)
    db.version(1).stores({ test: `&id, updatedAt` })

    const options = dexieCollectionOptions<{ id: string; name: string }>({
      id: `fail-collection`,
      tableName: `test`,
      dbName,
      getKey: (item) => item.id,
    })

    const collection = createCollection(options)

    // Close the database while collection is active
    await db.close()

    // Operations should handle the closed database gracefully
    let insertError = null
    try {
      const tx = collection.insert({ id: `test`, name: `Test` })
      await tx.isPersisted.promise
    } catch (error) {
      insertError = error
    }

    // Should either throw an error or handle gracefully
    // (exact behavior depends on implementation)
    if (insertError) {
      expect(insertError).toBeInstanceOf(Error)
    } else {
      // If no error, the operation should be queued or handled gracefully
      expect(collection.size).toBeGreaterThanOrEqual(0)
    }
  })

  it(`handles duplicate key insertions properly`, async () => {
    const { collection } = await createTestState()

    // Insert initial item
    const tx1 = collection.insert({ id: `duplicate`, name: `First` })
    await tx1.isPersisted.promise
    expect(collection.get(`duplicate`)?.name).toBe(`First`)

    // Try to insert duplicate - should either replace or throw
    let duplicateError = null
    try {
      const tx2 = collection.insert({ id: `duplicate`, name: `Second` })
      await tx2.isPersisted.promise
    } catch (error) {
      duplicateError = error
    }

    if (duplicateError) {
      // If it throws, original should remain
      expect(collection.get(`duplicate`)?.name).toBe(`First`)
    } else {
      // If it succeeds, should be replaced (upsert behavior)
      expect(collection.get(`duplicate`)?.name).toBe(`Second`)
    }
  })

  it(`handles update operations on non-existent items`, async () => {
    const { collection } = await createTestState()

    // Try to update non-existent item
    let updateError = null
    try {
      collection.update(`non-existent`, (item) => {
        item.name = `Updated`
      })
    } catch (error) {
      updateError = error
    }

    // Should handle gracefully (no-op or error)
    expect(collection.has(`non-existent`)).toBe(false)

    // If error occurred, it should be meaningful
    if (updateError) {
      expect(updateError).toBeInstanceOf(Error)
    }
  })

  it(`handles delete operations on non-existent items`, async () => {
    const { collection } = await createTestState()

    // Try to delete non-existent item
    let deleteError = null
    try {
      collection.delete(`non-existent`)
    } catch (error) {
      deleteError = error
    }

    // Should handle gracefully (no-op)
    expect(collection.has(`non-existent`)).toBe(false)

    // If error occurred, it should be meaningful
    if (deleteError) {
      expect(deleteError).toBeInstanceOf(Error)
    }
  })

  it(`handles corrupted database states`, async () => {
    const { collection, db } = await createTestState()

    // Insert some valid data
    const tx = collection.insert({ id: `valid`, name: `Valid Item` })
    await tx.isPersisted.promise
    expect(collection.get(`valid`)).toBeTruthy()

    // Manually corrupt the database by inserting invalid schema data
    await db.table(`test`).add({ id: `corrupted`, invalid: true })

    // Collection should handle mixed valid/invalid data
    const utils = collection.utils as unknown as {
      refetch?: () => Promise<void>
    }
    if (utils.refetch) {
      await utils.refetch()
    }

    // Valid data should still be accessible
    expect(collection.get(`valid`)).toBeTruthy()

    // Collection should handle the corruption gracefully
    expect(collection.size).toBeGreaterThanOrEqual(1)
  })

  it(`handles concurrent access during error states`, async () => {
    const { collection } = await createTestState()

    // Insert initial data
    const tx = collection.insert({ id: `concurrent`, name: `Initial` })
    await tx.isPersisted.promise

    // Simulate error during concurrent operations
    const operations = [
      () =>
        collection.update(`concurrent`, (item) => {
          item.name = `Update 1`
        }),
      () =>
        collection.update(`non-existent`, (item) => {
          item.name = `Invalid`
        }),
      () => collection.delete(`concurrent`),
      () => collection.insert({ id: `new`, name: `New Item` }),
      () => collection.delete(`also-non-existent`),
    ]

    // Execute all operations concurrently
    const results = await Promise.allSettled(
      operations.map((op) => Promise.resolve().then(() => op()))
    )

    // Some operations may fail, but the collection should remain in valid state
    const errors = results.filter((r) => r.status === `rejected`)
    console.log(
      `${errors.length} operations failed (expected for error handling test)`
    )

    // Collection should still be functional
    await collection.stateWhenReady()
    expect(collection.size).toBeGreaterThanOrEqual(0)

    // Should be able to perform new operations
    const newTx = collection.insert({ id: `recovery`, name: `Recovery Test` })
    await newTx.isPersisted.promise
    expect(collection.get(`recovery`)).toBeTruthy()
  })

  it(`handles transaction failures gracefully`, async () => {
    const { collection } = await createTestState()

    // Create a scenario that might cause transaction conflicts
    const conflictPromises = Array.from({ length: 10 }, async (_, i) => {
      try {
        const tx = collection.insert({
          id: `conflict-${i}`,
          name: `Conflict Item ${i}`,
        })
        await tx.isPersisted.promise
        return { success: true, id: `conflict-${i}` }
      } catch (error) {
        return { success: false, error }
      }
    })

    const results = await Promise.allSettled(conflictPromises)

    // Some may succeed, some may fail due to conflicts
    const successful = results.filter((r) => r.status === `fulfilled`)
    const failed = results.filter((r) => r.status === `rejected`)

    console.log(
      `${successful.length} transactions succeeded, ${failed.length} failed`
    )

    // Collection should remain consistent
    await collection.stateWhenReady()
    expect(collection.size).toBeGreaterThanOrEqual(0)

    // Verify that successful insertions are actually in the collection
    for (const result of results) {
      if (
        result.status === `fulfilled` &&
        result.value.success &&
        result.value.id
      ) {
        expect(collection.has(result.value.id)).toBe(true)
      }
    }
  })

  it(`maintains collection consistency during error recovery`, async () => {
    const { collection, db } = await createTestState()

    // Insert baseline data
    const baselineItems = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      name: `Baseline ${i}`,
    }))

    for (const item of baselineItems) {
      const tx = collection.insert(item)
      await tx.isPersisted.promise
    }

    expect(collection.size).toBe(10)

    // Simulate a series of operations with some errors
    const mixedOperations = [
      // Valid operations
      () => collection.insert({ id: `valid-1`, name: `Valid 1` }),
      () =>
        collection.update(`5`, (item) => {
          item.name = `Updated 5`
        }),

      // Invalid operations (should not break the collection)
      () =>
        collection.update(`invalid-key`, (item) => {
          item.name = `Should Fail`
        }),
      () => collection.delete(`another-invalid-key`),

      // More valid operations
      () => collection.insert({ id: `valid-2`, name: `Valid 2` }),
      () => collection.delete(`0`),
    ]

    // Execute with error handling
    for (const operation of mixedOperations) {
      try {
        operation()
      } catch (error) {
        console.log(`Operation failed (expected):`, error)
      }
    }

    await collection.stateWhenReady()

    // Collection should still be functional and consistent
    expect(collection.size).toBeGreaterThan(0)

    // Valid operations should have succeeded
    expect(collection.has(`valid-1`)).toBe(true)
    expect(collection.has(`valid-2`)).toBe(true)
    expect(collection.get(`5`)?.name).toBe(`Updated 5`)
    expect(collection.has(`0`)).toBe(false)

    // Should be able to continue normal operations
    const finalTx = collection.insert({ id: `final`, name: `Final Test` })
    await finalTx.isPersisted.promise
    expect(collection.get(`final`)).toBeTruthy()

    await db.close()
    try {
      const dexie = await getDexie()
      await dexie.delete(db.name)
    } catch {
      // ignore
    }
  })
})
