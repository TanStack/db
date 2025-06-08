import {
  consolidate,
  filter,
  join as joinOperator,
  map,
} from "@electric-sql/d2ts"
import { evaluateConditionOnNamespacedRow } from "./evaluators.js"
import { extractJoinKey } from "./extractors.js"
import type { Query } from "./index.js"
import type { IStreamBuilder, JoinType } from "@electric-sql/d2ts"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../types.js"

/**
 * Creates a processing pipeline for join clauses
 */
export function processJoinClause(
  pipeline: NamespacedAndKeyedStream,
  query: Query,
  tables: Record<string, KeyedStream>,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>
) {
  if (!query.join) return pipeline
  const input = allInputs[query.from]

  for (const joinClause of query.join) {
    // Create a stream for the joined table
    const joinedTableAlias = joinClause.as || joinClause.from

    // Get the right join type for the operator
    const joinType: JoinType =
      joinClause.type === `cross` ? `inner` : joinClause.type

    // The `in` is formatted as ['@mainKeyRef', '=', '@joinedKeyRef']
    // Destructure the main key reference and the joined key references
    const [mainKeyRef, , joinedKeyRefs] = joinClause.on

    // We need to prepare the main pipeline and the joined pipeline
    // to have the correct key format for joining
    const mainPipeline = pipeline.pipe(
      map(([currentKey, namespacedRow]) => {
        // Extract the key from the ON condition left side for the main table
        const mainRow = namespacedRow[mainTableAlias]!

        // Extract the join key from the main row
        const key = extractJoinKey(mainRow, mainKeyRef, mainTableAlias)

        // Return [key, namespacedRow] as a KeyValue type
        return [key, [currentKey, namespacedRow]] as [
          unknown,
          [string, typeof namespacedRow],
        ]
      })
    )

    // Get the joined table input from the inputs map
    let joinedTableInput: KeyedStream

    if (allInputs[joinClause.from]) {
      // Use the provided input if available
      joinedTableInput = allInputs[joinClause.from]!
    } else {
      // Create a new input if not provided
      joinedTableInput =
        input!.graph.newInput<[string, Record<string, unknown>]>()
    }

    tables[joinedTableAlias] = joinedTableInput

    // Create a pipeline for the joined table
    const joinedPipeline = joinedTableInput.pipe(
      map(([currentKey, row]) => {
        // Wrap the row in an object with the table alias as the key
        const namespacedRow: NamespacedRow = { [joinedTableAlias]: row }

        // Extract the key from the ON condition right side for the joined table
        const key = extractJoinKey(row, joinedKeyRefs, joinedTableAlias)

        // Return [key, namespacedRow] as a KeyValue type
        return [key, [currentKey, namespacedRow]] as [
          string,
          [string, typeof namespacedRow],
        ]
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
  joinClause: { on: any; type: string }
) {
  return function (
    pipeline: IStreamBuilder<
      [
        key: string,
        [[string, NamespacedRow], [string, NamespacedRow] | undefined],
      ]
    >
  ): NamespacedAndKeyedStream {
    return pipeline.pipe(
      // Process the join result and handle nulls in the same step
      map((result) => {
        const [_key, [main, joined]] = result
        const mainKey = main[0]
        const mainNamespacedRow = main[1]
        const joinedKey = joined?.[0]
        const joinedNamespacedRow = joined?.[1]

        // For inner joins, both sides should be non-null
        if (joinClause.type === `inner` || joinClause.type === `cross`) {
          if (!mainNamespacedRow || !joinedNamespacedRow) {
            return undefined // Will be filtered out
          }
        }

        // For left joins, the main row must be non-null
        if (joinClause.type === `left` && !mainNamespacedRow) {
          return undefined // Will be filtered out
        }

        // For right joins, the joined row must be non-null
        if (joinClause.type === `right` && !joinedNamespacedRow) {
          return undefined // Will be filtered out
        }

        // Merge the nested rows
        const mergedNamespacedRow: NamespacedRow = {}

        // Add main row data if it exists
        if (mainNamespacedRow) {
          Object.entries(mainNamespacedRow).forEach(
            ([tableAlias, tableData]) => {
              mergedNamespacedRow[tableAlias] = tableData
            }
          )
        }

        // If we have a joined row, add it to the merged result
        if (joinedNamespacedRow) {
          Object.entries(joinedNamespacedRow).forEach(
            ([tableAlias, tableData]) => {
              mergedNamespacedRow[tableAlias] = tableData
            }
          )
        } else if (joinClause.type === `left` || joinClause.type === `full`) {
          // For left or full joins, add the joined table with undefined data if missing
          // mergedNamespacedRow[joinedTableAlias] = undefined
        }

        // For right or full joins, add the main table with undefined data if missing
        if (
          !mainNamespacedRow &&
          (joinClause.type === `right` || joinClause.type === `full`)
        ) {
          // mergedNamespacedRow[mainTableAlias] = undefined
        }

        // New key
        const newKey = `[${mainKey},${joinedKey}]`

        return [newKey, mergedNamespacedRow] as [
          string,
          typeof mergedNamespacedRow,
        ]
      }),
      // Filter out undefined results
      filter((value) => value !== undefined),
      // Process the ON condition
      filter(([_key, namespacedRow]: [string, NamespacedRow]) => {
        // If there's no ON condition, or it's a cross join, always return true
        if (!joinClause.on || joinClause.type === `cross`) {
          return true
        }

        // For LEFT JOIN, if the right side is null, we should include the row
        if (
          joinClause.type === `left` &&
          namespacedRow[joinedTableAlias] === undefined
        ) {
          return true
        }

        // For RIGHT JOIN, if the left side is null, we should include the row
        if (
          joinClause.type === `right` &&
          namespacedRow[mainTableAlias] === undefined
        ) {
          return true
        }

        // For FULL JOIN, if either side is null, we should include the row
        if (
          joinClause.type === `full` &&
          (namespacedRow[mainTableAlias] === undefined ||
            namespacedRow[joinedTableAlias] === undefined)
        ) {
          return true
        }

        return evaluateConditionOnNamespacedRow(
          namespacedRow,
          joinClause.on,
          mainTableAlias,
          joinedTableAlias
        )
      })
    )
  }
}
