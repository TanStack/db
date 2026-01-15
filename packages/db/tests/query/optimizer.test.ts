import { describe, expect, test } from 'vitest'
import { optimizeQuery } from '../../src/query/optimizer.js'
import {
  Aggregate,
  CollectionRef,
  Func,
  PropRef,
  QueryRef,
  Value,
} from '../../src/query/ir.js'
import type { QueryIR } from '../../src/query/ir.js'

// Mock collection for testing
const mockCollection = {
  id: `test-collection`,
} as any

// Helper functions to create test expressions
function createPropRef(alias: string, prop: string) {
  return new PropRef([alias, prop])
}

function createValue(value: any) {
  return new Value(value)
}

function createEq(left: any, right: any) {
  return new Func(`eq`, [left, right])
}

function createGt(left: any, right: any) {
  return new Func(`gt`, [left, right])
}

function createLt(left: any, right: any) {
  return new Func(`lt`, [left, right])
}

function createAnd(...args: Array<any>) {
  return new Func(`and`, args)
}

function createOr(...args: Array<any>) {
  return new Func(`or`, args)
}

function createAgg(name: string, ...args: Array<any>) {
  return new Aggregate(name, args)
}

describe(`Query Optimizer`, () => {
  describe(`Basic Optimization`, () => {
    test(`should pass through queries without where clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)
      expect(optimized).toEqual(query)
    })

    test(`should pass through queries with empty where clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)
      expect(optimized).toEqual(query)
    })

    test(`should skip optimization for queries without joins and single WHERE clause`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)
      // Query should remain unchanged since there is only one WHERE clause
      expect(optimized).toEqual(query)
    })

    test(`should combine multiple WHERE clauses for queries without joins`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createGt(createPropRef(`u`, `salary`), createValue(50000)),
          createEq(createPropRef(`u`, `active`), createValue(true)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The WHERE clauses should be combined into a single AND expression
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toMatchObject({
        type: `func`,
        name: `and`,
        args: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createGt(createPropRef(`u`, `salary`), createValue(50000)),
          createEq(createPropRef(`u`, `active`), createValue(true)),
        ],
      })
    })
  })

  describe(`Single Source Optimization with Joins`, () => {
    test(`should lift single-source where clause into subquery when joins are present`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // The from should be a QueryRef with the lifted where clause
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should lift multiple single-source where clauses into subquery when joins are present`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createGt(createPropRef(`u`, `id`), createValue(100)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // The from should be a QueryRef with the combined where clause
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        const whereClause = optimized.from.query.where![0]
        expect(whereClause).toBeDefined()
        expect((whereClause as any).type).toBe(`func`)
        expect((whereClause as any).name).toBe(`and`)
      }
    })
  })

  describe(`Join Optimization`, () => {
    test(`should lift single-source where clauses into join subqueries`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createGt(createPropRef(`p`, `views`), createValue(100)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // Both from and join should be QueryRefs with lifted where clauses
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }

      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join.length > 0) {
        const joinClause = optimized.join[0]!
        expect(joinClause.from.type).toBe(`queryRef`)
        if (joinClause.from.type === `queryRef`) {
          expect(joinClause.from.query.where).toHaveLength(1)
          if (joinClause.from.query.where) {
            expect(joinClause.from.query.where[0]).toEqual(
              createGt(createPropRef(`p`, `views`), createValue(100)),
            )
          }
        }
      }
    })

    test(`should preserve multi-source where clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createEq(createPropRef(`u`, `id`), createPropRef(`p`, `user_id`)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have the multi-source where clause
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createEq(createPropRef(`u`, `id`), createPropRef(`p`, `user_id`)),
      )

      // The from should be a QueryRef with the single-source where clause
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })
  })

  describe(`AND/OR Splitting with Joins`, () => {
    test(`should split AND clauses at the root level when joins are present`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createAnd(
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
            createGt(createPropRef(`u`, `id`), createValue(100)),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // The from should be a QueryRef with the combined where clause
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        const whereClause = optimized.from.query.where![0]
        expect(whereClause).toBeDefined()
        expect((whereClause as any).type).toBe(`func`)
        expect((whereClause as any).name).toBe(`and`)
      }
    })

    test(`should not split OR clauses at the root level when joins are present`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createOr(
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
            createEq(createPropRef(`u`, `department_id`), createValue(2)),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // The from should be a QueryRef with the OR clause
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        const whereClause = optimized.from.query.where![0]
        expect(whereClause).toBeDefined()
        expect((whereClause as any).type).toBe(`func`)
        expect((whereClause as any).name).toBe(`or`)
      }
    })

    test(`should handle deeply nested AND clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createAnd(
            createAnd(
              createEq(createPropRef(`u`, `department_id`), createValue(1)),
              createGt(createPropRef(`u`, `id`), createValue(100)),
            ),
            createLt(createPropRef(`u`, `age`), createValue(65)),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The main query should have no where clauses
      expect(optimized.where).toEqual([])

      // The from should be a QueryRef with all three conditions combined
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        const whereClause = optimized.from.query.where![0]
        expect(whereClause).toBeDefined()
        expect((whereClause as any).type).toBe(`func`)
        expect((whereClause as any).name).toBe(`and`)
        expect((whereClause as any).args).toHaveLength(3)
      }
    })
  })

  describe(`Edge Cases and Advanced Scenarios`, () => {
    test(`should handle queries with all optional fields populated`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
        select: {
          name: createPropRef(`u`, `name`),
          title: createPropRef(`p`, `title`),
        },
        groupBy: [createPropRef(`u`, `department_id`)],
        having: [
          createGt(
            createAgg(`count`, createPropRef(`p`, `id`)),
            createValue(5),
          ),
        ],
        orderBy: [
          {
            expression: createPropRef(`u`, `name`),
            compareOptions: {
              direction: `asc`,
              nulls: `first`,
              stringSort: `locale`,
            },
          },
        ],
        limit: 10,
        offset: 5,
        fnSelect: () => ({ name: `test` }),
        fnWhere: [() => true],
        fnHaving: [() => true],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // All fields should be preserved
      expect(optimized.select).toEqual(query.select)
      expect(optimized.groupBy).toEqual(query.groupBy)
      expect(optimized.having).toEqual(query.having)
      expect(optimized.orderBy).toEqual(query.orderBy)
      expect(optimized.limit).toEqual(query.limit)
      expect(optimized.offset).toEqual(query.offset)
      expect(optimized.fnSelect).toEqual(query.fnSelect)
      expect(optimized.fnWhere).toEqual(query.fnWhere)
      expect(optimized.fnHaving).toEqual(query.fnHaving)

      // WHERE clause should be moved to subquery
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
    })

    test(`should handle constant expressions (zero sources)`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createValue(1), createValue(1)), // Constant expression
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The constant expression should be ignored, single-source clause should be optimized
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should handle aggregate expressions in WHERE clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createGt(
            createAgg(`count`, createPropRef(`p`, `id`)),
            createValue(5),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The aggregate expression should be optimized to the posts subquery
      expect(optimized.where).toEqual([])
      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join.length > 0) {
        const joinClause = optimized.join[0]!
        expect(joinClause.from.type).toBe(`queryRef`)
        if (joinClause.from.type === `queryRef`) {
          expect(joinClause.from.query.where).toHaveLength(1)
          expect(joinClause.from.query.where![0]).toEqual(
            createGt(
              createAgg(`count`, createPropRef(`p`, `id`)),
              createValue(5),
            ),
          )
        }
      }
    })

    test(`should handle multiple multi-source clauses`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `id`), createPropRef(`p`, `user_id`)),
          createGt(
            createPropRef(`u`, `created_at`),
            createPropRef(`p`, `created_at`),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Both multi-source clauses should be combined with AND in the main query
      expect(optimized.where).toHaveLength(1)
      const whereClause = optimized.where![0]
      expect((whereClause as any).type).toBe(`func`)
      expect((whereClause as any).name).toBe(`and`)
      expect((whereClause as any).args).toHaveLength(2)
    })

    test(`should handle existing QueryRef with WHERE clauses`, () => {
      const existingSubquery: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [createGt(createPropRef(`u`, `id`), createValue(50))],
      }

      const query: QueryIR = {
        from: new QueryRef(existingSubquery, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The existing subquery should have WHERE clauses combined for performance
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        // After optimization, the WHERE clauses are combined into a single AND expression
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toMatchObject({
          type: `func`,
          name: `and`,
          args: [
            createGt(createPropRef(`u`, `id`), createValue(50)),
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
          ],
        })
      }
    })

    test(`should handle deeply nested QueryRef structures`, () => {
      const deeplyNestedQuery: QueryIR = {
        from: new QueryRef(
          {
            from: new CollectionRef(mockCollection, `u`),
            where: [createGt(createPropRef(`u`, `id`), createValue(10))],
          },
          `u`,
        ),
        where: [createLt(createPropRef(`u`, `age`), createValue(50))],
      }

      const query: QueryIR = {
        from: new QueryRef(deeplyNestedQuery, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The deeply nested structure should be preserved and WHERE clauses combined
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        // WHERE clauses are combined for performance
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.from.type).toBe(`queryRef`)
      }
    })

    test(`should handle PropRef with empty path`, () => {
      const emptyPathPropRef = new PropRef([])
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(emptyPathPropRef, createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The empty path PropRef should be treated as a constant (no sources)
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`collectionRef`)
    })

    test(`should handle mixed single-source and multi-source clauses with constants`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)), // Single source
          createEq(createPropRef(`u`, `id`), createPropRef(`p`, `user_id`)), // Multi source
          createGt(createPropRef(`p`, `views`), createValue(100)), // Single source
          createEq(createValue(1), createValue(1)), // Constant
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Multi-source clause should remain in main query
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createEq(createPropRef(`u`, `id`), createPropRef(`p`, `user_id`)),
      )

      // Single-source clauses should be moved to subqueries
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
      }

      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join.length > 0) {
        const joinClause = optimized.join[0]!
        expect(joinClause.from.type).toBe(`queryRef`)
        if (joinClause.from.type === `queryRef`) {
          expect(joinClause.from.query.where).toHaveLength(1)
        }
      }
    })
  })

  describe(`Error Handling`, () => {
    test(`should handle malformed expressions gracefully`, () => {
      const malformedExpression = {
        type: `unknown`,
        value: `test`,
      } as any

      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [malformedExpression],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Should not crash and should handle the malformed expression gracefully
      expect(optimized).toBeDefined()
      expect(optimized.where).toEqual([])
    })

    test(`should handle PropRef with empty first element`, () => {
      const propRefWithEmptyFirst = new PropRef([``, `name`])
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(propRefWithEmptyFirst, createValue(1)),
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // PropRef with empty first element should be ignored, other clause should be optimized
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should handle PropRef with undefined first element`, () => {
      const propRefWithUndefinedFirst = new PropRef([undefined as any, `name`])
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(propRefWithUndefinedFirst, createValue(1)),
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // PropRef with undefined first element should be ignored, other clause should be optimized
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })
  })

  describe(`Multi-Level Predicate Pushdown`, () => {
    test(`should push WHERE clauses through 2 levels of nested subqueries`, () => {
      // Create a 2-level nested query structure
      const nestedQuery: QueryIR = {
        from: new QueryRef(
          {
            from: new CollectionRef(mockCollection, `u`),
            where: [createGt(createPropRef(`u`, `id`), createValue(10))],
          },
          `u`,
        ),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(nestedQuery)

      // The new WHERE clause should be pushed to the nested level and combined
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        // WHERE clauses are combined into a single AND expression for performance
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toMatchObject({
          type: `func`,
          name: `and`,
          args: [
            createGt(createPropRef(`u`, `id`), createValue(10)),
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
          ],
        })
      }
    })

    test(`should handle deeply nested structures progressively`, () => {
      // Create a deeply nested query structure
      const deeplyNestedQuery: QueryIR = {
        from: new QueryRef(
          {
            from: new QueryRef(
              {
                from: new CollectionRef(mockCollection, `u`),
                where: [createGt(createPropRef(`u`, `id`), createValue(10))],
              },
              `u`,
            ),
            where: [createLt(createPropRef(`u`, `age`), createValue(50))],
          },
          `u`,
        ),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(deeplyNestedQuery)

      // Should at least push the top-level WHERE clause down one level and combine them
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        const innerQuery = optimized.from.query
        // The WHERE clauses should be combined into a single AND expression
        expect(innerQuery.where).toHaveLength(1)
        expect(innerQuery.where![0]).toMatchObject({
          type: `func`,
          name: `and`,
        })
        // Verify both conditions are in the combined expression
        const combinedWhere = innerQuery.where![0] as any
        expect(combinedWhere.args).toContainEqual(
          createLt(createPropRef(`u`, `age`), createValue(50)),
        )
        expect(combinedWhere.args).toContainEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should remove redundant subqueries after optimization`, () => {
      // Create a query with redundant subqueries that become empty after optimization
      const queryWithRedundantSubqueries: QueryIR = {
        from: new QueryRef(
          {
            from: new QueryRef(
              {
                from: new CollectionRef(mockCollection, `u`),
              },
              `u`,
            ),
          },
          `u`,
        ),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(
        queryWithRedundantSubqueries,
      )

      // Redundant nested subqueries should be removed, leaving a direct reference to the collection
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.from.type).toBe(`collectionRef`)
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should handle mixed single-source and multi-source clauses in nested queries`, () => {
      const nestedQuery: QueryIR = {
        from: new QueryRef(
          {
            from: new CollectionRef(mockCollection, `u`),
            where: [createGt(createPropRef(`u`, `age`), createValue(25))],
          },
          `u`,
        ),
        join: [
          {
            from: new QueryRef(
              {
                from: new CollectionRef(mockCollection, `p`),
                where: [createGt(createPropRef(`p`, `views`), createValue(50))],
              },
              `p`,
            ),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)), // Single-source
          createEq(createPropRef(`u`, `id`), createPropRef(`p`, `author_id`)), // Multi-source
          createGt(createPropRef(`p`, `rating`), createValue(4)), // Single-source
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(nestedQuery)

      // Multi-source clause should remain in main query
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createEq(createPropRef(`u`, `id`), createPropRef(`p`, `author_id`)),
      )

      // Single-source clauses should be pushed to their respective subqueries and combined
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        // WHERE clauses are combined for performance
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toMatchObject({
          type: `func`,
          name: `and`,
          args: [
            createGt(createPropRef(`u`, `age`), createValue(25)),
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
          ],
        })
      }

      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join.length > 0) {
        const joinClause = optimized.join[0]!
        expect(joinClause.from.type).toBe(`queryRef`)
        if (joinClause.from.type === `queryRef`) {
          // WHERE clauses are combined for performance
          expect(joinClause.from.query.where).toHaveLength(1)
          expect(joinClause.from.query.where![0]).toMatchObject({
            type: `func`,
            name: `and`,
            args: [
              createGt(createPropRef(`p`, `views`), createValue(50)),
              createGt(createPropRef(`p`, `rating`), createValue(4)),
            ],
          })
        }
      }
    })

    test(`should preserve non-redundant subqueries with meaningful clauses`, () => {
      const queryWithMeaningfulSubqueries: QueryIR = {
        from: new QueryRef(
          {
            from: new QueryRef(
              {
                from: new CollectionRef(mockCollection, `u`),
                where: [createGt(createPropRef(`u`, `id`), createValue(10))],
              },
              `u`,
            ),
            select: { name: createPropRef(`u`, `name`) }, // This makes the subquery non-redundant
          },
          `u`,
        ),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(
        queryWithMeaningfulSubqueries,
      )

      // Should preserve the subquery with SELECT clause and push WHERE clause down at least one level
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.select).toBeDefined()
        // The new WHERE clause should be pushed to this level or deeper
        expect(optimized.from.query.where).toContainEqual(
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should handle convergence detection to prevent infinite recursion`, () => {
      // Create a query that should converge quickly
      const simpleQuery: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [createEq(createPropRef(`u`, `department_id`), createValue(1))],
      }

      const { optimizedQuery: optimized } = optimizeQuery(simpleQuery)

      // Should optimize without infinite recursion
      expect(optimized).toBeDefined()
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
    })

    test(`should respect maximum recursion depth`, () => {
      // This test would be hard to trigger naturally, but we can at least verify
      // the function doesn't crash with deeply nested structures
      let deepQuery: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
      }

      // Create a very deeply nested structure
      for (let i = 0; i < 15; i++) {
        deepQuery = {
          from: new QueryRef(deepQuery, `u`),
        }
      }

      // Add JOIN and WHERE to make it optimizable
      deepQuery.join = [
        {
          from: new CollectionRef(mockCollection, `p`),
          type: `inner`,
          left: createPropRef(`u`, `id`),
          right: createPropRef(`p`, `user_id`),
        },
      ]
      deepQuery.where = [
        createEq(createPropRef(`u`, `department_id`), createValue(1)),
      ]

      const { optimizedQuery: optimized } = optimizeQuery(deepQuery)

      // Should not crash and should produce a valid result
      expect(optimized).toBeDefined()
    })

    test(`should handle complex AND/OR expressions with single-level pushdown`, () => {
      const complexQuery: QueryIR = {
        from: new QueryRef(
          {
            from: new CollectionRef(mockCollection, `u`),
            where: [createGt(createPropRef(`u`, `age`), createValue(18))],
          },
          `u`,
        ),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`u`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createAnd(
            createEq(createPropRef(`u`, `department_id`), createValue(1)),
            createOr(
              createGt(createPropRef(`u`, `salary`), createValue(50000)),
              createEq(createPropRef(`u`, `role`), createValue(`manager`)),
            ),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(complexQuery)

      // AND clause should be split and single-source parts pushed down, then combined for performance
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        // WHERE clauses should be combined into a single AND expression
        expect(optimized.from.query.where).toHaveLength(1)
        expect(optimized.from.query.where![0]).toMatchObject({
          type: `func`,
          name: `and`,
        })
        // Verify it contains the original condition and the new conditions
        const combinedWhere = optimized.from.query.where![0] as any
        expect(combinedWhere.args).toContainEqual(
          createGt(createPropRef(`u`, `age`), createValue(18)),
        )
      }
    })
  })

  describe(`Safety and Edge Cases`, () => {
    test(`should handle subquery reuse safely - same subquery in multiple contexts`, () => {
      // Create a single subquery object that's reused in different contexts
      const sharedSubquery: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          id: createPropRef(`u`, `id`),
          name: createPropRef(`u`, `name`),
        },
      }

      // Use the same subquery object in multiple places with different WHERE conditions
      const query: QueryIR = {
        from: new QueryRef(sharedSubquery, `main_users`),
        join: [
          {
            from: new QueryRef(sharedSubquery, `other_users`), // Same subquery object!
            type: `inner`,
            left: createPropRef(`main_users`, `id`),
            right: createPropRef(`other_users`, `id`),
          },
        ],
        where: [
          createEq(
            createPropRef(`main_users`, `department_id`),
            createValue(1),
          ), // Should only affect main_users context
          createEq(
            createPropRef(`other_users`, `department_id`),
            createValue(2),
          ), // Should only affect other_users context
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Verify that both contexts get their appropriate filters without cross-contamination
      expect(optimized.where).toEqual([])

      // Main users should get department_id = 1
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toContainEqual(
          createEq(
            createPropRef(`main_users`, `department_id`),
            createValue(1),
          ),
        )
      }

      // Other users should get department_id = 2
      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join.length > 0) {
        const joinClause = optimized.join[0]!
        expect(joinClause.from.type).toBe(`queryRef`)
        if (joinClause.from.type === `queryRef`) {
          expect(joinClause.from.query.where).toContainEqual(
            createEq(
              createPropRef(`other_users`, `department_id`),
              createValue(2),
            ),
          )
        }
      }
    })

    test(`should not optimize subqueries with aggregates - could change results`, () => {
      const subqueryWithAggregates: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          department_id: createPropRef(`u`, `department_id`),
          user_count: createAgg(`count`, createPropRef(`u`, `id`)),
        },
        groupBy: [createPropRef(`u`, `department_id`)],
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithAggregates, `stats`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`stats`, `department_id`),
            right: createPropRef(`p`, `department_id`),
          },
        ],
        where: [
          createGt(createPropRef(`stats`, `user_count`), createValue(5)), // Should NOT be pushed down
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The WHERE clause should remain in the main query since pushing it down
      // would change the aggregation results
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createGt(createPropRef(`stats`, `user_count`), createValue(5)),
      )
    })

    test(`should not optimize subqueries with ORDER BY + LIMIT - could change results`, () => {
      const subqueryWithLimitedOrder: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        orderBy: [
          {
            expression: createPropRef(`u`, `salary`),
            compareOptions: {
              direction: `desc`,
              nulls: `first`,
              stringSort: `locale`,
            },
          },
        ],
        limit: 10, // Top 10 highest paid users
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithLimitedOrder, `top_users`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`top_users`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(createPropRef(`top_users`, `department_id`), createValue(1)), // Should NOT be pushed down
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The WHERE clause should remain in the main query since pushing it down
      // would change which users are in the "top 10"
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createEq(createPropRef(`top_users`, `department_id`), createValue(1)),
      )
    })

    test(`should safely optimize when subquery has SELECT but no aggregates/limits`, () => {
      const subqueryWithSelect: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          id: createPropRef(`u`, `id`),
          name: createPropRef(`u`, `name`),
          department_id: createPropRef(`u`, `department_id`),
        },
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithSelect, `filtered_users`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`filtered_users`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(
            createPropRef(`filtered_users`, `department_id`),
            createValue(1),
          ), // Can be pushed down safely
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // This should be optimized since SELECT without aggregates/limits is safe
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toContainEqual(
          createEq(
            createPropRef(`filtered_users`, `department_id`),
            createValue(1),
          ),
        )
      }
    })

    test(`should not optimize subqueries with HAVING clauses`, () => {
      const subqueryWithHaving: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          department_id: createPropRef(`u`, `department_id`),
          avg_salary: createAgg(`avg`, createPropRef(`u`, `salary`)),
        },
        groupBy: [createPropRef(`u`, `department_id`)],
        having: [
          createGt(
            createAgg(`avg`, createPropRef(`u`, `salary`)),
            createValue(50000),
          ),
        ],
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithHaving, `dept_stats`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`dept_stats`, `department_id`),
            right: createPropRef(`p`, `department_id`),
          },
        ],
        where: [
          createGt(
            createPropRef(`dept_stats`, `avg_salary`),
            createValue(60000),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Should not optimize due to HAVING clause
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createGt(createPropRef(`dept_stats`, `avg_salary`), createValue(60000)),
      )
    })

    test(`should not optimize subqueries with functional operations`, () => {
      const subqueryWithFnSelect: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        fnSelect: (row: any) => ({ ...row.u, computed: row.u.salary * 2 }),
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithFnSelect, `computed_users`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`computed_users`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(
            createPropRef(`computed_users`, `department_id`),
            createValue(1),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Should not optimize due to functional operations that might have side effects
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createEq(
          createPropRef(`computed_users`, `department_id`),
          createValue(1),
        ),
      )
    })

    test(`should safely optimize ORDER BY without LIMIT/OFFSET`, () => {
      const subqueryWithOrderOnly: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        orderBy: [
          {
            expression: createPropRef(`u`, `name`),
            compareOptions: {
              direction: `asc`,
              nulls: `first`,
              stringSort: `locale`,
            },
          },
        ],
        // No LIMIT or OFFSET - safe to optimize
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithOrderOnly, `sorted_users`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`sorted_users`, `id`),
            right: createPropRef(`p`, `user_id`),
          },
        ],
        where: [
          createEq(
            createPropRef(`sorted_users`, `department_id`),
            createValue(1),
          ),
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Should optimize since ORDER BY without LIMIT/OFFSET is safe
      expect(optimized.where).toEqual([])
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toContainEqual(
          createEq(
            createPropRef(`sorted_users`, `department_id`),
            createValue(1),
          ),
        )
      }
    })

    test(`should handle mixed safe and unsafe subqueries correctly`, () => {
      // Safe subquery - can be optimized
      const safeSubquery: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          id: createPropRef(`u`, `id`),
          department_id: createPropRef(`u`, `department_id`),
        },
      }

      // Unsafe subquery - cannot be optimized (has aggregates)
      const unsafeSubquery: QueryIR = {
        from: new CollectionRef(mockCollection, `d`),
        select: {
          department_id: createPropRef(`d`, `id`),
          user_count: createAgg(`count`, createPropRef(`d`, `id`)),
        },
        groupBy: [createPropRef(`d`, `id`)],
      }

      const query: QueryIR = {
        from: new QueryRef(safeSubquery, `users`),
        join: [
          {
            from: new QueryRef(unsafeSubquery, `dept_stats`),
            type: `inner`,
            left: createPropRef(`users`, `department_id`),
            right: createPropRef(`dept_stats`, `department_id`),
          },
        ],
        where: [
          createEq(createPropRef(`users`, `department_id`), createValue(1)), // Should be optimized
          createGt(createPropRef(`dept_stats`, `user_count`), createValue(10)), // Should NOT be optimized
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Only the unsafe clause should remain
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toEqual(
        createGt(createPropRef(`dept_stats`, `user_count`), createValue(10)),
      )

      // Safe subquery should be optimized
      expect(optimized.from.type).toBe(`queryRef`)
      if (optimized.from.type === `queryRef`) {
        expect(optimized.from.query.where).toContainEqual(
          createEq(createPropRef(`users`, `department_id`), createValue(1)),
        )
      }
    })

    test(`should combine multiple remaining WHERE clauses after optimization`, () => {
      // This test verifies that if multiple WHERE clauses remain after optimization
      // (e.g., because some can't be pushed down), they are combined into a single clause
      const subqueryWithAggregates: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          department_id: createPropRef(`u`, `department_id`),
          user_count: createAgg(`count`, createPropRef(`u`, `id`)),
        },
        groupBy: [createPropRef(`u`, `department_id`)],
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithAggregates, `stats`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`stats`, `department_id`),
            right: createPropRef(`p`, `department_id`),
          },
        ],
        where: [
          createGt(createPropRef(`stats`, `user_count`), createValue(5)), // Can't push down - GROUP BY
          createGt(createPropRef(`p`, `views`), createValue(100)), // Can push down
          createEq(
            createPropRef(`stats`, `department_id`),
            createPropRef(`p`, `author_dept`),
          ), // Multi-source
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The posts clause should be pushed down
      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join[0]) {
        expect(optimized.join[0].from.type).toBe(`queryRef`)
        if (optimized.join[0].from.type === `queryRef`) {
          expect(optimized.join[0].from.query.where).toHaveLength(1)
        }
      }

      // The stats clause and multi-source clause should remain BUT be combined into ONE
      console.log(
        `Remaining WHERE clauses: ${optimized.where?.length || 0}`,
        JSON.stringify(optimized.where, null, 2),
      )
      expect(optimized.where).toBeDefined()
      // This is the KEY assertion - all remaining clauses should be combined
      // Currently this might FAIL if step 3 is missing
      expect(optimized.where!.length).toBe(1)
      expect(optimized.where![0]).toMatchObject({
        type: `func`,
        name: `and`,
      })
    })

    test(`should flatten nested AND expressions when combining remaining clauses`, () => {
      // This test verifies that if remaining WHERE clauses already contain AND expressions,
      // they are flattened to avoid and(and(...), ...) nesting
      const subqueryWithAggregates: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        select: {
          department_id: createPropRef(`u`, `department_id`),
          user_count: createAgg(`count`, createPropRef(`u`, `id`)),
        },
        groupBy: [createPropRef(`u`, `department_id`)],
      }

      const query: QueryIR = {
        from: new QueryRef(subqueryWithAggregates, `stats`),
        join: [
          {
            from: new CollectionRef(mockCollection, `p`),
            type: `inner`,
            left: createPropRef(`stats`, `department_id`),
            right: createPropRef(`p`, `department_id`),
          },
        ],
        where: [
          // This is an AND expression that can't be pushed down
          createAnd(
            createGt(createPropRef(`stats`, `user_count`), createValue(5)),
            createEq(createPropRef(`stats`, `department_id`), createValue(1)),
          ),
          createGt(createPropRef(`p`, `views`), createValue(100)), // Can push down
          createEq(
            createPropRef(`stats`, `department_id`),
            createPropRef(`p`, `author_dept`),
          ), // Multi-source
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // The posts clause should be pushed down
      expect(optimized.join).toHaveLength(1)
      if (optimized.join && optimized.join[0]) {
        expect(optimized.join[0].from.type).toBe(`queryRef`)
      }

      // The remaining clauses should be combined WITHOUT nested AND
      expect(optimized.where).toBeDefined()
      expect(optimized.where!.length).toBe(1)
      const combinedWhere = optimized.where![0] as any
      expect(combinedWhere.type).toBe(`func`)
      expect(combinedWhere.name).toBe(`and`)
      // Should have 4 args (the 2 from the nested AND + the multi-source clause),
      // NOT 2 args where one is itself an AND
      expect(combinedWhere.args).toHaveLength(3)
      // Verify none of the args are AND expressions (i.e., fully flattened)
      const argTypes = combinedWhere.args.map((arg: any) => ({
        type: arg.type,
        name: arg.name,
      }))
      expect(argTypes).not.toContainEqual({ type: `func`, name: `and` })
    })

    test(`should not combine functional WHERE clauses`, () => {
      // Verify that fn.where() clauses remain separate and are not combined
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [
          createEq(createPropRef(`u`, `department_id`), createValue(1)),
          createGt(createPropRef(`u`, `age`), createValue(25)),
        ],
        fnWhere: [
          (row: any) => row.u.name.startsWith(`A`),
          (row: any) => row.u.email !== null,
        ],
      }

      const { optimizedQuery: optimized } = optimizeQuery(query)

      // Regular WHERE clauses should be combined into one
      expect(optimized.where).toHaveLength(1)
      expect(optimized.where![0]).toMatchObject({
        type: `func`,
        name: `and`,
      })

      // Functional WHERE clauses should remain separate (not combined)
      expect(optimized.fnWhere).toHaveLength(2)
      expect(optimized.fnWhere![0]).toBeTypeOf(`function`)
      expect(optimized.fnWhere![1]).toBeTypeOf(`function`)
    })
  })

  describe(`JOIN semantics preservation`, () => {
    test(`should preserve WHERE clause semantics when pushing down to LEFT JOIN`, () => {
      // This test reproduces the bug where pushing WHERE clauses into LEFT JOIN subqueries
      // changes the semantics by filtering out null values that should remain

      const teamsCollection = { id: `teams` } as any
      const teamMembersCollection = { id: `team-members` } as any

      // Original query: LEFT JOIN with WHERE clause that should filter final results
      const query: QueryIR = {
        from: new CollectionRef(teamsCollection, `team`),
        join: [
          {
            type: `left`,
            from: new CollectionRef(teamMembersCollection, `teamMember`),
            left: createPropRef(`team`, `id`),
            right: createPropRef(`teamMember`, `team_id`),
          },
        ],
        where: [
          // This WHERE clause should filter the final result, not pre-filter the teamMember collection
          createEq(createPropRef(`teamMember`, `user_id`), createValue(100)),
        ],
        select: {
          id: createPropRef(`team`, `id`),
          name: createPropRef(`team`, `name`),
        },
      }

      const { optimizedQuery } = optimizeQuery(query)

      // The WHERE clause should remain in the main query to preserve LEFT JOIN semantics
      // It should NOT be completely moved to the subquery
      expect(optimizedQuery.where).toHaveLength(1)
      expect(optimizedQuery.where![0]).toEqual({
        expression: createEq(
          createPropRef(`teamMember`, `user_id`),
          createValue(100),
        ),
        residual: true,
      })

      // If the optimizer creates a subquery for teamMember, the WHERE clause should also be copied there
      // but a residual copy must remain in the main query
      if (
        optimizedQuery.join &&
        optimizedQuery.join[0]?.from.type === `queryRef`
      ) {
        const teamMemberSubquery = optimizedQuery.join[0].from.query
        // The subquery may have the WHERE clause for optimization
        if (teamMemberSubquery.where && teamMemberSubquery.where.length > 0) {
          // But the main query MUST still have it to preserve semantics
          expect(optimizedQuery.where).toContainEqual({
            expression: createEq(
              createPropRef(`teamMember`, `user_id`),
              createValue(100),
            ),
            residual: true,
          })
        }
      }
    })

    test(`should preserve WHERE clause semantics when pushing down to RIGHT JOIN`, () => {
      // This test reproduces the bug where pushing WHERE clauses into RIGHT JOIN subqueries
      // changes the semantics by filtering out null values that should remain

      const usersCollection = { id: `users` } as any
      const profilesCollection = { id: `profiles` } as any

      // Original query: RIGHT JOIN with WHERE clause that should filter final results
      // This should include all profiles, but only those where user.department_id = 1 OR user is null
      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `user`),
        join: [
          {
            type: `right`,
            from: new CollectionRef(profilesCollection, `profile`),
            left: createPropRef(`user`, `id`),
            right: createPropRef(`profile`, `user_id`),
          },
        ],
        where: [
          // This WHERE clause should filter the final result, not pre-filter the users collection
          // In a RIGHT JOIN, this should keep profiles where either:
          // 1. user.department_id = 1, OR
          // 2. user is null (profile has no matching user)
          createEq(createPropRef(`user`, `department_id`), createValue(1)),
        ],
        select: {
          profile_id: createPropRef(`profile`, `id`),
          user_name: createPropRef(`user`, `name`),
        },
      }

      const { optimizedQuery } = optimizeQuery(query)

      // The WHERE clause should remain in the main query to preserve RIGHT JOIN semantics
      // It should NOT be completely moved to the subquery
      expect(optimizedQuery.where).toHaveLength(1)
      expect(optimizedQuery.where![0]).toEqual({
        expression: createEq(
          createPropRef(`user`, `department_id`),
          createValue(1),
        ),
        residual: true,
      })

      // If the optimizer creates a subquery for users, the WHERE clause should also be copied there
      // but a residual copy must remain in the main query
      if (optimizedQuery.from.type === `queryRef`) {
        const userSubquery = optimizedQuery.from.query
        // The subquery may have the WHERE clause for optimization
        if (userSubquery.where && userSubquery.where.length > 0) {
          // But the main query MUST still have it to preserve semantics
          expect(optimizedQuery.where).toContainEqual({
            expression: createEq(
              createPropRef(`user`, `department_id`),
              createValue(1),
            ),
            residual: true,
          })
        }
      }
    })

    test(`should preserve WHERE clause semantics when pushing down to FULL JOIN`, () => {
      // This test reproduces the bug where pushing WHERE clauses into FULL JOIN subqueries
      // changes the semantics by filtering out null values that should remain

      const ordersCollection = { id: `orders` } as any
      const paymentsCollection = { id: `payments` } as any

      // Original query: FULL JOIN with WHERE clause that should filter final results
      // This should include:
      // 1. Orders with payments where payment.amount > 100
      // 2. Orders without payments (WHERE would be false for null payment.amount, so filtered out)
      // 3. Payments without orders where payment.amount > 100
      const query: QueryIR = {
        from: new CollectionRef(ordersCollection, `order`),
        join: [
          {
            type: `full`,
            from: new CollectionRef(paymentsCollection, `payment`),
            left: createPropRef(`order`, `id`),
            right: createPropRef(`payment`, `order_id`),
          },
        ],
        where: [
          // This WHERE clause should filter the final result, not pre-filter either collection
          createGt(createPropRef(`payment`, `amount`), createValue(100)),
        ],
        select: {
          order_id: createPropRef(`order`, `id`),
          payment_amount: createPropRef(`payment`, `amount`),
        },
      }

      const { optimizedQuery } = optimizeQuery(query)

      // The WHERE clause should remain in the main query to preserve FULL JOIN semantics
      // It should NOT be completely moved to the subquery
      expect(optimizedQuery.where).toHaveLength(1)
      expect(optimizedQuery.where![0]).toEqual({
        expression: createGt(
          createPropRef(`payment`, `amount`),
          createValue(100),
        ),
        residual: true,
      })

      // If the optimizer creates a subquery for payments, the WHERE clause should also be copied there
      // but a residual copy must remain in the main query
      if (
        optimizedQuery.join &&
        optimizedQuery.join[0]?.from.type === `queryRef`
      ) {
        const paymentSubquery = optimizedQuery.join[0].from.query
        // The subquery may have the WHERE clause for optimization
        if (paymentSubquery.where && paymentSubquery.where.length > 0) {
          // But the main query MUST still have it to preserve semantics
          expect(optimizedQuery.where).toContainEqual({
            expression: createGt(
              createPropRef(`payment`, `amount`),
              createValue(100),
            ),
            residual: true,
          })
        }
      }
    })

    test(`should allow WHERE clause pushdown for INNER JOIN (semantics preserved)`, () => {
      // This test confirms that INNER JOIN optimization is still safe
      // Because INNER JOINs don't produce NULL values, moving WHERE clauses to subqueries
      // doesn't change the semantics

      const usersCollection = { id: `users` } as any
      const departmentsCollection = { id: `departments` } as any

      // Original query: INNER JOIN with WHERE clause - optimization should be allowed
      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `user`),
        join: [
          {
            type: `inner`,
            from: new CollectionRef(departmentsCollection, `dept`),
            left: createPropRef(`user`, `department_id`),
            right: createPropRef(`dept`, `id`),
          },
        ],
        where: [
          // This WHERE clause CAN be moved to subquery for INNER JOIN without changing semantics
          createEq(createPropRef(`dept`, `budget`), createValue(100000)),
        ],
        select: {
          user_name: createPropRef(`user`, `name`),
          dept_name: createPropRef(`dept`, `name`),
        },
      }

      const { optimizedQuery } = optimizeQuery(query)

      // For INNER JOIN, the WHERE clause CAN be completely moved to the subquery
      // This is safe because INNER JOIN doesn't produce NULL values that need residual filtering
      expect(optimizedQuery.where).toHaveLength(0)

      // The WHERE clause should be pushed into the department subquery for optimization
      expect(optimizedQuery.join).toHaveLength(1)
      expect(optimizedQuery.join![0]?.from.type).toBe(`queryRef`)

      if (optimizedQuery.join![0]?.from.type === `queryRef`) {
        const deptSubquery = optimizedQuery.join![0].from.query
        expect(deptSubquery.where).toContainEqual(
          createEq(createPropRef(`dept`, `budget`), createValue(100000)),
        )
      }
    })
  })

  describe(`Join Info Extraction`, () => {
    test(`should return empty map for queries without joins`, () => {
      const query: QueryIR = {
        from: new CollectionRef(mockCollection, `u`),
        where: [createEq(createPropRef(`u`, `status`), createValue(`active`))],
      }

      const { joinInfoBySource } = optimizeQuery(query)

      expect(joinInfoBySource.size).toBe(0)
    })

    test(`should extract join info for simple inner join`, () => {
      const usersCollection = { id: `users-collection` } as any
      const postsCollection = { id: `posts-collection` } as any

      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `user`),
        join: [
          {
            from: new CollectionRef(postsCollection, `post`),
            type: `inner`,
            left: createPropRef(`user`, `id`),
            right: createPropRef(`post`, `user_id`),
          },
        ],
      }

      const { joinInfoBySource } = optimizeQuery(query)

      // Join info should be keyed by main source alias
      expect(joinInfoBySource.has(`user`)).toBe(true)
      const userJoins = joinInfoBySource.get(`user`)!
      expect(userJoins).toHaveLength(1)

      const joinInfo = userJoins[0]!
      expect(joinInfo.collectionId).toBe(`posts-collection`)
      expect(joinInfo.alias).toBe(`post`)
      expect(joinInfo.type).toBe(`inner`)
      expect(joinInfo.localKey).toEqual(createPropRef(`user`, `id`))
      expect(joinInfo.foreignKey).toEqual(createPropRef(`post`, `user_id`))
      expect(joinInfo.where).toBeUndefined()
      expect(joinInfo.orderBy).toBeUndefined()
    })

    test(`should include WHERE clause for joined collection in join info`, () => {
      const tasksCollection = { id: `tasks-collection` } as any
      const accountsCollection = { id: `accounts-collection` } as any

      const query: QueryIR = {
        from: new CollectionRef(tasksCollection, `task`),
        join: [
          {
            from: new CollectionRef(accountsCollection, `account`),
            type: `inner`,
            left: createPropRef(`task`, `account_id`),
            right: createPropRef(`account`, `id`),
          },
        ],
        where: [
          // Filter on task (main collection)
          createEq(createPropRef(`task`, `status`), createValue(`active`)),
          // Filter on account (joined collection)
          createEq(createPropRef(`account`, `name`), createValue(`Acme Corp`)),
        ],
      }

      const { joinInfoBySource, sourceWhereClauses } = optimizeQuery(query)

      // sourceWhereClauses should have the account filter
      expect(sourceWhereClauses.has(`account`)).toBe(true)
      expect(sourceWhereClauses.get(`account`)).toEqual(
        createEq(createPropRef(`account`, `name`), createValue(`Acme Corp`)),
      )

      // joinInfoBySource should include the account filter in the join info
      expect(joinInfoBySource.has(`task`)).toBe(true)
      const taskJoins = joinInfoBySource.get(`task`)!
      expect(taskJoins).toHaveLength(1)

      const joinInfo = taskJoins[0]!
      expect(joinInfo.where).toEqual(
        createEq(createPropRef(`account`, `name`), createValue(`Acme Corp`)),
      )
    })

    test(`should include orderBy for joined collection in join info`, () => {
      const tasksCollection = { id: `tasks-collection` } as any
      const accountsCollection = { id: `accounts-collection` } as any

      const query: QueryIR = {
        from: new CollectionRef(tasksCollection, `task`),
        join: [
          {
            from: new CollectionRef(accountsCollection, `account`),
            type: `inner`,
            left: createPropRef(`task`, `account_id`),
            right: createPropRef(`account`, `id`),
          },
        ],
        orderBy: [
          {
            expression: createPropRef(`account`, `name`),
            compareOptions: { direction: `asc`, nulls: `last` },
          },
          {
            expression: createPropRef(`task`, `created_at`),
            compareOptions: { direction: `desc`, nulls: `last` },
          },
        ],
      }

      const { joinInfoBySource } = optimizeQuery(query)

      expect(joinInfoBySource.has(`task`)).toBe(true)
      const taskJoins = joinInfoBySource.get(`task`)!
      const joinInfo = taskJoins[0]!

      // Only the account orderBy should be in the join info
      expect(joinInfo.orderBy).toHaveLength(1)
      expect(joinInfo.orderBy![0]!.expression).toEqual(
        createPropRef(`account`, `name`),
      )
    })

    test(`should handle multiple joins`, () => {
      const ordersCollection = { id: `orders-collection` } as any
      const customersCollection = { id: `customers-collection` } as any
      const productsCollection = { id: `products-collection` } as any

      const query: QueryIR = {
        from: new CollectionRef(ordersCollection, `order`),
        join: [
          {
            from: new CollectionRef(customersCollection, `customer`),
            type: `inner`,
            left: createPropRef(`order`, `customer_id`),
            right: createPropRef(`customer`, `id`),
          },
          {
            from: new CollectionRef(productsCollection, `product`),
            type: `left`,
            left: createPropRef(`order`, `product_id`),
            right: createPropRef(`product`, `id`),
          },
        ],
        where: [
          createEq(createPropRef(`customer`, `tier`), createValue(`premium`)),
        ],
      }

      const { joinInfoBySource } = optimizeQuery(query)

      expect(joinInfoBySource.has(`order`)).toBe(true)
      const orderJoins = joinInfoBySource.get(`order`)!
      expect(orderJoins).toHaveLength(2)

      // First join: customer
      const customerJoin = orderJoins.find((j) => j.alias === `customer`)!
      expect(customerJoin.collectionId).toBe(`customers-collection`)
      expect(customerJoin.type).toBe(`inner`)
      expect(customerJoin.where).toEqual(
        createEq(createPropRef(`customer`, `tier`), createValue(`premium`)),
      )

      // Second join: product
      const productJoin = orderJoins.find((j) => j.alias === `product`)!
      expect(productJoin.collectionId).toBe(`products-collection`)
      expect(productJoin.type).toBe(`left`)
      expect(productJoin.where).toBeUndefined()
    })

    test(`should handle join with swapped key expressions`, () => {
      const usersCollection = { id: `users-collection` } as any
      const postsCollection = { id: `posts-collection` } as any

      // Join with right side referencing main, left side referencing joined
      const query: QueryIR = {
        from: new CollectionRef(usersCollection, `user`),
        join: [
          {
            from: new CollectionRef(postsCollection, `post`),
            type: `inner`,
            // Swapped: left is post (joined), right is user (main)
            left: createPropRef(`post`, `user_id`),
            right: createPropRef(`user`, `id`),
          },
        ],
      }

      const { joinInfoBySource } = optimizeQuery(query)

      const userJoins = joinInfoBySource.get(`user`)!
      const joinInfo = userJoins[0]!

      // The extractor should correctly identify which is local vs foreign
      expect(joinInfo.localKey).toEqual(createPropRef(`user`, `id`))
      expect(joinInfo.foreignKey).toEqual(createPropRef(`post`, `user_id`))
    })
  })
})
