import { describe, expect, it } from "vitest"
import { queryBuilder } from "../../../src/query/query-builder.js"
import type { Input, Schema } from "../../../src/query/types.js"

// Test schema
interface Employee extends Input {
  id: number
  name: string
  department_id: number | null
}

interface Department extends Input {
  id: number
  name: string
  budget: number
}

// Make sure TestSchema extends Schema
interface TestSchema extends Schema {
  employees: Employee
  departments: Department
}

// Define interfaces for the CTE result types
interface EmployeeCTE {
  id: number
  name: string
}

interface EmployeeWithDeptCTE {
  id: number
  name: string
  department_id: number | null
}

interface DepartmentCTE {
  id: number
  name: string
}

describe(`QueryBuilder.with`, () => {
  it(`defines a simple CTE correctly`, () => {
    // Explicitly provide the result type for better type checking
    const query = queryBuilder<TestSchema>()
      .with<`emp_cte`, EmployeeCTE>(`emp_cte`, (q) =>
        q.from(`employees`).select(`@id`, `@name`)
      )
      .from(`emp_cte`)
      .select(`@id`, `@name`)

    const builtQuery = query._query

    expect(builtQuery.with).toBeDefined()
    expect(builtQuery.with).toHaveLength(1)
    expect(builtQuery.with?.[0]!.as).toBe(`emp_cte`)
    expect(builtQuery.with?.[0]!.from).toBe(`employees`)
    expect(builtQuery.with?.[0]!.select).toHaveLength(2)
    expect(builtQuery.from).toBe(`emp_cte`)
  })

  it(`defines multiple CTEs correctly`, () => {
    const query = queryBuilder<TestSchema>()
      .with<`emp_cte`, EmployeeWithDeptCTE>(`emp_cte`, (q) =>
        q.from(`employees`).select(`@id`, `@name`, `@department_id`)
      )
      .with<`dept_cte`, DepartmentCTE>(`dept_cte`, (q) =>
        q.from(`departments`).select(`@id`, `@name`)
      )
      .from(`emp_cte`)
      .join({
        type: `inner`,
        from: `dept_cte`,
        on: [`@emp_cte.department_id`, `=`, `@dept_cte.id`],
      })
      .select(`@emp_cte.id`, `@emp_cte.name`, `@dept_cte.name`)

    const builtQuery = query._query

    expect(builtQuery.with).toBeDefined()
    expect(builtQuery.with).toHaveLength(2)
    expect(builtQuery.with?.[0]!.as).toBe(`emp_cte`)
    expect(builtQuery.with?.[1]!.as).toBe(`dept_cte`)
    expect(builtQuery.from).toBe(`emp_cte`)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join?.[0]!.from).toBe(`dept_cte`)
  })

  it(`allows chaining other methods after with`, () => {
    // Define the type of filtered employees
    interface FilteredEmployees {
      id: number
      name: string
    }

    const query = queryBuilder<TestSchema>()
      .with<`filtered_employees`, FilteredEmployees>(
        `filtered_employees`,
        (q) =>
          q
            .from(`employees`)
            .where(`@department_id`, `=`, 1)
            .select(`@id`, `@name`)
      )
      .from(`filtered_employees`)
      .where(`@id`, `>`, 100)
      .select(`@id`, { employee_name: `@name` })

    const builtQuery = query._query

    expect(builtQuery.with).toBeDefined()
    expect(builtQuery.with?.[0]!.where).toBeDefined()
    expect(builtQuery.from).toBe(`filtered_employees`)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toHaveLength(2)
  })
})
