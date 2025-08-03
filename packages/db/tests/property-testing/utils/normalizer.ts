import type {
  GeneratorConfig,
  NormalizedValue,
  TestRow,
  TestValue,
} from "../types"

/**
 * Normalizes values for comparison between TanStack DB and SQLite
 */
export class ValueNormalizer {
  private config: GeneratorConfig

  constructor(config: GeneratorConfig = { floatTolerance: 1e-12 }) {
    this.config = config
  }

  /**
   * Normalizes a single value for comparison
   */
  normalizeValue(value: TestValue): NormalizedValue {
    if (value === null) {
      return {
        type: `null`,
        value: null,
        sortKey: `null`,
      }
    }

    if (typeof value === `string`) {
      return {
        type: `string`,
        value,
        sortKey: value.toLowerCase(),
      }
    }

    if (typeof value === `number`) {
      return {
        type: `number`,
        value,
        sortKey: this.normalizeNumberForSort(value),
      }
    }

    if (typeof value === `boolean`) {
      return {
        type: `boolean`,
        value,
        sortKey: value ? `1` : `0`,
      }
    }

    if (Array.isArray(value)) {
      return {
        type: `array`,
        value,
        sortKey: this.normalizeArrayForSort(value),
      }
    }

    if (typeof value === `object`) {
      return {
        type: `object`,
        value,
        sortKey: this.normalizeObjectForSort(value),
      }
    }

    // Fallback
    return {
      type: `string`,
      value: String(value),
      sortKey: String(value).toLowerCase(),
    }
  }

  /**
   * Normalizes a row for comparison
   */
  normalizeRow(row: TestRow): Array<NormalizedValue> {
    const normalized: Array<NormalizedValue> = []

    // Sort keys for consistent ordering
    const sortedKeys = Object.keys(row).sort()

    for (const key of sortedKeys) {
      normalized.push(this.normalizeValue(row[key]))
    }

    return normalized
  }

  /**
   * Normalizes an array of rows for comparison
   */
  normalizeRows(rows: Array<TestRow>): Array<Array<NormalizedValue>> {
    return rows.map((row) => this.normalizeRow(row))
  }

  /**
   * Compares two normalized values for equality
   */
  compareValues(a: NormalizedValue, b: NormalizedValue): boolean {
    if (a.type !== b.type) {
      return false
    }

    switch (a.type) {
      case `null`:
        return b.value === null

      case `string`:
        return a.value === b.value

      case `boolean`:
        return a.value === b.value

      case `number`:
        return this.compareNumbers(a.value, b.value)

      case `array`:
        return this.compareArrays(a.value, b.value)

      case `object`:
        return this.compareObjects(a.value, b.value)

      default:
        return false
    }
  }

  /**
   * Compares two numbers with tolerance for floating point
   */
  private compareNumbers(a: number, b: number): boolean {
    if (Number.isInteger(a) && Number.isInteger(b)) {
      return a === b
    }

    // Use tolerance for floating point comparison
    return Math.abs(a - b) <= this.config.floatTolerance
  }

  /**
   * Compares two arrays
   */
  private compareArrays(a: Array<TestValue>, b: Array<TestValue>): boolean {
    if (a.length !== b.length) {
      return false
    }

    for (let i = 0; i < a.length; i++) {
      const normA = this.normalizeValue(a[i])
      const normB = this.normalizeValue(b[i])

      if (!this.compareValues(normA, normB)) {
        return false
      }
    }

    return true
  }

  /**
   * Compares two objects
   */
  private compareObjects(
    a: Record<string, TestValue>,
    b: Record<string, TestValue>
  ): boolean {
    const keysA = Object.keys(a).sort()
    const keysB = Object.keys(b).sort()

    if (keysA.length !== keysB.length) {
      return false
    }

    for (let i = 0; i < keysA.length; i++) {
      if (keysA[i] !== keysB[i]) {
        return false
      }

      const normA = this.normalizeValue(a[keysA[i]])
      const normB = this.normalizeValue(b[keysB[i]])

      if (!this.compareValues(normA, normB)) {
        return false
      }
    }

    return true
  }

  /**
   * Normalizes a number for sorting
   */
  private normalizeNumberForSort(value: number): string {
    // Handle special cases
    if (value === 0) return `0`
    if (value < 0) return `-${Math.abs(value).toString().padStart(20, `0`)}`
    return value.toString().padStart(20, `0`)
  }

  /**
   * Normalizes an array for sorting
   */
  private normalizeArrayForSort(value: Array<TestValue>): string {
    return value.map((item) => this.normalizeValue(item).sortKey).join(`|`)
  }

  /**
   * Normalizes an object for sorting
   */
  private normalizeObjectForSort(value: Record<string, TestValue>): string {
    const sortedKeys = Object.keys(value).sort()
    return sortedKeys
      .map((key) => `${key}:${this.normalizeValue(value[key]).sortKey}`)
      .join(`|`)
  }

  /**
   * Sorts normalized rows consistently
   */
  sortNormalizedRows(
    rows: Array<Array<NormalizedValue>>
  ): Array<Array<NormalizedValue>> {
    return rows.sort((a, b) => {
      const minLength = Math.min(a.length, b.length)

      for (let i = 0; i < minLength; i++) {
        const comparison = a[i].sortKey.localeCompare(b[i].sortKey)
        if (comparison !== 0) {
          return comparison
        }
      }

      // If all values are equal up to minLength, shorter array comes first
      return a.length - b.length
    })
  }

  /**
   * Compares two sets of rows for equality
   */
  compareRowSets(
    rows1: Array<TestRow>,
    rows2: Array<TestRow>
  ): {
    equal: boolean
    differences?: Array<{
      index: number
      row1: TestRow
      row2: TestRow
      normalized1: Array<NormalizedValue>
      normalized2: Array<NormalizedValue>
    }>
  } {
    const normalized1 = this.sortNormalizedRows(this.normalizeRows(rows1))
    const normalized2 = this.sortNormalizedRows(this.normalizeRows(rows2))

    if (normalized1.length !== normalized2.length) {
      return {
        equal: false,
        differences: [
          {
            index: -1,
            row1: {} as TestRow,
            row2: {} as TestRow,
            normalized1: [],
            normalized2: [],
          },
        ],
      }
    }

    const differences: Array<{
      index: number
      row1: TestRow
      row2: TestRow
      normalized1: Array<NormalizedValue>
      normalized2: Array<NormalizedValue>
    }> = []

    for (let i = 0; i < normalized1.length; i++) {
      const norm1 = normalized1[i]
      const norm2 = normalized2[i]

      if (!this.compareNormalizedRows(norm1, norm2)) {
        differences.push({
          index: i,
          row1: rows1[i] || ({} as TestRow),
          row2: rows2[i] || ({} as TestRow),
          normalized1: norm1,
          normalized2: norm2,
        })
      }
    }

    return {
      equal: differences.length === 0,
      differences: differences.length > 0 ? differences : undefined,
    }
  }

  /**
   * Compares two normalized rows
   */
  private compareNormalizedRows(
    a: Array<NormalizedValue>,
    b: Array<NormalizedValue>
  ): boolean {
    if (a.length !== b.length) {
      return false
    }

    for (let i = 0; i < a.length; i++) {
      if (!this.compareValues(a[i], b[i])) {
        return false
      }
    }

    return true
  }

  /**
   * Creates a human-readable diff of two row sets
   */
  createDiff(rows1: Array<TestRow>, rows2: Array<TestRow>): string {
    const comparison = this.compareRowSets(rows1, rows2)

    if (comparison.equal) {
      return `Row sets are identical`
    }

    let diff = `Row sets differ (${rows1.length} vs ${rows2.length} rows)\n\n`

    if (comparison.differences) {
      for (const diffItem of comparison.differences) {
        diff += `Difference at index ${diffItem.index}:\n`
        diff += `  TanStack: ${JSON.stringify(diffItem.row1)}\n`
        diff += `  SQLite:   ${JSON.stringify(diffItem.row2)}\n\n`
      }
    }

    return diff
  }
}

/**
 * Global normalizer instance with default configuration
 */
export const normalizer = new ValueNormalizer()

/**
 * Utility function to normalize a single value
 */
export function normalizeValue(value: TestValue): NormalizedValue {
  return normalizer.normalizeValue(value)
}

/**
 * Utility function to normalize a row
 */
export function normalizeRow(row: TestRow): Array<NormalizedValue> {
  return normalizer.normalizeRow(row)
}

/**
 * Utility function to compare two row sets
 */
export function compareRowSets(
  rows1: Array<TestRow>,
  rows2: Array<TestRow>
): {
  equal: boolean
  differences?: Array<{
    index: number
    row1: TestRow
    row2: TestRow
    normalized1: Array<NormalizedValue>
    normalized2: Array<NormalizedValue>
  }>
} {
  return normalizer.compareRowSets(rows1, rows2)
}
