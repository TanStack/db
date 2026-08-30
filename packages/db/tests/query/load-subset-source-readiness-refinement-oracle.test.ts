import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { projectSourceReadiness } from '../load-subset-full-flow-model.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'

type Row = { id: string; group: string }

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
