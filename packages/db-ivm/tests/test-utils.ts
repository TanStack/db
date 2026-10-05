import { expect } from 'vitest'
import { MultiSet } from '../src/multiset.js'

// Enable detailed logging of test results when LOG_RESULTS is set
const LOG_RESULTS =
  process.env.LOG_RESULTS === `true` || process.env.LOG_RESULTS === `1`

/**
 * Materialize a result set from weighted deltas
 * Takes an array of weighted deltas and consolidates them into a final result set
 */
export function materializeResults<T>(
  weightedDeltas: Array<[T, number]>,
): Map<string, T> {
  const multiSet = new MultiSet(weightedDeltas)
  const consolidated = multiSet.consolidate()
  const result = new Map<string, T>()

  for (const [item, multiplicity] of consolidated.getInner()) {
    if (multiplicity > 0) {
      // Use JSON.stringify for content-based key comparison
      const key = JSON.stringify(item)
      result.set(key, item)
    }
  }

  return result
}

/**
 * Materialize a keyed result set from weighted deltas
 * Takes an array of keyed weighted deltas and consolidates them per key
 */
export function materializeKeyedResults<K, V>(
  weightedDeltas: Array<[[K, V], number]>,
): Map<K, V> {
  const result = new Map<K, Map<string, { value: V; multiplicity: number }>>()

  // Group weighted deltas by key first
  for (const [[key, value], multiplicity] of weightedDeltas) {
    if (!result.has(key)) {
      result.set(key, new Map())
    }

    const valueMap = result.get(key)!
    const valueKey = JSON.stringify(value)
    const existing = valueMap.get(valueKey)
    const newMultiplicity = (existing?.multiplicity ?? 0) + multiplicity

    if (newMultiplicity === 0) {
      valueMap.delete(valueKey)
    } else {
      valueMap.set(valueKey, { value, multiplicity: newMultiplicity })
    }
  }

  // Extract final values per key
  const finalResult = new Map<K, V>()
  for (const [key, valueMap] of result.entries()) {
    // Filter to only positive multiplicities
    const positiveValues = Array.from(valueMap.values()).filter(
      (entry) => entry.multiplicity > 0,
    )

    if (positiveValues.length === 1) {
      finalResult.set(key, positiveValues[0]!.value)
    } else if (positiveValues.length > 1) {
      throw new Error(
        `Key ${key} has multiple final values: ${positiveValues.map((v) => JSON.stringify(v.value)).join(`, `)}`,
      )
    }
    // If no positive values, key was completely removed
  }

  return finalResult
}

/**
 * Convert a Map back to a sorted array for comparison
 */
export function mapToSortedArray<T>(
  map: Map<string, T>,
  compare?: (a: T, b: T) => number,
): Array<T> {
  const compareFn =
    compare ??
    ((a: T, b: T) => {
      // Sort by JSON string representation for consistent ordering
      return JSON.stringify(a).localeCompare(JSON.stringify(b))
    })
  return Array.from(map.values()).sort(compareFn)
}

/**
 * Create expected result set as a Map
 */
export function createExpectedResults<T>(items: Array<T>): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) {
    const key = JSON.stringify(item)
    map.set(key, item)
  }
  return map
}

/**
 * Test observation of flattened weighted deltas and their materialized result.
 * Each [row, weight] entry contributes one to deltaCount, regardless of weight.
 * Both trackers receive D2 MultiSet messages and flatten their entries.
 * They omit message boundaries: an empty message contributes no delta.
 */
export interface TestResult<T> {
  weightedDeltas: Array<[T, number]>
  deltaCount: number
  materializedResults: Map<string, T>
  sortedResults: Array<T>
}

export interface KeyedTestResult<K, V> {
  weightedDeltas: Array<[[K, V], number]>
  deltaCount: number
  materializedResults: Map<K, V>
  sortedResults: Array<[K, V]>
}

export class MessageTracker<T> {
  private weightedDeltas: Array<[T, number]> = []

  addMessage(message: MultiSet<T>) {
    this.weightedDeltas.push(...message.getInner())
  }

  getResult(compare?: (a: T, b: T) => number): TestResult<T> {
    const materializedResults = materializeResults(this.weightedDeltas)
    const sortedResults = mapToSortedArray(materializedResults, compare)

    return {
      weightedDeltas: this.weightedDeltas,
      deltaCount: this.weightedDeltas.length,
      materializedResults,
      sortedResults,
    }
  }

  reset() {
    this.weightedDeltas = []
  }
}

export class KeyedMessageTracker<K, V> {
  private weightedDeltas: Array<[[K, V], number]> = []

  addMessage(message: MultiSet<[K, V]>) {
    this.weightedDeltas.push(...message.getInner())
  }

  getResult(): KeyedTestResult<K, V> {
    const materializedResults = materializeKeyedResults(this.weightedDeltas)
    const sortedResults = Array.from(materializedResults.entries()).sort(
      (a, b) => {
        // Sort by key for consistent ordering
        return JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0]))
      },
    )

    return {
      weightedDeltas: this.weightedDeltas,
      deltaCount: this.weightedDeltas.length,
      materializedResults,
      sortedResults,
    }
  }

  reset() {
    this.weightedDeltas = []
  }
}

/**
 * Assert that results match expected, with weighted delta count logging
 */
export function assertResults<T>(
  testName: string,
  actual: TestResult<T>,
  expected: Array<T>,
  maxExpectedDeltas?: number,
) {
  const expectedMap = createExpectedResults(expected)
  const expectedSorted = mapToSortedArray(expectedMap)

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ${actual.deltaCount} weighted deltas, ${actual.sortedResults.length} final results`,
    )
    console.log(`  Weighted deltas:`, actual.weightedDeltas)
    console.log(`  Final results:`, actual.sortedResults)
  }

  // Check that materialized results match expected
  expect(actual.sortedResults).toEqual(expectedSorted)

  // Check weighted delta count constraints if provided
  if (maxExpectedDeltas !== undefined) {
    expect(actual.deltaCount).toBeLessThanOrEqual(maxExpectedDeltas)
  }

  // Log for debugging - use more reasonable threshold
  // For empty results, allow up to 2 weighted deltas (typical for removal operations)
  // For non-empty results, allow up to 3x the expected count
  const reasonableThreshold = expected.length === 0 ? 2 : expected.length * 3
  if (actual.deltaCount > reasonableThreshold) {
    console.warn(
      `⚠️  ${testName}: High weighted delta count (${actual.deltaCount} weighted deltas for ${expected.length} expected results)`,
    )
  }
}

/**
 * Assert that keyed results match expected, with weighted delta count logging
 */
export function assertKeyedResults<K, V>(
  testName: string,
  actual: KeyedTestResult<K, V>,
  expected: Array<[K, V]>,
  maxExpectedDeltas?: number,
) {
  const expectedSorted = expected.sort((a, b) => {
    return JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0]))
  })

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ${actual.deltaCount} weighted deltas, ${actual.sortedResults.length} final results per key`,
    )
    console.log(`  Weighted deltas:`, actual.weightedDeltas)
    console.log(`  Final results:`, actual.sortedResults)
  }

  // Check that materialized results match expected
  expect(actual.sortedResults).toEqual(expectedSorted)

  // Check weighted delta count constraints if provided
  if (maxExpectedDeltas !== undefined) {
    expect(actual.deltaCount).toBeLessThanOrEqual(maxExpectedDeltas)
  }

  // Log for debugging - use more reasonable threshold
  // Account for scenarios where weighted deltas cancel out due to object identity
  // Allow up to 4x the expected count to accommodate remove/add pairs
  const reasonableThreshold = Math.max(expected.length * 4, 2)
  if (actual.deltaCount > reasonableThreshold) {
    console.warn(
      `⚠️  ${testName}: High weighted delta count (${actual.deltaCount} weighted deltas for ${expected.length} expected key-value pairs)`,
    )
  }

  // Log key insights
  const affectedKeys = new Set(
    actual.weightedDeltas.map(([[key, _value], _mult]) => key),
  )
  if (LOG_RESULTS) {
    console.log(
      `${testName}: ✅ ${affectedKeys.size} keys affected, ${actual.sortedResults.length} final keys`,
    )
  }
}

/**
 * Extract unique keys from weighted deltas to verify incremental behavior
 */
export function extractDeltaKeys<K, V>(
  weightedDeltas: Array<[[K, V], number]>,
): Set<K> {
  const keys = new Set<K>()
  for (const [[key, _value], _multiplicity] of weightedDeltas) {
    keys.add(key)
  }
  return keys
}

/**
 * Assert that only specific keys appear in weighted deltas (for incremental processing verification)
 */
export function assertOnlyKeysAffected<K, V>(
  testName: string,
  weightedDeltas: Array<[[K, V], number]>,
  expectedKeys: Array<K>,
) {
  const actualKeys = extractDeltaKeys(weightedDeltas)
  const expectedKeySet = new Set(expectedKeys)

  // Check that all actual keys are expected
  Array.from(actualKeys).forEach((key) => {
    if (!expectedKeySet.has(key)) {
      throw new Error(`${testName}: Unexpected key ${key} in weighted deltas`)
    }
  })

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ✅ Only expected keys affected: ${Array.from(actualKeys).join(`, `)}`,
    )
  }
}

export const compareFractionalIndex = (
  r1: [unknown, [unknown, string]],
  r2: [unknown, [unknown, string]],
) => {
  const [_key1, [_value1, index1]] = r1
  const [_key2, [_value2, index2]] = r2
  return index1 < index2 ? -1 : index1 > index2 ? 1 : 0
}
