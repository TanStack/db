import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { buildQuery } from "../../../src/query/builder/index.js"
import { and, eq, gt, or } from "../../../src/query/builder/functions.js"

/**
 * This is a set of tests for the buildQuery function.
 * This function is not used directly by the user, but is used by the
 * liveQueryCollectionOptions.query callback or via a useLiveQuery call.
 */

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number
  salary: number
  active: boolean
}

interface Department {
  id: number
  name: string
  budget: number
}

// Test collections
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

const departmentsCollection = new CollectionImpl<Department>({
  id: `departments`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`buildQuery function`, () => {
  it(`creates a simple query`, () => {
    const query = buildQuery((q) =>
      q
        .from({ employees: employeesCollection })
        .where(({ employees }) => eq(employees.active, true))
        .select(({ employees }) => ({
          id: employees.id,
          name: employees.name,
        }))
    )

    // buildQuery returns Query IR directly
    expect(query.from).toBeDefined()
    expect(query.from.type).toBe(`collectionRef`)
    expect(query.where).toBeDefined()
    expect(query.select).toBeDefined()
  })

  it(`creates a query with join`, () => {
    const query = buildQuery((q) =>
      q
        .from({ employees: employeesCollection })
        .join(
          { departments: departmentsCollection },
          ({ employees, departments }) =>
            eq(employees.department_id, departments.id)
        )
        .select(({ employees, departments }) => ({
          employee_name: employees.name,
          department_name: departments.name,
        }))
    )

    expect(query.from).toBeDefined()
    expect(query.join).toBeDefined()
    expect(query.join).toHaveLength(1)
    expect(query.select).toBeDefined()
  })

  it(`creates a query with multiple conditions`, () => {
    const query = buildQuery((q) =>
      q
        .from({ employees: employeesCollection })
        .where(({ employees }) =>
          and(eq(employees.active, true), gt(employees.salary, 50000))
        )
        .orderBy(({ employees }) => employees.name)
        .limit(10)
        .select(({ employees }) => ({
          id: employees.id,
          name: employees.name,
          salary: employees.salary,
        }))
    )

    expect(query.from).toBeDefined()
    expect(query.where).toBeDefined()
    expect(query.orderBy).toBeDefined()
    expect(query.limit).toBe(10)
    expect(query.select).toBeDefined()
  })

  it(`works as described in the README example`, () => {
    const commentsCollection = new CollectionImpl<{
      id: number
      user_id: number
      content: string
      date: string
    }>({
      id: `comments`,
      getKey: (item) => item.id,
      sync: { sync: () => {} },
    })

    const usersCollection = new CollectionImpl<{ id: number; name: string }>({
      id: `users`,
      getKey: (item) => item.id,
      sync: { sync: () => {} },
    })

    const query = buildQuery((q) =>
      q
        .from({ comment: commentsCollection })
        .join({ user: usersCollection }, ({ comment, user }) =>
          eq(comment.user_id, user.id)
        )
        .where(({ comment }) => or(eq(comment.id, 1), eq(comment.id, 2)))
        .orderBy(({ comment }) => comment.date, `desc`)
        .select(({ comment, user }) => ({
          id: comment.id,
          content: comment.content,
          user,
        }))
    )

    expect(query.from).toBeDefined()
    expect(query.join).toBeDefined()
    expect(query.where).toBeDefined()
    expect(query.orderBy).toBeDefined()
    expect(query.select).toBeDefined()

    const select = query.select!
    expect(select).toHaveProperty(`id`)
    expect(select).toHaveProperty(`content`)
    expect(select).toHaveProperty(`user`)
  })
})
