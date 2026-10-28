// Shared fixtures for the loadSubset demand tests: the exact-demand record, the
// axis pairs that each differ in one request-data field, and the conversion of a
// demand to LoadSubsetOptions. The identity laws are owned by
// load-subset-oracle.property.test.ts.
import { Func, PropRef, Value } from '../../src/query/ir.js'
import type { LoadSubsetOptions } from '../../src/types.js'

export type ExactDemand = {
  values: ReadonlyArray<number>
  orderField: `rank` | `score`
  direction: `asc` | `desc`
  nulls: `first` | `last`
  stringSort: `lexical` | `locale`
  offset: number
  limit: number | undefined
  cursorBoundary: number | undefined
}

const rankRef = new PropRef<number>([`rank`])
const scoreRef = new PropRef<number>([`score`])

// Each pair differs in only one request-data axis. A deduper that drops that
// axis would wrongly reuse the first acquisition at the second request.
export const exactDemandAxisPairs: ReadonlyArray<
  readonly [axis: string, first: ExactDemand, second: ExactDemand]
> = (() => {
  const first: ExactDemand = {
    values: [1, 2],
    orderField: `rank`,
    direction: `asc`,
    nulls: `last`,
    stringSort: `lexical`,
    offset: 0,
    limit: 2,
    cursorBoundary: undefined,
  }
  return [
    [`predicate values`, first, { ...first, values: [1, 3] }],
    [`order field`, first, { ...first, orderField: `score` }],
    [`direction`, first, { ...first, direction: `desc` }],
    [`null placement`, first, { ...first, nulls: `first` }],
    [`string sort`, first, { ...first, stringSort: `locale` }],
    [`offset`, first, { ...first, offset: 1 }],
    [`limit`, first, { ...first, limit: undefined }],
    [`cursor boundary`, first, { ...first, cursorBoundary: 1 }],
  ]
})()

export function toLoadSubsetOptions(demand: ExactDemand): LoadSubsetOptions {
  const orderRef = demand.orderField === `rank` ? rankRef : scoreRef
  return {
    where: new Func(`in`, [scoreRef, new Value([...demand.values])]),
    orderBy: [
      {
        expression: orderRef,
        compareOptions: {
          direction: demand.direction,
          nulls: demand.nulls,
          stringSort: demand.stringSort,
        },
      },
    ],
    offset: demand.offset,
    limit: demand.limit,
    cursor:
      demand.cursorBoundary === undefined
        ? undefined
        : {
            whereFrom: new Func(demand.direction === `asc` ? `gt` : `lt`, [
              orderRef,
              new Value(demand.cursorBoundary),
            ]),
            whereCurrent: new Func(`eq`, [
              orderRef,
              new Value(demand.cursorBoundary),
            ]),
            lastKey: demand.cursorBoundary,
          },
  }
}
