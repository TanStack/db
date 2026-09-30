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
