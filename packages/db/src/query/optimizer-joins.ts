import {
  Func,
  PropRef,
  QueryRef as QueryRefClass,
  UnionAll as UnionAllClass,
  UnionFrom as UnionFromClass,
  collectPropRefs,
  createResidualWhere,
  getWhereExpression,
  isResidualWhere,
} from './ir.js'
import { containsAggregate } from './compiler/group-by.js'
import {
  combineWithAnd,
  getFirstFromAlias,
  getLocalBindingIds,
  getNullableJoinSources,
  splitAndClausesRecursive,
} from './optimizer.js'
import type { GroupedWhereClauses } from './optimizer.js'
import type {
  BasicExpression,
  CollectionSourceRef,
  From,
  QueryIR,
  Select,
  Where,
} from './ir.js'

// Predicate pushdown for queries with joins. Join operator values supply this
// to the optimizer, so apps without joins never import it.

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
export function applyOptimizations(
  query: QueryIR,
  groupedClauses: GroupedWhereClauses,
): QueryIR {
  // Track which single-source clauses were actually optimized
  const actuallyOptimized = new Set<string>()

  // Determine which source aliases are on the nullable side of outer joins.
  const nullableSources = getNullableJoinSources(query)

  // Build a filtered copy of singleSource that excludes nullable-side clauses.
  // Pushing a WHERE clause into the nullable side's subquery pre-filters the
  // data before the join, converting "matched but WHERE-excluded" rows into
  // "unmatched" outer-join rows.  These are indistinguishable from genuinely
  // unmatched rows, so the residual WHERE cannot correct the result.
  const pushableSingleSource = new Map<string, BasicExpression<boolean>>()
  for (const [source, clause] of groupedClauses.singleSource) {
    if (!nullableSources.has(source)) {
      pushableSingleSource.set(source, clause)
    }
  }

  // Optimize the main FROM clause and track what was optimized
  const optimizedFrom = optimizeFromWithTracking(
    query.from,
    pushableSingleSource,
    actuallyOptimized,
  )

  // Optimize JOIN clauses and track what was optimized
  const optimizedJoins = query.join
    ? query.join.map((joinClause) => ({
        ...joinClause,
        from: optimizeFromWithTracking(
          joinClause.from,
          pushableSingleSource,
          actuallyOptimized,
        ) as CollectionSourceRef | QueryRefClass,
      }))
    : undefined

  // Keep regular and residual clauses separate so neither loses its marker.
  const remainingWhereClauses: Array<Where> = []
  const residualWhereClauses = query.where?.filter(isResidualWhere) ?? []

  // Add multi-source clauses
  if (groupedClauses.multiSource) {
    remainingWhereClauses.push(groupedClauses.multiSource)
  }

  // Determine if we need residual clauses (when query has outer JOINs)
  const hasOuterJoins = nullableSources.size > 0

  // Add single-source clauses
  for (const [source, clause] of groupedClauses.singleSource) {
    if (!actuallyOptimized.has(source)) {
      // Wasn't optimized at all - keep as regular WHERE clause
      remainingWhereClauses.push(clause)
    } else if (hasOuterJoins) {
      // Was optimized AND query has outer JOINs - keep as residual WHERE clause
      residualWhereClauses.push(createResidualWhere(clause))
    }
    // If optimized and no outer JOINs - don't keep (original behavior)
  }

  // Combine within each group to avoid extra filters and nested ANDs.
  const combineRemaining = (clauses: Array<Where>): Where | undefined =>
    clauses.length > 1
      ? combineWithAnd(
          clauses.flatMap((clause) =>
            splitAndClausesRecursive(getWhereExpression(clause)),
          ),
        )
      : clauses[0]
  const regularWhere = combineRemaining(remainingWhereClauses)
  const residualWhere = combineRemaining(residualWhereClauses)
  const finalWhere: Array<Where> = [
    ...(regularWhere ? [regularWhere] : []),
    ...(residualWhere
      ? [createResidualWhere(getWhereExpression(residualWhere))]
      : []),
  ]

  // Preserve untouched query options while replacing the optimized clauses.
  const optimizedQuery: QueryIR = {
    ...copyClauseArrays(query),
    from: optimizedFrom,
    join: optimizedJoins,
    where: finalWhere.length > 0 ? finalWhere : [],
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
    ...copyClauseArrays(query),
    from: deepCopyFrom(query.from),
    join: query.join
      ? query.join.map((joinClause) => ({
          type: joinClause.type,
          on: joinClause.on,
          compile: joinClause.compile,
          optimize: joinClause.optimize,
          from: deepCopyFrom(joinClause.from) as
            CollectionSourceRef | QueryRefClass,
        }))
      : undefined,
    where: query.where ? [...query.where] : undefined,
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
  actuallyOptimized: Set<string>,
): From {
  if (from.type === `unionFrom`) {
    return new UnionFromClass(
      from.sources.map(
        (source) =>
          optimizeFromWithTracking(
            source,
            singleSourceClauses,
            actuallyOptimized,
          ) as CollectionSourceRef | QueryRefClass,
      ),
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAllClass(
      from.queries.map((branch) => deepCopyQuery(branch)),
    )
  }

  const whereClause = singleSourceClauses.get(from.alias)

  if (!whereClause) {
    // No optimization needed. Keep the source ref itself: its sourceId is
    // the compiled input identity, and a copy would lose it.
    if (from.type === `collectionRef` || from.type === `descriptorRef`) {
      return from
    }
    // Must be queryRef due to type system
    return new QueryRefClass(
      deepCopyQuery(from.query),
      from.alias,
      from.bindingId,
    )
  }

  if (from.type === `collectionRef` || from.type === `descriptorRef`) {
    // Create a new subquery with the WHERE clause for the collection
    // This is always safe since we're creating a new subquery
    const subQuery: QueryIR = {
      from,
      where: [whereClause],
    }
    actuallyOptimized.add(from.alias) // Mark as successfully optimized
    return new QueryRefClass(subQuery, from.alias, from.bindingId)
  }

  // SAFETY CHECK: Only check safety when pushing WHERE clauses into existing subqueries
  // We need to be careful about pushing WHERE clauses into subqueries that already have
  // aggregates, HAVING, or ORDER BY + LIMIT since that could change their semantics
  if (!isSafeToPushIntoExistingSubquery(from.query, whereClause, from.alias)) {
    // Return a copy without optimization to maintain immutability
    // Do NOT mark as optimized since we didn't actually optimize it
    return new QueryRefClass(
      deepCopyQuery(from.query),
      from.alias,
      from.bindingId,
    )
  }

  // Skip pushdown when a clause references a field that only exists via a renamed
  // projection inside the subquery; leaving it outside preserves the alias mapping.
  if (referencesAliasWithRemappedSelect(from.query, whereClause, from.alias)) {
    return new QueryRefClass(
      deepCopyQuery(from.query),
      from.alias,
      from.bindingId,
    )
  }

  // Add the WHERE clause to the existing subquery
  // Create a deep copy to ensure immutability
  const existingWhere = from.query.where || []
  const remappedWhere = remapWhereForSubquery(
    from.query,
    whereClause,
    from.alias,
  )
  if (remappedWhere === undefined) {
    return new QueryRefClass(
      deepCopyQuery(from.query),
      from.alias,
      from.bindingId,
    )
  }
  const optimizedSubQuery: QueryIR = {
    ...deepCopyQuery(from.query),
    where: [...existingWhere, remappedWhere],
  }
  actuallyOptimized.add(from.alias) // Mark as successfully optimized
  return new QueryRefClass(optimizedSubQuery, from.alias, from.bindingId)
}

/**
 * Rewrites references to an outer QueryRef alias so a pushed predicate can be
 * evaluated inside the subquery's namespace. Pass-through SELECT fields use
 * their projected source path; unprojected rows use the first source alias.
 */
function remapWhereForSubquery(
  subquery: QueryIR,
  whereClause: BasicExpression<boolean>,
  outerAlias: string,
): BasicExpression<boolean> | undefined {
  const firstFromAlias = getFirstFromAlias(subquery)
  if (firstFromAlias === undefined) return undefined

  const remapExpression = (expression: BasicExpression): BasicExpression => {
    if (expression instanceof PropRef) {
      if (expression.path[0] !== outerAlias) return expression

      const field = expression.path[1]
      const projected = field ? subquery.select?.[field] : undefined
      const hasNamespacedResult =
        subquery.join !== undefined || subquery.from.type === `unionFrom`
      const innerPath =
        projected instanceof PropRef
          ? [...projected.path, ...expression.path.slice(2)]
          : hasNamespacedResult
            ? expression.path.slice(1)
            : [firstFromAlias, ...expression.path.slice(1)]

      return new PropRef(innerPath)
    }

    if (expression instanceof Func) {
      return new Func(expression.name, expression.args.map(remapExpression))
    }

    return expression
  }

  return remapExpression(whereClause) as BasicExpression<boolean>
}

function isSafeToPushIntoExistingSubquery(
  query: QueryIR,
  whereClause: BasicExpression<boolean>,
  outerAlias: string,
): boolean {
  return !(
    query.distinct ||
    (query.select &&
      (containsAggregate(query.select) ||
        whereReferencesComputedSelectFields(
          query.select,
          whereClause,
          outerAlias,
        ))) ||
    query.groupBy?.length ||
    query.having?.length ||
    (query.orderBy?.length &&
      (query.limit !== undefined || query.offset !== undefined)) ||
    query.fnSelect ||
    query.fnWhere?.length ||
    query.fnHaving?.length
  )
}

/**
 * Determines whether the provided WHERE clause references fields that are
 * computed by a subquery SELECT rather than pass-through properties.
 *
 * If true, pushing the WHERE clause into the subquery could change semantics
 * (since computed fields do not necessarily exist at the subquery input level),
 * so predicate pushdown must be avoided.
 *
 * @param select - The subquery SELECT map
 * @param whereClause - The WHERE expression to analyze
 * @param outerAlias - The alias of the subquery in the outer query
 * @returns True if WHERE references computed fields, otherwise false
 */
function whereReferencesComputedSelectFields(
  select: Select,
  whereClause: BasicExpression<boolean>,
  outerAlias: string,
): boolean {
  // Build a set of computed field names at the top-level of the subquery output
  const computed = new Set<string>()
  for (const [key, value] of Object.entries(select)) {
    if (key.startsWith(`__SPREAD_SENTINEL__`)) continue
    if (value instanceof PropRef) continue
    // Nested object or non-PropRef expression counts as computed
    computed.add(key)
  }

  const refs = collectPropRefs(whereClause)

  for (const ref of refs) {
    const path = (ref as any).path as Array<string>
    if (!Array.isArray(path) || path.length < 2) continue
    const alias = path[0]
    const field = path[1] as string
    if (alias !== outerAlias) continue
    if (computed.has(field)) return true
  }
  return false
}

/**
 * Detects whether a WHERE clause references the subquery alias through fields that
 * are re-exposed under different names (renamed SELECT projections or fnSelect output).
 * In those cases we keep the clause at the outer level to avoid alias remapping bugs.
 * TODO: in future we should handle this by rewriting the clause to use the subquery's
 * internal field references, but it likely needs a wider refactor to do cleanly.
 */
function referencesAliasWithRemappedSelect(
  subquery: QueryIR,
  whereClause: BasicExpression<boolean>,
  outerAlias: string,
): boolean {
  const refs = collectPropRefs(whereClause)
  // Only care about clauses that actually reference the outer alias.
  if (refs.every((ref) => ref.path[0] !== outerAlias)) {
    return false
  }

  // fnSelect always rewrites the row shape, so alias-safe pushdown is impossible.
  if (subquery.fnSelect) {
    return true
  }

  const select = subquery.select
  // Without an explicit SELECT the clause still refers to the original collection.
  if (!select) {
    return false
  }
  const hasSpreadProjection = Object.keys(select).some((key) =>
    key.startsWith(`__SPREAD_SENTINEL__`),
  )
  const localBindings = getLocalBindingIds(subquery)

  for (const ref of refs) {
    const path = ref.path
    // Need at least alias + field to matter.
    if (path.length < 2) continue
    if (path[0] !== outerAlias) continue

    const projected = select[path[1]!]
    // A spread-selected field has no direct projection entry to remap.
    // Keep its predicate outside rather than guessing its input source.
    if (!projected) {
      if (hasSpreadProjection) return true
      continue
    }

    // Non-PropRef projections are computed values; cannot push down.
    if (!(projected instanceof PropRef)) {
      return true
    }

    // A selected ancestor field depends on the parent route. Moving its
    // predicate into this source would read a same-named child field instead.
    if (
      projected.bindingId !== undefined &&
      !localBindings.has(projected.bindingId)
    ) {
      return true
    }

    // If the projection is just the alias (whole row) without a specific field,
    // we can't verify whether the field we're referencing is being preserved or remapped.
    if (projected.path.length < 2) {
      return true
    }

    const [innerAlias, innerField] = projected.path

    // Safe only when the projection points straight back to the same alias or the
    // underlying source alias and preserves the field name.
    const firstFromAlias = getFirstFromAlias(subquery)
    if (innerAlias !== outerAlias && innerAlias !== firstFromAlias) {
      return true
    }

    if (innerField !== path[1]) {
      return true
    }
  }

  return false
}

/** A copy of the query whose clause arrays are new arrays. */
function copyClauseArrays(query: QueryIR): QueryIR {
  return {
    ...query,
    groupBy: query.groupBy ? [...query.groupBy] : undefined,
    having: query.having ? [...query.having] : undefined,
    orderBy: query.orderBy ? [...query.orderBy] : undefined,
    fnWhere: query.fnWhere ? [...query.fnWhere] : undefined,
    fnHaving: query.fnHaving ? [...query.fnHaving] : undefined,
  }
}

function deepCopyFrom(from: From): From {
  // Share source refs: their SourceId is the compiled input identity.
  if (from.type === `collectionRef` || from.type === `descriptorRef`) {
    return from
  }

  if (from.type === `queryRef`) {
    return new QueryRefClass(
      deepCopyQuery(from.query),
      from.alias,
      from.bindingId,
    )
  }

  if (from.type === `unionAll`) {
    return new UnionAllClass(
      from.queries.map((branch) => deepCopyQuery(branch)),
    )
  }

  return new UnionFromClass(
    from.sources.map(
      (source: CollectionSourceRef | QueryRefClass) =>
        deepCopyFrom(source) as any,
    ),
  )
}

