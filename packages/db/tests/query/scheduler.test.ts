import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { createLiveQueryCollection, eq, isNull } from '../../src/query/index.js'
import { createTransaction } from '../../src/transactions.js'
import { createOptimisticAction } from '../../src/optimistic-action.js'
import {
  Scheduler,
  getActivePublicationContext,
  recordPublicationError,
  transactionScopedScheduler,
  withPublicationContext,
} from '../../src/scheduler.js'
import { CollectionConfigBuilder } from '../../src/query/live/collection-config-builder.js'
import { getCollectionBuilder } from '../../src/query/live/collection-registry.js'
import { CollectionSubscriber } from '../../src/query/live/collection-subscriber.js'
import { Query, createEffect } from '../../src/index.js'
import {
  flushPromises,
  mockSyncCollectionOptions,
  stripVirtualProps,
} from '../utils.js'
import type { SchedulerContextId } from '../../src/scheduler.js'
import type { OutputWithVirtual } from '../utils.js'
import type { FullSyncState } from '../../src/query/live/types.js'
import type { SyncConfig } from '../../src/types.js'

type SchedulerInternals = {
  contexts: Map<SchedulerContextId, { jobs: Map<unknown, unknown> }>
}
const flushAll = (scheduler: Scheduler) => {
  const { contexts } = scheduler as unknown as SchedulerInternals
  for (const contextId of Array.from(contexts.keys()))
    scheduler.flush(contextId)
}
const hasPendingJobs = (
  scheduler: Scheduler,
  contextId: SchedulerContextId,
) => {
  const { contexts } = scheduler as unknown as SchedulerInternals
  return (contexts.get(contextId)?.jobs.size ?? 0) > 0
}

interface ChangeMessageLike {
  type: string
  value: any
}

interface User {
  id: number
  name: string
}

const falsyListenerFailureCases = [
  { name: `undefined`, failure: undefined },
  { name: `null`, failure: null },
  { name: `false`, failure: false },
  { name: `zero`, failure: 0 },
  { name: `negative zero`, failure: -0 },
  { name: `bigint zero`, failure: 0n },
  { name: `empty string`, failure: `` },
  { name: `NaN`, failure: Number.NaN },
]

type UserWithVirtual = OutputWithVirtual<User, string | number>

interface Task {
  id: number
  userId: number
  title: string
}

function setupLiveQueryCollections(id: string) {
  const users = createCollection<User>({
    id: `${id}-users`,
    getKey: (user) => user.id,
    startSync: true,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        begin()
        commit()
        markReady()
      },
    },
  })

  const tasks = createCollection<Task>({
    id: `${id}-tasks`,
    getKey: (task) => task.id,
    startSync: true,
    sync: {
      sync: ({ begin, commit, markReady }) => {
        begin()
        commit()
        markReady()
      },
    },
  })

  const assignments = createLiveQueryCollection({
    id: `${id}-assignments`,
    startSync: true,
    query: (q) =>
      q
        .from({ user: users })
        .join({ task: tasks }, ({ user, task }) => eq(user.id, task.userId))
        .select(({ user, task }) => ({
          userId: user.id,
          taskId: task.id,
          title: task.title,
        })),
  })

  return { users, tasks, assignments }
}

function recordBatches(collection: any) {
  const batches: Array<Array<ChangeMessageLike>> = []
  const subscription = collection.subscribeChanges((changes: any) => {
    batches.push(changes as Array<ChangeMessageLike>)
  })
  return {
    batches,
    unsubscribe: () => subscription.unsubscribe(),
  }
}

afterEach(() => {
  flushAll(transactionScopedScheduler)
})

describe(`Scheduler dependency reentry`, () => {
  it.each(
    [false, true].flatMap((sourceFirst) =>
      [false, true].flatMap((pendingAware) =>
        [false, true].map((requeue) => ({
          sourceFirst,
          pendingAware,
          requeue,
        })),
      ),
    ),
  )(
    `waits for current source work: sourceFirst=$sourceFirst pendingAware=$pendingAware requeue=$requeue`,
    ({ sourceFirst, pendingAware, requeue }) => {
      const scheduler = new Scheduler()
      const contextId = Symbol(`source-reentry`)
      let sourceRuns = 0
      let pending = true
      const source = pendingAware
        ? { hasPendingGraphRun: () => pending }
        : Symbol(`source`)
      const observedRuns: Array<number> = []
      const runSource = () => {
        sourceRuns++
        pending = false
        if (requeue && sourceRuns === 1) {
          pending = true
          scheduler.schedule({ contextId, jobId: source, run: runSource })
        }
      }
      const jobs = [
        { contextId, jobId: source, run: runSource },
        {
          contextId,
          jobId: Symbol(`dependent`),
          dependencies: [source],
          run: () => observedRuns.push(sourceRuns),
        },
      ]
      for (const job of sourceFirst ? jobs : [...jobs].reverse()) {
        scheduler.schedule(job)
      }
      scheduler.flush(contextId)
      expect(sourceRuns).toBe(requeue ? 2 : 1)
      expect(observedRuns).toEqual([sourceRuns])
      expect(hasPendingJobs(scheduler, contextId)).toBe(false)
    },
  )
})

describe(`Collection publication scheduler context`, () => {
  it(`preserves the first listener error when a later graph job fails`, () => {
    const listenerFailure = new Error(`listener failed first`)
    const graphFailure = new Error(`graph failed later`)
    const graphJob = vi.fn(() => {
      throw graphFailure
    })
    let contextId: ReturnType<typeof getActivePublicationContext>
    expect(() =>
      withPublicationContext(() => {
        contextId = getActivePublicationContext()
        recordPublicationError(listenerFailure)
        transactionScopedScheduler.schedule({
          contextId,
          jobId: graphJob,
          run: graphJob,
        })
      }),
    ).toThrow(listenerFailure)
    expect(graphJob).toHaveBeenCalledOnce()
    expect(hasPendingJobs(transactionScopedScheduler, contextId!)).toBe(false)
    expect(getActivePublicationContext()).toBeUndefined()
  })

  it(`shares one context and flushes after the outer publication`, () => {
    const calls: Array<string> = []
    let contextId: ReturnType<typeof getActivePublicationContext>

    withPublicationContext(() => {
      contextId = getActivePublicationContext()
      expect(contextId).toBeDefined()

      transactionScopedScheduler.schedule({
        contextId,
        jobId: `outer`,
        run: () => calls.push(`outer`),
      })
      withPublicationContext(() => {
        expect(getActivePublicationContext()).toBe(contextId)
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `inner`,
          run: () => calls.push(`inner`),
        })
      })

      expect(calls).toEqual([])
    })

    expect(calls).toEqual([`outer`, `inner`])
    expect(getActivePublicationContext()).toBeUndefined()
  })

  it(`clears queued work when publication throws`, () => {
    const run = vi.fn()
    let contextId: ReturnType<typeof getActivePublicationContext>

    expect(() =>
      withPublicationContext(() => {
        contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `discarded`,
          run,
        })
        throw new Error(`publication failed`)
      }),
    ).toThrow(`publication failed`)

    expect(run).not.toHaveBeenCalled()
    expect(getActivePublicationContext()).toBeUndefined()
    expect(hasPendingJobs(transactionScopedScheduler, contextId!)).toBe(false)
  })

  it(`preserves a falsy graph failure through a publication boundary`, () => {
    let didThrow = false
    let thrown: unknown

    try {
      withPublicationContext(() => {
        const contextId = getActivePublicationContext()
        transactionScopedScheduler.schedule({
          contextId,
          jobId: `failing`,
          run: () => {
            throw undefined
          },
        })
      })
    } catch (error) {
      didThrow = true
      thrown = error
    }

    expect(didThrow).toBe(true)
    expect(thrown).toBeUndefined()
  })

  it(`attempts every clear listener and preserves its first failure`, () => {
    const scheduler = new Scheduler()
    const firstFailure = new Error(`first clear listener failed`)
    const laterFailure = new Error(`later clear listener failed`)
    const calls: Array<string> = []
    let firstClear = true
    let removeAdded: (() => void) | undefined
    scheduler.onClear(() => {
      calls.push(`first`)
      if (!firstClear) return
      removeSecond()
      removeAdded ??= scheduler.onClear(() => calls.push(`added`))
      throw firstFailure
    })
    const removeSecond = scheduler.onClear(() => {
      calls.push(`second`)
      if (firstClear) throw laterFailure
    })

    let thrown: unknown
    try {
      scheduler.clear(`context`)
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBe(firstFailure)
    expect(calls).toEqual([`first`, `second`])

    firstClear = false
    expect(() => scheduler.clear(`next context`)).not.toThrow()
    expect(calls).toEqual([`first`, `second`, `first`, `added`])
    removeAdded?.()
  })

  it.each([
    { source: `publication`, failureKind: `Error` },
    { source: `publication`, failureKind: `undefined` },
    { source: `graph`, failureKind: `Error` },
    { source: `graph`, failureKind: `undefined` },
  ] as const)(
    `does not replace a $failureKind $source failure with a clear-listener failure`,
    ({ source, failureKind }) => {
      const primaryFailure =
        failureKind === `Error` ? new Error(`${source} failed`) : undefined
      const clearFailure = new Error(`clear listener failed`)
      const laterClear = vi.fn()
      const removeThrowingClear = transactionScopedScheduler.onClear(() => {
        throw clearFailure
      })
      const removeLaterClear = transactionScopedScheduler.onClear(laterClear)

      try {
        let didThrow = false
        let thrown: unknown
        try {
          withPublicationContext(() => {
            if (source === `publication`) throw primaryFailure
            const contextId = getActivePublicationContext()
            transactionScopedScheduler.schedule({
              contextId,
              jobId: `failing graph`,
              run: () => {
                throw primaryFailure
              },
            })
          })
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(true)
        expect(Object.is(thrown, primaryFailure)).toBe(true)
        expect(laterClear).toHaveBeenCalledOnce()
      } finally {
        removeThrowingClear()
        removeLaterClear()
      }
    },
  )
})

describe(`live query scheduler`, () => {
  it(`does not deliver a source batch after a snapshotted listener unsubscribes`, async () => {
    let begin!: () => void
    let write!: (message: { type: `insert`; value: User }) => void
    let commit!: () => void
    const calls: Array<string> = []
    const source = createCollection<User>({
      id: `ordinary-listener-membership-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          begin = actions.begin
          write = actions.write
          commit = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    let added: { unsubscribe: () => void } | undefined
    const first = source.subscribeChanges(() => {
      calls.push(`first`)
      second.unsubscribe()
      added ??= source.subscribeChanges(() => calls.push(`added`), {
        includeInitialState: false,
      })
    })
    const second = source.subscribeChanges(() => calls.push(`second`))

    try {
      begin()
      write({ type: `insert`, value: { id: 1, name: `Ada` } })
      commit()
      expect(calls).toEqual([`first`])

      begin()
      write({ type: `insert`, value: { id: 2, name: `Grace` } })
      commit()
      expect(calls).toEqual([`first`, `first`, `added`])
    } finally {
      first.unsubscribe()
      second.unsubscribe()
      added?.unsubscribe()
      await source.cleanup()
    }
  })

  it(`delivers a layout-only batch to its frozen listener snapshot`, async () => {
    type RankedUser = User & { rank: number }
    const calls: Array<string> = []
    const firstFailure = new Error(`first layout listener failed`)
    const laterFailure = new Error(`later public listener failed`)
    const graphJob = vi.fn(() => calls.push(`graph`))
    const source = createCollection(
      mockSyncCollectionOptions<RankedUser>({
        id: `layout-listener-membership-source`,
        getKey: (user) => user.id,
        initialData: [
          { id: 1, name: `Ada`, rank: 1 },
          { id: 2, name: `Grace`, rank: 2 },
        ],
      }),
    )
    const ordered = createLiveQueryCollection({
      id: `layout-listener-membership-ordered`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: source })
          .orderBy(({ user }) => user.rank, `asc`)
          .select(({ user }) => ({ id: user.id, name: user.name })),
    })
    await ordered.preload()
    expect(ordered.toArray.map(({ id }) => id)).toEqual([1, 2])
    let firstPublication = true
    let addedLayout: (() => void) | undefined
    let addedPublic: { unsubscribe: () => void } | undefined
    const unsubscribeFirstLayout = ordered._subscribeLayoutChanges(() => {
      calls.push(`layout:first`)
      if (!firstPublication) return
      unsubscribeSecondLayout()
      secondPublic.unsubscribe()
      addedLayout ??= ordered._subscribeLayoutChanges(() =>
        calls.push(`layout:added`),
      )
      addedPublic ??= ordered.subscribeChanges(
        () => calls.push(`public:added`),
        { includeInitialState: false },
      )
      throw firstFailure
    })
    const unsubscribeSecondLayout = ordered._subscribeLayoutChanges(() => {
      calls.push(`layout:second`)
      const contextId = getActivePublicationContext()
      transactionScopedScheduler.schedule({
        contextId,
        jobId: graphJob,
        run: graphJob,
      })
    })
    const firstPublic = ordered.subscribeChanges(
      () => {
        calls.push(`public:first`)
        if (firstPublication) throw laterFailure
      },
      { includeInitialState: false },
    )
    const secondPublic = ordered.subscribeChanges(
      () => calls.push(`public:second`),
      {
        includeInitialState: false,
      },
    )

    try {
      let thrown: unknown
      try {
        source.utils.begin()
        source.utils.write({
          type: `update`,
          value: { id: 1, name: `Ada`, rank: 3 },
        })
        source.utils.commit()
      } catch (error) {
        thrown = error
      }

      expect(thrown).toBe(firstFailure)
      expect(calls).toEqual([
        `layout:first`,
        `layout:second`,
        `public:first`,
        `graph`,
      ])
      expect(graphJob).toHaveBeenCalledOnce()
      expect(ordered.toArray.map(({ id }) => id)).toEqual([2, 1])

      firstPublication = false
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: 1, name: `Ada`, rank: 0 },
      })
      expect(() => source.utils.commit()).not.toThrow()
      expect(calls).toEqual([
        `layout:first`,
        `layout:second`,
        `public:first`,
        `graph`,
        `layout:first`,
        `layout:added`,
        `public:first`,
        `public:added`,
      ])
    } finally {
      unsubscribeFirstLayout()
      unsubscribeSecondLayout()
      addedLayout?.()
      firstPublic.unsubscribe()
      secondPublic.unsubscribe()
      addedPublic?.unsubscribe()
      await ordered.cleanup()
      await source.cleanup()
    }
  })

  it(`settles a dependent live query when an earlier source listener throws`, async () => {
    let begin!: () => void
    let write!: (message: { type: `insert`; value: User }) => void
    let commit!: () => void
    const listenerFailure = new Error(`source listener failed`)
    const source = createCollection<User>({
      id: `throwing-listener-live-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          begin = actions.begin
          write = actions.write
          commit = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    const throwingSubscription = source.subscribeChanges(
      () => {
        throw listenerFailure
      },
      { includeInitialState: false },
    )
    const live = createLiveQueryCollection({
      id: `throwing-listener-live-dependent`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: source })
          .select(({ user }) => ({ id: user.id, name: user.name })),
    })

    try {
      await live.preload()
      begin()
      write({ type: `insert`, value: { id: 1, name: `Ada` } })
      expect(() => commit()).toThrow(listenerFailure)
      expect(live.get(1)).toEqual(expect.objectContaining({ name: `Ada` }))
    } finally {
      throwingSubscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it.each(falsyListenerFailureCases)(
    `preserves an exact $name row-listener failure after later delivery`,
    async ({ name, failure }) => {
      let begin!: () => void
      let write!: (message: { type: `insert`; value: User }) => void
      let commit!: () => void
      type UserObservation = {
        changes: Array<{
          type: string
          key: string | number
          value: UserWithVirtual
          previousValue: UserWithVirtual | undefined
        }>
        rows: Array<UserWithVirtual>
      }
      const sourceObservations: Array<UserObservation> = []
      const dependentObservations: Array<UserObservation> = []
      const snapshotUser = ({
        id,
        name: userName,
        $collectionId,
        $key,
        $origin,
        $synced,
      }: UserWithVirtual): UserWithVirtual => ({
        id,
        name: userName,
        $collectionId,
        $key,
        $origin,
        $synced,
      })
      const source = createCollection<User>({
        id: `falsy-row-listener-${name.replaceAll(` `, `-`)}`,
        getKey: (user) => user.id,
        startSync: true,
        sync: {
          sync: (actions) => {
            begin = actions.begin
            write = actions.write
            commit = () => {
              actions.commit()
            }
            actions.markReady()
          },
        },
      })
      const throwingSubscription = source.subscribeChanges(
        () => {
          throw failure
        },
        { includeInitialState: false },
      )
      const laterSubscription = source.subscribeChanges(
        (changes) => {
          sourceObservations.push({
            changes: changes.map(({ type, key, value, previousValue }) => ({
              type,
              key,
              value: snapshotUser(value),
              previousValue:
                previousValue === undefined
                  ? undefined
                  : snapshotUser(previousValue),
            })),
            rows: [...source.state.values()].map(snapshotUser),
          })
        },
        { includeInitialState: false },
      )
      const live = createLiveQueryCollection({
        id: `falsy-row-listener-dependent-${name.replaceAll(` `, `-`)}`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: source })
            .select(({ user }) => ({ id: user.id, name: user.name })),
      })
      let dependentSubscription:
        | ReturnType<typeof live.subscribeChanges>
        | undefined

      try {
        await live.preload()
        dependentSubscription = live.subscribeChanges(
          (changes) => {
            dependentObservations.push({
              changes: changes.map(({ type, key, value, previousValue }) => ({
                type,
                key,
                value: snapshotUser(value),
                previousValue:
                  previousValue === undefined
                    ? undefined
                    : snapshotUser(previousValue),
              })),
              rows: [...live.state.values()].map(snapshotUser),
            })
          },
          { includeInitialState: false },
        )
        begin()
        write({ type: `insert`, value: { id: 1, name: `Ada` } })
        let didThrow = false
        let thrown: unknown
        try {
          commit()
        } catch (error) {
          didThrow = true
          thrown = error
        }

        expect(didThrow).toBe(true)
        expect(Object.is(thrown, failure)).toBe(true)
        const expectedObservation = (collectionId: string): UserObservation => {
          const row: UserWithVirtual = {
            id: 1,
            name: `Ada`,
            $collectionId: collectionId,
            $key: 1,
            $origin: `remote`,
            $synced: true,
          }
          return {
            changes: [
              {
                type: `insert`,
                key: 1,
                value: row,
                previousValue: undefined,
              },
            ],
            rows: [row],
          }
        }
        const expectedDependent = expectedObservation(live.id)
        expect(sourceObservations).toEqual([expectedObservation(source.id)])
        expect(dependentObservations).toEqual([expectedDependent])
        expect([...live.state.values()].map(snapshotUser)).toEqual(
          expectedDependent.rows,
        )
      } finally {
        throwingSubscription.unsubscribe()
        laterSubscription.unsubscribe()
        dependentSubscription?.unsubscribe()
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each([
    {
      name: `Error`,
      failure: new Error(`filtered source listener failed`),
    },
    ...falsyListenerFailureCases,
  ])(
    `preserves an exact $name filtered row-listener failure`,
    async ({ name, failure }) => {
      let begin!: () => void
      let write!: (message: { type: `insert`; value: User }) => void
      let commit!: () => void
      const filteredCalls = vi.fn()
      const laterListener = vi.fn()
      const source = createCollection<User>({
        id: `filtered-throwing-listener-source-${name.replaceAll(` `, `-`)}`,
        getKey: (user) => user.id,
        startSync: true,
        sync: {
          sync: (actions) => {
            begin = actions.begin
            write = actions.write
            commit = () => {
              actions.commit()
            }
            actions.markReady()
          },
        },
      })
      const throwingSubscription = source.subscribeChanges(
        (changes) => {
          filteredCalls(changes)
          throw failure
        },
        {
          includeInitialState: false,
          where: (user) => eq(user.name, `Ada`),
        },
      )
      const laterSubscription = source.subscribeChanges(laterListener, {
        includeInitialState: false,
      })
      const live = createLiveQueryCollection({
        id: `filtered-throwing-listener-dependent-${name.replaceAll(` `, `-`)}`,
        startSync: true,
        query: (q) =>
          q
            .from({ user: source })
            .select(({ user }) => ({ id: user.id, name: user.name })),
      })

      try {
        await live.preload()
        begin()
        write({ type: `insert`, value: { id: 1, name: `Ada` } })
        let didThrow = false
        let thrown: unknown
        try {
          commit()
        } catch (error) {
          didThrow = true
          thrown = error
        }
        expect(didThrow).toBe(true)
        expect(Object.is(thrown, failure)).toBe(true)
        expect(filteredCalls).toHaveBeenCalledOnce()
        expect(filteredCalls.mock.calls[0]?.[0]).toEqual([
          expect.objectContaining({ type: `insert`, key: 1 }),
        ])
        expect(laterListener).toHaveBeenCalledOnce()
        expect(live.get(1)).toEqual(expect.objectContaining({ name: `Ada` }))

        begin()
        write({ type: `insert`, value: { id: 2, name: `Grace` } })
        expect(() => commit()).not.toThrow()
        expect(filteredCalls).toHaveBeenCalledOnce()
        expect(laterListener).toHaveBeenCalledTimes(2)
        expect(live.get(2)).toEqual(expect.objectContaining({ name: `Grace` }))
      } finally {
        throwingSubscription.unsubscribe()
        laterSubscription.unsubscribe()
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`keeps a nested ready failure when a later outer listener throws`, async () => {
    let markInnerReady!: () => void
    const readyFailure = new Error(`nested ready listener failed`)
    const laterFailure = new Error(`later outer listener failed`)
    const scheduledJob = vi.fn()
    const inner = createCollection<User>({
      id: `nested-ready-collision-inner`,
      getKey: (user) => user.id,
      sync: {
        sync: ({ markReady }) => {
          markInnerReady = markReady
        },
      },
    })
    const innerFirst = inner.subscribeChanges(() => {
      const contextId = getActivePublicationContext()
      transactionScopedScheduler.schedule({
        contextId,
        jobId: scheduledJob,
        run: scheduledJob,
      })
    })
    const innerSecond = inner.subscribeChanges(() => {
      throw readyFailure
    })

    let beginOuter!: () => void
    let writeOuter!: (message: { type: `insert`; value: User }) => void
    let commitOuter!: () => void
    const outer = createCollection<User>({
      id: `nested-ready-collision-outer`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: (actions) => {
          beginOuter = actions.begin
          writeOuter = actions.write
          commitOuter = () => {
            actions.commit()
          }
          actions.markReady()
        },
      },
    })
    const outerFirst = outer.subscribeChanges(() => markInnerReady())
    const outerSecond = outer.subscribeChanges(() => {
      throw laterFailure
    })

    try {
      beginOuter()
      writeOuter({ type: `insert`, value: { id: 1, name: `Ada` } })
      expect(() => commitOuter()).toThrow(readyFailure)
      expect(scheduledJob).toHaveBeenCalledOnce()
    } finally {
      outerFirst.unsubscribe()
      outerSecond.unsubscribe()
      innerFirst.unsubscribe()
      innerSecond.unsubscribe()
      await outer.cleanup()
      await inner.cleanup()
    }
  })

  it(`settles a dependent live query before a nested ready failure escapes`, async () => {
    let markSourceReady: (() => void) | undefined
    const listenerFailure = new Error(`source ready listener failed`)
    const source = createCollection<User>({
      id: `nested-ready-live-source`,
      getKey: (user) => user.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markSourceReady = markReady
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `nested-ready-live-dependent`,
      startSync: true,
      query: (q) =>
        q
          .from({ user: source })
          .select(({ user }) => ({ id: user.id, name: user.name })),
    })
    const preload = live.preload()
    const throwingSubscription = source.subscribeChanges(() => {
      throw listenerFailure
    })

    try {
      expect(live.status).toBe(`loading`)
      expect(() => withPublicationContext(() => markSourceReady!())).toThrow(
        listenerFailure,
      )
      await expect(preload).resolves.toBeUndefined()
      expect(source.status).toBe(`ready`)
      expect(live.status).toBe(`ready`)
    } finally {
      throwingSubscription.unsubscribe()
      await live.cleanup()
      await source.cleanup()
    }
  })

  it(`runs the live query graph once per transaction that touches multiple collections`, async () => {
    const { users, tasks, assignments } =
      setupLiveQueryCollections(`single-batch`)
    await assignments.preload()

    const recorder = recordBatches(assignments)

    const transaction = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    transaction.mutate(() => {
      users.insert({ id: 1, name: `Alice` })
      tasks.insert({ id: 1, userId: 1, title: `Write tests` })
    })

    expect(recorder.batches).toHaveLength(1)
    expect(recorder.batches[0]).toHaveLength(1)
    expect(recorder.batches[0]![0]).toMatchObject({
      type: `insert`,
      value: {
        userId: 1,
        taskId: 1,
        title: `Write tests`,
      },
    })

    recorder.unsubscribe()
    transaction.rollback()
  })

  it(`handles nested transactions without emitting duplicate batches`, async () => {
    const { users, tasks, assignments } = setupLiveQueryCollections(`nested`)
    await assignments.preload()

    const recorder = recordBatches(assignments)

    const outerTx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })
    const innerTx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    outerTx.mutate(() => {
      users.insert({ id: 11, name: `Nested User` })
      innerTx.mutate(() => {
        tasks.insert({ id: 21, userId: 11, title: `Nested Task` })
      })
    })

    expect(recorder.batches).toHaveLength(1)
    expect(recorder.batches[0]![0]).toMatchObject({
      value: {
        userId: 11,
        taskId: 21,
        title: `Nested Task`,
      },
    })

    recorder.unsubscribe()
    innerTx.rollback()
    outerTx.rollback()
  })

  it(`clears pending jobs when a transaction rolls back due to an error`, async () => {
    const { users, tasks, assignments } = setupLiveQueryCollections(`rollback`)
    await assignments.preload()

    const recorder = recordBatches(assignments)
    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    expect(() => {
      tx.mutate(() => {
        users.insert({ id: 31, name: `Temp` })
        tasks.insert({ id: 41, userId: 31, title: `Temp Task` })
        throw new Error(`boom`)
      })
    }).toThrowError(`boom`)

    tx.rollback()

    const batchesBeforeFlush = recorder.batches.length
    transactionScopedScheduler.flush(tx.id)
    expect(recorder.batches.length).toBeGreaterThanOrEqual(batchesBeforeFlush)
    if (recorder.batches.length > batchesBeforeFlush) {
      const latestBatch = recorder.batches.at(-1)!
      expect(latestBatch[0]?.type).toBe(`delete`)
    }
    expect(hasPendingJobs(transactionScopedScheduler, tx.id)).toBe(false)
    // We emit the optimistic insert and, after the explicit rollback, possibly a
    // compensating delete – but no duplicate inserts.
    expect(recorder.batches[0]![0]).toMatchObject({ type: `insert` })

    recorder.unsubscribe()
  })

  it(`dedupes batches across multiple subscribers`, async () => {
    const { users, tasks, assignments } =
      setupLiveQueryCollections(`multi-subscriber`)
    await assignments.preload()

    const first = recordBatches(assignments)
    const second = recordBatches(assignments)

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })
    tx.mutate(() => {
      users.insert({ id: 51, name: `Multi` })
      tasks.insert({ id: 61, userId: 51, title: `Subscriber Task` })
    })

    expect(first.batches).toHaveLength(1)
    expect(second.batches).toHaveLength(1)
    expect(first.batches[0]![0]).toMatchObject({
      value: {
        userId: 51,
        taskId: 61,
        title: `Subscriber Task`,
      },
    })

    first.unsubscribe()
    second.unsubscribe()
    tx.rollback()
  })

  it.each(
    [`collection`, `effect`].flatMap((consumer) =>
      [false, true].flatMap((sharedSource) =>
        [false, true].flatMap((derivedRight) =>
          [false, true].map((reverseWrites) => ({
            consumer,
            sharedSource,
            derivedRight,
            reverseWrites,
          })),
        ),
      ),
    ),
  )(
    `publishes settled dependencies once: $consumer shared=$sharedSource derivedRight=$derivedRight reverse=$reverseWrites`,
    async ({ consumer, sharedSource, derivedRight, reverseWrites }) => {
      type Row = { id: number; left: string; right: string }
      const makeSource = (id: string) =>
        createCollection(
          mockSyncCollectionOptions<Row>({
            id,
            getKey: (row) => row.id,
            initialData: [{ id: 1, left: `old-left`, right: `old-right` }],
          }),
        )
      const leftSource = makeSource(`dependency-left`)
      const rightSource = sharedSource
        ? leftSource
        : makeSource(`dependency-right`)
      const leftQuery = createLiveQueryCollection({
        query: (q) =>
          q
            .from({ row: leftSource })
            .select(({ row }) => ({ id: row.id, value: row.left })),
      })
      const rightQuery = derivedRight
        ? createLiveQueryCollection({
            query: (q) =>
              q
                .from({ row: rightSource })
                .select(({ row }) => ({ id: row.id, right: row.right })),
          })
        : undefined
      await Promise.all([
        leftQuery.preload(),
        (rightQuery ?? rightSource).preload(),
      ])
      const query = new Query()
        .from({ left: leftQuery })
        .join(
          { right: rightQuery ?? rightSource },
          ({ left, right }) => eq(left.id, right.id),
          `inner`,
        )
        .select(({ left, right }) => ({
          id: left.id,
          left: left.value,
          right: right.right,
        }))
      const publications: Array<Array<{ left: string; right: string }>> = []
      let cleanupConsumer: () => Promise<void>
      if (consumer === `collection`) {
        const joined = createLiveQueryCollection({ query })
        await joined.preload()
        const subscription = joined.subscribeChanges(() => {
          publications.push(
            joined.toArray.map(({ left, right }) => ({ left, right })),
          )
        })
        cleanupConsumer = async () => {
          subscription.unsubscribe()
          await joined.cleanup()
        }
      } else {
        const effect = createEffect<{
          id: number
          left: string
          right: string
        }>({
          query,
          onBatch: (events) => {
            publications.push(
              events.map(({ value: { left, right } }) => ({ left, right })),
            )
          },
        })
        cleanupConsumer = () => effect.dispose()
      }
      const tx = createTransaction({
        mutationFn: async () => {},
        autoCommit: false,
      })
      try {
        publications.length = 0
        const writes = [
          () =>
            leftSource.update(1, (row) => {
              row.left = `next-left`
            }),
          () =>
            rightSource.update(1, (row) => {
              row.right = `next-right`
            }),
        ]
        tx.mutate(() => {
          for (const write of reverseWrites ? [...writes].reverse() : writes)
            write()
        })
        expect([...publications]).toEqual([
          [{ left: `next-left`, right: `next-right` }],
        ])
      } finally {
        tx.rollback()
        await cleanupConsumer()
        await Promise.all([leftQuery.cleanup(), rightQuery?.cleanup()])
        await leftSource.cleanup()
        if (!sharedSource) await rightSource.cleanup()
      }
    },
  )

  it(`runs join live queries once after their parent queries settle`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `diamond-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `diamond-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `diamond-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const liveQueryB = createLiveQueryCollection({
      id: `diamond-lqB`,
      startSync: true,
      query: (q) =>
        q
          .from({ b: collectionB })
          .select(({ b }) => ({ id: b.id, value: b.value })),
    })

    const liveQueryJoin = createLiveQueryCollection({
      id: `diamond-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: liveQueryB },
            ({ left, right }) => eq(left.id, right.id),
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
          })),
    })

    await Promise.all([
      liveQueryA.preload(),
      liveQueryB.preload(),
      liveQueryJoin.preload(),
    ])
    const runs = vi.spyOn(getCollectionBuilder(liveQueryJoin)!, `maybeRunGraph`)

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionA.insert({ id: 1, value: `A1` })
      collectionB.insert({ id: 1, value: `B1` })
    })

    expect(liveQueryJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A1`, right: `B1` },
    ])
    expect(runs).toHaveBeenCalledTimes(1)

    tx.mutate(() => {
      collectionA.update(1, (draft) => {
        draft.value = `A1b`
      })
      collectionB.update(1, (draft) => {
        draft.value = `B1b`
      })
    })

    expect(liveQueryJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A1b`, right: `B1b` },
    ])
    expect(runs).toHaveBeenCalledTimes(2)
    tx.rollback()
    runs.mockRestore()
  })

  it(`runs hybrid joins once when they observe both a live query and a collection`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `hybrid-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `hybrid-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `hybrid-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const hybridJoin = createLiveQueryCollection({
      id: `hybrid-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: collectionB },
            ({ left, right }) => eq(left.id, right.id),
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
          })),
    })

    await Promise.all([liveQueryA.preload(), hybridJoin.preload()])
    const runs = vi.spyOn(getCollectionBuilder(hybridJoin)!, `maybeRunGraph`)

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionA.insert({ id: 7, value: `A7` })
      collectionB.insert({ id: 7, value: `B7` })
    })

    expect(hybridJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A7`, right: `B7` },
    ])
    expect(runs).toHaveBeenCalledTimes(1)

    tx.mutate(() => {
      collectionA.update(7, (draft) => {
        draft.value = `A7b`
      })
      collectionB.update(7, (draft) => {
        draft.value = `B7b`
      })
    })

    expect(hybridJoin.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `A7b`, right: `B7b` },
    ])
    expect(runs).toHaveBeenCalledTimes(2)
    tx.rollback()
    runs.mockRestore()
  })

  it(`currently single batch when the join sees right-side data before the left`, async () => {
    const collectionA = createCollection<{ id: number; value: string }>({
      id: `ordering-A`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const collectionB = createCollection<{ id: number; value: string }>({
      id: `ordering-B`,
      getKey: (row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, commit, markReady }) => {
          begin()
          commit()
          markReady()
        },
      },
    })

    const liveQueryA = createLiveQueryCollection({
      id: `ordering-lqA`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: collectionA })
          .select(({ a }) => ({ id: a.id, value: a.value })),
    })

    const join = createLiveQueryCollection({
      id: `ordering-join`,
      startSync: true,
      query: (q) =>
        q
          .from({ left: liveQueryA })
          .join(
            { right: collectionB },
            ({ left, right }) => eq(left.id, right.id),
            `full`,
          )
          .select(({ left, right }) => ({
            left: left.value,
            right: right.value,
          })),
    })

    await Promise.all([liveQueryA.preload(), join.preload()])
    const runs = vi.spyOn(getCollectionBuilder(join)!, `maybeRunGraph`)

    const tx = createTransaction({
      mutationFn: async () => {},
      autoCommit: false,
    })

    tx.mutate(() => {
      collectionB.insert({ id: 42, value: `right-first` })
      collectionA.insert({ id: 42, value: `left-later` })
    })

    expect(join.toArray.map((row) => stripVirtualProps(row))).toEqual([
      { left: `left-later`, right: `right-first` },
    ])
    expect(runs).toHaveBeenCalledTimes(1)
    tx.rollback()
    runs.mockRestore()
  })

  it.each(
    [`resolve`, `reject`].flatMap((outcome) =>
      [false, true].map((replacementSettled) => ({
        outcome,
        replacementSettled,
      })),
    ),
  )(
    `isolates ordered publication participants across restart: $outcome replacementSettled=$replacementSettled`,
    async ({ outcome, replacementSettled }) => {
      let sync!: Parameters<SyncConfig<User>[`sync`]>[0]
      const source = createCollection<User>({
        getKey: ({ id }) => id,
        sync: {
          sync: (operations) => {
            sync = operations
            operations.begin()
            operations.write({ type: `insert`, value: { id: 1, name: `old` } })
            operations.commit()
            operations.markReady()
          },
        },
      })
      const builder = new CollectionConfigBuilder({
        query: (q) => q.from({ user: source }),
      })
      const config = builder.getConfig()
      const live = createCollection({ ...config, singleResult: undefined })
      const obsolete = createDeferred<void>()
      const replacement = createDeferred<void>()
      try {
        await live.preload()
        // Inject participants at the builder boundary: the ordered loader has
        // its own stale-result guards, which must not mask this owner's law.
        builder.trackOrderedLoadPromise(obsolete.promise, true)
        await live.cleanup()
        await live.preload()
        builder.trackOrderedLoadPromise(replacement.promise, true)
        const publications: Array<Array<string>> = []
        live.subscribeChanges(() => {
          publications.push(live.toArray.map(({ name }) => name))
        })
        const update = (name: string) => {
          sync.begin()
          sync.write({ type: `update`, value: { id: 1, name } })
          sync.commit()
        }
        update(`replacement`)
        expect(live.toArray.map(({ name }) => name)).toEqual([`old`])
        expect(publications).toEqual([])
        if (replacementSettled) {
          replacement.resolve()
          await flushPromises()
        }
        const beforeObsolete = [...publications]
        if (outcome === `resolve`) obsolete.resolve()
        else obsolete.reject(new Error(`discarded session failed`))
        await flushPromises()
        expect(publications).toEqual(beforeObsolete)
        if (!replacementSettled) {
          expect(live.toArray.map(({ name }) => name)).toEqual([`old`])
          replacement.resolve()
          await flushPromises()
        }
        expect(live.toArray.map(({ name }) => name)).toEqual([`replacement`])
        expect(publications).toEqual([[`replacement`]])
        update(`later`)
        expect(live.toArray.map(({ name }) => name)).toEqual([`later`])
        expect(publications).toEqual([[`replacement`], [`later`]])
        expect(live.status).toBe(`ready`)
        expect(config.utils.lastSubsetError).toBeUndefined()
      } finally {
        obsolete.resolve()
        replacement.resolve()
        await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`coalesces load-more callbacks scheduled within the same context`, () => {
    const baseCollection = createCollection<User>({
      id: `loader-users`,
      getKey: (user) => user.id,
      sync: {
        sync: () => () => {},
      },
    })

    const builder = new CollectionConfigBuilder({
      id: `loader-builder`,
      query: (q) => q.from({ user: baseCollection }),
    })

    const contextId = Symbol(`loader-context`)
    const loader = vi.fn(() => true)
    const config = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
      truncate: vi.fn(),
    } as unknown as Parameters<SyncConfig<UserWithVirtual>[`sync`]>[0]

    const syncState = {
      messagesCount: 0,
      subscribedToAllCollections: true,
      unsubscribeCallbacks: new Set<() => void>(),
      graph: {
        pendingWork: () => false,
        run: vi.fn(),
      },
      inputs: {},
      pipeline: {},
    } as unknown as FullSyncState

    const maybeRunGraphSpy = vi
      .spyOn(builder, `maybeRunGraph`)
      .mockImplementation((combinedLoader) => {
        combinedLoader?.()
      })

    // Set instance properties since this test calls scheduleGraphRun directly
    builder.currentSyncConfig = config
    builder.currentSyncState = syncState

    builder.scheduleGraphRun(loader, { contextId })
    builder.scheduleGraphRun(loader, { contextId })

    transactionScopedScheduler.flush(contextId)

    expect(loader).toHaveBeenCalledTimes(1)
    expect(maybeRunGraphSpy).toHaveBeenCalledTimes(1)

    maybeRunGraphSpy.mockRestore()
  })

  it.each(
    [false, true].flatMap((initialWork) =>
      [false, true].map((loaderResult) => ({ initialWork, loaderResult })),
    ),
  )(
    `drains loader writes before publication: initial=$initialWork return=$loaderResult`,
    ({ initialWork, loaderResult }) => {
      const source = createCollection<User>({
        getKey: (user) => user.id,
        sync: { sync: () => () => {} },
      })
      const builder = new CollectionConfigBuilder({
        query: (q) => q.from({ user: source }),
      })
      const events: Array<string> = []
      let pendingWork = initialWork
      let wrote = false
      builder.currentSyncConfig = {
        markReady: vi.fn(),
      } as unknown as Parameters<SyncConfig<UserWithVirtual>[`sync`]>[0]
      builder.currentSyncState = {
        messagesCount: 1,
        subscribedToAllCollections: true,
        graph: {
          pendingWork: () => pendingWork,
          run: () => {
            events.push(`graph`)
            pendingWork = false
          },
        },
        flushPendingChanges: () => events.push(`publish`),
      } as unknown as FullSyncState
      const contextId = Symbol(`loader-write-context`)
      builder.scheduleGraphRun(
        () => {
          events.push(`first`)
          if (!wrote) {
            wrote = true
            pendingWork = true
          }
          return loaderResult
        },
        { contextId },
      )
      builder.scheduleGraphRun(
        () => {
          events.push(`second`)
          return true
        },
        { contextId },
      )
      transactionScopedScheduler.flush(contextId)
      expect(events).toEqual([
        ...(initialWork ? [`graph`] : []),
        `first`,
        `second`,
        `graph`,
        `first`,
        `second`,
        `publish`,
      ])
      expect(builder.hasPendingGraphRun(contextId)).toBe(false)
    },
  )

  it.each(
    [
      { name: `undefined`, failure: undefined },
      { name: `null`, failure: null },
      { name: `false`, failure: false },
      { name: `zero`, failure: 0 },
      { name: `empty string`, failure: `` },
      { name: `NaN`, failure: Number.NaN },
    ].flatMap((entry) =>
      [false, true].map((laterFails) => ({ ...entry, laterFails })),
    ),
  )(
    `preserves the first falsy graph-loader failure: $name laterFails=$laterFails`,
    ({ failure, laterFails }) => {
      const baseCollection = createCollection<User>({
        id: `falsy-loader-users-${String(failure)}`,
        getKey: (user) => user.id,
        sync: {
          sync: () => () => {},
        },
      })
      const builder = new CollectionConfigBuilder({
        id: `falsy-loader-builder-${String(failure)}`,
        query: (q) => q.from({ user: baseCollection }),
      })
      const contextId = Symbol(`falsy-loader-context`)
      const laterLoader = vi.fn(() => {
        if (laterFails) throw new Error(`later loader failed`)
        return false
      })
      const config = {
        begin: vi.fn(),
        write: vi.fn(),
        commit: vi.fn(),
        markReady: vi.fn(),
        truncate: vi.fn(),
      } as unknown as Parameters<SyncConfig<UserWithVirtual>[`sync`]>[0]
      const syncState = {
        messagesCount: 0,
        subscribedToAllCollections: true,
        unsubscribeCallbacks: new Set<() => void>(),
        graph: {
          pendingWork: () => false,
          run: vi.fn(),
        },
        inputs: {},
        pipeline: {},
      } as unknown as FullSyncState
      const maybeRunGraphSpy = vi
        .spyOn(builder, `maybeRunGraph`)
        .mockImplementation((combinedLoader) => {
          combinedLoader?.()
        })

      builder.currentSyncConfig = config
      builder.currentSyncState = syncState
      builder.scheduleGraphRun(
        () => {
          throw failure
        },
        { contextId },
      )
      builder.scheduleGraphRun(laterLoader, { contextId })

      let didThrow = false
      let thrown: unknown
      try {
        transactionScopedScheduler.flush(contextId)
      } catch (error) {
        didThrow = true
        thrown = error
      } finally {
        maybeRunGraphSpy.mockRestore()
      }

      expect(didThrow).toBe(true)
      expect(Object.is(thrown, failure)).toBe(true)
      expect(laterLoader).toHaveBeenCalledOnce()
    },
  )

  it(`attempts every repeated-alias source loader and preserves the first failure`, async () => {
    const createSource = (name: string) =>
      createCollection<User>({
        id: `source-loader-${name}`,
        getKey: (user) => user.id,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return () => {}
          },
        },
      })
    const firstSource = createSource(`first`)
    const secondSource = createSource(`second`)
    const thirdSource = createSource(`third`)
    const builder = new CollectionConfigBuilder({
      id: `source-loader-builder`,
      query: (q) =>
        q.from({ root: firstSource }).select(({ root }) => ({
          id: root.id,
          second: q
            .from({ item: secondSource })
            .where(({ item }) => eq(item.id, root.id)),
          third: q
            .from({ item: thirdSource })
            .where(({ item }) => eq(item.id, root.id)),
        })),
    })
    type BuilderSyncConfig = Parameters<
      ReturnType<typeof builder.getConfig>[`sync`][`sync`]
    >[0]
    const config = {
      begin: vi.fn(),
      write: vi.fn(),
      commit: vi.fn(),
      markReady: vi.fn(),
      truncate: vi.fn(),
    } as unknown as BuilderSyncConfig
    const builderInternals = builder as unknown as {
      graphCache: FullSyncState[`graph`]
      inputsCache: FullSyncState[`inputs`]
      pipelineCache: FullSyncState[`pipeline`]
      collectionSources: Array<{
        sourceId: string
        alias: string
        collection: object
      }>
      subscribeToAllCollections: (
        syncConfig: typeof config,
        state: FullSyncState,
      ) => () => void
    }
    const syncState = {
      messagesCount: 0,
      unsubscribeCallbacks: new Set<() => void>(),
      subscribedToAllCollections: false,
      graph: builderInternals.graphCache,
      inputs: builderInternals.inputsCache,
      pipeline: builderInternals.pipelineCache,
    } as unknown as FullSyncState
    const sourceIdFor = (collection: object): string => {
      const source = builderInternals.collectionSources.find(
        (candidate) => candidate.collection === collection,
      )
      if (!source) throw new Error(`Expected a lexical source`)
      return source.sourceId
    }
    const firstSourceId = sourceIdFor(firstSource)
    const secondSourceId = sourceIdFor(secondSource)
    const thirdSourceId = sourceIdFor(thirdSource)
    expect(
      builderInternals.collectionSources.map(({ alias }) => alias),
    ).toEqual([`root`, `item`, `item`])
    expect(new Set([firstSourceId, secondSourceId, thirdSourceId]).size).toBe(3)
    const laterFailure = new Error(`later source failed`)
    const loaderCalls: Array<string> = []
    const loaderCallCounts = new Map<string, number>()
    const loadMoreSpy = vi
      .spyOn(CollectionSubscriber.prototype, `loadMoreIfNeeded`)
      .mockImplementation(function (this: unknown) {
        const { sourceId } = this as { sourceId: string }
        loaderCalls.push(sourceId)
        loaderCallCounts.set(
          sourceId,
          (loaderCallCounts.get(sourceId) ?? 0) + 1,
        )
        if (sourceId === firstSourceId) throw undefined
        if (sourceId === secondSourceId) throw laterFailure
        if (sourceId === thirdSourceId) return true
        throw new Error(`Unexpected source: ${sourceId}`)
      })

    try {
      builder.currentSyncConfig = config
      builder.currentSyncState = syncState
      const loadAllSources = builderInternals.subscribeToAllCollections(
        config,
        syncState,
      )

      let didThrow = false
      let thrown: unknown
      try {
        loadAllSources()
      } catch (error) {
        didThrow = true
        thrown = error
      }

      expect(didThrow).toBe(true)
      expect(Object.is(thrown, undefined)).toBe(true)
      expect(loaderCalls).toEqual([
        firstSourceId,
        secondSourceId,
        thirdSourceId,
      ])
      expect(loaderCallCounts).toEqual(
        new Map([
          [firstSourceId, 1],
          [secondSourceId, 1],
          [thirdSourceId, 1],
        ]),
      )
      expect(loadMoreSpy).toHaveBeenCalledTimes(3)
    } finally {
      for (const unsubscribe of syncState.unsubscribeCallbacks) unsubscribe()
      loadMoreSpy.mockRestore()
      await Promise.all([
        firstSource.cleanup(),
        secondSource.cleanup(),
        thirdSource.cleanup(),
      ])
    }
  })

  it(`should handle optimistic mutations with nested left joins without scheduler errors`, async () => {
    // This test verifies that optimistic mutations on collections with nested live query
    // collections using left joins complete successfully without scheduler errors.
    //
    // Expected behavior:
    // 1. Collections are pre-populated with initialData (via mockSyncCollectionOptions)
    // 2. Nested live query collections use left joins
    // 3. An optimistic action updates an existing item using draft mutations
    // 4. The scheduler should flush the transaction successfully without detecting unresolved dependencies

    interface Account {
      id: string
      user_id: string
      name: string
    }

    interface UserProfile {
      id: string
      profile: string
    }

    interface Team {
      id: string
      account_id: string
      deleted_ts: string | null
    }

    // Use mockSyncCollectionOptions with initialData to match the failing test
    // Note: mockSyncCollectionOptions already sets startSync: true internally
    const accounts = createCollection<Account>(
      mockSyncCollectionOptions({
        id: `left-join-bug-accounts`,
        getKey: (account) => account.id,
        initialData: [
          { id: `account-1`, user_id: `user-1`, name: `Account 1` },
        ],
      }),
    )

    const users = createCollection<UserProfile>(
      mockSyncCollectionOptions({
        id: `left-join-bug-users`,
        getKey: (user) => user.id,
        initialData: [{ id: `user-1`, profile: `Profile 1` }],
      }),
    )

    const teams = createCollection<Team>(
      mockSyncCollectionOptions({
        id: `left-join-bug-teams`,
        getKey: (team) => team.id,
        initialData: [
          {
            id: `team-1`,
            account_id: `account-1`,
            deleted_ts: null as string | null,
          },
        ],
      }),
    )

    // Create nested live query collections similar to the bug report
    const accountsWithUsers = createLiveQueryCollection({
      id: `left-join-bug-accounts-with-users`,
      startSync: true,
      query: (q) =>
        q
          .from({ account: accounts })
          .join({ user: users }, ({ user, account }) =>
            eq(user.id, account.user_id),
          )
          .select(({ account, user }) => ({
            account: account,
            profile: user.profile,
          })),
    })

    const activeTeams = createLiveQueryCollection({
      id: `left-join-bug-active-teams`,
      startSync: true,
      query: (q) =>
        q
          .from({ team: teams })
          .where(({ team }) => isNull(team.deleted_ts))
          .select(({ team }) => ({ team })),
    })

    const accountsWithTeams = createLiveQueryCollection({
      id: `left-join-bug-accounts-with-teams`,
      startSync: true,
      query: (q) =>
        q
          .from({ accountWithUser: accountsWithUsers })
          .leftJoin({ team: activeTeams }, ({ accountWithUser, team }) =>
            eq(team.team.account_id, accountWithUser.account.id),
          )
          .select(({ accountWithUser, team }) => ({
            account: accountWithUser.account,
            profile: accountWithUser.profile,
            team: team.team,
          })),
    })

    // Wait for all queries to be ready
    await Promise.all([
      accountsWithUsers.preload(),
      activeTeams.preload(),
      accountsWithTeams.preload(),
    ])

    // Create an optimistic action that mutates using draft
    const testAction = createOptimisticAction<string>({
      onMutate: (id) => {
        // Update existing data using draft mutation
        accounts.update(id, (draft) => {
          draft.name = `new name here`
        })
      },
      mutationFn: (_id, _params) => {
        return Promise.resolve({ txid: 0 })
      },
    })

    // Execute the optimistic action and flush - this should complete without scheduler errors
    let error: Error | undefined
    let transaction: any

    try {
      transaction = testAction(`account-1`)

      // Wait for the transaction to process
      await new Promise((resolve) => setTimeout(resolve, 10))

      // The scheduler should flush successfully without detecting unresolved dependencies
      flushAll(transactionScopedScheduler)
    } catch (e) {
      error = e as Error
    }

    // The scheduler should not throw unresolved dependency errors
    expect(error).toBeUndefined()

    // Verify the transaction was created successfully
    expect(transaction).toBeDefined()
  })

  it(`should prevent stale data when lazy source also depends on modified collection`, async () => {
    interface BaseItem {
      id: string
      value: number
    }

    // Base collection
    const baseCollection = createCollection<BaseItem>(
      mockSyncCollectionOptions({
        id: `race-base`,
        getKey: (item) => item.id,
        initialData: [{ id: `1`, value: 10 }],
      }),
    )

    // QueryA: depends on base
    const queryA = createLiveQueryCollection({
      id: `race-queryA`,
      startSync: true,
      query: (q) =>
        q.from({ item: baseCollection }).select(({ item }) => ({
          id: item.id,
          value: item.value,
        })),
    })

    // QueryB: also depends on base (independent from queryA)
    const queryB = createLiveQueryCollection({
      id: `race-queryB`,
      startSync: true,
      query: (q) =>
        q.from({ item: baseCollection }).select(({ item }) => ({
          id: item.id,
          value: item.value,
        })),
    })

    // QueryC: depends on queryA, left joins queryB (lazy)
    const queryC = createLiveQueryCollection({
      id: `race-queryC`,
      startSync: true,
      query: (q) =>
        q
          .from({ a: queryA })
          .leftJoin({ b: queryB }, ({ a, b }) => eq(a.id, b.id))
          .select(({ a, b }) => ({
            id: a.id,
            aValue: a.value,
            bValue: b.value,
          })),
    })

    // Wait for initial sync
    await Promise.all([queryA.preload(), queryB.preload(), queryC.preload()])

    // Verify initial state
    const initialC = [...queryC.values()][0]
    expect(initialC?.aValue).toBe(10)
    expect(initialC?.bValue).toBe(10)

    // Mutate the base collection
    const action = createOptimisticAction<string>({
      autoCommit: false,
      onMutate: (id) => {
        baseCollection.update(id, (draft) => {
          draft.value = 100
        })
      },
      mutationFn: (_id) => Promise.resolve({ txid: 0 }),
    })

    let error: Error | undefined
    try {
      action(`1`)
      await new Promise((resolve) => setTimeout(resolve, 10))
      flushAll(transactionScopedScheduler)
    } catch (e) {
      error = e as Error
    }

    expect(error).toBeUndefined()

    const finalC = [...queryC.values()][0]
    expect(finalC?.aValue).toBe(100)
    expect(finalC?.bValue).toBe(100)
  })
})
