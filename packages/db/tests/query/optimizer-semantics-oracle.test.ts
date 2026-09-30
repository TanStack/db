/**
 * An outer predicate on an aggregate subquery's result must run after the
 * aggregate. Moving it to source rows can change or remove the result.
 *
 * Model: recompute the global total from source rows, then apply the outer
 * predicate to the projected aggregate row. A materialized Collection checks
 * this model through the public query API. The production driver nests the
 * same aggregate under a left join so predicate pushdown is eligible. Both
 * queries are observed at the first public snapshot after synchronous sync.
 *
 * Grammar: direct, arithmetic-wrapped, conditional-branch, and
 * conditional-default global aggregates. The nested query crosses each shape
 * with an accepting and rejecting outer predicate; a grouped query is the
 * control. The model's missing `k` field represents the current global
 * aggregate projection, which omits fields that are not group keys. The
 * rejecting predicate distinguishes filtering after aggregation from dropping
 * the predicate altogether.
 * An inner join has a separate boundary: the global aggregate joins when its
 * computed total matches an anchor. The nested matching cases currently fail;
 * exact expected-failure guards preserve that open defect. A materialized
 * aggregate Collection supplies positive matching and nonmatching controls.
 * The nested rejecting case checks the outer filter, but this oracle does not
 * yet reject an all-empty nested QueryRef implementation.
 */
import { describe, expect, test } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import {
  add,
  caseWhen,
  eq,
  isUndefined,
  sum,
} from '../../src/query/builder/functions.js'
import { mockSyncCollectionOptions, stripVirtualProps } from '../utils.js'

type Row = { id: number; k: number; v: number }

const rows: Array<Row> = [
  { id: 1, k: 1, v: 10 },
  { id: 2, k: 2, v: 20 },
]

describe('optimizer aggregate semantics', () => {
  for (const scenario of [
    {
      name: `matching without outer filter`,
      target: 30,
      filter: `none`,
      expected: [{ total: 30 }],
    },
    {
      name: `matching with accepting outer filter`,
      target: 30,
      filter: `accept`,
      expected: [{ total: 30 }],
    },
    {
      name: `matching with rejecting outer filter`,
      target: 30,
      filter: `reject`,
      expected: [],
    },
    {
      name: `nonmatching without outer filter`,
      target: 31,
      filter: `none`,
      expected: [],
    },
  ] as const) {
    test(`inner join of a global aggregate ${scenario.name}`, () => {
      const source = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `optimizer-inner-source-${scenario.name}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )
      const anchor = createCollection(
        mockSyncCollectionOptions({
          id: `optimizer-inner-anchor-${scenario.name}`,
          getKey: (row: { id: number; target: number }) => row.id,
          initialData: [{ id: 1, target: scenario.target }],
        }),
      )
      const result = createLiveQueryCollection({
        startSync: true,
        query: (q) => {
          const summary = q.from({ b: source }).select(({ b }) => ({
            k: b.k,
            total: sum(b.v),
          }))
          const joined = q
            .from({ s: summary })
            .innerJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
          if (scenario.filter === `accept`) {
            return joined
              .where(({ s }) => isUndefined(s.k))
              .select(({ s }) => ({ total: s.total }))
          }
          if (scenario.filter === `reject`) {
            return joined
              .where(({ s }) => eq(s.k, 1))
              .select(({ s }) => ({ total: s.total }))
          }
          return joined.select(({ s }) => ({ total: s.total }))
        },
      })

      // The first synchronous public snapshot must follow aggregate, join,
      // then outer-filter semantics. This compares complete rows, not counts.
      const actual = result.toArray.map(stripVirtualProps)
      if (scenario.target === 30 && scenario.filter !== `reject`) {
        // Known inner-join defect: these legal matching cases currently vanish.
        // Keep the exact law as an expected failure until production is fixed.
        let mismatch: unknown
        try {
          expect(actual).toEqual(scenario.expected)
        } catch (error) {
          mismatch = error
        }
        expect(mismatch).toMatchObject({
          name: `AssertionError`,
          actual: [],
          expected: [{ total: 30 }],
        })
      } else {
        expect(actual).toEqual(scenario.expected)
      }

      if (scenario.filter === `none`) {
        const aggregate = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q.from({ b: source }).select(({ b }) => ({ total: sum(b.v) })),
        })
        const materialized = createLiveQueryCollection({
          startSync: true,
          query: (q) =>
            q
              .from({ s: aggregate })
              .innerJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
              .select(({ s }) => ({ total: s.total })),
        })
        expect(materialized.toArray.map(stripVirtualProps)).toEqual(
          scenario.expected,
        )
      }
    })
  }

  for (const shape of [
    `direct`,
    `wrapped`,
    `caseWhenCondition`,
    `caseWhenDefault`,
  ] as const) {
    test(`${shape} global aggregate keeps post-aggregate filtering`, () => {
      const source = createCollection(
        mockSyncCollectionOptions<Row>({
          id: `optimizer-aggregate-source-${shape}`,
          getKey: (row) => row.id,
          initialData: rows,
        }),
      )
      const anchor = createCollection(
        mockSyncCollectionOptions({
          id: `optimizer-aggregate-anchor-${shape}`,
          getKey: (row: { id: number; target: number }) => row.id,
          initialData: [{ id: 1, target: 30 }],
        }),
      )
      const modelTotal = rows.reduce((total, row) => total + row.v, 0)
      const expected = [
        { total: shape === `caseWhenCondition` ? 1 : modelTotal },
      ]

      const aggregate = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q.from({ b: source }).select(({ b }) => ({
            k: b.k,
            total:
              shape === `direct`
                ? sum(b.v)
                : shape === `wrapped`
                  ? add(sum(b.v), 0)
                  : shape === `caseWhenCondition`
                    ? caseWhen(eq(sum(b.v), modelTotal), 1, 0)
                    : caseWhen(eq(1, 2), 0, sum(b.v)),
          })),
      })
      expect(aggregate.toArray.map(stripVirtualProps)).toEqual(expected)

      const materialized = createLiveQueryCollection({
        startSync: true,
        query: (q) =>
          q
            .from({ s: aggregate })
            .leftJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
            .where(({ s }) => isUndefined(s.k))
            .select(({ s }) => ({ total: s.total })),
      })
      expect(materialized.toArray.map(stripVirtualProps)).toEqual(expected)

      for (const outerPredicate of [`accept`, `reject`] as const) {
        const nested = createLiveQueryCollection({
          startSync: true,
          query: (q) => {
            const summary = q.from({ b: source }).select(({ b }) => ({
              k: b.k,
              total:
                shape === `direct`
                  ? sum(b.v)
                  : shape === `wrapped`
                    ? add(sum(b.v), 0)
                    : shape === `caseWhenCondition`
                      ? caseWhen(eq(sum(b.v), modelTotal), 1, 0)
                      : caseWhen(eq(1, 2), 0, sum(b.v)),
            }))
            return q
              .from({ s: summary })
              .leftJoin({ a: anchor }, ({ s, a }) => eq(s.total, a.target))
              .where(({ s }) =>
                outerPredicate === `accept` ? isUndefined(s.k) : eq(s.k, 1),
              )
              .select(({ s }) => ({ total: s.total }))
          },
        })
        expect(nested.toArray.map(stripVirtualProps)).toEqual(
          outerPredicate === `accept` ? expected : [],
        )
      }
    })
  }

  test('group-key filtering keeps each grouped aggregate under a left join', () => {
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `optimizer-grouped-source`,
        getKey: (row) => row.id,
        initialData: rows,
      }),
    )
    const anchor = createCollection(
      mockSyncCollectionOptions({
        id: `optimizer-grouped-anchor`,
        getKey: (row: { id: number; target: number }) => row.id,
        initialData: [{ id: 1, target: 1 }],
      }),
    )
    const grouped = createLiveQueryCollection({
      startSync: true,
      query: (q) => {
        const summary = q
          .from({ b: source })
          .groupBy(({ b }) => b.k)
          .select(({ b }) => ({ k: b.k, total: add(sum(b.v), 0) }))
        return q
          .from({ s: summary })
          .leftJoin({ a: anchor }, ({ s, a }) => eq(s.k, a.target))
          .where(({ s }) => eq(s.k, 1))
          .select(({ s }) => ({ k: s.k, total: s.total }))
      },
    })
    expect(grouped.toArray.map(stripVirtualProps)).toEqual([
      {
        k: 1,
        total: rows
          .filter((row) => row.k === 1)
          .reduce((n, row) => n + row.v, 0),
      },
    ])
  })
})
