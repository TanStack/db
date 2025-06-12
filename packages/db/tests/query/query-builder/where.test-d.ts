import { describe, expectTypeOf, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
}

interface Department extends Input {
  id: number
  name: string
  budget: number
}

interface TestSchema extends Schema {
  employees: Employee
  departments: Department
}

describe(`QueryBuilder.where type tests`, () => {
  it(`should type check regular operators correctly`, () => {
    const qb = queryBuilder<TestSchema>().from(`employees`)

    // These should type check correctly
    expectTypeOf(qb.where(`@id`, `=`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `!=`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `<`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `<=`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `>`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `>=`, 1)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@name`, `like`, `John%`)).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@department_id`, `is`, null)).toEqualTypeOf<
      typeof qb
    >()
    expectTypeOf(qb.where(`@department_id`, `is not`, null)).toEqualTypeOf<
      typeof qb
    >()

    // These should error
    // @ts-expect-error - cannot use array with non-set operators
    qb.where(`@id`, `=`, [1, 2, 3])
    // @ts-expect-error - cannot use array with non-set operators
    qb.where(`@id`, `!=`, [1, 2, 3])
  })

  it(`should type check set membership operators correctly`, () => {
    const qb = queryBuilder<TestSchema>().from(`employees`)

    // These should type check correctly
    expectTypeOf(qb.where(`@id`, `in`, [1, 2, 3])).toEqualTypeOf<typeof qb>()
    expectTypeOf(qb.where(`@id`, `not in`, [1, 2, 3])).toEqualTypeOf<
      typeof qb
    >()

    // These should error
    // @ts-expect-error - must use array with set operators
    qb.where(`@id`, `in`, 1)
    // @ts-expect-error - must use array with set operators
    qb.where(`@id`, `not in`, 1)
    // @ts-expect-error - must use array with set operators
    qb.where(`@id`, `in`, `string`)
  })
})
