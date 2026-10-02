import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { getPreparedLiveQueryIdentity } from '../../src/live-query-options.js'
import { Query } from '../../src/query/builder/index.js'
import { and, eq, gt } from '../../src/query/index.js'
import { mockSyncCollectionOptions } from '../utils.js'

/**
 * A query a partition can serve is identified by its source and its `eq`
 * fields and literals, which the partition already extracts. Two queries
 * with the same identity must publish the same rows, and queries that can
 * publish different rows must have different identities. Queries the
 * partition cannot serve keep the full structural identity.
 */
type Row = { id: string; a: string; b: string; n: number }
let serial = 0
const makeSource = () =>
  createCollection(
    mockSyncCollectionOptions<Row>({
      id: `pooled-identity-${serial++}`,
      getKey: (row) => row.id,
      initialData: [],
    }),
  )
const identity = (build: (q: any) => unknown) =>
  getPreparedLiveQueryIdentity(build(new Query()))

describe(`pooled query identity`, () => {
  const source = makeSource()

  it(`ignores conjunct and operand order`, () => {
    expect(
      identity((q) =>
        q
          .from({ r: source })
          .where(({ r }: any) => and(eq(r.a, `x`), eq(r.b, `y`))),
      ),
    ).toEqual(
      identity((q) =>
        q
          .from({ r: source })
          .where(({ r }: any) => eq(`y`, r.b))
          .where(({ r }: any) => eq(r.a, `x`)),
      ),
    )
  })

  it(`ignores the source alias`, () => {
    expect(
      identity((q) =>
        q.from({ r: source }).where(({ r }: any) => eq(r.a, `x`)),
      ),
    ).toEqual(
      identity((q) =>
        q.from({ s: source }).where(({ s }: any) => eq(s.a, `x`)),
      ),
    )
  })

  it(`separates literals, fields, and sources`, () => {
    const base = identity((q) =>
      q.from({ r: source }).where(({ r }: any) => eq(r.a, `x`)),
    )
    expect(
      identity((q) =>
        q.from({ r: source }).where(({ r }: any) => eq(r.a, `y`)),
      ),
    ).not.toEqual(base)
    expect(
      identity((q) =>
        q.from({ r: source }).where(({ r }: any) => eq(r.b, `x`)),
      ),
    ).not.toEqual(base)
    // A literal 1 and '1' match different rows.
    expect(
      identity((q) => q.from({ r: source }).where(({ r }: any) => eq(r.n, 1))),
    ).not.toEqual(
      identity((q) =>
        q.from({ r: source }).where(({ r }: any) => eq(r.n, `1`)),
      ),
    )
    const other = makeSource()
    expect(
      identity((q) => q.from({ r: other }).where(({ r }: any) => eq(r.a, `x`))),
    ).not.toEqual(base)
  })

  it(`keeps the structural identity for queries a partition cannot serve`, () => {
    const residual = identity((q) =>
      q
        .from({ r: source })
        .where(({ r }: any) => and(eq(r.a, `x`), gt(r.n, 1))),
    )
    expect(residual).toEqual(
      identity((q) =>
        q
          .from({ r: source })
          .where(({ r }: any) => and(gt(r.n, 1), eq(r.a, `x`))),
      ),
    )
    expect(residual).not.toEqual(
      identity((q) =>
        q
          .from({ r: source })
          .where(({ r }: any) => and(eq(r.a, `x`), gt(r.n, 2))),
      ),
    )
    expect((residual as Array<unknown>)[0]).toBe(`query`)
    const pooled = identity((q) =>
      q.from({ r: source }).where(({ r }: any) => eq(r.a, `x`)),
    )
    expect((pooled as Array<unknown>)[0]).toBe(`pooled`)
  })
})
