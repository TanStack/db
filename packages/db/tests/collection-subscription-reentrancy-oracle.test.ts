import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createDeferred } from '../src/deferred.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { reentrantSnapshotHistories } from './collection-subscription-lifecycle-grammar.js'
import type { LoadSubsetOptions, SyncConfig } from '../src/types.js'

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

const where = () => new Func(`eq`, [new PropRef([`id`]), new Value(`row`)])

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
          if (action === `release`)
            subscription.releaseSnapshot(requestedWhere)
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

        expect(reentries).toBe(1)
        expect(resultHooks).toBe(phase === `loadSubset` ? 0 : 1)
        expect(accepted).toBe(false)
        expect(publications).toEqual([])
        expect(loads).toHaveLength(1)
        expect(unloads).toEqual(loads)
        expect(reads).toHaveBeenCalledTimes(
          phase === `loadSubset` ||
            phase === `onLoadSubsetResult` ||
            phase === `statusLoadingSubset`
            ? 0
            : 1,
        )
      } finally {
        transport.resolve()
        reads.mockRestore()
        subscription.unsubscribe()
        await collection.cleanup()
      }
    },
  )

  it(`releases a request by its predicate when the subscription adds a predicate`, async () => {
    const requestedWhere = where()
    const subscriptionWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`row`),
    ])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const collection = createCollection<{ id: string }>({
      id: `combined-predicate-release`,
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
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      whereExpression: subscriptionWhere,
    })

    try {
      subscription.requestSnapshot({ where: requestedWhere })
      expect(loads).toHaveLength(1)
      expect(loads[0]?.where).not.toBe(requestedWhere)
      subscription.releaseSnapshot(requestedWhere)
      expect(unloads).toEqual(loads)
      expect(loads[0]?.signal?.aborted).toBe(true)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retires a combined-predicate request when its loader releases the original predicate`, async () => {
    const requestedWhere = where()
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    const publications: Array<ReadonlyArray<string>> = []
    let resultHooks = 0
    const collection = createCollection<{ id: string }>({
      id: `combined-predicate-loader-release`,
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
              subscription.releaseSnapshot(requestedWhere)
              return true
            },
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(
      (changes) => publications.push(changes.map(({ value }) => value.id)),
      { includeInitialState: false, whereExpression: where() },
    )

    try {
      const accepted = subscription.requestSnapshot({
        where: requestedWhere,
        onLoadSubsetResult: () => resultHooks++,
      })
      expect(loads).toHaveLength(1)
      expect(loads[0]?.where).not.toBe(requestedWhere)
      expect(unloads).toEqual(loads)
      expect(loads[0]?.signal?.aborted).toBe(true)
      expect(resultHooks).toBe(0)
      expect(accepted).toBe(false)
      expect(publications).toEqual([])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`removes the request abort listener after acquisition release`, async () => {
    const requestedWhere = where()
    const request = new AbortController()
    const additions = vi.spyOn(request.signal, `addEventListener`)
    const removals = vi.spyOn(request.signal, `removeEventListener`)
    const collection = createCollection<{ id: string }>({
      id: `released-abort-forwarding`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({
        where: requestedWhere,
        signal: request.signal,
      })
      subscription.releaseSnapshot(requestedWhere)
      const forwarded = additions.mock.calls.filter(
        ([type]) => type === `abort`,
      )
      expect(forwarded).toHaveLength(1)
      expect(removals.mock.calls).toContainEqual([`abort`, forwarded[0]?.[1]])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
      additions.mockRestore()
      removals.mockRestore()
    }
  })

  it(`does not start delegated replay after status reentry retires its only demand`, async () => {
    const requestedWhere = where()
    const delegate: Array<`start` | `succeed`> = []
    let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
    const collection = createCollection<{ id: string }>({
      id: `reentrant-replay-status-release`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (next) => {
          operations = next
          next.markReady()
          return { loadSubset: () => true }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
      truncateReplayPublication: {
        start: () => delegate.push(`start`),
        succeed: () => delegate.push(`succeed`),
      },
    })

    try {
      subscription.requestSnapshot({ where: requestedWhere })
      subscription.on(`status:loadingSubset`, () => {
        subscription.releaseSnapshot(requestedWhere)
      })
      operations.begin()
      operations.truncate()
      operations.commit()
      expect(delegate).toEqual([`succeed`])
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps an acquisition until the current replay setup reaches it`, async () => {
    const requestedWhere = where()
    const unloads: Array<LoadSubsetOptions> = []
    let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
    const collection = createCollection<{ id: string }>({
      id: `obsolete-replay-setup`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (next) => {
          operations = next
          next.markReady()
          return {
            loadSubset: () => true,
            unloadSubset: (options) => unloads.push(options),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ where: requestedWhere })
      operations.begin()
      operations.truncate()
      operations.commit()
      const beforeCurrentSetup = new Promise<number>((resolve) => {
        queueMicrotask(() => resolve(unloads.length))
      })
      operations.begin()
      operations.truncate()
      operations.commit()
      expect(await beforeCurrentSetup).toBe(0)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`stops an obsolete replay setup when its loader starts a newer replay`, async () => {
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])
    const loads: Array<LoadSubsetOptions> = []
    const unloads: Array<LoadSubsetOptions> = []
    let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
    let startedNestedReplay = false
    const collection = createCollection<{ id: string }>({
      id: `loader-starts-new-replay`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (next) => {
          operations = next
          next.markReady()
          return {
            loadSubset: (options) => {
              loads.push(options)
              if (loads.length === 3) {
                startedNestedReplay = true
                operations.begin()
                operations.truncate()
                operations.commit()
              }
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

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      expect(loads.map(({ where: predicate }) => predicate)).toEqual([
        firstWhere,
        secondWhere,
      ])
      operations.begin()
      operations.truncate()
      operations.commit()
      const beforeNestedSetup = new Promise<number>((resolve) => {
        queueMicrotask(() =>
          resolve(
            unloads.filter(({ where: predicate }) => predicate === secondWhere)
              .length,
          ),
        )
      })
      expect(await beforeNestedSetup).toBe(0)
      expect(startedNestedReplay).toBe(true)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`keeps detached demand loading when an obsolete acquisition settles before restart setup`, async () => {
    const requestedWhere = where()
    const oldLoad = createDeferred<void>()
    const newLoad = createDeferred<void>()
    let syncRuns = 0
    const collection = createCollection<{ id: string }>({
      id: `obsolete-settlement-before-restart-setup`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ markReady }) => {
          const run = syncRuns++
          markReady()
          return {
            loadSubset: () => (run === 0 ? oldLoad.promise : newLoad.promise),
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ where: requestedWhere })
      expect(subscription.status).toBe(`loadingSubset`)
      await collection.cleanup()
      oldLoad.resolve()
      const beforeSetup = new Promise<string>((resolve) => {
        queueMicrotask(() => resolve(subscription.status))
      })
      collection.startSyncImmediate()
      expect(await beforeSetup).toBe(`loadingSubset`)
    } finally {
      oldLoad.resolve()
      newLoad.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not retain a released replay rejection while a peer remains pending`, async () => {
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])
    const released = createDeferred<void>()
    const peer = createDeferred<void>()
    const failure = new Error(`released acquisition failed`)
    let loads = 0
    let operations!: Parameters<SyncConfig<{ id: string }>[`sync`]>[0]
    const collection = createCollection<{ id: string }>({
      id: `released-replay-rejection-retention`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (next) => {
          operations = next
          next.markReady()
          return {
            loadSubset: () => {
              loads++
              if (loads <= 2) return true
              return loads === 3 ? released.promise : peer.promise
            },
          }
        },
      },
    })
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      operations.begin()
      operations.truncate()
      operations.commit()
      await Promise.resolve()
      expect(loads).toBe(4)
      subscription.releaseSnapshot(firstWhere)
      released.reject(failure)
      await Promise.resolve()
      await Promise.resolve()

      // Only the retention boundary needs a white-box observation. The
      // public failure and publication checks live in the replay oracle.
      const replayState = subscription as unknown as {
        truncateReplayState?: { failures: Map<unknown, Error> }
      }
      expect([...replayState.truncateReplayState!.failures.values()]).toEqual(
        [],
      )
      expect(subscription.lastError).toBeUndefined()
      expect(subscription.status).toBe(`loadingSubset`)
    } finally {
      released.resolve()
      peer.resolve()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`does not publish when adapter cleanup invalidates a starting acquisition`, async () => {
    const requestedWhere = where()
    const publications: Array<ReadonlyArray<string>> = []
    const unloads: Array<LoadSubsetOptions> = []
    let cleanup: Promise<void> | undefined
    let enteredLoader = false
    const collection = createCollection<{ id: string }>({
      id: `cleanup-during-starting-acquisition`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          operations.begin()
          operations.write({ type: `insert`, value: { id: `row` } })
          operations.commit()
          operations.markReady()
          return {
            loadSubset: () => {
              enteredLoader = true
              cleanup = collection.cleanup()
              return true
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

    try {
      const accepted = subscription.requestSnapshot({ where: requestedWhere })
      expect(enteredLoader).toBe(true)
      expect(accepted).toBe(false)
      expect(publications).toEqual([])
      expect(unloads).toEqual([])
      await cleanup
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      subscription.unsubscribe()
      await cleanup
    }
  })

  it(`does not acquire detached demand after cleanup reenters its restart status`, async () => {
    const firstWhere = new Func(`eq`, [new PropRef([`id`]), new Value(`first`)])
    const secondWhere = new Func(`eq`, [
      new PropRef([`id`]),
      new Value(`second`),
    ])
    let loads = 0
    let cleanup: Promise<void> | undefined
    const collection = createCollection<{ id: string }>({
      id: `cleanup-during-detached-restart`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
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
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })

    try {
      subscription.requestSnapshot({ where: firstWhere })
      subscription.requestSnapshot({ where: secondWhere })
      expect(loads).toBe(2)
      await collection.cleanup()
      collection.startSyncImmediate()
      subscription.on(`status:loadingSubset`, () => {
        cleanup = collection.cleanup()
      })
      subscription.releaseSnapshot(firstWhere)
      expect(subscription.status).toBe(`ready`)
      await Promise.resolve()
      expect(cleanup).toBeDefined()
      await cleanup
      expect(loads).toBe(2)
      expect(collection.status).toBe(`cleaned-up`)
    } finally {
      subscription.unsubscribe()
      await cleanup
      await collection.cleanup()
    }
  })
})
