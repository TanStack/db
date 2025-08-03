import * as fc from "fast-check"
import { generateMutationCommands } from "./mutation-generator"
import type {
  Aggregate,
  BasicExpression,
  CollectionRef,
  GeneratorConfig,
  OrderByClause,
  QueryCommand,
  QueryIR,
  TestCommand,
  TestSchema,
} from "../types"

/**
 * Generates query commands for property testing
 */
export function generateQueryCommands(
  schema: TestSchema,
  config: GeneratorConfig = {}
): fc.Arbitrary<Array<QueryCommand>> {
  const { maxQueries = 10 } = config

  // If no tables exist, return empty array
  if (schema.tables.length === 0) {
    return fc.constant([])
  }

  return fc
    .array(generateQueryCommand(schema), {
      minLength: 1, // Ensure at least one query is generated
      maxLength: maxQueries,
    })
    .map((commands) => {
      // Ensure each query has a unique ID
      const uniqueCommands: Array<QueryCommand> = []
      const seenIds = new Set<string>()

      for (const command of commands) {
        let queryId = command.queryId
        let counter = 1
        while (seenIds.has(queryId)) {
          queryId = `${command.queryId}_${counter}`
          counter++
        }
        seenIds.add(queryId)
        uniqueCommands.push({ ...command, queryId })
      }

      return uniqueCommands
    })
}

/**
 * Generates a single query command
 */
function generateQueryCommand(schema: TestSchema): fc.Arbitrary<QueryCommand> {
  return fc.oneof(
    generateStartQueryCommand(schema),
    generateStopQueryCommand(schema)
  )
}

/**
 * Generates a start query command
 */
function generateStartQueryCommand(
  schema: TestSchema
): fc.Arbitrary<QueryCommand> {
  return fc
    .tuple(generateQueryId(), generateQueryAST(schema))
    .map(([queryId, ast]) => ({
      type: `startQuery` as const,
      queryId,
      ast,
    }))
}

/**
 * Generates a stop query command
 */
function generateStopQueryCommand(
  _schema: TestSchema
): fc.Arbitrary<QueryCommand> {
  return generateQueryId().map((queryId) => ({
    type: `stopQuery` as const,
    queryId,
  }))
}

/**
 * Generates a unique query ID
 */
function generateQueryId(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 3, maxLength: 8 })
    .map((str) => `query_${str.toLowerCase().replace(/[^a-z0-9]/g, ``)}`)
}

/**
 * Generates a complete query AST
 */
function generateQueryAST(schema: TestSchema): fc.Arbitrary<QueryIR> {
  return fc
    .tuple(
      generateFrom(schema),
      generateSelect(schema),
      generateWhere(schema),
      generateGroupBy(schema),
      generateOrderBy(schema),
      generateLimitOffset()
    )
    .map(([from, select, where, groupBy, orderBy, { limit, offset }]) => ({
      from,
      select,
      where,
      groupBy,
      orderBy,
      limit,
      offset,
    }))
}

/**
 * Generates the FROM clause
 */
function generateFrom(schema: TestSchema): fc.Arbitrary<CollectionRef> {
  return fc.constantFrom(...schema.tables).map((table) => ({
    type: `collectionRef` as const,
    collection: null as any, // Will be set during test execution
    alias: table.name,
  }))
}

/**
 * Generates the SELECT clause
 */
function generateSelect(
  schema: TestSchema
): fc.Arbitrary<Record<string, BasicExpression | Aggregate>> {
  return fc.constantFrom(...schema.tables).chain((table) => {
    const columns = table.columns

    return fc.oneof(
      // Select all columns
      fc.constant({ "*": { type: `val` as const, value: `*` } }),
      // Select specific columns
      fc
        .array(fc.constantFrom(...columns.map((col) => col.name)), {
          minLength: 1,
          maxLength: columns.length,
        })
        .map((selectedColumns) => {
          const select: Record<string, BasicExpression> = {}
          for (const colName of selectedColumns) {
            select[colName] = {
              type: `ref` as const,
              path: [table.name, colName],
            }
          }
          return select
        }),
      // Select with aggregates (if GROUP BY is present)
      generateAggregateSelect(table)
    )
  })
}

/**
 * Generates aggregate SELECT clause
 */
function generateAggregateSelect(
  table: TestSchema[`tables`][0]
): fc.Arbitrary<Record<string, Aggregate>> {
  const numericColumns = table.columns.filter((col) => col.type === `number`)

  if (numericColumns.length === 0) {
    return fc.constant({})
  }

  return fc
    .array(
      fc.tuple(
        fc.constantFrom(`count`, `sum`, `avg`, `min`, `max`),
        fc.constantFrom(...numericColumns.map((col) => col.name))
      ),
      { minLength: 1, maxLength: 3 }
    )
    .map((aggregates) => {
      const select: Record<string, Aggregate> = {}
      for (const [aggName, colName] of aggregates) {
        select[`${aggName}_${colName}`] = {
          type: `agg` as const,
          name: aggName,
          args: [
            {
              type: `ref` as const,
              path: [table.name, colName],
            },
          ],
        }
      }
      return select
    })
}

/**
 * Generates the WHERE clause
 */
function generateWhere(
  schema: TestSchema
): fc.Arbitrary<Array<BasicExpression<boolean>>> {
  if (schema.tables.length === 0) {
    return fc.constant([])
  }

  return fc.constantFrom(...schema.tables).chain((table) => {
    return fc
      .array(generatePredicate(table), { minLength: 0, maxLength: 3 })
      .map((predicates) => predicates.filter(Boolean))
  })
}

/**
 * Generates a single predicate
 */
function generatePredicate(
  table: TestSchema[`tables`][0]
): fc.Arbitrary<BasicExpression<boolean> | null> {
  const columns = table.columns

  if (columns.length === 0) {
    return fc.constant(null)
  }

  const numericColumns = columns.filter((col) => col.type === `number`)
  const stringColumns = columns.filter((col) => col.type === `string`)

  const predicates: Array<fc.Arbitrary<BasicExpression<boolean>>> = [
    // Equality predicate
    fc
      .tuple(
        fc.constantFrom(...columns.map((col) => col.name)),
        generateValueForColumn(fc.constantFrom(...columns))
      )
      .map(([colName, value]) => ({
        type: `func` as const,
        name: `eq`,
        args: [
          { type: `ref` as const, path: [table.name, colName] },
          { type: `val` as const, value },
        ],
      })),
  ]

  // Add numeric comparison predicates if numeric columns exist
  if (numericColumns.length > 0) {
    predicates.push(
      fc
        .tuple(
          fc.constantFrom(...numericColumns.map((col) => col.name)),
          fc.constantFrom(`gt`, `lt`, `gte`, `lte`),
          generateValueForColumn(fc.constantFrom(...numericColumns))
        )
        .map(([colName, op, value]) => ({
          type: `func` as const,
          name: op,
          args: [
            { type: `ref` as const, path: [table.name, colName] },
            { type: `val` as const, value },
          ],
        }))
    )
  }

  // Add string predicates if string columns exist
  if (stringColumns.length > 0) {
    predicates.push(
      fc
        .tuple(
          fc.constantFrom(...stringColumns.map((col) => col.name)),
          fc.constantFrom(`like`, `startsWith`, `endsWith`),
          fc.string({ minLength: 1, maxLength: 5 })
        )
        .map(([colName, op, value]) => ({
          type: `func` as const,
          name: op,
          args: [
            { type: `ref` as const, path: [table.name, colName] },
            { type: `val` as const, value },
          ],
        }))
    )
  }

  return fc.oneof(...predicates)
}

/**
 * Generates a value for a specific column
 */
function generateValueForColumn(
  columnArb: fc.Arbitrary<TestSchema[`tables`][0][`columns`][0]>
): fc.Arbitrary<any> {
  return columnArb.chain((column) => {
    switch (column.type) {
      case `string`:
        return fc.string({ minLength: 1, maxLength: 10 })
      case `number`:
        return fc.integer({ min: -1000, max: 1000 })
      case `boolean`:
        return fc.boolean()
      case `null`:
        return fc.constant(null)
      default:
        return fc.constant(null)
    }
  })
}

/**
 * Generates the GROUP BY clause
 */
function generateGroupBy(
  schema: TestSchema
): fc.Arbitrary<Array<BasicExpression>> {
  if (schema.tables.length === 0) {
    return fc.constant([])
  }

  return fc.constantFrom(...schema.tables).chain((table) => {
    const columns = table.columns

    if (columns.length === 0) {
      return fc.constant([])
    }

    return fc
      .array(fc.constantFrom(...columns.map((col) => col.name)), {
        minLength: 0,
        maxLength: 2,
      })
      .map((selectedColumns) =>
        selectedColumns.map((colName) => ({
          type: `ref` as const,
          path: [table.name, colName],
        }))
      )
  })
}

/**
 * Generates the ORDER BY clause
 */
function generateOrderBy(
  schema: TestSchema
): fc.Arbitrary<Array<OrderByClause>> {
  if (schema.tables.length === 0) {
    return fc.constant([])
  }

  return fc.constantFrom(...schema.tables).chain((table) => {
    const columns = table.columns

    if (columns.length === 0) {
      return fc.constant([])
    }

    return fc
      .array(
        fc.tuple(
          fc.constantFrom(...columns.map((col) => col.name)),
          fc.constantFrom(`asc`, `desc`)
        ),
        { minLength: 1, maxLength: 2 }
      )
      .map((orderings) =>
        orderings.map(([colName, direction]) => ({
          expression: {
            type: `ref` as const,
            path: [table.name, colName],
          },
          direction,
        }))
      )
  })
}

/**
 * Generates LIMIT and OFFSET
 */
function generateLimitOffset(): fc.Arbitrary<{
  limit?: number
  offset?: number
}> {
  return fc
    .tuple(
      fc.option(fc.integer({ min: 1, max: 100 })),
      fc.option(fc.integer({ min: 0, max: 50 }))
    )
    .map(([limit, offset]) => ({
      ...(limit && { limit }),
      ...(offset && { offset }),
    }))
}

/**
 * Generates a join query
 */
export function generateJoinQuery(schema: TestSchema): fc.Arbitrary<QueryIR> {
  if (schema.joinHints.length === 0) {
    return generateQueryAST(schema)
  }

  return fc.constantFrom(...schema.joinHints).chain((hint) => {
    const _table1 = schema.tables.find((t) => t.name === hint.table1)!
    const _table2 = schema.tables.find((t) => t.name === hint.table2)!

    return fc
      .tuple(
        generateFrom(schema),
        generateJoinClause(hint),
        generateSelect(schema),
        generateWhere(schema),
        generateOrderBy(schema),
        generateLimitOffset()
      )
      .map(([from, join, select, where, orderBy, { limit, offset }]) => ({
        from,
        join: [join],
        select,
        where,
        orderBy,
        limit,
        offset,
      }))
  })
}

/**
 * Generates a join clause
 */
function generateJoinClause(
  hint: TestSchema[`joinHints`][0]
): fc.Arbitrary<any> {
  return fc.constant({
    from: {
      type: `collectionRef` as const,
      collection: null as any,
      alias: hint.table2,
    },
    type: `inner` as const,
    left: {
      type: `ref` as const,
      path: [hint.table1, hint.column1],
    },
    right: {
      type: `ref` as const,
      path: [hint.table2, hint.column2],
    },
  })
}

/**
 * Creates a complete test sequence with queries
 */
export function generateCompleteTestSequence(
  schema: TestSchema,
  config: GeneratorConfig = {}
): fc.Arbitrary<Array<TestCommand>> {
  const { maxCommands = 40 } = config

  return fc
    .tuple(
      generateMutationCommands(schema, config),
      generateQueryCommands(schema, config)
    )
    .map(([mutations, queries]) => {
      // Interleave mutations and queries
      const allCommands: Array<TestCommand> = []
      const mutationCommands = [...mutations]
      const queryCommands = [...queries]

      while (mutationCommands.length > 0 || queryCommands.length > 0) {
        if (mutationCommands.length > 0) {
          allCommands.push(mutationCommands.shift()!)
        }
        if (queryCommands.length > 0) {
          allCommands.push(queryCommands.shift()!)
        }
      }

      return allCommands.slice(0, maxCommands)
    })
}
