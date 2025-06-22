import {
  consolidate,
  filter,
  join as joinOperator,
  map,
} from "@electric-sql/d2mini"
import { evaluateExpression } from "./evaluators.js"
import { compileQuery } from "./index.js"
import type { CollectionRef, JoinClause, QueryRef } from "../ir.js"
import type { IStreamBuilder, JoinType } from "@electric-sql/d2mini"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  NamespacedRow,
} from "../../types.js"

/**
 * Processes all join clauses in a query
 */
export function processJoins(
  pipeline: NamespacedAndKeyedStream,
  joinClauses: Array<JoinClause>,
  tables: Record<string, KeyedStream>,
  mainTableAlias: string,
  allInputs: Record<string, KeyedStream>
): NamespacedAndKeyedStream {
  let resultPipeline = pipeline

  for (const joinClause of joinClauses) {
    resultPipeline = processJoin(
      resultPipeline,
      joinClause,
      tables,
      mainTableAlias,
      allInputs
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
  allInputs: Record<string, KeyedStream>
): NamespacedAndKeyedStream {
  // Get the joined table alias and input stream
  const { alias: joinedTableAlias, input: joinedInput } = processJoinSource(
    joinClause.from,
    allInputs
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

  // Prepare the main pipeline for joining
  const mainPipeline = pipeline.pipe(
    map(([currentKey, namespacedRow]) => {
      // Extract the join key from the left side of the join condition
      const leftKey = evaluateExpression(joinClause.left, namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [leftKey, [currentKey, namespacedRow]] as [
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

      // Extract the join key from the right side of the join condition
      const rightKey = evaluateExpression(joinClause.right, namespacedRow)

      // Return [joinKey, [originalKey, namespacedRow]]
      return [rightKey, [currentKey, namespacedRow]] as [
        unknown,
        [string, typeof namespacedRow],
      ]
    })
  )

  // Apply the join operation
  switch (joinType) {
    case `inner`:
      return mainPipeline.pipe(
        joinOperator(joinedPipeline, `inner`),
        consolidate(),
        processJoinResults(joinClause.type)
      )
    case `left`:
      return mainPipeline.pipe(
        joinOperator(joinedPipeline, `left`),
        consolidate(),
        processJoinResults(joinClause.type)
      )
    case `right`:
      return mainPipeline.pipe(
        joinOperator(joinedPipeline, `right`),
        consolidate(),
        processJoinResults(joinClause.type)
      )
    case `full`:
      return mainPipeline.pipe(
        joinOperator(joinedPipeline, `full`),
        consolidate(),
        processJoinResults(joinClause.type)
      )
    default:
      throw new Error(`Unsupported join type: ${joinClause.type}`)
  }
}

/**
 * Processes the join source (collection or sub-query)
 */
function processJoinSource(
  from: CollectionRef | QueryRef,
  allInputs: Record<string, KeyedStream>
): { alias: string; input: KeyedStream } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.collection.id]
      if (!input) {
        throw new Error(
          `Input for collection "${from.collection.id}" not found in inputs map`
        )
      }
      return { alias: from.alias, input }
    }
    case `queryRef`: {
      // Recursively compile the sub-query
      const subQueryInput = compileQuery(from.query, allInputs)
      return { alias: from.alias, input: subQueryInput as KeyedStream }
    }
    default:
      throw new Error(`Unsupported join source type: ${(from as any).type}`)
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
