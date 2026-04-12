/**
 * Regression test for TanStack/db#1017
 *
 * When a direct insert's onInsert handler syncs data back (e.g., Electric's
 * txid handshake), the item must never disappear from the collection during
 * the optimistic → synced transition.
 */
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'

interface Item {
  id: string
  title: string
}

describe(`Reconciliation gap (#1017)`, () => {
  it(`item should not disappear when onInsert syncs data back`, async () => {
    let syncBegin: (() => void) | undefined
    let syncWrite:
      | ((msg: { type: `insert`; value: Item }) => void)
      | undefined
    let syncCommit: (() => void) | undefined
    let syncMarkReady: (() => void) | undefined

    const collection = createCollection<Item>({
      id: `reconciliation-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (params) => {
          syncBegin = params.begin
          syncWrite = params.write
          syncCommit = params.commit
          syncMarkReady = params.markReady
        },
      },
      onInsert: async ({ transaction }) => {
        const item = transaction.mutations[0].modified

        // Simulate Electric's onInsert flow:
        // 1. Server accepts the write (REST API call)
        // 2. Electric streams the committed row back via WAL
        // 3. Sync delivers the row to the collection
        syncBegin!()
        syncWrite!({ type: `insert`, value: item })
        syncCommit!()

        // 4. Return (like Electric's awaitTxId resolving)
        return {}
      },
    })

    syncMarkReady!()
    await collection.stateWhenReady()

    // Insert — triggers optimistic insert + onInsert sync cycle.
    collection.insert({ id: `item-1`, title: `Test item` })

    // The item must ALWAYS be visible — never undefined.
    // Before the fix, touchCollection() called onTransactionStateChange()
    // (clearing optimistic state) before commitPendingTransactions()
    // (writing synced data), creating a gap.
    expect(collection.get(`item-1`)).toBeDefined()
    expect(collection.has(`item-1`)).toBe(true)

    // Allow async settlement.
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Still visible after full settlement.
    expect(collection.get(`item-1`)).toBeDefined()
  })

  it(`item visibility should have no gap during transition`, async () => {
    let syncBegin: (() => void) | undefined
    let syncWrite:
      | ((msg: { type: `insert`; value: Item }) => void)
      | undefined
    let syncCommit: (() => void) | undefined
    let syncMarkReady: (() => void) | undefined
    const visibility: Array<boolean> = []

    const collection = createCollection<Item>({
      id: `visibility-gap-test`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: (params) => {
          syncBegin = params.begin
          syncWrite = params.write
          syncCommit = params.commit
          syncMarkReady = params.markReady
        },
      },
      onInsert: async ({ transaction }) => {
        const item = transaction.mutations[0].modified

        // Capture visibility before sync delivery.
        visibility.push(collection.has(`item-1`))

        syncBegin!()
        syncWrite!({ type: `insert`, value: item })
        syncCommit!()

        // Capture visibility after sync delivery.
        visibility.push(collection.has(`item-1`))
        return {}
      },
    })

    syncMarkReady!()
    await collection.stateWhenReady()

    // Before insert: not visible.
    visibility.push(collection.has(`item-1`))

    collection.insert({ id: `item-1`, title: `Visibility test` })

    // After insert returns: must be visible.
    visibility.push(collection.has(`item-1`))

    await new Promise((resolve) => setTimeout(resolve, 50))

    // After settlement: still visible.
    visibility.push(collection.has(`item-1`))

    // Expected: [false, true, true, true, true]
    // The item should be visible at every checkpoint after creation.
    expect(visibility).toEqual([false, true, true, true, true])
  })
})
