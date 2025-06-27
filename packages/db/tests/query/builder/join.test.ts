import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection.js"
import { BaseQueryBuilder, getQuery } from "../../../src/query/builder/index.js"
import { and, eq, gt } from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number
  salary: number
}

interface Department {
  id: number
  name: string
  budget: number
  location: string
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

describe(`QueryBuilder.join`, () => {
  it(`adds a simple default (left) join`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )

    const builtQuery = getQuery(query)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join).toHaveLength(1)

    const join = builtQuery.join![0]!
    expect(join.type).toBe(`left`)
    expect(join.from.type).toBe(`collectionRef`)
    if (join.from.type === `collectionRef`) {
      expect(join.from.alias).toBe(`departments`)
      expect(join.from.collection).toBe(departmentsCollection)
    }
  })

  it(`supports multiple joins`, () => {
    const projectsCollection = new CollectionImpl<{
      id: number
      name: string
      department_id: number
    }>({
      id: `projects`,
      getKey: (item) => item.id,
      sync: { sync: () => {} },
    })

    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .join({ projects: projectsCollection }, ({ departments, projects }) =>
        eq(departments.id, projects.department_id)
      )

    const builtQuery = getQuery(query)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join).toHaveLength(2)

    const firstJoin = builtQuery.join![0]!
    const secondJoin = builtQuery.join![1]!

    expect(firstJoin.from.alias).toBe(`departments`)
    expect(secondJoin.from.alias).toBe(`projects`)
  })

  it(`allows accessing joined table in select`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .select(({ employees, departments }) => ({
        id: employees.id,
        name: employees.name,
        department_name: departments.name,
        department_budget: departments.budget,
      }))

    const builtQuery = getQuery(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`name`)
    expect(builtQuery.select).toHaveProperty(`department_name`)
    expect(builtQuery.select).toHaveProperty(`department_budget`)
  })

  it(`allows accessing joined table in where`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .where(({ departments }) => gt(departments.budget, 1000000))

    const builtQuery = getQuery(query)
    expect(builtQuery.where).toBeDefined()
    expect((builtQuery.where as any)?.name).toBe(`gt`)
  })

  it(`supports sub-queries in joins`, () => {
    const subQuery = new BaseQueryBuilder()
      .from({ departments: departmentsCollection })
      .where(({ departments }) => gt(departments.budget, 500000))

    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join({ bigDepts: subQuery as any }, ({ employees, bigDepts }) =>
        eq(employees.department_id, (bigDepts as any).id)
      )

    const builtQuery = getQuery(query)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join).toHaveLength(1)

    const join = builtQuery.join![0]!
    expect(join.from.alias).toBe(`bigDepts`)
    expect(join.from.type).toBe(`queryRef`)
  })

  it(`creates a complex query with multiple joins, select and where`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .where(({ employees, departments }) =>
        and(gt(employees.salary, 50000), gt(departments.budget, 1000000))
      )
      .select(({ employees, departments }) => ({
        id: employees.id,
        name: employees.name,
        department_name: departments.name,
        dept_location: departments.location,
      }))

    const builtQuery = getQuery(query)
    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join).toHaveLength(1)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`department_name`)
  })

  it(`supports chained joins with different sources`, () => {
    const usersCollection = new CollectionImpl<{
      id: number
      name: string
      employee_id: number
    }>({
      id: `users`,
      getKey: (item) => item.id,
      sync: { sync: () => {} },
    })

    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .join({ users: usersCollection }, ({ employees, users }) =>
        eq(employees.id, users.employee_id)
      )

    const builtQuery = getQuery(query)
    expect(builtQuery.join).toBeDefined()
    expect(builtQuery.join).toHaveLength(2)

    const firstJoin = builtQuery.join![0]!
    const secondJoin = builtQuery.join![1]!

    expect(firstJoin.from.alias).toBe(`departments`)
    expect(secondJoin.from.alias).toBe(`users`)
  })

  it(`supports entire joined records in select`, () => {
    const builder = new BaseQueryBuilder()
    const query = builder
      .from({ employees: employeesCollection })
      .join(
        { departments: departmentsCollection },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id)
      )
      .select(({ employees, departments }) => ({
        employee: employees,
        department: departments,
      }))

    const builtQuery = getQuery(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`employee`)
    expect(builtQuery.select).toHaveProperty(`department`)
  })
})
