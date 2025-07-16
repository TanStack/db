import { compileSingleRowExpression } from "./query/compiler/evaluators.js"
import { ascComparator } from "./utils/comparison.js"
import type { BasicExpression } from "./query/ir.js"

/**
 * Represents an index for fast lookups on a collection
 * Encapsulates all index logic and maintains internal data structures
 */
export class CollectionIndex<TKey extends string | number = string | number> {
  public readonly id: string
  public readonly name?: string
  public readonly expression: BasicExpression

  // Internal data structures - private to hide implementation details
  private orderedEntries: Array<[any, Set<TKey>]> = []
  private valueMap = new Map<any, Set<TKey>>()
  private indexedKeys = new Set<TKey>()
  private compareFn: (a: any, b: any) => number

  constructor(id: string, expression: BasicExpression, name?: string) {
    this.id = id
    this.name = name
    this.expression = expression
    this.compareFn = ascComparator
  }

  /**
   * Adds a value to the index
   */
  add(key: TKey, item: any): void {
    try {
      const indexedValue = this.evaluateIndexExpression(item)

      // Check if this value already exists
      if (this.valueMap.has(indexedValue)) {
        // Add to existing set
        this.valueMap.get(indexedValue)!.add(key)
      } else {
        // Create new set for this value
        const keySet = new Set<TKey>([key])
        this.valueMap.set(indexedValue, keySet)

        // Find correct position in ordered entries using binary search
        const insertIndex = this.findInsertPosition(indexedValue)
        this.orderedEntries.splice(insertIndex, 0, [indexedValue, keySet])
      }

      this.indexedKeys.add(key)
    } catch (error) {
      // If indexing fails for this item, skip it but don't break the whole index
      console.warn(`Failed to index item with key ${key}:`, error)
    }
  }

  /**
   * Removes a value from the index
   */
  remove(key: TKey, item: any): void {
    try {
      const indexedValue = this.evaluateIndexExpression(item)

      const keysForValue = this.valueMap.get(indexedValue)
      if (keysForValue) {
        keysForValue.delete(key)
        if (keysForValue.size === 0) {
          // Remove from valueMap
          this.valueMap.delete(indexedValue)

          // Remove from orderedEntries using binary search
          const entryIndex = this.findInsertPosition(indexedValue)
          if (
            entryIndex < this.orderedEntries.length &&
            this.compareFn(
              this.orderedEntries[entryIndex]![0],
              indexedValue
            ) === 0
          ) {
            this.orderedEntries.splice(entryIndex, 1)
          }
        }
      }

      this.indexedKeys.delete(key)
    } catch (error) {
      // If removing from index fails, skip it but don't break
      console.warn(`Failed to remove item with key ${key} from index:`, error)
    }
  }

  /**
   * Updates a value in the index (removes old, adds new)
   */
  update(key: TKey, oldItem: any, newItem: any): void {
    this.remove(key, oldItem)
    this.add(key, newItem)
  }

  /**
   * Builds the index with current data
   */
  build(data: Iterable<[TKey, any]>): void {
    // Clear existing index data
    this.orderedEntries.length = 0
    this.valueMap.clear()
    this.indexedKeys.clear()

    // Collect all values first
    const valueEntries = new Map<any, Set<TKey>>()

    // Index all current items
    for (const [key, item] of data) {
      try {
        const indexedValue = this.evaluateIndexExpression(item)

        if (!valueEntries.has(indexedValue)) {
          valueEntries.set(indexedValue, new Set<TKey>())
        }

        valueEntries.get(indexedValue)!.add(key)
        this.indexedKeys.add(key)
      } catch (error) {
        // If indexing fails for this item, skip it but don't break the whole index
        console.warn(`Failed to index item with key ${key}:`, error)
      }
    }

    // Sort the values and create ordered entries
    const allValues = Array.from(valueEntries.keys())
    const undefinedValues: Array<any> = []
    const definedValues: Array<any> = []

    for (const value of allValues) {
      if (value === undefined) {
        // Only undefined (null is considered defined for sorting)
        undefinedValues.push(value)
      } else {
        definedValues.push(value)
      }
    }

    // Sort defined values (including null)
    definedValues.sort(this.compareFn)

    // Combine with undefined first, then defined values
    undefinedValues.push(...definedValues)

    for (const value of undefinedValues) {
      const keys = valueEntries.get(value)!
      this.orderedEntries.push([value, keys])
      this.valueMap.set(value, keys)
    }
  }

  /**
   * Performs equality lookup
   */
  equalityLookup(value: any): Set<TKey> {
    const keys = this.valueMap.get(value)
    return keys ? new Set(keys) : new Set()
  }

  /**
   * Performs range query
   */
  rangeQuery(operation: `gt` | `gte` | `lt` | `lte`, value: any): Set<TKey> {
    const result = new Set<TKey>()

    // Find the position of the value using binary search
    const insertIndex = this.findInsertPosition(value)

    let startIndex: number
    let endIndex: number

    switch (operation) {
      case `lt`:
        startIndex = 0
        endIndex = insertIndex
        break
      case `lte`:
        startIndex = 0
        endIndex = insertIndex
        // Include the value if it exists
        if (
          insertIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[insertIndex]![0], value) === 0
        ) {
          endIndex = insertIndex + 1
        }
        break
      case `gt`:
        startIndex = insertIndex
        // Skip the value if it exists
        if (
          insertIndex < this.orderedEntries.length &&
          this.compareFn(this.orderedEntries[insertIndex]![0], value) === 0
        ) {
          startIndex = insertIndex + 1
        }
        endIndex = this.orderedEntries.length
        break
      case `gte`:
        startIndex = insertIndex
        endIndex = this.orderedEntries.length
        break
    }

    // Collect keys from the range
    for (let i = startIndex; i < endIndex; i++) {
      const keys = this.orderedEntries[i]![1]
      keys.forEach((key) => result.add(key))
    }

    return result
  }

  /**
   * Gets the number of indexed keys
   */
  get keyCount(): number {
    return this.indexedKeys.size
  }

  /**
   * Gets the indexed keys set (for testing)
   */
  get indexedKeysSet(): Set<TKey> {
    return this.indexedKeys
  }

  /**
   * Gets the ordered entries (for testing)
   */
  get orderedEntriesArray(): Array<[any, Set<TKey>]> {
    return this.orderedEntries
  }

  /**
   * Gets the value map (for testing)
   */
  get valueMapData(): Map<any, Set<TKey>> {
    return this.valueMap
  }

  /**
   * Checks if the index matches a field path
   */
  matchesField(fieldPath: Array<string>): boolean {
    return (
      this.expression.type === `ref` &&
      this.expression.path.length === fieldPath.length &&
      this.expression.path.every((part, i) => part === fieldPath[i])
    )
  }

  // Private methods

  private evaluateIndexExpression(item: any): any {
    // Use the single-row evaluator for direct property access without table aliases
    const evaluator = compileSingleRowExpression(this.expression)
    return evaluator(item as Record<string, unknown>)
  }

  private findInsertPosition(value: any): number {
    let left = 0
    let right = this.orderedEntries.length

    while (left < right) {
      const mid = Math.floor((left + right) / 2)
      const comparison = this.compareFn(this.orderedEntries[mid]![0], value)

      if (comparison < 0) {
        left = mid + 1
      } else {
        right = mid
      }
    }

    return left
  }
}
