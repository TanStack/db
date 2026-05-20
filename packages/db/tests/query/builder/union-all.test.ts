import { describe, expect, it } from 'vitest'
import { CollectionImpl } from '../../../src/collection/index.js'
import { Query, getQueryIR } from '../../../src/query/builder/index.js'

interface Employee {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
}

interface Department {
  id: number
  name: string
  budget: number
  location: string
}

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

describe(`QueryBuilder.unionAll`, () => {
  it(`sets a union source from multiple sources`, () => {
    const builder = new Query()

    const query = builder.unionAll({
      employees: employeesCollection,
      departments: departmentsCollection,
    })
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`unionFrom`)
    expect(builtQuery.from.alias).toBe(`employees`)
    if (builtQuery.from.type !== `unionFrom`) {
      throw new Error(`Expected unionFrom`)
    }
    expect(builtQuery.from.sources.map((source) => source.alias)).toEqual([
      `employees`,
      `departments`,
    ])
  })

  it(`allows a single source`, () => {
    const builder = new Query()

    const query = builder.unionAll({ employees: employeesCollection })
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`collectionRef`)
    expect(builtQuery.from.alias).toBe(`employees`)
  })

  it(`sets a result union from query branches`, () => {
    const builder = new Query()
    const employeeRows = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        label: employees.name,
      }))
    const departmentRows = builder
      .from({ departments: departmentsCollection })
      .select(({ departments }) => ({
        id: departments.id,
        label: departments.name,
      }))

    const query = builder.unionAll(employeeRows, departmentRows)
    const builtQuery = getQueryIR(query)

    expect(builtQuery.from).toBeDefined()
    expect(builtQuery.from.type).toBe(`unionAll`)
    if (builtQuery.from.type !== `unionAll`) {
      throw new Error(`Expected unionAll`)
    }
    expect(builtQuery.from.queries).toHaveLength(2)
  })
})
