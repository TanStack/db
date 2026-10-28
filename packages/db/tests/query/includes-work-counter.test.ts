// Unit tests for the includes work-counter oracle. Each test here compares
// production with a value written by hand, or checks the oracle's own cleanup
// and comparison helpers, so no declared check or model reaches it. The law
// that the work bound states is owned by includes-work-counter-oracle.test.ts,
// and the shared fixtures live in includes-work-counter-support.ts.

import { beforeAll, describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import {
  SetWindowFindOneLimitError,
  SetWindowRequiresOrderByError,
} from '../../src/errors.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import {
  createSourceCollection,
  expectSourceWorkBound,
  expectedResult,
  noFillers,
  observeResult,
  observeWork,
  runCleanups,
} from './includes-work-counter-support.js'
import type {
  SourceWork,
  WorkObservation,
} from './includes-work-counter-support.js'

let nextCollectionId = 0
let joinedBaselineObservation: WorkObservation

describe(`includes deterministic work-counter oracle`, () => {
  it(`preserves the primary failure and every cleanup failure`, async () => {
    const primary = new Error(`source preload failed`)
    const firstCleanup = new Error(`live query cleanup failed`)
    const secondCleanup = new Error(`source cleanup failed`)
    const attempted: Array<string> = []

    await expect(
      runCleanups(
        [
          () => {
            attempted.push(`live`)
            throw firstCleanup
          },
          () => {
            attempted.push(`source`)
            throw secondCleanup
          },
        ],
        { error: primary },
      ),
    ).rejects.toMatchObject({
      cause: primary,
      errors: [primary, firstCleanup, secondCleanup],
    })
    expect(attempted).toEqual([`live`, `source`])
  })

  it.each([true, false])(
    `retains and rejects extra roots with joinTargets=%s`,
    (joinTargets) => {
      const expected = expectedResult({ joinTargets })
      expect(observeResult(expected)).toEqual(expected)
      const extra = { id: `term-extra`, meanings: [] }
      const faulty = [...expected, extra]
      // The old first-root capture erases this violation.
      expect(observeResult(faulty.slice(0, 1))).toEqual(expected)
      const observed = observeResult(faulty)
      expect(observed).toEqual(faulty)
      expect(() => expect(observed).toEqual(expected)).toThrow()
      expect(observeResult([])).toEqual([])
      expect(() => expect(observeResult([])).toEqual(expected)).toThrow()
    },
  )
  beforeAll(async () => {
    joinedBaselineObservation = await observeWork({
      filler: noFillers,
      joinTargets: true,
    })
  })

  it(`rejects extra source reads at the preload checkpoint`, () => {
    const baseline = joinedBaselineObservation
    const faultyWork: SourceWork = {
      ...baseline.sourceWork,
      links: {
        ...baseline.sourceWork.links,
        examined: baseline.sourceWork.links.examined + 1,
      },
    }

    expect(baseline.result).toEqual(expectedResult({ joinTargets: true }))
    expect(() =>
      expectSourceWorkBound(faultyWork, baseline.sourceWork),
    ).toThrow()
  })
})

describe(`includes work under an ordered parent window`, () => {
  // An include child's orderBy gives the parent no window to move, so an
  // unordered parent rejects setWindow instead of moving the child windows.
  it(`rejects setWindow on an unordered parent with an ordered child`, async () => {
    const parentSource = createSourceCollection(`unordered-parents`, [
      { id: `parent-0`, group: `group-0` },
    ])
    const childSource = createSourceCollection(`unordered-children`, [
      { id: `child-0`, group: `group-0`, n: 0 },
    ])
    const live = createLiveQueryCollection((q) =>
      q.from({ parent: parentSource }).select(({ parent }) => ({
        id: parent.id,
        kids: toArray(
          q
            .from({ child: childSource })
            .where(({ child }) => eq(child.group, parent.group))
            .orderBy(({ child }) => child.n)
            .limit(1),
        ),
      })),
    )
    try {
      await live.preload()
      expect(() => live.utils.setWindow({ offset: 0, limit: 1 })).toThrow(
        SetWindowRequiresOrderByError,
      )
    } finally {
      await runCleanups([
        () => live.cleanup(),
        () => parentSource.cleanup(),
        () => childSource.cleanup(),
      ])
    }
  })
})

/**
 * # Static demand and window ownership
 *
 * A static parent filter that names one row of a `findOne` with no `offset`
 * leaves the window nothing to drop, so the include may create that child's
 * demand at once: a detail page starts its child acquisition attempt beside
 * its parent acquisition attempt instead of after the parent's rows arrive.
 * Each test's `loadSubset` handler stands in for both the sync adapter and the
 * provider, and records each acquisition attempt in order. Only the query's
 * own window answers `setWindow`; a window inside a `from` or a joined
 * subquery never does.
 */
describe(`static include demand and setWindow ownership`, () => {
  // A window requested before start at offset 0 drops nothing, so it keeps
  // the static demand.
  it.each([null, { offset: 0 }] as const)(
    `starts a findOne detail page's child load beside its parent load (window before start: %o)`,
    async (startWindow) => {
      const calls: Array<string> = []
      let releaseParent!: () => void
      const parentHeld = new Promise<void>((resolve) => {
        releaseParent = resolve
      })
      const parents = createCollection<{ id: string }, string>({
        id: `detail-parents-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(`parent`)
                return parentHeld.then(() => {
                  begin()
                  write({ type: `insert`, value: { id: `parent-1` } })
                  commit()
                })
              },
            }
          },
        },
      })
      const children = createCollection<
        { id: string; parentId: string },
        string
      >({
        id: `detail-children-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(`child`)
                begin()
                write({
                  type: `insert`,
                  value: { id: `child-1`, parentId: `parent-1` },
                })
                commit()
                return true
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection({
        startSync: false,
        query: (q) =>
          q
            .from({ parent: parents })
            .where(({ parent }) => eq(parent.id, `parent-1`))
            .select(({ parent }) => ({
              id: parent.id,
              kids: toArray(
                q
                  .from({ child: children })
                  .where(({ child }) => eq(child.parentId, parent.id))
                  .select(({ child }) => ({ id: child.id })),
              ),
            }))
            .findOne(),
      })
      if (startWindow) {
        const settled = live.utils.setWindow(startWindow)
        if (settled !== true) void settled.catch(() => {})
      }
      try {
        const ready = live.toArrayWhenReady()
        await new Promise((resolve) => setTimeout(resolve, 0))
        // The child acquisition attempt has started while the parent's is held.
        expect(calls).toEqual([`parent`, `child`])
        releaseParent()
        await ready
        expect(
          (
            live.toArray as unknown as Array<{
              id: string
              kids: Array<{ id: string }>
            }>
          ).map((row) => ({ id: row.id, kids: row.kids.map((kid) => kid.id) })),
        ).toEqual([{ id: `parent-1`, kids: [`child-1`] }])
        expect(calls).toEqual([`parent`, `child`])
      } finally {
        releaseParent()
        await runCleanups([
          () => live.cleanup(),
          () => parents.cleanup(),
          () => children.cleanup(),
        ])
      }
    },
  )

  // A findOne with limit 0 shows no row, so its named correlation value's child must
  // not load.
  it(`starts no child acquisition for a findOne with limit 0`, async () => {
    const calls: Array<string> = []
    const onDemand = <T extends { id: string }>(name: string, rows: Array<T>) =>
      createCollection<T, string>({
        id: `limit-zero-${name}-${nextCollectionId++}`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                calls.push(name)
                begin()
                for (const value of rows) write({ type: `insert`, value })
                commit()
                return true
              },
            }
          },
        },
      })
    const parents = onDemand(`parent`, [{ id: `parent-1` }])
    const children = onDemand(`child`, [
      { id: `child-1`, parentId: `parent-1` },
    ])
    const live = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ parent: parents })
          .where(({ parent }) => eq(parent.id, `parent-1`))
          .select(({ parent }) => ({
            id: parent.id,
            kids: toArray(
              q
                .from({ child: children })
                .where(({ child }) => eq(child.parentId, parent.id)),
            ),
          }))
          .orderBy(({ parent }) => parent.id)
          .limit(0)
          .findOne(),
    })
    try {
      await live.toArrayWhenReady()
      expect(calls).not.toContain(`child`)
      expect(live.toArray).toEqual([])
    } finally {
      await runCleanups([
        () => live.cleanup(),
        () => parents.cleanup(),
        () => children.cleanup(),
      ])
    }
  })

  // A findOne keeps its compiled limit, and setWindow throws for any other
  // limit. An ordered findOne has a movable window; an unordered one is a
  // fixed one-row result that rejects offset moves.
  it(`keeps a findOne's compiled limit and moves only an ordered findOne`, async () => {
    const rows = createSourceCollection(
      `find-one-window-rows`,
      Array.from({ length: 4 }, (_, rank) => ({ id: `row-${rank}`, rank })),
    )
    const one = createLiveQueryCollection((q) =>
      q
        .from({ row: rows })
        .orderBy(({ row }) => row.rank)
        .findOne(),
    )
    const none = createLiveQueryCollection((q) =>
      q
        .from({ row: rows })
        .orderBy(({ row }) => row.rank)
        .limit(0)
        .findOne(),
    )
    const unordered = createLiveQueryCollection((q) =>
      q.from({ row: rows }).findOne(),
    )
    try {
      await Promise.all([one.preload(), none.preload(), unordered.preload()])
      expect(() => one.utils.setWindow({ offset: 0, limit: 3 })).toThrow(
        SetWindowFindOneLimitError,
      )
      for (const window of [{ offset: 2 }, { offset: 1, limit: 1 }]) {
        const settled = one.utils.setWindow(window)
        if (settled !== true) await settled
        expect(one.toArray.map((row) => row.id)).toEqual([
          `row-${window.offset}`,
        ])
        expect(one.utils.getWindow()).toEqual({
          offset: window.offset,
          limit: 1,
        })
      }
      const moved = none.utils.setWindow({ offset: 1 })
      if (moved !== true) await moved
      expect(none.toArray).toEqual([])
      expect(none.utils.getWindow()).toEqual({ offset: 1, limit: 0 })
      expect(() => none.utils.setWindow({ limit: 1 })).toThrow(
        SetWindowFindOneLimitError,
      )
      // A window is an ordered view: an unordered findOne keeps offset 0.
      expect(() => unordered.utils.setWindow({ offset: 1 })).toThrow(
        SetWindowRequiresOrderByError,
      )
      expect(unordered.utils.setWindow({ offset: 0 })).toBe(true)
      expect(unordered.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
    } finally {
      await runCleanups([
        () => one.cleanup(),
        () => none.cleanup(),
        () => unordered.cleanup(),
        () => rows.cleanup(),
      ])
    }
  })

  it.each([`from`, `join`] as const)(
    `rejects setWindow when only a %s subquery has a window`,
    async (placement) => {
      const rows = createSourceCollection(`owner-rows`, [
        { id: `row-0`, rank: 0 },
        { id: `row-1`, rank: 1 },
        { id: `row-2`, rank: 2 },
      ])
      const live = createLiveQueryCollection((q) => {
        const page = q
          .from({ row: rows })
          .orderBy(({ row }) => row.rank)
          .limit(2)
        return placement === `from`
          ? q.from({ page })
          : q
              .from({ row: rows })
              .join({ page }, ({ row, page: paged }) => eq(row.id, paged.id))
      })
      try {
        await live.preload()
        expect(() => live.utils.setWindow({ offset: 1, limit: 2 })).toThrow(
          SetWindowRequiresOrderByError,
        )
      } finally {
        await runCleanups([() => live.cleanup(), () => rows.cleanup()])
      }
    },
  )

  it(`moves the outer window, not a from subquery's`, async () => {
    const rows = createSourceCollection(
      `outer-owner-rows`,
      Array.from({ length: 6 }, (_, rank) => ({ id: `row-${rank}`, rank })),
    )
    const live = createLiveQueryCollection((q) =>
      q
        .from({
          page: q
            .from({ row: rows })
            .orderBy(({ row }) => row.rank)
            .limit(4),
        })
        .orderBy(({ page }) => page.rank)
        .limit(2),
    )
    try {
      await live.preload()
      const settled = live.utils.setWindow({ offset: 2, limit: 2 })
      if (settled !== true) await settled
      expect(live.toArray.map((row) => row.id)).toEqual([`row-2`, `row-3`])
    } finally {
      await runCleanups([() => live.cleanup(), () => rows.cleanup()])
    }
  })
})
