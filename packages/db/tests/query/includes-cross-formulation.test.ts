// Unit tests for the cross-formulation oracle. Each test here compares
// production with literal values or with a fixture predicate, or checks the
// oracle's own cleanup and replay machinery, so no declared check or model
// reaches it. The equivalence law across the five formulations is owned by
// includes-cross-formulation-oracle.property.test.ts. The shared observers
// and fixtures live in includes-cross-formulation-support.ts.

import { fc } from '@fast-check/vitest'
import { describe, expect, test } from 'vitest'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createCollection } from '../../src/collection/index.js'
import {
  count,
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import {
  assertArrayKeys,
  assertGroupedRouteCounts,
  assertSelectedKeys,
  captureOrderedNested,
  captureReferenceRequest,
  captureReferenceRows,
  createControlledCollection,
  normalizeFlat,
  normalizeNested,
  referenceRequestPredicate,
  withCleanup,
} from './includes-cross-formulation-support.js'
import {
  assertTlpPartitions,
  partitionAndRouteScenario,
  recomputeNestedModel,
  recomputeWindowedModel,
  sharedRouteDeletionScenario,
} from './includes-cross-formulation-model-oracle.js'
import type { BasicExpression } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'
import type {
  ChildRow,
  FlatRow,
  NormalizedParent,
  ReferenceChild,
  ReferenceParent,
  ReferenceRequest,
} from './includes-cross-formulation-support.js'

describe(`includes cross-formulation oracle`, () => {
  test(`cold provider predicates preserve opaque reference membership`, () => {
    const first = { code: 0 }
    const second = { code: 0 }
    const rows = [
      { id: 10, parentGroup: first },
      { id: 20, parentGroup: second },
      { id: 30, parentGroup: { code: 0 } },
    ]
    const ref = new PropRef([`parentGroup`])
    const cases: Array<[BasicExpression | undefined, Array<number>]> = [
      [undefined, [10, 20, 30]],
      [new Func(`eq`, [ref, new Value(first)]), [10]],
      [new Func(`eq`, [new Value(second), ref]), [20]],
      [new Func(`eq`, [ref, new Value({ code: 0 })]), []],
      [new Func(`in`, [ref, new Value([first, second])]), [10, 20]],
      [new Func(`in`, [ref, new Value([])]), []],
      [
        new Func(`and`, [
          new Func(`in`, [ref, new Value([first, second])]),
          new Func(`eq`, [ref, new Value(second)]),
        ]),
        [20],
      ],
    ]
    for (const [expression, ids] of cases) {
      const predicate = referenceRequestPredicate(
        expression && captureReferenceRequest(expression),
      )
      expect(rows.filter(predicate).map((row) => row.id)).toEqual(ids)
    }
    // These are fixture-domain failures, not claims about runtime support.
    for (const expression of [
      new Func(`lt`, [ref, new Value(first)]),
      new Func(`eq`, [new PropRef([`id`]), new Value(first)]),
      new Func(`eq`, [ref]),
      new Func(`in`, [ref, new Value(first)]),
    ]) {
      expect(() =>
        referenceRequestPredicate(captureReferenceRequest(expression)),
      ).toThrow(`Unsupported cold reference fixture predicate`)
    }
  })

  test(`request snapshots copy paths and membership arrays without cloning keys`, () => {
    const first = { code: 0 }
    const second = { code: 0 }
    const path = [`parentGroup`]
    const keys = [first, second]
    const snapshot = captureReferenceRequest(
      new Func(`in`, [new PropRef(path), new Value(keys)]),
    )
    // Mutate only test-owned input, never a submitted runtime request.
    path[0] = `changed`
    keys.splice(0, 2, { code: 0 })
    expect(snapshot.type).toBe(`func`)
    if (snapshot.type !== `func`) throw new Error(`Expected function snapshot`)
    expect(Object.isFrozen(snapshot.args)).toBe(true)
    expect(snapshot.args[0]).toEqual({ type: `ref`, path: [`parentGroup`] })
    const membership = snapshot.args[1]
    if (membership?.type !== `val` || !Array.isArray(membership.value))
      throw new Error(`Expected membership snapshot`)
    expect(Object.isFrozen(membership.value)).toBe(true)
    expect(membership.value[0]).toBe(first)
    expect(membership.value[1]).toBe(second)
    expect(membership.value).toHaveLength(2)
  })

  test(`cold grouped-only loading keeps equal-shaped reference routes distinct`, async () => {
    const first = Object.freeze({ code: 0 })
    const second = Object.freeze({ code: 0 })
    const unmatched = Object.freeze({ code: 0 })
    const rows: Array<ReferenceChild> = [
      { id: 10, parentGroup: first },
      { id: 11, parentGroup: first },
      { id: 20, parentGroup: second },
      { id: 30, parentGroup: unmatched },
    ]
    const parents = createControlledCollection<ReferenceParent>(
      `cold-grouped-parents`,
      [
        { id: 1, group: first },
        { id: 2, group: second },
      ],
    )
    const requests: Array<ReferenceRequest | undefined> = []
    const loaded = new Set<number>()
    const children = createCollection<ReferenceChild>({
      id: `cold-grouped-children`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => ({
          loadSubset: (options: LoadSubsetOptions) => {
            const request =
              options.where && captureReferenceRequest(options.where)
            requests.push(request)
            if (
              options.orderBy?.length ||
              options.cursor !== undefined ||
              options.limit !== undefined ||
              (options.offset ?? 0) !== 0
            )
              throw new Error(
                `Unsupported bounded cold reference fixture request`,
              )
            const matches = referenceRequestPredicate(request)
            begin()
            for (const row of rows) {
              if (!loaded.has(row.id) && matches(row)) {
                write({ type: `insert`, value: { ...row } })
                loaded.add(row.id)
              }
            }
            const receipt = commit()
            if (receipt !== true) return receipt.then(() => markReady())
            markReady()
            return true
          },
        }),
      },
    })
    const grouped = createLiveQueryCollection({
      getKey: (row) => row.id,
      query: (q) =>
        q
          .from({ parent: parents.collection })
          .orderBy(({ parent }) => parent.id, `asc`)
          .select(({ parent }) => ({
            id: parent.id,
            summaries: toArray(
              q
                .from({ child: children })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ count: count(child.id) })),
            ),
          })),
    })
    await withCleanup(async () => {
      expect(loaded.size).toBe(0)
      await grouped.preload()
      expect(requests.length).toBeGreaterThan(0)
      expect(loaded.size).toBeGreaterThan(0)
      // Full-source or broader requests are legal. Counts alone decide routing.
      assertGroupedRouteCounts(grouped.toArray, [2, 1])
    }, [
      () => grouped.cleanup(),
      () => parents.collection.cleanup(),
      () => children.cleanup(),
    ])
  })

  test.each([
    { name: `success`, failWork: false, cleanupFailures: 0 },
    { name: `primary only`, failWork: true, cleanupFailures: 0 },
    { name: `cleanup only`, failWork: false, cleanupFailures: 1 },
    { name: `multiple cleanups`, failWork: false, cleanupFailures: 2 },
    { name: `primary and cleanups`, failWork: true, cleanupFailures: 2 },
  ])(
    `retains $name outcomes while attempting every cleanup`,
    async ({ failWork, cleanupFailures }) => {
      const primary = new Error(`primary`)
      const first = new Error(`synchronous cleanup`)
      const second = new Error(`asynchronous cleanup`)
      const calls: Array<number> = []
      const run = withCleanup(() => {
        if (failWork) throw primary
        return Promise.resolve()
      }, [
        () => {
          calls.push(1)
          if (cleanupFailures > 0) throw first
          return Promise.resolve()
        },
        () => {
          calls.push(2)
          return cleanupFailures > 1
            ? Promise.reject(second)
            : Promise.resolve()
        },
        () => {
          calls.push(3)
          return Promise.resolve()
        },
      ])
      if (failWork && cleanupFailures > 0) {
        await expect(run).rejects.toMatchObject({
          cause: primary,
          errors: [primary, first, second],
        })
      } else if (failWork) {
        await expect(run).rejects.toBe(primary)
      } else if (cleanupFailures === 1) {
        await expect(run).rejects.toBe(first)
      } else if (cleanupFailures === 2) {
        await expect(run).rejects.toMatchObject({ errors: [first, second] })
      } else {
        await run
      }
      expect(calls).toEqual([1, 2, 3])
    },
  )

  test.each([
    `field`,
    `dollar`,
    `symbol`,
    `child symbol`,
    `array symbol`,
    `missing field`,
  ] as const)(
    `raw capture rejects %s before selected-field projection`,
    (fault) => {
      const expected: Array<NormalizedParent> = [
        {
          id: 0,
          group: 0,
          position: 0,
          children: [{ id: 10, parentGroup: 0, score: null, position: 0 }],
        },
      ]
      const rows = captureOrderedNested(expected)
      Object.assign(rows[0]!, {
        $hasPendingWrites: false,

        $origin: `remote`,
        $key: 0,
        $collectionId: `source`,
      })
      expect(captureOrderedNested(rows)).toEqual(expected)
      if (fault === `missing field`)
        Reflect.deleteProperty(rows[0]!, `position`)
      else {
        const target =
          fault === `child symbol`
            ? rows[0]!.children[0]!
            : fault === `array symbol`
              ? rows[0]!.children
              : rows[0]!
        const key =
          fault === `field`
            ? `unexpected`
            : fault === `dollar`
              ? `$unexpected`
              : Symbol(`private`)
        Object.defineProperty(target, key, { value: undefined })
      }
      expect(() => captureOrderedNested(rows)).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
    },
  )

  test.each([
    `metadata`,
    `placeholder after child`,
    `placeholder before child`,
    `duplicate placeholder`,
    `null child`,
  ] as const)(`raw flat capture rejects %s`, (fault) => {
    const row: FlatRow = {
      parentId: 0,
      parentGroup: 0,
      parentPosition: 0,
      child: { id: 10, parentGroup: 0, score: null, position: 0 },
    }
    const second: FlatRow = { ...row, child: { ...row.child!, id: 11 } }
    const empty: FlatRow = { ...row, child: undefined }
    expect(
      normalizeFlat([row, second])[0]?.children.map((child) => child.id),
    ).toEqual([10, 11])
    expect(normalizeFlat([empty])[0]?.children).toEqual([])
    const wrong =
      fault === `metadata`
        ? [row, { ...second, parentPosition: 1 }]
        : fault === `placeholder after child`
          ? [row, empty]
          : fault === `placeholder before child`
            ? [empty, row]
            : fault === `duplicate placeholder`
              ? [empty, empty]
              : [row]
    if (fault === `null child`) Reflect.set(row, `child`, null)
    expect(() => normalizeFlat(wrong)).toThrowError(
      expect.objectContaining({ name: `AssertionError` }),
    )
  })

  test(`literal group counts reject common-mode missing, merged and stale groups`, () => {
    const initial = [
      { id: 1, summaries: [{ count: 2 }] },
      { id: 2, summaries: [{ count: 1 }] },
    ]
    assertGroupedRouteCounts(initial, [2, 1])
    for (const wrong of [
      [],
      [
        { id: 1, summaries: [{ count: 3 }] },
        { id: 2, summaries: [{ count: 3 }] },
      ],
      initial,
    ]) {
      expect(() => assertGroupedRouteCounts(wrong, [1, 2])).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
    }
    assertGroupedRouteCounts(
      [
        { id: 1, summaries: [{ count: 1 }] },
        { id: 2, summaries: [{ count: 2 }] },
      ],
      [1, 2],
    )
  })

  // These synthetic wrong answers calibrate the local comparisons (ORC-006).
  // ORC-007 direct-command evidence belongs to the production drivers below.
  test(`reference-identity checker rejects a wrong answer after shrinking`, () => {
    const property = fc.property(fc.integer(), (code) => {
      const first = { code }
      const second = { code }
      expect(first).not.toBe(second)
      const merged = [
        { id: 1, children: [10, 20] },
        { id: 2, children: [10, 20] },
      ]
      expect(
        captureReferenceRows(merged),
        `reference route checkpoint`,
      ).toEqual([
        { id: 1, children: [10] },
        { id: 2, children: [20] },
      ])
    })
    const failure = fc.check(property, { seed: 1_658_002, numRuns: 4 })
    expect(failure.failed).toBe(true)
    expect(failure.numShrinks).toBeGreaterThan(0)
    expect(String(failure.errorInstance)).toContain(
      `reference route checkpoint`,
    )
    if (failure.counterexamplePath === null)
      throw new Error(`reference-route mutant did not produce a replay path`)
    const replayResult = fc.check(property, {
      seed: failure.seed,
      path: failure.counterexamplePath,
      numRuns: 1,
      endOnFailure: true,
    })
    expect(replayResult.failed).toBe(true)
    expect(String(replayResult.errorInstance)).toContain(
      `reference route checkpoint`,
    )
    expect(replayResult.counterexample).toEqual(failure.counterexample)
  })

  test(`symbol-group checker rejects a wrong answer after shrinking`, () => {
    const property = fc.property(fc.integer(), (code) => {
      const first = Symbol(`group-${code}`)
      const second = Symbol(`group-${code}`)
      expect(first).not.toBe(second)
      assertGroupedRouteCounts(
        [
          { id: 1, summaries: [{ count: 2 }] },
          { id: 2, summaries: [{ count: 2 }] },
        ],
        [1, 1],
      )
    })
    const failure = fc.check(property, { seed: 1_658_003, numRuns: 4 })
    expect(failure.failed).toBe(true)
    expect(failure.numShrinks).toBeGreaterThan(0)
    expect(String(failure.errorInstance)).toContain(`group-route checkpoint`)
    if (failure.counterexamplePath === null)
      throw new Error(`symbol-group mutant did not produce a replay path`)
    const replayResult = fc.check(property, {
      seed: failure.seed,
      path: failure.counterexamplePath,
      numRuns: 1,
      endOnFailure: true,
    })
    expect(replayResult.failed).toBe(true)
    expect(String(replayResult.errorInstance)).toContain(
      `group-route checkpoint`,
    )
    expect(replayResult.counterexample).toEqual(failure.counterexample)
  })

  test.each([`root`, `child`] as const)(
    `retains wrong %s order that unordered normalization would erase`,
    (level) => {
      const expected: Array<NormalizedParent> = [
        {
          id: 1,
          group: 0,
          position: 0,
          children: [
            { id: 11, parentGroup: 0, score: null, position: 0 },
            { id: 10, parentGroup: 0, score: 1, position: 1 },
          ],
        },
        { id: 0, group: 1, position: 1, children: [] },
      ]
      const wrong = captureOrderedNested(expected)
      if (level === `root`) wrong.reverse()
      else wrong[0]!.children.reverse()

      // The old checker was false green. The new observation retains the
      // violation.
      expect(normalizeNested(wrong)).toEqual(expected)
      expect(captureOrderedNested(expected)).toEqual(expected)
      expect(() =>
        expect(captureOrderedNested(wrong)).toEqual(expected),
      ).toThrowError(expect.objectContaining({ name: `AssertionError` }))
    },
  )

  test.each([`__correlationKey`, `__tanstack_group_correlation_key`])(
    `grouped includes preserve internal-looking aggregate alias %s`,
    async (alias) => {
      const parents = createControlledCollection(`aggregate-alias-parents`, [
        { id: 1, group: 1 },
      ])
      const children = createControlledCollection(`aggregate-alias-children`, [
        { id: 10, parentGroup: 1 },
        { id: 11, parentGroup: 1 },
      ])
      const nested = createLiveQueryCollection({
        query: (q) =>
          q.from({ parent: parents.collection }).select(({ parent }) => ({
            id: parent.id,
            summaries: toArray(
              q
                .from({ child: children.collection })
                .where(({ child }) => eq(child.parentGroup, parent.group))
                .groupBy(({ child }) => child.parentGroup)
                .select(({ child }) => ({ [alias]: count(child.id) })),
            ),
          })),
      })

      await withCleanup(async () => {
        await nested.preload()
        assertArrayKeys(nested.toArray, `aggregate alias roots`)
        expect(
          nested.toArray.map((row) => {
            assertSelectedKeys(
              row,
              [`id`, `summaries`],
              `aggregate alias parent`,
            )
            assertArrayKeys(row.summaries, `aggregate alias summaries`)
            return {
              id: row.id,
              summaries: row.summaries.map((summary) => {
                assertSelectedKeys(summary, [alias], `aggregate alias summary`)
                return { [alias]: summary[alias] }
              }),
            }
          }),
        ).toEqual([{ id: 1, summaries: [{ [alias]: 2 }] }])
        expect(nested.get(1)?.summaries.map((row) => row[alias])).toEqual([2])
      }, [
        () => nested.cleanup(),
        () => parents.collection.cleanup(),
        () => children.collection.cleanup(),
      ])
    },
  )
})

// Model and checker calibrations for the cross-formulation oracle. They run no
// production: the first steps the relationship and window models through the
// named scenarios, and the second feeds the TLP check a wrong partition.
describe(`includes cross-formulation model and checker`, () => {
  test(`bounded grammar axes distinguish routes, order, partitions, and windows`, () => {
    const parents = new Map(
      partitionAndRouteScenario.parents.map((row) => [row.id, row]),
    )
    const children = new Map(
      partitionAndRouteScenario.children.map((row) => [row.id, row]),
    )
    const ids = (rows: ReadonlyArray<NormalizedParent>) =>
      rows.map((row) => ({
        id: row.id,
        children: row.children.map((c) => c.id),
      }))

    expect(ids(recomputeNestedModel(parents, children))).toEqual([
      { id: 1, children: [11, 10] },
      { id: 0, children: [11, 10] },
    ])
    parents.set(0, { id: 0, group: 1, position: 1 })
    expect(ids(recomputeNestedModel(parents, children))).toEqual([
      { id: 1, children: [11, 10] },
      { id: 0, children: [12] },
    ])
    children.set(12, { ...children.get(12)!, parentGroup: 0 })
    expect(ids(recomputeNestedModel(parents, children))).toEqual([
      { id: 1, children: [12, 11, 10] },
      { id: 0, children: [] },
    ])
    parents.set(0, { id: 0, group: 0, position: -1 })
    expect(ids(recomputeNestedModel(parents, children))).toEqual([
      { id: 0, children: [12, 11, 10] },
      { id: 1, children: [12, 11, 10] },
    ])
    expect(
      recomputeWindowedModel(parents, children, 0, 0).map(
        (row) => row.children.length,
      ),
    ).toEqual([0, 0])
    expect(ids(recomputeWindowedModel(parents, children, 1, 2))).toEqual([
      { id: 0, children: [11, 10] },
      { id: 1, children: [11, 10] },
    ])
    expect(ids(recomputeWindowedModel(parents, children, 2, 3))).toEqual([
      { id: 0, children: [10] },
      { id: 1, children: [10] },
    ])

    // The three child scores cover true, false, and unknown at pivot 0.
    // Moving the pivot to -2 moves -1 into the complement; replacing null
    // with a number removes the unknown partition. These are independent of
    // the query evaluator used by the TLP production formulation.
    const partition = (pivot: number) =>
      [...children.values()].map((child) => ({
        id: child.id,
        branch:
          child.score === null
            ? `unknown`
            : child.score < pivot
              ? `predicate`
              : `complement`,
      }))
    expect(partition(0)).toEqual([
      { id: 10, branch: `unknown` },
      { id: 11, branch: `predicate` },
      { id: 12, branch: `complement` },
    ])
    expect(partition(-2)).toEqual([
      { id: 10, branch: `unknown` },
      { id: 11, branch: `complement` },
      { id: 12, branch: `complement` },
    ])
    children.set(10, { ...children.get(10)!, score: 0 })
    expect(partition(0).find((row) => row.id === 10)?.branch).toBe(`complement`)

    const sharedChildren = new Map(
      sharedRouteDeletionScenario.children.map((row) => [row.id, row]),
    )
    const sharedParents = new Map(
      sharedRouteDeletionScenario.parents.map((row) => [row.id, row]),
    )
    expect(ids(recomputeNestedModel(sharedParents, sharedChildren))).toEqual([
      { id: 0, children: [10, 11, 12] },
      { id: 1, children: [10, 11, 12] },
    ])
    sharedChildren.delete(10)
    expect(ids(recomputeNestedModel(sharedParents, sharedChildren))).toEqual([
      { id: 0, children: [11, 12] },
      { id: 1, children: [11, 12] },
    ])
  })

  test(`TLP checker rejects a wrong branch even when the union is complete`, () => {
    const rows: Array<ChildRow> = [
      { id: 10, parentGroup: 0, score: null, position: 0 },
      { id: 11, parentGroup: 0, score: -1, position: 1 },
      { id: 12, parentGroup: 0, score: 1, position: 2 },
    ]
    const correct = [[rows[1]!], [rows[2]!], [rows[0]!]]
    assertTlpPartitions(correct, rows, 0, `TLP calibration`)
    const wrong = [[rows[0]!], [rows[2]!], [rows[1]!]]
    expect(wrong.flat()).toHaveLength(rows.length)
    expect(new Set(wrong.flat().map((row) => row.id))).toEqual(
      new Set(rows.map((row) => row.id)),
    )
    expect(() =>
      assertTlpPartitions(wrong, rows, 0, `TLP calibration`),
    ).toThrow(`TLP calibration predicate partition`)
  })
})
