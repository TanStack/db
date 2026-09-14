/**
 * Shared live-query conformance suite.
 *
 * Sourced bottom-up from the union of the five adapters' existing test suites
 * (the "spine" + framework-agnostic "gap-closers"), plus a small tail of
 * behaviors that all adapters should support.
 *
 * Each scenario has a unique stable key. All current scenarios must pass;
 * future known bugs need exact failure signatures, not whole-test waivers.
 *
 * Coverage: query/where/select, live insert/update/delete, orderBy, join,
 * groupBy/aggregate, nested aggregates, `.includes` subqueries, findOne
 * cardinality, disabled + transitions, deferred readiness / eager / ready-with-
 * no-data, param recompilation, optimistic mutation, pre-created & config-object
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
import type { LiveQueryDriver, LiveQueryHandle, Row } from './contract'

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
    makePrecreated: (build, options) =>
      sources!.track(rawDriver.makePrecreated(build, options)),
    makeErrorSource: () => sources!.track(rawDriver.makeErrorSource()),
    mount: (build) => track(rawDriver.mount(build)),
    mountControllable: (build, initial) =>
      track(rawDriver.mountControllable(build, initial)),
    mountCollection: (collection) =>
      track(rawDriver.mountCollection(collection)),
    mountConfig: (build) => track(rawDriver.mountConfig(build)),
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

        await h.setParam(false)
        expectDisabledResult(h.current(), driver.disabledRepresentation)
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
      expect(registry.size).toBe(25)
    })
  })
}
