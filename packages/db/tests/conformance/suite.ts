/**
 * Shared live-query conformance suite.
 *
 * Think of each scenario as a short state-machine trace:
 *
 *     create sources -> mount -> publish or reconfigure -> flush -> observe
 *
 * Sources and handles form an ownership graph. `ScenarioSources` and
 * `ScenarioLifetime` release that graph even when an assertion fails, while
 * each framework driver chooses the native scheduling operation that defines
 * `flush`. The suite compares public observations, not framework internals.
 * This keeps the reference smaller than any adapter and makes disagreements
 * between adapters visible without copying their implementations.
 *
 * The lifecycle law distinguishes ownership by input, not by framework. A
 * live-query projection created by an adapter from a callback or config is
 * recomputable, so the adapter gives it a 1 ms retention window. Once unmount,
 * replacement, or disabling removes its last subscriber, that projection must
 * retire. A supplied collection, or a config with an explicit `gcTime`, remains
 * caller-owned and the adapter must preserve its retention policy. The
 * lifecycle scenarios enact those histories and compare the collection's
 * public `config.gcTime`, `subscriberCount`, and `status` at the ownership
 * boundary and after the last subscription is released.
 *
 * The scenario set came from the union of the five adapters' existing suites
 * plus framework-neutral gap closers. It covers value, order, cardinality,
 * lifecycle, reactivity, failure, and disposal as separate laws so a passing
 * final row assertion cannot hide a wrong intermediate state.
 *
 * Each scenario has a unique stable key. All current scenarios must pass;
 * future known bugs need exact failure signatures, not whole-test waivers.
 *
 * Coverage: query/where/select, live insert/update/delete, orderBy, join,
 * groupBy/aggregate, nested aggregates, `.includes` subqueries, findOne
 * cardinality, disabled + transitions, deferred readiness / eager / ready-with-
 * no-data, initial readiness over a lagging on-demand source, param recompilation, optimistic mutation, pre-created & config-object
 * inputs, opt-in pooling in each input form, error status, and order-only
 * moves.
 *
 * The query-identity scenarios (see `contract.ts`) run each history through
 * both identity policies. A comparing binding rejects an unhashable query
 * without `queryKey` (an empty key counts as none) at mount and at
 * recompilation and accepts it with a key;
 * a reactive binding runs it and recompiles when a captured value changes.
 * The source-ID grammar enumerates every three-step history over A(x), B(x)
 * (another object under A's ID), C(y), and a disabled step, judged by a
 * pairwise model. It distinguishes a remembered claim from a check against
 * only the previous query: A(x) -> C(y) -> B(x) and A(x) -> disabled -> B(x)
 * reject in a comparing binding and read B in a reactive one, while
 * A(x) -> C(y) -> A(x) is legal everywhere. It declares reach for each of
 * those states.
 * A new binding reads B after the first unmounts. Two same-ID objects in one
 * query follow the same split: rejected, or each read.
 */
import { describe, expect, it } from 'vitest'
import {
  include,
  pooledLiveQueries,
  waitForPersistedInitialRender,
} from '@tanstack/db'
import { createOracleReach } from '../oracle-reach'
import { ScenarioLifetime } from './scenario-lifetime'
import { ScenarioSources } from './scenario-sources'
import { scenarioRegistry } from './registration'
import { expectDisabledResult } from './disabled-laws'
import {
  expectKeyedRows,
  expectOrderedRows,
  expectUnorderedRows,
  selectedRow,
} from './result-laws'
import type { PooledLiveQueries } from '@tanstack/db'
import type {
  DeferredSourceHandle,
  LiveQueryDriver,
  LiveQueryHandle,
  Row,
} from './contract'

const ADAPTER_OWNED_GC_TIME_MS = 1
type ConformanceCollection = NonNullable<
  ReturnType<LiveQueryHandle[`collection`]>
>

function expectAdapterOwnedCollection(
  collection: ConformanceCollection | null,
): asserts collection is ConformanceCollection {
  expect(collection).not.toBeNull()
  expect(collection!.config.gcTime).toBe(ADAPTER_OWNED_GC_TIME_MS)
}

async function expectRetired(collection: ConformanceCollection): Promise<void> {
  await expect
    .poll(() => collection.status, { interval: 5, timeout: 500 })
    .toBe(`cleaned-up`)
}

/**
 * A rejected query input throws at the adapter's compile point: from the
 * mount or reconfiguration, or from the next result read.
 */
async function expectRejection(
  name: string,
  run: () => Promise<unknown> | unknown,
  // Many coded errors share their base class's name; the development
  // build's message tells them apart.
  message?: RegExp,
): Promise<void> {
  let rejection: unknown
  try {
    await run()
  } catch (error) {
    rejection = error
  }
  expect(rejection, `expected ${name}`).toMatchObject(
    message ? { name, message: expect.stringMatching(message) } : { name },
  )
}

/**
 * After a rejection, every read throws or holds no rows. Two reads catch a
 * memo that throws once and then serves its previous value, as a Vue
 * computed does (see `contract.ts`).
 */
function expectNoRowsAfterRejection(h: LiveQueryHandle): void {
  for (let read = 0; read < 2; read++) {
    let result: ReturnType<LiveQueryHandle[`current`]>
    try {
      result = h.current()
    } catch {
      continue
    }
    const { data, state } = result
    expect(
      Array.isArray(data) ? data : data === undefined ? [] : [data],
    ).toEqual([])
    expect(state?.size ?? 0).toBe(0)
  }
}

/** A published `data` value holds no row outside `rows`. */
function expectOnlyRowsOf(
  value: unknown,
  rows: ReadonlyArray<{ id: string }>,
): void {
  const allowed = new Set(rows.map(({ id }) => id))
  const published = (Array.isArray(value) ? value : value ? [value] : []).map(
    (row: { id: string }) => row.id,
  )
  expect(
    published.filter((id) => !allowed.has(id)),
    `published rows ${JSON.stringify(published)}`,
  ).toEqual([])
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const SEED: Array<Row> = [
  { id: `1`, name: `John Doe`, age: 30, team: `a` },
  { id: `2`, name: `Jane Doe`, age: 25, team: `b` },
  { id: `3`, name: `John Smith`, age: 35, team: `a` },
]

interface Issue {
  id: string
  title: string
  userId: string
}

// Issues reference SEED people: John(1) has 2, Jane(2) has 1, John Smith(3) has 0.
const ISSUES: Array<Issue> = [
  { id: `i1`, title: `Issue 1`, userId: `1` },
  { id: `i2`, title: `Issue 2`, userId: `2` },
  { id: `i3`, title: `Issue 3`, userId: `1` },
]

export function runSuite(rawDriver: LiveQueryDriver) {
  const { ops } = rawDriver
  const registry = scenarioRegistry(rawDriver.knownGaps)

  // Track every handle mounted during the current scenario so it is always torn
  // down, even when a scenario throws before its own
  // `h.unmount()`. Wrapping the driver's `mount*` methods records handles
  // automatically, so scenario bodies need no `try/finally` of their own.
  let lifetime: ScenarioLifetime | null = null
  let sources: ScenarioSources | null = null
  const track = <H extends LiveQueryHandle>(handle: H): H => {
    const unmount = handle.unmount.bind(handle)
    if (lifetime) handle.unmount = lifetime.defer(unmount)
    return handle
  }
  const driver: LiveQueryDriver = {
    ...rawDriver,
    makeSource: (data, collectionId) =>
      sources!.track(rawDriver.makeSource(data, collectionId)),
    makeDeferredSource: <T extends { id: string }>() =>
      sources!.track(rawDriver.makeDeferredSource<T>()),
    makeLaggingSource: <T extends { id: string }>() =>
      sources!.track(rawDriver.makeLaggingSource<T>()),
    makePrecreated: (build, options) =>
      sources!.track(rawDriver.makePrecreated(build, options)),
    makeErrorSource: () => sources!.track(rawDriver.makeErrorSource()),
    mount: (build) => track(rawDriver.mount(build)),
    mountControllable: (build, initial, options) =>
      track(rawDriver.mountControllable(build, initial, options)),
    mountCollection: (collection) =>
      track(rawDriver.mountCollection(collection)),
    mountConfig: (build, options) =>
      track(rawDriver.mountConfig(build, options)),
    mountDisabled: () => track(rawDriver.mountDisabled()),
  }

  const installPersistedReadiness = (
    source: DeferredSourceHandle,
    settledSnapshot:
      { status: `ready` } | { status: `error`; error: unknown } = {
      status: `ready`,
    },
  ) => {
    let snapshot:
      | { status: `loading` }
      | { status: `ready` }
      | { status: `error`; error: unknown } = { status: `loading` }
    const listeners = new Set<() => void>()
    Object.defineProperty(
      source.collection.config,
      Symbol.for(`@tanstack/db.persistedReadiness`),
      {
        value: {
          networkTimeoutMs: 0,
          waitForInitialRender: waitForPersistedInitialRender,
          getOrStartNetworkDeadline: () => Date.now(),
          getSnapshot: () => snapshot,
          subscribe: (listener: () => void) => {
            listeners.add(listener)
            return () => listeners.delete(listener)
          },
        },
      },
    )
    return () => {
      snapshot = settledSnapshot
      for (const listener of listeners) listener()
    }
  }

  /** Register one unique law. */
  const scenario = (
    key: string,
    name: string,
    fn: () => Promise<void> | void,
    // A generated grammar runs many histories, each through the driver's cut.
    timeoutMs?: number,
  ) => {
    registry.register(key)
    const label = `[${key}] ${name}`
    const run = async () => {
      const resources = new ScenarioLifetime()
      const ownedSources = new ScenarioSources()
      lifetime = resources
      sources = ownedSources
      try {
        await resources.run(async () => {
          try {
            await fn()
          } finally {
            ownedSources.defer(resources)
          }
        })
      } finally {
        lifetime = null
        sources = null
      }
    }
    it(label, run, timeoutMs)
  }

  describe(`live-query conformance :: ${driver.name}`, () => {
    scenario(
      `persisted-readiness`,
      `every opted-in source restores before a joined query reports persisted readiness`,
      async () => {
        const left = driver.makeDeferredSource<Row>()
        const right = driver.makeDeferredSource<Row>()
        const settleLeft = installPersistedReadiness(left)
        const settleRight = installPersistedReadiness(right)
        const h = driver.mount((q) =>
          q
            .from({ left: left.collection })
            .join({ right: right.collection }, ({ left: a, right: b }: any) =>
              ops.eq(a.id, b.id),
            ),
        )
        await h.flush()
        expect(h.current()).toMatchObject({
          status: `loading`,
          persistedStatus: `loading`,
          isPersistedReady: false,
        })

        await h.apply(() => {
          left.emit([SEED[0]!])
          right.emit([SEED[0]!])
        })
        await h.flush()
        expect(h.current().data).toHaveLength(1)

        await h.apply(settleLeft)
        await h.flush()
        expect(h.current().persistedStatus).toBe(`loading`)
        await h.apply(settleRight)
        await h.flush()
        expect(h.current()).toMatchObject({
          status: `loading`,
          persistedStatus: `ready`,
          isPersistedReady: true,
        })
      },
    )

    scenario(
      `persisted-readiness-opt-out`,
      `one unconfigured source keeps the persisted signal unavailable`,
      async () => {
        const opted = driver.makeDeferredSource<Row>()
        const ordinary = driver.makeDeferredSource<Row>()
        const settle = installPersistedReadiness(opted)
        const h = driver.mount((q) =>
          q
            .from({ opted: opted.collection })
            .join(
              { ordinary: ordinary.collection },
              ({ opted: a, ordinary: b }: any) => ops.eq(a.id, b.id),
            ),
        )
        await h.apply(settle)
        await h.flush()
        expect(h.current()).toMatchObject({
          persistedStatus: `unavailable`,
          isPersistedReady: false,
        })
      },
    )
    scenario(
      `persisted-error-identity`,
      `a persisted restore failure keeps its original object identity`,
      async () => {
        const source = driver.makeDeferredSource<Row>()
        const failure = { code: `restore-failed`, detail: { retryable: false } }
        const failRestore = installPersistedReadiness(source, {
          status: `error`,
          error: failure,
        })
        const h = driver.mount((q) => q.from({ items: source.collection }))
        await h.flush()
        expect(h.current().persistedStatus).toBe(`loading`)

        await h.apply(failRestore)
        expect(h.current().persistedStatus).toBe(`error`)
        expect(h.current().persistedError).toBe(failure)
        expect(h.current().isPersistedReady).toBe(false)
      },
    )
    // ---- spine: query + liveness ----------------------------------------

    scenario(
      `basic-select`,
      `from + where + select returns matching rows`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.gt(items.age, 30))
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()

        expectUnorderedRows(h.current().data, [{ id: `3`, name: `John Smith` }])
        h.unmount()
      },
    )

    // Single-source eq filters may be served from a partition shared by every
    // query of that shape; adapters must publish what the live query would.
    scenario(
      `eq-filter-rows`,
      `an eq filter publishes matching rows in key order as rows move in and out`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.team, `a`)),
        )
        await h.flush()
        const ids = () =>
          (h.current().data as Array<{ id: string }>).map((row) => row.id)
        expect(ids()).toEqual([`1`, `3`])

        source.update({ id: `2`, name: `Jane Doe`, age: 25, team: `a` })
        await h.flush()
        expect(ids()).toEqual([`1`, `2`, `3`])

        source.update({ id: `1`, name: `John Doe`, age: 30, team: `b` })
        source.insert({ id: `4`, name: `Dave`, age: 40, team: `a` })
        await h.flush()
        expect(ids()).toEqual([`2`, `3`, `4`])

        source.remove({ id: `3`, name: `John Smith`, age: 35, team: `a` })
        await h.flush()
        const remaining: Array<Row> = [
          { id: `2`, name: `Jane Doe`, age: 25, team: `a` },
          { id: `4`, name: `Dave`, age: 40, team: `a` },
        ]
        expectOrderedRows(h.current().data, remaining)
        expectKeyedRows(h.current().state, remaining)
        expect(h.current().status).toBe(`ready`)
        h.unmount()
      },
    )

    scenario(
      `eq-filter-peers`,
      `eq-filtered peers on one source each see only their rows`,
      async () => {
        const source = driver.makeSource(SEED)
        const query = (team: string) => (q: any) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.team, team))
        // The config opts into pooling; without it each query compiles.
        const pool = { pool: pooledLiveQueries }
        const teamA = driver.mountConfig(query(`a`), pool)
        const teamB = driver.mountConfig(query(`b`), pool)
        const olderA = driver.mountConfig(
          (q) => query(`a`)(q).where(({ items }: any) => ops.eq(items.age, 35)),
          pool,
        )
        for (const h of [teamA, teamB, olderA]) await h.flush()
        // Pooling shares one subscription between the two team queries.
        expect(source.collection.subscriberCount).toBe(
          driver.features?.pooledEqFilters ? 2 : 3,
        )
        const ids = (h: typeof teamA) =>
          (h.current().data as Array<{ id: string }>).map((row) => row.id)
        expect([ids(teamA), ids(teamB), ids(olderA)]).toEqual([
          [`1`, `3`],
          [`2`],
          [`3`],
        ])

        source.update({ id: `3`, name: `John Smith`, age: 35, team: `b` })
        for (const h of [teamA, teamB, olderA]) await h.flush()
        expect([ids(teamA), ids(teamB), ids(olderA)]).toEqual([
          [`1`],
          [`2`, `3`],
          [],
        ])
        for (const h of [teamA, teamB, olderA]) h.unmount()
        await expect
          .poll(() => source.collection.subscriberCount, {
            interval: 5,
            timeout: 500,
          })
          .toBe(0)
      },
    )

    // Pooling is opt-in per query. Queries that do not pass `pool` each
    // subscribe to the source themselves, whatever input form they use.
    scenario(
      `pool-opt-in`,
      `queries without pool keep a source subscription each`,
      async () => {
        const source = driver.makeSource(SEED)
        const query = (team: string) => (q: any) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.team, team))
        const handles = [
          driver.mount(query(`a`)),
          driver.mount(query(`b`)),
          driver.mountConfig(query(`a`)),
          driver.mountControllable((q, team: string) => query(team)(q), `b`),
        ]
        for (const h of handles) await h.flush()
        expect(source.collection.subscriberCount).toBe(handles.length)
        expect(
          handles.map((h) =>
            (h.current().data as Array<{ id: string }>).map((row) => row.id),
          ),
        ).toEqual([[`1`, `3`], [`2`], [`1`, `3`], [`2`]])
        for (const h of handles) h.unmount()
      },
    )

    // A pooled query whose parameter changes leaves its old pool group and
    // joins the new one: its rows follow the parameter, and a peer that keeps
    // its parameter is not disturbed.
    scenario(
      `pooled-param-change`,
      `a pooled query follows its parameter between pool groups`,
      async () => {
        const source = driver.makeSource(SEED)
        const pool = { pool: pooledLiveQueries }
        const query = (q: any, team: string) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.team, team))
        const moving = driver.mountControllable<string>(query, `a`, pool)
        const peer = driver.mountConfig((q) => query(q, `a`), pool)
        for (const h of [moving, peer]) await h.flush()
        const ids = (h: LiveQueryHandle) =>
          (h.current().data as Array<{ id: string }>).map((row) => row.id)
        expect([ids(moving), ids(peer)]).toEqual([
          [`1`, `3`],
          [`1`, `3`],
        ])
        const shared = driver.features?.pooledEqFilters ? 1 : 2
        expect(source.collection.subscriberCount).toBe(shared)

        // Every value the binding publishes after a switch holds only rows of
        // the new group, or none while it loads; the old group's rows never
        // show again. The driver logs the first paint, so the law cannot
        // pass on an empty log.
        const switchTo = async (
          team: string,
          rows: ReadonlyArray<{ id: string }>,
        ) => {
          const before = moving.publications().length
          await moving.setParam(team)
          const published = moving.publications().slice(before)
          // The keyed state map follows the same law as `data`.
          const states = moving.statePublications().slice(before)
          expect(published.length).toBeGreaterThan(0)
          for (const value of [...published, ...states])
            expectOnlyRowsOf(value, rows)
        }

        await switchTo(`b`, [SEED[1]!])
        await peer.flush()
        expect([ids(moving), ids(peer)]).toEqual([[`2`], [`1`, `3`]])
        expectKeyedRows(moving.current().state, [SEED[1]!])
        expect(source.collection.subscriberCount).toBe(shared)

        source.insert({ id: `4`, name: `Dave`, age: 40, team: `b` })
        for (const h of [moving, peer]) await h.flush()
        expect([ids(moving), ids(peer)]).toEqual([
          [`2`, `4`],
          [`1`, `3`],
        ])

        await switchTo(`a`, [SEED[0]!, SEED[2]!])
        await peer.flush()
        expect([ids(moving), ids(peer)]).toEqual([
          [`1`, `3`],
          [`1`, `3`],
        ])
        for (const h of [moving, peer]) h.unmount()
        await expect
          .poll(() => source.collection.subscriberCount, {
            interval: 5,
            timeout: 500,
          })
          .toBe(0)
      },
    )

    // `pool` takes `pooledLiveQueries`. Any other value, such as the removed
    // boolean form, contradicts the hook contract, so the hook rejects it the
    // same way whatever its other options: beside `gcTime`, which keeps the
    // pooled path, beside `queryKey`, which compiles its own Collection, and
    // on a parameterized query. Authority: AGENTS.md, which requires a
    // contract contradiction to fail at the boundary, not to fall back.
    scenario(
      `invalid-pool`,
      `a hook rejects a pool option that is not pooledLiveQueries`,
      async () => {
        const source = driver.makeSource(SEED)
        const query = (q: any, team: string) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.team, team))
        // `false` is a value an adapter passes to say a hook cannot pool; a
        // config that passes it still breaks the contract. A disabled query
        // has no query to pool, but its config holds the same option.
        for (const invalid of [
          true,
          false,
        ] as Array<unknown> as Array<PooledLiveQueries>)
          for (const mount of [
            () => driver.mountConfig((q) => query(q, `a`), { pool: invalid }),
            () => driver.mountConfig(() => null as any, { pool: invalid }),
            () => driver.mountControllable(() => null, `a`, { pool: invalid }),
            () =>
              driver.mountConfig((q) => query(q, `a`), {
                pool: invalid,
                gcTime: 5,
              }),
            () =>
              driver.mountConfig((q) => query(q, `a`), {
                pool: invalid,
                queryKey: [`teams`, `a`],
              }),
            () => driver.mountControllable(query, `a`, { pool: invalid }),
          ])
            await expectRejection(`InvalidPoolOptionError`, async () => {
              const h = mount()
              await h.flush()
              return h.current()
            })
      },
    )

    // Operator code is part of query identity. A re-render whose groupBy
    // drops `groupKeys()` has no grouping compiler, so it rejects; a binding
    // that compares identity must not keep the grouped query it compiled.
    scenario(
      `grouping-operator-switch`,
      `a re-render that drops groupKeys() rejects instead of keeping the grouped query`,
      async () => {
        const source = driver.makeSource(SEED)
        const team = ({ items }: any) => items.team
        const h = driver.mountControllable<boolean>(
          (q, keys) =>
            q
              .from({ items: source.collection })
              .groupBy(keys ? ops.groupKeys(team) : team)
              .select(({ items }: any) => ({ id: items.team })),
          true,
        )
        await h.flush()
        expectUnorderedRows(h.current().data, [{ id: `a` }, { id: `b` }])
        await expectRejection(
          `QueryCompilationError`,
          async () => {
            await h.setParam(false)
            return h.current()
          },
          /^groupBy\(\) without an aggregate needs groupKeys\(\)/,
        )
        expectNoRowsAfterRejection(h)
      },
    )

    // Any compile error after mount follows the rejection law, not only a
    // missing operator: a select that mixes a source field with an
    // aggregate has no value for one implicit group.
    scenario(
      `compile-error-after-rerender`,
      `a re-render whose query fails to compile rejects and shows no rows`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountControllable<boolean>(
          (q, valid) =>
            q
              .from({ items: source.collection })
              .select(({ items }: any) =>
                valid
                  ? { id: items.id }
                  : { id: items.id, n: ops.count(items.id) },
              ),
          true,
        )
        await h.flush()
        expectUnorderedRows(
          h.current().data,
          SEED.map(({ id }) => ({ id })),
        )
        await expectRejection(
          `GroupByError`,
          async () => {
            await h.setParam(false)
            return h.current()
          },
          /^Non-aggregate expression 'id' must also appear in GROUP BY clause/,
        )
        expectNoRowsAfterRejection(h)
      },
    )

    scenario(`live-insert`, `a sync insert appears in the result`, async () => {
      const source = driver.makeSource(SEED)
      const h = driver.mount((q) =>
        q
          .from({ items: source.collection })
          .select(({ items }: any) => ({ id: items.id })),
      )
      await h.flush()
      expectUnorderedRows(h.current().data, [
        { id: `1` },
        { id: `2` },
        { id: `3` },
      ])

      source.insert({ id: `4`, name: `Dave`, age: 40, team: `b` })
      await h.flush()

      expectUnorderedRows(h.current().data, [
        { id: `1` },
        { id: `2` },
        { id: `3` },
        { id: `4` },
      ])
      h.unmount()
    })

    scenario(
      `live-delete`,
      `a sync delete removes from the result`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()

        source.remove(SEED[0]!)
        await h.flush()

        expectUnorderedRows(h.current().data, [{ id: `2` }, { id: `3` }])
        h.unmount()
      },
    )

    scenario(`orderby`, `orderBy yields rows in sorted order`, async () => {
      const source = driver.makeSource(SEED)
      const h = driver.mount((q) =>
        q
          .from({ items: source.collection })
          .orderBy(({ items }: any) => items.age)
          .select(({ items }: any) => ({ id: items.id })),
      )
      await h.flush()

      expect(h.current().data.map((r: any) => r.id)).toEqual([`2`, `1`, `3`])
      h.unmount()
    })

    // ---- gap-closer: cardinality (matrix: Vue tests this 0 times) --------

    scenario(
      `findone-cardinality`,
      `findOne returns a single row, not an array`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.id, `3`))
            .findOne(),
        )
        await h.flush()

        expect(Array.isArray(h.current().data)).toBe(false)
        expect(h.current().data).toMatchObject({ id: `3`, name: `John Smith` })
        h.unmount()
      },
    )

    // ---- gap-closer: disabled (matrix: Svelte tests this 0 times) --------

    scenario(
      `disabled-explicit`,
      `a disabled query reports isEnabled=false with no data`,
      async () => {
        const h = driver.mountDisabled()
        await h.flush()

        expectDisabledResult(h.current(), driver.disabledRepresentation)
        h.unmount()
      },
    )

    // ---- spine: lifecycle invariant --------------------------------------
    //
    // The reference rule has two ownership classes: adapter-created
    // projections use the short default above; caller-owned collections keep
    // the caller's policy. These traces distinguish teardown after unmount,
    // replacement, and disabling from retention explicitly requested by the
    // caller. Retirement is observed only after subscriberCount reaches zero,
    // which is the public checkpoint at which the retention law applies.

    scenario(
      `no-updates-after-unmount`,
      `no result mutation after unmount`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()
        const before = h.current().data.length

        h.unmount()
        source.insert({ id: `99`, name: `Zed`, age: 1, team: `b` })
        await h.flush()

        expect(h.current().data.length).toBe(before)
      },
    )

    scenario(
      `owned-query-retirement`,
      `adapter-created query and config collections retire after unmount`,
      async () => {
        const source = driver.makeSource(SEED)
        const build = (q: any) => q.from({ items: source.collection })

        for (const h of [driver.mount(build), driver.mountConfig(build)]) {
          await h.flush()
          const collection = h.collection()
          expectAdapterOwnedCollection(collection)

          h.unmount()
          expect(collection.subscriberCount).toBe(0)
          await expectRetired(collection)
        }
      },
    )

    scenario(
      `replaced-query-retirement`,
      `a superseded adapter-created collection retires`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountControllable<number>(
          (q, minAge) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => ops.gt(items.age, minAge)),
          30,
        )
        await h.flush()
        const replaced = h.collection()
        expectAdapterOwnedCollection(replaced)

        await h.setParam(20)
        const replacement = h.collection()
        expectAdapterOwnedCollection(replacement)
        expect(replacement).not.toBe(replaced)
        expect(replaced.subscriberCount).toBe(0)
        await expectRetired(replaced)

        h.unmount()
        expect(replacement.subscriberCount).toBe(0)
        await expectRetired(replacement)
      },
    )

    scenario(
      `caller-owned-query-retention`,
      `explicit retention and supplied collections remain caller-owned`,
      async () => {
        const source = driver.makeSource(SEED)
        const build = (q: any) => q.from({ items: source.collection })
        const explicit = driver.mountConfig(build, { gcTime: 0 })
        await explicit.flush()
        const configured = explicit.collection()
        expect(configured).not.toBeNull()
        expect(configured!.config.gcTime).toBe(0)

        explicit.unmount()
        await explicit.flush()
        expect(configured!.subscriberCount).toBe(0)
        expect(configured!.status).not.toBe(`cleaned-up`)

        const supplied = driver.makePrecreated(build, {
          startSync: true,
          gcTime: 0,
        }).collection
        const mounted = driver.mountCollection(supplied)
        await mounted.flush()
        expect(mounted.collection()).toBe(supplied)

        mounted.unmount()
        await mounted.flush()
        expect(supplied.subscriberCount).toBe(0)
        expect(supplied.status).not.toBe(`cleaned-up`)
      },
    )

    scenario(
      `undefined-retention-is-omitted`,
      `an explicit undefined retention uses the adapter-owned default`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountConfig(
          (q) => q.from({ items: source.collection }),
          { gcTime: undefined },
        )
        await h.flush()
        const collection = h.collection()
        expectAdapterOwnedCollection(collection)

        h.unmount()
        expect(collection.subscriberCount).toBe(0)
        await expectRetired(collection)
      },
    )

    scenario(
      `positive-caller-owned-retention`,
      `a positive caller retention survives before expiry and retires afterward`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountConfig(
          (q) => q.from({ items: source.collection }),
          { gcTime: 100 },
        )
        await h.flush()
        const collection = h.collection()
        expect(collection).not.toBeNull()
        expect(collection!.config.gcTime).toBe(100)

        h.unmount()
        expect(collection!.subscriberCount).toBe(0)
        await wait(20)
        expect(collection!.status).not.toBe(`cleaned-up`)
        await expectRetired(collection!)
      },
    )

    // ---- spine: relational + aggregate queries ---------------------------

    scenario(`join`, `join across two collections`, async () => {
      const people = driver.makeSource(SEED)
      const issues = driver.makeSource(ISSUES)
      const h = driver.mount((q) =>
        q
          .from({ issues: issues.collection })
          .join({ persons: people.collection }, ({ issues: i, persons }: any) =>
            ops.eq(i.userId, persons.id),
          )
          .select(({ issues: i, persons }: any) => ({
            id: i.id,
            title: i.title,
            name: persons.name,
          })),
      )
      await h.flush()

      expectUnorderedRows(h.current().data, [
        { id: `i1`, title: `Issue 1`, name: `John Doe` },
        { id: `i2`, title: `Issue 2`, name: `Jane Doe` },
        { id: `i3`, title: `Issue 3`, name: `John Doe` },
      ])
      h.unmount()
    })

    scenario(
      `groupby-aggregate`,
      `groupBy + count aggregates per group`,
      async () => {
        const people = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: people.collection })
            .groupBy(({ items }: any) => items.team)
            .select(({ items }: any) => ({
              team: items.team,
              count: ops.count(items.id),
            })),
        )
        await h.flush()

        expectUnorderedRows(
          h.current().data,
          [
            { team: `a`, count: 2 },
            { team: `b`, count: 1 },
          ],
          `team`,
        )
        h.unmount()
      },
    )

    // ---- gap-closers: engine features tested only by React today ---------

    scenario(
      `nested-aggregates`,
      `coalesce(count(...), 0) in a joined subquery`,
      async () => {
        const people = driver.makeSource(SEED)
        const issues = driver.makeSource(ISSUES)
        const h = driver.mount((q) => {
          const issueCounts = q
            .from({ issues: issues.collection })
            .groupBy(({ issues: i }: any) => i.userId)
            .select(({ issues: i }: any) => ({
              userId: i.userId,
              issueCount: ops.coalesce(ops.count(i.id), 0),
            }))
          return q
            .from({ persons: people.collection })
            .leftJoin({ ic: issueCounts }, ({ persons, ic }: any) =>
              ops.eq(persons.id, ic.userId),
            )
            .select(({ persons, ic }: any) => ({
              name: persons.name,
              issueCount: ic.issueCount,
            }))
        })
        await h.flush()

        // Coalesce runs inside the grouped subquery: an absent joined group
        // is still undefined, not an invented zero-count group.
        expectUnorderedRows(
          h.current().data,
          [
            { name: `John Doe`, issueCount: 2 },
            { name: `Jane Doe`, issueCount: 1 },
            { name: `John Smith`, issueCount: undefined },
          ],
          `name`,
        )
        h.unmount()
      },
    )

    scenario(
      `includes-subquery`,
      `select with a nested subquery produces child collections`,
      async () => {
        const people = driver.makeSource(SEED)
        const issues = driver.makeSource(ISSUES)
        const h = driver.mount((q) =>
          q.from({ persons: people.collection }).select(({ persons }: any) => ({
            id: persons.id,
            name: persons.name,
            issues: include(
              q
                .from({ issues: issues.collection })
                .where(({ issues: i }: any) => ops.eq(i.userId, persons.id))
                .select(({ issues: i }: any) => ({ id: i.id, title: i.title })),
            ),
          })),
        )
        await h.flush()

        expect(h.current().data).toHaveLength(SEED.length)
        const john = h.current().data.find((r: any) => r.id === `1`)
        // `john.issues` is a child collection; read its contents through the
        // collection API. John (id 1) has issues i1 and i3.
        expect(john.issues).toBeDefined()
        const johnIssueIds = Array.from(john.issues.values())
          .map((i: any) => i.id)
          .sort()
        expect(johnIssueIds).toEqual([`i1`, `i3`])
        expectUnorderedRows(
          h.current().data.map(
            (person: {
              id: string
              name: string
              issues: {
                values: () => Iterable<{ id: string; title: string }>
              }
            }) => ({
              ...selectedRow(person),
              issues: Array.from(person.issues.values())
                .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
                .map(selectedRow),
            }),
          ),
          [
            {
              id: `1`,
              name: `John Doe`,
              issues: [
                { id: `i1`, title: `Issue 1` },
                { id: `i3`, title: `Issue 3` },
              ],
            },
            {
              id: `2`,
              name: `Jane Doe`,
              issues: [{ id: `i2`, title: `Issue 2` }],
            },
            { id: `3`, name: `John Smith`, issues: [] },
          ],
        )
        h.unmount()
      },
    )

    // ---- free ports (no new capability needed) ---------------------------

    scenario(`live-update`, `a sync update is reflected in place`, async () => {
      const source = driver.makeSource(SEED)
      const h = driver.mount((q) =>
        q
          .from({ items: source.collection })
          .select(({ items }: any) => ({ id: items.id, name: items.name })),
      )
      await h.flush()

      source.update({ id: `1`, name: `Johnny Doe`, age: 30, team: `a` })
      await h.flush()

      expect(h.current().data.find((r: any) => r.id === `1`).name).toBe(
        `Johnny Doe`,
      )
      expectUnorderedRows(h.current().data, [
        { id: `1`, name: `Johnny Doe` },
        { id: `2`, name: `Jane Doe` },
        { id: `3`, name: `John Smith` },
      ])
      h.unmount()
    })

    scenario(
      `findone-reactive`,
      `findOne updates in place and becomes undefined on delete`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.id, `3`))
            .findOne(),
        )
        await h.flush()
        expect(h.current().data).toMatchObject({ name: `John Smith` })

        source.update({ id: `3`, name: `Johnny Smith`, age: 35, team: `a` })
        await h.flush()
        expect(h.current().data).toMatchObject({ name: `Johnny Smith` })

        source.remove({ id: `3`, name: `Johnny Smith`, age: 35, team: `a` })
        await h.flush()
        expect(h.current().data ?? undefined).toBeUndefined()
        h.unmount()
      },
    )

    // ---- Tier 2: deferred readiness --------------------------------------

    scenario(
      `isready-transition`,
      `isReady flips from false to true when the source readies`,
      async () => {
        const source = driver.makeDeferredSource()
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()
        expect(h.current().isReady).toBe(false)

        source.markReady()
        await h.flush()
        expect(h.current().isReady).toBe(true)
        h.unmount()
      },
    )

    scenario(
      `eager-visible-while-loading`,
      `rows emitted before ready are visible while still loading`,
      async () => {
        const source = driver.makeDeferredSource<Row>()
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()

        source.emit(SEED)
        await h.flush()

        expect(h.current().isReady).toBe(false)
        expect(h.current().data).toHaveLength(SEED.length)

        source.markReady()
        await h.flush()
        expect(h.current().isReady).toBe(true)
        h.unmount()
      },
    )

    scenario(
      `isready-no-data`,
      `isReady becomes true even when the source readies with no rows`,
      async () => {
        const source = driver.makeDeferredSource()
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()

        source.markReady()
        await h.flush()

        expect(h.current().isReady).toBe(true)
        expect(h.current().data ?? []).toHaveLength(0)
        h.unmount()
      },
    )

    // ---- Tier 2: initial readiness over a lagging on-demand source -------
    //
    // Law (ARCHITECTURE.md law 10): a query is initially ready when every
    // request it made to an on-demand source has settled. That source's own
    // Collection readiness does not gate it. The checkpoint after `settle`,
    // while the source is still `loading`, separates this law from the rule
    // that waits for every source to be ready. Once ready, the query stays
    // ready, and later source changes still reach it.

    scenario(
      `lagging-source-ready-at-settle`,
      `an on-demand query is ready when its subset settles, before the source is ready`,
      async () => {
        const source = driver.makeLaggingSource<Row>()
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.id, `1`))
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()
        expect(source.loadStarted()).toBe(true)

        // Delivered rows are visible, but an unsettled request is not evidence.
        source.emit([SEED[0]!])
        await h.flush()
        expect(h.current().isReady).toBe(false)

        source.settle()
        await h.flush()
        expect(source.collection.status).toBe(`loading`)
        expect(h.current().isReady).toBe(true)
        expect(h.current().status).toBe(`ready`)
        expectUnorderedRows(h.current().data, [{ id: `1`, name: `John Doe` }])

        source.markReady()
        source.update({ ...SEED[0]!, name: `Johnny Doe` })
        await h.flush()
        expect(h.current().isReady).toBe(true)
        expectUnorderedRows(h.current().data, [{ id: `1`, name: `Johnny Doe` }])
        h.unmount()
      },
    )

    scenario(
      `lagging-source-findone-ready-at-settle`,
      `a findOne query over an on-demand source is ready when its subset settles`,
      async () => {
        const source = driver.makeLaggingSource<Row>()
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.id, `1`))
            .findOne(),
        )
        await h.flush()
        expect(source.loadStarted()).toBe(true)

        source.emit([SEED[0]!])
        await h.flush()
        expect(h.current().isReady).toBe(false)

        source.settle()
        await h.flush()
        expect(source.collection.status).toBe(`loading`)
        expect(h.current().isReady).toBe(true)
        expect(h.current().data).toMatchObject({ id: `1`, name: `John Doe` })

        source.markReady()
        source.update({ ...SEED[0]!, name: `Johnny Doe` })
        await h.flush()
        expect(h.current().isReady).toBe(true)
        expect(h.current().data).toMatchObject({ id: `1`, name: `Johnny Doe` })
        h.unmount()
      },
    )

    // ---- Tier 2: controllable input --------------------------------------

    scenario(
      `param-recompile`,
      `changing a query parameter recompiles the result`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountControllable<number>(
          (q, minAge) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => ops.gt(items.age, minAge))
              .select(({ items }: any) => ({ id: items.id })),
          30,
        )
        await h.flush()
        expectUnorderedRows(h.current().data, [{ id: `3` }])

        await h.setParam(20)
        expectUnorderedRows(h.current().data, [
          { id: `1` },
          { id: `2` },
          { id: `3` },
        ])

        await h.setParam(50)
        expectUnorderedRows(h.current().data, [])
        h.unmount()
      },
    )

    scenario(
      `recompile-drops-stale-keys`,
      `recompiling to a narrower result drops keys from the previous collection`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountControllable<number>(
          (q, minAge) =>
            q
              .from({ items: source.collection })
              .where(({ items }: any) => ops.gt(items.age, minAge))
              .select(({ items }: any) => ({ id: items.id })),
          10,
        )
        await h.flush()
        expectUnorderedRows(h.current().data, [
          { id: `1` },
          { id: `2` },
          { id: `3` },
        ])
        // The keyed `state` map must mirror `data` exactly.
        expectKeyedRows(h.current().state, [
          { id: `1` },
          { id: `2` },
          { id: `3` },
        ])

        // Narrowing the filter recompiles into a *new* underlying collection
        // holding fewer keys. `includeInitialState` only inserts the new rows;
        // if the adapter reuses a persistent keyed map without clearing it, the
        // dropped keys leak into `state` even though `data` looks correct.
        await h.setParam(32) // only John Smith (age 35) survives
        expectUnorderedRows(h.current().data, [{ id: `3` }])
        expectKeyedRows(h.current().state, [{ id: `3` }])
        h.unmount()
      },
    )

    scenario(
      `disabled-transition`,
      `disabled -> enabled -> disabled toggles correctly`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountControllable<boolean>(
          (q, enabled) =>
            enabled
              ? q
                  .from({ items: source.collection })
                  .select(({ items }: any) => ({ id: items.id }))
              : null,
          false,
        )
        await h.flush()
        expectDisabledResult(h.current(), driver.disabledRepresentation)

        await h.setParam(true)
        expect(h.current().isEnabled).toBe(true)
        expect(h.current().data).toHaveLength(SEED.length)
        expectUnorderedRows(
          h.current().data,
          SEED.map(({ id }) => ({ id })),
        )
        expectKeyedRows(
          h.current().state,
          SEED.map(({ id }) => ({ id })),
        )
        const enabledCollection = h.collection()
        expectAdapterOwnedCollection(enabledCollection)

        await h.setParam(false)
        expectDisabledResult(h.current(), driver.disabledRepresentation)
        expect(enabledCollection.subscriberCount).toBe(0)
        await expectRetired(enabledCollection)
        h.unmount()
      },
    )

    // ---- Tier 2: query identity (1.0 law; see contract.ts) ---------------
    //
    // Each scenario runs one history and branches only on the driver's public
    // `comparesQueryIdentity` policy: a comparing binding rejects, and a
    // reactive binding publishes the current input's rows. Both branches
    // check rows, so a reactive binding that kept the old source's rows fails
    // as surely as a comparing binding that accepted the swap.

    // `fn.where` runs a JavaScript predicate, so its IR has no stable hash.
    const olderThan = (source: { collection: any }, age: number) => (q: any) =>
      q
        .from({ items: source.collection })
        .fn.where(({ items }: any) => items.age > age)
        .select(({ items }: any) => ({ id: items.id }))
    const idsOf = (rows: ReadonlyArray<{ id: string }>) =>
      rows.map(({ id }) => ({ id }))
    const comparesIdentity = driver.comparesQueryIdentity

    scenario(
      `unhashable-query`,
      `a query without a stable IR identity needs queryKey only where the binding compares identity`,
      async () => {
        const source = driver.makeSource(SEED)
        const build = olderThan(source, 26)
        for (const mount of [
          () => driver.mount(build),
          () => driver.mountConfig(build),
        ]) {
          if (comparesIdentity) {
            await expectRejection(`UnhashableQueryIRError`, async () => {
              const h = mount()
              await h.flush()
              return h.current()
            })
          } else {
            const h = mount()
            await h.flush()
            expectUnorderedRows(h.current().data, [{ id: `1` }, { id: `3` }])
            h.unmount()
          }
        }
        if (!comparesIdentity) {
          // An empty key counts as none, so it changes nothing here either.
          const h = driver.mountConfig(build, { queryKey: [] })
          await h.flush()
          expectUnorderedRows(h.current().data, [{ id: `1` }, { id: `3` }])
          h.unmount()
        }
        if (comparesIdentity) {
          // An empty key is absent, as it is for a DbClient preload, so the
          // query still needs a derived identity.
          await expectRejection(`UnhashableQueryIRError`, async () => {
            const h = driver.mountConfig(build, { queryKey: [] })
            await h.flush()
            return h.current()
          })
          // A queryKey owns the identity, so the same query runs.
          const h = driver.mountConfig(build, { queryKey: [`older-than`, 26] })
          await h.flush()
          expectUnorderedRows(h.current().data, [{ id: `1` }, { id: `3` }])
          h.unmount()
        }
      },
    )

    scenario(
      `unhashable-recompile`,
      `recompiling to a query without a stable IR identity follows the binding's identity policy`,
      async () => {
        const source = driver.makeSource(SEED)
        // `null` selects the structured query; a number, the functional one.
        const h = driver.mountControllable<number | null>(
          (q, age) =>
            age === null
              ? q
                  .from({ items: source.collection })
                  .select(({ items }: any) => ({ id: items.id }))
              : olderThan(source, age)(q),
          null,
        )
        await h.flush()
        expectUnorderedRows(h.current().data, idsOf(SEED))
        if (comparesIdentity) {
          await expectRejection(`UnhashableQueryIRError`, async () => {
            await h.setParam(26)
            return h.current()
          })
          expectNoRowsAfterRejection(h)
          return
        }
        // A changed captured value recompiles, though no identity names it.
        await h.setParam(26)
        expectUnorderedRows(h.current().data, [{ id: `1` }, { id: `3` }])
        await h.setParam(32)
        expectUnorderedRows(h.current().data, [{ id: `3` }])
        h.unmount()
      },
    )

    scenario(
      `source-id-reuse`,
      `a different source under a Collection ID the binding read is rejected or read as the new source`,
      async () => {
        // Claim memory grammar. A history mounts one controllable binding on
        // A(x) or C(y), then applies two actions. An action selects A(x), B(x)
        // (another object under A's ID), C(y), or D, which disables the query.
        // The model judges each step from the history alone, pairwise and
        // independent of production: in a comparing binding, a step rejects
        // when an earlier step of the same binding read another object under
        // its ID, and the rejection ends the history because the failed hook
        // unmounts. A reactive binding never rejects and shows the rows of
        // the source the step selects.
        const sourcesByPick = {
          A: driver.makeSource(SEED),
          C: driver.makeSource([
            { id: `9`, name: `Other`, age: 40, team: `c` },
          ]),
        }
        const reused = driver.makeSource(
          [{ id: `8`, name: `Reused`, age: 50, team: `d` }],
          sourcesByPick.A.collection.id,
        )
        expect(reused.collection).not.toBe(sourcesByPick.A.collection)
        type Pick = `A` | `B` | `C` | `D`
        const objectOf = (pick: Exclude<Pick, `D`>) =>
          pick === `B` ? reused : sourcesByPick[pick]
        const rowsOf: Record<Exclude<Pick, `D`>, Array<{ id: string }>> = {
          A: idsOf(SEED),
          B: [{ id: `8` }],
          C: [{ id: `9` }],
        }
        const collides = (history: ReadonlyArray<Pick>, next: Pick) =>
          next !== `D` &&
          history.some(
            (prior) =>
              prior !== `D` &&
              prior !== next &&
              objectOf(prior).collection.id === objectOf(next).collection.id,
          )
        // Declared reach: the states where a claim must outlive the query
        // that made it.
        const reach = createOracleReach<ReachState>(`source-id claim memory`, [
          `swap after an intervening query`,
          `swap after a disabled step`,
          `revisit after an intervening query`,
        ])
        type ReachState =
          | `swap after an intervening query`
          | `swap after a disabled step`
          | `revisit after an intervening query`
        // A state names what lies between the step that made a claim and the
        // step that tests it, so a direct swap or a revisit after only a
        // disabled step does not count as an intervening query.
        const reachedState = (
          history: ReadonlyArray<Pick>,
          next: Pick,
        ): ReachState | undefined => {
          if (next === `D`) return undefined
          const lastIndex = (match: (pick: Pick) => boolean) => {
            for (let index = history.length - 1; index >= 0; index--) {
              if (match(history[index]!)) return index
            }
            return -1
          }
          const between = (index: number) => history.slice(index + 1)
          const conflict = lastIndex(
            (prior) =>
              prior !== `D` &&
              prior !== next &&
              objectOf(prior).collection.id === objectOf(next).collection.id,
          )
          if (conflict >= 0) {
            const steps = between(conflict)
            if (steps.some((pick) => pick !== `D`)) {
              return `swap after an intervening query`
            }
            return steps.includes(`D`)
              ? `swap after a disabled step`
              : undefined
          }
          const revisit = lastIndex((prior) => prior === next)
          return revisit >= 0 &&
            between(revisit).some((pick) => pick !== `D` && pick !== next)
            ? `revisit after an intervening query`
            : undefined
        }
        // Keyed dimension (comparing bindings only). A step may name its
        // source through a nonempty queryKey: AK reads A(x) and BK reads B(x)
        // under their own keys. A keyed step records no claim and checks
        // none, so a claim made before it still binds a later derived step.
        type KeyedPick = Pick | `AK` | `BK`
        const objectOfKeyed = (pick: Exclude<KeyedPick, `D`>) =>
          pick === `AK`
            ? objectOf(`A`)
            : pick === `BK`
              ? objectOf(`B`)
              : objectOf(pick)
        const rowsOfKeyed = (pick: Exclude<KeyedPick, `D`>) =>
          rowsOf[pick === `AK` ? `A` : pick === `BK` ? `B` : pick]
        const isKeyed = (pick: KeyedPick) => pick === `AK` || pick === `BK`
        const keyedCollides = (
          history: ReadonlyArray<KeyedPick>,
          next: KeyedPick,
        ) =>
          next !== `D` &&
          !isKeyed(next) &&
          history.some(
            (prior) =>
              prior !== `D` &&
              !isKeyed(prior) &&
              objectOfKeyed(prior) !== objectOfKeyed(next) &&
              objectOfKeyed(prior).collection.id ===
                objectOfKeyed(next).collection.id,
          )
        type KeyedReachState =
          `claim crosses a keyed step` | `keyed step after a claim`
        const keyedReach = createOracleReach<KeyedReachState>(
          `source-id claim memory with keys`,
          [`claim crosses a keyed step`, `keyed step after a claim`],
        )
        const runKeyedClaimGrammar = async () => {
          const mountKeyed = driver.mountKeyedControllable
          // Every comparing driver supplies the keyed form.
          expect(mountKeyed).toBeDefined()
          const keyedPicks: ReadonlyArray<KeyedPick> = [
            `A`,
            `B`,
            `C`,
            `D`,
            `AK`,
            `BK`,
          ]
          for (const first of [`A`, `C`, `AK`] as const) {
            for (const second of keyedPicks) {
              for (const third of keyedPicks) {
                keyedReach.beginHistory()
                const history: Array<KeyedPick> = [first]
                const h = mountKeyed!<KeyedPick>(
                  (q, pick) =>
                    pick === `D`
                      ? null
                      : q
                          .from({ items: objectOfKeyed(pick).collection })
                          .select(({ items }: any) => ({ id: items.id })),
                  (pick) => (isKeyed(pick) ? [`keyed`, pick] : undefined),
                  first,
                )
                await h.flush()
                expectUnorderedRows(h.current().data, rowsOfKeyed(first))
                for (const next of [second, third]) {
                  const sameIdPriors = history.filter(
                    (prior) =>
                      prior !== `D` &&
                      next !== `D` &&
                      objectOfKeyed(prior) !== objectOfKeyed(next) &&
                      objectOfKeyed(prior).collection.id ===
                        objectOfKeyed(next).collection.id,
                  )
                  // A claim crosses a keyed step when a keyed step lies
                  // between the claiming step and the step it binds.
                  let claimIndex = -1
                  for (let index = history.length - 1; index >= 0; index--) {
                    const prior = history[index]!
                    if (
                      prior !== `D` &&
                      !isKeyed(prior) &&
                      next !== `D` &&
                      !isKeyed(next) &&
                      objectOfKeyed(prior) !== objectOfKeyed(next) &&
                      objectOfKeyed(prior).collection.id ===
                        objectOfKeyed(next).collection.id
                    ) {
                      claimIndex = index
                      break
                    }
                  }
                  if (
                    claimIndex >= 0 &&
                    history.slice(claimIndex + 1).some(isKeyed)
                  ) {
                    keyedReach.reach(`claim crosses a keyed step`)
                  }
                  if (
                    isKeyed(next) &&
                    sameIdPriors.some((prior) => !isKeyed(prior))
                  ) {
                    keyedReach.reach(`keyed step after a claim`)
                  }
                  if (keyedCollides(history, next)) {
                    await expectRejection(
                      `SourceCollectionIdReuseError`,
                      async () => {
                        await h.setParam(next)
                        return h.current()
                      },
                    )
                    expectNoRowsAfterRejection(h)
                    break
                  }
                  await h.setParam(next)
                  history.push(next)
                  if (next === `D`) {
                    expectDisabledResult(
                      h.current(),
                      driver.disabledRepresentation,
                    )
                  } else {
                    expectUnorderedRows(h.current().data, rowsOfKeyed(next))
                  }
                }
                h.unmount()
              }
            }
          }
          keyedReach.assertReached()
        }
        const picks: ReadonlyArray<Pick> = [`A`, `B`, `C`, `D`]
        for (const first of [`A`, `C`] as const) {
          for (const second of picks) {
            for (const third of picks) {
              reach.beginHistory()
              const history: Array<Pick> = [first]
              const h = driver.mountControllable<Pick>(
                (q, pick) =>
                  pick === `D`
                    ? null
                    : q
                        .from({ items: objectOf(pick).collection })
                        .select(({ items }: any) => ({ id: items.id })),
                first,
              )
              await h.flush()
              expectUnorderedRows(h.current().data, rowsOf[first])
              for (const next of [second, third]) {
                const state = reachedState(history, next)
                if (state) reach.reach(state)
                if (comparesIdentity && collides(history, next)) {
                  await expectRejection(
                    `SourceCollectionIdReuseError`,
                    async () => {
                      await h.setParam(next)
                      return h.current()
                    },
                  )
                  expectNoRowsAfterRejection(h)
                  break
                }
                const published = h.publications().length
                await h.setParam(next)
                if (collides(history, next)) {
                  // A reactive binding read the swap as a new source: every
                  // value it published since then holds only the new
                  // source's rows, or none while it loads.
                  const swapped = h.publications().slice(published)
                  // The driver logs the first paint, so the law cannot pass
                  // on an empty log.
                  expect(swapped.length).toBeGreaterThan(0)
                  for (const value of swapped) {
                    expectOnlyRowsOf(value, rowsOf[next as Exclude<Pick, `D`>])
                  }
                }
                history.push(next)
                if (next === `D`) {
                  expectDisabledResult(
                    h.current(),
                    driver.disabledRepresentation,
                  )
                } else {
                  expectUnorderedRows(h.current().data, rowsOf[next])
                }
              }
              h.unmount()
            }
          }
        }
        reach.assertReached()

        if (comparesIdentity) await runKeyedClaimGrammar()

        // A new binding starts with no claims.
        const fresh = driver.mount((q) =>
          q
            .from({ items: reused.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await fresh.flush()
        expectUnorderedRows(fresh.current().data, [{ id: `8` }])
        fresh.unmount()
      },
      // 32 histories of three steps each, and 108 keyed histories for a
      // comparing binding.
      60_000,
    )

    scenario(
      `source-id-reuse-in-one-query`,
      `a query that reads two sources under one Collection ID is rejected or reads both`,
      async () => {
        // The objects hold overlapping but different rows, so a binding that
        // read either object for both sides would publish another id set.
        const first = driver.makeSource(SEED)
        const reused = driver.makeSource(
          [...SEED.slice(1), { id: `4`, name: `Fourth`, age: 45, team: `b` }],
          first.collection.id,
        )
        const build = (q: any) =>
          q
            .from({ left: first.collection })
            .join(
              { right: reused.collection },
              ({ left, right }: any) => ops.eq(left.id, right.id),
              `inner`,
            )
            .select(({ left }: any) => ({ id: left.id }))
        if (comparesIdentity) {
          await expectRejection(`SourceCollectionIdReuseError`, async () => {
            const h = driver.mount(build)
            await h.flush()
            return h.current()
          })
          return
        }
        const h = driver.mount(build)
        await h.flush()
        // The inner join matches only ids both objects hold: 2 and 3. Reading
        // the first object for both sides gives 1-3; the second gives 2-4.
        expectUnorderedRows(h.current().data, [{ id: `2` }, { id: `3` }])
        h.unmount()
      },
    )

    // ---- Tier 2: optimistic mutation -------------------------------------

    scenario(
      `optimistic-insert`,
      `optimistic insert is visible immediately, then reconciles to the server key`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id })),
        )
        await h.flush()

        const temp: Row = { id: `temp`, name: `New`, age: 20, team: `c` }
        const perm: Row = { id: `p9`, name: `New`, age: 20, team: `c` }
        // The "server" confirms only when we release it, so the optimistic
        // window is deterministic rather than racing the settle.
        let confirmServer!: () => void
        const serverConfirmed = new Promise<void>((resolve) => {
          confirmServer = resolve
        })
        lifetime!.defer(confirmServer)
        const add = ops.createOptimisticAction({
          onMutate: () => source.collection.insert(temp),
          mutationFn: async () => {
            await serverConfirmed
            source.remove(temp)
            source.insert(perm)
          },
        })

        let tx!: { isPersisted: { promise: Promise<any> } }
        await h.apply(() => {
          tx = add()
          void tx.isPersisted.promise.catch(() => undefined)
          lifetime!.defer(() => tx.isPersisted.promise)
        })
        // Optimistic row is visible before the server confirms.
        expect(h.current().data.find((r: any) => r.id === `temp`)).toBeDefined()

        confirmServer()
        await tx.isPersisted.promise
        await h.flush()
        // Reconciled: temp replaced by the permanent key.
        expect(
          h.current().data.find((r: any) => r.id === `temp`),
        ).toBeUndefined()
        expect(h.current().data.find((r: any) => r.id === `p9`)).toBeDefined()
        h.unmount()
      },
    )

    // ---- Tier 3: input variants + error status ---------------------------

    scenario(
      `precreated-collection-ready`,
      `accepts a pre-created (syncing) live-query collection`,
      async () => {
        const source = driver.makeSource(SEED)
        const pre = driver.makePrecreated(
          (q) =>
            q
              .from({ items: source.collection })
              .select(({ items }: any) => ({ id: items.id })),
          { startSync: true },
        )
        const h = driver.mountCollection(pre.collection)
        await h.flush()

        expect(h.current().isReady).toBe(true)
        expect(h.current().data).toHaveLength(SEED.length)
        h.unmount()
      },
    )

    scenario(
      `precreated-not-syncing-isready-false`,
      `a pre-created collection over a not-ready source reports isReady=false`,
      async () => {
        // Both the live query (startSync: false) and its source are not ready.
        // Even if the adapter eagerly starts the collection on mount, it cannot
        // become ready because the source never readies — so isReady stays false.
        const source = driver.makeDeferredSource()
        const pre = driver.makePrecreated(
          (q) =>
            q
              .from({ items: source.collection })
              .select(({ items }: any) => ({ id: items.id })),
          { startSync: false },
        )
        const h = driver.mountCollection(pre.collection)
        await h.flush()
        expect(h.current().isReady).toBe(false)
        h.unmount()
      },
    )

    scenario(
      `config-object-input`,
      `accepts the { query } config-object input form`,
      async () => {
        const source = driver.makeSource(SEED)
        const h = driver.mountConfig((q) =>
          q
            .from({ items: source.collection })
            .where(({ items }: any) => ops.eq(items.id, `3`))
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()

        expectUnorderedRows(h.current().data, [{ id: `3`, name: `John Smith` }])
        h.unmount()
      },
    )

    scenario(
      `error-status`,
      `a failing source surfaces an error (flag or boundary)`,
      async () => {
        const source = driver.makeErrorSource()
        // Source ownership is registered before judging a failed setup.
        expect(source.startup.returned, `source startup threw`).toBe(false)
        if (!source.startup.returned)
          expect(source.startup.error, `intended source startup error`).toBe(
            source.expectedError,
          )
        const h = driver.mountCollection(source.collection)
        await h.flush()

        if (driver.errorSurface === `throw`) {
          // Boundary model: reading the errored result throws (for an error
          // boundary to catch), rather than exposing a readable flag.
          expect(() => h.current()).toThrow()
        } else {
          expect(h.current().status).toBe(`error`)
          expect(h.current().isError).toBe(true)
        }
        h.unmount()
      },
    )

    // ---- tail: universal expected-fail ---------------------------

    scenario(
      `order-only-move`,
      `an order-only move republishes the ordered result`,
      async () => {
        const source = driver.makeSource(SEED)
        // Project only id+name; sort by age. Changing age reorders the result
        // WITHOUT changing any projected row value.
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.age)
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()
        const first = h.current().data.map((r: any) => r.id) // ['2','1','3']
        expectOrderedRows(h.current().data, [
          { id: `2`, name: `Jane Doe` },
          { id: `1`, name: `John Doe` },
          { id: `3`, name: `John Smith` },
        ])

        source.update({ id: `2`, name: `Jane Doe`, age: 99, team: `b` })
        await h.flush()

        expect(h.current().data.map((r: any) => r.id)).not.toEqual(first)
        expectOrderedRows(h.current().data, [
          { id: `1`, name: `John Doe` },
          { id: `3`, name: `John Smith` },
          { id: `2`, name: `Jane Doe` },
        ])
        h.unmount()
      },
    )

    it(`registers every distinct scenario without whole-test waivers`, () => {
      expect(registry.size).toBe(46)
    })
  })
}
