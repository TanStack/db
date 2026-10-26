import { afterAll, describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import {
  captureMicrotaskErrors,
  createOnDemandCollection,
  flushPromises,
} from './utils.js'
import { oracleReplayRequested } from './oracle-config.js'
import {
  acquisitionInteractionCellDefinitions,
  failureScenarios,
  legalAcquisitionCells,
  releaseScenarios,
  restartScenarios,
  startScenarios,
} from './collection-subscription-lifecycle-cell-support.js'
import type {
  AcquisitionCell,
  AcquisitionInteraction,
  AcquisitionInteractionCell,
  StartReentry,
} from './collection-subscription-lifecycle-cell-support.js'
import type { CollectionSubscription } from '../src/collection/subscription.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

/**
 * Cell witnesses for the subscription acquisition boundary matrix. Each
 * acquisition case declares the cells it may reach, and the scenario drivers
 * record the cells, interactions, sync-run boundaries, and failure-delivery
 * suffixes that they observe. The coverage audit in afterAll fails if a legal
 * cell was never observed.
 *
 * The law, the cell definitions, and the scenario grammar are owned by
 * collection-subscription-lifecycle-oracle.test.ts and its support module.
 * Undeclared reach is a failure. Every observer and audit state is local to
 * this module, so the witnesses and the audit must run in the same file.
 */

const observedAcquisitionCells = new Set<AcquisitionCell>()

function acquisitionCase(
  cells: ReadonlyArray<AcquisitionCell>,
  name: string,
  run: (reach: (cell: AcquisitionCell) => void) => void | Promise<void>,
): void {
  const declaredCells = new Set(cells)
  it(name, () =>
    run((cell) => {
      if (!declaredCells.has(cell)) {
        throw new Error(`${name} reached undeclared acquisition cell ${cell}`)
      }
      observedAcquisitionCells.add(cell)
    }),
  )
}

const requiredAcquisitionInteractions = new Map<
  AcquisitionInteractionCell,
  AcquisitionInteraction
>(
  Object.entries(acquisitionInteractionCellDefinitions).flatMap(
    ([cell, definition]) =>
      definition.kind === `covered`
        ? [[cell as AcquisitionInteractionCell, definition.interaction]]
        : [],
  ),
)
const observedAcquisitionInteractions = new Map<
  AcquisitionInteractionCell,
  AcquisitionInteraction
>()

function observeAcquisitionInteraction(
  cell: AcquisitionInteractionCell,
  interaction: AcquisitionInteraction,
): void {
  observedAcquisitionInteractions.set(cell, interaction)
}

const requiredSyncRunBoundaries = new Set([
  `active-cleanup`,
  `restart-installed`,
  `cleanup-callback-reentry`,
  `obsolete-resource-return`,
] as const)
type SyncRunBoundary =
  typeof requiredSyncRunBoundaries extends Set<infer T> ? T : never
const observedSyncRunBoundaries = new Set<SyncRunBoundary>()

function observeSyncRunBoundary(boundary: SyncRunBoundary): void {
  observedSyncRunBoundaries.add(boundary)
}

type FailureDeliverySuffix = `${`throw` | `reject`}:${StartReentry}`
const requiredFailureDeliverySuffixes = new Set<FailureDeliverySuffix>(
  failureScenarios.map(
    ({ outcome, reentry }) => `${outcome}:${reentry}` as const,
  ),
)
const observedFailureDeliverySuffixes = new Set<FailureDeliverySuffix>()

describe(`CollectionSubscription demand lifecycle oracle`, () => {
  afterAll(() => {
    // A direct property replay may select only that test by name.
    if (oracleReplayRequested()) return
    expect(observedAcquisitionCells).toEqual(legalAcquisitionCells)
    expect(observedAcquisitionInteractions).toEqual(
      requiredAcquisitionInteractions,
    )
    expect(observedSyncRunBoundaries).toEqual(requiredSyncRunBoundaries)
    expect(observedFailureDeliverySuffixes).toEqual(
      requiredFailureDeliverySuffixes,
    )
  })

  it.each(startScenarios)(
    `keeps logical and physical ownership aligned for $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const failure = new Error(`target load failed`)
      const pending = createDeferred<void>()
      // A reentrant release can make the subscription stop observing the
      // adapter Promise. Keep the test process deterministic while separately
      // asserting the subscription's public error trace below.
      void pending.promise.catch(() => {})
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const statuses: Array<string> = []
      const controller = new AbortController()
      let didReenter = false
      let statusAtTruncate: string | undefined
      let truncate!: () => void
      let runReentry = () => {}

      const collection = createOnDemandCollection<{ id: string }>({
        id: `demand-start-${outcome}-${reentry}`,
        sync: {
          sync: (operations) => {
            const { markReady } = operations
            truncate = () => {
              operations.begin()
              operations.truncate()
              operations.commit()
            }
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) return true
                if (didReenter) return true
                didReenter = true
                runReentry()
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      if (reentry === `release-peer`) {
        subscription.requestSnapshot({ where: peerWhere })
      }
      runReentry = () => {
        if (reentry === `abort-self`) {
          controller.abort()
        } else if (reentry === `truncate`) {
          truncate()
          statusAtTruncate = subscription.status
        } else if (reentry === `release-self`) {
          subscription.releaseSnapshot(targetWhere)
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        } else if (reentry === `cleanup`) {
          void collection.cleanup()
        }
      }

      let thrown: unknown
      try {
        subscription.requestSnapshot({
          where: targetWhere,
          signal: controller.signal,
        })
      } catch (error) {
        thrown = error
      }

      if (reentry === `truncate`) {
        // The old acquisition is obsolete, but the queued replacement still
        // owns a loading interval until its setup and work finish.
        expect(statusAtTruncate).toBe(`loadingSubset`)
        expect(subscription.status).toBe(`loadingSubset`)
        expect(loads).toHaveLength(1)
      }
      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)
      const targetWasReleased =
        reentry === `release-self` ||
        reentry === `truncate` ||
        reentry === `unsubscribe` ||
        reentry === `cleanup`
      const targetStarted = outcome !== `throw` && reentry !== `cleanup`

      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      const interaction =
        reentry === `abort-self`
          ? `starting:abort`
          : reentry === `truncate`
            ? `starting:truncate`
            : reentry === `release-self`
              ? `starting:release`
              : reentry === `release-peer`
                ? `active:release`
                : reentry === `unsubscribe`
                  ? `starting:unsubscribe`
                  : reentry === `cleanup`
                    ? `starting:cleanup`
                    : undefined
      if (interaction) {
        observeAcquisitionInteraction(
          interaction,
          reentry === `abort-self` ? `abort-only` : `retire`,
        )
      }

      expect(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect(targetLoad.signal?.aborted).toBe(
        outcome === `throw` || targetWasReleased || reentry === `abort-self`,
      )
      expect(unloads.filter((options) => options === targetLoad)).toHaveLength(
        Number(targetStarted && targetWasReleased),
      )
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer`),
      )
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) &&
          !targetWasReleased &&
          reentry !== `abort-self`
          ? [failure]
          : [],
      )
      expect(statuses).toEqual(
        reentry === `truncate` ||
          ((outcome === `resolve` || outcome === `reject`) &&
            !targetWasReleased)
          ? [`loadingSubset`, `ready`]
          : [],
      )
      if (reentry === `truncate`) {
        // A synchronous throw never acquired an owner to replay. Returned work
        // retains logical demand, even when its first transport later rejects.
        expect(loads).toHaveLength(outcome === `throw` ? 1 : 2)
        if (outcome !== `throw`) {
          expect(loads[1]).not.toBe(targetLoad)
          expect(loads[1]?.where).toBe(targetWhere)
          expect(loads[1]?.signal?.aborted).toBe(false)
        }
      }

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it.each(failureScenarios)(
    `keeps a $outcome failure primary during $reentry error delivery`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const failure = new Error(`target load failed`)
      const pending = createDeferred<void>()
      const loads: Array<LoadSubsetOptions> = []
      const attempts: Array<{
        syncRunGeneration: number
        options: LoadSubsetOptions
        result: `peer-return` | `throw` | `pending` | `replay-return`
      }> = []
      const unloads: Array<LoadSubsetOptions> = []
      const sourceCleanupSyncRuns: Array<number> = []
      const errors: Array<unknown> = []
      const statuses: Array<string> = []
      const controller = new AbortController()
      let truncateCount = 0
      let truncate = () => {}
      let targetLoadCount = 0

      const collection = createOnDemandCollection<{ id: string }>({
        id: `demand-failure-${outcome}-${reentry}`,
        sync: {
          sync: (operations) => {
            truncate = () => {
              truncateCount++
              operations.begin()
              operations.truncate()
              operations.commit()
            }
            const { markReady } = operations
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) {
                  attempts.push({
                    syncRunGeneration: 0,
                    options,
                    result: `peer-return`,
                  })
                  return true
                }
                targetLoadCount++
                if (targetLoadCount > 1) {
                  attempts.push({
                    syncRunGeneration: 0,
                    options,
                    result: `replay-return`,
                  })
                  return true
                }
                if (outcome === `throw`) {
                  attempts.push({
                    syncRunGeneration: 0,
                    options,
                    result: `throw`,
                  })
                  throw failure
                }
                attempts.push({
                  syncRunGeneration: 0,
                  options,
                  result: `pending`,
                })
                return pending.promise
              },
              unloadSubset: (options) => unloads.push(options),
              cleanup: () => {
                sourceCleanupSyncRuns.push(0)
              },
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        if (reentry === `abort-self`) {
          controller.abort()
        } else if (reentry === `truncate`) {
          truncate()
        } else if (reentry === `release-self`) {
          subscription.releaseSnapshot(targetWhere)
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        } else if (reentry === `cleanup`) {
          void collection.cleanup()
        }
      })

      subscription.requestSnapshot({ where: peerWhere })
      let thrown: unknown
      try {
        subscription.requestSnapshot({
          where: targetWhere,
          signal: controller.signal,
        })
      } catch (error) {
        thrown = error
      }
      if (outcome === `reject`) {
        pending.reject(failure)
      }
      await flushPromises()

      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)!
      const targetAttempts = attempts.filter(
        ({ options }) => options.where === targetWhere,
      )
      const peerAttempts = attempts.filter(
        ({ options }) => options.where === peerWhere,
      )
      const tearsDownTarget =
        reentry === `release-self` || reentry === `unsubscribe`

      expect.soft(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect.soft(errors).toEqual([failure])
      expect.soft(subscription.lastError).toBe(failure)
      expect.soft(targetAttempts[0]?.options).toBe(targetLoad)
      expect.soft(targetAttempts[0]?.syncRunGeneration).toBe(0)
      expect
        .soft(targetAttempts[0]?.result)
        .toBe(outcome === `throw` ? `throw` : `pending`)
      expect.soft(controller.signal.aborted).toBe(reentry === `abort-self`)
      expect.soft(truncateCount).toBe(Number(reentry === `truncate`))
      expect
        .soft(unloads.filter((options) => options === targetLoad))
        .toHaveLength(
          Number(
            outcome === `reject` && (tearsDownTarget || reentry === `truncate`),
          ),
        )
      expect
        .soft(unloads.filter((options) => options === peerLoad))
        .toHaveLength(
          Number(
            reentry === `release-peer` ||
              reentry === `unsubscribe` ||
              reentry === `truncate`,
          ),
        )
      expect
        .soft(statuses)
        .toEqual(
          reentry === `truncate`
            ? [`loadingSubset`, `ready`]
            : outcome === `reject`
              ? reentry === `unsubscribe`
                ? [`loadingSubset`]
                : [`loadingSubset`, `ready`]
              : [],
        )
      if (reentry === `abort-self`) {
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        expect.soft(targetAttempts).toHaveLength(1)
        expect.soft(peerAttempts).toHaveLength(1)
      }
      const replacement = targetAttempts[1]?.options
      const peerReplacement = peerAttempts[1]?.options
      if (reentry === `truncate`) {
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        // Error delivery may request replay, but it cannot turn a failed
        // synchronous start into an owned acquisition. Only the peer survives.
        expect.soft(targetAttempts).toHaveLength(outcome === `reject` ? 2 : 1)
        if (outcome === `reject`) {
          expect.soft(replacement).not.toBe(targetLoad)
          expect.soft(replacement?.where).toBe(targetWhere)
          expect.soft(targetAttempts[1]?.syncRunGeneration).toBe(0)
          expect.soft(targetAttempts[1]?.result).toBe(`replay-return`)
        } else {
          expect.soft(replacement).toBeUndefined()
        }
        expect.soft(peerLoad.signal?.aborted).toBe(true)
        expect.soft(peerAttempts).toHaveLength(2)
        expect.soft(peerReplacement).not.toBe(peerLoad)
        expect.soft(peerReplacement?.where).toBe(peerWhere)
        expect.soft(peerAttempts[1]?.syncRunGeneration).toBe(0)
        expect.soft(peerAttempts[1]?.result).toBe(`peer-return`)
        expect.soft(unloads).toHaveLength(outcome === `reject` ? 2 : 1)
      }
      if (reentry === `cleanup`) {
        expect.soft(collection.status).toBe(`cleaned-up`)
        expect.soft(peerLoad.signal?.aborted).toBe(true)
        expect.soft(targetLoad.signal?.aborted).toBe(true)
        expect.soft(subscription.status).toBe(`ready`)
      }

      subscription.unsubscribe()
      const replays = reentry === `truncate`
      expect
        .soft(targetAttempts)
        .toHaveLength(replays && outcome === `reject` ? 2 : 1)
      expect.soft(peerAttempts).toHaveLength(replays ? 2 : 1)
      expect
        .soft(unloads.filter((options) => options === targetLoad))
        .toHaveLength(Number(outcome === `reject` && reentry !== `cleanup`))
      expect
        .soft(unloads.filter((options) => options === peerLoad))
        .toHaveLength(Number(reentry !== `cleanup`))
      if (replacement) {
        expect
          .soft(unloads.filter((options) => options === replacement))
          .toHaveLength(Number(replays))
        expect.soft(replacement.signal?.aborted).toBe(true)
      }
      if (peerReplacement) {
        expect
          .soft(unloads.filter((options) => options === peerReplacement))
          .toHaveLength(Number(replays))
        expect.soft(peerReplacement.signal?.aborted).toBe(true)
      }
      const expectedUnloads =
        reentry === `cleanup`
          ? 0
          : (outcome === `reject` ? 2 : 1) * (replays ? 2 : 1)
      expect.soft(unloads).toHaveLength(expectedUnloads)
      expect.soft(peerLoad.signal?.aborted).toBe(true)
      expect.soft(targetLoad.signal?.aborted).toBe(true)
      const terminalAttempts = [...attempts]
      const terminalUnloads = [...unloads]
      const terminalStatuses = [...statuses]
      await collection.cleanup()
      expect.soft(sourceCleanupSyncRuns).toEqual([0])
      expect.soft(collection.status).toBe(`cleaned-up`)
      expect.soft(errors).toEqual([failure])
      expect.soft(subscription.lastError).toBe(failure)
      expect.soft(attempts).toEqual(terminalAttempts)
      expect.soft(unloads).toEqual(terminalUnloads)
      expect.soft(statuses).toEqual(terminalStatuses)
      observedFailureDeliverySuffixes.add(`${outcome}:${reentry}`)
    },
  )

  it.each(releaseScenarios)(
    `retires logical ownership once for unload $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const releaseFailure = new Error(`target release failed`)
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const uncaught = captureMicrotaskErrors()
      let allowRelease = outcome === `return`
      let runReentry = () => {}

      const collection = createOnDemandCollection<{ id: string }>({
        id: `demand-release-${outcome}-${reentry}`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => {
                unloads.push(options)
                if (options === loads[1]) {
                  runReentry()
                  if (!allowRelease) throw releaseFailure
                }
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot({ where: peerWhere })
      subscription.requestSnapshot({ where: targetWhere })
      const peerLoad = loads[0]!
      const oldTargetLoad = loads[1]!
      runReentry = () => {
        runReentry = () => {}
        if (reentry === `reacquire-self`) {
          subscription.requestSnapshot({ where: targetWhere })
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        }
      }

      let thrown: unknown
      try {
        subscription.releaseSnapshot(targetWhere)
      } catch (error) {
        thrown = error
      }
      observeAcquisitionInteraction(`active:release`, `retire`)
      if (reentry === `unsubscribe`) {
        observeAcquisitionInteraction(`active:unsubscribe`, `retire`)
      }

      // The release law: the caller never sees the adapter's release error.
      expect(thrown).toBe(undefined)
      await Promise.resolve()
      expect(uncaught.errors).toEqual(
        outcome === `throw` ? [releaseFailure] : [],
      )
      expect(oldTargetLoad.signal?.aborted).toBe(true)
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(1)
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer` || reentry === `unsubscribe`),
      )
      // A release error is not a load error.
      expect(errors).toEqual([])
      expect(subscription.lastError).toBe(undefined)

      allowRelease = true
      subscription.unsubscribe()
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(1)
      const replacement = loads[2]
      expect(
        replacement === undefined
          ? []
          : unloads.filter((options) => options === replacement),
      ).toHaveLength(Number(reentry === `reacquire-self`))
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(1)
      if (outcome === `throw` && reentry === `unsubscribe`) {
        observeAcquisitionInteraction(
          `failed-release:unsubscribe`,
          `no-repeat-on-unsubscribe`,
        )
      }
      await collection.cleanup()
      await Promise.resolve()
      // Reported once: neither teardown repeats the attempted release.
      expect(uncaught.errors).toEqual(
        outcome === `throw` ? [releaseFailure] : [],
      )
      uncaught.restore()
    },
  )

  it.each(restartScenarios)(
    `keeps restart ownership aligned for $outcome × $reentry`,
    async ({ outcome, reentry }) => {
      type DemandName = `target` | `peer`
      const targetWhere = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`target`),
      ])
      const peerWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`peer`)])
      const demandForWhere = new Map<unknown, DemandName>([
        [targetWhere, `target`],
        [peerWhere, `peer`],
      ])
      const failure = new Error(`restart acquisition failed`)
      const pending = createDeferred<void>()
      void pending.promise.catch(() => {})
      const loads: Array<{
        syncRunGeneration: number
        demand: DemandName
      }> = []
      const unloads: Array<{
        syncRunGeneration: number
        demand: DemandName
      }> = []
      const sourceCleanups: Array<number> = []
      const errors: Array<unknown> = []
      let nextSyncRunGeneration = -1
      let ranReentry = false

      const collection = createOnDemandCollection<{ id: string }>({
        id: `restart-${outcome}-${reentry}`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = ++nextSyncRunGeneration
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                loads.push({ syncRunGeneration, demand })
                if (syncRunGeneration === 0 || demand === `peer`) return true
                if (!ranReentry) {
                  ranReentry = true
                  if (reentry === `release-self`) {
                    subscription.releaseSnapshot(targetWhere)
                  } else if (reentry === `release-peer`) {
                    subscription.releaseSnapshot(peerWhere)
                  } else if (reentry === `unsubscribe`) {
                    subscription.unsubscribe()
                  } else if (reentry === `cleanup`) {
                    void collection.cleanup()
                  }
                }
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                unloads.push({ syncRunGeneration, demand })
              },
              cleanup: () => {
                sourceCleanups.push(syncRunGeneration)
              },
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot({ where: targetWhere })
      subscription.requestSnapshot({ where: peerWhere })

      await collection.cleanup()
      expect(sourceCleanups).toEqual([0])
      observeAcquisitionInteraction(`active:cleanup`, `retire`)
      collection.startSyncImmediate()
      observeSyncRunBoundary(`restart-installed`)
      await flushPromises()
      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      const targetEstablished = outcome !== `throw` && reentry !== `cleanup`
      const targetSurvives = reentry === `none` || reentry === `release-peer`
      const peerStarts =
        reentry !== `release-peer` &&
        reentry !== `unsubscribe` &&
        reentry !== `cleanup`
      expect(loads).toEqual([
        { syncRunGeneration: 0, demand: `target` },
        { syncRunGeneration: 0, demand: `peer` },
        { syncRunGeneration: 1, demand: `target` },
        ...(peerStarts
          ? [{ syncRunGeneration: 1, demand: `peer` as const }]
          : []),
      ])
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) && targetSurvives
          ? [failure]
          : [],
      )

      if (reentry !== `unsubscribe`) subscription.unsubscribe()
      expect(unloads).toEqual([
        ...(targetEstablished && !targetSurvives
          ? [{ syncRunGeneration: 1, demand: `target` as const }]
          : []),
        ...(targetEstablished && targetSurvives
          ? [{ syncRunGeneration: 1, demand: `target` as const }]
          : []),
        ...(peerStarts
          ? [{ syncRunGeneration: 1, demand: `peer` as const }]
          : []),
      ])
      await collection.cleanup()
      expect(sourceCleanups).toEqual([0, 1])
    },
  )

  acquisitionCase(
    [`starting:request`],
    `includes demand created by the synchronous restart status callback`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const unloads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      let nextSyncRunGeneration = -1
      let requestOnRestart = false
      const collection = createOnDemandCollection<{ id: string }>({
        id: `restart-status-reentry`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = ++nextSyncRunGeneration
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                loads.push({ syncRunGeneration, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                unloads.push({ syncRunGeneration, demand })
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`status:change`, ({ status }) => {
        if (!requestOnRestart || status !== `loadingSubset`) return
        requestOnRestart = false
        subscription.requestSnapshot({ where: newWhere })
        reach(`starting:request`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnRestart = true
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { syncRunGeneration: 0, demand: `old` },
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloads).toEqual([
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`starting:markReady`],
    `does not settle demand reentered before the restart loader is installed`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const unloads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const observed: Array<unknown> = []
      let nextSyncRunGeneration = -1
      let requestOnReady = false
      const collection = createOnDemandCollection<{ id: string }>({
        id: `restart-ready-reentry`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = ++nextSyncRunGeneration
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown ready demand`)
                loads.push({ syncRunGeneration, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown ready unload`)
                unloads.push({ syncRunGeneration, demand })
              },
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      const removeReadyListener = collection.on(`status:ready`, () => {
        if (!requestOnReady) return
        requestOnReady = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => observed.push(result),
        })
        reach(`starting:markReady`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnReady = true
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { syncRunGeneration: 0, demand: `old` },
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      expect(observed).toEqual([expect.any(Promise)])
      expect(subscription.status).toBe(`ready`)

      removeReadyListener()
      subscription.unsubscribe()
      expect(unloads).toEqual([
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`unavailable:request`],
    `does not settle demand reentered before a failed restart installs a loader`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const syncFailure = new Error(`replacement sync failed`)
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const unloads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const observed: Array<unknown> = []
      let nextSyncRunGeneration = -1
      let requestOnError = false
      const collection = createOnDemandCollection<{ id: string }>({
        id: `restart-error-reentry`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = ++nextSyncRunGeneration
            if (syncRunGeneration === 1) throw syncFailure
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown error demand`)
                loads.push({ syncRunGeneration, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown error unload`)
                unloads.push({ syncRunGeneration, demand })
              },
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      const removeErrorListener = collection.on(`status:error`, () => {
        if (!requestOnError) return
        requestOnError = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => observed.push(result),
        })
        reach(`unavailable:request`)
      })
      subscription.requestSnapshot({ where: oldWhere })

      await collection.cleanup()
      requestOnError = true
      expect(() => collection.startSyncImmediate()).toThrow(syncFailure)
      expect(observed).toEqual([expect.any(Promise)])
      expect(collection.status).toBe(`error`)
      expect(loads).toEqual([{ syncRunGeneration: 0, demand: `old` }])

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      expect(loads).toEqual([
        { syncRunGeneration: 0, demand: `old` },
        { syncRunGeneration: 2, demand: `old` },
        { syncRunGeneration: 2, demand: `new` },
      ])
      expect(subscription.status).toBe(`ready`)

      removeErrorListener()
      subscription.unsubscribe()
      expect(unloads).toEqual([
        { syncRunGeneration: 2, demand: `old` },
        { syncRunGeneration: 2, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`retiring:request`],
    `does not acquire through a retiring adapter cleanup callback`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const demandForWhere = new Map<unknown, `old` | `new`>([
        [oldWhere, `old`],
        [newWhere, `new`],
      ])
      const loads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const unloads: Array<{
        syncRunGeneration: number
        demand: `old` | `new`
      }> = []
      const observed: Array<unknown> = []
      let nextSyncRunGeneration = -1
      let requestDuringCleanup = false
      const collection = createOnDemandCollection<{ id: string }>({
        id: `adapter-cleanup-reentry`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = ++nextSyncRunGeneration
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown cleanup demand`)
                loads.push({ syncRunGeneration, demand })
                return true
              },
              unloadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown cleanup unload`)
                unloads.push({ syncRunGeneration, demand })
              },
              cleanup: () => {
                if (!requestDuringCleanup) return
                requestDuringCleanup = false
                subscription.requestSnapshot({
                  where: newWhere,
                  onLoadSubsetResult: (result) => observed.push(result),
                })
                reach(`retiring:request`)
                observeSyncRunBoundary(`cleanup-callback-reentry`)
              },
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      subscription.requestSnapshot({ where: oldWhere })

      requestDuringCleanup = true
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()

      expect(loads).toEqual([
        { syncRunGeneration: 0, demand: `old` },
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      expect(observed).toEqual([expect.any(Promise)])

      subscription.unsubscribe()
      expect(unloads).toEqual([
        { syncRunGeneration: 1, demand: `old` },
        { syncRunGeneration: 1, demand: `new` },
      ])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`eager:request`],
    `does not release a physical subset acquisition in eager mode`,
    async (reach) => {
      let loads = 0
      let unloads = 0
      const collection = createCollection<{ id: string }>({
        id: `eager-subset-ownership`,
        getKey: ({ id }) => id,
        syncMode: `eager`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
              unloadSubset: () => {
                unloads++
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })

      subscription.requestSnapshot()
      reach(`eager:request`)
      subscription.unsubscribe()
      observeAcquisitionInteraction(`none:unsubscribe`, `no-acquisition`)

      expect(loads).toBe(0)
      expect(unloads).toBe(0)
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`on-demand:request`],
    `does not release a subset request aborted before adapter acquisition`,
    async (reach) => {
      const controller = new AbortController()
      controller.abort()
      let loads = 0
      let unloads = 0
      const errors: Array<unknown> = []
      const collection = createOnDemandCollection<{ id: string }>({
        id: `pre-aborted-subset-ownership`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
              unloadSubset: () => {
                unloads++
              },
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

      subscription.requestSnapshot({ signal: controller.signal })
      await flushPromises()
      reach(`on-demand:request`)
      subscription.unsubscribe()
      observeAcquisitionInteraction(`none:unsubscribe`, `no-acquisition`)

      expect(loads).toBe(0)
      expect(unloads).toBe(0)
      expect(errors).toEqual([])
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`on-demand:request`, `on-demand:markReady`],
    `acquires before and after ready once the on-demand loader is installed`,
    async (reach) => {
      const beforeReady = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`before`),
      ])
      const afterReady = new Func(`eq`, [
        new PropRef([`id`]),
        new Value(`after`),
      ])
      const loads: Array<LoadSubsetOptions> = []
      const unloads: Array<LoadSubsetOptions> = []
      let markReady!: () => void
      const collection = createOnDemandCollection<{ id: string }>({
        id: `installed-loader-before-ready`,
        startSync: false,
        sync: {
          sync: (operations) => {
            markReady = operations.markReady
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      const removeReadyListener = collection.on(`status:ready`, () => {
        subscription.requestSnapshot({ where: afterReady })
        reach(`on-demand:markReady`)
      })

      subscription.requestSnapshot({ where: beforeReady })
      reach(`on-demand:request`)
      expect(collection.status).toBe(`loading`)
      expect(loads.map(({ where }) => where)).toEqual([beforeReady])

      markReady()
      await flushPromises()
      expect(loads.map(({ where }) => where)).toEqual([beforeReady, afterReady])

      removeReadyListener()
      subscription.unsubscribe()
      expect(unloads).toEqual(loads)
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`deferred:request`, `deferred:resume`],
    `owns deferred-start acquisition only when it reaches the adapter`,
    async (reach) => {
      for (const action of [`resume`, `release-before-resume`] as const) {
        const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
        const loads: Array<LoadSubsetOptions> = []
        const unloads: Array<LoadSubsetOptions> = []
        const collection = createOnDemandCollection<{ id: string }>({
          id: `deferred-start-${action}`,
          startSync: false,
          sync: {
            sync: ({ markReady }) => {
              markReady()
              return {
                loadSubset: (options) => {
                  loads.push(options)
                  return true
                },
                unloadSubset: (options) => unloads.push(options),
              }
            },
          },
        })
        expect(collection._deferSyncStart()).toBe(true)
        const subscription = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        subscription.requestSnapshot({ where })
        reach(`deferred:request`)
        expect(loads).toEqual([])

        if (action === `release-before-resume`) {
          subscription.releaseSnapshot(where)
        }
        collection._resumeSyncStart()
        await flushPromises()
        if (action === `resume`) reach(`deferred:resume`)

        expect(loads).toHaveLength(action === `resume` ? 1 : 0)
        subscription.unsubscribe()
        expect(unloads).toHaveLength(action === `resume` ? 1 : 0)
        if (action === `resume`) expect(unloads).toEqual(loads)
        await collection.cleanup()
      }
    },
  )

  acquisitionCase(
    [`starting:syncReturn`],
    `does not settle ready-callback demand when on-demand sync returns no loader`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const loads: Array<LoadSubsetOptions> = []
      const observed: Array<unknown> = []
      type ResultOutcome =
        | { status: `pending` }
        | { status: `fulfilled`; value: unknown }
        | { status: `rejected`; error: unknown }
      const outcomes: Array<{ outcome: ResultOutcome }> = []
      let nextSyncRunGeneration = 0
      let requestOnReady = false
      const collection = createOnDemandCollection<{ id: string }>({
        id: `ready-before-invalid-on-demand-return`,
        sync: {
          sync: ({ markReady }) => {
            const syncRunGeneration = nextSyncRunGeneration++
            markReady()
            if (syncRunGeneration === 1) return
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      const removeReadyListener = collection.on(`status:ready`, () => {
        if (!requestOnReady) return
        requestOnReady = false
        subscription.requestSnapshot({
          where: newWhere,
          onLoadSubsetResult: (result) => {
            observed.push(result)
            const entry: { outcome: ResultOutcome } = {
              outcome: { status: `pending` },
            }
            outcomes.push(entry)
            if (result instanceof Promise) {
              void result.then(
                (value) => {
                  entry.outcome = { status: `fulfilled`, value }
                },
                (error: unknown) => {
                  entry.outcome = { status: `rejected`, error }
                },
              )
            } else {
              entry.outcome = { status: `fulfilled`, value: result }
            }
          },
        })
      })
      let failed = false
      let primaryError: unknown
      try {
        subscription.requestSnapshot({ where: oldWhere })

        await collection.cleanup()
        requestOnReady = true
        expect(() => collection.startSyncImmediate()).toThrow(
          /did not return a loadSubset handler/,
        )
        reach(`starting:syncReturn`)

        expect(observed).toEqual([expect.any(Promise)])
        expect(collection.status).toBe(`error`)
        expect(loads.map(({ where }) => where)).toEqual([oldWhere])
        await flushPromises()
        expect(outcomes).toHaveLength(1)
        const beforeUnsubscribe = outcomes[0]!.outcome
        expect(beforeUnsubscribe.status).not.toBe(`fulfilled`)
        expect(loads.map(({ where }) => where)).toEqual([oldWhere])

        removeReadyListener()
        subscription.unsubscribe()
        await flushPromises()
        const afterUnsubscribe = outcomes[0]!.outcome
        if (beforeUnsubscribe.status === `pending`) {
          expect(afterUnsubscribe.status).toBe(`rejected`)
          if (afterUnsubscribe.status !== `rejected`) {
            throw new Error(`Unsubscribed startup waiter did not reject`)
          }
          expect(afterUnsubscribe.error).toMatchObject({ name: `AbortError` })
        } else {
          // Invalid startup may already have rejected. Do not impose an
          // earlier rejection time or replace its observed error identity.
          expect(afterUnsubscribe).toBe(beforeUnsubscribe)
        }
        expect(observed).toHaveLength(1)
        expect(outcomes).toHaveLength(1)
        expect(collection.subscriberCount).toBe(0)
        expect(loads.map(({ where }) => where)).toEqual([oldWhere])
      } catch (error) {
        failed = true
        primaryError = error
      }
      const cleanupErrors: Array<unknown> = []
      for (const cleanup of [
        removeReadyListener,
        () => subscription.unsubscribe(),
        () => collection.cleanup(),
      ]) {
        try {
          await cleanup()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      if (cleanupErrors.length) {
        if (failed) {
          throw new AggregateError(
            [primaryError, ...cleanupErrors],
            `No-loader observation and cleanup failed`,
            { cause: primaryError },
          )
        }
        if (cleanupErrors.length === 1) throw cleanupErrors[0]
        throw new AggregateError(cleanupErrors, `No-loader cleanup failed`)
      }
      if (failed) throw primaryError
    },
  )

  acquisitionCase(
    [`starting:markError`, `unavailable:markReady`],
    `retains demand requested during initial error for recovery in the same sync run`,
    async (reach) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const loads: Array<LoadSubsetOptions> = []
      const observed: Array<unknown> = []
      let syncRunCount = 0
      let recover!: () => void
      const collection = createOnDemandCollection<{ id: string }>({
        id: `sync-entry-error-ready-recovery`,
        startSync: false,
        sync: {
          sync: ({ markError, markReady }) => {
            if (syncRunCount++ === 0) {
              markReady()
              return {
                loadSubset: (options) => {
                  loads.push(options)
                  return true
                },
                unloadSubset: () => {},
              }
            }
            recover = markReady
            markError(new Error(`initial sync failed`))
            reach(`starting:markError`)
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription: CollectionSubscription = collection.subscribeChanges(
        () => {},
        {
          includeInitialState: false,
        },
      )
      await collection.cleanup()
      const removeErrorListener = collection.on(`status:error`, () => {
        subscription.requestSnapshot({
          where,
          onLoadSubsetResult: (result) => observed.push(result),
        })
      })

      collection.startSyncImmediate()
      await flushPromises()
      expect.soft(collection.status).toBe(`error`)
      expect.soft(loads).toEqual([])
      expect.soft(observed).toEqual([expect.any(Promise)])

      recover()
      reach(`unavailable:markReady`)
      await flushPromises()

      expect(collection.status).toBe(`ready`)
      expect(loads.map(({ where: loadedWhere }) => loadedWhere)).toEqual([
        where,
      ])
      expect(observed).toEqual([expect.any(Promise)])
      await expect(observed[0]).resolves.toBeUndefined()

      removeErrorListener()
      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  acquisitionCase(
    [`on-demand:markError`],
    `defers demand while an installed loader is in initial error`,
    async (reach) => {
      const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
      const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
      const loads: Array<LoadSubsetOptions> = []
      let markError!: (error: unknown) => void
      let markReady!: () => void
      const collection = createOnDemandCollection<{ id: string }>({
        id: `installed-loader-initial-error`,
        startSync: false,
        sync: {
          sync: (operations) => {
            markError = operations.markError
            markReady = operations.markReady
            return {
              loadSubset: (options) => {
                loads.push(options)
                return true
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      collection.startSyncImmediate()
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.requestSnapshot({ where: oldWhere })
      const removeErrorListener = collection.on(`status:error`, () => {
        subscription.requestSnapshot({ where: newWhere })
        reach(`on-demand:markError`)
      })

      markError(new Error(`initial sync failed`))

      await flushPromises()
      expect.soft(collection.status).toBe(`error`)
      expect.soft(loads.map(({ where }) => where)).toEqual([oldWhere])

      markReady()
      await flushPromises()
      expect(loads.map(({ where }) => where)).toEqual([oldWhere, newWhere])

      removeErrorListener()
      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`directly releases eager demand without a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let loads = 0
    let unloads = 0
    const collection = createCollection<{ id: string }>({
      id: `eager-direct-release`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
            unloadSubset: () => {
              unloads++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ where })
    subscription.releaseSnapshot(where)
    observeAcquisitionInteraction(`none:release`, `no-acquisition`)

    expect(loads).toBe(0)
    expect(unloads).toBe(0)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`truncates eager demand without creating or releasing a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `eager-truncate-without-acquisition`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })

    begin()
    truncate()
    commit()
    await flushPromises()
    observeAcquisitionInteraction(`none:truncate`, `no-acquisition`)

    expect.soft(loads).toEqual([])
    expect.soft(unloads).toEqual([])

    subscription.unsubscribe()
    expect(unloads).toEqual([])
    await collection.cleanup()
  })

  it(`directly releases pre-aborted demand without a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    controller.abort()
    let loads = 0
    let unloads = 0
    const errors: Array<unknown> = []
    const collection = createOnDemandCollection<{ id: string }>({
      id: `pre-aborted-direct-release`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
            unloadSubset: () => {
              unloads++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))

    subscription.requestSnapshot({
      where,
      signal: controller.signal,
    })
    await flushPromises()
    subscription.releaseSnapshot(where)
    observeAcquisitionInteraction(`none:release`, `no-acquisition`)

    expect(loads).toBe(0)
    expect(unloads).toBe(0)
    expect(errors).toEqual([])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`aborts detached demand without creating a physical acquisition`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createOnDemandCollection<{ id: string }>({
      id: `detached-abort-without-acquisition`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    await collection.cleanup()
    subscription.requestSnapshot({ where, signal: controller.signal })
    controller.abort()
    await flushPromises()
    observeAcquisitionInteraction(`none:abort`, `no-acquisition`)

    expect(loads).toEqual([])
    expect(unloads).toEqual([])

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`keeps an aborted active acquisition until its owner retires`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const controller = new AbortController()
    const pending = createDeferred<void>()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createOnDemandCollection<{ id: string }>({
      id: `active-abort-before-release`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return pending.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    subscription.requestSnapshot({ where, signal: controller.signal })
    const acquisition = loads[0]!
    controller.abort()
    await flushPromises()
    observeAcquisitionInteraction(`active:abort`, `abort-only`)

    expect(loads).toEqual([acquisition])
    expect(acquisition.signal?.aborted).toBe(true)
    expect(unloads).toEqual([])

    pending.resolve()
    await flushPromises()
    subscription.unsubscribe()
    expect(unloads).toEqual([acquisition])
    await collection.cleanup()
  })

  it.each([`cleanup`, `release`, `unsubscribe`, `resume`] as const)(
    `settles queued demand according to whether it starts: %s`,
    async (action) => {
      const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
      const observed: Array<true | Promise<void>> = []
      let loads = 0
      const collection = createOnDemandCollection<{ id: string }>({
        id: `deferred-start-cleanup-before-resume`,
        startSync: false,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
            }
          },
        },
      })
      expect(collection._deferSyncStart()).toBe(true)
      const subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.requestSnapshot({
        where,
        onLoadSubsetResult: (result) => observed.push(result),
      })

      if (action === `cleanup`) await collection.cleanup()
      else if (action === `release`) subscription.releaseSnapshot(where)
      else if (action === `unsubscribe`) subscription.unsubscribe()
      else collection._resumeSyncStart()
      await flushPromises()
      if (action === `cleanup`) {
        observeAcquisitionInteraction(`none:cleanup`, `no-acquisition`)
      }

      expect(loads).toBe(action === `resume` ? 1 : 0)
      expect(observed).toHaveLength(1)
      const deferredResult = observed[0]
      expect(deferredResult).toBeInstanceOf(Promise)
      if (!(deferredResult instanceof Promise)) {
        throw new Error(`deferred acquisition did not return a promise`)
      }
      if (action === `resume`)
        await expect(deferredResult).resolves.toBeUndefined()
      else
        await expect(deferredResult).rejects.toMatchObject({
          name: `AbortError`,
        })

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`retires resources returned after ready-callback cleanup invalidates sync`, async () => {
    const cleanupSyncRuns: Array<number> = []
    let nextSyncRunGeneration = 0
    let cleanOnReady = false
    const collection = createOnDemandCollection<{ id: string }>({
      id: `obsolete-sync-return`,
      sync: {
        sync: ({ markReady }) => {
          const syncRunGeneration = nextSyncRunGeneration++
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {},
            cleanup: () => {
              cleanupSyncRuns.push(syncRunGeneration)
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const removeReadyListener = collection.on(`status:ready`, () => {
      if (!cleanOnReady) return
      cleanOnReady = false
      void collection.cleanup()
    })

    await collection.cleanup()
    cleanOnReady = true
    collection.startSyncImmediate()
    observeSyncRunBoundary(`obsolete-resource-return`)

    expect(collection.status).toBe(`cleaned-up`)
    expect(cleanupSyncRuns).toEqual([0, 1])

    removeReadyListener()
    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`retires failed acquisition release with its sync run cleanup`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const releaseFailure = new Error(`release failed`)
    const uncaught = captureMicrotaskErrors()
    let unloads = 0
    let sourceCleanups = 0
    const collection = createOnDemandCollection<{ id: string }>({
      id: `cleanup-failed-release`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw releaseFailure
            },
            cleanup: () => {
              sourceCleanups++
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).not.toThrow()
    await Promise.resolve()
    expect(uncaught.errors).toEqual([releaseFailure])

    await collection.cleanup()
    expect(unloads).toBe(1)
    expect(sourceCleanups).toBe(1)
    observeSyncRunBoundary(`active-cleanup`)

    await collection.cleanup()
    expect(unloads).toBe(1)
    expect(sourceCleanups).toBe(1)
    observeAcquisitionInteraction(
      `failed-release:cleanup`,
      `no-repeat-on-cleanup`,
    )
    subscription.unsubscribe()
    await Promise.resolve()
    expect(uncaught.errors).toEqual([releaseFailure])
    uncaught.restore()
  })

  it(`keeps failed releases out of truncate replay`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    const releaseFailure = new Error(`release failed`)
    const uncaught = captureMicrotaskErrors()
    let unloads = 0
    let operations!: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]
    const collection = createCollection<{ id: string }, string>({
      id: `truncate-failed-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (nextOperations) => {
          operations = nextOperations
          operations.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloads++
              if (unloads === 1) throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).not.toThrow()

    operations.begin()
    operations.truncate()
    const receipt = operations.commit()
    if (receipt !== true) await receipt
    expect(unloads).toBe(1)

    subscription.unsubscribe()
    expect(unloads).toBe(1)
    observeAcquisitionInteraction(
      `failed-release:truncate`,
      `no-repeat-on-truncate`,
    )
    await collection.cleanup()
    await Promise.resolve()
    expect(uncaught.errors).toEqual([releaseFailure])
    uncaught.restore()
  })

  it(`enters loading status when a truncate queues replay work`, async () => {
    const replay = createDeferred<void>()
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createOnDemandCollection<{ id: string }>({
      id: `queued-replay-status`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              return loads.length === 1 ? true : replay.promise
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    const original = loads[0]!

    begin()
    truncate()
    commit()
    observeAcquisitionInteraction(`active:truncate`, `retire`)

    expect(loads).toHaveLength(1)
    expect(subscription.status).toBe(`loadingSubset`)

    await flushPromises()
    const replacement = loads[1]!
    expect(loads).toHaveLength(2)
    expect(original.signal?.aborted).toBe(true)
    expect(unloads).toEqual([original])
    expect(replacement).not.toBe(original)
    expect(replacement.where).toBe(where)
    expect(replacement.signal?.aborted).toBe(false)
    replay.resolve()
    await flushPromises()
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    expect(unloads).toEqual([original, replacement])
    await collection.cleanup()
  })
})
