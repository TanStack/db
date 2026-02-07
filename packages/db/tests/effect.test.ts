import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { Query, createEffect, createTransaction, eq } from '../src/index.js'
import {
  mockSyncCollectionOptions,
  mockSyncCollectionOptionsNoInitialState,
} from './utils.js'
import type { DeltaEvent } from '../src/index.js'

// ---------------------------------------------------------------------------
// Test types and helpers
// ---------------------------------------------------------------------------

type User = {
  id: number
  name: string
  active: boolean
}

type Issue = {
  id: number
  title: string
  userId: number
}

const sampleUsers: Array<User> = [
  { id: 1, name: `Alice`, active: true },
  { id: 2, name: `Bob`, active: true },
  { id: 3, name: `Charlie`, active: false },
]

const sampleIssues: Array<Issue> = [
  { id: 1, title: `Bug report`, userId: 1 },
  { id: 2, title: `Feature request`, userId: 2 },
]

function createUsersCollection(initialData = sampleUsers) {
  return createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData,
    }),
  )
}

function createIssuesCollection(initialData = sampleIssues) {
  return createCollection(
    mockSyncCollectionOptions<Issue>({
      id: `test-issues`,
      getKey: (issue) => issue.id,
      initialData,
    }),
  )
}

/** Wait for microtasks to flush */
const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0))

/** Collect events from an effect into an array */
function collectEvents<T extends object = Record<string, unknown>>(
  events: Array<DeltaEvent<T, any>>,
) {
  return (event: DeltaEvent<T, any>) => {
    events.push(event)
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(`createEffect`, () => {
  describe(`basic delta events`, () => {
    it(`should fire 'enter' events for initial data`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      expect(events.length).toBe(3)
      expect(events.every((e) => e.type === `enter`)).toBe(true)
      expect(events.map((e) => e.value.name).sort()).toEqual([
        `Alice`,
        `Bob`,
        `Charlie`,
      ])

      await effect.dispose()
    })

    it(`should fire 'enter' event when a row is inserted into source`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        skipInitial: true,
        handler: collectEvents(events),
      })

      await flushPromises()
      expect(events.length).toBe(0) // skipInitial should suppress initial data

      // Insert a new user via sync
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 4, name: `Diana`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`enter`)
      expect(events[0]!.key).toBe(4)
      expect(events[0]!.value.name).toBe(`Diana`)

      await effect.dispose()
    })

    it(`should fire 'exit' event when a row is deleted from source`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `exit`,
        handler: collectEvents(events),
      })

      await flushPromises()
      // No exit events from initial data
      expect(events.length).toBe(0)

      // Delete a user via sync
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 1, name: `Alice`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`exit`)
      expect(events[0]!.key).toBe(1)
      expect(events[0]!.value.name).toBe(`Alice`)

      await effect.dispose()
    })

    it(`should fire 'update' event when a row is updated in source`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `update`,
        handler: collectEvents(events),
      })

      await flushPromises()
      // No update events from initial data
      expect(events.length).toBe(0)

      // Update a user via sync
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 1, name: `Alice Updated`, active: true },
        previousValue: { id: 1, name: `Alice`, active: true },
      } as any)
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`update`)
      expect(events[0]!.key).toBe(1)
      expect(events[0]!.value.name).toBe(`Alice Updated`)
      expect(events[0]!.previousValue?.name).toBe(`Alice`)

      await effect.dispose()
    })
  })

  describe(`filtered queries`, () => {
    it(`should only fire for rows matching the where clause`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q.from({ user: users }).where(({ user }) => eq(user.active, true)),
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      // Only active users (Alice, Bob) — Charlie is inactive
      expect(events.length).toBe(2)
      expect(events.map((e) => e.value.name).sort()).toEqual([`Alice`, `Bob`])

      await effect.dispose()
    })

    it(`should fire exit when a row stops matching the filter`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q.from({ user: users }).where(({ user }) => eq(user.active, true)),
        on: `delta`,
        handler: collectEvents(events),
      })

      await flushPromises()
      events.length = 0 // Clear initial enter events

      // Update Alice to inactive — should exit the filtered result
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 1, name: `Alice`, active: false },
        previousValue: { id: 1, name: `Alice`, active: true },
      } as any)
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`exit`)
      expect(events[0]!.value.name).toBe(`Alice`)

      await effect.dispose()
    })

    it(`should fire enter when a row starts matching the filter`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q.from({ user: users }).where(({ user }) => eq(user.active, true)),
        on: `delta`,
        handler: collectEvents(events),
      })

      await flushPromises()
      events.length = 0 // Clear initial events

      // Update Charlie to active — should enter the filtered result
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 3, name: `Charlie`, active: true },
        previousValue: { id: 3, name: `Charlie`, active: false },
      } as any)
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`enter`)
      expect(events[0]!.value.name).toBe(`Charlie`)

      await effect.dispose()
    })
  })

  describe(`on parameter`, () => {
    it(`should support on: 'delta' for all event types`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        handler: collectEvents(events),
      })

      await flushPromises()
      // Initial data produces enter events
      expect(events.filter((e) => e.type === `enter`).length).toBe(3)

      // Update
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 1, name: `Alice Updated`, active: true },
        previousValue: { id: 1, name: `Alice`, active: true },
      } as any)
      users.utils.commit()
      await flushPromises()

      expect(events.filter((e) => e.type === `update`).length).toBe(1)

      // Delete
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 2, name: `Bob`, active: true },
      })
      users.utils.commit()
      await flushPromises()

      expect(events.filter((e) => e.type === `exit`).length).toBe(1)

      await effect.dispose()
    })

    it(`should support on as an array of delta types`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: [`enter`, `exit`],
        handler: collectEvents(events),
      })

      await flushPromises()
      expect(events.filter((e) => e.type === `enter`).length).toBe(3)

      // Update should NOT fire (not in the on array)
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 1, name: `Alice Updated`, active: true },
        previousValue: { id: 1, name: `Alice`, active: true },
      } as any)
      users.utils.commit()
      await flushPromises()

      // Should still be 3 events (no update event)
      expect(events.length).toBe(3)

      // Delete SHOULD fire
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 2, name: `Bob`, active: true },
      })
      users.utils.commit()
      await flushPromises()

      expect(events.length).toBe(4)
      expect(events[3]!.type).toBe(`exit`)

      await effect.dispose()
    })
  })

  describe(`batchHandler`, () => {
    it(`should receive all events in a single batch per graph run`, async () => {
      const users = createUsersCollection([])
      const batches: Array<Array<DeltaEvent<User, number>>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        batchHandler: (events) => {
          batches.push([...events])
        },
      })

      await flushPromises()

      // Insert multiple users in one sync transaction
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice`, active: true },
      })
      users.utils.write({
        type: `insert`,
        value: { id: 2, name: `Bob`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      // Should receive one batch with 2 events
      expect(batches.length).toBe(1)
      expect(batches[0]!.length).toBe(2)

      await effect.dispose()
    })
  })

  describe(`skipInitial`, () => {
    it(`should skip initial data when skipInitial is true`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        skipInitial: true,
        handler: collectEvents(events),
      })

      await flushPromises()
      // Initial 3 users should be skipped
      expect(events.length).toBe(0)

      // New insert should fire
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 4, name: `Diana`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.value.name).toBe(`Diana`)

      await effect.dispose()
    })

    it(`should process initial data when skipInitial is false (default)`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      // All 3 initial users should fire enter events
      expect(events.length).toBe(3)

      await effect.dispose()
    })
  })

  describe(`error handling`, () => {
    it(`should route sync handler errors to onError`, async () => {
      const users = createUsersCollection()
      const errors: Array<{ error: Error; event: DeltaEvent<User, number> }> =
        []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: () => {
          throw new Error(`handler error`)
        },
        onError: (error, event) => {
          errors.push({ error, event })
        },
      })

      await flushPromises()

      // All 3 initial events should produce errors
      expect(errors.length).toBe(3)
      expect(errors[0]!.error.message).toBe(`handler error`)

      await effect.dispose()
    })

    it(`should route async handler errors to onError`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      const errors: Array<{ error: Error; event: DeltaEvent<User, number> }> =
        []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: () => {
          return Promise.reject(new Error(`async error`))
        },
        onError: (error, event) => {
          errors.push({ error, event })
        },
      })

      await flushPromises()

      expect(errors.length).toBe(1)
      expect(errors[0]!.error.message).toBe(`async error`)

      await effect.dispose()
    })

    it(`should log to console when no onError is provided`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      const consoleSpy = vi.spyOn(console, `error`).mockImplementation(() => {})

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: () => {
          throw new Error(`unhandled error`)
        },
      })

      await flushPromises()

      expect(consoleSpy).toHaveBeenCalled()
      consoleSpy.mockRestore()

      await effect.dispose()
    })
  })

  describe(`disposal`, () => {
    it(`should not fire events after disposal`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        skipInitial: true,
        handler: collectEvents(events),
      })

      await flushPromises()
      expect(events.length).toBe(0)

      await effect.dispose()
      expect(effect.disposed).toBe(true)

      // Insert after disposal
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 4, name: `Diana`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      // Should not have received any events
      expect(events.length).toBe(0)
    })

    it(`should await in-flight async handlers on dispose`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      let handlerCompleted = false
      let resolveHandler: (() => void) | undefined

      const handlerPromise = new Promise<void>((resolve) => {
        resolveHandler = resolve
      })

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: async () => {
          await handlerPromise
          handlerCompleted = true
        },
      })

      await flushPromises()

      // Start disposing — should wait for the handler
      const disposePromise = effect.dispose()

      // Handler hasn't completed yet
      expect(handlerCompleted).toBe(false)

      // Resolve the handler
      resolveHandler!()
      await disposePromise

      expect(handlerCompleted).toBe(true)
    })

    it(`should abort the signal on dispose`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      let capturedSignal: AbortSignal | undefined

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: (_event, ctx) => {
          capturedSignal = ctx.signal
        },
      })

      await flushPromises()
      expect(capturedSignal).toBeDefined()
      expect(capturedSignal!.aborted).toBe(false)

      await effect.dispose()
      expect(capturedSignal!.aborted).toBe(true)
    })

    it(`should be idempotent on multiple dispose calls`, async () => {
      const users = createUsersCollection()

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: () => {},
      })

      await effect.dispose()
      await effect.dispose() // Should not throw
      expect(effect.disposed).toBe(true)
    })
  })

  describe(`auto-generated IDs`, () => {
    it(`should generate incrementing IDs`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      const capturedIds: Array<string> = []

      const effect1 = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: (_event, ctx) => {
          capturedIds.push(ctx.effectId)
        },
      })

      await flushPromises()

      const effect2 = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: (_event, ctx) => {
          capturedIds.push(ctx.effectId)
        },
      })

      await flushPromises()

      // Both should have live-query-effect-{N} format
      expect(capturedIds[0]).toMatch(/^live-query-effect-\d+$/)
      expect(capturedIds[1]).toMatch(/^live-query-effect-\d+$/)
      // And they should be different
      expect(capturedIds[0]).not.toBe(capturedIds[1])

      await effect1.dispose()
      await effect2.dispose()
    })

    it(`should use custom ID when provided`, async () => {
      const users = createUsersCollection([sampleUsers[0]!])
      let capturedId: string | undefined

      const effect = createEffect<User, number>({
        id: `my-custom-effect`,
        query: (q) => q.from({ user: users }),
        on: `enter`,
        handler: (_event, ctx) => {
          capturedId = ctx.effectId
        },
      })

      await flushPromises()

      expect(capturedId).toBe(`my-custom-effect`)

      await effect.dispose()
    })
  })

  describe(`QueryBuilder instance input`, () => {
    it(`should accept a QueryBuilder instance`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []

      const queryBuilder = new Query()
        .from({ user: users })
        .where(({ user }) => eq(user.active, true))

      const effect = createEffect<User, number>({
        query: queryBuilder,
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      expect(events.length).toBe(2) // Only active users
      expect(events.map((e) => e.value.name).sort()).toEqual([`Alice`, `Bob`])

      await effect.dispose()
    })
  })

  describe(`join queries`, () => {
    it(`should work with joined collections`, async () => {
      const users = createUsersCollection()
      const issues = createIssuesCollection()
      const events: Array<DeltaEvent<any, any>> = []

      const effect = createEffect({
        query: (q) =>
          q
            .from({ issue: issues })
            .join({ user: users }, ({ issue, user }) =>
              eq(issue.userId, user.id),
            )
            .select(({ issue, user }) => ({
              issueId: issue.id,
              title: issue.title,
              userName: user.name,
            })),
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      expect(events.length).toBe(2)
      const titles = events.map((e) => e.value.title).sort()
      expect(titles).toEqual([`Bug report`, `Feature request`])

      // Verify joined data is present
      const bugReport = events.find((e) => e.value.title === `Bug report`)
      expect(bugReport!.value.userName).toBe(`Alice`)

      await effect.dispose()
    })
  })

  describe(`row transitions`, () => {
    it(`should fire enter then exit when a row is inserted and deleted`, async () => {
      const users = createUsersCollection([])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        handler: collectEvents(events),
      })

      await flushPromises()

      // Insert
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 10, name: `Eve`, active: true },
      })
      users.utils.commit()
      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`enter`)
      expect(events[0]!.value.name).toBe(`Eve`)

      // Delete
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 10, name: `Eve`, active: true },
      })
      users.utils.commit()
      await flushPromises()

      expect(events.length).toBe(2)
      expect(events[1]!.type).toBe(`exit`)
      expect(events[1]!.value.name).toBe(`Eve`)

      await effect.dispose()
    })
  })

  describe(`select queries`, () => {
    it(`should work with select to project specific fields`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<any, any>> = []

      const effect = createEffect({
        query: (q) =>
          q
            .from({ user: users })
            .where(({ user }) => eq(user.active, true))
            .select(({ user }) => ({
              id: user.id,
              name: user.name,
            })),
        on: `enter`,
        handler: collectEvents(events),
      })

      await flushPromises()

      expect(events.length).toBe(2)
      // Should only have projected fields
      const alice = events.find((e) => e.value.name === `Alice`)
      expect(alice).toBeDefined()
      expect(alice!.value.id).toBe(1)
      // The projected result should not have the `active` field
      expect(alice!.value.active).toBeUndefined()

      await effect.dispose()
    })
  })

  describe(`transaction coalescing`, () => {
    it(`should coalesce multiple changes within a transaction into a single batch`, async () => {
      const users = createUsersCollection([])
      const batches: Array<Array<DeltaEvent<User, number>>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        batchHandler: (events) => {
          batches.push([...events])
        },
      })

      await flushPromises()

      // Use a transaction to batch multiple inserts.
      // The scheduler defers graph runs until the transaction flushes.
      const tx = createTransaction({
        mutationFn: async () => {},
      })
      tx.mutate(() => {
        users.utils.begin()
        users.utils.write({
          type: `insert`,
          value: { id: 10, name: `Eve`, active: true },
        })
        users.utils.commit()

        users.utils.begin()
        users.utils.write({
          type: `insert`,
          value: { id: 11, name: `Frank`, active: true },
        })
        users.utils.commit()

        users.utils.begin()
        users.utils.write({
          type: `insert`,
          value: { id: 12, name: `Grace`, active: true },
        })
        users.utils.commit()
      })

      await flushPromises()

      // All 3 inserts should be in a single batch (coalesced by the scheduler)
      expect(batches.length).toBe(1)
      expect(batches[0]!.length).toBe(3)
      expect(batches[0]!.every((e) => e.type === `enter`)).toBe(true)
      expect(batches[0]!.map((e) => e.value.name).sort()).toEqual([
        `Eve`,
        `Frank`,
        `Grace`,
      ])

      await effect.dispose()
    })

    it(`should run graph immediately when not in a transaction`, async () => {
      const users = createUsersCollection([])
      const batches: Array<Array<DeltaEvent<User, number>>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        batchHandler: (events) => {
          batches.push([...events])
        },
      })

      await flushPromises()

      // Without a transaction, each change runs the graph immediately
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 10, name: `Eve`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 11, name: `Frank`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      // Each insert should be a separate batch (no coalescing)
      expect(batches.length).toBe(2)
      expect(batches[0]!.length).toBe(1)
      expect(batches[1]!.length).toBe(1)

      await effect.dispose()
    })
  })

  describe(`truncate handling`, () => {
    it(`should emit exit events for all items then enter events for re-inserted items after truncate`, async () => {
      const options = mockSyncCollectionOptionsNoInitialState<User>({
        id: `test-truncate-users`,
        getKey: (user) => user.id,
      })
      const users = createCollection(options)
      users.startSyncImmediate()

      // Manually insert initial data and mark ready
      options.utils.begin()
      options.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice`, active: true },
      })
      options.utils.write({
        type: `insert`,
        value: { id: 2, name: `Bob`, active: true },
      })
      options.utils.commit()
      options.utils.markReady()

      await flushPromises()

      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()

      // skipInitial — no events yet
      expect(events.length).toBe(0)

      // Truncate: delete everything and re-insert a subset
      options.utils.begin()
      options.utils.truncate()
      options.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice-v2`, active: true },
      })
      options.utils.write({
        type: `insert`,
        value: { id: 3, name: `Charlie`, active: false },
      })
      options.utils.commit()

      await flushPromises()

      // Bob was deleted (exit), Alice was updated (exit old + enter new),
      // Charlie was inserted (enter)
      const exits = events.filter((e) => e.type === `exit`)
      const enters = events.filter((e) => e.type === `enter`)
      const updates = events.filter((e) => e.type === `update`)

      // Bob should have exited
      expect(
        exits.some((e) => e.value.name === `Bob`) ||
          exits.some((e) => e.value.name === `Bob`),
      ).toBe(true)

      // Charlie should have entered
      expect(enters.some((e) => e.value.name === `Charlie`)).toBe(true)

      // Alice should be an update (same key, new value) or exit+enter
      const aliceUpdate = updates.find(
        (e) => e.key === 1 || e.value.name === `Alice-v2`,
      )
      const aliceEnter = enters.find(
        (e) => e.key === 1 || e.value.name === `Alice-v2`,
      )
      expect(aliceUpdate ?? aliceEnter).toBeDefined()

      await effect.dispose()
    })

    it(`should handle truncate that clears all items`, async () => {
      const options = mockSyncCollectionOptionsNoInitialState<User>({
        id: `test-truncate-clear`,
        getKey: (user) => user.id,
      })
      const users = createCollection(options)
      users.startSyncImmediate()

      // Insert initial data and mark ready
      options.utils.begin()
      options.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice`, active: true },
      })
      options.utils.write({
        type: `insert`,
        value: { id: 2, name: `Bob`, active: true },
      })
      options.utils.commit()
      options.utils.markReady()

      await flushPromises()

      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      expect(events.length).toBe(0)

      // Truncate without re-inserting anything
      options.utils.begin()
      options.utils.truncate()
      options.utils.commit()

      await flushPromises()

      // All items should have exit events
      expect(events.length).toBe(2)
      expect(events.every((e) => e.type === `exit`)).toBe(true)
      const exitNames = events.map((e) => e.value.name).sort()
      expect(exitNames).toEqual([`Alice`, `Bob`])

      await effect.dispose()
    })

    it(`should accept new data after truncate`, async () => {
      const options = mockSyncCollectionOptionsNoInitialState<User>({
        id: `test-truncate-then-insert`,
        getKey: (user) => user.id,
      })
      const users = createCollection(options)
      users.startSyncImmediate()

      options.utils.begin()
      options.utils.write({
        type: `insert`,
        value: { id: 1, name: `Alice`, active: true },
      })
      options.utils.commit()
      options.utils.markReady()

      await flushPromises()

      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      expect(events.length).toBe(0)

      // Truncate everything
      options.utils.begin()
      options.utils.truncate()
      options.utils.commit()

      await flushPromises()
      events.length = 0

      // Now insert fresh data — effect should see enter events
      options.utils.begin()
      options.utils.write({
        type: `insert`,
        value: { id: 10, name: `NewUser`, active: true },
      })
      options.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`enter`)
      expect(events[0]!.value.name).toBe(`NewUser`)

      await effect.dispose()
    })
  })

  describe(`orderBy with limit`, () => {
    it(`should only emit enter events for items within the top-K window`, async () => {
      const users = createUsersCollection([
        { id: 1, name: `Alice`, active: true },
        { id: 2, name: `Bob`, active: true },
        { id: 3, name: `Charlie`, active: true },
        { id: 4, name: `Dave`, active: true },
        { id: 5, name: `Eve`, active: true },
      ])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q
            .from({ user: users })
            .orderBy(({ user }) => user.name, `asc`)
            .limit(3),
        on: `delta`,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()

      // Only the top 3 alphabetically (Alice, Bob, Charlie) should enter
      expect(events.length).toBe(3)
      expect(events.every((e) => e.type === `enter`)).toBe(true)
      const names = events.map((e) => e.value.name).sort()
      expect(names).toEqual([`Alice`, `Bob`, `Charlie`])

      await effect.dispose()
    })

    it(`should emit enter and exit events when an insert displaces an item from the window`, async () => {
      const users = createUsersCollection([
        { id: 1, name: `Bob`, active: true },
        { id: 2, name: `Charlie`, active: true },
        { id: 3, name: `Dave`, active: true },
      ])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q
            .from({ user: users })
            .orderBy(({ user }) => user.name, `asc`)
            .limit(3),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      expect(events.length).toBe(0)

      // Insert 'Alice' — alphabetically first, pushes 'Dave' out of the window
      users.utils.begin()
      users.utils.write({
        type: `insert`,
        value: { id: 4, name: `Alice`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      // Alice enters the window, Dave exits
      const enters = events.filter((e) => e.type === `enter`)
      const exits = events.filter((e) => e.type === `exit`)

      expect(enters.length).toBe(1)
      expect(enters[0]!.value.name).toBe(`Alice`)

      expect(exits.length).toBe(1)
      expect(exits[0]!.value.name).toBe(`Dave`)

      await effect.dispose()
    })

    it(`should emit exit event when a delete opens a window slot and new item enters`, async () => {
      const users = createUsersCollection([
        { id: 1, name: `Alice`, active: true },
        { id: 2, name: `Bob`, active: true },
        { id: 3, name: `Charlie`, active: true },
        { id: 4, name: `Dave`, active: true },
      ])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q
            .from({ user: users })
            .orderBy(({ user }) => user.name, `asc`)
            .limit(3),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      expect(events.length).toBe(0)

      // Delete Alice — Bob, Charlie remain, Dave should enter
      users.utils.begin()
      users.utils.write({
        type: `delete`,
        value: { id: 1, name: `Alice`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      const exits = events.filter((e) => e.type === `exit`)
      const enters = events.filter((e) => e.type === `enter`)

      expect(exits.length).toBe(1)
      expect(exits[0]!.value.name).toBe(`Alice`)

      expect(enters.length).toBe(1)
      expect(enters[0]!.value.name).toBe(`Dave`)

      await effect.dispose()
    })

    it(`should handle desc ordering with limit`, async () => {
      const users = createUsersCollection([
        { id: 1, name: `Alice`, active: true },
        { id: 2, name: `Bob`, active: true },
        { id: 3, name: `Charlie`, active: true },
        { id: 4, name: `Dave`, active: true },
      ])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q
            .from({ user: users })
            .orderBy(({ user }) => user.name, `desc`)
            .limit(2),
        on: `delta`,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()

      // Top 2 by desc: Dave, Charlie
      expect(events.length).toBe(2)
      expect(events.every((e) => e.type === `enter`)).toBe(true)
      const names = events.map((e) => e.value.name).sort()
      expect(names).toEqual([`Charlie`, `Dave`])

      await effect.dispose()
    })

    it(`should emit update event when an item changes but stays in the window`, async () => {
      const users = createUsersCollection([
        { id: 1, name: `Alice`, active: true },
        { id: 2, name: `Bob`, active: true },
        { id: 3, name: `Charlie`, active: true },
      ])
      const events: Array<DeltaEvent<User, number>> = []

      const effect = createEffect<User, number>({
        query: (q) =>
          q
            .from({ user: users })
            .orderBy(({ user }) => user.name, `asc`)
            .limit(3),
        on: `delta`,
        skipInitial: true,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      expect(events.length).toBe(0)

      // Update Alice's active flag — she stays in the window
      users.utils.begin()
      users.utils.write({
        type: `update`,
        value: { id: 1, name: `Alice`, active: false },
        previousValue: { id: 1, name: `Alice`, active: true },
      })
      users.utils.commit()

      await flushPromises()

      expect(events.length).toBe(1)
      expect(events[0]!.type).toBe(`update`)
      expect(events[0]!.value.active).toBe(false)
      expect(events[0]!.previousValue?.active).toBe(true)

      await effect.dispose()
    })
  })

  describe(`source error handling`, () => {
    it(`should auto-dispose when source collection is cleaned up`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []
      const consoleErrorSpy = vi
        .spyOn(console, `error`)
        .mockImplementation(() => {})

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()

      // Should receive initial events
      expect(events.length).toBe(3)
      expect(effect.disposed).toBe(false)

      // Clean up the source collection — should auto-dispose the effect
      await users.cleanup()
      await flushPromises()

      expect(effect.disposed).toBe(true)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`cleaned up`),
      )

      consoleErrorSpy.mockRestore()
    })

    it(`should not fire events after source collection is cleaned up`, async () => {
      const users = createUsersCollection()
      const events: Array<DeltaEvent<User, number>> = []
      vi.spyOn(console, `error`).mockImplementation(() => {})

      const effect = createEffect<User, number>({
        query: (q) => q.from({ user: users }),
        on: `delta`,
        handler: (event) => {
          events.push(event)
        },
      })

      await flushPromises()
      const countAfterInit = events.length

      // Clean up source — effect auto-disposes
      await users.cleanup()
      await flushPromises()

      expect(effect.disposed).toBe(true)
      // No new events should have been received from the cleanup itself
      // (the disposed guard prevents any further processing)
      expect(events.length).toBe(countAfterInit)

      vi.restoreAllMocks()
    })
  })
})
