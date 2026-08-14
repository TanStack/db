import { describe, expect, it } from 'vitest'
import { CollectionImpl } from '../../../src/collection/index.js'
import { DbClient, collectionOptions } from '../../../src/client.js'
import {
  InvalidSourceError,
  InvalidSourceTypeError,
  QueryMustHaveFromClauseError,
} from '../../../src/errors.js'
import {
  BaseQueryBuilder,
  Query,
  getQueryIR,
} from '../../../src/query/builder/index.js'
import { eq } from '../../../src/query/builder/functions.js'

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

  it(`preserves descriptor resolution after unioning sources`, () => {
    const employeeDescriptor = collectionOptions(`union-employees`, () => ({
      id: `union-employees`,
      getKey: (item: Employee) => item.id,
      sync: { sync: () => {} },
    }))
    const departmentDescriptor = collectionOptions(`union-departments`, () => ({
      id: `union-departments`,
      getKey: (item: Department) => item.id,
      sync: { sync: () => {} },
    }))
    const client = new DbClient()
    const builder = new BaseQueryBuilder({}, (options) =>
      client.collection(options),
    )

    const query = builder
      .unionAll({ employees: employeeDescriptor })
      .join(
        { departments: departmentDescriptor },
        ({ employees, departments }) =>
          eq(employees.department_id, departments.id),
        `inner`,
      )

    expect(getQueryIR(query).join).toHaveLength(1)
  })

  it(`preserves descriptor resolution after unioning query branches`, () => {
    const employeeDescriptor = collectionOptions(`branch-employees`, () => ({
      id: `branch-employees`,
      getKey: (item: Employee) => item.id,
      sync: { sync: () => {} },
    }))
    const departmentDescriptor = collectionOptions(
      `branch-departments`,
      () => ({
        id: `branch-departments`,
        getKey: (item: Department) => item.id,
        sync: { sync: () => {} },
      }),
    )
    const client = new DbClient()
    const builder = new BaseQueryBuilder({}, (options) =>
      client.collection(options),
    )
    const employeeRows = builder
      .from({ employees: employeeDescriptor })
      .select(({ employees: employee }) => ({ id: employee.id }))
    const departmentRows = builder
      .from({ departments: departmentDescriptor })
      .select(({ departments: department }) => ({ id: department.id }))

    const query = builder
      .unionAll(employeeRows, departmentRows)
      .join(
        { departments: departmentDescriptor },
        (refs) => eq(refs[`*`].id, refs.departments.id),
        `inner`,
      )

    expect(getQueryIR(query).join).toHaveLength(1)
  })

  it(`throws helpful errors for invalid source inputs`, () => {
    const builder = new Query()

    expect(() => builder.unionAll(`employees` as any)).toThrow(
      InvalidSourceTypeError,
    )
    expect(() => builder.unionAll(null as any)).toThrow(InvalidSourceTypeError)
    expect(() => builder.unionAll([employeesCollection] as any)).toThrow(
      InvalidSourceTypeError,
    )
    expect(() => builder.unionAll({ employees: [] } as any)).toThrow(
      InvalidSourceError,
    )
  })

  it(`rejects subqueries without a from clause`, () => {
    const builder = new Query()

    expect(() => builder.unionAll({ employees: new Query() as any })).toThrow(
      QueryMustHaveFromClauseError,
    )
  })
})
