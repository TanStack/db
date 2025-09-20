import { describe, expectTypeOf, test } from "vitest"
import { createCollection } from "../../../src/collection/index.js"
import { mockSyncCollectionOptions } from "../../utils.js"
import { Query } from "../../../src/query/builder/index.js"
import {
  add,
  and,
  avg,
  coalesce,
  concat,
  count,
  eq,
  gt,
  gte,
  ilike,
  length,
  like,
  lower,
  lt,
  lte,
  max,
  min,
  not,
  or,
  sum,
  upper,
} from "../../../src/query/builder/functions.js"
import type { RefLeaf } from "../../../src/query/builder/types.js"
import type { Aggregate, BasicExpression } from "../../../src/query/ir.js"

// Sample data types for comprehensive callback type testing
type User = {
  id: number
  name: string
  email: string
  age: number
  active: boolean
  department_id: number | null
  salary: number
  created_at: string
}

type Department = {
  id: number
  name: string
  budget: number
  location: string
  active: boolean
}

type Project = {
  id: number
  name: string
  user_id: number
  department_id: number
  budget: number
  status: string
  priority: number
}

function createTestCollections() {
  const usersCollection = createCollection(
    mockSyncCollectionOptions<User>({
      id: `test-users`,
      getKey: (user) => user.id,
      initialData: [],
    })
  )

  const departmentsCollection = createCollection(
    mockSyncCollectionOptions<Department>({
      id: `test-departments`,
      getKey: (dept) => dept.id,
      initialData: [],
    })
  )

  const projectsCollection = createCollection(
    mockSyncCollectionOptions<Project>({
      id: `test-projects`,
      getKey: (project) => project.id,
      initialData: [],
    })
  )

  return { usersCollection, departmentsCollection, projectsCollection }
}

describe(`Query Builder Callback Types`, () => {
  const { usersCollection, departmentsCollection, projectsCollection } =
    createTestCollections()

  describe(`SELECT callback types`, () => {
    test(`refProxy types in select callback`, () => {
      new Query().from({ user: usersCollection }).select(({ user }) => {
        // Test that properties are accessible and have correct types (now using Ref)
        expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
        expectTypeOf(user.name).toEqualTypeOf<RefLeaf<string>>()
        expectTypeOf(user.email).toEqualTypeOf<RefLeaf<string>>()
        expectTypeOf(user.age).toEqualTypeOf<RefLeaf<number>>()
        expectTypeOf(user.active).toEqualTypeOf<RefLeaf<boolean>>()
        expectTypeOf(user.department_id).toEqualTypeOf<RefLeaf<number> | null>()
        expectTypeOf(user.salary).toEqualTypeOf<RefLeaf<number>>()
        expectTypeOf(user.created_at).toEqualTypeOf<RefLeaf<string>>()

        return {
          id: user.id,
          name: user.name,
          email: user.email,
        }
      })
    })

    test(`refProxy with joins in select callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .select(({ user, dept }) => {
          // Test cross-table property access
          expectTypeOf(
            user.department_id
          ).toEqualTypeOf<RefLeaf<number> | null>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.name).toEqualTypeOf<RefLeaf<string> | undefined>()
          expectTypeOf(dept?.budget).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()

          return {
            user_name: user.name,
            dept_name: dept?.name,
            user_email: user.email,
            dept_budget: dept?.budget,
          }
        })
    })

    test(`expression functions in select callback`, () => {
      new Query().from({ user: usersCollection }).select(({ user }) => {
        // Test that expression functions return correct types
        expectTypeOf(upper(user.name)).toEqualTypeOf<BasicExpression<string>>()
        expectTypeOf(lower(user.email)).toEqualTypeOf<BasicExpression<string>>()
        expectTypeOf(length(user.name)).toEqualTypeOf<BasicExpression<number>>()
        expectTypeOf(concat(user.name, user.email)).toEqualTypeOf<
          BasicExpression<string>
        >()
        expectTypeOf(add(user.age, user.salary)).toEqualTypeOf<
          BasicExpression<number>
        >()
        expectTypeOf(coalesce(user.name, `Unknown`)).toEqualTypeOf<
          BasicExpression<any>
        >()

        return {
          upper_name: upper(user.name),
          lower_email: lower(user.email),
          name_length: length(user.name),
          full_info: concat(user.name, ` - `, user.email),
          age_plus_salary: add(user.age, user.salary),
          safe_name: coalesce(user.name, `Unknown`),
        }
      })
    })

    test(`aggregate functions in select callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.department_id)
        .select(({ user }) => {
          // Test that aggregate functions return correct types
          expectTypeOf(count(user.id)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(avg(user.age)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(sum(user.salary)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(min(user.age)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(max(user.salary)).toEqualTypeOf<Aggregate<number>>()

          return {
            department_id: user.department_id,
            user_count: count(user.id),
            avg_age: avg(user.age),
            total_salary: sum(user.salary),
            min_age: min(user.age),
            max_salary: max(user.salary),
          }
        })
    })
  })

  describe(`WHERE callback types`, () => {
    test(`refProxy types in where callback`, () => {
      new Query().from({ user: usersCollection }).where(({ user }) => {
        // Test that user is the correct type in where
        expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
        expectTypeOf(user.active).toEqualTypeOf<RefLeaf<boolean>>()
        expectTypeOf(user.department_id).toEqualTypeOf<RefLeaf<number> | null>()

        return eq(user.active, true)
      })
    })

    test(`comparison operators in where callback`, () => {
      new Query().from({ user: usersCollection }).where(({ user }) => {
        // Test comparison operators return Expression<boolean>
        expectTypeOf(eq(user.active, true)).toEqualTypeOf<
          BasicExpression<boolean>
        >()
        expectTypeOf(gt(user.age, 25)).toEqualTypeOf<BasicExpression<boolean>>()
        expectTypeOf(gte(user.salary, 50000)).toEqualTypeOf<
          BasicExpression<boolean>
        >()
        expectTypeOf(lt(user.age, 65)).toEqualTypeOf<BasicExpression<boolean>>()
        expectTypeOf(lte(user.salary, 100000)).toEqualTypeOf<
          BasicExpression<boolean>
        >()

        // Test string comparisons
        expectTypeOf(eq(user.name, `John`)).toEqualTypeOf<
          BasicExpression<boolean>
        >()
        expectTypeOf(like(user.email, `%@company.com`)).toEqualTypeOf<
          BasicExpression<boolean>
        >()
        expectTypeOf(ilike(user.name, `john%`)).toEqualTypeOf<
          BasicExpression<boolean>
        >()

        return and(
          eq(user.active, true),
          gt(user.age, 25),
          like(user.email, `%@company.com`)
        )
      })
    })

    test(`logical operators in where callback`, () => {
      new Query().from({ user: usersCollection }).where(({ user }) => {
        // Test logical operators
        expectTypeOf(
          and(eq(user.active, true), gt(user.age, 25))
        ).toEqualTypeOf<BasicExpression<boolean>>()
        expectTypeOf(
          or(eq(user.active, false), lt(user.age, 18))
        ).toEqualTypeOf<BasicExpression<boolean>>()
        expectTypeOf(not(eq(user.active, false))).toEqualTypeOf<
          BasicExpression<boolean>
        >()

        return and(
          eq(user.active, true),
          or(gt(user.age, 30), gte(user.salary, 75000)),
          not(eq(user.department_id, null))
        )
      })
    })

    test(`refProxy with joins in where callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .where(({ user, dept }) => {
          expectTypeOf(user.active).toEqualTypeOf<RefLeaf<boolean>>()
          expectTypeOf(dept?.active).toEqualTypeOf<
            RefLeaf<boolean> | undefined
          >()
          expectTypeOf(dept?.budget).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()

          return and(
            eq(user.active, true),
            eq(dept?.active, true),
            gt(dept?.budget, 100000)
          )
        })
    })
  })

  describe(`JOIN callback types`, () => {
    test(`refProxy types in join on callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) => {
          // Test property access for join conditions
          expectTypeOf(
            user.department_id
          ).toEqualTypeOf<RefLeaf<number> | null>()
          expectTypeOf(dept.id).toEqualTypeOf<RefLeaf<number>>()

          return eq(user.department_id, dept.id)
        })
    })

    test(`complex join conditions`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) => {
          // Test complex join conditions with multiple operators
          expectTypeOf(
            and(eq(user.department_id, dept.id), eq(dept.active, true))
          ).toEqualTypeOf<BasicExpression<boolean>>()

          return and(eq(user.department_id, dept.id), eq(dept.active, true))
        })
    })

    test(`multiple joins with correct context`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .join({ project: projectsCollection }, ({ user, dept, project }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(project.user_id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(project.department_id).toEqualTypeOf<RefLeaf<number>>()

          return and(
            eq(project.user_id, user.id),
            eq(project.department_id, dept?.id)
          )
        })
    })
  })

  describe(`ORDER BY callback types`, () => {
    test(`refProxy types in orderBy callback`, () => {
      new Query().from({ user: usersCollection }).orderBy(({ user }) => {
        expectTypeOf(user.name).toEqualTypeOf<RefLeaf<string>>()
        expectTypeOf(user.age).toEqualTypeOf<RefLeaf<number>>()
        expectTypeOf(user.created_at).toEqualTypeOf<RefLeaf<string>>()

        return user.name
      })
    })

    test(`expression functions in orderBy callback`, () => {
      new Query().from({ user: usersCollection }).orderBy(({ user }) => {
        // Test expression functions in order by
        expectTypeOf(upper(user.name)).toEqualTypeOf<BasicExpression<string>>()
        expectTypeOf(lower(user.email)).toEqualTypeOf<BasicExpression<string>>()
        expectTypeOf(length(user.name)).toEqualTypeOf<BasicExpression<number>>()
        expectTypeOf(add(user.age, user.salary)).toEqualTypeOf<
          BasicExpression<number>
        >()

        return upper(user.name)
      })
    })

    test(`orderBy with joins`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .orderBy(({ user, dept }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.name).toEqualTypeOf<RefLeaf<string> | undefined>()

          return dept?.name
        })
    })
  })

  describe(`GROUP BY callback types`, () => {
    test(`refProxy types in groupBy callback`, () => {
      new Query().from({ user: usersCollection }).groupBy(({ user }) => {
        // Test that user is the correct RefProxy type
        // expectTypeOf(user).toEqualTypeOf<RefProxy<User>>()
        expectTypeOf(user.department_id).toEqualTypeOf<RefLeaf<number> | null>()
        expectTypeOf(user.active).toEqualTypeOf<RefLeaf<boolean>>()

        return user.department_id
      })
    })

    test(`multiple column groupBy`, () => {
      new Query().from({ user: usersCollection }).groupBy(({ user }) => {
        // Test array return type for multiple columns
        const groupColumns = [user.department_id, user.active]
        expectTypeOf(groupColumns).toEqualTypeOf<
          Array<(RefLeaf<number> | null) | RefLeaf<boolean>>
        >()

        return [user.department_id, user.active]
      })
    })

    test(`groupBy with joins`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .groupBy(({ user, dept }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()

          return dept?.location
        })
    })
  })

  describe(`HAVING callback types`, () => {
    test(`refProxy types in having callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.department_id)
        .having(({ user }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(
            user.department_id
          ).toEqualTypeOf<RefLeaf<number> | null>()

          return gt(count(user.id), 5)
        })
    })

    test(`aggregate functions in having callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.department_id)
        .having(({ user }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(
            user.department_id
          ).toEqualTypeOf<RefLeaf<number> | null>()
          // Test aggregate functions in having
          expectTypeOf(count(user.id)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(avg(user.age)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(sum(user.salary)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(max(user.age)).toEqualTypeOf<Aggregate<number>>()
          expectTypeOf(min(user.salary)).toEqualTypeOf<Aggregate<number>>()

          return and(
            gt(count(user.id), 5),
            gt(avg(user.age), 30),
            gt(sum(user.salary), 300000)
          )
        })
    })

    test(`comparison operators with aggregates in having callback`, () => {
      new Query()
        .from({ user: usersCollection })
        .groupBy(({ user }) => user.department_id)
        .having(({ user }) => {
          // Test comparison operators with aggregates
          expectTypeOf(gt(count(user.id), 10)).toEqualTypeOf<
            BasicExpression<boolean>
          >()
          expectTypeOf(gte(avg(user.salary), 75000)).toEqualTypeOf<
            BasicExpression<boolean>
          >()
          expectTypeOf(lt(max(user.age), 60)).toEqualTypeOf<
            BasicExpression<boolean>
          >()
          expectTypeOf(lte(min(user.age), 25)).toEqualTypeOf<
            BasicExpression<boolean>
          >()
          expectTypeOf(eq(sum(user.salary), 500000)).toEqualTypeOf<
            BasicExpression<boolean>
          >()

          return gt(count(user.id), 10)
        })
    })

    test(`having with joins`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) =>
          eq(user.department_id, dept.id)
        )
        .groupBy(({ dept }) => dept?.location)
        .having(({ user, dept }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()

          return and(gt(count(user.id), 3), gt(avg(user.salary), 70000))
        })
    })
  })

  describe(`Mixed callback scenarios`, () => {
    test(`complex query with all callback types`, () => {
      new Query()
        .from({ user: usersCollection })
        .join({ dept: departmentsCollection }, ({ user, dept }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept.location).toEqualTypeOf<RefLeaf<string>>()
          return eq(user.department_id, dept.id)
        })
        .join({ project: projectsCollection }, ({ user, dept, project }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()
          expectTypeOf(project.user_id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(project.department_id).toEqualTypeOf<RefLeaf<number>>()
          return eq(project.user_id, user.id)
        })
        .where(({ user, dept, project }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()
          expectTypeOf(project?.user_id).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()
          expectTypeOf(project?.department_id).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()
          return and(
            eq(user.active, true),
            eq(dept?.active, true),
            eq(project?.status, `active`)
          )
        })
        .groupBy(({ dept }) => {
          expectTypeOf(dept?.id).toEqualTypeOf<RefLeaf<number> | undefined>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()
          return dept?.location
        })
        .having(({ user, project }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(project?.budget).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()
          return and(gt(count(user.id), 2), gt(avg(project?.budget), 50000))
        })
        .select(({ user, dept, project }) => {
          expectTypeOf(user.id).toEqualTypeOf<RefLeaf<number>>()
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()
          expectTypeOf(project?.budget).toEqualTypeOf<
            RefLeaf<number> | undefined
          >()
          return {
            location: dept?.location,
            user_count: count(user.id),
            avg_salary: avg(user.salary),
            total_project_budget: sum(project?.budget),
            avg_project_budget: avg(project?.budget),
          }
        })
        .orderBy(({ dept }) => {
          expectTypeOf(dept?.location).toEqualTypeOf<
            RefLeaf<string> | undefined
          >()
          return dept?.location
        })
    })
  })
})
