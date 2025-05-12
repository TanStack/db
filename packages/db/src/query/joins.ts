import {
  consolidate,
  filter,
  join as joinOperator,
  map,
} from "@electric-sql/d2ts"
import { evaluateConditionOnNestedRow } from "./evaluators.js"
import { extractJoinKey } from "./extractors.js"
import type { Query } from "./index.js"
import type { IStreamBuilder, JoinType } from "@electric-sql/d2ts"

/**
 * Creates a processing pipeline for join clauses
 */
export function processJoinClause(
  pipeline: IStreamBuilder<Record<string, unknown>>,
  query: Query,
  tables: Record<string, IStreamBuilder<Record<string, unknown>>>,
  mainTableAlias: string,
  allInputs: Record<string, IStreamBuilder<Record<string, unknown>>>
) {
  if (!query.join) return pipeline
  const input = allInputs[query.from]

  for (const joinClause of query.join) {
    // Create a stream for the joined table
    const joinedTableAlias = joinClause.as || joinClause.from

    // Get the right join type for the operator
    const joinType: JoinType =
      joinClause.type === `cross` ? `inner` : joinClause.type

    // We need to prepare the main pipeline and the joined pipeline
    // to have the correct key format for joining
    const mainPipeline = pipeline.pipe(
      map((nestedRow: Record<string, unknown>) => {
        // Extract the key from the ON condition left side for the main table
        const mainRow = nestedRow[mainTableAlias] as Record<string, unknown>

        // Extract the join key from the main row
        const keyValue = extractJoinKey(
          mainRow,
          joinClause.on[0],
          mainTableAlias
        )

        // Return [key, nestedRow] as a KeyValue type
        return [keyValue, nestedRow] as [unknown, Record<string, unknown>]
      })
    )

    // Get the joined table input from the inputs map
    let joinedTableInput: IStreamBuilder<Record<string, unknown>>

    if (allInputs[joinClause.from]) {
      // Use the provided input if available
      joinedTableInput = allInputs[joinClause.from]!
    } else {
      // Create a new input if not provided
      joinedTableInput = input!.graph.newInput<Record<string, unknown>>()
    }

    tables[joinedTableAlias] = joinedTableInput

    // Create a pipeline for the joined table
    const joinedPipeline = joinedTableInput.pipe(
      map((row: Record<string, unknown>) => {
        // Wrap the row in an object with the table alias as the key
        const nestedRow = { [joinedTableAlias]: row }

        // Extract the key from the ON condition right side for the joined table
        const keyValue = extractJoinKey(row, joinClause.on[2], joinedTableAlias)

        // Return [key, nestedRow] as a KeyValue type
        return [keyValue, nestedRow] as [unknown, Record<string, unknown>]
      })
    )

    // Apply join with appropriate typings based on join type
    switch (joinType) {
      case `inner`:
        pipeline = mainPipeline.pipe(
          joinOperator(joinedPipeline, `inner`),
          consolidate(),
          processJoinResults(mainTableAlias, joinedTableAlias, joinClause)
        )
        break
      case `left`:
        pipeline = mainPipeline.pipe(
          joinOperator(joinedPipeline, `left`),
          consolidate(),
          processJoinResults(mainTableAlias, joinedTableAlias, joinClause)
        )
        break
      case `right`:
        pipeline = mainPipeline.pipe(
          joinOperator(joinedPipeline, `right`),
          consolidate(),
          processJoinResults(mainTableAlias, joinedTableAlias, joinClause)
        )
        break
      case `full`:
        pipeline = mainPipeline.pipe(
          joinOperator(joinedPipeline, `full`),
          consolidate(),
          processJoinResults(mainTableAlias, joinedTableAlias, joinClause)
        )
        break
      default:
        pipeline = mainPipeline.pipe(
          joinOperator(joinedPipeline, `inner`),
          consolidate(),
          processJoinResults(mainTableAlias, joinedTableAlias, joinClause)
        )
    }
  }
  return pipeline
}

/**
 * Creates a processing pipeline for join results
 */
export function processJoinResults(
  mainTableAlias: string,
  joinedTableAlias: string,
  joinClause: { on: any; where?: any; type: string }
) {
  return function (
    pipeline: IStreamBuilder<unknown>
  ): IStreamBuilder<Record<string, unknown>> {
    return pipeline.pipe(
      // Process the join result and handle nulls in the same step
      map((result: unknown) => {
        const [_key, [mainNestedRow, joinedNestedRow]] = result as [
          unknown,
          [
            Record<string, unknown> | undefined,
            Record<string, unknown> | undefined,
          ],
        ]

        // For inner joins, both sides should be non-null
        if (joinClause.type === `inner` || joinClause.type === `cross`) {
          if (!mainNestedRow || !joinedNestedRow) {
            return undefined // Will be filtered out
          }
        }

        // For left joins, the main row must be non-null
        if (joinClause.type === `left` && !mainNestedRow) {
          return undefined // Will be filtered out
        }

        // For right joins, the joined row must be non-null
        if (joinClause.type === `right` && !joinedNestedRow) {
          return undefined // Will be filtered out
        }

        // Merge the nested rows
        const mergedNestedRow: Record<string, unknown> = {}

        // Add main row data if it exists
        if (mainNestedRow) {
          Object.entries(mainNestedRow).forEach(([tableAlias, tableData]) => {
            mergedNestedRow[tableAlias] = tableData
          })
        }

        // If we have a joined row, add it to the merged result
        if (joinedNestedRow) {
          Object.entries(joinedNestedRow).forEach(([tableAlias, tableData]) => {
            mergedNestedRow[tableAlias] = tableData
          })
        } else if (joinClause.type === `left` || joinClause.type === `full`) {
          // For left or full joins, add the joined table with null data if missing
          mergedNestedRow[joinedTableAlias] = null
        }

        // For right or full joins, add the main table with null data if missing
        if (
          !mainNestedRow &&
          (joinClause.type === `right` || joinClause.type === `full`)
        ) {
          mergedNestedRow[mainTableAlias] = null
        }

        return mergedNestedRow
      }),
      // Filter out undefined results
      filter(
        (value: unknown): value is Record<string, unknown> =>
          value !== undefined
      ),
      // Process the ON condition
      filter((nestedRow: Record<string, unknown>) => {
        // If there's no ON condition, or it's a cross join, always return true
        if (!joinClause.on || joinClause.type === `cross`) {
          return true
        }

        // For LEFT JOIN, if the right side is null, we should include the row
        if (
          joinClause.type === `left` &&
          nestedRow[joinedTableAlias] === null
        ) {
          return true
        }

        // For RIGHT JOIN, if the left side is null, we should include the row
        if (joinClause.type === `right` && nestedRow[mainTableAlias] === null) {
          return true
        }

        // For FULL JOIN, if either side is null, we should include the row
        if (
          joinClause.type === `full` &&
          (nestedRow[mainTableAlias] === null ||
            nestedRow[joinedTableAlias] === null)
        ) {
          return true
        }

        const result = evaluateConditionOnNestedRow(
          nestedRow,
          joinClause.on,
          mainTableAlias,
          joinedTableAlias
        )
        return result
      }),
      // Process the WHERE clause for the join if it exists
      filter((nestedRow: Record<string, unknown>) => {
        if (!joinClause.where) {
          return true
        }

        const result = evaluateConditionOnNestedRow(
          nestedRow,
          joinClause.where,
          mainTableAlias,
          joinedTableAlias
        )
        return result
      })
    )
  }
}
