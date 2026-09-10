import { describe, expectTypeOf, test } from 'vitest'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createAggregate } from '../../src/query/aggregates.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Aggregate } from '../../src/query/ir.js'

type Todo = {
  id: number
  listId: number
  text: string
  points: number
}

const todosCollection = createCollection(
  mockSyncCollectionOptions<Todo>({
    id: `custom-agg-type-todos`,
    getKey: (todo) => todo.id,
    initialData: [],
    autoIndex: `eager`,
  }),
)

const groupConcat = createAggregate<string, [separator?: string]>(
  `group_concat_types`,
  (ctx, [separator = `,`]) => ({
    preMap: (entry) => String(ctx.value(entry) ?? ``),
    reduce: (values) => values.map(([text]) => text).join(separator),
  }),
)

const pointsRange = createAggregate<[number, number]>(
  `points_range_types`,
  (ctx) => ({
    preMap: (entry) => Number(ctx.value(entry)),
    reduce: (values) => values.reduce((acc, [value]) => acc + value, 0),
    postMap: (result) => [result, result] as [number, number],
  }),
)

describe(`custom aggregate types`, () => {
  test(`createAggregate returns a typed Aggregate builder`, () => {
    expectTypeOf(groupConcat(`x`)).toEqualTypeOf<Aggregate<string>>()
    expectTypeOf(pointsRange(1)).toEqualTypeOf<Aggregate<[number, number]>>()
  })

  test(`extra params are typed and optional params may be omitted`, () => {
    groupConcat(`x`)
    groupConcat(`x`, `|`)
    // @ts-expect-error separator must be a string
    groupConcat(`x`, 1)
    // @ts-expect-error no third parameter is declared
    groupConcat(`x`, `|`, `extra`)
    // @ts-expect-error pointsRange declares no extra parameters
    pointsRange(1, 2)
  })

  test(`result type flows into select() inference`, () => {
    const summary = createLiveQueryCollection({
      startSync: false,
      query: (q) =>
        q
          .from({ todo: todosCollection })
          .groupBy(({ todo }) => todo.listId)
          .select(({ todo }) => ({
            listId: todo.listId,
            names: groupConcat(todo.text, ` | `),
            range: pointsRange(todo.points),
          })),
    })

    const row = summary.get(1)
    expectTypeOf(row).toMatchTypeOf<
      | {
          listId: number
          names: string
          range: [number, number]
        }
      | undefined
    >()
  })
})
