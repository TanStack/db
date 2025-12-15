import { describe, expect, it } from "vitest"
import { CollectionImpl } from "../../../src/collection/index.js"
import { Query, getQueryIR } from "../../../src/query/builder/index.js"
import {
  avg,
  count,
  eq,
  isUndefined,
  length,
  not,
  upper,
} from "../../../src/query/builder/functions.js"

// Test schema
interface Employee {
  id: number
  name: string
  department_id: number | null
  salary: number
  active: boolean
  profile?: {
    bio: string
    skills: Array<string>
    contact: {
      email: string
      phone: string
    }
  }
  address?: {
    street: string
    city: string
    country: string
  }
}

// Test collection
const employeesCollection = new CollectionImpl<Employee>({
  id: `employees`,
  getKey: (item) => item.id,
  sync: { sync: () => {} },
})

describe(`QueryBuilder.select`, () => {
  it(`sets the select clause correctly with simple properties`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(typeof builtQuery.select).toBe(`object`)
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`name`)
  })

  it(`handles aliased expressions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        employee_name: employees.name,
        salary_doubled: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`employee_name`)
    expect(builtQuery.select).toHaveProperty(`salary_doubled`)
  })

  it(`handles function calls in select`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        upper_name: upper(employees.name),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`upper_name`)
    const upperNameExpr = (builtQuery.select as any).upper_name
    expect(upperNameExpr.type).toBe(`func`)
    expect(upperNameExpr.name).toBe(`upper`)
  })

  it(`supports aggregate functions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .groupBy(({ employees }) => employees.department_id)
      .select(({ employees }) => ({
        department_id: employees.department_id,
        count: count(employees.id),
        avg_salary: avg(employees.salary),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`count`)
    expect(builtQuery.select).toHaveProperty(`avg_salary`)
  })

  it(`overrides previous select calls`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
      }))
      .select(({ employees }) => ({
        id: employees.id,
        salary: employees.salary,
      })) // This should override the previous select

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`salary`)
    expect(builtQuery.select).not.toHaveProperty(`name`)
  })

  it(`supports selecting entire records`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        employee: employees,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`employee`)
  })

  it(`handles complex nested selections`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        basicInfo: {
          id: employees.id,
          name: employees.name,
        },
        salary: employees.salary,
        upper_name: upper(employees.name),
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`basicInfo`)
    expect(builtQuery.select).toHaveProperty(`salary`)
    expect(builtQuery.select).toHaveProperty(`upper_name`)
  })

  it(`allows combining with other methods`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .where(({ employees }) => eq(employees.active, true))
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        salary: employees.salary,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.where).toBeDefined()
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`name`)
    expect(builtQuery.select).toHaveProperty(`salary`)
  })

  it(`supports conditional expressions`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        is_high_earner: employees.salary, // Would need conditional logic in actual implementation
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`is_high_earner`)
  })

  it(`selects nested object properties`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        bio: employees.profile?.bio,
        skills: employees.profile?.skills,
        city: employees.address?.city,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`bio`)
    expect(builtQuery.select).toHaveProperty(`skills`)
    expect(builtQuery.select).toHaveProperty(`city`)
  })

  it(`selects deeply nested properties`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        email: employees.profile?.contact.email,
        phone: employees.profile?.contact.phone,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`email`)
    expect(builtQuery.select).toHaveProperty(`phone`)
  })

  it(`handles spread operator with nested objects`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        name: employees.name,
        ...employees.profile,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`id`)
    expect(builtQuery.select).toHaveProperty(`name`)
    // Note: The actual spreading behavior would depend on the implementation
  })

  it(`combines nested and computed properties`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        upperCity: upper(employees.address?.city),
        skillCount: count(employees.profile?.skills),
        fullAddress: employees.address,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`upperCity`)
    expect(builtQuery.select).toHaveProperty(`skillCount`)
    expect(builtQuery.select).toHaveProperty(`fullAddress`)

    const upperCityExpr = (builtQuery.select as any).upperCity
    expect(upperCityExpr.type).toBe(`func`)
    expect(upperCityExpr.name).toBe(`upper`)
  })

  it(`selects nested arrays and objects with aliasing`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        employeeId: employees.id,
        employeeName: employees.name,
        employeeSkills: employees.profile?.skills,
        contactInfo: employees.profile?.contact,
        location: {
          city: employees.address?.city,
          country: employees.address?.country,
        },
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`employeeId`)
    expect(builtQuery.select).toHaveProperty(`employeeName`)
    expect(builtQuery.select).toHaveProperty(`employeeSkills`)
    expect(builtQuery.select).toHaveProperty(`contactInfo`)
    expect(builtQuery.select).toHaveProperty(`location`)
  })

  it(`handles optional chaining with nested properties`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        hasProfile: not(isUndefined(employees.profile)),
        profileBio: employees.profile?.bio,
        addressStreet: employees.address?.street,
        contactEmail: employees.profile?.contact.email,
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`hasProfile`)
    expect(builtQuery.select).toHaveProperty(`profileBio`)
    expect(builtQuery.select).toHaveProperty(`addressStreet`)
    expect(builtQuery.select).toHaveProperty(`contactEmail`)
  })

  it(`selects partial nested objects`, () => {
    const builder = new Query()
    const query = builder
      .from({ employees: employeesCollection })
      .select(({ employees }) => ({
        id: employees.id,
        partialProfile: {
          bio: employees.profile?.bio,
          skillCount: length(employees.profile?.skills),
        },
        partialAddress: {
          city: employees.address?.city,
        },
      }))

    const builtQuery = getQueryIR(query)
    expect(builtQuery.select).toBeDefined()
    expect(builtQuery.select).toHaveProperty(`partialProfile`)
    expect(builtQuery.select).toHaveProperty(`partialAddress`)
  })
})
