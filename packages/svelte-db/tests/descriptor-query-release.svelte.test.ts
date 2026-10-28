/**
 * # A Svelte query releases independent descriptor sources
 *
 * A failed source start must not prevent a later source of the same query from
 * starting. A query that the hook rejects must release every sync start its
 * preparation deferred: the source then follows its own start policy, and a
 * later direct reader can start it.
 *
 * The model has independent source start counts. In the first history, the
 * first start throws after the Svelte effect asks for rows; the second count
 * must still become one and the failed effect must release its subscription.
 * The release grammar crosses six causes for a client-backed
 * query (a descriptor factory that throws during preparation, a query without
 * a stable IR identity, a query the live query rejects when it compiles, a
 * setup that throws after the hook returns (with the default gcTime, or with
 * gcTime 0, which disables the reclaim), and a different source object
 * under a Collection ID the mounted hook already read), two source start policies, and three direct
 * readers (`preload()`, `startSyncImmediate()`, and another hook). After the
 * rejection, an eager (`startSync: true`) source has started once and a lazy
 * source has not started; after the reader, each has started exactly once
 * and is ready. This revises the earlier promise that a failed preparation
 * "may leave a source deferred" until `preload()`: under that law
 * `startSyncImmediate()` and another hook could never start the source.
 *
 * A rejection in a mounted hook must not serve the previous query: after the
 * collision, each public field read separately throws. The checkpoints are
 * the public hook error, each result field, and the source Collection's start
 * count and status. A neighboring remount consumes an independent healthy
 * query after the failed effect is retired. A synchronous unhandled effect
 * error does not rerun that same Svelte effect when its query changes;
 * recovery in place is not promised. Asynchronous source failures remain
 * outside this model.
 *
 * Declared reach: each enumerated release history asserts that the rejected
 * query ran the shared descriptor's factory once before the reader. A history
 * that rejects before it binds the shared source therefore fails.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DbClient,
  Query,
  SourceCollectionIdReuseError,
  UnhashableQueryIRError,
  UnsupportedRootScalarSelectError,
  collectionOptions,
  createCollection,
  eq,
} from '@tanstack/db'
import { flushSync } from 'svelte'
import { useLiveQuery } from '../src/useLiveQuery.svelte.js'

type Row = { id: string }

describe(`Svelte descriptor source release`, () => {
  it(`a fresh effect can observe a healthy query after a failed source start`, async () => {
    const failure = new Error(`failed query source`)
    let failedStarts = 0
    let healthyStarts = 0
    const failed = collectionOptions(`svelte-reactive-failed`, () => ({
      id: `svelte-reactive-failed`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          failedStarts++
          throw failure
        },
      },
    }))
    const healthy = collectionOptions(`svelte-reactive-healthy`, () => ({
      id: `svelte-reactive-healthy`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          healthyStarts++
          begin()
          write({ type: `insert`, value: { id: `healthy` } })
          commit()
          markReady()
        },
      },
    }))
    const failedQuery = new Query().from({ row: failed })
    const healthyQuery = new Query().from({ row: healthy })
    const client = new DbClient()
    let read!: () => Array<Row>
    let dispose: (() => void) | undefined
    let disposeHealthy: (() => void) | undefined

    try {
      dispose = $effect.root(() => {
        useLiveQuery({ client, query: failedQuery })
      })
      expect(() => flushSync()).toThrow(failure)
      expect(failedStarts).toBe(1)
      expect(healthyStarts).toBe(0)

      dispose()
      dispose = undefined
      disposeHealthy = $effect.root(() => {
        const result = useLiveQuery({ client, query: healthyQuery })
        read = () => result.data as Array<Row>
      })
      flushSync()
      expect(healthyStarts).toBe(1)
      expect(read().map((row) => row.id)).toEqual([`healthy`])
    } finally {
      dispose?.()
      disposeHealthy?.()
      await client.cleanup()
    }
  })

  it(`releases the second union source after the first start throws`, async () => {
    const failure = new Error(`first source failed`)
    let firstStarts = 0
    let secondStarts = 0
    const first = collectionOptions(`svelte-release-first`, () => ({
      id: `svelte-release-first`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: () => {
          firstStarts++
          throw failure
        },
      },
    }))
    const second = collectionOptions(`svelte-release-second`, () => ({
      id: `svelte-release-second`,
      getKey: (row: Row) => row.id,
      startSync: true,
      sync: {
        sync: ({ markReady }) => {
          secondStarts++
          markReady()
        },
      },
    }))
    const query = new Query().unionAll(
      new Query().from({ first }).select(({ first: row }) => ({ id: row.id })),
      new Query()
        .from({ second })
        .select(({ second: row }) => ({ id: row.id })),
    )
    const client = new DbClient()
    let dispose: (() => void) | undefined
    let querySubscriberCount: (() => number) | undefined
    let cleanupQuery: (() => Promise<void>) | undefined

    try {
      dispose = $effect.root(() => {
        const result = useLiveQuery({ client, query })
        querySubscriberCount = () => result.collection.subscriberCount
        cleanupQuery = () => result.collection.cleanup()
      })
      expect(firstStarts).toBe(0)
      expect(secondStarts).toBe(0)
      expect(() => flushSync()).toThrow(failure)
      expect(firstStarts).toBe(1)
      expect(secondStarts).toBe(1)
      expect(querySubscriberCount?.()).toBe(0)
      const healthy = client.collection(second)
      await healthy.preload()
      expect(healthy.status).toBe(`ready`)
    } finally {
      dispose?.()
      await cleanupQuery?.()
      await client.cleanup()
    }
  })

  type Policy = `eager` | `lazy`
  type Reader = `preload()` | `startSyncImmediate()` | `another hook`

  // Each cause mounts a client-backed hook and rejects it; `step` drives a
  // rejection that needs an earlier, accepted query.
  const causes: Record<
    string,
    (
      shared: any,
      client: DbClient,
    ) => {
      run: () => () => void
      /** The hook never rejected; its deferral waits for the reclaim. */
      releasedOnReclaim?: boolean
    }
  > = {
    'a descriptor factory that throws during preparation': (shared, client) => {
      const failing = collectionOptions(`${shared.id}-failing`, () => {
        throw new Error(`descriptor factory failed`)
      })
      const query = new Query().unionAll(
        new Query()
          .from({ shared })
          .select(({ shared: row }: any) => ({ id: row.id })),
        new Query()
          .from({ failing })
          .select(({ failing: row }: any) => ({ id: row.id })),
      )
      return {
        run: () => {
          let dispose: (() => void) | undefined
          expect(() => {
            dispose = $effect.root(() => {
              useLiveQuery({ client, query })
            })
          }).toThrow(`descriptor factory failed`)
          return () => dispose?.()
        },
      }
    },
    'a query without a stable IR identity': (shared, client) => ({
      run: () => {
        let dispose: (() => void) | undefined
        expect(() => {
          dispose = $effect.root(() => {
            useLiveQuery({
              client,
              query: new Query().from({ shared }).fn.where(() => true),
            })
          })
        }).toThrow(UnhashableQueryIRError)
        return () => dispose?.()
      },
    }),
    'a query the live query rejects when it compiles': (shared, client) => ({
      run: () => {
        let dispose: (() => void) | undefined
        expect(() => {
          dispose = $effect.root(() => {
            useLiveQuery({
              client,
              // A root scalar select is valid IR that compilation refuses.
              query: new Query()
                .from({ shared })
                .select(({ shared: row }: any) => row.id),
            })
          })
        }).toThrow(UnsupportedRootScalarSelectError)
        return () => dispose?.()
      },
    }),
    'a setup that throws after the hook returns': (shared, client) => ({
      run: () => {
        let dispose: (() => void) | undefined
        // The hook rejected nothing; later setup code failed, so the
        // subscribing effect never runs.
        expect(() => {
          dispose = $effect.root(() => {
            useLiveQuery({ client, query: new Query().from({ shared }) })
            throw new Error(`setup failed`)
          })
        }).toThrow(`setup failed`)
        return () => dispose?.()
      },
      releasedOnReclaim: true,
    }),
    // gcTime 0 disables GC, so the live query is never reclaimed; the setup
    // must still release its deferral.
    'a setup that throws after a hook whose live query keeps no GC': (
      shared,
      client,
    ) => ({
      run: () => {
        let dispose: (() => void) | undefined
        expect(() => {
          dispose = $effect.root(() => {
            useLiveQuery({
              client,
              query: new Query().from({ shared }),
              gcTime: 0,
            })
            throw new Error(`setup failed`)
          })
        }).toThrow(`setup failed`)
        return () => dispose?.()
      },
      releasedOnReclaim: true,
    }),
    'a reused source Collection ID': (shared, client) => ({
      run: () => {
        const first = createCollection<Row>({
          id: `${shared.id}-settings`,
          getKey: (row) => row.id,
          sync: { sync: ({ markReady }) => markReady() },
        })
        const replacement = createCollection<Row>({
          id: first.id,
          getKey: (row) => row.id,
          sync: { sync: ({ markReady }) => markReady() },
        })
        let step = $state({ current: first, join: false })
        let result!: ReturnType<typeof useLiveQuery>
        const dispose = $effect.root(() => {
          // A getter re-reads `step`; the public types omit this config form.
          result = useLiveQuery((() => ({
            client,
            query: step.join
              ? new Query()
                  .from({ settings: step.current })
                  .join({ shared }, ({ settings, shared: row }: any) =>
                    eq(settings.id, row.id),
                  )
              : new Query().from({ settings: step.current }),
          })) as any)
        })
        flushSync()
        step = { current: replacement, join: true }
        expect(() => flushSync()).toThrow(SourceCollectionIdReuseError)
        // Each public field, read on its own, rejects instead of serving the
        // previous query's rows or state.
        const fields = Object.keys(result) as Array<keyof typeof result>
        expect(fields.length).toBeGreaterThanOrEqual(12)
        for (const field of fields) {
          expect(() => result[field], field).toThrow(
            SourceCollectionIdReuseError,
          )
        }
        return dispose
      },
    }),
  }

  const readers: Record<Reader, (source: any) => Promise<void>> = {
    'preload()': (source) => source.preload(),
    'startSyncImmediate()': async (source) => {
      source.startSyncImmediate()
      await Promise.resolve()
    },
    'another hook': async (source) => {
      const dispose = $effect.root(() => {
        useLiveQuery(source)
      })
      flushSync()
      await Promise.resolve()
      dispose()
    },
  }

  let sequence = 0
  for (const [causeName, makeCause] of Object.entries(causes)) {
    for (const policy of [
      `eager`,
      `lazy`,
    ] as const satisfies ReadonlyArray<Policy>) {
      for (const [readerName, read] of Object.entries(readers)) {
        it(`after ${causeName}, a ${policy} source follows its policy and ${readerName} starts it`, async () => {
          const id = `svelte-release-${sequence++}`
          let starts = 0
          let materialized = 0
          const shared = collectionOptions(
            id,
            () => (
              materialized++,
              {
                id,
                getKey: (row: Row) => row.id,
                startSync: policy === `eager`,
                sync: {
                  sync: ({ markReady }) => {
                    starts++
                    markReady()
                  },
                },
              }
            ),
          )
          const client = new DbClient()
          let dispose: (() => void) | undefined
          try {
            const cause = makeCause(shared, client)
            dispose = cause.run()
            // Declared reach: the rejected query materialized the shared
            // descriptor, so it held a deferral the law must release.
            expect(materialized).toBe(1)
            // A rejection releases at once, so an eager source starts now. A
            // setup that never subscribes releases at the reclaim, which the
            // real GC timer may reach before or after this point.
            if (cause.releasedOnReclaim) {
              expect(starts).toBeLessThanOrEqual(1)
            } else {
              expect(starts).toBe(policy === `eager` ? 1 : 0)
            }
            const direct = client.collection(shared)
            await read(direct)
            // A rejection has released already, so the reader starts the
            // source now; a setup that never subscribes releases at the
            // reclaim, which may follow the reader's demand.
            if (cause.releasedOnReclaim) {
              await vi.waitFor(() => expect(direct.status).toBe(`ready`))
            } else {
              expect(direct.status).toBe(`ready`)
            }
            expect(starts).toBe(1)
          } finally {
            dispose?.()
            await client.cleanup()
          }
        })
      }
    }
  }
})
