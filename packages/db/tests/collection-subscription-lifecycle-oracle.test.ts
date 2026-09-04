import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { flushPromises } from './utils.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
  readOracleRunConfig,
} from './oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

type StartOutcome = `return` | `throw` | `resolve` | `reject`
type StartReentry =
  | `none`
  | `release-self`
  | `release-peer`
  | `unsubscribe`
  | `cleanup`
type FailureOutcome = `throw` | `reject`
type ReleaseOutcome = `return` | `throw`
type ReleaseReentry = `none` | `reacquire-self` | `release-peer` | `unsubscribe`
type RestartReentry =
  | `none`
  | `release-self`
  | `release-peer`
  | `unsubscribe`
  | `cleanup`

const startOutcomes = [`return`, `throw`, `resolve`, `reject`] as const
const startReentries = [
  `none`,
  `release-self`,
  `release-peer`,
  `unsubscribe`,
  `cleanup`,
] as const

type StartScenario = {
  outcome: StartOutcome
  reentry: StartReentry
}

const startScenarios: ReadonlyArray<StartScenario> = startOutcomes.flatMap(
  (outcome) => startReentries.map((reentry) => ({ outcome, reentry })),
)

const failureScenarios = ([`throw`, `reject`] as const).flatMap((outcome) =>
  startReentries.map((reentry) => ({ outcome, reentry })),
)

const releaseScenarios = ([`return`, `throw`] as const).flatMap((outcome) =>
  ([`none`, `reacquire-self`, `release-peer`, `unsubscribe`] as const).map(
    (reentry) => ({ outcome, reentry }),
  ),
)

const restartScenarios = startOutcomes.flatMap((outcome) =>
  (
    [`none`, `release-self`, `release-peer`, `unsubscribe`, `cleanup`] as const
  ).map((reentry: RestartReentry) => ({ outcome, reentry })),
)

const threeGenerationScenarios = ([`resolve`, `reject`] as const).flatMap(
  (obsoleteOutcome) =>
    ([`resolve`, `reject`] as const).flatMap((currentOutcome) =>
      ([`obsolete-first`, `current-first`] as const).map((settlementOrder) => ({
        obsoleteOutcome,
        currentOutcome,
        settlementOrder,
      })),
    ),
)

type LifecycleCommand =
  | { type: `request`; demand: `a` | `b` }
  | { type: `release`; demand: `a` | `b` }
  | { type: `truncate` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `unsubscribe` }

const lifecycleCommandArbitrary: fc.Arbitrary<LifecycleCommand> = fc.oneof(
  fc.record({
    type: fc.constant(`request` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
  }),
  fc.record({
    type: fc.constant(`release` as const),
    demand: fc.constantFrom(`a` as const, `b` as const),
  }),
  fc.constant({ type: `truncate` as const }),
  fc.constant({ type: `cleanup` as const }),
  fc.constant({ type: `restart` as const }),
  fc.constant({ type: `unsubscribe` as const }),
)

const lifecycleHistoryArbitrary = fc.array(lifecycleCommandArbitrary, {
  minLength: 1,
  maxLength: 14,
})

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    lifecycleHistoryArbitrary,
    (history) => [
      ...new Set(history.map(({ type }) => type)),
      `cleanup+restart=${
        history.some(({ type }) => type === `cleanup`) &&
        history.some(({ type }) => type === `restart`)
      }`,
      `two-demands=${
        history.some(
          (command) => command.type === `request` && command.demand === `a`,
        ) &&
        history.some(
          (command) => command.type === `request` && command.demand === `b`,
        )
      }`,
    ],
    oraclePropertyOptions(1_000, `subscription-lifecycle.statistics`),
  )
}

async function runLifecycleHistory(
  history: ReadonlyArray<LifecycleCommand>,
): Promise<void> {
  type DemandName = `a` | `b`
  type Trace = { session: number; demand: DemandName }
  const where = {
    a: new Func(`eq`, [new PropRef([`id`]), new Value(`a`)]),
    b: new Func(`eq`, [new PropRef([`id`]), new Value(`b`)]),
  }
  const demandForWhere = new Map<unknown, DemandName>([
    [where.a, `a`],
    [where.b, `b`],
  ])
  const loads: Array<Trace> = []
  const unloads: Array<Trace> = []
  const expectedLoads: Array<Trace> = []
  const expectedUnloads: Array<Trace> = []
  const owners = new Set<DemandName>()
  const acquisitions = new Map<DemandName, number>()
  let session = -1
  let active = false
  let unsubscribed = false
  let syncOps: Parameters<SyncConfig<{ id: string }, string>[`sync`]>[0]

  const collection = createCollection<{ id: string }>({
    id: `generated-demand-lifecycle`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (operations) => {
        session++
        active = true
        syncOps = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown generated demand`)
            loads.push({ session, demand })
            return true
          },
          unloadSubset: (options) => {
            const demand = demandForWhere.get(options.where)
            if (!demand) throw new Error(`unknown generated demand`)
            unloads.push({ session, demand })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })

  try {
    for (const command of history) {
      if (unsubscribed) break
      if (command.type === `request`) {
        if (owners.has(command.demand)) continue
        owners.add(command.demand)
        subscription.requestSnapshot({ where: where[command.demand] })
        if (active) {
          expectedLoads.push({ session, demand: command.demand })
          acquisitions.set(command.demand, session)
        }
      } else if (command.type === `release`) {
        if (!owners.delete(command.demand)) continue
        if (acquisitions.delete(command.demand)) {
          expectedUnloads.push({ session, demand: command.demand })
        }
        subscription.releaseSnapshot(where[command.demand])
      } else if (command.type === `cleanup`) {
        await collection.cleanup()
        active = false
        acquisitions.clear()
      } else if (command.type === `restart`) {
        if (active) continue
        collection.startSyncImmediate()
        if (owners.size > 0) {
          expect(subscription.status).toBe(`loadingSubset`)
        }
        const nextSession = session
        for (const demand of owners) {
          expectedLoads.push({ session: nextSession, demand })
          acquisitions.set(demand, nextSession)
        }
      } else if (command.type === `truncate`) {
        if (!active || !syncOps) continue
        syncOps.begin()
        syncOps.truncate()
        const receipt = syncOps.commit()
        if (receipt !== true) await receipt
        for (const demand of owners) {
          expectedLoads.push({ session, demand })
          if (acquisitions.has(demand)) {
            expectedUnloads.push({ session, demand })
          }
          acquisitions.set(demand, session)
        }
      } else {
        for (const demand of owners) {
          if (acquisitions.has(demand)) {
            expectedUnloads.push({ session, demand })
          }
        }
        owners.clear()
        acquisitions.clear()
        subscription.unsubscribe()
        unsubscribed = true
      }

      await flushPromises()
      expect(loads, JSON.stringify({ history, command })).toEqual(expectedLoads)
      expect(unloads, JSON.stringify({ history, command })).toEqual(
        expectedUnloads,
      )
      if (active && owners.size > 0) {
        expect(subscription.status).toBe(`ready`)
      }
    }
  } finally {
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

/**
 * Exhaust the synchronous adapter-start boundary before adding more runtime
 * special cases. Logical demand is visible during this callback, but a
 * physical lease exists only if the callback returns.
 */
describe(`CollectionSubscription demand lifecycle oracle`, () => {
  it(`covers every finite start, failure-delivery, and release cell`, () => {
    expect(
      new Set(
        startScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(startOutcomes.length * startReentries.length)
    expect(
      new Set(
        failureScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * startReentries.length)
    expect(
      new Set(
        releaseScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(2 * 4)
    expect(
      new Set(
        restartScenarios.map(({ outcome, reentry }) => `${outcome}:${reentry}`),
      ),
    ).toHaveLength(4 * 5)
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
      let runReentry = () => {}

      const collection = createCollection<{ id: string }>({
        id: `demand-start-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) return true
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

      let thrown: unknown
      try {
        subscription.requestSnapshot({ where: targetWhere })
      } catch (error) {
        thrown = error
      }

      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)
      const targetWasReleased =
        reentry === `release-self` ||
        reentry === `unsubscribe` ||
        reentry === `cleanup`
      const targetStarted = outcome !== `throw` && reentry !== `cleanup`

      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      expect(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect(targetLoad.signal?.aborted).toBe(
        outcome === `throw` || targetWasReleased,
      )
      expect(unloads.filter((options) => options === targetLoad)).toHaveLength(
        Number(targetStarted && targetWasReleased),
      )
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer`),
      )
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) && !targetWasReleased
          ? [failure]
          : [],
      )
      expect(statuses).toEqual(
        (outcome === `resolve` || outcome === `reject`) && !targetWasReleased
          ? [`loadingSubset`, `ready`]
          : [],
      )

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
      const unloads: Array<LoadSubsetOptions> = []
      const errors: Array<unknown> = []
      const statuses: Array<string> = []
      let subscription!: ReturnType<
        ReturnType<typeof createCollection<{ id: string }>>[`subscribeChanges`]
      >

      const collection = createCollection<{ id: string }>({
        id: `demand-failure-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                loads.push(options)
                if (options.where === peerWhere) return true
                if (outcome === `throw`) throw failure
                return pending.promise
              },
              unloadSubset: (options) => unloads.push(options),
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.on(`loadSubset:error`, ({ error }) => {
        errors.push(error)
        if (reentry === `release-self`) {
          subscription.releaseSnapshot(targetWhere)
        } else if (reentry === `release-peer`) {
          subscription.releaseSnapshot(peerWhere)
        } else if (reentry === `unsubscribe`) {
          subscription.unsubscribe()
        }
      })

      subscription.requestSnapshot({ where: peerWhere })
      let thrown: unknown
      try {
        subscription.requestSnapshot({ where: targetWhere })
      } catch (error) {
        thrown = error
      }
      if (outcome === `reject`) {
        pending.reject(failure)
        await flushPromises()
      }

      const targetLoad = loads.find(({ where }) => where === targetWhere)!
      const peerLoad = loads.find(({ where }) => where === peerWhere)!
      const tearsDownTarget =
        reentry === `release-self` || reentry === `unsubscribe`

      expect(thrown).toBe(outcome === `throw` ? failure : undefined)
      expect(errors).toEqual([failure])
      expect(subscription.lastError).toBe(failure)
      expect(unloads.filter((options) => options === targetLoad)).toHaveLength(
        Number(outcome === `reject` && tearsDownTarget),
      )
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer` || reentry === `unsubscribe`),
      )
      expect(statuses).toEqual(
        outcome === `reject`
          ? reentry === `unsubscribe`
            ? [`loadingSubset`]
            : [`loadingSubset`, `ready`]
          : [],
      )

      subscription.unsubscribe()
      await collection.cleanup()
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
      let allowRelease = outcome === `return`
      let runReentry = () => {}

      const collection = createCollection<{ id: string }>({
        id: `demand-release-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
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

      expect(thrown).toBe(outcome === `throw` ? releaseFailure : undefined)
      expect(oldTargetLoad.signal?.aborted).toBe(true)
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(1)
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(
        Number(reentry === `release-peer` || reentry === `unsubscribe`),
      )
      expect(errors).toEqual(
        outcome === `throw` && reentry !== `unsubscribe`
          ? [releaseFailure]
          : [],
      )
      expect(subscription.lastError).toBe(
        outcome === `throw` ? releaseFailure : undefined,
      )

      allowRelease = true
      subscription.unsubscribe()
      expect(
        unloads.filter((options) => options === oldTargetLoad),
      ).toHaveLength(outcome === `throw` ? 2 : 1)
      const replacement = loads[2]
      expect(
        replacement === undefined
          ? []
          : unloads.filter((options) => options === replacement),
      ).toHaveLength(Number(reentry === `reacquire-self`))
      expect(unloads.filter((options) => options === peerLoad)).toHaveLength(1)
      await collection.cleanup()
    },
  )

  it.each([`resolve`, `reject`] as const)(
    `retires a pending replay on cleanup before an obsolete %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const replay = createDeferred<void>()
      const replayFailure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let syncSession = 0
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createCollection<Row>({
        id: `cleanup-pending-replay-${outcome}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            syncSession++
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            if (syncSession > 1) {
              begin()
              write({ type: `insert`, value: { id: `row`, version: 3 } })
              commit()
            }
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                return loadCount === 1 || syncSession > 1
                  ? true
                  : replay.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))

      subscription.requestSnapshot()
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      begin()
      truncate()
      commit()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      await collection.cleanup()
      collection.startSyncImmediate()
      expect(syncSession).toBe(2)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(subscription.status).toBe(`loadingSubset`)
      await flushPromises()
      expect(subscription.status).toBe(`ready`)

      if (outcome === `resolve`) replay.resolve()
      else replay.reject(replayFailure)
      await flushPromises()

      expect([...visible.values()]).toEqual([{ id: `row`, version: 3 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(statuses.at(-1)).toBe(`ready`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  it(`reacquires surviving on-demand demand after collection restart`, async () => {
    type Row = { id: string; version: number }
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let syncSession = 0
    let loadCount = 0
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const visible = new Map<string | number, Row>()
    const collection = createCollection<Row>({
      id: `restart-surviving-demand`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          syncSession++
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          operations.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              loadCount++
              begin()
              write({
                type: `insert`,
                value: { id: `row`, version: loadCount },
              })
              commit()
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              version: change.value.version,
            })
          }
        }
      },
      { includeInitialState: false },
    )
    subscription.requestSnapshot()
    expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

    await collection.cleanup()
    collection.startSyncImmediate()
    expect(subscription.status).toBe(`loadingSubset`)
    expect(loads).toHaveLength(1)
    await flushPromises()

    expect(syncSession).toBe(2)
    expect(loads).toHaveLength(2)
    expect(unloads).toEqual([])
    expect([...visible.values()]).toEqual([{ id: `row`, version: 2 }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    expect(unloads).toEqual([loads[1]])
    await collection.cleanup()
  })

  it(`reacquires demand requested while the collection is cleaned up`, async () => {
    const oldWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`old`)])
    const newWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`new`)])
    let syncSession = 0
    const loads: Array<{ session: number; options: LoadSubsetOptions }> = []
    const unloads: Array<{ session: number; options: LoadSubsetOptions }> = []
    const collection = createCollection<{ id: string }>({
      id: `request-while-cleaned-up`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const session = syncSession++
          markReady()
          return {
            loadSubset: (options) => {
              loads.push({ session, options })
              return true
            },
            unloadSubset: (options) => unloads.push({ session, options }),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where: oldWhere })

    await collection.cleanup()
    subscription.requestSnapshot({ where: newWhere })
    collection.startSyncImmediate()
    await flushPromises()

    expect(loads.map(({ session }) => session)).toEqual([0, 1, 1])
    expect(loads.slice(1).map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])

    subscription.unsubscribe()
    expect(unloads.map(({ session }) => session)).toEqual([1, 1])
    expect(unloads.map(({ options }) => options.where)).toEqual([
      oldWhere,
      newWhere,
    ])
    await collection.cleanup()
  })

  it(`does not retry cleanup debt through a replacement adapter session`, async () => {
    const where = new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])
    let syncSession = 0
    const unloadSessions: Array<number> = []
    const releaseFailure = new Error(`old session release failed`)
    const collection = createCollection<{ id: string }>({
      id: `cleanup-debt-session`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const session = syncSession++
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {
              unloadSessions.push(session)
              if (session === 0) throw releaseFailure
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot({ where })
    expect(() => subscription.releaseSnapshot(where)).toThrow(releaseFailure)

    await collection.cleanup()
    collection.startSyncImmediate()
    await flushPromises()
    subscription.unsubscribe()

    expect(unloadSessions).toEqual([0])
    await collection.cleanup()
  })

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
      const loads: Array<{ session: number; demand: DemandName }> = []
      const unloads: Array<{ session: number; demand: DemandName }> = []
      const errors: Array<unknown> = []
      let session = -1
      let ranReentry = false
      let subscription!: ReturnType<
        ReturnType<typeof createCollection<{ id: string }>>[`subscribeChanges`]
      >

      const collection = createCollection<{ id: string }>({
        id: `restart-${outcome}-${reentry}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: ({ markReady }) => {
            session++
            markReady()
            return {
              loadSubset: (options) => {
                const demand = demandForWhere.get(options.where)
                if (!demand) throw new Error(`unknown restart demand`)
                loads.push({ session, demand })
                if (session === 0 || demand === `peer`) return true
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
                unloads.push({ session, demand })
              },
            }
          },
        },
      })
      subscription = collection.subscribeChanges(() => {}, {
        includeInitialState: false,
      })
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot({ where: targetWhere })
      subscription.requestSnapshot({ where: peerWhere })

      await collection.cleanup()
      collection.startSyncImmediate()
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
        { session: 0, demand: `target` },
        { session: 0, demand: `peer` },
        { session: 1, demand: `target` },
        ...(peerStarts ? [{ session: 1, demand: `peer` as const }] : []),
      ])
      expect(errors).toEqual(
        (outcome === `throw` || outcome === `reject`) && targetSurvives
          ? [failure]
          : [],
      )

      if (reentry !== `unsubscribe`) subscription.unsubscribe()
      expect(unloads).toEqual([
        ...(targetEstablished && !targetSurvives
          ? [{ session: 1, demand: `target` as const }]
          : []),
        ...(targetEstablished && targetSurvives
          ? [{ session: 1, demand: `target` as const }]
          : []),
        ...(peerStarts ? [{ session: 1, demand: `peer` as const }] : []),
      ])
      await collection.cleanup()
    },
  )

  it.each(threeGenerationScenarios)(
    `fences three generations for $obsoleteOutcome/$currentOutcome settled $settlementOrder`,
    async ({ obsoleteOutcome, currentOutcome, settlementOrder }) => {
      type Row = { id: string; version: number }
      const obsolete = createDeferred<void>()
      const current = createDeferred<void>()
      void obsolete.promise.catch(() => {})
      void current.promise.catch(() => {})
      const obsoleteFailure = new Error(`obsolete generation failed`)
      const currentFailure = new Error(`current generation failed`)
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const unloadSessions: Array<number> = []
      let session = -1

      const collection = createCollection<Row>({
        id: `three-generation-${obsoleteOutcome}-${currentOutcome}-${settlementOrder}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            session++
            const ownSession = session
            operations.markReady()
            return {
              loadSubset: (options) => {
                if (ownSession === 0) {
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: { id: `row`, version: 1 },
                  })
                  operations.commit(options.signal)
                  return true
                }
                const gate = ownSession === 1 ? obsolete : current
                const outcome =
                  ownSession === 1 ? obsoleteOutcome : currentOutcome
                const failure =
                  ownSession === 1 ? obsoleteFailure : currentFailure
                return gate.promise.then(() => {
                  if (outcome === `reject`) throw failure
                  operations.begin()
                  operations.write({
                    type: `insert`,
                    value: { id: `row`, version: ownSession + 1 },
                  })
                  return operations.commit(options.signal)
                })
              },
              unloadSubset: () => unloadSessions.push(ownSession),
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.requestSnapshot()
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])

      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      await collection.cleanup()
      collection.startSyncImmediate()
      await flushPromises()
      expect(subscription.status).toBe(`loadingSubset`)

      const settleObsolete = () =>
        obsoleteOutcome === `resolve`
          ? obsolete.resolve()
          : obsolete.reject(obsoleteFailure)
      const settleCurrent = () =>
        currentOutcome === `resolve`
          ? current.resolve()
          : current.reject(currentFailure)
      if (settlementOrder === `obsolete-first`) {
        settleObsolete()
        await flushPromises()
        expect(subscription.status).toBe(`loadingSubset`)
        settleCurrent()
      } else {
        settleCurrent()
        await flushPromises()
        settleObsolete()
      }
      await flushPromises()

      expect([...visible.values()]).toEqual([
        currentOutcome === `resolve`
          ? { id: `row`, version: 3 }
          : { id: `row`, version: 1 },
      ])
      expect(errors).toEqual(
        currentOutcome === `reject` ? [currentFailure] : [],
      )
      expect(subscription.lastError).toBe(
        currentOutcome === `reject` ? currentFailure : undefined,
      )
      expect(subscription.status).toBe(`ready`)

      subscription.unsubscribe()
      expect(unloadSessions).toEqual([2])
      await collection.cleanup()
    },
  )

  it(`treats an externally aborted replay as failed without publishing partial rows`, async () => {
    type Row = { id: string; value: string }
    const abort = new AbortController()
    const replay = createDeferred<void>()
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const visible = new Map<string | number, Row>()
    const collection = createCollection<Row>({
      id: `externally-aborted-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          write = operations.write
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => {
              loadCount++
              begin()
              write({
                type: `insert`,
                value: {
                  id: `row`,
                  value: loadCount === 1 ? `old` : `partial`,
                },
              })
              commit()
              return loadCount === 1 ? true : replay.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key)
          else {
            visible.set(change.key, {
              id: change.value.id,
              value: change.value.value,
            })
          }
        }
      },
      { includeInitialState: false },
    )

    subscription.requestSnapshot({ signal: abort.signal })
    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    begin()
    truncate()
    commit()
    await flushPromises()
    abort.abort()
    replay.reject(new DOMException(`aborted`, `AbortError`))
    await flushPromises()

    expect([...visible.values()]).toEqual([{ id: `row`, value: `old` }])
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it(`enters loading status when a truncate queues replay work`, async () => {
    const replay = createDeferred<void>()
    let begin!: () => void
    let commit!: () => void
    let truncate!: () => void
    let loadCount = 0
    const collection = createCollection<{ id: string }>({
      id: `queued-replay-status`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          begin = operations.begin
          commit = operations.commit
          truncate = operations.truncate
          operations.markReady()
          return {
            loadSubset: () => (++loadCount === 1 ? true : replay.promise),
            unloadSubset: () => {},
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    subscription.requestSnapshot()

    begin()
    truncate()
    commit()

    expect(loadCount).toBe(1)
    expect(subscription.status).toBe(`loadingSubset`)

    await flushPromises()
    expect(loadCount).toBe(2)
    replay.resolve()
    await flushPromises()
    expect(subscription.status).toBe(`ready`)

    subscription.unsubscribe()
    await collection.cleanup()
  })

  it.each(startOutcomes)(
    `retires replay setup when its adapter cleans up before %s`,
    async (outcome) => {
      type Row = { id: string; version: number }
      const pending = createDeferred<void>()
      void pending.promise.catch(() => {})
      const failure = new Error(`obsolete replay failed`)
      let begin!: () => void
      let write!: (message: { type: `insert`; value: Row }) => void
      let commit!: () => void
      let truncate!: () => void
      let loadCount = 0
      const visible = new Map<string | number, Row>()
      const errors: Array<unknown> = []
      const statuses: Array<string> = []

      const collection = createCollection<Row>({
        id: `reentrant-cleanup-${outcome}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        sync: {
          sync: (operations) => {
            begin = operations.begin
            write = operations.write
            commit = operations.commit
            truncate = operations.truncate
            operations.markReady()
            return {
              loadSubset: () => {
                loadCount++
                begin()
                write({
                  type: `insert`,
                  value: { id: `row`, version: loadCount },
                })
                commit()
                if (loadCount === 1) return true
                void collection.cleanup()
                if (outcome === `throw`) throw failure
                if (outcome === `return`) return true
                return pending.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const subscription = collection.subscribeChanges(
        (changes) => {
          for (const change of changes) {
            if (change.type === `delete`) visible.delete(change.key)
            else {
              visible.set(change.key, {
                id: change.value.id,
                version: change.value.version,
              })
            }
          }
        },
        { includeInitialState: false },
      )
      subscription.on(`loadSubset:error`, ({ error }) => errors.push(error))
      subscription.on(`status:change`, ({ status }) => statuses.push(status))
      subscription.requestSnapshot()

      begin()
      truncate()
      commit()
      await flushPromises()
      if (outcome === `resolve`) pending.resolve()
      if (outcome === `reject`) pending.reject(failure)
      await flushPromises()

      expect(collection.status).toBe(`cleaned-up`)
      expect([...visible.values()]).toEqual([{ id: `row`, version: 1 }])
      expect(errors).toEqual([])
      expect(subscription.lastError).toBeUndefined()
      expect(subscription.status).toBe(`ready`)
      expect(statuses.at(-1)).not.toBe(`loadingSubset`)

      subscription.unsubscribe()
      await collection.cleanup()
    },
  )

  const { multiplier, ...replay } = readOracleRunConfig()

  fcTest.prop([lifecycleHistoryArbitrary], {
    numRuns: 80 * multiplier,
    seed: 1_657_001,
  })(`matches the demand lifecycle model for a fixed seed`, runLifecycleHistory)

  fcTest.prop(
    [lifecycleHistoryArbitrary],
    oracleRandomParameters(
      80 * multiplier,
      replay,
      `subscription-lifecycle.history`,
    ),
  )(
    `matches the demand lifecycle model for a random or replayed seed`,
    runLifecycleHistory,
  )
})
