import { DEFAULT_COMPARE_OPTIONS } from '../utils'
import { hasVirtualPropPath } from '../virtual-props'
import { codedWarning, devBuild } from '../error-message.js'
import { checkCollectionSizeForIndex, isDevModeEnabled } from './index-registry'
import type { CompareOptions } from '../query/builder/types'
import type { BasicExpression } from '../query/ir'
import type { CollectionImpl } from '../collection/index.js'

function shouldAutoIndex(collection: CollectionImpl<any, any, any, any, any>) {
  // Only proceed if auto-indexing is enabled
  // Note: autoIndex: 'eager' without defaultIndexType is caught at construction time
  // in CollectionImpl, so we don't need to check for it here.
  return collection.config.autoIndex === `eager`
}

export function ensureIndexForField<
  T extends Record<string, any>,
  TKey extends string | number,
>(
  fieldName: string,
  fieldPath: Array<string>,
  collection: CollectionImpl<T, TKey, any, any, any>,
  compareOptions?: CompareOptions,
  compareFn?: (a: any, b: any) => number,
  requireOrderedTraversal = false,
) {
  if (hasVirtualPropPath(fieldPath)) {
    return
  }
  const autoIndex = shouldAutoIndex(collection)
  if (!autoIndex && !isDevModeEnabled()) {
    return
  }

  const compareOpts = compareOptions ?? {
    ...DEFAULT_COMPARE_OPTIONS,
    ...collection.compareOptions,
  }

  // An ordered read needs an index whose comparator matches its options;
  // an exact predicate can still use a custom index's equality buckets.
  const existingIndex = Array.from(collection.indexes.values()).find(
    (index) =>
      index.matchesField(fieldPath) &&
      index.matchesCompareOptions(compareOpts) &&
      (!requireOrderedTraversal || index.supportsRangeOptimization),
  )

  if (existingIndex) {
    return // Index already exists
  }

  if (!autoIndex) {
    checkCollectionSizeForIndex(
      collection.id || `unknown`,
      collection.size,
      fieldPath,
    )
    return
  }

  // Create a new index for this field using the collection's createIndex method
  // The collection will use its defaultIndexType
  try {
    collection.createIndex(
      (row) => {
        // Navigate through the field path
        let current: any = row
        for (const part of fieldPath) {
          current = current[part]
        }
        return current
      },
      {
        name: `auto:${fieldPath.join(`.`)}`,
        options: { compareFn, compareOptions: compareOpts },
      },
    )
  } catch (error) {
    console.warn(
      devBuild() && process.env.NODE_ENV !== `production`
        ? `${collection.id ? `[${collection.id}] ` : ``}Failed to create auto-index for field path "${fieldPath.join(`.`)}":`
        : codedWarning(215, { id: collection.id, value: fieldPath.join(`.`) }),
      error,
    )
  }
}

/** Check indexable WHERE fields for eager indexes or development advice. */
export function ensureIndexForExpression<
  T extends Record<string, any>,
  TKey extends string | number,
>(
  expression: BasicExpression,
  collection: CollectionImpl<T, TKey, any, any, any>,
): void {
  if (!shouldAutoIndex(collection) && !isDevModeEnabled()) return

  const indexableExpressions = extractIndexableExpressions(expression)

  for (const {
    fieldName,
    fieldPath,
    requireOrderedTraversal,
  } of indexableExpressions) {
    ensureIndexForField(
      fieldName,
      fieldPath,
      collection,
      undefined,
      undefined,
      requireOrderedTraversal,
    )
  }
}

type IndexableExpression = {
  fieldName: string
  fieldPath: Array<string>
  requireOrderedTraversal: boolean
}

/** Extracts indexable predicates and whether they need relational order. */
function extractIndexableExpressions(
  expression: BasicExpression,
): Array<IndexableExpression> {
  const results: Array<IndexableExpression> = []

  function extractFromExpression(expr: BasicExpression): void {
    if (expr.type !== `func`) {
      return
    }

    const func = expr as any

    // Handle 'and' expressions by recursively processing all arguments
    if (func.name === `and`) {
      for (const arg of func.args) {
        extractFromExpression(arg)
      }
      return
    }

    // Check if this is a supported operation
    const supportedOperations = [`eq`, `gt`, `gte`, `lt`, `lte`, `in`]
    if (!supportedOperations.includes(func.name)) {
      return
    }

    // Check if the first argument is a property reference
    if (func.args.length < 1 || func.args[0].type !== `ref`) {
      return
    }

    const fieldRef = func.args[0]
    const fieldPath = fieldRef.path

    // Skip if the path is empty
    if (fieldPath.length === 0) {
      return
    }

    // For nested paths, use the full path joined with underscores as the field name
    // For simple paths, use the first (and only) element
    const fieldName = fieldPath.join(`_`)
    results.push({
      fieldName,
      fieldPath,
      requireOrderedTraversal: func.name !== `eq` && func.name !== `in`,
    })
  }

  extractFromExpression(expression)
  return results
}
