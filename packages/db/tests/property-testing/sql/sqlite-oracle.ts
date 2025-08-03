import Database from "better-sqlite3"
import { createSQLiteSchema } from "../generators/schema-generator"
import {
  createDeleteStatement,
  createInsertStatement,
  createUpdateStatement,
} from "./ast-to-sql"
import type { SQLiteTransaction, TestRow, TestSchema } from "../types"

/**
 * SQLite Oracle for property testing
 * Mirrors TanStack DB's visibility rules using savepoints
 */
export class SQLiteOracle {
  private db: Database.Database
  private transactions: Array<SQLiteTransaction> = []
  private savepointCounter = 0

  constructor(dbPath: string = `:memory:`) {
    this.db = new Database(dbPath)
    this.db.pragma(`foreign_keys = ON`)
  }

  /**
   * Initializes the database with the given schema
   */
  initialize(schema: TestSchema): void {
    const ddlStatements = createSQLiteSchema(schema)

    for (const statement of ddlStatements) {
      this.db.exec(statement)
    }
  }

  /**
   * Inserts data into a table
   */
  insert(tableName: string, data: TestRow): void {
    const { sql, params } = createInsertStatement(tableName, data)
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * Updates data in a table
   */
  update(
    tableName: string,
    keyColumn: string,
    keyValue: any,
    changes: Partial<TestRow>
  ): void {
    const { sql, params } = createUpdateStatement(
      tableName,
      keyColumn,
      keyValue,
      changes
    )
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * Deletes data from a table
   */
  delete(tableName: string, keyColumn: string, keyValue: any): void {
    const { sql, params } = createDeleteStatement(
      tableName,
      keyColumn,
      keyValue
    )
    const stmt = this.db.prepare(sql)
    stmt.run(...params)
  }

  /**
   * Begins a transaction (creates a savepoint)
   */
  beginTransaction(): string {
    const savepointId = `sp_${++this.savepointCounter}`
    this.db.exec(`SAVEPOINT ${savepointId}`)

    this.transactions.push({
      savepointId,
      isActive: true,
    })

    return savepointId
  }

  /**
   * Commits a transaction (releases the savepoint)
   */
  commitTransaction(): void {
    if (this.transactions.length === 0) {
      throw new Error(`No active transaction to commit`)
    }

    const transaction = this.transactions.pop()!
    this.db.exec(`RELEASE SAVEPOINT ${transaction.savepointId}`)
  }

  /**
   * Rollbacks a transaction (rolls back to the savepoint)
   */
  rollbackTransaction(): void {
    if (this.transactions.length === 0) {
      throw new Error(`No active transaction to rollback`)
    }

    const transaction = this.transactions.pop()!
    this.db.exec(`ROLLBACK TO SAVEPOINT ${transaction.savepointId}`)
  }

  /**
   * Executes a query and returns the results
   */
  query(sql: string, params: Array<any> = []): Array<TestRow> {
    const stmt = this.db.prepare(sql)
    const results = stmt.all(...params)

    // Convert SQLite results to TestRow format
    return results.map((row) => {
      const convertedRow: TestRow = {}
      for (const [key, value] of Object.entries(
        row as Record<string, unknown>
      )) {
        convertedRow[key] = convertSQLiteValue(value)
      }
      return convertedRow
    })
  }

  /**
   * Gets the count of rows in a table
   */
  getRowCount(tableName: string): number {
    const sql = `SELECT COUNT(*) as count FROM "${tableName}"`
    const result = this.query(sql)[0]
    return result ? Number(result.count) : 0
  }

  /**
   * Gets all rows from a table
   */
  getAllRows(tableName: string): Array<TestRow> {
    const sql = `SELECT * FROM "${tableName}"`
    return this.query(sql)
  }

  /**
   * Gets a specific row by key
   */
  getRow(tableName: string, keyColumn: string, keyValue: any): TestRow | null {
    const sql = `SELECT * FROM "${tableName}" WHERE "${keyColumn}" = ?`
    const results = this.query(sql, [keyValue])
    return results.length > 0 ? results[0]! : null
  }

  /**
   * Checks if a row exists
   */
  rowExists(tableName: string, keyColumn: string, keyValue: any): boolean {
    const sql = `SELECT 1 FROM "${tableName}" WHERE "${keyColumn}" = ? LIMIT 1`
    const results = this.query(sql, [keyValue])
    return results.length > 0
  }

  /**
   * Gets the current transaction depth
   */
  getTransactionDepth(): number {
    return this.transactions.length
  }

  /**
   * Checks if there's an active transaction
   */
  hasActiveTransaction(): boolean {
    return this.transactions.length > 0
  }

  /**
   * Closes the database connection
   */
  close(): void {
    this.db.close()
  }

  /**
   * Gets database statistics for debugging
   */
  getStats(): {
    tableCount: number
    totalRows: number
    transactionDepth: number
  } {
    const tables = this.query(
      `SELECT name FROM sqlite_master WHERE type='table'`
    )
    let totalRows = 0

    for (const table of tables) {
      // @ts-expect-error - Type mismatch in getRowCount parameter
      const count = this.getRowCount(table.name!)
      totalRows += count
    }

    return {
      tableCount: tables.length,
      totalRows,
      transactionDepth: this.transactions.length,
    }
  }
}

/**
 * Converts SQLite values to JavaScript values
 */
function convertSQLiteValue(value: any): any {
  if (value === null || value === undefined) {
    return null
  }

  // Handle boolean values (SQLite stores them as integers)
  if (typeof value === `number` && (value === 0 || value === 1)) {
    // This is a heuristic - in practice, you'd need to know the column type
    return value === 1
  }

  // Handle JSON strings
  if (
    typeof value === `string` &&
    (value.startsWith(`{`) || value.startsWith(`[`))
  ) {
    try {
      return JSON.parse(value)
    } catch {
      // Not valid JSON, return as string
      return value
    }
  }

  return value
}

/**
 * Converts JavaScript values to SQLite-compatible values
 */
export function convertToSQLiteValue(value: any): string {
  if (value === null || value === undefined) {
    return `NULL`
  }

  if (typeof value === `boolean`) {
    return value ? `1` : `0`
  }

  if (typeof value === `object` || Array.isArray(value)) {
    return JSON.stringify(value)
  }

  return String(value)
}

/**
 * Creates a temporary SQLite database for testing
 */
export function createTempDatabase(): SQLiteOracle {
  return new SQLiteOracle(`:memory:`)
}

/**
 * Creates a SQLite database with a specific schema and initial data
 */
export function createDatabaseWithData(
  schema: TestSchema,
  initialData: Record<string, Array<TestRow>> = {}
): SQLiteOracle {
  const oracle = createTempDatabase()
  oracle.initialize(schema)

  // Insert initial data
  for (const [tableName, rows] of Object.entries(initialData)) {
    for (const row of rows) {
      oracle.insert(tableName, row)
    }
  }

  return oracle
}

/**
 * Compares two SQLite databases for equality
 */
export function compareDatabases(
  db1: SQLiteOracle,
  db2: SQLiteOracle,
  schema: TestSchema
): { equal: boolean; differences: Array<string> } {
  const differences: Array<string> = []

  for (const table of schema.tables) {
    const rows1 = db1.getAllRows(table.name)
    const rows2 = db2.getAllRows(table.name)

    if (rows1.length !== rows2.length) {
      differences.push(
        `Table ${table.name}: row count mismatch (${rows1.length} vs ${rows2.length})`
      )
      continue
    }

    // Sort rows by primary key for comparison
    const sortedRows1 = rows1.sort((a, b) =>
      String(a[table.primaryKey]).localeCompare(String(b[table.primaryKey]))
    )
    const sortedRows2 = rows2.sort((a, b) =>
      String(a[table.primaryKey]).localeCompare(String(b[table.primaryKey]))
    )

    for (let i = 0; i < sortedRows1.length; i++) {
      const row1 = sortedRows1[i]
      const row2 = sortedRows2[i]

      if (JSON.stringify(row1) !== JSON.stringify(row2)) {
        differences.push(`Table ${table.name}: row ${i} mismatch`)
        break
      }
    }
  }

  return {
    equal: differences.length === 0,
    differences,
  }
}
