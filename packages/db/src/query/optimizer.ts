/**
 * # Query Optimizer
 *
 * The query optimizer improves query performance by implementing predicate pushdown optimization.
 * It rewrites the intermediate representation (IR) to push WHERE clauses as close to the data
 * source as possible, reducing the amount of data processed during joins.
 *
 * ## How It Works
 *
 * The optimizer follows a 4-step process:
 *
 * ### 1. AND Clause Splitting
 * Splits AND clauses at the root level into separate WHERE clauses for granular optimization.
 * ```javascript
 * // Before: WHERE and(eq(users.department_id, 1), gt(users.age, 25))
 * // After:  WHERE eq(users.department_id, 1) + WHERE gt(users.age, 25)
 * ```
 *
 * ### 2. Source Analysis
 * Analyzes each WHERE clause to determine which table sources it references:
 * - Single-source clauses: Touch only one table (e.g., `users.department_id = 1`)
 * - Multi-source clauses: Touch multiple tables (e.g., `users.id = posts.user_id`)
 *
 * ### 3. Clause Grouping
 * Groups WHERE clauses by the sources they touch:
 * - Single-source clauses are grouped by their respective table
 * - Multi-source clauses are combined for the main query
 *
 * ### 4. Subquery Creation
 * Lifts single-source WHERE clauses into subqueries that wrap the original table references.
 *
 * ## Safety & Edge Cases
 *
 * The optimizer includes targeted safety checks to prevent predicate pushdown when it could
 * break query semantics:
 *
 * ### Always Safe Operations
 * - **Creating new subqueries**: Wrapping collection references in subqueries with WHERE clauses
 * - **Main query optimizations**: Moving single-source WHERE clauses from main query to subqueries
 * - **Queries with aggregates/ORDER BY/HAVING**: Can still create new filtered subqueries
 *
 * ### Unsafe Operations (blocked by safety checks)
 * Pushing WHERE clauses **into existing subqueries** that have:
 * - **Aggregates**: GROUP BY, HAVING, or aggregate functions in SELECT (would change aggregation)
 * - **Ordering + Limits**: ORDER BY combined with LIMIT/OFFSET (would change result set)
 * - **Functional Operations**: fnSelect, fnWhere, fnHaving (potential side effects)
 *
 * The optimizer tracks which clauses were actually optimized and only removes those from the
 * main query. Subquery reuse is handled safely through immutable query copies.
 *
 * ## Example Optimizations
 *
 * ### Basic Query with Joins
 * **Original Query:**
 * ```javascript
 * query
 *   .from({ users: usersCollection })
 *   .join({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id))
 *   .where(({users}) => eq(users.department_id, 1))
 *   .where(({posts}) => gt(posts.views, 100))
 *   .where(({users, posts}) => eq(users.id, posts.author_id))
 * ```
 *
 * **Optimized Query:**
 * ```javascript
 * query
 *   .from({
 *     users: subquery
 *       .from({ users: usersCollection })
 *       .where(({users}) => eq(users.department_id, 1))
 *   })
 *   .join({
 *     posts: subquery
 *       .from({ posts: postsCollection })
 *       .where(({posts}) => gt(posts.views, 100))
 *   }, ({users, posts}) => eq(users.id, posts.user_id))
 *   .where(({users, posts}) => eq(users.id, posts.author_id))
 * ```
 *
 * ### Query with Aggregates (Now Optimizable!)
 * **Original Query:**
 * ```javascript
 * query
 *   .from({ users: usersCollection })
 *   .join({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id))
 *   .where(({users}) => eq(users.department_id, 1))
 *   .groupBy(['users.department_id'])
 *   .select({ count: agg('count', '*') })
 * ```
 *
 * **Optimized Query:**
 * ```javascript
 * query
 *   .from({
 *     users: subquery
 *       .from({ users: usersCollection })
 *       .where(({users}) => eq(users.department_id, 1))
 *   })
 *   .join({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id))
 *   .groupBy(['users.department_id'])
 *   .select({ count: agg('count', '*') })
 * ```
 *
 * ## Benefits
 *
 * - **Reduced Data Processing**: Filters applied before joins reduce intermediate result size
 * - **Better Performance**: Smaller datasets lead to faster query execution
 * - **Automatic Optimization**: No manual query rewriting required
 * - **Preserves Semantics**: Optimized queries return identical results
 * - **Safe by Design**: Comprehensive checks prevent semantic-breaking optimizations
 *
 * ## Integration
 *
 * The optimizer is automatically called during query compilation before the IR is
 * transformed into a D2Mini pipeline.
 */

import { deepEquals } from "../utils.js"
import { CannotCombineEmptyExpressionListError } from "../errors.js"
import {
  CollectionRef as CollectionRefClass,
  Func,
  QueryRef as QueryRefClass,
} from "./ir.js"
import { isConvertibleToCollectionFilter } from "./compiler/expressions.js"
import type { BasicExpression, From, QueryIR } from "./ir.js"

/**
 * Represents a WHERE clause after source analysis
 */
export interface AnalyzedWhereClause {
  /** The WHERE expression */
  expression: BasicExpression<boolean>
  /** Set of table/source aliases that this WHERE clause touches */
  touchedSources: Set<string>
}

/**
 * Represents WHERE clauses grouped by the sources they touch
 */
export interface GroupedWhereClauses {
  /** WHERE clauses that touch only a single source, grouped by source alias */
  singleSource: Map<string, BasicExpression<boolean>>
  /** WHERE clauses that touch multiple sources, combined into one expression */
  multiSource?: BasicExpression<boolean>
}

/**
 * Result of query optimization including both the optimized query and collection-specific WHERE clauses
 */
export interface OptimizationResult {
  /** The optimized query with WHERE clauses potentially moved to subqueries */
  optimizedQuery: QueryIR
  /** Map of collection aliases to their extracted WHERE clauses for index optimization */
  collectionWhereClauses: Map<string, BasicExpression<boolean>>
}

/**
 * Main query optimizer entry point that lifts WHERE clauses into subqueries.
 *
 * This function implements multi-level predicate pushdown optimization by recursively
 * moving WHERE clauses through nested subqueries to get them as close to the data
 * sources as possible, then removing redundant subqueries.
 *
 * @param query - The QueryIR to optimize
 * @returns An OptimizationResult with the optimized query and collection WHERE clause mapping
 *
 * @example
 * ```typescript
 * const originalQuery = {
 *   from: new CollectionRef(users, 'u'),
 *   join: [{ from: new CollectionRef(posts, 'p'), ... }],
 *   where: [eq(u.dept_id, 1), gt(p.views, 100)]
 * }
 *
 * const { optimizedQuery, collectionWhereClauses } = optimizeQuery(originalQuery)
 * // Result: Single-source clauses moved to deepest possible subqueries
 * // collectionWhereClauses: Map { 'u' => eq(u.dept_id, 1), 'p' => gt(p.views, 100) }
 * ```
 */
export function optimizeQuery(query: QueryIR): OptimizationResult {
  // First, extract collection WHERE clauses before optimization
  const collectionWhereClauses = extractCollectionWhereClauses(query)

  // Apply multi-level predicate pushdown with iterative convergence
  let optimized = query
  let previousOptimized: QueryIR | undefined
  let iterations = 0
  const maxIterations = 10 // Prevent infinite loops

  // Keep optimizing until no more changes occur or max iterations reached
  while (
    iterations < maxIterations &&
    !deepEquals(optimized, previousOptimized)
  ) {
    previousOptimized = optimized
    optimized = applyRecursiveOptimization(optimized)
    iterations++
  }

  // Remove redundant subqueries
  const cleaned = removeRedundantSubqueries(optimized)

  return {
    optimizedQuery: cleaned,
    collectionWhereClauses,
  }
}

/**
 * Extracts collection-specific WHERE clauses from a query for index optimization.
 * This analyzes the original query to identify WHERE clauses that can be pushed down
 * to specific collections, but only for simple queries without joins.
 *
 * @param query - The original QueryIR to analyze
 * @returns Map of collection aliases to their WHERE clauses
 */
function extractCollectionWhereClauses(
  query: QueryIR
): Map<string, BasicExpression<boolean>> {
  const collectionWhereClauses = new Map<string, BasicExpression<boolean>>()

  // Only analyze queries that have WHERE clauses
  if (!query.where || query.where.length === 0) {
    return collectionWhereClauses
  }

  // Split all AND clauses at the root level for granular analysis
  const splitWhereClauses = splitAndClauses(query.where)

  // Analyze each WHERE clause to determine which sources it touches
  const analyzedClauses = splitWhereClauses.map((clause) =>
    analyzeWhereClause(clause)
  )

  // Group clauses by single-source vs multi-source
  const groupedClauses = groupWhereClauses(analyzedClauses)

  // Only include single-source clauses that reference collections directly
  // and can be converted to BasicExpression format for collection indexes
  for (const [sourceAlias, whereClause] of groupedClauses.singleSource) {
    // Check if this source alias corresponds to a collection reference
    if (isCollectionReference(query, sourceAlias)) {
      // Check if the WHERE clause can be converted to collection-compatible format
      if (isConvertibleToCollectionFilter(whereClause)) {
        collectionWhereClauses.set(sourceAlias, whereClause)
      }
    }
  }

  return collectionWhereClauses
}

/**
 * Determines if a source alias refers to a collection reference (not a subquery).
 * This is used to identify WHERE clauses that can be pushed down to collection subscriptions.
 *
 * @param query - The query to analyze
 * @param sourceAlias - The source alias to check
 * @returns True if the alias refers to a collection reference
 */
function isCollectionReference(query: QueryIR, sourceAlias: string): boolean {
  // Check the FROM clause
  if (query.from.alias === sourceAlias) {
    return query.from.type === `collectionRef`
  }

  // Check JOIN clauses
  if (query.join) {
    for (const joinClause of query.join) {
      if (joinClause.from.alias === sourceAlias) {
        return joinClause.from.type === `collectionRef`
      }
    }
  }

  return false
}

/**
 * Applies recursive predicate pushdown optimization.
 *
 * @param query - The QueryIR to optimize
 * @returns A new QueryIR with optimizations applied
 */
function applyRecursiveOptimization(query: QueryIR): QueryIR {
  // First, recursively optimize any existing subqueries
  const subqueriesOptimized = {
    ...query,
    from:
      query.from.type === `queryRef`
        ? new QueryRefClass(
            applyRecursiveOptimization(query.from.query),
            query.from.alias
          )
        : query.from,
    join: query.join?.map((joinClause) => ({
      ...joinClause,
      from:
        joinClause.from.type === `queryRef`
          ? new QueryRefClass(
              applyRecursiveOptimization(joinClause.from.query),
              joinClause.from.alias
            )
          : joinClause.from,
    })),
  }

  // Then apply single-level optimization to this query
  return applySingleLevelOptimization(subqueriesOptimized)
}

/**
 * Applies single-level predicate pushdown optimization (existing logic)
 */
function applySingleLevelOptimization(query: QueryIR): QueryIR {
  // Skip optimization if no WHERE clauses exist
  if (!query.where || query.where.length === 0) {
    return query
  }

  // Skip optimization if there are no joins - predicate pushdown only benefits joins
  // Single-table queries don't benefit from this optimization
  if (!query.join || query.join.length === 0) {
    return query
  }

  // Step 1: Split all AND clauses at the root level for granular optimization
  const splitWhereClauses = splitAndClauses(query.where)

  // Step 2: Analyze each WHERE clause to determine which sources it touches
  const analyzedClauses = splitWhereClauses.map((clause) =>
    analyzeWhereClause(clause)
  )

  // Step 3: Group clauses by single-source vs multi-source
  const groupedClauses = groupWhereClauses(analyzedClauses)

  // Step 4: Apply optimizations by lifting single-source clauses into subqueries
  return applyOptimizations(query, groupedClauses)
}

/**
 * Removes redundant subqueries that don't add value.
 * A subquery is redundant if it only wraps another query without adding
 * WHERE, SELECT, GROUP BY, HAVING, ORDER BY, or LIMIT/OFFSET clauses.
 *
 * @param query - The QueryIR to process
 * @returns A new QueryIR with redundant subqueries removed
 */
function removeRedundantSubqueries(query: QueryIR): QueryIR {
  return {
    ...query,
    from: removeRedundantFromClause(query.from),
    join: query.join?.map((joinClause) => ({
      ...joinClause,
      from: removeRedundantFromClause(joinClause.from),
    })),
  }
}

/**
 * Removes redundant subqueries from a FROM clause.
 *
 * @param from - The FROM clause to process
 * @returns A FROM clause with redundant subqueries removed
 */
function removeRedundantFromClause(from: From): From {
  if (from.type === `collectionRef`) {
    return from
  }

  const processedQuery = removeRedundantSubqueries(from.query)

  // Check if this subquery is redundant
  if (isRedundantSubquery(processedQuery)) {
    // Return the inner query's FROM clause with this alias
    const innerFrom = removeRedundantFromClause(processedQuery.from)
    if (innerFrom.type === `collectionRef`) {
      return new CollectionRefClass(innerFrom.collection, from.alias)
    } else {
      return new QueryRefClass(innerFrom.query, from.alias)
    }
  }

  return new QueryRefClass(processedQuery, from.alias)
}

/**
 * Determines if a subquery is redundant (adds no value).
 *
 * @param query - The query to check
 * @returns True if the query is redundant and can be removed
 */
function isRedundantSubquery(query: QueryIR): boolean {
  return (
    (!query.where || query.where.length === 0) &&
    !query.select &&
    (!query.groupBy || query.groupBy.length === 0) &&
    (!query.having || query.having.length === 0) &&
    (!query.orderBy || query.orderBy.length === 0) &&
    (!query.join || query.join.length === 0) &&
    query.limit === undefined &&
    query.offset === undefined &&
    !query.fnSelect &&
    (!query.fnWhere || query.fnWhere.length === 0) &&
    (!query.fnHaving || query.fnHaving.length === 0)
  )
}

/**
 * Step 1: Split all AND clauses recursively into separate WHERE clauses.
 *
 * This enables more granular optimization by treating each condition independently.
 * OR clauses are preserved as they cannot be split without changing query semantics.
 *
 * @param whereClauses - Array of WHERE expressions to split
 * @returns Flattened array with AND clauses split into separate expressions
 *
 * @example
 * ```typescript
 * // Input: [and(eq(a, 1), gt(b, 2)), eq(c, 3)]
 * // Output: [eq(a, 1), gt(b, 2), eq(c, 3)]
 * ```
 */
function splitAndClauses(
  whereClauses: Array<BasicExpression<boolean>>
): Array<BasicExpression<boolean>> {
  const result: Array<BasicExpression<boolean>> = []

  for (const clause of whereClauses) {
    if (clause.type === `func` && clause.name === `and`) {
      // Recursively split nested AND clauses to handle complex expressions
      const splitArgs = splitAndClauses(
        clause.args as Array<BasicExpression<boolean>>
      )
      result.push(...splitArgs)
    } else {
      // Preserve non-AND clauses as-is (including OR clauses)
      result.push(clause)
    }
  }

  return result
}

/**
 * Step 2: Analyze which table sources a WHERE clause touches.
 *
 * This determines whether a clause can be pushed down to a specific table
 * or must remain in the main query (for multi-source clauses like join conditions).
 *
 * @param clause - The WHERE expression to analyze
 * @returns Analysis result with the expression and touched source aliases
 *
 * @example
 * ```typescript
 * // eq(users.department_id, 1) -> touches ['users']
 * // eq(users.id, posts.user_id) -> touches ['users', 'posts']
 * ```
 */
function analyzeWhereClause(
  clause: BasicExpression<boolean>
): AnalyzedWhereClause {
  const touchedSources = new Set<string>()

  /**
   * Recursively collect all table aliases referenced in an expression
   */
  function collectSources(expr: BasicExpression | any): void {
    switch (expr.type) {
      case `ref`:
        // PropRef path has the table alias as the first element
        if (expr.path && expr.path.length > 0) {
          const firstElement = expr.path[0]
          if (firstElement) {
            touchedSources.add(firstElement)
          }
        }
        break
      case `func`:
        // Recursively analyze function arguments (e.g., eq, gt, and, or)
        if (expr.args) {
          expr.args.forEach(collectSources)
        }
        break
      case `val`:
        // Values don't reference any sources
        break
      case `agg`:
        // Aggregates can reference sources in their arguments
        if (expr.args) {
          expr.args.forEach(collectSources)
        }
        break
    }
  }

  collectSources(clause)

  return {
    expression: clause,
    touchedSources,
  }
}

/**
 * Step 3: Group WHERE clauses by the sources they touch.
 *
 * Single-source clauses can be pushed down to subqueries for optimization.
 * Multi-source clauses must remain in the main query to preserve join semantics.
 *
 * @param analyzedClauses - Array of analyzed WHERE clauses
 * @returns Grouped clauses ready for optimization
 */
function groupWhereClauses(
  analyzedClauses: Array<AnalyzedWhereClause>
): GroupedWhereClauses {
  const singleSource = new Map<string, Array<BasicExpression<boolean>>>()
  const multiSource: Array<BasicExpression<boolean>> = []

  // Categorize each clause based on how many sources it touches
  for (const clause of analyzedClauses) {
    if (clause.touchedSources.size === 1) {
      // Single source clause - can be optimized
      const source = Array.from(clause.touchedSources)[0]!
      if (!singleSource.has(source)) {
        singleSource.set(source, [])
      }
      singleSource.get(source)!.push(clause.expression)
    } else if (clause.touchedSources.size > 1) {
      // Multi-source clause - must stay in main query
      multiSource.push(clause.expression)
    }
    // Skip clauses that touch no sources (constants) - they don't need optimization
  }

  // Combine multiple clauses for each source with AND
  const combinedSingleSource = new Map<string, BasicExpression<boolean>>()
  for (const [source, clauses] of singleSource) {
    combinedSingleSource.set(source, combineWithAnd(clauses))
  }

  // Combine multi-source clauses with AND
  const combinedMultiSource =
    multiSource.length > 0 ? combineWithAnd(multiSource) : undefined

  return {
    singleSource: combinedSingleSource,
    multiSource: combinedMultiSource,
  }
}

/**
 * Step 4: Apply optimizations by lifting single-source clauses into subqueries.
 *
 * Creates a new QueryIR with single-source WHERE clauses moved to subqueries
 * that wrap the original table references. This ensures immutability and prevents
 * infinite recursion issues.
 *
 * @param query - Original QueryIR to optimize
 * @param groupedClauses - WHERE clauses grouped by optimization strategy
 * @returns New QueryIR with optimizations applied
 */
function applyOptimizations(
  query: QueryIR,
  groupedClauses: GroupedWhereClauses
): QueryIR {
  // Track which single-source clauses were actually optimized
  const actuallyOptimized = new Set<string>()

  // Optimize the main FROM clause and track what was optimized
  const optimizedFrom = optimizeFromWithTracking(
    query.from,
    groupedClauses.singleSource,
    actuallyOptimized
  )

  // Optimize JOIN clauses and track what was optimized
  const optimizedJoins = query.join
    ? query.join.map((joinClause) => ({
        ...joinClause,
        from: optimizeFromWithTracking(
          joinClause.from,
          groupedClauses.singleSource,
          actuallyOptimized
        ),
      }))
    : undefined

  // Build the remaining WHERE clauses: multi-source + any single-source that weren't optimized
  const remainingWhereClauses: Array<BasicExpression<boolean>> = []

  // Add multi-source clauses
  if (groupedClauses.multiSource) {
    remainingWhereClauses.push(groupedClauses.multiSource)
  }

  // Add single-source clauses that weren't actually optimized
  for (const [source, clause] of groupedClauses.singleSource) {
    if (!actuallyOptimized.has(source)) {
      remainingWhereClauses.push(clause)
    }
  }

  // Create a completely new query object to ensure immutability
  const optimizedQuery: QueryIR = {
    // Copy all non-optimized fields as-is
    select: query.select,
    groupBy: query.groupBy ? [...query.groupBy] : undefined,
    having: query.having ? [...query.having] : undefined,
    orderBy: query.orderBy ? [...query.orderBy] : undefined,
    limit: query.limit,
    offset: query.offset,
    fnSelect: query.fnSelect,
    fnWhere: query.fnWhere ? [...query.fnWhere] : undefined,
    fnHaving: query.fnHaving ? [...query.fnHaving] : undefined,

    // Use the optimized FROM and JOIN clauses
    from: optimizedFrom,
    join: optimizedJoins,

    // Only include WHERE clauses that weren't successfully optimized
    where: remainingWhereClauses.length > 0 ? remainingWhereClauses : [],
  }

  return optimizedQuery
}

/**
 * Helper function to create a deep copy of a QueryIR object for immutability.
 *
 * This ensures that all optimizations create new objects rather than modifying
 * existing ones, preventing infinite recursion and shared reference issues.
 *
 * @param query - QueryIR to deep copy
 * @returns New QueryIR object with all nested objects copied
 */
function deepCopyQuery(query: QueryIR): QueryIR {
  return {
    // Recursively copy the FROM clause
    from:
      query.from.type === `collectionRef`
        ? new CollectionRefClass(query.from.collection, query.from.alias)
        : new QueryRefClass(deepCopyQuery(query.from.query), query.from.alias),

    // Copy all other fields, creating new arrays where necessary
    select: query.select,
    join: query.join
      ? query.join.map((joinClause) => ({
          type: joinClause.type,
          left: joinClause.left,
          right: joinClause.right,
          from:
            joinClause.from.type === `collectionRef`
              ? new CollectionRefClass(
                  joinClause.from.collection,
                  joinClause.from.alias
                )
              : new QueryRefClass(
                  deepCopyQuery(joinClause.from.query),
                  joinClause.from.alias
                ),
        }))
      : undefined,
    where: query.where ? [...query.where] : undefined,
    groupBy: query.groupBy ? [...query.groupBy] : undefined,
    having: query.having ? [...query.having] : undefined,
    orderBy: query.orderBy ? [...query.orderBy] : undefined,
    limit: query.limit,
    offset: query.offset,
    fnSelect: query.fnSelect,
    fnWhere: query.fnWhere ? [...query.fnWhere] : undefined,
    fnHaving: query.fnHaving ? [...query.fnHaving] : undefined,
  }
}

/**
 * Helper function to optimize a FROM clause while tracking what was actually optimized.
 *
 * @param from - FROM clause to optimize
 * @param singleSourceClauses - Map of source aliases to their WHERE clauses
 * @param actuallyOptimized - Set to track which sources were actually optimized
 * @returns New FROM clause, potentially wrapped in a subquery
 */
function optimizeFromWithTracking(
  from: From,
  singleSourceClauses: Map<string, BasicExpression<boolean>>,
  actuallyOptimized: Set<string>
): From {
  const whereClause = singleSourceClauses.get(from.alias)

  if (!whereClause) {
    // No optimization needed, but return a copy to maintain immutability
    if (from.type === `collectionRef`) {
      return new CollectionRefClass(from.collection, from.alias)
    }
    // Must be queryRef due to type system
    return new QueryRefClass(deepCopyQuery(from.query), from.alias)
  }

  if (from.type === `collectionRef`) {
    // Create a new subquery with the WHERE clause for the collection
    // This is always safe since we're creating a new subquery
    const subQuery: QueryIR = {
      from: new CollectionRefClass(from.collection, from.alias),
      where: [whereClause],
    }
    actuallyOptimized.add(from.alias) // Mark as successfully optimized
    return new QueryRefClass(subQuery, from.alias)
  }

  // Must be queryRef due to type system

  // SAFETY CHECK: Only check safety when pushing WHERE clauses into existing subqueries
  // We need to be careful about pushing WHERE clauses into subqueries that already have
  // aggregates, HAVING, or ORDER BY + LIMIT since that could change their semantics
  if (!isSafeToPushIntoExistingSubquery(from.query)) {
    // Return a copy without optimization to maintain immutability
    // Do NOT mark as optimized since we didn't actually optimize it
    return new QueryRefClass(deepCopyQuery(from.query), from.alias)
  }

  // Add the WHERE clause to the existing subquery
  // Create a deep copy to ensure immutability
  const existingWhere = from.query.where || []
  const optimizedSubQuery: QueryIR = {
    ...deepCopyQuery(from.query),
    where: [...existingWhere, whereClause],
  }
  actuallyOptimized.add(from.alias) // Mark as successfully optimized
  return new QueryRefClass(optimizedSubQuery, from.alias)
}

/**
 * Determines if it's safe to push WHERE clauses into an existing subquery.
 *
 * Pushing WHERE clauses into existing subqueries can break semantics in several cases:
 *
 * 1. **Aggregates**: Pushing predicates before GROUP BY changes what gets aggregated
 * 2. **ORDER BY + LIMIT/OFFSET**: Pushing predicates before sorting+limiting changes the result set
 * 3. **HAVING clauses**: These operate on aggregated data, predicates should not be pushed past them
 * 4. **Functional operations**: fnSelect, fnWhere, fnHaving could have side effects
 *
 * Note: This safety check only applies when pushing WHERE clauses into existing subqueries.
 * Creating new subqueries from collection references is always safe.
 *
 * @param query - The existing subquery to check for safety
 * @returns True if it's safe to push WHERE clauses into this subquery, false otherwise
 *
 * @example
 * ```typescript
 * // UNSAFE: has GROUP BY - pushing WHERE could change aggregation
 * { from: users, groupBy: [dept], select: { count: agg('count', '*') } }
 *
 * // UNSAFE: has ORDER BY + LIMIT - pushing WHERE could change "top 10"
 * { from: users, orderBy: [salary desc], limit: 10 }
 *
 * // SAFE: plain SELECT without aggregates/limits
 * { from: users, select: { id, name } }
 * ```
 */
function isSafeToPushIntoExistingSubquery(query: QueryIR): boolean {
  // Check for aggregates in SELECT clause
  if (query.select) {
    const hasAggregates = Object.values(query.select).some(
      (expr) => expr.type === `agg`
    )
    if (hasAggregates) {
      return false
    }
  }

  // Check for GROUP BY clause
  if (query.groupBy && query.groupBy.length > 0) {
    return false
  }

  // Check for HAVING clause
  if (query.having && query.having.length > 0) {
    return false
  }

  // Check for ORDER BY with LIMIT or OFFSET (dangerous combination)
  if (query.orderBy && query.orderBy.length > 0) {
    if (query.limit !== undefined || query.offset !== undefined) {
      return false
    }
  }

  // Check for functional variants that might have side effects
  if (
    query.fnSelect ||
    (query.fnWhere && query.fnWhere.length > 0) ||
    (query.fnHaving && query.fnHaving.length > 0)
  ) {
    return false
  }

  // If none of the unsafe conditions are present, it's safe to optimize
  return true
}

/**
 * Helper function to combine multiple expressions with AND.
 *
 * If there's only one expression, it's returned as-is.
 * If there are multiple expressions, they're combined with an AND function.
 *
 * @param expressions - Array of expressions to combine
 * @returns Single expression representing the AND combination
 * @throws Error if the expressions array is empty
 */
function combineWithAnd(
  expressions: Array<BasicExpression<boolean>>
): BasicExpression<boolean> {
  if (expressions.length === 0) {
    throw new CannotCombineEmptyExpressionListError()
  }

  if (expressions.length === 1) {
    return expressions[0]!
  }

  // Create an AND function with all expressions as arguments
  return new Func(`and`, expressions)
}
