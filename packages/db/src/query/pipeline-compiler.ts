import { filter, map } from "@electric-sql/d2ts"
import { evaluateConditionOnNestedRow } from "./evaluators.js"
import { processJoinClause } from "./joins.js"
import { processGroupBy } from "./group-by.js"
import { processOrderBy } from "./order-by.js"
import { processKeyBy } from "./key-by.js"
import { processSelect } from "./select.js"
import type { Condition, Query } from "./schema.js"
import type { IStreamBuilder } from "@electric-sql/d2ts"

/**
 * Compiles a query into a D2 pipeline
 * @param query The query to compile
 * @param inputs Mapping of table names to input streams
 * @returns A stream builder representing the compiled query
 */
export function compileQueryPipeline<T extends IStreamBuilder<unknown>>(
  query: Query,
  inputs: Record<string, IStreamBuilder<Record<string, unknown>>>
): T {
  // Create a copy of the inputs map to avoid modifying the original
  const allInputs = { ...inputs }

  // Process WITH queries if they exist
  if (query.with && query.with.length > 0) {
    // Process each WITH query in order
    for (const withQuery of query.with) {
      // Ensure the WITH query has an alias
      if (!withQuery.as) {
        throw new Error(`WITH query must have an "as" property`)
      }

      // Ensure the WITH query is not keyed
      if ((withQuery as Query).keyBy !== undefined) {
        throw new Error(`WITH query cannot have a "keyBy" property`)
      }

      // Check if this CTE name already exists in the inputs
      if (allInputs[withQuery.as]) {
        throw new Error(`CTE with name "${withQuery.as}" already exists`)
      }

      // Create a new query without the 'with' property to avoid circular references
      const withQueryWithoutWith = { ...withQuery, with: undefined }

      // Compile the WITH query using the current set of inputs
      // (which includes previously compiled WITH queries)
      const compiledWithQuery = compileQueryPipeline(
        withQueryWithoutWith,
        allInputs
      )

      // Add the compiled query to the inputs map using its alias
      allInputs[withQuery.as] = compiledWithQuery as IStreamBuilder<
        Record<string, unknown>
      >
    }
  }

  // Create a map of table aliases to inputs
  const tables: Record<string, IStreamBuilder<Record<string, unknown>>> = {}

  // The main table is the one in the FROM clause
  const mainTableAlias = query.as || query.from

  // Get the main input from the inputs map (now including CTEs)
  const input = allInputs[query.from]
  if (!input) {
    throw new Error(`Input for table "${query.from}" not found in inputs map`)
  }

  tables[mainTableAlias] = input

  // Prepare the initial pipeline with the main table wrapped in its alias
  let pipeline = input.pipe(
    map((row: unknown) => {
      // Initialize the record with a nested structure
      return { [mainTableAlias]: row } as Record<string, unknown>
    })
  )

  // Process JOIN clauses if they exist
  if (query.join) {
    pipeline = processJoinClause(
      pipeline,
      query,
      tables,
      mainTableAlias,
      allInputs
    )
  }

  // Process the WHERE clause if it exists
  if (query.where) {
    pipeline = pipeline.pipe(
      filter((nestedRow) => {
        const result = evaluateConditionOnNestedRow(
          nestedRow,
          query.where as Condition,
          mainTableAlias
        )
        return result
      })
    )
  }

  // Process the GROUP BY clause if it exists
  if (query.groupBy) {
    pipeline = processGroupBy(pipeline, query, mainTableAlias)
  }

  // Process the HAVING clause if it exists
  // This works similarly to WHERE but is applied after any aggregations
  if (query.having) {
    pipeline = pipeline.pipe(
      filter((row) => {
        // For HAVING, we're working with the flattened row that contains both
        // the group by keys and the aggregate results directly
        const result = evaluateConditionOnNestedRow(
          { [mainTableAlias]: row, ...row } as Record<string, unknown>,
          query.having as Condition,
          mainTableAlias
        )
        return result
      })
    )
  }

  // Process the SELECT clause - this is where we flatten the structure
  pipeline = processSelect(pipeline, query, mainTableAlias, allInputs)

  let resultPipeline: IStreamBuilder<
    Record<string, unknown> | [string | number, Record<string, unknown>]
  > = pipeline

  // Process keyBy parameter if it exists
  if (query.keyBy) {
    resultPipeline = processKeyBy(resultPipeline, query)
  }

  // Process orderBy parameter if it exists
  if (query.orderBy) {
    resultPipeline = processOrderBy(resultPipeline, query, mainTableAlias)
  } else if (query.limit !== undefined || query.offset !== undefined) {
    // If there's a limit or offset without orderBy, throw an error
    throw new Error(
      `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
    )
  }

  return resultPipeline as T
}
