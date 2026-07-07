/**
 * Shared live-query conformance suite (RFC #1623, Phase 1).
 *
 * Sourced bottom-up from the union of the five adapters' existing test suites
 * (the "spine" + framework-agnostic "gap-closers"), plus a small tail of
 * behaviors no adapter tests yet but all should (encoded as expected-fail).
 *
 * Each scenario has a stable KEY. An adapter marks a key in `driver.knownGaps`
 * (populated empirically by running, not from the coverage matrix) to assert it
 * as expected-fail. `UNIVERSAL_EXPECTED_FAIL` keys fail on every adapter until
 * the underlying core gap is fixed.
 *
 * STATUS: Phase-A slice — a verifiable core plus the two flagship gap-closers
 * (findOne cardinality, disabled) and the #1601 tail. Engine-heavy scenarios
 * (join / groupBy / aggregate / .includes / optimistic reconcile / async
 * status) are ported next, faithfully from the existing adapter tests.
 */
import { describe, expect, it } from 'vitest'
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

/** Keys that are expected to fail on ALL adapters (core gaps, not adapter drift). */
const UNIVERSAL_EXPECTED_FAIL = new Set<string>([`order-only-move`])

export function runSuite(rawDriver: LiveQueryDriver) {
  const { ops } = rawDriver
  const gaps = new Set(rawDriver.knownGaps ?? [])

  // Every scenario key registered below, used to validate `knownGaps` /
  // `UNIVERSAL_EXPECTED_FAIL` don't reference a stale or misspelled key.
  const registeredKeys = new Set<string>()

  // Track every handle mounted during the current scenario so it is always torn
  // down, even when an (expected-fail) scenario throws before its own
  // `h.unmount()`. Wrapping the driver's `mount*` methods records handles
  // automatically, so scenario bodies need no `try/finally` of their own.
  let mounted: Array<LiveQueryHandle> | null = null
  const track = <H extends LiveQueryHandle>(handle: H): H => {
    mounted?.push(handle)
    return handle
  }
  const driver: LiveQueryDriver = {
    ...rawDriver,
    mount: (build) => track(rawDriver.mount(build)),
    mountControllable: (build, initial) =>
      track(rawDriver.mountControllable(build, initial)),
    mountCollection: (collection) => track(rawDriver.mountCollection(collection)),
    mountConfig: (build) => track(rawDriver.mountConfig(build)),
    mountDisabled: () => track(rawDriver.mountDisabled()),
  }

  /** Register a scenario as `it` or `it.fails` based on known gaps. */
  const scenario = (
    key: string,
    name: string,
    fn: () => Promise<void> | void,
  ) => {
    registeredKeys.add(key)
    const expectFail = gaps.has(key) || UNIVERSAL_EXPECTED_FAIL.has(key)
    const label = `[${key}] ${name}${expectFail ? ` (expected-fail)` : ``}`
    const run = async () => {
      const handles: Array<LiveQueryHandle> = []
      mounted = handles
      try {
        await fn()
      } finally {
        mounted = null
        for (const handle of handles) {
          try {
            handle.unmount()
          } catch {
            // teardown is best-effort / idempotent
          }
        }
      }
    }
    if (expectFail) it.fails(label, run)
    else it(label, run)
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

        expect(h.current().data).toHaveLength(1)
        expect(h.current().data[0]).toMatchObject({
          id: `3`,
          name: `John Smith`,
        })
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
      expect(h.current().data).toHaveLength(SEED.length)

      source.insert({ id: `4`, name: `Dave`, age: 40, team: `b` })
      await h.flush()

      expect(h.current().data).toHaveLength(SEED.length + 1)
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

        expect(h.current().data).toHaveLength(SEED.length - 1)
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

        expect(h.current().isEnabled).toBe(false)
        expect(h.current().data ?? []).toHaveLength(0)
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

      expect(h.current().data).toHaveLength(ISSUES.length)
      expect(h.current().data.find((r: any) => r.id === `i1`)).toMatchObject({
        title: `Issue 1`,
        name: `John Doe`,
      })
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

        const byTeam = new Map(
          h.current().data.map((r: any) => [r.team, r.count]),
        )
        expect(byTeam.get(`a`)).toBe(2)
        expect(byTeam.get(`b`)).toBe(1)
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

        const byName = new Map(
          h.current().data.map((r: any) => [r.name, r.issueCount]),
        )
        expect(byName.get(`John Doe`)).toBe(2)
        expect(byName.get(`Jane Doe`)).toBe(1)
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
        expect(john.issues).toBeDefined()
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
        expect(h.current().data).toHaveLength(1) // age > 30 → John Smith

        await h.setParam(20)
        expect(h.current().data).toHaveLength(3) // all

        await h.setParam(50)
        expect(h.current().data).toHaveLength(0) // none
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
        expect(h.current().isEnabled).toBe(false)

        await h.setParam(true)
        expect(h.current().isEnabled).toBe(true)
        expect(h.current().data).toHaveLength(SEED.length)

        await h.setParam(false)
        expect(h.current().isEnabled).toBe(false)
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

        expect(h.current().data).toHaveLength(1)
        expect(h.current().data[0]).toMatchObject({ id: `3` })
        h.unmount()
      },
    )

    scenario(
      `error-status`,
      `a failing source surfaces status=error / isError`,
      async () => {
        const source = driver.makeErrorSource()
        const h = driver.mountCollection(source.collection)
        await h.flush()

        expect(h.current().status).toBe(`error`)
        expect(h.current().isError).toBe(true)
        h.unmount()
      },
    )

    // ---- tail: universal expected-fail (#1601) ---------------------------

    scenario(
      `order-only-move`,
      `an order-only move republishes the ordered result (#1601)`,
      async () => {
        const source = driver.makeSource(SEED)
        // Project only id+name; sort by age. Changing age reorders the result
        // WITHOUT changing any projected row value — the #1601 case.
        const h = driver.mount((q) =>
          q
            .from({ items: source.collection })
            .orderBy(({ items }: any) => items.age)
            .select(({ items }: any) => ({ id: items.id, name: items.name })),
        )
        await h.flush()
        const first = h.current().data.map((r: any) => r.id) // ['2','1','3']

        source.update({ id: `2`, name: `Jane Doe`, age: 99, team: `b` })
        await h.flush()

        expect(h.current().data.map((r: any) => r.id)).not.toEqual(first)
        h.unmount()
      },
    )

    // ---- meta: guard against stale/misspelled expected-fail keys ---------

    it(`every knownGap / universal expected-fail references a real scenario`, () => {
      for (const key of rawDriver.knownGaps ?? []) {
        expect(
          registeredKeys.has(key),
          `${driver.name} knownGaps has "${key}", which is not a scenario key`,
        ).toBe(true)
      }
      for (const key of UNIVERSAL_EXPECTED_FAIL) {
        expect(
          registeredKeys.has(key),
          `UNIVERSAL_EXPECTED_FAIL has "${key}", which is not a scenario key`,
        ).toBe(true)
      }
    })
  })
}
