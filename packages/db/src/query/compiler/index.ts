import { distinct, filter, map } from "@tanstack/db-ivm"
import { optimizeQuery } from "../optimizer.js"
import {
  CollectionInputNotFoundError,
  DistinctRequiresSelectError,
  HavingRequiresGroupByError,
  LimitOffsetRequireOrderByError,
  UnsupportedFromTypeError,
} from "../../errors.js"
import { compileExpression } from "./evaluators.js"
import { processJoins } from "./joins.js"
import { processGroupBy } from "./group-by.js"
import { processOrderBy } from "./order-by.js"
import { processSelectToResults } from "./select.js"
import type {
  BasicExpression,
  CollectionRef,
  QueryIR,
  QueryRef,
} from "../ir.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  ResultStream,
} from "../../types.js"
import type { QueryCache, QueryMapping } from "./types.js"

/**
 * Result of query compilation including both the pipeline and collection-specific WHERE clauses
 */
export interface CompilationResult {
  /** The compiled query pipeline */
  pipeline: ResultStream
  /** Map of collection aliases to their WHERE clauses for index optimization */
  collectionWhereClauses: Map<string, BasicExpression<boolean>>
}

/**
 * Compiles a query2 IR into a D2 pipeline
 * @param rawQuery The query IR to compile
 * @param inputs Mapping of collection names to input streams
 * @param cache Optional cache for compiled subqueries (used internally for recursion)
 * @param queryMapping Optional mapping from optimized queries to original queries
 * @returns A CompilationResult with the pipeline and collection WHERE clauses
 */
export function compileQuery(
  rawQuery: QueryIR,
  inputs: Record<string, KeyedStream>,
  cache: QueryCache = new WeakMap(),
  queryMapping: QueryMapping = new WeakMap()
): CompilationResult {
  // Check if the original raw query has already been compiled
  const cachedResult = cache.get(rawQuery)
  if (cachedResult) {
    return cachedResult
  }

  // Optimize the query before compilation
  const { optimizedQuery: query, collectionWhereClauses } =
    optimizeQuery(rawQuery)

  // Create mapping from optimized query to original for caching
  queryMapping.set(query, rawQuery)
  mapNestedQueries(query, rawQuery, queryMapping)

  // Create a copy of the inputs map to avoid modifying the original
  const allInputs = { ...inputs }

  // Create a map of table aliases to inputs
  const tables: Record<string, KeyedStream> = {}

  // Process the FROM clause to get the main table
  const { alias: mainTableAlias, input: mainInput } = processFrom(
    query.from,
    allInputs,
    cache,
    queryMapping
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
      allInputs,
      cache,
      queryMapping
    )
  }

  // Process the WHERE clause if it exists
  if (query.where && query.where.length > 0) {
    // Apply each WHERE condition as a filter (they are ANDed together)
    for (const where of query.where) {
      const compiledWhere = compileExpression(where)
      pipeline = pipeline.pipe(
        filter(([_key, namespacedRow]) => {
          return compiledWhere(namespacedRow)
        })
      )
    }
  }

  // Process functional WHERE clauses if they exist
  if (query.fnWhere && query.fnWhere.length > 0) {
    for (const fnWhere of query.fnWhere) {
      pipeline = pipeline.pipe(
        filter(([_key, namespacedRow]) => {
          return fnWhere(namespacedRow)
        })
      )
    }
  }

  if (query.distinct && !query.fnSelect && !query.select) {
    throw new DistinctRequiresSelectError()
  }

  // Process the SELECT clause early - always create __select_results
  // This eliminates duplication and allows for DISTINCT implementation
  if (query.fnSelect) {
    // Handle functional select - apply the function to transform the row
    pipeline = pipeline.pipe(
      map(([key, namespacedRow]) => {
        const selectResults = query.fnSelect!(namespacedRow)
        return [
          key,
          {
            ...namespacedRow,
            __select_results: selectResults,
          },
        ] as [string, typeof namespacedRow & { __select_results: any }]
      })
    )
  } else if (query.select) {
    pipeline = processSelectToResults(pipeline, query.select, allInputs)
  } else {
    // If no SELECT clause, create __select_results with the main table data
    pipeline = pipeline.pipe(
      map(([key, namespacedRow]) => {
        const selectResults =
          !query.join && !query.groupBy
            ? namespacedRow[mainTableAlias]
            : namespacedRow

        return [
          key,
          {
            ...namespacedRow,
            __select_results: selectResults,
          },
        ] as [string, typeof namespacedRow & { __select_results: any }]
      })
    )
  }

  // Process the GROUP BY clause if it exists
  if (query.groupBy && query.groupBy.length > 0) {
    pipeline = processGroupBy(
      pipeline,
      query.groupBy,
      query.having,
      query.select,
      query.fnHaving
    )
  } else if (query.select) {
    // Check if SELECT contains aggregates but no GROUP BY (implicit single-group aggregation)
    const hasAggregates = Object.values(query.select).some(
      (expr) => expr.type === `agg`
    )
    if (hasAggregates) {
      // Handle implicit single-group aggregation
      pipeline = processGroupBy(
        pipeline,
        [], // Empty group by means single group
        query.having,
        query.select,
        query.fnHaving
      )
    }
  }

  // Process the HAVING clause if it exists (only applies after GROUP BY)
  if (query.having && (!query.groupBy || query.groupBy.length === 0)) {
    // Check if we have aggregates in SELECT that would trigger implicit grouping
    const hasAggregates = query.select
      ? Object.values(query.select).some((expr) => expr.type === `agg`)
      : false

    if (!hasAggregates) {
      throw new HavingRequiresGroupByError()
    }
  }

  // Process functional HAVING clauses outside of GROUP BY (treat as additional WHERE filters)
  if (
    query.fnHaving &&
    query.fnHaving.length > 0 &&
    (!query.groupBy || query.groupBy.length === 0)
  ) {
    // If there's no GROUP BY but there are fnHaving clauses, apply them as filters
    for (const fnHaving of query.fnHaving) {
      pipeline = pipeline.pipe(
        filter(([_key, namespacedRow]) => {
          return fnHaving(namespacedRow)
        })
      )
    }
  }

  // Process the DISTINCT clause if it exists
  if (query.distinct) {
    pipeline = pipeline.pipe(distinct(([_key, row]) => row.__select_results))
  }

  // Process orderBy parameter if it exists
  if (query.orderBy && query.orderBy.length > 0) {
    const orderedPipeline = processOrderBy(
      pipeline,
      query.orderBy,
      query.limit,
      query.offset
    )

    // Final step: extract the __select_results and include orderBy index
    const resultPipeline = orderedPipeline.pipe(
      map(([key, [row, orderByIndex]]) => {
        // Extract the final results from __select_results and include orderBy index
        const finalResults = (row as any).__select_results
        return [key, [finalResults, orderByIndex]] as [unknown, [any, string]]
      })
    )

    const result = resultPipeline
    // Cache the result before returning (use original query as key)
    const compilationResult = {
      pipeline: result,
      collectionWhereClauses,
    }
    cache.set(rawQuery, compilationResult)

    return compilationResult
  } else if (query.limit !== undefined || query.offset !== undefined) {
    // If there's a limit or offset without orderBy, throw an error
    throw new LimitOffsetRequireOrderByError()
  }

  // Final step: extract the __select_results and return tuple format (no orderBy)
  const resultPipeline: ResultStream = pipeline.pipe(
    map(([key, row]) => {
      // Extract the final results from __select_results and return [key, [results, undefined]]
      const finalResults = (row as any).__select_results
      return [key, [finalResults, undefined]] as [
        unknown,
        [any, string | undefined],
      ]
    })
  )

  const result = resultPipeline
  // Cache the result before returning (use original query as key)
  const compilationResult = {
    pipeline: result,
    collectionWhereClauses,
  }
  cache.set(rawQuery, compilationResult)

  return compilationResult
}

/**
 * Processes the FROM clause to extract the main table alias and input stream
 */
function processFrom(
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

      return { alias: from.alias, input: extractedInput }
    }
    default:
      throw new UnsupportedFromTypeError((from as any).type)
  }
}

/**
 * Recursively maps optimized subqueries to their original queries for proper caching.
 * This ensures that when we encounter the same QueryRef object in different contexts,
 * we can find the original query to check the cache.
 */
function mapNestedQueries(
  optimizedQuery: QueryIR,
  originalQuery: QueryIR,
  queryMapping: QueryMapping
): void {
  // Map the FROM clause if it's a QueryRef
  if (
    optimizedQuery.from.type === `queryRef` &&
    originalQuery.from.type === `queryRef`
  ) {
    queryMapping.set(optimizedQuery.from.query, originalQuery.from.query)
    // Recursively map nested queries
    mapNestedQueries(
      optimizedQuery.from.query,
      originalQuery.from.query,
      queryMapping
    )
  }

  // Map JOIN clauses if they exist
  if (optimizedQuery.join && originalQuery.join) {
    for (
      let i = 0;
      i < optimizedQuery.join.length && i < originalQuery.join.length;
      i++
    ) {
      const optimizedJoin = optimizedQuery.join[i]!
      const originalJoin = originalQuery.join[i]!

      if (
        optimizedJoin.from.type === `queryRef` &&
        originalJoin.from.type === `queryRef`
      ) {
        queryMapping.set(optimizedJoin.from.query, originalJoin.from.query)
        // Recursively map nested queries in joins
        mapNestedQueries(
          optimizedJoin.from.query,
          originalJoin.from.query,
          queryMapping
        )
      }
    }
  }
}
