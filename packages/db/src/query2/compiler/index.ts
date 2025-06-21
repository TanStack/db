import { filter, map } from "@electric-sql/d2mini"
import { evaluateExpression } from "./evaluators.js"
import { processJoins } from "./joins.js"
import { processGroupBy } from "./group-by.js"
import { processOrderBy } from "./order-by.js"
import { processSelect } from "./select.js"
import type { CollectionRef, Query, QueryRef } from "../ir.js"
import type { IStreamBuilder } from "@electric-sql/d2mini"
import type {
  InputRow,
  KeyedStream,
  NamespacedAndKeyedStream,
} from "../../types.js"

/**
 * Compiles a query2 IR into a D2 pipeline
 * @param query The query IR to compile
 * @param inputs Mapping of collection names to input streams
 * @returns A stream builder representing the compiled query
 */
export function compileQuery<T extends IStreamBuilder<unknown>>(
  query: Query,
  inputs: Record<string, KeyedStream>
): T {
  // Create a copy of the inputs map to avoid modifying the original
  const allInputs = { ...inputs }

  // Create a map of table aliases to inputs
  const tables: Record<string, KeyedStream> = {}

  // Process the FROM clause to get the main table
  const { alias: mainTableAlias, input: mainInput } = processFrom(
    query.from,
    allInputs
  )
  tables[mainTableAlias] = mainInput

  // Prepare the initial pipeline with the main table wrapped in its alias
  let pipeline: NamespacedAndKeyedStream = mainInput.pipe(
    map(([key, row]) => {
      // Initialize the record with a nested structure
      const ret = [key, { [mainTableAlias]: row }] as [
        string,
        Record<string, typeof row>,
      ]
      return ret
    })
  )

  // Process JOIN clauses if they exist
  if (query.join && query.join.length > 0) {
    pipeline = processJoins(
      pipeline,
      query.join,
      tables,
      mainTableAlias,
      allInputs
    )
  }

  // Process the WHERE clause if it exists
  if (query.where) {
    pipeline = pipeline.pipe(
      filter(([_key, namespacedRow]) => {
        return evaluateExpression(query.where!, namespacedRow)
      })
    )
  }

  // Process the GROUP BY clause if it exists
  if (query.groupBy && query.groupBy.length > 0) {
    pipeline = processGroupBy(
      pipeline,
      query.groupBy,
      query.having,
      query.select
    )

    // HAVING clause is handled within processGroupBy

    // Process orderBy parameter if it exists
    if (query.orderBy && query.orderBy.length > 0) {
      pipeline = processOrderBy(pipeline, query.orderBy)
    } else if (query.limit !== undefined || query.offset !== undefined) {
      // If there's a limit or offset without orderBy, throw an error
      throw new Error(
        `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
      )
    }

    // For GROUP BY queries, the SELECT is handled within processGroupBy
    return pipeline as T
  }

  // Process the HAVING clause if it exists (only applies after GROUP BY)
  if (query.having) {
    throw new Error(`HAVING clause requires GROUP BY clause`)
  }

  // Process orderBy parameter if it exists
  if (query.orderBy && query.orderBy.length > 0) {
    pipeline = processOrderBy(pipeline, query.orderBy)
  } else if (query.limit !== undefined || query.offset !== undefined) {
    // If there's a limit or offset without orderBy, throw an error
    throw new Error(
      `LIMIT and OFFSET require an ORDER BY clause to ensure deterministic results`
    )
  }

  // Process the SELECT clause - this is where we flatten the structure
  const resultPipeline: KeyedStream | NamespacedAndKeyedStream = query.select
    ? processSelect(pipeline, query.select, allInputs)
    : // If no select clause, return the main table data directly
      !query.join && !query.groupBy
      ? pipeline.pipe(
          map(
            ([key, namespacedRow]) =>
              [key, namespacedRow[mainTableAlias]] as InputRow
          )
        )
      : pipeline

  return resultPipeline as T
}

/**
 * Processes the FROM clause to extract the main table alias and input stream
 */
function processFrom(
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
      throw new Error(`Unsupported FROM type: ${(from as any).type}`)
  }
}
