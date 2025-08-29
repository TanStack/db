import { describe, expect, it } from "vitest"
import { createCollection } from "../src/collection"
import { createTransaction } from "../src/transactions"
import type { ChangeMessage } from "../src/types"

describe(`Regression - truncate/must-refetch ordering`, () => {
  it(`should apply rebuild after must-refetch even if a user tx persists`, () => {
    type Row = { id: number; name: string }

    let testSyncFunctions!: {
      begin: () => void
      write: (m: Omit<ChangeMessage<Row>, `key`>) => void
      commit: () => void
      truncate: () => void
    }

    const collection = createCollection<Row>({
      id: `repro-must-refetch-rebuild`,
      getKey: (r) => r.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, truncate }) => {
          testSyncFunctions = { begin, write, commit, truncate }
        },
      },
    })

    // Persisting user transaction blocks normal sync application
    const holdTx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: async () => new Promise(() => {}),
    })
    holdTx.mutate(() => {
      collection.insert({ id: 999, name: `hold` }, { optimistic: false })
    })
    void holdTx.commit()

    // Must-refetch (truncate) commits and empties
    testSyncFunctions.begin()
    testSyncFunctions.truncate()
    testSyncFunctions.commit()
    expect(collection.state.size).toBe(0)

    // Rebuild arrives as committed sync; expected to apply even though user tx persists
    testSyncFunctions.begin()
    testSyncFunctions.write({ type: `insert`, value: { id: 1, name: `one` } })
    testSyncFunctions.commit()

    // Expected: 1 (rebuild applied). If this remains 0, the bug is present.
    expect(collection.state.size).toBe(1)
    expect(collection.state.get(1)?.name).toBe(`one`)
  })

  it(`should preserve previous data when truncate-only commit arrives during persisting user transaction`, async () => {
    type Row = { id: number; name: string }

    let testSyncFunctions!: {
      begin: () => void
      write: (m: Omit<ChangeMessage<Row>, `key`>) => void
      commit: () => void
      truncate: () => void
    }

    const collection = createCollection<Row>({
      id: `repro-truncate-only`,
      getKey: (r) => r.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, truncate }) => {
          testSyncFunctions = { begin, write, commit, truncate }
        },
      },
    })

    // Initial data committed and applied
    testSyncFunctions.begin()
    testSyncFunctions.write({ type: `insert`, value: { id: 1, name: `one` } })
    testSyncFunctions.write({ type: `insert`, value: { id: 2, name: `two` } })
    testSyncFunctions.commit()
    await collection.stateWhenReady()
    expect(collection.state.size).toBe(2)

    // Persisting user tx blocks normal sync application
    const holdTx = createTransaction<Row>({
      autoCommit: false,
      mutationFn: async () => new Promise(() => {}),
    })
    holdTx.mutate(() => {
      collection.insert({ id: 999, name: `hold` }, { optimistic: false })
    })
    void holdTx.commit()

    // Truncate-only commit (must-refetch without rebuild yet)
    testSyncFunctions.begin()
    testSyncFunctions.truncate()
    testSyncFunctions.commit()

    // Expected: previous data remains until rebuild arrives
    expect(collection.state.size).toBe(2)
    expect(collection.state.has(1)).toBe(true)
    expect(collection.state.has(2)).toBe(true)
  })
})
