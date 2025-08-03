import type { SQLiteTransaction, TestRow, TestSchema } from "../types"

/**
 * Mock SQLite Oracle for testing environments where native bindings aren't available
 * This provides the same interface as SQLiteOracle but uses in-memory JavaScript objects
 */
export class MockSQLiteOracle {
  private tables: Map<string, Map<string | number, TestRow>> = new Map()
  private transactions: Array<SQLiteTransaction> = []
  private savepointCounter = 0
  private snapshots: Map<string, Map<string, Map<string | number, TestRow>>> =
    new Map()

  constructor() {
    // No-op constructor
  }

  /**
   * Initializes the database with the given schema
   */
  initialize(schema: TestSchema): void {
    // Create empty tables
    for (const table of schema.tables) {
      this.tables.set(table.name, new Map())
    }
  }

  /**
   * Inserts data into a table
   */
  insert(tableName: string, data: TestRow): void {
    const table = this.tables.get(tableName)
    if (!table) {
      throw new Error(`Table ${tableName} not found`)
    }

    const tableDef = this.getTableDef(tableName)
    const key = data[tableDef.primaryKey]
    table.set(key, { ...data })
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
    const table = this.tables.get(tableName)
    if (!table) {
      throw new Error(`Table ${tableName} not found`)
    }

    const existingRow = table.get(keyValue)
    if (!existingRow) {
      throw new Error(
        `Row with key ${keyValue} not found in table ${tableName}`
      )
    }

    const updatedRow = { ...existingRow, ...changes }
    table.set(keyValue, updatedRow)
  }

  /**
   * Deletes data from a table
   */
  delete(tableName: string, keyColumn: string, keyValue: any): void {
    const table = this.tables.get(tableName)
    if (!table) {
      throw new Error(`Table ${tableName} not found`)
    }

    table.delete(keyValue)
  }

  /**
   * Begins a transaction (creates a savepoint)
   */
  beginTransaction(): string {
    const savepointId = `sp_${++this.savepointCounter}`

    // Create a snapshot of current state
    const snapshot = new Map()
    for (const [tableName, table] of this.tables) {
      snapshot.set(tableName, new Map(table))
    }
    this.snapshots.set(savepointId, snapshot)

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
    this.snapshots.delete(transaction.savepointId)
  }

  /**
   * Rollbacks a transaction (rolls back to the savepoint)
   */
  rollbackTransaction(): void {
    if (this.transactions.length === 0) {
      throw new Error(`No active transaction to rollback`)
    }

    const transaction = this.transactions.pop()!
    const snapshot = this.snapshots.get(transaction.savepointId)

    if (snapshot) {
      // Restore the snapshot
      this.tables.clear()
      for (const [tableName, tableSnapshot] of snapshot) {
        this.tables.set(tableName, new Map(tableSnapshot))
      }
      this.snapshots.delete(transaction.savepointId)
    }
  }

  /**
   * Executes a query and returns the results
   */
  query(sql: string, _params: Array<any> = []): Array<TestRow> {
    // Simple mock implementation - just return all rows from the first table
    // In a real implementation, this would parse SQL and execute it
    const tableName = this.extractTableNameFromSQL(sql)
    if (!tableName) {
      return []
    }

    const table = this.tables.get(tableName)
    if (!table) {
      return []
    }

    return Array.from(table.values())
  }

  /**
   * Gets the count of rows in a table
   */
  getRowCount(tableName: string): number {
    const table = this.tables.get(tableName)
    return table ? table.size : 0
  }

  /**
   * Gets all rows from a table
   */
  getAllRows(tableName: string): Array<TestRow> {
    const table = this.tables.get(tableName)
    return table ? Array.from(table.values()) : []
  }

  /**
   * Gets a specific row by key
   */
  getRow(tableName: string, keyColumn: string, keyValue: any): TestRow | null {
    const table = this.tables.get(tableName)
    if (!table) {
      return null
    }

    return table.get(keyValue) || null
  }

  /**
   * Checks if a row exists
   */
  rowExists(tableName: string, keyColumn: string, keyValue: any): boolean {
    const table = this.tables.get(tableName)
    return table ? table.has(keyValue) : false
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
    this.tables.clear()
    this.transactions = []
  }

  /**
   * Gets database statistics for debugging
   */
  getStats(): {
    tableCount: number
    totalRows: number
    transactionDepth: number
  } {
    let totalRows = 0
    for (const table of this.tables.values()) {
      totalRows += table.size
    }

    return {
      tableCount: this.tables.size,
      totalRows,
      transactionDepth: this.transactions.length,
    }
  }

  /**
   * Helper method to get table definition
   */
  private getTableDef(_tableName: string): { primaryKey: string } {
    // Mock implementation - in real usage, this would come from schema
    return { primaryKey: `id` }
  }

  /**
   * Helper method to extract table name from SQL
   */
  private extractTableNameFromSQL(sql: string): string | null {
    // Simple regex to extract table name from SELECT ... FROM table
    const match = sql.match(/FROM\s+["`]?(\w+)["`]?/i)
    return match ? match[1] : null
  }
}

/**
 * Creates a temporary mock database for testing
 */
export function createMockDatabase(): MockSQLiteOracle {
  return new MockSQLiteOracle()
}

/**
 * Creates a mock database with a specific schema and initial data
 */
export function createMockDatabaseWithData(
  schema: TestSchema,
  initialData: Record<string, Array<TestRow>> = {}
): MockSQLiteOracle {
  const oracle = createMockDatabase()
  oracle.initialize(schema)

  // Insert initial data
  for (const [tableName, rows] of Object.entries(initialData)) {
    for (const row of rows) {
      oracle.insert(tableName, row)
    }
  }

  return oracle
}
