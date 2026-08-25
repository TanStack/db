import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DeduplicatedLoadSubset } from '../src/query/subset-dedupe.js'
import { SubsetDemandController } from '../src/query/live/subset-demand-controller.js'
import { BasicIndex } from '../src/indexes/basic-index.js'
import { createLiveQueryCollection } from '../src/query/index.js'
import { LIVE_QUERY_INTERNAL } from '../src/query/live/internal.js'
import { createLiveQueryWindowController } from '../src/live-query-window-controller.js'
import { Func, PropRef, Value } from '../src/query/ir.js'
import { getLoadSubsetDemandKey } from '../src/query/ir-stable-identity.js'
import { recordLoadSubsetPromiseDemandMatcher } from '../src/query/load-subset-outcome.js'
import type { LazyDemandPlan } from '../src/query/compiler/joins.js'
import type { LoadSubsetFn, LoadSubsetOptions } from '../src/types.js'

describe(`loadSubset outcomes`, () => {
  it(`publishes exact applied coverage through the collection sync boundary`, async () => {
    const unloadError = new Error(`unload failed`)
    let unloadShouldFail = true
    const unloadSubset = vi.fn(() => {
      if (unloadShouldFail) throw unloadError
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-coverage-registry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              begin()
              write({ type: `insert`, value: { id: `a` } })
              write({ type: `insert`, value: { id: `b` } })
              const applied = commit()
              if (applied !== true) await applied
              return {
                hasMore: true,
                appliedRowKeys: [`a`, `b`],
              }
            },
            unloadSubset,
          }
        },
      },
    })

    try {
      const options = { limit: 2 }
      await collection._sync.loadSubset(options)

      expect(Array.from(collection.keys()).sort()).toEqual([`a`, `b`])
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([
        {
          collectionId: collection.id,
          demand: { limit: 2 },
          extent: `continues`,
          rowKeys: [`a`, `b`],
        },
      ])

      expect(() => collection._sync.unloadSubset(options)).toThrow(unloadError)
      expect(collection._sync.getLoadSubsetCoverage()).toHaveLength(1)

      unloadShouldFail = false
      collection._sync.unloadSubset(options)
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
      expect(Array.from(collection.keys())).toEqual([])
      expect(unloadSubset).toHaveBeenCalledTimes(2)
    } finally {
      await collection.cleanup()
    }
  })

  it(`retries post-commit row cleanup without applying the delete twice`, async () => {
    const unloadSubset = vi.fn()
    const collection = createCollection<{ id: string }>({
      id: `load-subset-coverage-gc-retry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              begin()
              write({ type: `insert`, value: { id: `a` } })
              const applied = commit()
              if (applied !== true) await applied
              return { hasMore: false, appliedRowKeys: [`a`] }
            },
            unloadSubset,
          }
        },
      },
    })

    try {
      const options = { limit: 1 }
      await collection._sync.loadSubset(options)
      const deleteSyncedRows = collection._state.deleteSyncedRows.bind(
        collection._state,
      )
      const cleanupError = new Error(`cleanup observer failed`)
      const cleanup = vi
        .spyOn(collection._state, `deleteSyncedRows`)
        .mockImplementationOnce((keys) => {
          expect(deleteSyncedRows(keys)).toBe(true)
          throw cleanupError
        })

      expect(() => collection._sync.unloadSubset(options)).toThrow(cleanupError)
      expect(Array.from(collection.keys())).toEqual([])
      expect(cleanup).toHaveBeenCalledOnce()

      collection._sync.unloadSubset(options)
      expect(Array.from(collection.keys())).toEqual([])
      expect(cleanup).toHaveBeenCalledTimes(2)
      expect(unloadSubset).toHaveBeenCalledTimes(2)
    } finally {
      await collection.cleanup()
    }
  })

  it.each([`first`, `second`] as const)(
    `keeps one physical exact-peer acquisition until the %s lease releases last`,
    async (lastLease) => {
      let resolveLoad!: (result: {
        hasMore: false
        appliedRowKeys: ReadonlyArray<string>
      }) => void
      const sharedLoad = new Promise<{
        hasMore: false
        appliedRowKeys: ReadonlyArray<string>
      }>((resolve) => {
        resolveLoad = resolve
      })
      let wrote = false
      const collection = createCollection<{ id: string }>({
        id: `load-subset-exact-peer-${lastLease}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            const deduplicated = new DeduplicatedLoadSubset({
              loadSubset: async () => {
                const result = await sharedLoad
                if (!wrote) {
                  wrote = true
                  begin()
                  write({ type: `insert`, value: { id: `a` } })
                  const applied = commit()
                  if (applied !== true) await applied
                }
                return result
              },
            })
            return {
              loadSubset: deduplicated.loadSubset,
              unloadSubset: vi.fn(),
            }
          },
        },
      })

      try {
        const first = { limit: 1 }
        const second = { limit: 1 }
        const firstLoad = collection._sync.loadSubset(first)
        const secondLoad = collection._sync.loadSubset(second)
        resolveLoad({ hasMore: false, appliedRowKeys: [`a`] })
        if (firstLoad !== true) await firstLoad
        if (secondLoad !== true) await secondLoad

        const firstRelease = lastLease === `first` ? second : first
        const finalRelease = lastLease === `first` ? first : second
        collection._sync.unloadSubset(firstRelease)
        expect(collection._sync.getLoadSubsetCoverage()).toHaveLength(1)
        expect(Array.from(collection.keys())).toEqual([`a`])

        collection._sync.unloadSubset(finalRelease)
        expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
        expect(Array.from(collection.keys())).toEqual([])
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each([`wide`, `narrow`] as const)(
    `keeps one physical promise acquisition across different demands when the %s lease releases first`,
    async (firstRelease) => {
      let resolveLoad!: (result: {
        hasMore: false
        appliedRowKeys: ReadonlyArray<string>
      }) => void
      const physicalPromise = new Promise<{
        hasMore: false
        appliedRowKeys: ReadonlyArray<string>
      }>((resolve) => {
        resolveLoad = resolve
      })
      let installed = false
      const collection = createCollection<{ id: string }>({
        id: `load-subset-different-demand-peer-${firstRelease}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                if (!installed) {
                  installed = true
                  begin()
                  write({ type: `insert`, value: { id: `shared` } })
                  commit()
                }
                return physicalPromise
              },
              unloadSubset: vi.fn(),
            }
          },
        },
      })

      try {
        const owners = {
          wide: { limit: 10 },
          narrow: { limit: 5 },
        }
        const wide = collection._sync.loadSubset(owners.wide)
        const narrow = collection._sync.loadSubset(owners.narrow)
        resolveLoad({ hasMore: false, appliedRowKeys: [`shared`] })
        if (wide !== true) await wide
        if (narrow !== true) await narrow

        const finalRelease = firstRelease === `wide` ? `narrow` : `wide`
        collection._sync.unloadSubset(owners[firstRelease])
        expect(Array.from(collection.keys())).toEqual([`shared`])

        collection._sync.unloadSubset(owners[finalRelease])
        expect(Array.from(collection.keys())).toEqual([])
      } finally {
        resolveLoad({ hasMore: false, appliedRowKeys: [`shared`] })
        await collection.cleanup()
      }
    },
  )

  it(`keeps physical row ownership when its exact caller releases before settlement`, async () => {
    let resolveLoad!: (result: {
      hasMore: false
      appliedRowKeys: ReadonlyArray<string>
    }) => void
    const physicalPromise = new Promise<{
      hasMore: false
      appliedRowKeys: ReadonlyArray<string>
    }>((resolve) => {
      resolveLoad = resolve
    })
    const wideDemand = { limit: 10 }
    recordLoadSubsetPromiseDemandMatcher(
      physicalPromise,
      (candidate) => candidate.limit === wideDemand.limit,
    )
    let installed = false
    const collection = createCollection<{ id: string }>({
      id: `load-subset-released-physical-publisher`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              if (!installed) {
                installed = true
                begin()
                write({ type: `insert`, value: { id: `shared` } })
                commit()
              }
              return physicalPromise
            },
            unloadSubset: vi.fn(),
          }
        },
      },
    })

    try {
      const narrowDemand = { limit: 5 }
      const wide = collection._sync.loadSubset(wideDemand)
      const narrow = collection._sync.loadSubset(narrowDemand)
      collection._sync.unloadSubset(wideDemand)

      resolveLoad({ hasMore: false, appliedRowKeys: [`shared`] })
      if (wide !== true) await wide
      if (narrow !== true) await narrow
      expect(Array.from(collection.keys())).toEqual([`shared`])

      collection._sync.unloadSubset(narrowDemand)
      expect(Array.from(collection.keys())).toEqual([])
    } finally {
      resolveLoad({ hasMore: false, appliedRowKeys: [`shared`] })
      await collection.cleanup()
    }
  })

  it.each([`loaded`, `satisfied`] as const)(
    `retains exact applied ownership through synchronous true reuse when the %s lease releases first`,
    async (firstRelease) => {
      let loadCount = 0
      const collection = createCollection<{ id: string }>({
        id: `load-subset-true-reuse-${firstRelease}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loadCount++
                if (loadCount > 1) return true
                begin()
                write({ type: `insert`, value: { id: `shared` } })
                commit()
                return Promise.resolve({
                  hasMore: false,
                  appliedRowKeys: [`shared`],
                })
              },
              unloadSubset: vi.fn(),
            }
          },
        },
      })

      try {
        const owners = {
          loaded: { limit: 1 },
          satisfied: { limit: 1 },
        }
        await collection._sync.loadSubset(owners.loaded)
        expect(collection._sync.loadSubset(owners.satisfied)).toBe(true)

        const finalRelease = firstRelease === `loaded` ? `satisfied` : `loaded`
        collection._sync.unloadSubset(owners[firstRelease])
        expect(Array.from(collection.keys())).toEqual([`shared`])
        expect(collection._sync.getLoadSubsetOutcome({ limit: 1 })).toEqual(
          expect.objectContaining({
            extent: `exhausted`,
            appliedRowKeys: [`shared`],
          }),
        )

        collection._sync.unloadSubset(owners[finalRelease])
        expect(Array.from(collection.keys())).toEqual([])
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`keeps prior applied coverage when a newer exact attempt fails`, async () => {
    type PendingLoad = {
      succeed: (rowId: string) => Promise<void>
      reject: (error: Error) => void
    }
    const pending: Array<PendingLoad> = []
    const collection = createCollection<{ id: string }>({
      id: `load-subset-failed-exact-retry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: () =>
              new Promise((resolve, reject) => {
                pending.push({
                  succeed: async (rowId) => {
                    begin()
                    write({ type: `insert`, value: { id: rowId } })
                    const applied = commit()
                    if (applied !== true) await applied
                    resolve({
                      hasMore: false,
                      appliedRowKeys: [rowId],
                    })
                  },
                  reject,
                })
              }),
            unloadSubset: vi.fn(),
          }
        },
      },
    })

    try {
      const firstOptions = { limit: 1 }
      const retryOptions = { limit: 1 }
      const first = collection._sync.loadSubset(firstOptions)
      const retry = collection._sync.loadSubset(retryOptions)
      if (first === true || retry === true) {
        throw new Error(`Expected asynchronous loads`)
      }
      void retry.catch(() => undefined)

      await pending[0]!.succeed(`first`)
      await first
      expect(collection._sync.getLoadSubsetCoverage()).toHaveLength(1)

      pending[1]!.reject(new Error(`retry failed`))
      await expect(retry).rejects.toThrow(`retry failed`)
      expect(collection._sync.getLoadSubsetCoverage()).toMatchObject([
        { rowKeys: [`first`] },
      ])
    } finally {
      await collection.cleanup()
    }
  })

  it(`owns applied rows even when source extent is unknown`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-unknown-row-provenance`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              begin()
              write({ type: `insert`, value: { id: `a` } })
              const applied = commit()
              if (applied !== true) await applied
              return { hasMore: undefined, appliedRowKeys: [`a`] }
            },
            unloadSubset: vi.fn(),
          }
        },
      },
    })

    try {
      const options = { limit: 1 }
      await collection._sync.loadSubset(options)
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
      expect(Array.from(collection.keys())).toEqual([`a`])

      collection._sync.unloadSubset(options)
      expect(Array.from(collection.keys())).toEqual([])
    } finally {
      await collection.cleanup()
    }
  })

  it.each([
    [`narrow`, `wide`],
    [`wide`, `narrow`],
  ] as const)(
    `garbage-collects overlapping acquisition rows only after the %s owner releases last`,
    async (firstRelease, finalRelease) => {
      const collection = createCollection<{ id: string }>({
        id: `load-subset-overlapping-row-owners-${firstRelease}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                begin()
                write({ type: `insert`, value: { id: `shared` } })
                if (options.limit === 2) {
                  write({ type: `insert`, value: { id: `wide-only` } })
                }
                const applied = commit()
                if (applied !== true) await applied
                return {
                  hasMore: false,
                  appliedRowKeys:
                    options.limit === 2 ? [`shared`, `wide-only`] : [`shared`],
                }
              },
              unloadSubset: vi.fn(),
            }
          },
        },
      })

      try {
        const owners = {
          narrow: { limit: 1 },
          wide: { limit: 2 },
        }
        await collection._sync.loadSubset(owners.narrow)
        await collection._sync.loadSubset(owners.wide)
        expect(Array.from(collection.keys()).sort()).toEqual([
          `shared`,
          `wide-only`,
        ])

        collection._sync.unloadSubset(owners[firstRelease])
        expect(collection.has(`shared`)).toBe(true)
        expect(collection.has(`wide-only`)).toBe(finalRelease === `wide`)

        collection._sync.unloadSubset(owners[finalRelease])
        expect(Array.from(collection.keys())).toEqual([])
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`validates demand identity before starting adapter work`, async () => {
    const loadSubset = vi.fn(() => Promise.resolve({ hasMore: false }))
    const unloadSubset = vi.fn()
    const collection = createCollection<{ id: string }>({
      id: `load-subset-invalid-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset, unloadSubset }
        },
      },
    })

    try {
      expect(() =>
        collection._sync.loadSubset({
          where: new Func(`eq`, [
            new PropRef([`item`, `value`]),
            new Value(() => `unhashable`),
          ]),
        }),
      ).toThrow(/not stably hashable/)
      expect(loadSubset).not.toHaveBeenCalled()
      expect(unloadSubset).not.toHaveBeenCalled()
    } finally {
      await collection.cleanup()
    }
  })

  it(`snapshots nested ordering options across load and coverage reads`, async () => {
    let resolveLoad!: (value: {
      hasMore: false
      appliedRowKeys: ReadonlyArray<string>
    }) => void
    const pending = new Promise<{
      hasMore: false
      appliedRowKeys: ReadonlyArray<string>
    }>((resolve) => {
      resolveLoad = resolve
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-nested-demand-snapshot`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async () => {
              const result = await pending
              begin()
              write({ type: `insert`, value: { id: `a` } })
              const applied = commit()
              if (applied !== true) await applied
              return result
            },
          }
        },
      },
    })

    try {
      const localeOptions = { numeric: true }
      const options = {
        limit: 1,
        orderBy: [
          {
            expression: new PropRef([`item`, `name`]),
            compareOptions: {
              direction: `asc` as const,
              nulls: `first` as const,
              stringSort: `locale` as const,
              locale: `en`,
              localeOptions,
            },
          },
        ],
      }
      const load = collection._sync.loadSubset(options)
      localeOptions.numeric = false
      resolveLoad({ hasMore: false, appliedRowKeys: [`a`] })
      if (load !== true) await load

      const fact = collection._sync.getLoadSubsetCoverage()[0]!
      expect(
        (
          fact.demand.orderBy![0]!.compareOptions as {
            localeOptions: { numeric: boolean }
          }
        ).localeOptions.numeric,
      ).toBe(true)
      ;(
        fact.demand.orderBy![0]!.compareOptions as {
          localeOptions: { numeric: boolean }
        }
      ).localeOptions.numeric = false
      expect(
        (
          collection._sync.getLoadSubsetCoverage()[0]!.demand.orderBy![0]!
            .compareOptions as { localeOptions: { numeric: boolean } }
        ).localeOptions.numeric,
      ).toBe(true)
    } finally {
      await collection.cleanup()
    }
  })

  it(`does not publish a continuing prefix without applied rows`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-rowless-coverage`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () =>
              Promise.resolve({ hasMore: true, appliedRowKeys: [] }),
          }
        },
      },
    })

    try {
      await collection._sync.loadSubset({ limit: 2 })
      expect(collection._sync.getLoadSubsetCoverage()).toEqual([])
    } finally {
      await collection.cleanup()
    }
  })

  it.each([
    [{ hasMore: true }, `continues`],
    [{ hasMore: false }, `exhausted`],
    [{ hasMore: undefined }, `unknown`],
    [undefined, `unknown`],
  ] as const)(
    `normalizes an applied %o result to %s for its exact demand`,
    async (sourceResult, extent) => {
      const hasMore =
        sourceResult && `hasMore` in sourceResult
          ? sourceResult.hasMore
          : undefined
      const resultKind =
        sourceResult === undefined ? `omitted` : String(hasMore)
      const collection = createCollection<{ id: string }>({
        id: `load-subset-outcome-${extent}-${resultKind}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => Promise.resolve(sourceResult),
            }
          },
        },
      })

      try {
        const options = { limit: 1 }
        const result = collection._sync.loadSubset(options)

        expect(result).toBeInstanceOf(Promise)
        await expect(result).resolves.toEqual({
          collectionId: collection.id,
          demand: options,
          generation: 1,
          extent,
        })
      } finally {
        await collection.cleanup()
      }
    },
  )

  it(`preserves the adapter result through request deduplication`, async () => {
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => Promise.resolve({ hasMore: false }),
    })

    const result = deduplicated.loadSubset({ limit: 2 })

    expect(result).toBeInstanceOf(Promise)
    await expect(result).resolves.toEqual({ hasMore: false })
  })

  it(`does not leak a covering acquisition's extent into a narrower demand`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-covering-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: deduplicated.loadSubset }
        },
      },
    })

    try {
      const covering = collection._sync.loadSubset({ limit: 10 })
      const exactPeer = collection._sync.loadSubset({ limit: 10 })
      const narrower = collection._sync.loadSubset({ limit: 5 })

      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(exactPeer).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves physical-request provenance through an async adapter wrapper`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const wrappedLoadSubset: LoadSubsetFn = async (options) => {
      const result = deduplicated.loadSubset(options)
      return result === true ? undefined : await result
    }
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-async-wrapper`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: wrappedLoadSubset }
        },
      },
    })

    try {
      const covering = collection._sync.loadSubset({ limit: 10 })
      await Promise.resolve()
      const narrower = collection._sync.loadSubset({ limit: 5 })

      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`keeps copied async-wrapper results conservative for narrower demands`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const wrappedLoadSubset: LoadSubsetFn = async (options) => {
      const result = deduplicated.loadSubset(options)
      if (result === true) return undefined
      const sourceResult = await result
      return sourceResult === undefined
        ? undefined
        : { hasMore: sourceResult.hasMore }
    }
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-copied-async-wrapper`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: wrappedLoadSubset }
        },
      },
    })

    try {
      const covering = collection._sync.loadSubset({ limit: 10 })
      await Promise.resolve()
      const narrower = collection._sync.loadSubset({ limit: 5 })

      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      resolveLoad({ hasMore: false })
      await collection.cleanup()
    }
  })

  it(`scopes source extent to a narrowed physical acquisition`, async () => {
    const adapterCalls: Array<LoadSubsetOptions> = []
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: (options) => {
        adapterCalls.push(options)
        return Promise.resolve({ hasMore: false })
      },
    })
    const wrappedLoadSubset: LoadSubsetFn = async (options) => {
      const result = deduplicated.loadSubset(options)
      if (result === true) return undefined
      const sourceResult = await result
      return sourceResult === undefined
        ? undefined
        : { hasMore: sourceResult.hasMore }
    }
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-narrowed-acquisition`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: wrappedLoadSubset }
        },
      },
    })

    try {
      await collection._sync.loadSubset({
        where: new Func<boolean>(`eq`, [
          new PropRef([`id`]),
          new Value(`already-loaded`),
        ]),
      })
      const outcome = collection._sync.loadSubset({})

      expect(adapterCalls).toHaveLength(2)
      expect(adapterCalls[1]?.where).toBeDefined()
      await expect(outcome).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`assigns a fresh generation to each logical demand`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-generations`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: () => Promise.resolve() }
        },
      },
    })

    try {
      const first = collection._sync.loadSubset({ limit: 1 })
      const second = collection._sync.loadSubset({ limit: 2 })

      expect(first).toBeInstanceOf(Promise)
      expect(second).toBeInstanceOf(Promise)
      await expect(first).resolves.toMatchObject({ generation: 1 })
      await expect(second).resolves.toMatchObject({ generation: 2 })
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves the outcome when a request waits for deferred sync start`, async () => {
    let loadedLimit: number | undefined
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-deferred-start`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              loadedLimit = options.limit
              return Promise.resolve({ hasMore: false })
            },
          }
        },
      },
    })

    try {
      expect(collection._deferSyncStart()).toBe(true)
      const options = { limit: 3 }
      const result = collection._sync.loadSubset(options)
      expect(result).toBeInstanceOf(Promise)
      options.limit = 30

      collection._resumeSyncStart()

      expect(loadedLimit).toBe(3)
      await expect(result).resolves.toEqual({
        collectionId: collection.id,
        demand: { limit: 3 },
        generation: 1,
        extent: `exhausted`,
      })
    } finally {
      await collection.cleanup()
    }
  })

  it.each([
    [`immediate`, false],
    [`deferred`, true],
  ] as const)(
    `deep-snapshots mutable %s demand before async settlement`,
    async (mode, deferredStart) => {
      let resolveLoad!: (result: { hasMore: boolean }) => void
      const load = new Promise<{ hasMore: boolean }>((resolve) => {
        resolveLoad = resolve
      })
      const collection = createCollection<{ id: string }>({
        id: `load-subset-outcome-mutable-demand-${mode}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: !deferredStart,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return { loadSubset: () => load }
          },
        },
      })
      const localeOptions: Intl.CollatorOptions = { sensitivity: `base` }
      const orderingValue: [number, Array<number>] = [1, [2]]
      const options: LoadSubsetOptions = {
        orderBy: [
          {
            expression: new Value(orderingValue),
            compareOptions: {
              direction: `asc`,
              nulls: `first`,
              stringSort: `locale`,
              localeOptions,
            },
          },
        ],
      }

      try {
        if (deferredStart) expect(collection._deferSyncStart()).toBe(true)
        const demandKey = getLoadSubsetDemandKey(options)
        const result = collection._sync.loadSubset(options)

        localeOptions.sensitivity = `variant`
        orderingValue[1].push(3)
        if (deferredStart) collection._resumeSyncStart()
        resolveLoad({ hasMore: false })

        expect(result).toBeInstanceOf(Promise)
        if (!(result instanceof Promise)) {
          throw new Error(`Expected asynchronous subset load`)
        }
        const outcome = await result
        const retainedOrder = outcome.demand.orderBy?.[0]
        expect(
          retainedOrder?.compareOptions.stringSort === `locale`
            ? retainedOrder.compareOptions.localeOptions
            : undefined,
        ).toEqual({ sensitivity: `base` })
        expect((retainedOrder?.expression as Value).value).toEqual([1, [2]])
        expect(getLoadSubsetDemandKey(outcome.demand)).toBe(demandKey)
      } finally {
        resolveLoad({ hasMore: false })
        await collection.cleanup()
      }
    },
  )

  it(`keeps deferred covering-source extent scoped to its exact demand`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-deferred-covering-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: false,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return { loadSubset: deduplicated.loadSubset }
        },
      },
    })

    try {
      expect(collection._deferSyncStart()).toBe(true)
      const covering = collection._sync.loadSubset({ limit: 10 })
      const narrower = collection._sync.loadSubset({ limit: 5 })

      collection._resumeSyncStart()
      resolveLoad({ hasMore: false })

      await expect(covering).resolves.toMatchObject({ extent: `exhausted` })
      await expect(narrower).resolves.toMatchObject({ extent: `unknown` })
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves outcomes through lazy demand aggregation`, async () => {
    type Row = { id: string; groupId: number }
    const collection = createCollection<Row>({
      id: `load-subset-outcome-lazy-demand`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => Promise.resolve({ hasMore: true }),
          }
        },
      },
    })
    collection.createIndex((row) => row.groupId)
    const subscription = collection.subscribeChanges(() => {}, {
      includeInitialState: false,
    })
    const controller = new SubsetDemandController()
    const plan: LazyDemandPlan = {
      id: `lazy-demand-outcome`,
      path: [`groupId`],
      collectionId: collection.id,
      initialKeys: new Set(),
    }

    try {
      const update = controller.setDemand(subscription, plan, new Set([1]))
      expect(update.ready).toBeInstanceOf(Promise)
      if (!(update.ready instanceof Promise)) {
        throw new Error(`Expected asynchronous lazy demand`)
      }
      await expect(update.ready).resolves.toEqual([
        expect.objectContaining({ generation: 1, extent: `continues` }),
      ])
    } finally {
      controller.clear()
      subscription.unsubscribe()
      await collection.cleanup()
    }
  })

  it(`retains source-scoped outcomes at the live-query window boundary`, async () => {
    type Row = { id: number; rank: number }
    let nextId = 1
    let loadCount = 0
    let skipPhysicalLoad = false
    const source = createCollection<Row>({
      id: `load-subset-outcome-live-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              if (skipPhysicalLoad) return true
              loadCount++
              const id = nextId++
              return (async () => {
                begin()
                write({
                  type: `insert`,
                  value: { id, rank: id },
                })
                const applied = commit()
                if (applied !== true) await applied
                return { hasMore: false, appliedRowKeys: [id] }
              })()
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, `asc`)
          .limit(1),
      startSync: true,
    })
    const controller = createLiveQueryWindowController(live, { pageSize: 2 })

    try {
      await live.preload()
      const internal = live.utils[LIVE_QUERY_INTERNAL]
      expect(internal.getLatestSubsetOutcomes()).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          sourceId: expect.any(String),
          extent: `exhausted`,
        }),
      ])

      await controller.preload()
      expect(internal.getLastWindowOutcomes()).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          sourceId: expect.any(String),
          extent: `exhausted`,
        }),
      ])
      expect(
        controller[LIVE_QUERY_INTERNAL].getLatestAppliedOutcomes(),
      ).toEqual(internal.getLastWindowOutcomes())

      const callsBeforeNoop = loadCount
      const retainedOutcomes = internal.getLastWindowOutcomes()
      skipPhysicalLoad = true
      const noOp = live.utils.setWindow({ offset: 0, limit: 3 })
      if (noOp !== true) await noOp
      expect(loadCount).toBe(callsBeforeNoop)
      expect(internal.getLastWindowOutcomes()).toEqual(retainedOutcomes)
      expect(retainedOutcomes).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          sourceId: expect.any(String),
          extent: `exhausted`,
          appliedRowKeys: expect.any(Array),
        }),
      ])
    } finally {
      controller.dispose()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it(`does not repopulate outcomes after cleanup from a shared late load`, async () => {
    let resolveLoad!: (result: { hasMore: boolean }) => void
    const load = new Promise<{ hasMore: boolean }>((resolve) => {
      resolveLoad = resolve
    })
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => load,
    })
    const source = createCollection<{ id: string }>({
      id: `load-subset-outcome-cleanup-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: deduplicated.loadSubset,
            unloadSubset: () => {},
          }
        },
      },
    })
    const createLive = (id: string) =>
      createLiveQueryCollection({
        id,
        query: (q) => q.from({ row: source }),
        startSync: true,
      })
    const first = createLive(`load-subset-outcome-cleanup-first`)
    const second = createLive(`load-subset-outcome-cleanup-second`)
    const firstInternal = first.utils[LIVE_QUERY_INTERNAL]
    const firstPreload = first.preload().catch(() => undefined)
    const secondPreload = second.preload()

    try {
      await Promise.resolve()
      await first.cleanup()
      expect(firstInternal.getLatestSubsetOutcomes()).toEqual([])

      resolveLoad({ hasMore: false })
      await Promise.all([firstPreload, secondPreload])
      await Promise.resolve()

      expect(firstInternal.getLatestSubsetOutcomes()).toEqual([])
      expect(
        second.utils[LIVE_QUERY_INTERNAL].getLatestSubsetOutcomes(),
      ).toEqual([
        expect.objectContaining({
          collectionId: source.id,
          extent: `exhausted`,
        }),
      ])
    } finally {
      resolveLoad({ hasMore: false })
      await Promise.all([second.cleanup(), source.cleanup()])
    }
  })

  it(`does not repopulate partial window outcomes after cleanup`, async () => {
    const source = createCollection<{ id: number }>({
      id: `load-subset-outcome-window-cleanup-source`,
      getKey: (row) => row.id,
      autoIndex: `eager`,
      defaultIndexType: BasicIndex,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const live = createLiveQueryCollection({
      id: `load-subset-outcome-window-cleanup-live`,
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.id, `asc`)
          .limit(1),
      startSync: true,
    })
    const internal = live.utils[LIVE_QUERY_INTERNAL]
    const builder = internal.getBuilder()
    const left = Promise.resolve({
      collectionId: `left-collection`,
      demand: { limit: 1 },
      generation: 1,
      extent: `continues` as const,
    })
    let resolveRight!: () => void
    const right = new Promise<void>((resolve) => {
      resolveRight = resolve
    })

    try {
      await live.preload()
      Reflect.set(builder, `windowFn`, () => {
        builder.trackSubsetLoadOperationPromise(left, `left`)
        builder.trackSubsetLoadOperationPromise(right, `right`)
      })

      const windowReady = live.utils.setWindow({ offset: 0, limit: 2 })
      expect(windowReady).toBeInstanceOf(Promise)
      await Promise.resolve()
      await Promise.resolve()

      await live.cleanup()
      await windowReady

      expect(internal.getLastWindowOutcomes()).toEqual([])
    } finally {
      resolveRight()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it(`retains same-generation outcomes from every source in one operation`, async () => {
    const collection = createCollection<{ id: string }>({
      id: `load-subset-outcome-operation-sources`,
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const operation = collection._sync.beginLoadSubsetOperation()
    const left = Promise.resolve({
      collectionId: `left-collection`,
      sourceId: `left`,
      demand: { limit: 1 },
      generation: 1,
      extent: `continues` as const,
    })
    const right = Promise.resolve({
      collectionId: `right-collection`,
      sourceId: `right`,
      demand: { limit: 1 },
      generation: 1,
      extent: `exhausted` as const,
    })

    collection._sync.trackLoadSubsetOperationPromise(left)
    collection._sync.trackLoadSubsetOperationPromise(right)

    try {
      await operation.wait()
      expect(operation.getOutcomes()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            sourceId: `left`,
            generation: 1,
            extent: `continues`,
          }),
          expect.objectContaining({
            sourceId: `right`,
            generation: 1,
            extent: `exhausted`,
          }),
        ]),
      )
      expect(operation.getOutcomes()).toHaveLength(2)
    } finally {
      await collection.cleanup()
    }
  })
})
