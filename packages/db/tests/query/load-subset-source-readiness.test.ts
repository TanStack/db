// Ordinary loadSubset source-readiness tests: a join whose right source
// resolves, rejects, or is cleaned up while preload waits, with each terminal
// status written out. The fenced-attempt law that the generated cases check is
// owned by load-subset-source-readiness-refinement-oracle.test.ts.
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { flushPromises } from '../utils.js'
import { finishCleanup } from './load-subset-source-readiness-support.js'

type Row = { id: string; group: string }

it.each([`resolve`, `reject`, `cleanup`] as const)(
  `matches cross-source initial readiness through %s`,
  async (secondOutcome) => {
    const leftId = `readiness-left-${secondOutcome}`
    const rightId = `readiness-right-${secondOutcome}`
    const leftDelivery = createDeferred<void>()
    const rightDelivery = createDeferred<void>()
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
                  return
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
    let primaryFailure: { error: unknown } | undefined

    try {
      expect(live.status).toBe(`loading`)

      leftDelivery.resolve()
      await flushPromises()

      expect(live.status).toBe(`loading`)
      expect(live.toArray).toEqual([])

      if (secondOutcome === `cleanup`) {
        await live.cleanup()
        expect(live.status).toBe(`cleaned-up`)
        await expect(preload).rejects.toMatchObject({ name: `AbortError` })

        // This late write probes terminal query status with a nonconforming
        // source; a conforming request-scoped loader stops after cancellation.
        rightDelivery.resolve()
        await flushPromises()

        expect(live.status).toBe(`cleaned-up`)
        expect(live.toArray).toEqual([])
        return
      } else if (secondOutcome === `resolve`) {
        rightDelivery.resolve()
      } else {
        rightDelivery.reject(new Error(`right source failed`))
      }
      await flushPromises()

      expect(live.status).toBe(secondOutcome === `resolve` ? `ready` : `error`)
      if (secondOutcome === `resolve`) {
        await expect(preload).resolves.toBeUndefined()
        expect(live.toArray).toEqual([
          expect.objectContaining({ leftId: `left`, rightId: `right` }),
        ])
      } else {
        await expect(preload).rejects.toThrow(`right source failed`)
      }
    } catch (error) {
      primaryFailure = { error }
      throw error
    } finally {
      leftDelivery.resolve()
      rightDelivery.resolve()
      await finishCleanup(primaryFailure, [
        [{ name: `live query`, run: () => live.cleanup() }],
        [
          { name: `left source`, run: () => left.cleanup() },
          { name: `right source`, run: () => right.cleanup() },
        ],
      ])
    }
  },
)
