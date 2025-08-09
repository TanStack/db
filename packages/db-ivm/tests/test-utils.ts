import { expect } from "vitest"
import { MultiSet } from "../src/multiset.js"

// Enable detailed logging of test results when LOG_RESULTS is set
const LOG_RESULTS =
  process.env.LOG_RESULTS === `true` || process.env.LOG_RESULTS === `1`

/**
 * Materialize a result set from diff messages
 * Takes an array of messages and consolidates them into a final result set
 */
export function materializeResults<T>(
  messages: Array<[T, number]>
): Map<string, T> {
  const multiSet = new MultiSet(messages)
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
 * Materialize a keyed result set from diff messages
 * Takes an array of keyed messages and consolidates them per key
 */
export function materializeKeyedResults<K, V>(
  messages: Array<[[K, V], number]>
): Map<K, V> {
  const result = new Map<K, Map<string, { value: V; multiplicity: number }>>()

  // Group messages by key first
  for (const [[key, value], multiplicity] of messages) {
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
      (entry) => entry.multiplicity > 0
    )

    if (positiveValues.length === 1) {
      finalResult.set(key, positiveValues[0].value)
    } else if (positiveValues.length > 1) {
      throw new Error(
        `Key ${key} has multiple final values: ${positiveValues.map((v) => JSON.stringify(v.value)).join(`, `)}`
      )
    }
    // If no positive values, key was completely removed
  }

  return finalResult
}

/**
 * Convert a Map back to a sorted array for comparison
 */
export function mapToSortedArray<T>(map: Map<string, T>): Array<T> {
  return Array.from(map.values()).sort((a, b) => {
    // Sort by JSON string representation for consistent ordering
    return JSON.stringify(a).localeCompare(JSON.stringify(b))
  })
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
 * Test helper that tracks messages and materializes results
 */
export interface TestResult<T> {
  messages: Array<[T, number]>
  messageCount: number
  materializedResults: Map<string, T>
  sortedResults: Array<T>
}

export interface KeyedTestResult<K, V> {
  messages: Array<[[K, V], number]>
  messageCount: number
  materializedResults: Map<K, V>
  sortedResults: Array<[K, V]>
}

export class MessageTracker<T> {
  private messages: Array<[T, number]> = []

  addMessage(message: MultiSet<T>) {
    this.messages.push(...message.getInner())
  }

  getResult(): TestResult<T> {
    const materializedResults = materializeResults(this.messages)
    const sortedResults = mapToSortedArray(materializedResults)

    return {
      messages: this.messages,
      messageCount: this.messages.length,
      materializedResults,
      sortedResults,
    }
  }

  reset() {
    this.messages = []
  }
}

export class KeyedMessageTracker<K, V> {
  private messages: Array<[[K, V], number]> = []

  addMessage(message: MultiSet<[K, V]>) {
    this.messages.push(...message.getInner())
  }

  getResult(): KeyedTestResult<K, V> {
    const materializedResults = materializeKeyedResults(this.messages)
    const sortedResults = Array.from(materializedResults.entries()).sort(
      (a, b) => {
        // Sort by key for consistent ordering
        return JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0]))
      }
    )

    return {
      messages: this.messages,
      messageCount: this.messages.length,
      materializedResults,
      sortedResults,
    }
  }

  reset() {
    this.messages = []
  }
}

/**
 * Assert that results match expected, with message count logging
 */
export function assertResults<T>(
  testName: string,
  actual: TestResult<T>,
  expected: Array<T>,
  maxExpectedMessages?: number
) {
  const expectedMap = createExpectedResults(expected)
  const expectedSorted = mapToSortedArray(expectedMap)

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ${actual.messageCount} messages, ${actual.sortedResults.length} final results`
    )
    console.log(`  Messages:`, actual.messages)
    console.log(`  Final results:`, actual.sortedResults)
  }

  // Check that materialized results match expected
  expect(actual.sortedResults).toEqual(expectedSorted)

  // Check message count constraints if provided
  if (maxExpectedMessages !== undefined) {
    expect(actual.messageCount).toBeLessThanOrEqual(maxExpectedMessages)
  }

  // Log for debugging - use more reasonable threshold
  // For empty results, allow up to 2 messages (typical for removal operations)
  // For non-empty results, allow up to 3x the expected count
  const reasonableThreshold = expected.length === 0 ? 2 : expected.length * 3
  if (actual.messageCount > reasonableThreshold) {
    console.warn(
      `⚠️  ${testName}: High message count (${actual.messageCount} messages for ${expected.length} expected results)`
    )
  }
}

/**
 * Assert that keyed results match expected, with message count logging
 */
export function assertKeyedResults<K, V>(
  testName: string,
  actual: KeyedTestResult<K, V>,
  expected: Array<[K, V]>,
  maxExpectedMessages?: number
) {
  const expectedSorted = expected.sort((a, b) => {
    return JSON.stringify(a[0]).localeCompare(JSON.stringify(b[0]))
  })

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ${actual.messageCount} messages, ${actual.sortedResults.length} final results per key`
    )
    console.log(`  Messages:`, actual.messages)
    console.log(`  Final results:`, actual.sortedResults)
  }

  // Check that materialized results match expected
  expect(actual.sortedResults).toEqual(expectedSorted)

  // Check message count constraints if provided
  if (maxExpectedMessages !== undefined) {
    expect(actual.messageCount).toBeLessThanOrEqual(maxExpectedMessages)
  }

  // Log for debugging - use more reasonable threshold
  // Account for scenarios where messages cancel out due to object identity
  // Allow up to 4x the expected count to accommodate remove/add pairs
  const reasonableThreshold = Math.max(expected.length * 4, 2)
  if (actual.messageCount > reasonableThreshold) {
    console.warn(
      `⚠️  ${testName}: High message count (${actual.messageCount} messages for ${expected.length} expected key-value pairs)`
    )
  }

  // Log key insights
  const affectedKeys = new Set(
    actual.messages.map(([[key, _value], _mult]) => key)
  )
  if (LOG_RESULTS) {
    console.log(
      `${testName}: ✅ ${affectedKeys.size} keys affected, ${actual.sortedResults.length} final keys`
    )
  }
}

/**
 * Extract unique keys from messages to verify incremental behavior
 */
export function extractMessageKeys<K, V>(
  messages: Array<[[K, V], number]>
): Set<K> {
  const keys = new Set<K>()
  for (const [[key, _value], _multiplicity] of messages) {
    keys.add(key)
  }
  return keys
}

/**
 * Assert that only specific keys appear in messages (for incremental processing verification)
 */
export function assertOnlyKeysAffected<K, V>(
  testName: string,
  messages: Array<[[K, V], number]>,
  expectedKeys: Array<K>
) {
  const actualKeys = extractMessageKeys(messages)
  const expectedKeySet = new Set(expectedKeys)

  // Check that all actual keys are expected
  Array.from(actualKeys).forEach((key) => {
    if (!expectedKeySet.has(key)) {
      throw new Error(`${testName}: Unexpected key ${key} in messages`)
    }
  })

  if (LOG_RESULTS) {
    console.log(
      `${testName}: ✅ Only expected keys affected: ${Array.from(actualKeys).join(`, `)}`
    )
  }
}
