import { describe, expect, it } from "vitest"
import {
  extractFieldPath,
  extractSimpleComparisons,
  extractValue,
  parseLoadSubsetOptions,
  parseOrderByExpression,
  parseWhereExpression,
  walkExpression,
} from "../src/expression-helpers"
import { Func, PropRef, Value } from "../../db/src/query/ir.js"
import type { IR } from "@tanstack/db"

type OrderBy = IR.OrderBy

describe(`Expression Helpers`, () => {
  describe(`extractFieldPath`, () => {
    it(`should extract field path from PropRef`, () => {
      const expr = new PropRef([`product`, `category`])
      const result = extractFieldPath(expr)
      expect(result).toEqual([`product`, `category`])
    })

    it(`should return null for non-ref expressions`, () => {
      const expr = new Value(`electronics`)
      const result = extractFieldPath(expr)
      expect(result).toBeNull()
    })
  })

  describe(`extractValue`, () => {
    it(`should extract value from Value expression`, () => {
      const expr = new Value(`electronics`)
      const result = extractValue(expr)
      expect(result).toBe(`electronics`)
    })

    it(`should return undefined for non-value expressions`, () => {
      const expr = new PropRef([`category`])
      const result = extractValue(expr)
      expect(result).toBeUndefined()
    })
  })

  describe(`walkExpression`, () => {
    it(`should visit all nodes in expression tree`, () => {
      const visited: Array<string> = []

      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
      ])

      walkExpression(expr, (node) => {
        visited.push(node.type)
      })

      expect(visited).toEqual([
        `func`,
        `func`,
        `ref`,
        `val`,
        `func`,
        `ref`,
        `val`,
      ])
    })

    it(`should handle null/undefined expressions`, () => {
      const visited: Array<string> = []

      walkExpression(null, (node) => {
        visited.push(node.type)
      })

      expect(visited).toEqual([])
    })
  })

  describe(`parseWhereExpression`, () => {
    it(`should parse simple equality expression`, () => {
      const expr = new Func(`eq`, [
        new PropRef([`category`]),
        new Value(`electronics`),
      ])

      const result = parseWhereExpression(expr, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
        },
      })

      expect(result).toEqual({ category: `electronics` })
    })

    it(`should parse less than expression`, () => {
      const expr = new Func(`lt`, [new PropRef([`price`]), new Value(100)])

      const result = parseWhereExpression(expr, {
        handlers: {
          lt: (field, value) => ({ [`${field.join(`.`)}_lt`]: value }),
        },
      })

      expect(result).toEqual({ price_lt: 100 })
    })

    it(`should parse AND expression with multiple conditions`, () => {
      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
      ])

      const result = parseWhereExpression(expr, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
          lt: (field, value) => ({ [`${field.join(`.`)}_lt`]: value }),
          and: (...filters) => Object.assign({}, ...filters),
        },
      })

      expect(result).toEqual({ category: `electronics`, price_lt: 100 })
    })

    it(`should parse OR expression`, () => {
      const expr = new Func(`or`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`eq`, [new PropRef([`category`]), new Value(`books`)]),
      ])

      const result = parseWhereExpression(expr, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
          or: (...filters) => ({ $or: filters }),
        },
      })

      expect(result).toEqual({
        $or: [{ category: `electronics` }, { category: `books` }],
      })
    })

    it(`should handle nested field paths`, () => {
      const expr = new Func(`eq`, [
        new PropRef([`product`, `metadata`, `tags`]),
        new Value(`featured`),
      ])

      const result = parseWhereExpression(expr, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
        },
      })

      expect(result).toEqual({ [`product.metadata.tags`]: `featured` })
    })

    it(`should throw error for unknown operator without handler`, () => {
      const expr = new Func(`customOp`, [
        new PropRef([`field`]),
        new Value(`value`),
      ])

      expect(() => {
        parseWhereExpression(expr, {
          handlers: {
            eq: (field, value) => ({ [field.join(`.`)]: value }),
          },
        })
      }).toThrow(
        `No handler provided for operator: customOp. Available handlers: eq`
      )
    })

    it(`should use onUnknownOperator callback for unknown operators`, () => {
      const expr = new Func(`customOp`, [
        new PropRef([`field`]),
        new Value(`value`),
      ])

      const result = parseWhereExpression(expr, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
        },
        onUnknownOperator: (operator) => {
          return { custom: operator }
        },
      })

      expect(result).toEqual({ custom: `customOp` })
    })

    it(`should handle null/undefined expressions`, () => {
      const result = parseWhereExpression(null, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
        },
      })

      expect(result).toBeNull()
    })

    it(`should handle deeply nested AND/OR expressions`, () => {
      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`inStock`]), new Value(true)]),
        new Func(`or`, [
          new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
          new Func(`eq`, [new PropRef([`category`]), new Value(`books`)]),
        ]),
      ])

      type FilterResult =
        | { field: string; value: unknown }
        | { AND: Array<FilterResult> }
        | { OR: Array<FilterResult> }

      const result = parseWhereExpression<FilterResult>(expr, {
        handlers: {
          eq: (field, value) => ({ field: field.join(`.`), value }),
          and: (...filters) => ({ AND: filters }),
          or: (...filters) => ({ OR: filters }),
        },
      })

      expect(result).toEqual({
        AND: [
          { field: `inStock`, value: true },
          {
            OR: [
              { field: `category`, value: `electronics` },
              { field: `category`, value: `books` },
            ],
          },
        ],
      })
    })
  })

  describe(`parseOrderByExpression`, () => {
    it(`should parse single orderBy clause`, () => {
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`price`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
      ]

      const result = parseOrderByExpression(orderBy)

      expect(result).toEqual([
        { field: [`price`], direction: `asc`, nulls: `last` },
      ])
    })

    it(`should parse multiple orderBy clauses`, () => {
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`category`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
        {
          expression: new PropRef([`price`]),
          compareOptions: {
            direction: `desc`,
            nulls: `first`,
          },
        },
      ]

      const result = parseOrderByExpression(orderBy)

      expect(result).toEqual([
        { field: [`category`], direction: `asc`, nulls: `last` },
        { field: [`price`], direction: `desc`, nulls: `first` },
      ])
    })

    it(`should handle nested field paths`, () => {
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`product`, `metadata`, `rating`]),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
          },
        },
      ]

      const result = parseOrderByExpression(orderBy)

      expect(result).toEqual([
        {
          field: [`product`, `metadata`, `rating`],
          direction: `desc`,
          nulls: `last`,
        },
      ])
    })

    it(`should handle null/undefined orderBy`, () => {
      expect(parseOrderByExpression(null)).toEqual([])
      expect(parseOrderByExpression(undefined)).toEqual([])
    })

    it(`should handle empty orderBy array`, () => {
      expect(parseOrderByExpression([])).toEqual([])
    })

    it(`should throw error for non-ref expressions`, () => {
      const orderBy: OrderBy = [
        {
          expression: new Value(`invalid`) as any,
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
      ]

      expect(() => parseOrderByExpression(orderBy)).toThrow(
        `ORDER BY expression must be a field reference, got: val`
      )
    })
  })

  describe(`extractSimpleComparisons`, () => {
    it(`should extract single equality comparison`, () => {
      const expr = new Func(`eq`, [
        new PropRef([`category`]),
        new Value(`electronics`),
      ])

      const result = extractSimpleComparisons(expr)

      expect(result).toEqual([
        { field: [`category`], operator: `eq`, value: `electronics` },
      ])
    })

    it(`should extract multiple AND-ed comparisons`, () => {
      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
        new Func(`eq`, [new PropRef([`inStock`]), new Value(true)]),
      ])

      const result = extractSimpleComparisons(expr)

      expect(result).toEqual([
        { field: [`category`], operator: `eq`, value: `electronics` },
        { field: [`price`], operator: `lt`, value: 100 },
        { field: [`inStock`], operator: `eq`, value: true },
      ])
    })

    it(`should handle all comparison operators`, () => {
      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`a`]), new Value(1)]),
        new Func(`gt`, [new PropRef([`b`]), new Value(2)]),
        new Func(`gte`, [new PropRef([`c`]), new Value(3)]),
        new Func(`lt`, [new PropRef([`d`]), new Value(4)]),
        new Func(`lte`, [new PropRef([`e`]), new Value(5)]),
        new Func(`in`, [new PropRef([`f`]), new Value([6, 7])]),
      ])

      const result = extractSimpleComparisons(expr)

      expect(result).toEqual([
        { field: [`a`], operator: `eq`, value: 1 },
        { field: [`b`], operator: `gt`, value: 2 },
        { field: [`c`], operator: `gte`, value: 3 },
        { field: [`d`], operator: `lt`, value: 4 },
        { field: [`e`], operator: `lte`, value: 5 },
        { field: [`f`], operator: `in`, value: [6, 7] },
      ])
    })

    it(`should handle nested AND expressions`, () => {
      const expr = new Func(`and`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`and`, [
          new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
          new Func(`eq`, [new PropRef([`inStock`]), new Value(true)]),
        ]),
      ])

      const result = extractSimpleComparisons(expr)

      expect(result).toEqual([
        { field: [`category`], operator: `eq`, value: `electronics` },
        { field: [`price`], operator: `lt`, value: 100 },
        { field: [`inStock`], operator: `eq`, value: true },
      ])
    })

    it(`should handle null/undefined expressions`, () => {
      expect(extractSimpleComparisons(null)).toEqual([])
      expect(extractSimpleComparisons(undefined)).toEqual([])
    })

    it(`should throw on OR expressions (not simple)`, () => {
      const expr = new Func(`or`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`eq`, [new PropRef([`category`]), new Value(`books`)]),
      ])

      // OR is not supported by extractSimpleComparisons, so it throws
      expect(() => extractSimpleComparisons(expr)).toThrow(
        `extractSimpleComparisons does not support 'or' operator`
      )
    })

    it(`should handle nested field paths`, () => {
      const expr = new Func(`eq`, [
        new PropRef([`product`, `metadata`, `tags`]),
        new Value(`featured`),
      ])

      const result = extractSimpleComparisons(expr)

      expect(result).toEqual([
        {
          field: [`product`, `metadata`, `tags`],
          operator: `eq`,
          value: `featured`,
        },
      ])
    })
  })

  describe(`parseLoadSubsetOptions`, () => {
    it(`should parse all options together`, () => {
      const where = new Func(`and`, [
        new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
        new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
      ])

      const orderBy: OrderBy = [
        {
          expression: new PropRef([`price`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
      ]

      const result = parseLoadSubsetOptions({
        where,
        orderBy,
        limit: 10,
      })

      expect(result).toEqual({
        filters: [
          { field: [`category`], operator: `eq`, value: `electronics` },
          { field: [`price`], operator: `lt`, value: 100 },
        ],
        sorts: [{ field: [`price`], direction: `asc`, nulls: `last` }],
        limit: 10,
      })
    })

    it(`should handle missing options`, () => {
      const result = parseLoadSubsetOptions({})

      expect(result).toEqual({
        filters: [],
        sorts: [],
        limit: undefined,
      })
    })

    it(`should handle null/undefined options`, () => {
      expect(parseLoadSubsetOptions(null)).toEqual({
        filters: [],
        sorts: [],
      })
      expect(parseLoadSubsetOptions(undefined)).toEqual({
        filters: [],
        sorts: [],
      })
    })

    it(`should handle only where clause`, () => {
      const where = new Func(`eq`, [
        new PropRef([`category`]),
        new Value(`electronics`),
      ])

      const result = parseLoadSubsetOptions({ where })

      expect(result).toEqual({
        filters: [
          { field: [`category`], operator: `eq`, value: `electronics` },
        ],
        sorts: [],
        limit: undefined,
      })
    })

    it(`should handle only orderBy clause`, () => {
      const orderBy: OrderBy = [
        {
          expression: new PropRef([`price`]),
          compareOptions: {
            direction: `desc`,
            nulls: `first`,
          },
        },
      ]

      const result = parseLoadSubsetOptions({ orderBy })

      expect(result).toEqual({
        filters: [],
        sorts: [{ field: [`price`], direction: `desc`, nulls: `first` }],
        limit: undefined,
      })
    })

    it(`should handle only limit`, () => {
      const result = parseLoadSubsetOptions({ limit: 20 })

      expect(result).toEqual({
        filters: [],
        sorts: [],
        limit: 20,
      })
    })
  })

  describe(`Integration tests`, () => {
    it(`should handle complex real-world query`, () => {
      // Simulate: WHERE (category = 'electronics' OR category = 'books')
      //           AND price < 100
      //           AND inStock = true
      //           ORDER BY price ASC, name DESC
      //           LIMIT 25

      const where = new Func(`and`, [
        new Func(`or`, [
          new Func(`eq`, [new PropRef([`category`]), new Value(`electronics`)]),
          new Func(`eq`, [new PropRef([`category`]), new Value(`books`)]),
        ]),
        new Func(`lt`, [new PropRef([`price`]), new Value(100)]),
        new Func(`eq`, [new PropRef([`inStock`]), new Value(true)]),
      ])

      const orderBy: OrderBy = [
        {
          expression: new PropRef([`price`]),
          compareOptions: {
            direction: `asc`,
            nulls: `last`,
          },
        },
        {
          expression: new PropRef([`name`]),
          compareOptions: {
            direction: `desc`,
            nulls: `last`,
          },
        },
      ]

      // Use custom handlers to build JSON:API style query
      const filters = parseWhereExpression(where, {
        handlers: {
          eq: (field, value) => ({ [field.join(`.`)]: value }),
          lt: (field, value) => ({ [`${field.join(`.`)}_lt`]: value }),
          and: (...conditions) => Object.assign({}, ...conditions),
          or: (...conditions) => ({ _or: conditions }),
        },
      })

      const sorts = parseOrderByExpression(orderBy)

      expect(filters).toEqual({
        _or: [{ category: `electronics` }, { category: `books` }],
        price_lt: 100,
        inStock: true,
      })

      expect(sorts).toEqual([
        { field: [`price`], direction: `asc`, nulls: `last` },
        { field: [`name`], direction: `desc`, nulls: `last` },
      ])
    })
  })
})
