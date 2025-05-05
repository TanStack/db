import { describe, expect, it, vi } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number
  salary: number
}

interface Department extends Input {
  id: number
  name: string
  budget: number
  location: string
}

// Make sure TestSchema extends Schema
interface TestSchema extends Schema {
  employees: Employee
  departments: Department
}

describe(`QueryBuilder.select with function calls`, () => {
  it(`handles aggregate functions without using `, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, {
        sum_salary: { SUM: `@salary` },
        avg_salary: { AVG: `@salary` },
        count: { COUNT: `@id` },
        min_salary: { MIN: `@salary` },
        max_salary: { MAX: `@salary` },
      })

    const builtQuery = query._query
    expect(builtQuery.select).toMatchObject([
      `@id`,
      {
        sum_salary: { SUM: `@salary` },
        avg_salary: { AVG: `@salary` },
        count: { COUNT: `@id` },
        min_salary: { MIN: `@salary` },
        max_salary: { MAX: `@salary` },
      },
    ])
  })

  it(`handles string functions without using `, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, {
        upper_name: { UPPER: `@name` },
        lower_name: { LOWER: `@name` },
        name_length: { LENGTH: `@name` },
        concat_text: { CONCAT: [`Employee: `, `@name`] },
      })

    const builtQuery = query._query
    expect(builtQuery.select).toMatchObject([
      `@id`,
      {
        upper_name: { UPPER: `@name` },
        lower_name: { LOWER: `@name` },
        name_length: { LENGTH: `@name` },
        concat_text: { CONCAT: [`Employee: `, `@name`] },
      },
    ])
  })

  it(`handles JSON functions without using `, () => {
    // Create a field that would contain JSON
    const query = queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, {
        json_value: { JSON_EXTRACT: [`@name`, `$.property`] },
      })

    const builtQuery = query._query
    expect(builtQuery.select).toHaveLength(2)
    expect(builtQuery.select[1]).toHaveProperty(`json_value`)
  })

  it(`validates and filters out invalid function calls`, () => {
    // Mock console.warn to verify warnings
    const consoleWarnMock = vi
      .spyOn(console, `warn`)
      .mockImplementation(() => {})

    queryBuilder<TestSchema>()
      .from(`employees`)
      .select(`@id`, {
        // This is an invalid function that should trigger a warning
        // @ts-expect-error
        invalid_func: { INVALID_FUNCTION: `@name` },
      })

    // Verify the warning was logged
    expect(consoleWarnMock).toHaveBeenCalledWith(
      expect.stringContaining(`Unsupported function: INVALID_FUNCTION`)
    )

    // Restore the original console.warn
    consoleWarnMock.mockRestore()
  })

  it(`combines function calls with other select elements`, () => {
    const query = queryBuilder<TestSchema>()
      .from(`employees`, `e`)
      .join({
        type: `inner`,
        from: `departments`,
        as: `d`,
        on: [`@e.department_id`, `=`, `@d.id`],
      })
      .select(`@e.id`, `@e.name`, `@d.name`, {
        dept_budget: `@d.budget`,
        sum_salary: { SUM: `@e.salary` },
        upper_name: { UPPER: `@e.name` },
      })

    const builtQuery = query._query
    expect(builtQuery.select).toHaveLength(4)
    expect(builtQuery.select[0]).toBe(`@e.id`)
    expect(builtQuery.select[1]).toBe(`@e.name`)
    expect(builtQuery.select[2]).toBe(`@d.name`)
    expect(builtQuery.select[3]).toHaveProperty(`dept_budget`)
    expect(builtQuery.select[3]).toHaveProperty(`sum_salary`)
    expect(builtQuery.select[3]).toHaveProperty(`upper_name`)
  })
})
