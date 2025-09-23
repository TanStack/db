import { distinct, filter, map } from "@tanstack/db-ivm"
import { optimizeQuery } from "../optimizer.js"
import {
  CollectionInputNotFoundError,
  DistinctRequiresSelectError,
  HavingRequiresGroupByError,
  LimitOffsetRequireOrderByError,
  UnsupportedFromTypeError,
} from "../../errors.js"
import { PropRef, Value as ValClass, getWhereExpression } from "../ir.js"
import { compileExpression } from "./evaluators.js"
import { processJoins } from "./joins.js"
import { processGroupBy } from "./group-by.js"
import { processOrderBy } from "./order-by.js"
import { processSelect } from "./select.js"
import type { OrderByOptimizationInfo } from "./order-by.js"
import type {
  BasicExpression,
  CollectionRef,
  QueryIR,
  QueryRef,
} from "../ir.js"
import type { LazyCollectionCallbacks } from "./joins.js"
import type { Collection } from "../../collection/index.js"
import type {
  KeyedStream,
  NamespacedAndKeyedStream,
  ResultStream,
} from "../../types.js"
import type { QueryCache, QueryMapping } from "./types.js"
import { CollectionSubscription } from "../../collection-subscription.js"

/**
 * Result of query compilation including both the pipeline and collection-specific WHERE clauses
 */
export interface CompilationResult {
  /** The ID of the main collection */
  collectionId: string
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
  collections: Record<string, Collection<any, any, any, any, any>>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
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
  const {
    alias: mainTableAlias,
    input: mainInput,
    collectionId: mainCollectionId,
  } = processFrom(
    query.from,
    allInputs,
    collections,
    subscriptions,
    callbacks,
    lazyCollections,
    optimizableOrderByCollections,
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
      mainCollectionId,
      mainTableAlias,
      allInputs,
      cache,
      queryMapping,
      collections,
      subscriptions,
      callbacks,
      lazyCollections,
      optimizableOrderByCollections,
      rawQuery
    )
  }

  // Process the WHERE clause if it exists
  if (query.where && query.where.length > 0) {
    // Apply each WHERE condition as a filter (they are ANDed together)
    for (const where of query.where) {
      const whereExpression = getWhereExpression(where)
      const compiledWhere = compileExpression(whereExpression)
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
    pipeline = processSelect(pipeline, query.select, allInputs)
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
      rawQuery,
      pipeline,
      query.orderBy,
      query.select || {},
      collections[mainCollectionId]!,
      optimizableOrderByCollections,
      query.limit,
      query.offset
    )

    // Final step: extract the __select_results and include orderBy index
    const resultPipeline = orderedPipeline.pipe(
      map(([key, [row, orderByIndex]]) => {
        // Extract the final results from __select_results and include orderBy index
        const raw = (row as any).__select_results
        const finalResults = unwrapValue(raw)
        return [key, [finalResults, orderByIndex]] as [unknown, [any, string]]
      })
    )

    const result = resultPipeline
    // Cache the result before returning (use original query as key)
    const compilationResult = {
      collectionId: mainCollectionId,
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
      const raw = (row as any).__select_results
      const finalResults = unwrapValue(raw)
      return [key, [finalResults, undefined]] as [
        unknown,
        [any, string | undefined],
      ]
    })
  )

  const result = resultPipeline
  // Cache the result before returning (use original query as key)
  const compilationResult = {
    collectionId: mainCollectionId,
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
  collections: Record<string, Collection>,
  subscriptions: Record<string, CollectionSubscription>,
  callbacks: Record<string, LazyCollectionCallbacks>,
  lazyCollections: Set<string>,
  optimizableOrderByCollections: Record<string, OrderByOptimizationInfo>,
  cache: QueryCache,
  queryMapping: QueryMapping
): { alias: string; input: KeyedStream; collectionId: string } {
  switch (from.type) {
    case `collectionRef`: {
      const input = allInputs[from.collection.id]
      if (!input) {
        throw new CollectionInputNotFoundError(from.collection.id)
      }
      return { alias: from.alias, input, collectionId: from.collection.id }
    }
    case `queryRef`: {
      // Find the original query for caching purposes
      const originalQuery = queryMapping.get(from.query) || from.query

      // Recursively compile the sub-query with cache
      const subQueryResult = compileQuery(
        originalQuery,
        allInputs,
        collections,
        subscriptions,
        callbacks,
        lazyCollections,
        optimizableOrderByCollections,
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
          // Unwrap Value expressions that might have leaked through as the entire row
          const unwrapped = unwrapValue(value)
          return [key, unwrapped] as [unknown, any]
        })
      )

      return {
        alias: from.alias,
        input: extractedInput,
        collectionId: subQueryResult.collectionId,
      }
    }
    default:
      throw new UnsupportedFromTypeError((from as any).type)
  }
}

// Helper to check if a value is a Value expression
function isValue(raw: any): boolean {
  return (
    raw instanceof ValClass ||
    (raw && typeof raw === `object` && `type` in raw && raw.type === `val`)
  )
}

// Helper to unwrap a Value expression or return the value itself
function unwrapValue(value: any): any {
  return isValue(value) ? value.value : value
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

function getRefFromAlias(
  query: QueryIR,
  alias: string
): CollectionRef | QueryRef | void {
  if (query.from.alias === alias) {
    return query.from
  }

  for (const join of query.join || []) {
    if (join.from.alias === alias) {
      return join.from
    }
  }
}

/**
 * Follows the given reference in a query
 * until its finds the root field the reference points to.
 * @returns The collection, its alias, and the path to the root field in this collection
 */
export function followRef(
  query: QueryIR,
  ref: PropRef<any>,
  collection: Collection
): { collection: Collection; path: Array<string> } | void {
  if (ref.path.length === 0) {
    return
  }

  if (ref.path.length === 1) {
    // This field should be part of this collection
    const field = ref.path[0]!
    // is it part of the select clause?
    if (query.select) {
      const selectedField = query.select[field]
      if (selectedField && selectedField.type === `ref`) {
        return followRef(query, selectedField, collection)
      }
    }

    // Either this field is not part of the select clause
    // and thus it must be part of the collection itself
    // or it is part of the select but is not a reference
    // so we can stop here and don't have to follow it
    return { collection, path: [field] }
  }

  if (ref.path.length > 1) {
    // This is a nested field
    const [alias, ...rest] = ref.path
    const aliasRef = getRefFromAlias(query, alias!)
    if (!aliasRef) {
      return
    }

    if (aliasRef.type === `queryRef`) {
      return followRef(aliasRef.query, new PropRef(rest), collection)
    } else {
      // This is a reference to a collection
      // we can't follow it further
      // so the field must be on the collection itself
      return { collection: aliasRef.collection, path: rest }
    }
  }
}
