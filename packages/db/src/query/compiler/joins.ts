import {
  consolidate,
  filter,
  join as joinOperator,
  map,
} from "@tanstack/db-ivm"
import {
  CollectionInputNotFoundError,
  InvalidJoinConditionSameTableError,
  InvalidJoinConditionTableMismatchError,
  InvalidJoinConditionWrongTablesError,
  UnsupportedJoinSourceTypeError,
  UnsupportedJoinTypeError,
} from "../../errors.js"
import { compileExpression } from "./evaluators.js"
import { compileQuery } from "./index.js"
import type { IStreamBuilder, JoinType } from "@tanstack/db-ivm"
import type {
  BasicExpression,
  CollectionRef,
  JoinClause,
  QueryRef,
} from "../ir.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"
import type { QueryCache, QueryMapping } from "./types.js"

/**
 * Processes all join clauses in a query
 */
export function processJoins(
  pipeline: NamespacedAndKeyedStream,
  joinClauses: Array<JoinClause>,
  tables: Record<string, KeyedStream>,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping
): NamespacedAndKeyedStream {
  let resultPipeline = pipeline

  for (const joinClause of joinClauses) {
    resultPipeline = processJoin(
      resultPipeline,
      joinClause,
      tables,
      mainTableAlias,
      allInputs,
      cache,
      queryMapping
    )
  }

  return resultPipeline
}

/**
 * Processes a single join clause
 */
function processJoin(
  pipeline: NamespacedAndKeyedStream,
  joinClause: JoinClause,
  tables: Record<string, KeyedStream>,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping
): NamespacedAndKeyedStream {
  // Get the joined table alias and input stream
  const { alias: joinedTableAlias, input: joinedInput } = processJoinSource(
    joinClause.from,
    allInputs,
    cache,
    queryMapping
  )

  // Add the joined table to the tables map
  tables[joinedTableAlias] = joinedInput

  // Convert join type to D2 join type
  const joinType: JoinType =
    joinClause.type === `cross`
      ? `inner`
      : joinClause.type === `outer`
        ? `full`
        : (joinClause.type as JoinType)

  // Analyze which table each expression refers to and swap if necessary
  const { mainExpr, joinedExpr } = analyzeJoinExpressions(
    joinClause.left,
    joinClause.right,
    mainTableAlias,
    joinedTableAlias
  )

  // Pre-compile the join expressions
  const compiledMainExpr = compileExpression(mainExpr)
  const compiledJoinedExpr = compileExpression(joinedExpr)

  // Prepare the main pipeline for joining
  const mainPipeline = pipeline.pipe(
    map(([currentKey, namespacedRow]) => {
      // Extract the join key from the main table expression
      const mainKey = compiledMainExpr(namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [mainKey, [currentKey, namespacedRow]] as [
        unknown,
        [string, typeof namespacedRow],
      ]
    })
  )

  // Prepare the joined pipeline
  const joinedPipeline = joinedInput.pipe(
    map(([currentKey, row]) => {
      // Wrap the row in a namespaced structure
      const namespacedRow: NamespacedRow = { [joinedTableAlias]: row }

      // Extract the join key from the joined table expression
      const joinedKey = compiledJoinedExpr(namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [joinedKey, [currentKey, namespacedRow]] as [
        unknown,
        [string, typeof namespacedRow],
      ]
    })
  )

  // Apply the join operation
  if (![`inner`, `left`, `right`, `full`].includes(joinType)) {
    throw new UnsupportedJoinTypeError(joinClause.type)
  }
  return mainPipeline.pipe(
    joinOperator(joinedPipeline, joinType),
    consolidate(),
    processJoinResults(joinClause.type)
  )
}

/**
 * Analyzes join expressions to determine which refers to which table
 * and returns them in the correct order (main table expression first, joined table expression second)
 */
function analyzeJoinExpressions(
  left: BasicExpression,
  right: BasicExpression,
  mainTableAlias: string,
  joinedTableAlias: string
): { mainExpr: BasicExpression; joinedExpr: BasicExpression } {
  const leftTableAlias = getTableAliasFromExpression(left)
  const rightTableAlias = getTableAliasFromExpression(right)

  // If left expression refers to main table and right refers to joined table, keep as is
  if (
    leftTableAlias === mainTableAlias &&
    rightTableAlias === joinedTableAlias
  ) {
    return { mainExpr: left, joinedExpr: right }
  }

  // If left expression refers to joined table and right refers to main table, swap them
  if (
    leftTableAlias === joinedTableAlias &&
    rightTableAlias === mainTableAlias
  ) {
    return { mainExpr: right, joinedExpr: left }
  }

  // If both expressions refer to the same alias, this is an invalid join
  if (leftTableAlias === rightTableAlias) {
    throw new InvalidJoinConditionSameTableError(leftTableAlias || `unknown`)
  }

  // If one expression doesn't refer to either table, this is an invalid join
  if (!leftTableAlias || !rightTableAlias) {
    throw new InvalidJoinConditionTableMismatchError(
      mainTableAlias,
      joinedTableAlias
    )
  }

  // If expressions refer to tables not involved in this join, this is an invalid join
  throw new InvalidJoinConditionWrongTablesError(
    leftTableAlias,
    rightTableAlias,
    mainTableAlias,
    joinedTableAlias
  )
}

/**
 * Extracts the table alias from a join expression
 */
function getTableAliasFromExpression(expr: BasicExpression): string | null {
  switch (expr.type) {
    case `ref`:
      // PropRef path has the table alias as the first element
      return expr.path[0] || null
    case `func`: {
      // For function expressions, we need to check if all arguments refer to the same table
      const tableAliases = new Set<string>()
      for (const arg of expr.args) {
        const alias = getTableAliasFromExpression(arg)
        if (alias) {
          tableAliases.add(alias)
        }
      }
      // If all arguments refer to the same table, return that table alias
      return tableAliases.size === 1 ? Array.from(tableAliases)[0]! : null
    }
    default:
      // Values (type='val') don't reference any table
      return null
  }
}

/**
 * Processes the join source (collection or sub-query)
 */
function processJoinSource(
  from: CollectionRef | QueryRef,
  allInputs: Record<string, KeyedStream>,
  cache: QueryCache,
  queryMapping: QueryMapping
): { alias: string; input: KeyedStream } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.collection.id]
      if (!input) {
        throw new CollectionInputNotFoundError(from.collection.id)
      }
      return { alias: from.alias, input }
    }
    case `queryRef`: {
      // Find the original query for caching purposes
      const originalQuery = queryMapping.get(from.query) || from.query

      // Recursively compile the sub-query with cache
      const subQueryResult = compileQuery(
        originalQuery,
        allInputs,
        cache,
        queryMapping
      )

      // Extract the pipeline from the compilation result
      const subQueryInput = subQueryResult.pipeline

      // Subqueries may return [key, [value, orderByIndex]] (with ORDER BY) or [key, value] (without ORDER BY)
      // We need to extract just the value for use in parent queries
      const extractedInput = subQueryInput.pipe(
        map((data: any) => {
          const [key, [value, _orderByIndex]] = data
          return [key, value] as [unknown, any]
        })
      )

      return { alias: from.alias, input: extractedInput as KeyedStream }
    }
    default:
      throw new UnsupportedJoinSourceTypeError((from as any).type)
  }
}

/**
 * Processes the results of a join operation
 */
function processJoinResults(joinType: string) {
  return function (
    pipeline: IStreamBuilder<
      [
        key: string,
        [
          [string, NamespacedRow] | undefined,
          [string, NamespacedRow] | undefined,
        ],
      ]
    >
  ): NamespacedAndKeyedStream {
    return pipeline.pipe(
      // Process the join result and handle nulls
      filter((result) => {
        const [_key, [main, joined]] = result
        const mainNamespacedRow = main?.[1]
        const joinedNamespacedRow = joined?.[1]

        // Handle different join types
        if (joinType === `inner`) {
          return !!(mainNamespacedRow && joinedNamespacedRow)
        }

        if (joinType === `left`) {
          return !!mainNamespacedRow
        }

        if (joinType === `right`) {
          return !!joinedNamespacedRow
        }

        // For full joins, always include
        return true
      }),
      map((result) => {
        const [_key, [main, joined]] = result
        const mainKey = main?.[0]
        const mainNamespacedRow = main?.[1]
        const joinedKey = joined?.[0]
        const joinedNamespacedRow = joined?.[1]

        // Merge the namespaced rows
        const mergedNamespacedRow: NamespacedRow = {}

        // Add main row data if it exists
        if (mainNamespacedRow) {
          Object.assign(mergedNamespacedRow, mainNamespacedRow)
        }

        // Add joined row data if it exists
        if (joinedNamespacedRow) {
          Object.assign(mergedNamespacedRow, joinedNamespacedRow)
        }

        // We create a composite key that combines the main and joined keys
        const resultKey = `[${mainKey},${joinedKey}]`

        return [resultKey, mergedNamespacedRow] as [string, NamespacedRow]
      })
    )
  }
}
