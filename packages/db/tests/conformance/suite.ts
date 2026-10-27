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
 * no-data, initial readiness over a lagging on-demand source, Collection
 * sync errors after readiness, param recompilation, optimistic mutation, pre-created & config-object
 * inputs, error status, and order-only moves.
 */
import { describe, expect, it } from 'vitest'
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
import type {
  ConformanceStatusSurface,
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
    makeSource: (data) => sources!.track(rawDriver.makeSource(data)),
    makeDeferredSource: <T extends { id: string }>() =>
      sources!.track(rawDriver.makeDeferredSource<T>()),
    makeLaggingSource: <T extends { id: string }>() =>
      sources!.track(rawDriver.makeLaggingSource<T>()),
    makeSyncSource: <T extends { id: string }>(data: ReadonlyArray<T>) =>
      sources!.track(rawDriver.makeSyncSource<T>(data)),
    makePrecreated: (build, options) =>
      sources!.track(rawDriver.makePrecreated(build, options)),
    makeErrorSource: (kind) => sources!.track(rawDriver.makeErrorSource(kind)),
    mount: (build) => track(rawDriver.mount(build)),
    mountControllable: (build, initial) =>
      track(rawDriver.mountControllable(build, initial)),
    mountCollection: (collection) =>
      track(rawDriver.mountCollection(collection)),
    mountConfig: (build, options) =>
      track(rawDriver.mountConfig(build, options)),
    mountDisabled: () => track(rawDriver.mountDisabled()),
  }

  /** Register one unique law. */
  const scenario = (
    key: string,
    name: string,
    fn: () => Promise<void> | void,
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
    it(label, run)
  }

  describe(`live-query conformance :: ${driver.name}`, () => {
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
        const teamA = driver.mount(query(`a`))
        const teamB = driver.mount(query(`b`))
        const olderA = driver.mount((q) =>
          query(`a`)(q).where(({ items }: any) => ops.eq(items.age, 35)),
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
            issues: q
              .from({ issues: issues.collection })
              .where(({ issues: i }: any) => ops.eq(i.userId, persons.id))
              .select(({ issues: i }: any) => ({ id: i.id, title: i.title })),
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

    // A failed first load and a crash both stop a fresh mount from showing
    // data, and they need different handling: a failed first load is
    // `status: 'error'` (`isLoadingError`), recovered by a new sync run; a
    // crash is `status: 'crashed'` (`isCrashed`), permanent for the Collection
    // instance (docs/guides/error-handling.md "Status" and "When a Collection
    // crashes"; glossary "loading error" and "crash"). Both explain
    // themselves on the mounted Collection's node with the exact error the
    // source produced.
    //
    // A driver whose `errorSurface` is `throw` reads `data` through an error
    // boundary, so reading the failed result throws. Its flags stay readable
    // through `statusSurface` and are judged by the same law: a boundary
    // that receives the failure does not license a wrong `isCrashed` or
    // `isLoadingError`.
    const failureSurface = (h: LiveQueryHandle) => {
      if (driver.errorSurface !== `throw`) return h.current()
      expect(() => h.current(), `reading a failed result throws`).toThrow()
      expect(
        h.statusSurface,
        `a throw-surface driver reads its flags without data`,
      ).toBeDefined()
      return h.statusSurface!()
    }
    const expectFailureFlags = (
      result: ConformanceStatusSurface,
      kind: `fail` | `crash`,
    ) => {
      expect(result.status).toBe(kind === `fail` ? `error` : `crashed`)
      expect(result.isLoadingError, `isLoadingError`).toBe(kind === `fail`)
      expect(result.isCrashed, `isCrashed`).toBe(kind === `crash`)
      expect(result.isReady).toBe(false)
      expect(result.isSyncError).toBe(false)
      expect(result.health?.hasErrors).toBe(true)
    }
    for (const kind of [`fail`, `crash`] as const) {
      scenario(
        kind === `fail` ? `error-status` : `crashed-status`,
        kind === `fail`
          ? `a source whose first load fails surfaces a loading error (flag or boundary)`
          : `a crashed source surfaces a crash (flag or boundary)`,
        async () => {
          const source = driver.makeErrorSource(kind)
          // Source ownership is registered before judging a failed setup.
          // Only a crash makes startup throw.
          expect(source.startup.returned, `source startup returned`).toBe(
            kind === `fail`,
          )
          if (!source.startup.returned)
            expect(source.startup.error, `intended source startup error`).toBe(
              source.expectedError,
            )
          const h = driver.mountCollection(source.collection)
          await h.flush()

          const result = failureSurface(h)
          expectFailureFlags(result, kind)
          expect(result.health?.failureReason).toBeNull()
          expect(result.health?.error).toMatchObject({
            message: source.expectedError.message,
          })
          // The binding exposes the exact value the source failed with.
          expect(result.health?.error?.cause).toBe(source.expectedError)
          h.unmount()
        },
      )
    }

    // The same law when the failure arrives while the binding waits for the
    // first load, the window a Suspense resource or a pending preload spans:
    // the mounted query shows `loading`, then its source fails its first
    // load or crashes. The source is a loading Collection, failed through
    // the Collection side of the adapter's `fail()` or crashed the way core
    // crashes it after an IndexedDB closure or a failed restore. A query
    // takes its source's worst status before its initial-query readiness
    // (ARCHITECTURE.md law 16), so mounting the source directly and mounting
    // a live query over it must both end in that status, and the source's
    // node carries the exact cause (law 17: a node mirrors its Collection).
    for (const kind of [`fail`, `crash`] as const) {
      for (const shape of [`collection`, `query`] as const) {
        scenario(
          `${kind === `fail` ? `error` : `crashed`}-status-during-first-load-${shape}`,
          `a ${kind === `fail` ? `failed first load` : `crash`} while the ${shape} waits for its first load surfaces ${kind === `fail` ? `a loading error` : `a crash`}`,
          async () => {
            const source = driver.makeDeferredSource<Row>()
            const expectedError = new Error(
              `conformance: ${kind} in first load`,
            )
            const h =
              shape === `collection`
                ? driver.mountCollection(source.collection)
                : driver.mount((q) => q.from({ items: source.collection }))
            await h.flush()
            const waiting = h.statusSurface?.() ?? h.current()
            expect(waiting.status, `before the failure`).toBe(`loading`)

            const lifecycle = (
              source.collection as unknown as {
                _lifecycle: {
                  fail: (error: unknown) => void
                  crash: (error: unknown) => void
                }
              }
            )._lifecycle
            if (kind === `fail`) lifecycle.fail(expectedError)
            else lifecycle.crash(expectedError)
            await h.flush()

            const result = failureSurface(h)
            expectFailureFlags(result, kind)
            const sourceNode =
              shape === `collection` ? result.health : result.health?.sources[0]
            expect(sourceNode?.error?.cause, `source node cause`).toBe(
              expectedError,
            )
            h.unmount()
          },
        )
      }
    }

    // ---- sync problems after readiness -------------------------------
    // After readiness a sync problem never changes status, rows, or the
    // load flags. It appears only in the health tree, on the source alias's
    // node, and sets `isSyncError`. `reportError()` sets the node's
    // `failureReason` and `reportHealthy()` clears it; `fail()` sets its
    // `error`, which only a new sync run clears, and after it every report
    // from the sync adapter throws. The tree keeps its object identity until
    // its content changes (ARCHITECTURE.md laws 16 and 17,
    // docs/contributing/designs/source-failure-and-health/error-surface).
    //
    // The model below is the whole expectation: one optional problem with a
    // field, its frame of failures (oldest first), and a serial number. The
    // problem shows its newest failure and lists the frame in `errors`
    // (maintainer decision): each `reportError()` adds a failure, and
    // `fail()` is one failure for the sync run. A report is a new serial, so
    // the tree must be a new object; a call that changes nothing keeps the
    // serial, so the tree must be the same object. Row writes do not touch
    // the model. Each step is observed after the driver's `flush` cut.
    scenario(
      `sync-errors-after-readiness`,
      `sync problems after readiness appear only in the health tree`,
      async () => {
        type Problem = {
          field: `failureReason` | `error`
          causes: Array<Error>
          serial: number
        }
        let problem: Problem | null = null
        let serial = 0
        const stopped = () => problem?.field === `error`

        const source = driver.makeSyncSource(SEED)
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()
        let rows = SEED.map(({ id, name }) => ({ id, name }))
        let previous: { tree: unknown; serial: number | null } | undefined

        const observe = (step: string) => {
          const result = h.current()
          const tree = result.health
          expect(result.status, step).toBe(`ready`)
          expect(
            result.isLoadingError,
            `${step}: isLoadingError is the first load`,
          ).toBe(false)
          expect(result.isSyncError, `${step}: isSyncError`).toBe(
            problem !== null,
          )
          expectUnorderedRows(result.data, rows)
          expect(tree, step).toBeDefined()
          const node = tree!.sources.find(({ alias }) => alias === `items`)
          const shown = (
            info:
              | { message: string; errors: ReadonlyArray<{ message: string }> }
              | null
              | undefined,
          ) =>
            info
              ? {
                  message: info.message,
                  errors: info.errors.map(({ message }) => message),
                }
              : null
          const expected = (field: Problem[`field`]) =>
            problem?.field === field
              ? {
                  message: problem.causes.at(-1)!.message,
                  errors: problem.causes.map(({ message }) => message),
                }
              : null
          expect(
            {
              rootError: tree!.error,
              hasErrors: tree!.hasErrors,
              node: node && {
                kind: node.kind,
                status: node.status,
                failureReason: shown(node.failureReason),
                error: shown(node.error),
              },
            },
            step,
          ).toEqual({
            rootError: null,
            hasErrors: problem !== null,
            node: {
              kind: `source`,
              status: `ready`,
              failureReason: expected(`failureReason`),
              error: expected(`error`),
            },
          })
          // The binding exposes the exact values the sync adapter reported.
          const info = node?.failureReason ?? node?.error
          expect(info?.cause, `${step}: error cause`).toBe(
            problem?.causes.at(-1),
          )
          expect(
            info?.errors.every(
              (failure, at) => failure.cause === problem?.causes[at],
            ) ?? true,
            `${step}: each listed failure is the reported value`,
          ).toBe(true)
          const current = { tree, serial: problem?.serial ?? null }
          if (previous) {
            if (previous.serial === current.serial)
              expect(tree, `${step}: unchanged tree keeps identity`).toBe(
                previous.tree,
              )
            else
              expect(tree, `${step}: changed tree is a new object`).not.toBe(
                previous.tree,
              )
          }
          previous = current
        }

        observe(`ready`)
        await h.flush()
        observe(`a flush without changes`)

        source.insert({ id: `4`, name: `Dave`, age: 40, team: `b` })
        rows = [...rows, { id: `4`, name: `Dave` }]
        await h.flush()
        observe(`a row write`)

        // Each step either applies to the model or, after fail(), throws.
        const steps: Array<[string, () => void]> = [
          [
            `a failure reason`,
            () => {
              const stalled = new Error(`stream stalled`)
              source.reportError(stalled)
              problem = {
                field: `failureReason`,
                causes: [stalled],
                serial: ++serial,
              }
            },
          ],
          [
            `a second failure reason joins the list`,
            () => {
              const retried = new Error(`retry failed`)
              source.reportError(retried)
              problem = {
                field: `failureReason`,
                causes: [...problem!.causes, retried],
                serial: ++serial,
              }
            },
          ],
          [
            `reportHealthy clears it`,
            () => {
              source.reportHealthy()
              problem = null
            },
          ],
          [
            `reportHealthy with nothing to clear changes nothing`,
            () => source.reportHealthy(),
          ],
          [
            `fail sets the error`,
            () => {
              const ended = new Error(`stream ended`)
              source.fail(ended)
              problem = { field: `error`, causes: [ended], serial: ++serial }
            },
          ],
          [`reportHealthy after fail throws`, () => source.reportHealthy()],
          [
            `reportError after fail throws`,
            () => source.reportError(new Error(`late`)),
          ],
        ]
        for (const [step, act] of steps) {
          const throws = stopped()
          if (throws) expect(act, `${step}: throws`).toThrow()
          else act()
          await h.flush()
          observe(step)
        }

        source.update({ id: `1`, name: `Johnny Doe`, age: 30, team: `a` })
        rows = rows.map((row) =>
          row.id === `1` ? { id: `1`, name: `Johnny Doe` } : row,
        )
        await h.flush()
        observe(`rows still publish after fail`)
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
      expect(registry.size).toBe(40)
    })
  })
}
