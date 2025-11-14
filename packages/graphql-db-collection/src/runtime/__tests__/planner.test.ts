import { describe, expect, it } from "vitest"
import { eq } from "@tanstack/db"
import { GraphQLPlanner } from "../planner"
import { createHasuraDialect } from "../dialects/hasura"
import type { TypeInfo } from "../planner"

describe(`GraphQLPlanner`, () => {
  const schema = new Map<string, TypeInfo>([
    [
      `Post`,
      {
        name: `Post`,
        scalarFields: [`id`, `title`, `content`, `published`, `createdAt`],
        relationFields: [`author`],
        hasConnection: false,
        hasList: true,
      },
    ],
  ])

  const dialect = createHasuraDialect()
  const planner = new GraphQLPlanner(dialect, schema)

  it(`should plan a simple query`, () => {
    const result = planner.plan({
      collection: `Post`,
      subset: {
        limit: 10,
      },
    })

    expect(result).toBeDefined()
    expect(result.document).toBeDefined()
    expect(result.variables).toHaveProperty(`limit`, 10)
  })

  it(`should plan a query with where clause`, () => {
    const result = planner.plan({
      collection: `Post`,
      subset: {
        where: eq(`published`, true),
        limit: 20,
      },
    })

    expect(result).toBeDefined()
    expect(result.document).toBeDefined()
    expect(result.variables).toHaveProperty(`where`)
    expect(result.variables).toHaveProperty(`limit`, 20)
  })

  it(`should plan a query with ordering`, () => {
    const result = planner.plan({
      collection: `Post`,
      subset: {
        orderBy: [{ field: `createdAt`, direction: `desc` }],
        limit: 10,
      },
    })

    expect(result).toBeDefined()
    expect(result.document).toBeDefined()
    expect(result.variables).toHaveProperty(`orderBy`)
  })

  it(`should include required fields in selection`, () => {
    const result = planner.plan({
      collection: `Post`,
      requiredFields: [`id`, `__typename`, `title`],
    })

    expect(result).toBeDefined()
    expect(result.project).toBeDefined()
    expect(result.project.dataPath).toContain(`posts`)
  })
})
