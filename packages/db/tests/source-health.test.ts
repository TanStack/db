/**
 * Ordinary fixed scenarios for source failure and the health tree. Each test
 * runs one written history and compares production with values written in the
 * test, so no declared check or model reaches it. The law, its model, and its
 * generated histories are owned by source-health-oracle.test.ts. These fixed
 * tests have no oracle owner (tracked in TanStack/db#2264).
 */
import { describe, expect, it } from 'vitest'
import { createCollection, findProblems } from '../src/collection/index.js'
import { createLiveQueryCollection } from '../src/query/live-query-collection.js'
import { createEffect } from '../src/query/effect.js'
import { createPooledLiveQuery } from '../src/query/pooled-live-query.js'
import { Query } from '../src/query/builder/index.js'
import { eq, isUndefined, not } from '../src/query/builder/functions.js'
import { include } from '../src/query/builder/include-functions.js'
import { CollectionReloadDuringSyncEntryError } from '../src/errors.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { createDeferred } from '../src/deferred.js'
import { captureMicrotaskErrors, flushPromises } from './utils.js'
import { createSource } from './source-health-support.js'
import type {
  CollectionStatus,
  HealthNode,
  LoadSubsetOptions,
} from '../src/types.js'
import type { PooledView, Row, SyncParams } from './source-health-support.js'

// ---------------------------------------------------------------------------
// Request lane
// ---------------------------------------------------------------------------

/**
 * A live query's lazy source loads only the keys its rows reach, and an
 * on-demand root source loads the window the query shows. After the query's
 * initial-query readiness, a load that fails is a request error on the query's own node:
 * the source stays healthy and the query keeps its status. A lazy demand's
 * error clears when the same demand later settles, or when the query stops
 * needing it; a root source's error clears when a later load of that source
 * settles. Before initial-query readiness, the same failure fails the query's sync run.
 */
// ---------------------------------------------------------------------------
// Reload invariant witness
// ---------------------------------------------------------------------------

// A reload retires its sync run, and the retired run's `commit()` can no
// longer reach a transaction it left open. That transaction has no public
// observation (its writes never apply), so this witness checks the
// invariant directly: after the reload no transaction stays open, and the
// new run's own commit decides the row.
// ---------------------------------------------------------------------------
// Problem values
// ---------------------------------------------------------------------------

/**
 * `fail()`, `reportError()`, and a crash accept any value as the problem. The
 * law: the value never changes what the call does. Status, node, and a
 * reload's promise follow the same rules as for an `Error`, and the node's
 * problem keeps the value as its `cause`. A value that cannot describe
 * itself (no prototype, a throwing getter) shows the generic message. The
 * lane crosses each call site with each kind of value.
 */
describe(`problem values`, () => {
  const values: Record<string, () => unknown> = {
    error: () => new Error(`gave up`),
    string: () => `gave up`,
    'no prototype': () => Object.create(null),
    'throwing getter': () => ({
      get code() {
        throw new Error(`getter`)
      },
      toString() {
        throw new Error(`toString`)
      },
    }),
  }
  const sites = [
    `fail before ready`,
    `fail after ready`,
    `fail during a reload`,
    `reportError`,
    `crash`,
  ] as const
  const cases = sites.flatMap((site) =>
    Object.keys(values).map((value) => ({ site, value })),
  )
  it.each(cases)(`%j`, async ({ site, value }) => {
    let params!: SyncParams
    const collection = createCollection<Row, number>({
      id: `health-problem-value-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
        },
      },
    })
    const problem = values[value]!()
    void collection.preload().catch(() => undefined)
    await flushPromises()
    let reload: Promise<void> | undefined
    if (site !== `fail before ready`) {
      params.markReady()
      if (site === `fail during a reload`) {
        reload = collection.reload()
        void reload.catch(() => undefined)
      }
    }
    if (site === `reportError`) params.reportError(problem)
    else if (site === `crash`) collection._lifecycle.crash(problem)
    else params.fail(problem)
    await flushPromises()
    const shown =
      site === `fail before ready` || site === `crash`
        ? collection.health.error
        : site === `reportError`
          ? collection.health.failureReason
          : collection.health.error
    expect(collection.status).toBe(
      site === `fail before ready`
        ? `error`
        : site === `crash`
          ? `crashed`
          : `ready`,
    )
    expect(shown?.cause, `the node keeps the value`).toBe(problem)
    expect(typeof shown?.message).toBe(`string`)
    // One call is one failure in the problem's frame, and it is the one the
    // problem shows. JSON keeps every failure's facts and leaves out causes.
    expect(shown?.errors.length, `one failure listed`).toBe(1)
    expect(shown?.errors[0]?.cause, `the listed failure's value`).toBe(problem)
    const facts = JSON.parse(JSON.stringify(shown!.errors[0]))
    expect(facts, `JSON leaves out the cause`).not.toHaveProperty(`cause`)
    expect(JSON.parse(JSON.stringify(shown))).toEqual({
      ...facts,
      errors: [facts],
    })
    if (reload)
      await expect(reload, `a failed reload settles`).rejects.toBe(problem)
    await collection.cleanup()
  })
})

describe(`reload invariant`, () => {
  // A query's reload() settles with the query: after its failed source
  // recovers, the query reloads itself, and the reload waits for that run to
  // be ready (or to fail).
  it(`settles a query reload with the query's restarted run`, async () => {
    let runs = 0
    const loads: Array<ReturnType<typeof createDeferred<void>>> = []
    const parents = createCollection<Row, number>({
      id: `health-query-reload-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          if (runs++ === 0) {
            params.fail(new Error(`first load failed`))
            return
          }
          params.begin()
          params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          params.commit()
          params.markReady()
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-query-reload-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              const load = createDeferred<void>()
              loads.push(load)
              return load.promise
            },
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.parentId),
        ),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload().catch(() => undefined)
      expect(query.status).toBe(`error`)
      let settled = false
      const reload = query.reload().finally(() => {
        settled = true
      })
      await flushPromises()
      // The query's own reload waits for its join load: it keeps `error` and
      // shows `reloading`, and the reload waits too.
      expect(query.status).toBe(`error`)
      expect(query.health.reloading).toBe(true)
      expect(settled, `reload settled before the query's run was ready`).toBe(
        false,
      )
      for (const load of loads) load.resolve()
      await reload
      expect(query.status).toBe(`ready`)
    } finally {
      console.error = consoleError
      for (const load of loads) load.resolve()
      await query.cleanup()
      await parents.cleanup()
      await children.cleanup()
    }
  })

  // A throwing sync function is a programming error in any run. During a
  // reload of a failed first load the status still shows `error`, but this
  // run did not fail, so the throw crashes the Collection.
  it(`crashes when a reload's sync function throws after a failed first load`, async () => {
    let runs = 0
    const collection = createCollection<Row, number>({
      id: `health-reload-throw-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          if (runs++ === 0) params.fail(new Error(`first load failed`))
          else throw new Error(`sync threw`)
        },
      },
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await collection.preload().catch(() => undefined)
      expect(collection.status).toBe(`error`)
      await expect(collection.reload()).rejects.toThrow(`sync threw`)
      expect(collection.status).toBe(`crashed`)
      expect(collection.health.reloading).toBe(false)
    } finally {
      console.error = consoleError
      await collection.cleanup()
    }
  })

  // A snapshot replaces every synced row, so inside it the baseline an
  // adapter diffs against is empty. An adapter that writes only rows missing
  // from the baseline, as Query Collections do, then rebuilds every row, and
  // the rows the snapshot does not write go.
  it(`gives a diffing adapter an empty baseline inside a reload's snapshot`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const writeMissing = (rows: Array<Row>, snapshot: boolean) => {
      const params = source.params
      params.begin(snapshot ? { snapshot } : undefined)
      const baseline = new Map(params.collection._state.acceptedSyncedEntries())
      for (const row of rows)
        if (!baseline.has(row.id)) params.write({ type: `insert`, value: row })
      params.commit()
      params.markReady()
    }
    writeMissing(
      [
        { id: 1, parentId: 1 },
        { id: 2, parentId: 2 },
      ],
      false,
    )
    const reload = source.collection.reload()
    writeMissing([{ id: 1, parentId: 1 }], true)
    await reload
    expect([...source.collection.keys()]).toEqual([1])
    await source.collection.cleanup()
  })

  // Cleanup start closes restart admission (ARCHITECTURE law 14), and a
  // reload starts a sync run. While adapter cleanup is pending, a reload
  // rejects as a start would, and no sync run starts under the cleanup.
  it(`rejects a reload while adapter cleanup is pending`, async () => {
    let runs = 0
    const adapterCleanup = createDeferred<void>()
    const collection = createCollection<Row, number>({
      id: `health-reload-during-cleanup-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          runs++
          params.markReady()
          return () => adapterCleanup.promise
        },
      },
    })
    await collection.preload()
    const cleaned = collection.cleanup()
    await expect(collection.reload()).rejects.toThrow(/during cleanup/)
    expect(runs).toBe(1)
    adapterCleanup.resolve()
    await cleaned
    expect(collection.status).toBe(`cleaned-up`)
    expect(runs).toBe(1)
  })

  // Cleanup start drops the discarded run's problems while the status waits
  // for adapter cleanup. Every change to the tree is announced, so the drop
  // is too: the last health:change before the status change shows no
  // problem. The cause of a `crashed` or `error` status stays while that
  // status shows.
  it.each([`report`, `fail`, `crash`, `first-load-error`] as const)(
    `announces the problems that cleanup start drops: %s`,
    async (problem) => {
      const adapterCleanup = createDeferred<void>()
      let params!: SyncParams
      const collection = createCollection<Row, number>({
        id: `health-cleanup-drop-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (next) => {
            params = next
            if (problem === `first-load-error`)
              next.fail(new Error(`first load failed`))
            else next.markReady()
            return () => adapterCleanup.promise
          },
        },
      })
      await collection.preload().catch(() => undefined)
      if (problem === `report`) params.reportError(new Error(`stalled`))
      else if (problem === `fail`) params.fail(new Error(`stopped`))
      else if (problem === `crash`)
        collection._lifecycle.crash(new Error(`crashed`))
      const announced: Array<HealthNode> = []
      collection.on(`health:change`, () => announced.push(collection.health))
      const cleaned = collection.cleanup()
      // A status's own cause stays while that status shows.
      const keepsCause = problem === `crash` || problem === `first-load-error`
      expect(collection.status).toBe(
        problem === `crash`
          ? `crashed`
          : problem === `first-load-error`
            ? `error`
            : `ready`,
      )
      if (keepsCause) {
        expect(collection.health.error?.message).toBe(
          problem === `crash` ? `crashed` : `first load failed`,
        )
        expect(announced).toEqual([])
      } else {
        expect(collection.health.hasErrors).toBe(false)
        expect(announced.at(-1)?.hasErrors).toBe(false)
      }
      adapterCleanup.resolve()
      await cleaned
      expect(collection.status).toBe(`cleaned-up`)
      expect(collection.health.hasErrors).toBe(false)
    },
  )

  // A ready callback that throws reaches the adapter's markReady() when the
  // adapter calls it after sync() returns. Inside sync() it reaches no caller,
  // so core reports it uncaught (maintainer decision). The reload itself
  // succeeded once the status is ready, so it resolves either way.
  it.each([`sync`, `async`] as const)(
    `settles a reload whose ready callback throws: %s markReady`,
    async (timing) => {
      let runs = 0
      const collection = createCollection<Row, number>({
        id: `health-reload-ready-throw-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (params) => {
            if (runs++ === 0) {
              params.fail(new Error(`first load failed`))
              return
            }
            if (timing === `sync`) params.markReady()
            else
              setTimeout(() => {
                expect(() => params.markReady()).toThrow(`callback threw`)
              }, 0)
          },
        },
      })
      await collection.preload().catch(() => undefined)
      const failure = new Error(`callback threw`)
      collection.onFirstReady(() => {
        throw failure
      })
      const uncaught = captureMicrotaskErrors()
      const settled = await Promise.race([
        collection.reload().then(
          () => `resolved`,
          () => `rejected`,
        ),
        new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
      ])
      uncaught.restore()
      expect(uncaught.errors).toEqual(timing === `sync` ? [failure] : [])
      expect(settled).toBe(`resolved`)
      expect(collection.status).toBe(`ready`)
      expect(collection.health.reloading).toBe(false)
      await collection.cleanup()
    },
  )

  // A live query that never started has no run yet. Its reload starts it,
  // as any Collection's reload starts an idle one, after it reloads a source
  // whose first load failed.
  it.each([`ready`, `failed`] as const)(
    `starts a never-started live query on reload: source %s`,
    async (sourceState) => {
      let runs = 0
      const source = createCollection<Row, number>({
        id: `health-idle-query-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        startSync: true,
        sync: {
          sync: (params) => {
            if (runs++ === 0 && sourceState === `failed`) {
              params.fail(new Error(`first load failed`))
              return
            }
            params.begin()
            params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            params.commit()
            params.markReady()
          },
        },
      })
      await source.preload().catch(() => undefined)
      const query = createLiveQueryCollection({
        query: (q) => q.from({ row: source }),
        startSync: false,
      })
      expect(query.status).toBe(`idle`)
      try {
        await query.reload()
        expect(query.status).toBe(`ready`)
        expect(query.size).toBe(1)
        expect(source.status).toBe(`ready`)
      } finally {
        await query.cleanup()
        await source.cleanup()
      }
    },
  )

  // A reload whose new run fails keeps the rows, so they stay the baseline
  // that a diffing adapter, such as query-db, reads for its next write.
  // A transaction the new run opened before it failed is no longer the
  // reload's replacement: when it commits, its writes apply on the kept rows.
  it.each([`no open transaction`, `an open transaction`] as const)(
    `keeps the rows as the baseline after the reload's new run fails with %s`,
    async (open) => {
      const source = createSource(`A`)
      source.collection.startSyncImmediate()
      source.params.begin()
      source.params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
      source.params.commit()
      source.params.markReady()
      const reload = source.collection.reload().catch(() => undefined)
      if (open === `an open transaction`) {
        source.params.begin()
        source.params.write({ type: `insert`, value: { id: 2, parentId: 2 } })
      }
      source.params.fail(new Error(`reload failed`))
      await reload
      const baseline = [
        ...source.params.collection._state.acceptedSyncedEntries(),
      ]
      expect(baseline.map(([key]) => key)).toEqual(
        open === `an open transaction` ? [1, 2] : [1],
      )
      expect([...source.collection.keys()]).toEqual([1])
      if (open === `an open transaction`) {
        await source.params.commit()
        expect([...source.collection.keys()].sort()).toEqual([1, 2])
      }
      expect(source.collection.status).toBe(`ready`)
      expect(source.collection.health.error?.message).toBe(`reload failed`)
      await source.collection.cleanup()
    },
  )

  // A canceled commit never happened, and the reload's other writes apply on
  // the kept rows: without a snapshot, the reload ends at markReady() with
  // every row it kept.
  it(`keeps the rows through a canceled reload commit without a snapshot`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const first = source.params
    first.begin()
    first.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    first.commit()
    first.markReady()
    const reload = source.collection.reload()
    const next = source.params
    const canceled = new AbortController()
    canceled.abort()
    next.begin()
    next.write({ type: `insert`, value: { id: 3, parentId: 3 } })
    try {
      next.commit(canceled.signal)
    } catch {
      // A canceled commit may throw its abort reason.
    }
    // The run continues at once, before the canceled receipt settles.
    next.begin()
    next.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    next.commit()
    next.markReady()
    await reload
    expect(source.collection.health.reloading).toBe(false)
    expect([...source.collection.keys()].sort()).toEqual([1, 2])
    await source.collection.cleanup()
  })

  it(`drops the retired run's open sync transaction`, async () => {
    const source = createSource(`A`)
    source.collection.startSyncImmediate()
    const first = source.params
    first.begin()
    first.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    first.commit()
    first.markReady()
    first.begin()
    first.write({ type: `insert`, value: { id: 2, parentId: 0 } })
    const reload = source.collection.reload()
    const next = source.params
    next.begin()
    next.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    next.commit()
    next.markReady()
    await reload
    expect(
      source.collection._state.pendingSyncedTransactions.filter(
        (transaction) => !transaction.committed,
      ),
    ).toEqual([])
    expect(source.collection.get(2)).toMatchObject({ id: 2, parentId: 2 })
    await source.collection.cleanup()
  })
})

describe(`request errors`, () => {
  function createRequestHistory() {
    let parentParams!: SyncParams
    const outcomes: Array<`ok` | `fail` | `hold`> = []
    const held: Array<ReturnType<typeof createDeferred<void>>> = []
    const parents = createCollection<Row, number>({
      id: `health-request-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          parentParams = params
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-request-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: (_options: LoadSubsetOptions) => {
              const outcome = outcomes.shift() ?? `ok`
              if (outcome === `hold`) {
                const load = createDeferred<void>()
                held.push(load)
                return load.promise
              }
              return outcome === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`child load failed`))
            },
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ parent: parents })
        .leftJoin({ child: children }, ({ parent, child }) =>
          eq(parent.id, child.parentId),
        ),
    )
    const writeParent = (type: `insert` | `delete`, id: number) => {
      parentParams.begin()
      parentParams.write({ type, value: { id, parentId: id } })
      parentParams.commit()
    }
    const markParentsReady = () => parentParams.markReady()
    return {
      parents,
      children,
      query,
      outcomes,
      held,
      writeParent,
      markParentsReady,
    }
  }

  async function withHistory(
    run: (history: ReturnType<typeof createRequestHistory>) => Promise<void>,
  ) {
    const history = createRequestHistory()
    expect(
      history.query.health,
      `the query exposes a health tree`,
    ).toBeDefined()
    const consoleError = console.error
    console.error = () => {}
    try {
      await run(history)
    } finally {
      console.error = consoleError
      await history.query.cleanup()
      await history.parents.cleanup()
      await history.children.cleanup()
    }
  }

  it(`a failed load after initial-query readiness is a request error that clears when its demand settles`, () =>
    withHistory(
      async ({ query, children, outcomes, writeParent, markParentsReady }) => {
        const preload = query.preload()
        writeParent(`insert`, 1)
        markParentsReady()
        await preload
        expect(query.health.hasErrors).toBe(false)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `child load failed`,
        })
        expect(query.health.failureReason).toBeNull()
        expect(children.health.hasErrors).toBe(false)

        // The demand changes again and its new load settles.
        outcomes.push(`ok`)
        writeParent(`insert`, 3)
        await flushPromises()
        expect(query.health.hasErrors).toBe(false)
      },
    ))

  it(`a request error clears when the query stops needing the demand`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      const preload = query.preload()
      writeParent(`insert`, 1)
      markParentsReady()
      await preload

      outcomes.push(`fail`)
      writeParent(`insert`, 2)
      await flushPromises()
      expect(query.health.error).toMatchObject({ message: `child load failed` })

      writeParent(`delete`, 1)
      writeParent(`delete`, 2)
      await flushPromises()
      expect(query.health.hasErrors).toBe(false)
      expect(query.status).toBe(`ready`)
    }))

  // A later load of the failed demand that fulfills clears its error, also
  // when a reload issues it: a source's reload replays the query's demand,
  // and the query's own reload loads it in a new run. The guide offers
  // `reload()` for a node with an `error`, so the query's reload must reach
  // a request error on its own node.
  it.each([`source`, `query`] as const)(
    `a request error clears when the %s reload loads the demand again`,
    (reloaded) =>
      withHistory(
        async ({
          query,
          children,
          outcomes,
          writeParent,
          markParentsReady,
        }) => {
          const preload = query.preload()
          writeParent(`insert`, 1)
          markParentsReady()
          await preload

          outcomes.push(`fail`)
          writeParent(`insert`, 2)
          await flushPromises()
          expect(query.health.error).toMatchObject({
            message: `child load failed`,
          })

          await (reloaded === `source` ? children : query).reload()
          await flushPromises()
          expect(query.health.hasErrors).toBe(false)
          expect(query.status).toBe(`ready`)
          expect(query.size).toBe(2)
        },
      ),
  )

  // A replay clears only what failed before it started (as LoadOrder does
  // for root loads): a demand that fails while the replay is in flight keeps
  // its error when the replay succeeds. The replay holds that failure with
  // its publication, so it shows once the replay settles.
  it(`a source reload's replay keeps a request error that failed after it started`, () =>
    withHistory(
      async ({
        query,
        children,
        outcomes,
        held,
        writeParent,
        markParentsReady,
      }) => {
        const preload = query.preload()
        writeParent(`insert`, 1)
        markParentsReady()
        await preload

        outcomes.push(`hold`)
        const reload = children.reload()
        await flushPromises()
        expect(held, `the replay is in flight`).toHaveLength(1)

        outcomes.push(`fail`)
        writeParent(`insert`, 2)
        await flushPromises()

        held[0]!.resolve()
        await reload
        await flushPromises()
        expect(query.health.error, `the later failure stays`).toMatchObject({
          message: `child load failed`,
        })
      },
    ))

  it(`a failed load before initial-query readiness fails the query's sync run`, () =>
    withHistory(async ({ query, outcomes, writeParent, markParentsReady }) => {
      outcomes.push(`fail`)
      const preload = query.preload()
      void preload.catch(() => undefined)
      writeParent(`insert`, 1)
      markParentsReady()
      await flushPromises()
      expect(query.status).toBe(`error`)
      expect(query.health.error).toMatchObject({ message: `child load failed` })
      await expect(preload).rejects.toBeDefined()
    }))
})

// A crash is not recovered in place: `reload()` rejects and nothing starts a
// new sync run. Only cleanup leaves `crashed`, and cleanup discards all of
// the Collection's state, so a later start is a fresh start, as a new
// Collection over the same source would be. Model: after the cascade
// cleanup and a new preload, the Collection and a query mounted again show
// only the new run's rows and no problem.
describe(`crash recovery`, () => {
  it(`recovers a crashed Collection only through a full cleanup`, async () => {
    let runs = 0
    const collection = createCollection<Row, number>({
      id: `health-crash-recovery-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          const run = ++runs
          params.begin()
          params.write({ type: `insert`, value: { id: run, parentId: run } })
          params.commit()
          params.markReady()
        },
      },
    })
    let query = createLiveQueryCollection((q) => q.from({ row: collection }))
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      collection._lifecycle.crash(new Error(`index broke`))
      expect(query.status).toBe(`crashed`)

      await expect(collection.reload()).rejects.toThrow(/crashed/)
      await flushPromises()
      expect(collection.status, `nothing recovers it in place`).toBe(`crashed`)
      expect(runs).toBe(1)

      await collection.cleanup({ dependents: true })
      await collection.preload()
      expect(runs).toBe(2)
      expect(collection.status).toBe(`ready`)
      expect(collection.toArray.map((row) => row.id)).toEqual([2])
      expect(collection.health.hasErrors).toBe(false)

      query = createLiveQueryCollection((q) => q.from({ row: collection }))
      await query.preload()
      expect(query.status).toBe(`ready`)
      expect(query.toArray.map((row) => row.id)).toEqual([2])
      expect(query.health.hasErrors).toBe(false)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await collection.cleanup({ dependents: true })
    }
  })
})

// A query whose first load failed waits for `reload()`: another source
// becoming ready does not restart it, and its failed load is not retried. The
// main grammar fails only sources, so this lane supplies the query's own
// failure.
describe(`a query's own failed first load`, () => {
  it(`does not restart when an unrelated source becomes ready`, async () => {
    let loads = 0
    const children = createCollection<Row, number>({
      id: `health-own-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              loads++
              return new Promise<void>((_, reject) =>
                setTimeout(() => reject(new Error(`child load failed`)), 0),
              )
            },
          }
        },
      },
    })
    const parents = createSource(`B`)
    parents.collection.startSyncImmediate()
    const query = createLiveQueryCollection((q) =>
      q
        .from({ child: children })
        .where(({ child }) => eq(child.parentId, 1))
        .join({ parent: parents.collection }, ({ child, parent }) =>
          eq(child.parentId, parent.id),
        ),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      void query.preload().catch(() => undefined)
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(query.status).toBe(`error`)
      expect(query.health.error).toMatchObject({ message: `child load failed` })
      const loadsAtFailure = loads
      parents.params.markReady()
      await flushPromises()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(query.status).toBe(`error`)
      expect(loads).toBe(loadsAtFailure)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await parents.collection.cleanup()
      await children.cleanup()
    }
  })

  // The query's own reload starts a new run while the status still shows the
  // failed first load. That run is in its first load too, so its outcome
  // decides the reload: a load that fails again fails it (status `error`,
  // the new cause), and a graph that throws crashes the query.
  it.each([`ok`, `load-fails`, `graph-throws`] as const)(
    `settles the query's reload with its new run: %s`,
    async (outcome) => {
      const answers: Array<`fail` | `ok`> = [
        `fail`,
        outcome === `load-fails` ? `fail` : `ok`,
      ]
      const source = createCollection<Row, number>({
        id: `health-own-reload-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.markReady()
            return {
              loadSubset: () => {
                const answer = answers.shift() ?? `ok`
                if (answer === `fail`)
                  return Promise.reject(
                    new Error(`load ${2 - answers.length} failed`),
                  )
                // The rows arrive after the run's sync entry, so a graph
                // that throws on them does so in a later graph run.
                return Promise.resolve().then(() => {
                  params.begin()
                  params.write({
                    type: `insert`,
                    value: { id: 1, parentId: 1 },
                  })
                  params.commit()
                })
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) =>
        q.from({ row: source }).fn.select(({ row }) => {
          if (outcome === `graph-throws`) throw new Error(`select threw`)
          return row
        }),
      )
      const consoleError = console.error
      console.error = () => {}
      try {
        await query.preload().catch(() => undefined)
        expect(query.status).toBe(`error`)
        const settled = await Promise.race([
          query.reload().then(
            () => `resolved`,
            () => `rejected`,
          ),
          new Promise((resolve) => setTimeout(() => resolve(`pending`), 200)),
        ])
        expect(settled).toBe(outcome === `ok` ? `resolved` : `rejected`)
        expect(query.status).toBe(
          outcome === `ok`
            ? `ready`
            : outcome === `load-fails`
              ? `error`
              : `crashed`,
        )
        expect(query.health.reloading).toBe(false)
        if (outcome === `ok`) expect(query.size).toBe(1)
        if (outcome === `load-fails`)
          expect(query.health.error?.message).toContain(`load 2 failed`)
      } finally {
        console.error = consoleError
        await query.cleanup()
        await source.cleanup()
      }
    },
  )
})

// An ordered window that filters on a lazily joined source waits for its join
// loads before it moves. A join load that fails after readiness is a request
// error on the query's node, and it settles that demand: the window must not
// wait for it for good. A later move loads, moves the window, and clears the
// error. Every marker row exists from the start, so only the load fails.
describe(`a failed join load under an ordered filtered window`, () => {
  // Q1 (review 2): while the join load is pending, the query holds its
  // output. When the load fails, the failure settles that demand (law 16),
  // so the held output publishes at once: a change made meanwhile, which
  // needs no other join load, shows without waiting for some later change.
  it.each([`left`, `inner`] as const)(
    `publishes a change held behind a failed join load (%s join)`,
    async (join) => {
      let rootParams!: SyncParams
      const pendingLoads: Array<ReturnType<typeof createDeferred<void>>> = []
      let holdLoads = false
      const roots = createCollection<
        { id: number; rank: number; label?: string },
        number
      >({
        id: `health-held-roots-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            rootParams = params as unknown as SyncParams
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({ type: `insert`, value: { id, rank: id } })
            params.commit()
            params.markReady()
          },
        },
      })
      const markers = createCollection<{ id: number; rootId: number }, number>({
        id: `health-held-markers-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({
                type: `insert`,
                value: { id: 100 + id, rootId: id },
              })
            params.commit()
            params.markReady()
            return {
              loadSubset: () => {
                if (!holdLoads) return Promise.resolve()
                const load = createDeferred<void>()
                pendingLoads.push(load)
                return load.promise
              },
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) => {
        const from = q.from({ root: roots })
        const joined =
          join === `left`
            ? from.leftJoin({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
            : from.join({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
        return joined
          .where(({ marker }) => not(isUndefined(marker.id)))
          .orderBy(({ root }) => root.rank)
          .limit(2)
      })
      const subscription = query.subscribeChanges(() => {})
      const consoleError = console.error
      console.error = () => {}
      const ids = () => query.toArray.map((row: any) => row.root.id as number)
      try {
        await query.preload()
        expect(ids()).toEqual([1, 2])
        holdLoads = true
        // A new root asks the lazy join for its marker; the load is held.
        rootParams.begin()
        rootParams.write({
          type: `insert`,
          value: { id: 11, rank: 0 },
        } as never)
        rootParams.commit()
        await flushPromises()
        expect(
          pendingLoads.length,
          `the new root waits for a join load`,
        ).toBeGreaterThan(0)
        // Root 2 is visible and its marker is loaded: its update needs no
        // join load.
        rootParams.begin()
        rootParams.write({
          type: `update`,
          value: { id: 2, rank: 2, label: `edited` },
        } as never)
        rootParams.commit()
        await flushPromises()
        for (const load of pendingLoads.splice(0))
          load.reject(new Error(`marker load failed`))
        await flushPromises()
        expect(pendingLoads, `no join load is pending`).toEqual([])
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `marker load failed`,
        })
        expect(ids(), `the window keeps its rows`).toEqual([1, 2])
        expect(
          (query.toArray[1] as any).root.label,
          `the held change publishes after the failure`,
        ).toBe(`edited`)
      } finally {
        console.error = consoleError
        subscription.unsubscribe()
        await query.cleanup()
        await roots.cleanup()
        await markers.cleanup()
      }
    },
  )

  it.each([`left`, `inner`] as const)(
    `lets a later window move (%s join)`,
    async (join) => {
      let failLoads = false
      const roots = createCollection<{ id: number; rank: number }, number>({
        id: `health-window-roots-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({ type: `insert`, value: { id, rank: id } })
            params.commit()
            params.markReady()
          },
        },
      })
      const markers = createCollection<{ id: number; rootId: number }, number>({
        id: `health-window-markers-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        gcTime: 0,
        sync: {
          sync: (params) => {
            params.begin()
            for (let id = 1; id <= 10; id++)
              params.write({
                type: `insert`,
                value: { id: 100 + id, rootId: id },
              })
            params.commit()
            params.markReady()
            return {
              loadSubset: () =>
                failLoads
                  ? Promise.reject(new Error(`marker load failed`))
                  : Promise.resolve(),
            }
          },
        },
      })
      const query = createLiveQueryCollection((q) => {
        const from = q.from({ root: roots })
        const joined =
          join === `left`
            ? from.leftJoin({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
            : from.join({ marker: markers }, ({ root, marker }) =>
                eq(root.id, marker.rootId),
              )
        return joined
          .where(({ marker }) => not(isUndefined(marker.id)))
          .orderBy(({ root }) => root.rank)
          .limit(2)
      })
      const subscription = query.subscribeChanges(() => {})
      const consoleError = console.error
      console.error = () => {}
      const ids = () => query.toArray.map((row: any) => row.root.id as number)
      try {
        await query.preload()
        expect(ids()).toEqual([1, 2])

        failLoads = true
        await expect(
          Promise.resolve(query.utils.setWindow({ offset: 4, limit: 2 })),
        ).rejects.toThrow(`marker load failed`)
        expect(query.status).toBe(`ready`)
        expect(query.health.error).toMatchObject({
          message: `marker load failed`,
        })

        failLoads = false
        await query.utils.setWindow({ offset: 6, limit: 2 })
        await flushPromises()
        expect(ids(), `the window moves after the failure`).toEqual([7, 8])
        expect(query.health.error, `the later load clears it`).toBeNull()
        expect(query.status).toBe(`ready`)
      } finally {
        console.error = consoleError
        subscription.unsubscribe()
        await query.cleanup()
        await roots.cleanup()
        await markers.cleanup()
      }
    },
  )
})

describe(`root request health`, () => {
  it(`a failed root load after initial-query readiness is a request error that clears when a later load settles`, async () => {
    const outcomes: Array<`ok` | `fail`> = []
    const source = createCollection<Row, number>({
      id: `health-root-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () =>
              (outcomes.shift() ?? `ok`) === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`root load failed`)),
          }
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.id)
        .limit(2),
    )
    expect(query.health, `the query exposes a health tree`).toBeDefined()
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      expect(query.health.hasErrors).toBe(false)

      outcomes.push(`fail`)
      await Promise.resolve(
        query.utils.setWindow({ offset: 4, limit: 2 }),
      ).catch(() => undefined)
      await flushPromises()
      expect(query.status).toBe(`ready`)
      expect(query.health.error).toMatchObject({ message: `root load failed` })
      expect(source.health.hasErrors).toBe(false)

      await query.utils.setWindow({ offset: 8, limit: 2 })
      await flushPromises()
      expect(query.health.hasErrors).toBe(false)
    } finally {
      console.error = consoleError
      await query.cleanup()
      await source.cleanup()
    }
  })
})

// ---------------------------------------------------------------------------
// On-demand first load after query readiness
// ---------------------------------------------------------------------------

/**
 * A live query over an on-demand Collection becomes ready when its subsets
 * settle, so the Collection can still be in its first load when the query is
 * ready. The generated Collections are eager and never reach this state.
 * The laws are the ones above. After the query has shown data, only a crash
 * changes its status. The Collection's own node shows its first-load failure
 * (`error` status) or its stop after readiness (`ready` status, with an
 * `error`). The query's `reload()` reloads the Collection, and the new run's
 * readiness clears the node. A crashed query's `reload()` rejects.
 *
 * Histories cross the Collection's step (`fail` before its first ready,
 * `fail` after a `markReady()`, or `crash`) with a direct query and an
 * inner join to an eager Collection. Each history then calls the query's
 * `reload()`. The model gives the node's status and error message, the
 * query's status, and its row count at each cut.
 */
type LateFirstLoadHistory = {
  step: `fail-before-ready` | `fail-after-ready` | `crash`
  shape: `direct` | `join`
}

type LateFirstLoadCut = {
  queryStatus: CollectionStatus
  rows: number | null
  node: { status: CollectionStatus; error: string | null }
}

function expectedLateFirstLoad(history: LateFirstLoadHistory): {
  afterStep: LateFirstLoadCut
  afterReload: LateFirstLoadCut | `rejects`
} {
  if (history.step === `crash`)
    return {
      afterStep: {
        queryStatus: `crashed`,
        rows: null,
        node: { status: `crashed`, error: `stopped` },
      },
      afterReload: `rejects`,
    }
  return {
    afterStep: {
      queryStatus: `ready`,
      rows: 1,
      node: {
        status: history.step === `fail-before-ready` ? `error` : `ready`,
        error: `stopped`,
      },
    },
    afterReload: {
      queryStatus: `ready`,
      rows: 1,
      node: { status: `ready`, error: null },
    },
  }
}

describe(`on-demand first load after query readiness`, () => {
  const histories: Array<LateFirstLoadHistory> = []
  for (const step of [
    `fail-before-ready`,
    `fail-after-ready`,
    `crash`,
  ] as const)
    for (const shape of [`direct`, `join`] as const)
      histories.push({ step, shape })

  it.each(histories)(`step $step, shape $shape`, async (history) => {
    let runs = 0
    let firstRun!: SyncParams
    const lazy = createCollection<Row, number>({
      id: `health-late-first-load-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          // The first run stays in its first load; a reload's run is ready.
          if (runs++ === 0) firstRun = params
          else params.markReady()
          return {
            loadSubset: () => {
              params.begin()
              params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
              params.commit()
              return true
            },
          }
        },
      },
    })
    const eager = createCollection<Row, number>({
      id: `health-late-first-load-eager-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.begin()
          params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          params.commit()
          params.markReady()
        },
      },
    })
    const query = createLiveQueryCollection((q) =>
      history.shape === `direct`
        ? q.from({ lazy })
        : q
            .from({ eager })
            .join({ lazy }, ({ eager, lazy }) => eq(eager.id, lazy.id)),
    )
    const lazyNode = () =>
      query.health.sources.find((node) => node.alias === `lazy`)!
    const cut = (): LateFirstLoadCut => ({
      queryStatus: query.status,
      rows: query.status === `ready` ? query.size : null,
      node: {
        status: lazyNode().status,
        error: lazyNode().error?.message ?? null,
      },
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await query.preload()
      // Premise: the query is ready while the Collection is still loading.
      expect(lazy.status).toBe(`loading`)
      expect(query.size).toBe(1)

      const model = expectedLateFirstLoad(history)
      const stopped = new Error(`stopped`)
      if (history.step === `crash`)
        firstRun.collection._lifecycle.crash(stopped)
      else {
        if (history.step === `fail-after-ready`) firstRun.markReady()
        firstRun.fail(stopped)
      }
      await flushPromises()
      expect(cut(), `after the step`).toEqual(model.afterStep)
      expect(
        findProblems(query.health).some((node) => node.alias === `lazy`),
      ).toBe(true)

      if (model.afterReload === `rejects`) {
        await expect(query.reload()).rejects.toBeDefined()
        expect(runs, `a crashed query does not reload its sources`).toBe(1)
      } else {
        await query.reload()
        await flushPromises()
        expect(cut(), `after the query's reload`).toEqual(model.afterReload)
        expect(findProblems(query.health)).toEqual([])
      }
    } finally {
      console.error = consoleError
      await query.cleanup()
      await lazy.cleanup()
      await eager.cleanup()
    }
  })
})

describe(`lazy join demand grammar`, () => {
  // Q4 (review 2): a load that waited for a deferred start (DbClient
  // hydration defers a start through this seam) runs the adapter's
  // loadSubset when the start resumes. A reload from inside that call
  // rejects, as from any loadSubset call.
  it(`a reload from inside a deferred loadSubset rejects`, async () => {
    let reentrant: Promise<void> | undefined
    const children = createCollection<Row, number>({
      id: `health-deferred-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      startSync: false,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () => {
              if (!reentrant) {
                reentrant = children.reload()
                reentrant.catch(() => undefined)
              }
              return true
            },
          }
        },
      },
    })
    expect(children._deferSyncStart()).toBe(true)
    const query = createLiveQueryCollection((q) => q.from({ row: children }))
    void query.preload().catch(() => undefined)
    await flushPromises()
    children._resumeSyncStart()
    await flushPromises()
    expect(reentrant, `the deferred load ran`).toBeDefined()
    await expect(reentrant).rejects.toBeInstanceOf(
      CollectionReloadDuringSyncEntryError,
    )
    await query.cleanup()
    await children.cleanup()
  })

  // Q6 (review 2): cleanup run from a subscription's status listener while
  // a reload retires the run ends that reload with its run. A later fresh
  // start then has the rows it loads as its diff baseline: no reload's
  // replacement is armed (law 14: cleanup discards the run's state).
  it(`a cleanup run while a reload retires the run leaves no replacement armed`, async () => {
    let params!: SyncParams
    let syncCalls = 0
    const source = createCollection<Row, number>({
      id: `health-reentrant-cleanup-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (next) => {
          syncCalls++
          params = next
          next.markReady()
          return { loadSubset: () => new Promise<void>(() => {}) }
        },
      },
    })
    await source.preload()
    const subscription = source.subscribeChanges(() => {}, {
      includeInitialState: true,
    })
    subscription.requestSnapshot({
      where: undefined as never,
      optimizedOnly: false,
    } as never)
    let cleanup: Promise<void> | undefined
    subscription.on(`status:change`, () => {
      cleanup ??= source.cleanup().catch(() => undefined)
    })
    void source.reload().catch(() => undefined)
    await cleanup
    await flushPromises()
    expect(syncCalls, `the ended reload starts no sync run`).toBe(1)
    subscription.unsubscribe()
    await source.preload()
    params.begin()
    params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
    params.commit()
    await flushPromises()
    expect(cleanup, `the listener ran during the reload`).toBeDefined()
    expect(
      [...source._state.acceptedSyncedEntries()].map(([key]) => key),
      `the fresh run's diff baseline`,
    ).toEqual([1])
    await source.cleanup()
  })

  // Q7 (review 2): a reload's new run that calls markReady() while a
  // transaction is open completes the reload and keeps the rows, and the
  // open transaction still commits on top of them.
  it(`markReady() during a reload with an open write keeps the write committable`, async () => {
    let params!: SyncParams
    const source = createCollection<Row, number>({
      id: `health-direct-ready-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          if (source.status === `loading`) {
            next.begin()
            next.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            next.commit()
            next.markReady()
          }
        },
      },
    })
    await source.preload()
    const reload = source.reload()
    params.begin()
    params.write({ type: `insert`, value: { id: 2, parentId: 2 } })
    params.markReady()
    expect(
      () => params.write({ type: `insert`, value: { id: 3, parentId: 3 } }),
      `the open transaction still takes writes`,
    ).not.toThrow()
    expect(() => params.commit(), `the open write still commits`).not.toThrow()
    await reload
    expect(source.toArray.map((row) => row.id)).toEqual([1, 2, 3])
    await source.cleanup()
  })
})

// ---------------------------------------------------------------------------
// Effect lane
// ---------------------------------------------------------------------------

/**
 * An Effect works the same as a query. Its initial-query readiness is its
 * initial load: every
 * initial load has settled and every eager source is ready, whether or not it
 * has `skipInitial`. `skipInitial` only decides whether the initial rows are
 * delivered. As for a live query, a crashed source ends the Effect through
 * `onSourceError` at any time, and a source whose first load fails ends it
 * before its initial-query readiness. An on-demand source can fail its first
 * load after that readiness, because the readiness follows the Effect's
 * settled loads; like every other source problem after it, that is a sync
 * problem on the source's node: it does not dispose the Effect, and
 * `onHealthChange` receives the health tree, with one node per source alias.
 *
 * The lane crosses `skipInitial`, the source mode, and when the source fails.
 * Before initial-query readiness, an eager source has not called `markReady()`, and an
 * on-demand source still has its first load pending. After it, the
 * source calls `fail()`, which fails the first load of an on-demand source
 * still in its initial sync and sets the `error` of an eager source after
 * Collection readiness, or it crashes, or it reaches Collection readiness
 * (on-demand only) and then reports a `failureReason`. Every history also checks that one change reaches
 * `onHealthChange` once: no two reported trees are the same object. The app
 * knows the tree the gate opens on, announced or not (laws 16 and 17), so a
 * healthy gate announces nothing, and each later change is one call.
 */
describe(`effect errors`, () => {
  type EffectHistory = {
    skipInitial: boolean
    syncMode: `eager` | `on-demand`
    failure:
      | `before gate`
      | `fail after gate`
      | `crash after gate`
      | `report after gate`
      | `problem before the Effect`
  }
  const histories: Array<EffectHistory> = [true, false].flatMap((skipInitial) =>
    ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
      (
        [
          `before gate`,
          `fail after gate`,
          `crash after gate`,
          `report after gate`,
          `problem before the Effect`,
        ] as const
      ).map((failure) => ({ skipInitial, syncMode, failure })),
    ),
  )

  it.each(histories)(`%j`, async ({ skipInitial, syncMode, failure }) => {
    let params!: SyncParams
    let settleLoad = () => {}
    const writeRow = () => {
      params.begin()
      params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
      params.commit()
    }
    const source = createCollection<Row, number>({
      id: `health-effect-${syncMode}-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          if (syncMode === `eager`) return undefined
          return {
            loadSubset: () =>
              new Promise<void>((resolve) => {
                settleLoad = () => {
                  writeRow()
                  resolve()
                }
              }),
          }
        },
      },
    })
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const delivered: Array<unknown> = []
    const startEffect = () =>
      createEffect({
        query: (q) => q.from({ row: source }),
        skipInitial,
        onBatch: (events) => {
          delivered.push(...events.map((event) => event.key))
        },
        onSourceError: (error) => sourceErrors.push(error),
        onHealthChange: (health) => trees.push(health),
      })
    const consoleError = console.error
    console.error = () => {}
    // A source can already be ready and report a problem when the Effect is
    // created. Law 16: after the Effect's initial-query readiness, a sync
    // problem reaches onHealthChange, so the gate reports the tree it opens
    // on once (law 17: every change is announced).
    if (failure === `problem before the Effect`) {
      void source.preload()
      await flushPromises()
      if (syncMode === `eager`) {
        writeRow()
        params.markReady()
      } else params.markReady()
      await flushPromises()
      params.reportError(new Error(`stalled`))
    }
    const effect = startEffect()
    try {
      await flushPromises()
      if (failure === `problem before the Effect`) {
        if (syncMode === `on-demand`) settleLoad()
        await flushPromises()
        expect(effect.disposed).toBe(false)
        expect(trees, `the gate reports the problem once`).toHaveLength(1)
        expect(trees[0]).toMatchObject({
          hasErrors: true,
          sources: [{ alias: `row`, failureReason: { message: `stalled` } }],
        })
        return
      }
      if (failure === `before gate`) {
        params.fail(new Error(`gave up`))
        await flushPromises()
        // Model: the Effect never reached initial-query readiness, so the failure
        // ends it.
        expect(effect.disposed).toBe(true)
        expect(sourceErrors).toHaveLength(1)
        expect(trees).toEqual([])
        return
      }
      // Reach initial-query readiness: the eager source becomes ready, or the on-demand
      // source's first load settles.
      if (syncMode === `eager`) {
        writeRow()
        params.markReady()
      } else {
        settleLoad()
      }
      await flushPromises()
      // Model: only `skipInitial` withholds the initial rows.
      expect(delivered).toEqual(skipInitial ? [] : [1])
      // The status change that completes the gate is part of the gate's
      // tree, not a change after it.
      expect(trees, `a healthy gate announces nothing`).toEqual([])

      if (failure === `report after gate`) {
        // An on-demand source reaches its own Collection readiness after the
        // Effect's: a status change that must reach onHealthChange once.
        if (syncMode === `on-demand`) params.markReady()
        await flushPromises()
        params.reportError(new Error(`stalled`))
        await flushPromises()
        expect(effect.disposed).toBe(false)
        expect(trees.at(-1)).toMatchObject({
          hasErrors: true,
          sources: [
            {
              alias: `row`,
              failureReason: { message: `stalled` },
              error: null,
            },
          ],
        })
        expect(new Set(trees).size, `one report per change`).toBe(trees.length)
        // The on-demand source's own readiness is one change, the report
        // another.
        expect(trees, `one call per change`).toHaveLength(
          syncMode === `on-demand` ? 2 : 1,
        )
        return
      }
      if (failure === `crash after gate`) {
        params.collection._lifecycle.crash(new Error(`crashed`))
      } else {
        params.fail(new Error(`gave up`))
      }
      await flushPromises()
      // Model: only a crash ends the Effect after its gate. A failed first
      // load of an on-demand source and an eager source's fail after
      // Collection readiness are both the source node's `error`.
      const ends = failure === `crash after gate`
      expect(effect.disposed).toBe(ends)
      expect(sourceErrors).toHaveLength(ends ? 1 : 0)
      expect(new Set(trees).size, `one report per change`).toBe(trees.length)
      if (!ends) expect(trees, `one call per change`).toHaveLength(1)
      if (!ends) {
        expect(trees.at(-1)).toMatchObject({
          kind: `live-query`,
          hasErrors: true,
          sources: [
            {
              alias: `row`,
              status: syncMode === `on-demand` ? `error` : `ready`,
              failureReason: null,
              error: { message: `gave up` },
            },
          ],
        })
      }
    } finally {
      console.error = consoleError
      await effect.dispose()
      await source.cleanup()
    }
  })
})

// Where an Effect's gate opens must not change what it announces. The gate
// can open when the Effect starts (every source already ready), inside a
// source's `status:change` (an eager source, a nested query, or a join's
// second source becomes ready after the Effect), or when a load settles (an
// on-demand source). The app knows the tree the gate opens on, announced or
// not (laws 16 and 17). Model: after a healthy gate `onHealthChange` has had
// no call, and the next change is exactly one call with the changed facts.
// The on-demand row makes its source ready after the gate, a real change on
// the source's node, so an Effect that suppresses a real first change fails.
describe(`effect healthy gate`, () => {
  type Opener =
    | `eager source ready after the Effect`
    | `eager source ready before the Effect`
    | `on-demand first load settles`
    | `nested query ready after the Effect`
    | `second join source ready after the Effect`
  const openers: Array<Opener> = [
    `eager source ready after the Effect`,
    `eager source ready before the Effect`,
    `on-demand first load settles`,
    `nested query ready after the Effect`,
    `second join source ready after the Effect`,
  ]
  it.each(openers)(`%s`, async (opener) => {
    const syncMode =
      opener === `on-demand first load settles` ? `on-demand` : `eager`
    const sources = [`a`, `b`].map((name) => {
      const state: { params?: SyncParams; settle: () => void } = {
        settle: () => {},
      }
      const collection = createCollection<Row, number>({
        id: `health-gate-${name}-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        syncMode: name === `a` ? syncMode : `eager`,
        gcTime: 0,
        sync: {
          sync: (params) => {
            state.params = params
            params.begin()
            params.write({ type: `insert`, value: { id: 1, parentId: 1 } })
            params.commit()
            if (name === `a` && syncMode === `on-demand`)
              return {
                loadSubset: () =>
                  new Promise<void>((resolve) => {
                    state.settle = resolve
                  }),
              }
            return undefined
          },
        },
      })
      return { collection, state }
    })
    const [a, b] = sources as [(typeof sources)[0], (typeof sources)[0]]
    const nested =
      opener === `nested query ready after the Effect`
        ? createLiveQueryCollection((q) => q.from({ row: a.collection }))
        : undefined
    const trees: Array<HealthNode> = []
    const consoleError = console.error
    console.error = () => {}
    if (opener === `eager source ready before the Effect`) {
      void a.collection.preload()
      await flushPromises()
      a.state.params!.markReady()
      await flushPromises()
    }
    if (opener === `second join source ready after the Effect`) {
      void a.collection.preload()
      await flushPromises()
      a.state.params!.markReady()
      await flushPromises()
    }
    const effect = createEffect({
      query: (q) =>
        opener === `second join source ready after the Effect`
          ? q
              .from({ row: a.collection })
              .join({ other: b.collection }, ({ row, other }) =>
                eq(row.id, other.id),
              )
          : nested
            ? q.from({ view: nested })
            : q.from({ row: a.collection }),
      onBatch: () => {},
      onHealthChange: (health) => trees.push(health),
    })
    try {
      await flushPromises()
      // Open the gate.
      if (opener === `on-demand first load settles`) a.state.settle()
      else if (opener === `second join source ready after the Effect`)
        b.state.params!.markReady()
      else if (opener !== `eager source ready before the Effect`)
        a.state.params!.markReady()
      await flushPromises()
      expect(effect.disposed).toBe(false)
      expect(trees, `a healthy gate announces nothing`).toEqual([])
      // One change after the gate: the on-demand source, still loading at
      // the gate, becomes ready; every other source reports a problem.
      if (opener === `on-demand first load settles`) a.state.params!.markReady()
      else a.state.params!.reportError(new Error(`stalled`))
      await flushPromises()
      expect(trees, `one call for the change`).toHaveLength(1)
      expect(trees[0]!.hasErrors).toBe(
        opener !== `on-demand first load settles`,
      )
    } finally {
      console.error = consoleError
      await effect.dispose()
      await nested?.cleanup().catch(() => undefined)
      await a.collection.cleanup().catch(() => undefined)
      await b.collection.cleanup().catch(() => undefined)
    }
  })
})

// The Effect lane above creates the Effect first. A source can already be in
// `error` (its first load failed) or `crashed` when the Effect subscribes.
// No status change follows, so the Effect must read the status when it
// subscribes. Model: the Effect never reaches its gate, so either status ends
// it through `onSourceError` once, and no tree is reported.
describe(`effect over a source that already stopped`, () => {
  const histories = ([`error`, `crashed`] as const).flatMap((status) =>
    [true, false].map((skipInitial) => ({ status, skipInitial })),
  )

  it.each(histories)(`%j`, async ({ status, skipInitial }) => {
    let loads = 0
    const source = createCollection<Row, number>({
      id: `health-effect-stopped-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (params) => {
          if (status === `error`) params.fail(new Error(`first load failed`))
          else params.markReady()
          return {
            loadSubset: () => {
              loads++
              return true
            },
          }
        },
      },
    })
    await source.preload().catch(() => undefined)
    if (status === `crashed`) source._lifecycle.crash(new Error(`crashed`))
    expect(source.status).toBe(status)
    const listeners = () =>
      [
        ...(
          source as unknown as {
            _events: { listeners: Map<string, Map<unknown, unknown>> }
          }
        )._events.listeners.values(),
      ].reduce((sum, set) => sum + set.size, 0)
    const listenersBefore = listeners()
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const consoleError = console.error
    console.error = () => {}
    const effect = createEffect({
      query: (q) => q.from({ row: source }),
      skipInitial,
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onHealthChange: (health) => trees.push(health),
    })
    try {
      await flushPromises()
      expect(effect.disposed).toBe(true)
      expect(sourceErrors).toHaveLength(1)
      expect(trees).toEqual([])
      // It ends before any subscription or load reaches the source, and it
      // leaves no listener on it.
      expect(loads, `loads issued to the stopped source`).toBe(0)
      expect(source.subscriberCount).toBe(0)
      expect(listeners(), `listeners left on the source`).toBe(listenersBefore)
    } finally {
      console.error = consoleError
      await effect.dispose()
      await source.cleanup()
    }
  })
})

/**
 * An Effect has no request errors: a load that fails after its gate, as
 * before it, ends the Effect through `onSourceError`, and no tree it reported
 * shows the failure. The parents lead the Effect, and a lazy join loads the
 * children each new parent row reaches. The lane crosses `skipInitial` with
 * the parents' source mode.
 */
describe(`effect load failures`, () => {
  type RequestHistory = {
    skipInitial: boolean
    parentMode: `eager` | `on-demand`
  }
  const histories: Array<RequestHistory> = [true, false].flatMap(
    (skipInitial) =>
      ([`eager`, `on-demand`] as const).map((parentMode) => ({
        skipInitial,
        parentMode,
      })),
  )

  it.each(histories)(`%j`, async ({ skipInitial, parentMode }) => {
    let parentParams!: SyncParams
    const outcomes: Array<`ok` | `fail`> = []
    const parents = createCollection<Row, number>({
      id: `health-effect-parents-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: parentMode,
      gcTime: 0,
      sync: {
        sync: (params) => {
          parentParams = params
          if (parentMode === `on-demand`) {
            params.markReady()
            return { loadSubset: () => Promise.resolve() }
          }
          return undefined
        },
      },
    })
    const children = createCollection<Row, number>({
      id: `health-effect-children-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      gcTime: 0,
      sync: {
        sync: (params) => {
          params.markReady()
          return {
            loadSubset: () =>
              (outcomes.shift() ?? `ok`) === `ok`
                ? Promise.resolve()
                : Promise.reject(new Error(`child load failed`)),
          }
        },
      },
    })
    const writeParent = (id: number) => {
      parentParams.begin()
      parentParams.write({ type: `insert`, value: { id, parentId: id } })
      parentParams.commit()
    }
    const sourceErrors: Array<Error> = []
    const trees: Array<HealthNode> = []
    const effect = createEffect({
      query: (q) =>
        q
          .from({ parent: parents })
          .leftJoin({ child: children }, ({ parent, child }) =>
            eq(parent.id, child.parentId),
          ),
      skipInitial,
      onBatch: () => {},
      onSourceError: (error) => sourceErrors.push(error),
      onHealthChange: (health) => trees.push(health),
    })
    const consoleError = console.error
    console.error = () => {}
    try {
      await flushPromises()
      writeParent(1)
      if (parentMode === `eager`) parentParams.markReady()
      await flushPromises()

      // Model: after initial-query readiness, a failed load ends the Effect.
      outcomes.push(`fail`)
      writeParent(2)
      await flushPromises()
      expect(effect.disposed).toBe(true)
      expect(sourceErrors.map((error) => error.message)).toEqual([
        `child load failed`,
      ])
      expect(trees.every((tree) => tree.error === null)).toBe(true)
    } finally {
      console.error = consoleError
      await effect.dispose()
      await parents.cleanup()
      await children.cleanup()
    }
  })
})

/**
 * Two includes that read one Collection under the same alias are two include
 * nodes, and the query fixes that shape, so a cleaned-up query keeps them. A
 * per-row child Collection that starts changes nothing in the tree, so it
 * emits no `health:change`; otherwise every new parent row would rebuild it.
 */
// A pooled view's tree keeps node identity, as every tree does, whatever
// alias its query gives the source, including the alias `root` that the
// view's own node shows. The generated pooled shape uses one alias.
describe(`pooled view node identity`, () => {
  it.each([`row`, `root`])(`with source alias %s`, async (alias) => {
    let params!: SyncParams
    const source = createCollection<Row, number>({
      id: `health-pooled-alias-${Math.random().toString(36).slice(2)}`,
      getKey: (row) => row.id,
      gcTime: 0,
      sync: {
        sync: (next) => {
          params = next
          next.begin()
          next.write({ type: `insert`, value: { id: 1, parentId: 1 } })
          next.commit()
          next.markReady()
        },
      },
    })
    const view = createPooledLiveQuery(
      new Query()
        .from({ [alias]: source })
        .where((refs) =>
          eq(
            (refs as Record<string, { parentId: number }>)[alias]!.parentId,
            1,
          ),
        ) as unknown as Parameters<typeof createPooledLiveQuery>[0],
    ) as unknown as PooledView
    const subscription = view.subscribeChanges(() => {})
    try {
      await source.preload()
      const first = view.health
      expect(first.sources.map((node) => node.alias)).toEqual([alias])
      expect(view.health, `a second read gives the same tree`).toBe(first)
      params.reportError(new Error(`stalled`))
      const reported = view.health
      expect(reported).not.toBe(first)
      expect(view.health, `the changed tree is stable too`).toBe(reported)
      expect(reported.sources[0]!.failureReason?.message).toBe(`stalled`)
    } finally {
      subscription.unsubscribe()
      await source.cleanup({ dependents: true })
    }
  })
})

describe(`include nodes`, () => {
  it(`keep their shape, and healthy children change nothing`, async () => {
    const make = (name: string) => {
      let params!: SyncParams
      const collection = createCollection<Row, number>({
        id: `health-include-${name}-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        gcTime: 0,
        sync: {
          sync: (next) => {
            params = next
          },
        },
      })
      const write = (row: Row, type: `insert` | `delete` = `insert`) => {
        params.begin()
        params.write({ type, value: row })
        params.commit()
      }
      return { collection, write, ready: () => params.markReady() }
    }
    const A = make(`A`)
    const B = make(`B`)
    const query = createLiveQueryCollection((q) =>
      q.from({ b: B.collection }).select(({ b }) => ({
        id: b.id,
        items: include(
          q.from({ a: A.collection }).where(({ a }) => eq(a.parentId, b.id)),
        ),
        same: include(
          q.from({ a: A.collection }).where(({ a }) => eq(a.id, b.id)),
        ),
      })),
    )
    const consoleError = console.error
    console.error = () => {}
    try {
      const preload = query.preload()
      B.write({ id: 1, parentId: 1 })
      B.write({ id: 2, parentId: 2 })
      B.ready()
      A.write({ id: 1, parentId: 1 })
      A.ready()
      await preload
      const includes = () => query.health.sources.slice(1)
      expect(includes().map((node) => [node.alias, node.kind])).toEqual([
        [`a`, `include`],
        [`a`, `include`],
      ])

      let events = 0
      const stop = query.on(`health:change`, () => {
        events++
      })
      // New parent rows start healthy child Collections. Every tree change is
      // announced, so with no event the tree is the same object.
      const treeBefore = query.health
      B.write({ id: 3, parentId: 3 })
      B.write({ id: 4, parentId: 4 })
      await flushPromises()
      stop()
      expect(events, `healthy children emit no health:change`).toBe(0)
      expect(query.health, `no tree change without an event`).toBe(treeBefore)

      // The tree's shape comes from the query, so a cleaned-up query keeps
      // its include nodes.
      await query.cleanup()
      expect(includes().map((node) => node.kind)).toEqual([
        `include`,
        `include`,
      ])
    } finally {
      console.error = consoleError
      await query.cleanup()
      await A.collection.cleanup()
      await B.collection.cleanup()
    }
  })
})
