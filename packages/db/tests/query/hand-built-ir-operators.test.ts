import { describe, expect, it } from 'vitest'
import {
  Query,
  count,
  createCollection,
  groupingCompiler,
  include,
  includesRuntime,
} from '../../src/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import {
  GroupingOperatorRequiredError,
  IncludeOperatorRequiredError,
} from '../../src/errors.js'
import { BaseQueryBuilder } from '../../src/query/builder/index.js'
import { getQueryIR } from '../../src/query/builder/query-ir.js'
import { IncludesSubquery } from '../../src/query/ir.js'
import {
  createLiveQueryCollection,
  eq,
  toArray,
} from '../../src/query/index.js'
import type { Aggregate } from '../../src/query/ir.js'

// Code that builds query IR by hand passes operator code to `IR.Aggregate`
// and `IR.IncludesSubquery`. The public entry exports that code, and it must
// be the same value the operator functions carry, so hand-built and
// builder-built IR compile the same way.
describe(`operator code for hand-built IR`, () => {
  it(`exports the grouping compiler that aggregates carry`, () => {
    expect(groupingCompiler).toBe(count(1).grouping)
  })

  it(`exports the include runtime that include() carries`, () => {
    const issues = createCollection(
      mockSyncCollectionOptions<{ id: number }>({
        id: `hand-built-ir-issues`,
        getKey: (issue) => issue.id,
        initialData: [],
      }),
    )
    expect(includesRuntime).toBe(
      include(new Query().from({ i: issues })).runtime,
    )
  })

  // Paths the aggregate-select oracle's grammar does not generate: a caller
  // that still passes the old IncludesSubquery arguments, and an aggregate in
  // orderBy. Both must fail when the query compiles, with the coded error for
  // the missing operator, not later with a TypeError or a wrong result.
  const rows = () =>
    createCollection(
      mockSyncCollectionOptions<{ id: number; k: string }>({
        id: `hand-built-ir-${Math.random().toString(36).slice(2)}`,
        getKey: (row) => row.id,
        initialData: [{ id: 1, k: `a` }],
      }),
    )

  it(`rejects an include whose runtime slot holds the old parentFilters argument`, () => {
    const parents = rows()
    const children = rows()
    expect(() =>
      createLiveQueryCollection((q) => {
        const ir = getQueryIR(
          q.from({ p: parents }).select(({ p }) => ({
            id: p.id,
            kids: toArray(
              q.from({ c: children }).where(({ c }) => eq(c.k, p.k)),
            ),
          })),
        )
        const kids = ir.select!.kids as IncludesSubquery
        // The argument order before this change: parentFilters fifth.
        const shifted = new (IncludesSubquery as any)(
          kids.query,
          kids.correlationField,
          kids.childCorrelationField,
          `kids`,
          kids.parentFilters ?? [],
        )
        return new BaseQueryBuilder({
          ...ir,
          select: { ...ir.select, kids: shifted },
        }) as any
      }),
    ).toThrow(IncludeOperatorRequiredError)
  })

  it(`rejects an orderBy aggregate without the grouping compiler`, () => {
    const source = rows()
    expect(() =>
      createLiveQueryCollection((q) => {
        const ir = getQueryIR(
          // No groupBy and no select aggregate: only orderBy reads one.
          q
            .from({ c: source })
            .select(({ c }) => ({ k: c.k }))
            .orderBy(({ c }) => count(c.id)),
        )
        const strip = (aggregate: Aggregate) =>
          Object.assign(
            Object.create(Object.getPrototypeOf(aggregate)),
            aggregate,
            { grouping: undefined },
          )
        return new BaseQueryBuilder({
          ...ir,
          orderBy: ir.orderBy!.map((clause) => ({
            ...clause,
            expression: strip(clause.expression as unknown as Aggregate),
          })),
        }) as any
      }),
    ).toThrow(GroupingOperatorRequiredError)
  })
})
