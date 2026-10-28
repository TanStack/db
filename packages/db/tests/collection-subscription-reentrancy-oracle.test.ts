import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { where } from './collection-subscription-reentrancy-fixture.js'
import { reentrantSnapshotHistories } from './collection-subscription-lifecycle-grammar-oracle.js'
import { declareOracle } from './oracle-declaration.js'
import type { LoadSubsetOptions } from '../src/types.js'

/**
 * # Which snapshot work survives callback reentry?
 *
 * The lifecycle grammar owns logical demand and physical acquisition. This
 * bounded companion crosses the callback that interrupts a direct snapshot
 * with the ownership action it performs. Once that action retires the demand
 * or subscription, the request returns false and publishes no local snapshot.
 * An accepted physical acquisition is released once. An optimized read whose
 * fallback callback retires the demand must not start the fallback read.
 *
 * The simple reference is the ownership law above, not the production branch
 * order. The driver uses the real Collection subscription and records return
 * value, row publications, acquisition releases, and snapshot reads at the
 * synchronous return checkpoint. Replay and asynchronous settlement have
 * separate primary owners in the lifecycle and replay oracles.
 */

// The ownership law fixes what a direct snapshot publishes and releases when
// its callback retires the demand. The phase decides whether the callback
// runs before the result hook, and whether the optimized read is reached.
function expectSnapshotReentryOutcome(observed: {
  phase: string
  reentries: number
  resultHooks: number
  accepted: boolean
  publications: ReadonlyArray<ReadonlyArray<string>>
  loads: ReadonlyArray<LoadSubsetOptions>
  unloads: ReadonlyArray<LoadSubsetOptions>
  reads: unknown
}): void {
  const { phase, reentries, resultHooks, accepted, publications } = observed
  const { loads, unloads, reads } = observed
  expect(reentries).toBe(1)
  expect(resultHooks).toBe(phase === `loadSubset` ? 0 : 1)
  expect(accepted).toBe(false)
  expect(publications).toEqual([])
  expect(loads).toHaveLength(1)
  expect(unloads).toEqual(loads)
  expect(loads[0]?.signal?.aborted).toBe(true)
  expect(reads).toHaveBeenCalledTimes(
    phase === `loadSubset` ||
      phase === `onLoadSubsetResult` ||
      phase === `statusLoadingSubset`
      ? 0
      : 1,
  )
}

declareOracle({ check: [expectSnapshotReentryOutcome] })

describe(`Collection subscription callback reentry oracle`, () => {
  it.each(reentrantSnapshotHistories)(
    `stops a direct snapshot after $phase calls $action`,
    async ({ phase, action }) => {
      let reentries = 0
      let armSnapshotReentry = false
      const threshold = {
        [Symbol.toPrimitive]: () => {
          if (armSnapshotReentry) {
            armSnapshotReentry = false
            reentries++
            if (action === `release`)
              subscription.releaseSnapshot(requestedWhere)
            else subscription.unsubscribe()
          }
          return `a`
        },
      }
      const requestedWhere =
        phase === `snapshotEvaluation`
          ? new Func(`gt`, [new PropRef([`id`]), new Value(threshold)])
          : where()
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const publications: Array<ReadonlyArray<string>> = []
      let resultHooks = 0
      const transport = createDeferred<void>()
      const collection = createCollection<{ id: string }>({
        id: `snapshot-reentry-${phase}-${action}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            operations.begin()
            operations.write({ type: `insert`, value: { id: `row` } })
            operations.commit()
            operations.markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (phase === `loadSubset`) {
                  reentries++
                  if (action === `release`)
                    subscription.releaseSnapshot(requestedWhere)
                  else subscription.unsubscribe()
                }
                return phase === `statusLoadingSubset`
                  ? transport.promise
                  : true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => publications.push(changes.map(({ value }) => value.id)),
        { includeInitialState: false },
      )
      if (phase === `statusLoadingSubset`) {
        subscription.on(`status:loadingSubset`, () => {
          reentries++
          if (action === `release`) subscription.releaseSnapshot(requestedWhere)
          else subscription.unsubscribe()
        })
      }
      const reads = vi.spyOn(collection, `currentStateAsChanges`)
      armSnapshotReentry = phase === `snapshotEvaluation`

      try {
        const accepted = subscription.requestSnapshot({
          where: requestedWhere,
          onLoadSubsetResult: (_result, _options, release) => {
            resultHooks++
            if (phase !== `onLoadSubsetResult`) return
            reentries++
            if (action === `release`) release()
            else subscription.unsubscribe()
          },
          ...(phase === `onUnoptimized`
            ? {
                onUnoptimized: () => {
                  reentries++
                  if (action === `release`)
                    subscription.releaseSnapshot(requestedWhere)
                  else subscription.unsubscribe()
                },
              }
            : {}),
        })

        expectSnapshotReentryOutcome({
          phase,
          reentries,
          resultHooks,
          accepted,
          publications,
          loads,
          unloads,
          reads,
        })
      } finally {
        transport.resolve()
        reads.mockRestore()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )
})
