import { MultiSet, serializeValue } from '@tanstack/db-ivm'
import { normalizeOrderByPaths } from '../compiler/expressions.js'
import { buildQuery, getQueryIR } from '../builder/index.js'
import type { MultiSetArray, RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type { ChangeMessage } from '../../types.js'
import type { InitialQueryBuilder, QueryBuilder } from '../builder/index.js'
import type { Context } from '../builder/types.js'
import type { OrderBy, QueryIR } from '../ir.js'
import type { OrderByOptimizationInfo } from '../compiler/order-by.js'

/**
 * Helper function to extract collections from a compiled query.
 * Traverses the query IR to find all collection references.
 * Maps collections by their ID (not alias) as expected by the compiler.
 */
export function extractCollectionsFromQuery(
  query: any,
): Record<string, Collection<any, any, any>> {
  const collections: Record<string, any> = {}

  // Helper function to recursively extract collections from a query or source
  function extractFromSource(source: any) {
    if (source.type === `collectionRef`) {
      collections[source.collection.id] = source.collection
    } else if (source.type === `queryRef`) {
      // Recursively extract from subquery
      extractFromQuery(source.query)
    }
  }

  // Helper function to recursively extract collections from a query
  function extractFromQuery(q: any) {
    // Extract from FROM clause
    if (q.from) {
      extractFromSource(q.from)
    }

    // Extract from JOIN clauses
    if (q.join && Array.isArray(q.join)) {
      for (const joinClause of q.join) {
        if (joinClause.from) {
          extractFromSource(joinClause.from)
        }
      }
    }
  }

  // Start extraction from the root query
  extractFromQuery(query)

  return collections
}

/**
 * Helper function to extract the collection that is referenced in the query's FROM clause.
 * The FROM clause may refer directly to a collection or indirectly to a subquery.
 */
export function extractCollectionFromSource(
  query: any,
): Collection<any, any, any> {
  const from = query.from

  if (from.type === `collectionRef`) {
    return from.collection
  } else if (from.type === `queryRef`) {
    // Recursively extract from subquery
    return extractCollectionFromSource(from.query)
  }

  throw new Error(
    `Failed to extract collection. Invalid FROM clause: ${JSON.stringify(query)}`,
  )
}

/**
 * Extracts all aliases used for each collection across the entire query tree.
 *
 * Traverses the QueryIR recursively to build a map from collection ID to all aliases
 * that reference that collection. This is essential for self-join support, where the
 * same collection may be referenced multiple times with different aliases.
 *
 * For example, given a query like:
 * ```ts
 * q.from({ employee: employeesCollection })
 *   .join({ manager: employeesCollection }, ({ employee, manager }) =>
 *     eq(employee.managerId, manager.id)
 *   )
 * ```
 *
 * This function would return:
 * ```
 * Map { "employees" => Set { "employee", "manager" } }
 * ```
 *
 * @param query - The query IR to extract aliases from
 * @returns A map from collection ID to the set of all aliases referencing that collection
 */
export function extractCollectionAliases(
  query: QueryIR,
): Map<string, Set<string>> {
  const aliasesById = new Map<string, Set<string>>()

  function recordAlias(source: any) {
    if (!source) return

    if (source.type === `collectionRef`) {
      const { id } = source.collection
      const existing = aliasesById.get(id)
      if (existing) {
        existing.add(source.alias)
      } else {
        aliasesById.set(id, new Set([source.alias]))
      }
    } else if (source.type === `queryRef`) {
      traverse(source.query)
    }
  }

  function traverse(q?: QueryIR) {
    if (!q) return

    recordAlias(q.from)

    if (q.join) {
      for (const joinClause of q.join) {
        recordAlias(joinClause.from)
      }
    }
  }

  traverse(query)

  return aliasesById
}

/**
 * Builds a query IR from a config object that contains either a query builder
 * function or a QueryBuilder instance.
 */
export function buildQueryFromConfig<TContext extends Context>(config: {
  query:
    | ((q: InitialQueryBuilder) => QueryBuilder<TContext>)
    | QueryBuilder<TContext>
}): QueryIR {
  // Build the query using the provided query builder function or instance
  if (typeof config.query === `function`) {
    return buildQuery<TContext>(config.query)
  }
  return getQueryIR(config.query)
}

/**
 * Helper function to send changes to a D2 input stream.
 * Converts ChangeMessages to D2 MultiSet data and sends to the input.
 *
 * @returns The number of multiset entries sent
 */
export function sendChangesToInput(
  input: RootStreamBuilder<unknown>,
  changes: Iterable<ChangeMessage>,
  getKey: (item: ChangeMessage[`value`]) => any,
): number {
  const multiSetArray: MultiSetArray<unknown> = []
  for (const change of changes) {
    const key = getKey(change.value)
    if (change.type === `insert`) {
      multiSetArray.push([[key, change.value], 1])
    } else if (change.type === `update`) {
      multiSetArray.push([[key, change.previousValue], -1])
      multiSetArray.push([[key, change.value], 1])
    } else {
      // change.type === `delete`
      multiSetArray.push([[key, change.value], -1])
    }
  }

  if (multiSetArray.length !== 0) {
    input.sendData(new MultiSet(multiSetArray))
  }

  return multiSetArray.length
}

/** Splits updates into a delete of the old value and an insert of the new value */
export function* splitUpdates<
  T extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
>(
  changes: Iterable<ChangeMessage<T, TKey>>,
): Generator<ChangeMessage<T, TKey>> {
  for (const change of changes) {
    if (change.type === `update`) {
      yield { type: `delete`, key: change.key, value: change.previousValue! }
      yield { type: `insert`, key: change.key, value: change.value }
    } else {
      yield change
    }
  }
}

/**
 * Filter changes to prevent duplicate inserts to a D2 pipeline.
 * Maintains D2 multiplicity at 1 for visible items so that deletes
 * properly reduce multiplicity to 0.
 *
 * Mutates `sentKeys` in place: adds keys on insert, removes on delete.
 */
export function filterDuplicateInserts(
  changes: Array<ChangeMessage<any, string | number>>,
  sentKeys: Set<string | number>,
): Array<ChangeMessage<any, string | number>> {
  const filtered: Array<ChangeMessage<any, string | number>> = []
  for (const change of changes) {
    if (change.type === `insert`) {
      if (sentKeys.has(change.key)) {
        continue // Skip duplicate
      }
      sentKeys.add(change.key)
    } else if (change.type === `delete`) {
      sentKeys.delete(change.key)
    }
    filtered.push(change)
  }
  return filtered
}

/**
 * Track the biggest value seen in a stream of changes, used for cursor-based
 * pagination in ordered subscriptions. Returns whether the load request key
 * should be reset (allowing another load).
 *
 * @param changes   - changes to process (deletes are skipped)
 * @param current   - the current biggest value (or undefined if none)
 * @param sentKeys  - set of keys already sent to D2 (for new-key detection)
 * @param comparator - orderBy comparator
 * @returns `{ biggest, shouldResetLoadKey }` — the new biggest value and
 *          whether the caller should clear its last-load-request-key
 */
export function trackBiggestSentValue(
  changes: Array<ChangeMessage<any, string | number>>,
  current: unknown | undefined,
  sentKeys: Set<string | number>,
  comparator: (a: any, b: any) => number,
): { biggest: unknown; shouldResetLoadKey: boolean } {
  let biggest = current
  let shouldResetLoadKey = false

  for (const change of changes) {
    if (change.type === `delete`) continue

    const isNewKey = !sentKeys.has(change.key)

    if (biggest === undefined) {
      biggest = change.value
      shouldResetLoadKey = true
    } else if (comparator(biggest, change.value) < 0) {
      biggest = change.value
      shouldResetLoadKey = true
    } else if (isNewKey) {
      // New key at same sort position — allow another load if needed
      shouldResetLoadKey = true
    }
  }

  return { biggest, shouldResetLoadKey }
}

/**
 * Compute orderBy/limit subscription hints for an alias.
 * Returns normalised orderBy and effective limit suitable for passing to
 * `subscribeChanges`, or `undefined` values when the query's orderBy cannot
 * be scoped to the given alias (e.g. cross-collection refs or aggregates).
 */
export function computeSubscriptionOrderByHints(
  query: { orderBy?: OrderBy; limit?: number; offset?: number },
  alias: string,
): { orderBy: OrderBy | undefined; limit: number | undefined } {
  const { orderBy, limit, offset } = query
  const effectiveLimit =
    limit !== undefined && offset !== undefined ? limit + offset : limit

  const normalizedOrderBy = orderBy
    ? normalizeOrderByPaths(orderBy, alias)
    : undefined

  // Only pass orderBy when it is scoped to this alias and uses simple refs,
  // to avoid leaking cross-collection paths into backend-specific compilers.
  const canPassOrderBy =
    normalizedOrderBy?.every((clause) => {
      const exp = clause.expression
      if (exp.type !== `ref`) return false
      const path = exp.path
      return Array.isArray(path) && path.length === 1
    }) ?? false

  return {
    orderBy: canPassOrderBy ? normalizedOrderBy : undefined,
    limit: canPassOrderBy ? effectiveLimit : undefined,
  }
}

/**
 * Compute the cursor for loading the next batch of ordered data.
 * Extracts values from the biggest sent row and builds the `minValues`
 * array and a deduplication key.
 *
 * @returns `undefined` if the load should be skipped (duplicate request),
 *          otherwise `{ minValues, normalizedOrderBy, loadRequestKey }`.
 */
export function computeOrderedLoadCursor(
  orderByInfo: Pick<
    OrderByOptimizationInfo,
    'orderBy' | 'valueExtractorForRawRow' | 'offset'
  >,
  biggestSentRow: unknown | undefined,
  lastLoadRequestKey: string | undefined,
  alias: string,
  limit: number,
): {
  minValues: Array<unknown> | undefined
  normalizedOrderBy: OrderBy
  loadRequestKey: string
} | undefined {
  const { orderBy, valueExtractorForRawRow, offset } = orderByInfo

  // Extract all orderBy column values from the biggest sent row
  // For single-column: returns single value, for multi-column: returns array
  const extractedValues = biggestSentRow
    ? valueExtractorForRawRow(biggestSentRow as Record<string, unknown>)
    : undefined

  // Normalize to array format for minValues
  let minValues: Array<unknown> | undefined
  if (extractedValues !== undefined) {
    minValues = Array.isArray(extractedValues)
      ? extractedValues
      : [extractedValues]
  }

  // Deduplicate: skip if we already issued an identical load request
  const loadRequestKey = serializeValue({
    minValues: minValues ?? null,
    offset,
    limit,
  })
  if (lastLoadRequestKey === loadRequestKey) {
    return undefined
  }

  const normalizedOrderBy = normalizeOrderByPaths(orderBy, alias)

  return { minValues, normalizedOrderBy, loadRequestKey }
}
