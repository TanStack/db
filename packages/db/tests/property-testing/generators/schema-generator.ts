import * as fc from "fast-check"
import type {
  ColumnDef,
  GeneratorConfig,
  SupportedType,
  TableDef,
  TestSchema,
} from "../types"

/**
 * Generates a random schema for property testing
 */
export function generateSchema(
  config: GeneratorConfig = {}
): fc.Arbitrary<TestSchema> {
  const { maxTables = 4, maxColumns = 8 } = config

  return fc
    .array(generateTable(maxColumns), { minLength: 1, maxLength: maxTables })
    .map((tables) => {
      const joinHints = generateJoinHints(tables)
      return { tables, joinHints }
    })
}

/**
 * Generates a single table definition
 */
function generateTable(maxColumns: number): fc.Arbitrary<TableDef> {
  return fc
    .tuple(generateTableName(), generateColumns(maxColumns))
    .map(([name, columns]) => {
      // Ensure exactly one primary key column
      const primaryKeyColumns = columns.filter((col) => col.isPrimaryKey)
      if (primaryKeyColumns.length === 0) {
        // No primary key found, set the first column as primary key
        columns[0]!.isPrimaryKey = true
      } else if (primaryKeyColumns.length > 1) {
        // Multiple primary keys found, keep only the first one
        for (let i = 0; i < columns.length; i++) {
          columns[i]!.isPrimaryKey = i === 0
        }
      }

      const primaryKeyColumn = columns.find((col) => col.isPrimaryKey)
      if (!primaryKeyColumn) {
        throw new Error(`No primary key column found after ensuring one exists`)
      }

      return {
        name,
        columns,
        primaryKey: primaryKeyColumn.name,
      }
    })
}

/**
 * Generates a table name
 */
function generateTableName(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 3, maxLength: 10 })
    .map((name) => `table_${name.toLowerCase().replace(/[^a-z0-9]/g, ``)}`)
    .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) // Ensure valid SQLite identifier
}

/**
 * Generates columns for a table
 */
function generateColumns(maxColumns: number): fc.Arbitrary<Array<ColumnDef>> {
  return fc
    .array(generateColumn(), { minLength: 2, maxLength: maxColumns })
    .map((columns) => {
      // Ensure column names are unique
      const uniqueColumns: Array<ColumnDef> = []
      const seenNames = new Set<string>()

      for (const column of columns) {
        let name = column.name
        let counter = 1
        while (seenNames.has(name)) {
          name = `${column.name}_${counter}`
          counter++
        }
        seenNames.add(name)
        uniqueColumns.push({ ...column, name })
      }

      return uniqueColumns
    })
}

/**
 * Generates a single column definition
 */
function generateColumn(): fc.Arbitrary<ColumnDef> {
  return fc
    .tuple(
      generateColumnName(),
      generateColumnType(),
      fc.boolean(),
      fc.boolean(),
      fc.boolean()
    )
    .map(([name, type, isPrimaryKey, isNullable, isJoinable]) => ({
      name,
      type: type as SupportedType,
      isPrimaryKey,
      isNullable,
      isJoinable: isJoinable && (type === `string` || type === `number`),
    }))
}

/**
 * Generates a column name
 */
function generateColumnName(): fc.Arbitrary<string> {
  return fc
    .string({ minLength: 2, maxLength: 8 })
    .map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, ``))
    .filter((name) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) // Ensure valid SQLite identifier
}

/**
 * Generates a column type
 */
function generateColumnType(): fc.Arbitrary<string> {
  return fc.constantFrom(`string`, `number`, `boolean`, `object`, `array`)
}

/**
 * Generates join hints between tables
 */
function generateJoinHints(tables: Array<TableDef>): TestSchema[`joinHints`] {
  const hints: TestSchema[`joinHints`] = []

  for (let i = 0; i < tables.length; i++) {
    for (let j = i + 1; j < tables.length; j++) {
      const table1 = tables[i]
      const table2 = tables[j]

      // Find joinable columns with matching types
      const joinableColumns1 = table1!.columns.filter((col) => col.isJoinable)
      const joinableColumns2 = table2!.columns.filter((col) => col.isJoinable)

      for (const col1 of joinableColumns1) {
        for (const col2 of joinableColumns2) {
          if (col1.type === col2.type) {
            hints.push({
              table1: table1!.name,
              column1: col1.name,
              table2: table2!.name,
              column2: col2.name,
            })
          }
        }
      }
    }
  }

  return hints
}

/**
 * Creates SQLite DDL for a schema
 */
export function createSQLiteSchema(schema: TestSchema): Array<string> {
  const statements: Array<string> = []

  for (const table of schema.tables) {
    const columns = table.columns
      .map((col) => {
        const sqlType = getSQLiteType(col.type)
        const nullable = col.isNullable ? `` : ` NOT NULL`
        const primaryKey = col.isPrimaryKey ? ` PRIMARY KEY` : ``
        return `${col.name} ${sqlType}${nullable}${primaryKey}`
      })
      .join(`, `)

    statements.push(`CREATE TABLE ${table.name} (${columns})`)
  }

  return statements
}

/**
 * Maps TanStack types to SQLite types
 */
function getSQLiteType(type: string): string {
  switch (type) {
    case `string`:
      return `TEXT`
    case `number`:
      return `REAL`
    case `boolean`:
      return `INTEGER`
    case `null`:
      return `TEXT`
    case `object`:
    case `array`:
      return `TEXT`
    default:
      return `TEXT`
  }
}
