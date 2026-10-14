import { describe, expectTypeOf, it } from 'vitest'
import { D2, join } from '../../src/index.js'
import type { IStreamBuilder, JoinType, KeyValue } from '../../src/index.js'

// `join(other, type)` is the only join operator. Its result type does not
// depend on the join type: every pair side is nullable, so an inner join's
// caller narrows or casts it. The removed `innerJoin` returned `[V1, V2]`.
type Left = { left: string }
type Right = { right: number }

describe(`join result types`, () => {
  it.each([`inner`, `left`, `right`, `full`, `anti`] as const)(
    `types a %s join's pair sides as nullable`,
    (type: JoinType) => {
      const graph = new D2()
      const left = graph.newInput<KeyValue<number, Left>>()
      const right = graph.newInput<KeyValue<number, Right>>()
      const joined = left.pipe(join(right, type))
      expectTypeOf(joined).toEqualTypeOf<
        IStreamBuilder<KeyValue<number, [Left | null, Right | null]>>
      >()
    },
  )

  it(`defaults to an inner join with the same result type`, () => {
    const graph = new D2()
    const left = graph.newInput<KeyValue<number, Left>>()
    const right = graph.newInput<KeyValue<number, Right>>()
    expectTypeOf(left.pipe(join(right))).toEqualTypeOf<
      IStreamBuilder<KeyValue<number, [Left | null, Right | null]>>
    >()
  })
})
