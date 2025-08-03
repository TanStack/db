import * as fc from "fast-check"
import type {
  ColumnDef,
  GeneratorConfig,
  TestRow,
  TestSchema,
  TestValue,
} from "../types"

/**
 * Generates rows for a specific table based on its schema
 */
export function generateRowsForTable(
  table: TestSchema[`tables`][0],
  config: GeneratorConfig = {}
): fc.Arbitrary<Array<TestRow>> {
  const { maxRowsPerTable = 2000 } = config

  return fc
    .array(generateRow(table.columns), {
      minLength: 1,
      maxLength: maxRowsPerTable,
    })
    .map((rows) => {
      // Ensure primary key uniqueness
      const uniqueRows: Array<TestRow> = []
      const seenKeys = new Set<TestValue>()

      for (const row of rows) {
        const key = row[table.primaryKey]
        if (!seenKeys.has(key)) {
          seenKeys.add(key)
          uniqueRows.push(row)
        }
      }

      return uniqueRows
    })
}

/**
 * Generates a single row for a table
 */
export function generateRow(columns: Array<ColumnDef>): fc.Arbitrary<TestRow> {
  const columnGenerators: Record<string, fc.Arbitrary<TestValue>> = {}

  for (const column of columns) {
    columnGenerators[column.name] = generateValueForType(
      column.type,
      column.isNullable
    )
  }

  return fc.record(columnGenerators)
}

/**
 * Generates a value for a specific type
 */
function generateValueForType(
  type: string,
  isNullable: boolean
): fc.Arbitrary<TestValue> {
  const baseGenerator = getBaseGeneratorForType(type)

  if (isNullable) {
    return fc.oneof(fc.constant(null), baseGenerator)
  }

  return baseGenerator
}

/**
 * Gets the base generator for a type
 */
function getBaseGeneratorForType(type: string): fc.Arbitrary<TestValue> {
  switch (type) {
    case `string`:
      return generateString()
    case `number`:
      return generateNumber()
    case `boolean`:
      return fc.boolean()
    case `null`:
      return fc.constant(null)
    case `object`:
      return generateObject()
    case `array`:
      return generateArray()
    default:
      return generateString() // Default to string instead of null
  }
}

/**
 * Generates a string value
 */
function generateString(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 1, maxLength: 20 })
    .map((str) => str.replace(/[^\x20-\x7E]/g, ``)) // ASCII-only
}

/**
 * Generates a number value
 */
function generateNumber(): fc.Arbitrary<number> {
  return fc.oneof(
    // Safe 53-bit integers
    fc.integer({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
    // Finite doubles
    fc.double({ min: -1e6, max: 1e6, noDefaultInfinity: true, noNaN: true })
  )
}

/**
 * Generates an object value
 */
function generateObject(): fc.Arbitrary<Record<string, TestValue>> {
  return fc
    .array(
      fc.tuple(
        fc.string({ minLength: 1, maxLength: 5 }),
        fc.oneof(
          generateString(),
          generateNumber(),
          fc.boolean(),
          fc.constant(null)
        )
      ),
      { minLength: 0, maxLength: 3 }
    )
    .map((pairs) => Object.fromEntries(pairs))
}

/**
 * Generates an array value
 */
function generateArray(): fc.Arbitrary<Array<TestValue>> {
  return fc.array(
    fc.oneof(
      generateString(),
      generateNumber(),
      fc.boolean(),
      fc.constant(null)
    ),
    { minLength: 0, maxLength: 5 }
  )
}

/**
 * Generates a unique key for a table
 */
export function generateUniqueKey(
  table: TestSchema[`tables`][0],
  existingKeys: Set<TestValue>
): fc.Arbitrary<TestValue> {
  const primaryKeyColumn = table.columns.find(
    (col) => col.name === table.primaryKey
  )!

  return generateValueForType(primaryKeyColumn.type, false).filter(
    (key) => !existingKeys.has(key)
  )
}

/**
 * Generates a row for update operations
 */
export function generateUpdateRow(
  table: TestSchema[`tables`][0],
  _existingRow: TestRow
): fc.Arbitrary<Partial<TestRow>> {
  const updateableColumns = table.columns.filter((col) => !col.isPrimaryKey)

  if (updateableColumns.length === 0) {
    return fc.constant({})
  }

  return fc
    .array(
      fc.tuple(
        fc.constantFrom(...updateableColumns.map((col) => col.name)),
        generateValueForType(`string`, true) // We'll override this below
      ),
      { minLength: 1, maxLength: updateableColumns.length }
    )
    .map((pairs) => {
      const updates: Partial<TestRow> = {}

      for (const [columnName, _] of pairs) {
        const column = table.columns.find((col) => col.name === columnName)!
        const _generator = generateValueForType(column.type, column.isNullable)

        // For now, we'll generate a simple value - in practice this would need
        // to be properly integrated with fast-check's arbitrary generation
        if (column.type === `string`) {
          updates[columnName] =
            `updated_${Math.random().toString(36).substring(7)}`
        } else if (column.type === `number`) {
          updates[columnName] = Math.floor(Math.random() * 1000)
        } else if (column.type === `boolean`) {
          updates[columnName] = Math.random() > 0.5
        } else {
          updates[columnName] = null
        }
      }

      return updates
    })
}

/**
 * Creates a TanStack collection from a table definition
 */
export function createCollectionFromTable(
  table: TestSchema[`tables`][0],
  initialRows: Array<TestRow> = []
): any {
  // This is a simplified version - in practice, you'd need to import
  // the actual TanStack DB collection creation logic
  return {
    name: table.name,
    primaryKey: table.primaryKey,
    rows: new Map(initialRows.map((row) => [row[table.primaryKey], row])),
    columns: table.columns,
  }
}
