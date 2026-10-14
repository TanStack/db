import { expectTypeOf, it } from 'vitest'
import { createCollection, useLocalLiveQuery } from '../src'

const rows = createCollection<{ id: number; name: string }>({
  getKey: (row) => row.id,
  sync: { sync: () => {} },
})

it(`preserves projections, disabled queries and single-result inference`, () => {
  const many = useLocalLiveQuery((q) =>
    q.from({ row: rows }).select(({ row }) => ({ name: row.name })),
  )
  expectTypeOf(many.data[0]!.name).toEqualTypeOf<string>()
  expectTypeOf(many.isEnabled).toEqualTypeOf<true>()
  const one = useLocalLiveQuery({
    query: (q) => q.from({ row: rows }).findOne(),
  })
  expectTypeOf(one.data?.id).toEqualTypeOf<number | undefined>()
  const conditional = useLocalLiveQuery((q) =>
    Math.random() > 0.5 ? q.from({ row: rows }) : undefined,
  )
  expectTypeOf(conditional.data).toBeNullable()
  expectTypeOf(conditional.isEnabled).toEqualTypeOf<boolean>()
  // A supplied Collection's loading policy belongs to its creator.
  // @ts-expect-error A local hook requires a query, not an existing Collection.
  useLocalLiveQuery(rows)
})
