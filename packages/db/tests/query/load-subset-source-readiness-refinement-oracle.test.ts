import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { extractSimpleComparisons } from '../../src/query/expression-helpers.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import { projectSourceReadiness } from '../load-subset-full-flow-model.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'
import type { LoadSubsetOptions } from '../../src/types.js'

type Row = { id: string; group: string }

it.each([`resolve`, `reject`] as const)(
  `fences a retired source-demand attempt when it settles late: %s`,
  async (oldOutcome) => {
    type Parent = { id: string; group: string }
    type Child = { id: string; group: string }
    type PendingRequest = {
      options: LoadSubsetOptions
      rows: ReturnType<typeof createDeferred<ReadonlyArray<Child>>>
    }
    const sessionId = `session`
    const parentId = `readiness-generation-parent-${oldOutcome}`
    const childId = `readiness-generation-child-${oldOutcome}`
    const oldAttemptId = `old-attempt`
    const freshAttemptId = `fresh-attempt`
    let parentBegin!: () => void
    let parentWrite!: (message: {
      type: `update`
      value: Parent
      previousValue: Parent
    }) => void
    let parentCommit!: () => true | Promise<void>
    const oldParent: Parent = { id: `parent`, group: `old` }
    const freshParent: Parent = { ...oldParent, group: `fresh` }
    const parent = createCollection<Parent>({
      id: parentId,
      getKey: (row) => row.id,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          parentBegin = begin
          parentWrite = write
          parentCommit = commit
          begin()
          write({ type: `insert`, value: oldParent })
          commit()
          markReady()
        },
      },
    })
    let childBegin!: () => void
    let childWrite!: (message: { type: `insert`; value: Child }) => void
    let childCommit!: () => true | Promise<void>
    const pending: Array<PendingRequest> = []
    const unloads: Array<LoadSubsetOptions> = []
    const child = createCollection<Child>({
      id: childId,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          childBegin = begin
          childWrite = write
          childCommit = commit
          markReady()
          return {
            loadSubset: (options) => {
              const rows = createDeferred<ReadonlyArray<Child>>()
              pending.push({ options, rows })
              return rows.promise.then(async (acquiredRows) => {
                if (acquiredRows.length > 0) {
                  childBegin()
                  for (const row of acquiredRows) {
                    childWrite({ type: `insert`, value: row })
                  }
                  const applied = childCommit()
                  if (applied !== true) await applied
                }
                return {
                  hasMore: false,
                  appliedRowKeys: acquiredRows.map((row) => row.id),
                }
              })
            },
            unloadSubset: (options) => {
              unloads.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `readiness-generation-live-${oldOutcome}`,
      query: (q) =>
        q.from({ parent }).select(({ parent: parentRow }) => ({
          id: parentRow.id,
          children: toArray(
            q
              .from({ child })
              .where(({ child: childRow }) =>
                eq(childRow.group, parentRow.group),
              ),
          ),
        })),
      startSync: true,
    })
    const history: Array<LoadSubsetFullFlowEvent> = [
      {
        type: `registerSourceDemand`,
        sessionId,
        sourceId: childId,
        demandId: `children`,
        attemptId: oldAttemptId,
      },
    ]
    let preloadState: `pending` | `resolved` | `rejected` = `pending`
    const preload = live.preload()
    void preload.then(
      () => {
        preloadState = `resolved`
      },
      () => {
        preloadState = `rejected`
      },
    )
    const requestedGroups = (options: LoadSubsetOptions): Array<string> =>
      extractSimpleComparisons(options.where).flatMap((comparison) => {
        if (comparison.field.join(`.`) !== `group`) return []
        if (comparison.operator === `eq`) {
          return typeof comparison.value === `string` ? [comparison.value] : []
        }
        if (comparison.operator !== `in` || !Array.isArray(comparison.value)) {
          return []
        }
        return comparison.value.filter(
          (value): value is string => typeof value === `string`,
        )
      })
    let liveCleaned = false

    try {
      await flushPromises()
      expect(pending).toHaveLength(1)
      expect(requestedGroups(pending[0]!.options)).toEqual([`old`])
      expect(live.status).toBe(projectSourceReadiness(history).status)
      expect(preloadState).toBe(`pending`)

      parentBegin()
      parentWrite({
        type: `update`,
        value: freshParent,
        previousValue: oldParent,
      })
      const parentApplied = parentCommit()
      if (parentApplied !== true) await parentApplied
      await flushPromises()

      expect(pending).toHaveLength(2)
      expect(requestedGroups(pending[0]!.options)).toEqual([`old`])
      expect(requestedGroups(pending[1]!.options)).toEqual([`fresh`])
      expect(pending[0]!.options.signal?.aborted).toBe(true)
      expect(pending[1]!.options.signal?.aborted).toBe(false)
      expect(unloads).toEqual([pending[0]!.options])
      history.push(
        {
          type: `retireSourceDemand`,
          sessionId,
          sourceId: childId,
          demandId: `children`,
          attemptId: oldAttemptId,
        },
        {
          type: `registerSourceDemand`,
          sessionId,
          sourceId: childId,
          demandId: `children`,
          attemptId: freshAttemptId,
        },
      )
      expect(live.status).toBe(projectSourceReadiness(history).status)
      expect(preloadState).toBe(`pending`)

      if (oldOutcome === `resolve`) {
        pending[0]!.rows.resolve([])
      } else {
        pending[0]!.rows.reject(new Error(`retired source demand failed`))
      }
      history.push({
        type: `settleSourceDemand`,
        sessionId,
        sourceId: childId,
        demandId: `children`,
        attemptId: oldAttemptId,
        outcome: oldOutcome,
      })
      await flushPromises()

      expect(live.status).toBe(projectSourceReadiness(history).status)
      expect(preloadState).toBe(`pending`)
      expect(live.utils.lastSubsetError).toBeUndefined()

      const freshChild: Child = { id: `fresh-child`, group: `fresh` }
      expect(child.get(freshChild.id)).toBeUndefined()
      pending[1]!.rows.resolve([freshChild])
      history.push({
        type: `settleSourceDemand`,
        sessionId,
        sourceId: childId,
        demandId: `children`,
        attemptId: freshAttemptId,
        outcome: `resolve`,
      })
      await preload
      await flushPromises()

      expect(live.status).toBe(projectSourceReadiness(history).status)
      expect(preloadState).toBe(`resolved`)
      expect(live.utils.lastSubsetError).toBeUndefined()
      expect(child.get(freshChild.id)).toEqual(
        expect.objectContaining(freshChild),
      )
      expect(live.toArray).toEqual([
        expect.objectContaining({
          id: `parent`,
          children: [expect.objectContaining({ id: `fresh-child` })],
        }),
      ])
      expect(pending[1]!.options.signal?.aborted).toBe(false)
      expect(unloads).toEqual([pending[0]!.options])

      await live.cleanup()
      liveCleaned = true
      expect(pending[1]!.options.signal?.aborted).toBe(true)
      expect(unloads).toEqual([pending[0]!.options, pending[1]!.options])
    } finally {
      for (const request of pending) {
        request.rows.resolve([])
      }
      await Promise.all([
        preload.catch(() => undefined),
        liveCleaned ? Promise.resolve() : live.cleanup(),
      ])
      await Promise.all([parent.cleanup(), child.cleanup()])
    }
  },
)

it.each([`resolve`, `reject`, `cleanup`] as const)(
  `matches cross-source initial readiness through %s`,
  async (secondOutcome) => {
    const sessionId = `session-1`
    const leftId = `readiness-left-${secondOutcome}`
    const rightId = `readiness-right-${secondOutcome}`
    const leftDelivery = createDeferred<void>()
    const rightDelivery = createDeferred<void>()
    const history: Array<LoadSubsetFullFlowEvent> = [
      {
        type: `registerSourceDemand`,
        sessionId,
        sourceId: leftId,
        demandId: `all`,
        attemptId: `left-attempt`,
      },
      {
        type: `registerSourceDemand`,
        sessionId,
        sourceId: rightId,
        demandId: `all`,
        attemptId: `right-attempt`,
      },
    ]
    const createSource = (
      id: string,
      row: Row,
      delivery: ReturnType<typeof createDeferred<void>>,
    ) =>
      createCollection<Row>({
        id,
        getKey: (value) => value.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () =>
                delivery.promise.then(async () => {
                  begin()
                  write({ type: `insert`, value: row })
                  const applied = commit()
                  if (applied !== true) await applied
                  return { hasMore: false, appliedRowKeys: [row.id] }
                }),
              unloadSubset: () => {},
            }
          },
        },
      })
    const left = createSource(
      leftId,
      { id: `left`, group: `shared` },
      leftDelivery,
    )
    const right = createSource(
      rightId,
      { id: `right`, group: `shared` },
      rightDelivery,
    )
    const live = createLiveQueryCollection({
      id: `readiness-live-${secondOutcome}`,
      query: (q) =>
        q
          .from({ left })
          .innerJoin({ right }, ({ left: leftRow, right: rightRow }) =>
            eq(leftRow.group, rightRow.group),
          )
          .select(({ left: leftRow, right: rightRow }) => ({
            leftId: leftRow.id,
            rightId: rightRow.id,
          })),
      startSync: true,
    })
    const preload = live.preload()
    void preload.catch(() => undefined)

    try {
      expect(live.status).toBe(projectSourceReadiness(history).status)

      leftDelivery.resolve()
      history.push({
        type: `settleSourceDemand`,
        sessionId,
        sourceId: leftId,
        demandId: `all`,
        attemptId: `left-attempt`,
        outcome: `resolve`,
      })
      await flushPromises()

      expect(live.status).toBe(projectSourceReadiness(history).status)
      expect(live.toArray).toEqual([])

      if (secondOutcome === `cleanup`) {
        await live.cleanup()
        history.push({ type: `cleanupSession`, sessionId })
        expect(live.status).toBe(projectSourceReadiness(history).status)

        rightDelivery.resolve()
        history.push({
          type: `settleSourceDemand`,
          sessionId,
          sourceId: rightId,
          demandId: `all`,
          attemptId: `right-attempt`,
          outcome: `resolve`,
        })
        await flushPromises()

        expect(live.status).toBe(projectSourceReadiness(history).status)
        expect(live.toArray).toEqual([])
        return
      } else if (secondOutcome === `resolve`) {
        rightDelivery.resolve()
      } else {
        rightDelivery.reject(new Error(`right source failed`))
      }
      history.push({
        type: `settleSourceDemand`,
        sessionId,
        sourceId: rightId,
        demandId: `all`,
        attemptId: `right-attempt`,
        outcome: secondOutcome,
      })
      await flushPromises()

      const expected = projectSourceReadiness(history)
      expect(live.status).toBe(expected.status)
      if (secondOutcome === `resolve`) {
        await expect(preload).resolves.toBeUndefined()
        expect(live.toArray).toEqual([
          expect.objectContaining({ leftId: `left`, rightId: `right` }),
        ])
      } else {
        await expect(preload).rejects.toThrow(`right source failed`)
        expect(expected.failedSources).toEqual([rightId])
      }
    } finally {
      leftDelivery.resolve()
      rightDelivery.resolve()
      await live.cleanup()
      await Promise.all([left.cleanup(), right.cleanup()])
    }
  },
)
