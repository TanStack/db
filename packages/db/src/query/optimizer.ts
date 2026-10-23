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
 * ### Residual WHERE Clauses
 * For outer joins (LEFT, RIGHT, FULL), WHERE clauses are copied to subqueries for optimization
 * but also kept as "residual" clauses in the main query to preserve semantics. This ensures
 * that NULL values from outer joins are properly filtered according to SQL standards.
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
 *   .join(leftJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id)))
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
 *   .join(leftJoin({
 *     posts: subquery
 *       .from({ posts: postsCollection })
 *       .where(({posts}) => gt(posts.views, 100))
 *   }, ({users, posts}) => eq(users.id, posts.user_id)))
 *   .where(({users, posts}) => eq(users.id, posts.author_id))
 * ```
 *
 * ### Query with Aggregates (Now Optimizable!)
 * **Original Query:**
 * ```javascript
 * query
 *   .from({ users: usersCollection })
 *   .join(leftJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id)))
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
 *   .join(leftJoin({ posts: postsCollection }, ({users, posts}) => eq(users.id, posts.user_id)))
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

import { deepEquals } from '../utils.js'
import { CannotCombineEmptyExpressionListError } from '../errors.js'
import {
  Func,
  QueryRef as QueryRefClass,
  UnionAll as UnionAllClass,
  UnionFrom as UnionFromClass,
  getFromSources,
  getWhereExpression,
  isResidualWhere,
} from './ir.js'
import type {
  BasicExpression,
  CollectionSourceRef,
  From,
  QueryIR,
  Where,
} from './ir.js'

/**
 * Represents a WHERE clause after source analysis
 */
export interface AnalyzedWhereClause {
  /** The WHERE expression */
  expression: BasicExpression<boolean>
  /** Set of table/source aliases that this WHERE clause touches */
  touchedSources: Set<string>
  /** Whether this clause contains namespace-only references that prevent pushdown */
  hasNamespaceOnlyRef: boolean
  /** A captured ancestor source cannot be filtered in a local source stream. */
  hasExternalBinding: boolean
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
  /** Map of source aliases to their extracted WHERE clauses for index optimization */
  sourceWhereClauses: Map<string, BasicExpression<boolean>>
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
 * const { optimizedQuery, sourceWhereClauses } = optimizeQuery(originalQuery)
 * // Result: Single-source clauses moved to deepest possible subqueries
 * // sourceWhereClauses: Map { 'u' => eq(u.dept_id, 1), 'p' => gt(p.views, 100) }
 * ```
 */
export function optimizeQuery(query: QueryIR): OptimizationResult {
  if (query.from.type === `unionAll`) {
    return {
      optimizedQuery: {
        ...query,
        from: new UnionAllClass(
          query.from.queries.map(
            (branch) => optimizeQuery(branch).optimizedQuery,
          ),
        ),
      },
      sourceWhereClauses: new Map(),
    }
  }

  // First, extract source WHERE clauses before optimization
  const sourceWhereClauses = extractSourceWhereClauses(query)

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
    sourceWhereClauses,
  }
}

/**
 * Extracts collection-specific WHERE clauses from a query for index optimization.
 * This analyzes the original query to identify single-source WHERE clauses that
 * reference collection sources (not subqueries), including joined collections.
 *
 * For outer joins, clauses referencing the nullable side are excluded because
 * using them to pre-filter collection data would change join semantics.
 *
 * @param query - The original QueryIR to analyze
 * @returns Map of source aliases to their WHERE clauses
 */
function extractSourceWhereClauses(
  query: QueryIR,
): Map<string, BasicExpression<boolean>> {
  const sourceWhereClauses = new Map<string, BasicExpression<boolean>>()

  // Only analyze queries that have WHERE clauses
  if (!query.where || query.where.length === 0) {
    return sourceWhereClauses
  }

  // Split all AND clauses at the root level for granular analysis
  const splitWhereClauses = splitAndClauses(query.where)

  // Analyze each WHERE clause to determine which sources it touches
  const localBindings = getLocalBindingIds(query)
  const analyzedClauses = splitWhereClauses.map((clause) =>
    analyzeWhereClause(clause, localBindings),
  )

  // Group clauses by single-source vs multi-source
  const groupedClauses = groupWhereClauses(analyzedClauses)

  // Determine which source aliases are on the nullable side of outer joins.
  // WHERE clauses for these sources must not be used for index optimization
  // because they should filter the final joined result, not the input data.
  const nullableSources = getNullableJoinSources(query)

  // Only include single-source clauses that reference collections directly
  // and are not on the nullable side of an outer join
  for (const [sourceAlias, whereClause] of groupedClauses.singleSource) {
    // Check if this source alias corresponds to a collection reference
    if (
      isCollectionReference(query, sourceAlias) &&
      !nullableSources.has(sourceAlias)
    ) {
      sourceWhereClauses.set(sourceAlias, whereClause)
    }
  }

  return sourceWhereClauses
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
  for (const source of getFromSources(query.from)) {
    if (source.alias === sourceAlias) {
      return source.type === `collectionRef` || source.type === `descriptorRef`
    }
  }

  // Check JOIN clauses
  if (query.join) {
    for (const joinClause of query.join) {
      if (joinClause.from.alias === sourceAlias) {
        return (
          joinClause.from.type === `collectionRef` ||
          joinClause.from.type === `descriptorRef`
        )
      }
    }
  }

  return false
}

/**
 * Returns the set of source aliases that are on the nullable side of outer joins.
 *
 * For a LEFT join the joined (right) side is nullable.
 * For a RIGHT join the main (left/from) side is nullable.
 * For a FULL join both sides are nullable.
 *
 * WHERE clauses that reference only a nullable source must not be pushed down
 * into that source's subquery or used for index optimization, because doing so
 * changes the join semantics: rows that should be excluded by the WHERE become
 * unmatched outer-join rows (with the nullable side set to undefined) and
 * incorrectly survive residual filtering.
 */
export function getNullableJoinSources(query: QueryIR): Set<string> {
  const nullable = new Set<string>()
  if (query.join) {
    const leftAliases = new Set(
      getFromSources(query.from).map((source) => source.alias),
    )
    for (const join of query.join) {
      const joinedAlias = join.from.alias
      if (join.type === `left` || join.type === `full`) {
        nullable.add(joinedAlias)
      }
      if (join.type === `right` || join.type === `full`) {
        for (const leftAlias of leftAliases) {
          nullable.add(leftAlias)
        }
      }
      leftAliases.add(joinedAlias)
    }
  }
  return nullable
}

/**
 * Applies recursive predicate pushdown optimization.
 *
 * @param query - The QueryIR to optimize
 * @returns A new QueryIR with optimizations applied
 */
export function applyRecursiveOptimization(query: QueryIR): QueryIR {
  // First, recursively optimize any existing subqueries
  const subqueriesOptimized = {
    ...query,
    from: optimizeNestedFrom(query.from),
    join: query.join?.map((joinClause) => ({
      ...joinClause,
      from:
        joinClause.from.type === `queryRef`
          ? new QueryRefClass(
              applyRecursiveOptimization(joinClause.from.query),
              joinClause.from.alias,
              joinClause.from.bindingId,
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

  // Multi-source FROM predicates are global post-union filters. Keep them
  // residual in the main query; sourceWhereClauses still captures safe
  // collection-level filters for loadSubset/index use.
  if (query.from.type === `unionFrom`) {
    return query
  }

  // For queries without joins, combine multiple WHERE clauses into a single clause
  // to avoid creating multiple filter operators in the pipeline
  if (!query.join || query.join.length === 0) {
    // Only optimize if there are multiple WHERE clauses to combine
    if (query.where.length > 1) {
      // Combine multiple WHERE clauses into a single AND expression
      const splitWhereClauses = splitAndClauses(query.where)
      const combinedWhere = combineWithAnd(splitWhereClauses)

      return {
        ...query,
        where: [combinedWhere],
      }
    }

    // For single WHERE clauses, no optimization needed
    return query
  }

  // Filter out residual WHERE clauses to prevent them from being optimized again
  const nonResidualWhereClauses = query.where.filter(
    (where) => !isResidualWhere(where),
  )

  // Step 1: Split all AND clauses at the root level for granular optimization
  const splitWhereClauses = splitAndClauses(nonResidualWhereClauses)

  // Step 2: Analyze each WHERE clause to determine which sources it touches
  const localBindings = getLocalBindingIds(query)
  const analyzedClauses = splitWhereClauses.map((clause) =>
    analyzeWhereClause(clause, localBindings),
  )

  // Step 3: Group clauses by single-source vs multi-source
  const groupedClauses = groupWhereClauses(analyzedClauses)

  // Step 4: The join operator supplies the pushdown that lifts single-source
  // clauses into subqueries, so apps without joins never import it.
  return query.join[0]!.runtime.optimize(query, groupedClauses)
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
      from: removeRedundantJoinFromClause(joinClause.from),
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
  if (from.type === `unionFrom`) {
    return new UnionFromClass(
      from.sources.map((source) => removeRedundantFromClause(source) as any),
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAllClass(
      from.queries.map((branch) => removeRedundantSubqueries(branch)),
    )
  }

  if (from.type === `collectionRef` || from.type === `descriptorRef`) {
    return from
  }

  const processedQuery = removeRedundantSubqueries(from.query)

  // Check if this subquery is redundant
  if (
    isRedundantSubquery(processedQuery) &&
    from.alias === getFirstFromAlias(processedQuery)
  ) {
    // Return the inner query's FROM clause with this alias
    const innerFrom = removeRedundantFromClause(processedQuery.from)
    if (
      innerFrom.type === `collectionRef` ||
      innerFrom.type === `descriptorRef`
    ) {
      // A user-declared wrapper has its own lexical binding. Collapsing it
      // would leave outer references pointing at a binding no longer present.
      return innerFrom.bindingId === from.bindingId
        ? innerFrom
        : new QueryRefClass(processedQuery, from.alias, from.bindingId)
    } else if (innerFrom.type === `queryRef`) {
      return new QueryRefClass(innerFrom.query, from.alias, from.bindingId)
    }
  }

  return new QueryRefClass(processedQuery, from.alias, from.bindingId)
}

function removeRedundantJoinFromClause(
  from: CollectionSourceRef | QueryRefClass,
): CollectionSourceRef | QueryRefClass {
  return removeRedundantFromClause(from) as CollectionSourceRef | QueryRefClass
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
    (!query.fnHaving || query.fnHaving.length === 0) &&
    !query.distinct &&
    !query.singleResult
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
  whereClauses: Array<Where>,
): Array<BasicExpression<boolean>> {
  const result: Array<BasicExpression<boolean>> = []

  for (const whereClause of whereClauses) {
    const clause = getWhereExpression(whereClause)
    result.push(...splitAndClausesRecursive(clause))
  }

  return result
}

// Helper function for recursive splitting of BasicExpression arrays
export function splitAndClausesRecursive(
  clause: BasicExpression<boolean>,
): Array<BasicExpression<boolean>> {
  if (clause.type === `func` && clause.name === `and`) {
    // Recursively split nested AND clauses to handle complex expressions
    const result: Array<BasicExpression<boolean>> = []
    for (const arg of clause.args as Array<BasicExpression<boolean>>) {
      result.push(...splitAndClausesRecursive(arg))
    }
    return result
  } else {
    // Preserve non-AND clauses as-is (including OR clauses)
    return [clause]
  }
}

/**
 * Step 2: Analyze which table sources a WHERE clause touches.
 *
 * This determines whether a clause can be pushed down to a specific table
 * or must remain in the main query (for multi-source clauses like join conditions).
 *
 * Special handling for namespace-only references in outer joins:
 * WHERE clauses that reference only a table namespace (e.g., isUndefined(special), eq(special, value))
 * rather than specific properties (e.g., isUndefined(special.id), eq(special.id, value)) are treated as
 * multi-source to prevent incorrect predicate pushdown that would change join semantics.
 *
 * @param clause - The WHERE expression to analyze
 * @returns Analysis result with the expression and touched source aliases
 *
 * @example
 * ```typescript
 * // eq(users.department_id, 1) -> touches ['users'], hasNamespaceOnlyRef: false
 * // eq(users.id, posts.user_id) -> touches ['users', 'posts'], hasNamespaceOnlyRef: false
 * // isUndefined(special) -> touches ['special'], hasNamespaceOnlyRef: true (prevents pushdown)
 * // eq(special, someValue) -> touches ['special'], hasNamespaceOnlyRef: true (prevents pushdown)
 * // isUndefined(special.id) -> touches ['special'], hasNamespaceOnlyRef: false (allows pushdown)
 * // eq(special.id, 5) -> touches ['special'], hasNamespaceOnlyRef: false (allows pushdown)
 * ```
 */
export function getLocalBindingIds(query: QueryIR): Set<string> {
  return new Set([
    ...getFromSources(query.from).map((source) => source.bindingId),
    ...(query.join?.map(({ from }) => from.bindingId) ?? []),
  ])
}

function analyzeWhereClause(
  clause: BasicExpression<boolean>,
  localBindings: ReadonlySet<string>,
): AnalyzedWhereClause {
  // Track which table aliases this WHERE clause touches
  const touchedSources = new Set<string>()
  // Track whether this clause contains namespace-only references that prevent pushdown
  let hasNamespaceOnlyRef = false
  let hasExternalBinding = false

  /**
   * Recursively collect all table aliases referenced in an expression
   */
  function collectSources(expr: BasicExpression | any): void {
    switch (expr.type) {
      case `ref`:
        if (
          expr.bindingId !== undefined &&
          !localBindings.has(expr.bindingId)
        ) {
          hasExternalBinding = true
        }
        // PropRef path has the table alias as the first element
        if (expr.path && expr.path.length > 0) {
          const firstElement = expr.path[0]
          if (firstElement) {
            touchedSources.add(firstElement)

            // If the path has only one element (just the namespace),
            // this is a namespace-only reference that should not be pushed down
            // This applies to ANY function, not just existence-checking functions
            if (expr.path.length === 1) {
              hasNamespaceOnlyRef = true
            }
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
    hasNamespaceOnlyRef,
    hasExternalBinding,
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
  analyzedClauses: Array<AnalyzedWhereClause>,
): GroupedWhereClauses {
  const singleSource = new Map<string, Array<BasicExpression<boolean>>>()
  const multiSource: Array<BasicExpression<boolean>> = []

  // Categorize each clause based on how many sources it touches
  for (const clause of analyzedClauses) {
    if (
      clause.touchedSources.size === 1 &&
      !clause.hasNamespaceOnlyRef &&
      !clause.hasExternalBinding
    ) {
      // Single source clause without namespace-only references - can be optimized
      const source = Array.from(clause.touchedSources)[0]!
      if (!singleSource.has(source)) {
        singleSource.set(source, [])
      }
      singleSource.get(source)!.push(clause.expression)
    } else {
      // Clauses without one pushable source must stay in the main query.
      multiSource.push(clause.expression)
    }
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

function optimizeNestedFrom(from: From): From {
  if (from.type === `queryRef`) {
    return new QueryRefClass(
      applyRecursiveOptimization(from.query),
      from.alias,
      from.bindingId,
    )
  }

  if (from.type === `unionFrom`) {
    return new UnionFromClass(
      from.sources.map((source) => optimizeNestedFrom(source) as any),
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAllClass(
      from.queries.map((branch) => applyRecursiveOptimization(branch)),
    )
  }

  return from
}

export function getFirstFromAlias(query: QueryIR): string | undefined {
  return getFromSources(query.from)[0]?.alias
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
export function combineWithAnd(
  expressions: Array<BasicExpression<boolean>>,
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
