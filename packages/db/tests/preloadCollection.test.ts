import { beforeEach, describe, expect, it, vi } from "vitest"
import { preloadCollection } from "../src/collection"
import type { CollectionConfig } from "../src/types"

describe(`preloadCollection`, () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it(`should resolve once the first commit is done`, async () => {
    // Create a mock sync function that will call begin, write, and commit
    let commitFn: () => void

    const config: { id: string } & CollectionConfig = {
      id: `test-collection`,
      sync: {
        sync: ({ begin, write, commit }) => {
          // Store the commit function to call it later
          commitFn = commit

          // Start the transaction
          begin()

          // Write some data
          write({
            key: `test`,
            value: { name: `Test Item` },
            type: `insert`,
          })

          // We'll call commit later in the test
        },
      },
    }

    // Create a preload promise
    const preloadPromise = preloadCollection(config)

    // The promise should not resolve yet
    let resolved = false
    preloadPromise.then(() => {
      resolved = true
    })

    // Wait a tick to allow any synchronous resolution
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(resolved).toBe(false)

    // Now commit the transaction
    commitFn!()

    // Wait for the promise to resolve
    await preloadPromise
    expect(resolved).toBe(true)
  })

  it(`should resolve immediately if already loaded`, async () => {
    // Create a mock sync function
    let commitCalled = 0
    const config: { id: string } & CollectionConfig = {
      id: `test-collection-2`,
      sync: {
        sync: ({ begin, write, commit }) => {
          begin()
          write({
            key: `test`,
            value: { name: `Test Item` },
            type: `insert`,
          })
          Promise.resolve().then(() => {
            commit()
            commitCalled++
          })
        },
      },
    }

    // First call should create the collection and wait for commit
    await preloadCollection(config)
    expect(commitCalled).toBe(1)

    // Second call should resolve immediately because collection already exists
    // and has committed
    await preloadCollection(config)
    expect(commitCalled).toBe(1) // Sync should not be called again
    expect(commitCalled).toBe(1) // Sync should not be called again
  })

  it(`should return the same promise for concurrent preload calls`, async () => {
    let commitFn: () => void
    let beginCalled = 0

    const config: { id: string } & CollectionConfig = {
      id: `test-collection-3`,
      sync: {
        sync: ({ begin, write, commit }) => {
          beginCalled++
          commitFn = commit
          begin()
          write({
            key: `test`,
            value: { name: `Test Item` },
            type: `insert`,
          })
          // Don't commit yet
        },
      },
    }

    // Create two preload promises
    const promise1 = preloadCollection(config)
    const promise2 = preloadCollection(config)

    // They should be the same promise
    expect(promise1).toBe(promise2)
    expect(beginCalled).toBe(1) // Sync should only be called once

    // Now commit
    commitFn!()

    // Both promises should resolve
    await Promise.all([promise1, promise2])
  })
})
