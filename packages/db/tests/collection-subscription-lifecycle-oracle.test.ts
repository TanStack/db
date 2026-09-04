import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { flushPromises } from './utils.js'
import type { LoadSubsetOptions } from '../src/types.js'

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
})
