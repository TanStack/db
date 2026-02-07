import { MultiSet } from '@tanstack/db-ivm'
import { buildQuery, getQueryIR } from '../builder/index.js'
import type { MultiSetArray, RootStreamBuilder } from '@tanstack/db-ivm'
import type { Collection } from '../../collection/index.js'
import type { ChangeMessage } from '../../types.js'
import type { InitialQueryBuilder, QueryBuilder } from '../builder/index.js'
import type { Context } from '../builder/types.js'
import type { QueryIR } from '../ir.js'

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
