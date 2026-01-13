import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../src/electric'
import type { Message, Row } from '@electric-sql/client'

/**
 * Test suite for reproducing the bug described in GitHub issue #1122:
 * "The pending sync transaction is already committed, you can't commit it again"
 *
 * This bug occurs in progressive mode when:
 * 1. Initial sync completes (atomic swap)
 * 2. Browser visibility changes (tab switch)
 * 3. Visibility handler triggers resume
 * 4. New messages arrive and try to commit an already-committed transaction
 *
 * The root cause identified:
 * 1. During atomic swap, `begin()` is called but `transactionStarted` is never set to `true`
 * 2. If a buffered move-out message calls `begin()` again (because transactionStarted is false),
 *    a second transaction is created
 * 3. `commit()` only commits the last transaction, leaving earlier ones orphaned
 * 4. On visibility resume, the orphaned transaction state can cause issues
 *
 * Additionally, after atomic swap:
 * 1. `transactionStarted` remains `false`
 * 2. This is correct behavior for the atomic swap path
 * 3. But any subsequent processing must handle this correctly
 */

// Mock the ShapeStream module
const mockSubscribe = vi.fn()
const mockRequestSnapshot = vi.fn()
const mockFetchSnapshot = vi.fn()
const mockStream = {
  subscribe: mockSubscribe,
  requestSnapshot: mockRequestSnapshot,
  fetchSnapshot: mockFetchSnapshot,
}

vi.mock(`@electric-sql/client`, async () => {
  const actual = await vi.importActual(`@electric-sql/client`)
  return {
    ...actual,
    ShapeStream: vi.fn(() => mockStream),
  }
})

describe(`Progressive mode visibility resume bug (Issue #1122)`, () => {
  let subscriber: (messages: Array<Message<Row>>) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockSubscribe.mockImplementation((callback) => {
      subscriber = callback
      return () => {}
    })
    mockRequestSnapshot.mockResolvedValue(undefined)
    mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })
  })

  /**
   * This test reproduces the core bug: after atomic swap completes in progressive mode,
   * if a visibility change causes the stream to resume and send an up-to-date message
   * without any change messages, the transaction state becomes inconsistent.
   *
   * The sequence is:
   * 1. Initial sync with atomic swap (begin, truncate, apply, commit)
   * 2. transactionStarted remains false (never set in atomic swap path)
   * 3. Visibility change causes resume
   * 4. Stream sends up-to-date without change messages
   * 5. Since transactionStarted is false, we shouldn't call commit()
   * 6. But the bug might be elsewhere...
   */
  it(`should not throw SyncTransactionAlreadyCommittedError after visibility resume in progressive mode`, () => {
    const config = {
      id: `progressive-visibility-resume-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Initial sync with atomic swap
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection.has(1)).toBe(true)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Phase 2: Simulate visibility change resume - stream sends only up-to-date
    // This simulates what happens when the visibility handler triggers resume
    // and the stream sends a "keepalive" up-to-date message
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * This test simulates the scenario where after atomic swap, a visibility
   * resume causes the stream to send new change messages followed by up-to-date.
   * This should work correctly.
   */
  it(`should handle new changes after visibility resume in progressive mode`, () => {
    const config = {
      id: `progressive-visibility-new-changes-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Initial sync with atomic swap
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection.has(1)).toBe(true)

    // Phase 2: Simulate visibility resume with new changes
    expect(() => {
      subscriber([
        {
          key: `2`,
          value: { id: 2, name: `User 2` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.has(2)).toBe(true)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * This test simulates the scenario where visibility changes happen during
   * the buffering phase (before the first up-to-date). The stream might
   * send the same messages again.
   */
  it(`should handle duplicate messages during buffering phase in progressive mode`, () => {
    const config = {
      id: `progressive-duplicate-messages-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Partial sync (buffering, no up-to-date yet)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
    ])

    expect(testCollection.status).toBe(`loading`)
    expect(testCollection.has(1)).toBe(false) // Still buffered

    // Phase 2: Simulate visibility resume - same messages sent again
    // (due to stream replay or offset handling)
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
    ])

    expect(testCollection.status).toBe(`loading`)

    // Phase 3: Finally receive up-to-date (atomic swap should handle duplicates)
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection.has(1)).toBe(true)
  })

  /**
   * This test reproduces a more specific scenario from the bug report:
   * After a mutation triggers sync, visibility change during sync processing
   * causes the error.
   *
   * The scenario involves:
   * 1. Initial sync completes
   * 2. User performs a mutation (triggers onInsert/onUpdate/onDelete)
   * 3. Sync messages arrive
   * 4. User switches tabs (visibility hidden)
   * 5. User returns (visibility visible)
   * 6. resume_fn triggers, more messages arrive
   * 7. Error occurs on commit
   */
  it(`should handle visibility change during active sync in progressive mode`, () => {
    const config = {
      id: `progressive-active-sync-visibility-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Initial sync completes
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)

    // Phase 2: New sync starts (simulating mutation feedback)
    // But only partial messages arrive before visibility change
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert` },
      },
    ])

    // At this point, a transaction is started but not committed
    // (no up-to-date received yet)

    // Phase 3: Visibility change causes resume, and the stream might
    // send the same or new messages including up-to-date
    // This is the critical moment where the bug can occur
    expect(() => {
      subscriber([
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.has(2)).toBe(true)
    expect(testCollection.has(3)).toBe(true)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * This test specifically targets the issue with move-out messages
   * during atomic swap calling begin() again.
   *
   * BUG SCENARIO:
   * 1. Atomic swap starts: begin() is called (tx1 created)
   * 2. Move-out message is processed with transactionStarted=false
   * 3. processMoveOutEvent calls begin() again (tx2 created) - BUG!
   * 4. commit() only commits tx2, tx1 remains uncommitted
   * 5. On visibility resume, tx1 is still there, causing issues
   */
  it(`should handle move-out messages during atomic swap without duplicate begin calls`, () => {
    const config = {
      id: `progressive-move-out-atomic-swap-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Initial sync with move-out during buffering phase
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert`, tags: [`tag1`] },
      },
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert`, tags: [`tag1`] },
      },
    ])

    // Buffering phase - data not visible yet
    expect(testCollection.status).toBe(`loading`)

    // Send move-out message (while still buffering) followed by up-to-date
    // This triggers atomic swap with a move-out message in the buffer
    expect(() => {
      subscriber([
        {
          headers: {
            control: `move-out`,
            patterns: [[`tag1`]],
          },
        } as any,
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.status).toBe(`ready`)
    // CRITICAL: After atomic swap, there should be NO pending uncommitted transactions
    // If the bug exists, tx1 from the atomic swap start would still be here
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Phase 2: Visibility resume after atomic swap
    expect(() => {
      subscriber([
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.has(3)).toBe(true)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * Test that specifically reproduces the SyncTransactionAlreadyCommittedError.
   *
   * The bug occurs when:
   * 1. A transaction is started and committed
   * 2. But the transaction state (pendingSyncedTransactions) is not properly cleared
   * 3. A subsequent commit() call tries to commit the same transaction again
   */
  it(`should not allow double commit on the same transaction`, () => {
    const config = {
      id: `progressive-double-commit-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Initial sync
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Simulate a scenario where multiple up-to-date messages arrive
    // (could happen during visibility resume if stream replays)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert` },
      },
    ])

    // First up-to-date - should commit the transaction
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.has(2)).toBe(true)

    // Second up-to-date (simulating replay) - should NOT throw
    // because transactionStarted should be false after first commit
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * Test that sync messages work correctly when there's a persisting transaction.
   *
   * When there's a persisting (optimistic) transaction:
   * 1. Sync transactions are committed but not removed from pendingSyncedTransactions
   * 2. This is by design to avoid interference with optimistic mutations
   * 3. The sync transactions are cleaned up when the persisting transaction completes
   * 4. Crucially, subsequent sync messages should NOT throw errors
   */
  it(`should handle sync messages while optimistic mutation is persisting in progressive mode`, async () => {
    vi.clearAllMocks()

    let testSubscriber!: (messages: Array<Message<Row>>) => void
    mockSubscribe.mockImplementation((callback) => {
      testSubscriber = callback
      return () => {}
    })
    mockRequestSnapshot.mockResolvedValue(undefined)
    mockFetchSnapshot.mockResolvedValue({ metadata: {}, data: [] })

    // Create a mock for the onInsert handler that doesn't resolve immediately
    // This simulates a persisting transaction
    let resolveInsert!: () => void
    const insertPromise = new Promise<void>((resolve) => {
      resolveInsert = resolve
    })

    const config = {
      id: `progressive-persisting-tx-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
      onInsert: async () => {
        await insertPromise
        // Don't return txid - just complete the mutation without waiting for sync
      },
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Phase 1: Initial sync completes
    testSubscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Phase 2: User performs an optimistic insert (creates a persisting transaction)
    testCollection.insert({ id: 100, name: `New User` })

    // At this point, there should be a persisting transaction
    expect(testCollection._state.transactions.size).toBeGreaterThan(0)

    // Phase 3: While the mutation is persisting, sync messages arrive
    testSubscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Committed sync transactions are kept when there's a persisting transaction
    expect(testCollection._state.pendingSyncedTransactions.length).toBeGreaterThanOrEqual(1)

    // Phase 4: More sync messages arrive (simulating visibility resume)
    // This should NOT throw SyncTransactionAlreadyCommittedError
    expect(() => {
      testSubscriber([
        {
          key: `3`,
          value: { id: 3, name: `User 3` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    // Phase 5: Resolve the insert to complete the persisting transaction
    resolveInsert()
    await new Promise((resolve) => setTimeout(resolve, 10))

    // Phase 6: After persisting transaction completes, new sync should work
    expect(() => {
      testSubscriber([
        {
          key: `4`,
          value: { id: 4, name: `User 4` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    // All sync transactions should eventually be processed
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * Test multiple rapid visibility changes (user quickly switching between tabs)
   */
  it(`should handle multiple rapid visibility changes in progressive mode`, () => {
    const config = {
      id: `progressive-rapid-visibility-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Initial sync
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)

    // Simulate multiple rapid visibility changes with up-to-date messages
    for (let i = 0; i < 10; i++) {
      expect(() => {
        subscriber([
          {
            headers: { control: `up-to-date` },
          },
        ])
      }).not.toThrow()
    }

    expect(testCollection.status).toBe(`ready`)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * Test the specific scenario where a batch contains only up-to-date
   * after changes were sent in a previous batch (simulating network delay)
   */
  it(`should handle up-to-date in separate batch after changes in progressive mode`, () => {
    const config = {
      id: `progressive-separate-uptodate-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Initial sync
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    expect(testCollection.status).toBe(`ready`)

    // Batch 1: Only changes (no up-to-date)
    subscriber([
      {
        key: `2`,
        value: { id: 2, name: `User 2` },
        headers: { operation: `insert` },
      },
    ])

    // Batch 2: Only up-to-date (simulating visibility resume or network delay)
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection.has(2)).toBe(true)
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Batch 3: Another visibility resume - just up-to-date
    expect(() => {
      subscriber([
        {
          headers: { control: `up-to-date` },
        },
      ])
    }).not.toThrow()

    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
  })

  /**
   * This test specifically reproduces the bug scenario from the issue:
   * After the sync is complete and the transaction is committed,
   * if commit() is somehow called again, we should get the error.
   *
   * We test that our fix prevents this by ensuring proper state management.
   */
  it(`should not have orphaned committed transactions after atomic swap`, () => {
    const config = {
      id: `progressive-orphan-transaction-test`,
      shapeOptions: {
        url: `http://test-url`,
        params: { table: `test_table` },
      },
      syncMode: `progressive` as const,
      getKey: (item: Row) => item.id as number,
      startSync: true,
    }

    const testCollection = createCollection(electricCollectionOptions(config))

    // Initial sync with atomic swap
    subscriber([
      {
        key: `1`,
        value: { id: 1, name: `User 1` },
        headers: { operation: `insert` },
      },
      {
        headers: { control: `up-to-date` },
      },
    ])

    // Verify no orphaned transactions
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)

    // Check that all transactions are properly committed and removed
    // If there are any transactions, they should not be committed (they'd be pending)
    // Actually, there should be no transactions at all after successful commit
    expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
    expect(
      testCollection._state.pendingSyncedTransactions.every((t) => !t.committed),
    ).toBe(true)

    // Now simulate multiple visibility resumes
    for (let i = 0; i < 5; i++) {
      subscriber([
        {
          key: `${i + 2}`,
          value: { id: i + 2, name: `User ${i + 2}` },
          headers: { operation: `insert` },
        },
        {
          headers: { control: `up-to-date` },
        },
      ])

      // After each batch, no orphaned transactions
      expect(testCollection._state.pendingSyncedTransactions.length).toBe(0)
    }

    expect(testCollection.size).toBe(6)
  })
})
