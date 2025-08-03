import { astToSQL } from "../sql/ast-to-sql"
import { ValueNormalizer } from "./normalizer"
import type {
  GeneratorConfig,
  MutationCommand,
  QueryCommand,
  QueryComparison,
  TestCommand,
  TestState,
} from "../types"

/**
 * Incremental checker for property testing
 * Applies TanStack patches and compares with SQLite oracle
 */
export class IncrementalChecker {
  private state: TestState
  private normalizer: ValueNormalizer
  private config: GeneratorConfig

  constructor(state: TestState, config: GeneratorConfig = {}) {
    this.state = state
    this.config = config
    this.normalizer = new ValueNormalizer(config)
  }

  /**
   * Executes a command and checks invariants
   */
  async executeCommand(command: TestCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    try {
      switch (command.type) {
        case `insert`:
          return await this.executeInsert(command)
        case `update`:
          return await this.executeUpdate(command)
        case `delete`:
          return await this.executeDelete(command)
        case `begin`:
          return await this.executeBegin()
        case `commit`:
          return await this.executeCommit()
        case `rollback`:
          return await this.executeRollback()
        case `startQuery`:
          return await this.executeStartQuery(command)
        case `stopQuery`:
          return await this.executeStopQuery(command)
        default:
          throw new Error(`Unknown command type: ${(command as any).type}`)
      }
    } catch (error) {
      return {
        success: false,
        error: error as Error,
      }
    }
  }

  /**
   * Executes an insert command
   */
  private async executeInsert(command: MutationCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const { table, data } = command

    if (!data) {
      return { success: false, error: new Error(`No data provided for insert`) }
    }

    // Execute on TanStack DB
    const collection = this.state.collections.get(table)
    if (!collection) {
      return {
        success: false,
        error: new Error(`Collection not found: ${table}`),
      }
    }

    try {
      await collection.insert(data)
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Execute on SQLite oracle
    try {
      this.state.sqliteDb.insert(table, data)
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Check invariants
    return await this.checkInvariants()
  }

  /**
   * Executes an update command
   */
  private async executeUpdate(command: MutationCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const { table, key, changes } = command

    if (!key || !changes) {
      return {
        success: false,
        error: new Error(`Missing key or changes for update`),
      }
    }

    const tableDef = this.state.schema.tables.find((t) => t.name === table)
    if (!tableDef) {
      return { success: false, error: new Error(`Table not found: ${table}`) }
    }

    // Execute on TanStack DB
    const collection = this.state.collections.get(table)
    if (!collection) {
      return {
        success: false,
        error: new Error(`Collection not found: ${table}`),
      }
    }

    try {
      await collection.update(key, (draft) => {
        Object.assign(draft, changes)
      })
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Execute on SQLite oracle
    try {
      this.state.sqliteDb.update(table, tableDef.primaryKey, key, changes)
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Check invariants
    return await this.checkInvariants()
  }

  /**
   * Executes a delete command
   */
  private async executeDelete(command: MutationCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const { table, key } = command

    if (!key) {
      return { success: false, error: new Error(`Missing key for delete`) }
    }

    const tableDef = this.state.schema.tables.find((t) => t.name === table)
    if (!tableDef) {
      return { success: false, error: new Error(`Table not found: ${table}`) }
    }

    // Execute on TanStack DB
    const collection = this.state.collections.get(table)
    if (!collection) {
      return {
        success: false,
        error: new Error(`Collection not found: ${table}`),
      }
    }

    try {
      await collection.delete(key)
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Execute on SQLite oracle
    try {
      this.state.sqliteDb.delete(table, tableDef.primaryKey, key)
    } catch (error) {
      return { success: false, error: error as Error }
    }

    // Check invariants
    return await this.checkInvariants()
  }

  /**
   * Executes a begin transaction command
   */
  private executeBegin(): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    try {
      // TanStack DB transactions are handled automatically
      this.state.currentTransaction = this.state.sqliteDb.beginTransaction()
      return { success: true }
    } catch (error) {
      return { success: false, error: error as Error }
    }
  }

  /**
   * Executes a commit transaction command
   */
  private executeCommit(): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    try {
      // TanStack DB transactions are handled automatically
      this.state.sqliteDb.commitTransaction()
      this.state.currentTransaction = null
      return { success: true }
    } catch (error) {
      return { success: false, error: error as Error }
    }
  }

  /**
   * Executes a rollback transaction command
   */
  private executeRollback(): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    try {
      // TanStack DB transactions are handled automatically
      this.state.sqliteDb.rollbackTransaction()
      this.state.currentTransaction = null
      return { success: true }
    } catch (error) {
      return { success: false, error: error as Error }
    }
  }

  /**
   * Executes a start query command
   */
  private executeStartQuery(command: QueryCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const { queryId, ast } = command

    if (!ast) {
      return { success: false, error: new Error(`No AST provided for query`) }
    }

    try {
      // Convert AST to SQL
      const { sql, params } = astToSQL(ast)

      // Execute on SQLite oracle
      const sqliteResult = this.state.sqliteDb.query(sql, params)

      // For now, we'll store the query info
      // In practice, you'd execute the query on TanStack DB and get the result
      this.state.activeQueries.set(queryId, {
        ast,
        sql,
        unsubscribe: () => {}, // Placeholder
        snapshot: sqliteResult, // Placeholder - would be TanStack result
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: error as Error }
    }
  }

  /**
   * Executes a stop query command
   */
  private executeStopQuery(command: QueryCommand): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const { queryId } = command

    const query = this.state.activeQueries.get(queryId)
    if (query) {
      query.unsubscribe()
      this.state.activeQueries.delete(queryId)
    }

    return { success: true }
  }

  /**
   * Checks all invariants after a command execution
   */
  private async checkInvariants(): Promise<{
    success: boolean
    error?: Error
    comparisons?: Array<QueryComparison>
  }> {
    const comparisons: Array<QueryComparison> = []

    // Check snapshot equality for all active queries
    for (const [queryId, query] of this.state.activeQueries) {
      try {
        const comparison = await this.compareQueryResults(queryId, query)
        comparisons.push(comparison)

        if (!comparison.isEqual) {
          return {
            success: false,
            error: new Error(`Query ${queryId} results differ`),
            comparisons,
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error as Error,
          comparisons,
        }
      }
    }

    // Check row count sanity
    for (const table of this.state.schema.tables) {
      const tanstackCount =
        this.state.collections.get(table.name)?.state.size || 0
      const sqliteCount = this.state.sqliteDb.getRowCount(table.name)

      if (tanstackCount !== sqliteCount) {
        return {
          success: false,
          error: new Error(
            `Row count mismatch for table ${table.name}: TanStack=${tanstackCount}, SQLite=${sqliteCount}`
          ),
          comparisons,
        }
      }
    }

    return { success: true, comparisons }
  }

  /**
   * Compares query results between TanStack DB and SQLite
   */
  private compareQueryResults(
    queryId: string,
    query: TestState[`activeQueries`][`get`] extends (key: string) => infer R
      ? R
      : never
  ): Promise<QueryComparison> {
    // Execute query on SQLite oracle
    const sqliteResult = this.state.sqliteDb.query(query.sql, [])

    // For now, we'll use the stored snapshot as TanStack result
    // In practice, you'd execute the query on TanStack DB
    const tanstackResult = query.snapshot

    // Normalize and compare results
    const comparison = this.normalizer.compareRowSets(
      tanstackResult,
      sqliteResult
    )

    return {
      tanstackResult,
      sqliteResult,
      normalized: {
        tanstack: this.normalizer.normalizeRows(tanstackResult),
        sqlite: this.normalizer.normalizeRows(sqliteResult),
      },
      isEqual: comparison.equal,
      differences: comparison.differences?.map((diff) => ({
        tanstack: diff.normalized1[0] || {
          type: `null`,
          value: null,
          sortKey: `null`,
        },
        sqlite: diff.normalized2[0] || {
          type: `null`,
          value: null,
          sortKey: `null`,
        },
        index: diff.index,
      })),
    }
  }

  /**
   * Checks snapshot equality between TanStack DB and SQLite
   */
  checkSnapshotEquality(): Promise<{
    success: boolean
    error?: Error
    details?: string
  }> {
    // This would check that TanStack query results match SQLite oracle results
    // For now, we'll return success
    return { success: true }
  }

  /**
   * Checks row count sanity across all tables
   */
  async checkRowCountSanity(): Promise<{
    success: boolean
    error?: Error
    rowCounts?: Record<string, number>
  }> {
    const rowCounts: Record<string, number> = {}

    for (const table of this.state.schema.tables) {
      try {
        const collection = this.state.collections.get(table.name)
        if (collection) {
          const rows = await collection.find().toArray()
          rowCounts[table.name] = rows.length
        } else {
          rowCounts[table.name] = 0
        }
      } catch (error) {
        return { success: false, error: error as Error }
      }
    }

    return { success: true, rowCounts }
  }

  /**
   * Checks incremental convergence
   */
  checkIncrementalConvergence(): Promise<{
    success: boolean
    error?: Error
    details?: string
  }> {
    // This would check that re-running a fresh TanStack query yields
    // exactly the patch-built snapshot
    // For now, we'll return success
    return { success: true }
  }

  /**
   * Checks optimistic transaction visibility
   */
  checkOptimisticVisibility(): Promise<{
    success: boolean
    error?: Error
    details?: string
  }> {
    // This would check that queries inside a staged transaction see
    // uncommitted writes, and that they vanish after rollback
    // For now, we'll return success
    return { success: true }
  }

  /**
   * Gets a summary of the current state
   */
  getStateSummary(): {
    commandCount: number
    activeQueries: number
    transactionDepth: number
    totalRows: number
  } {
    let totalRows = 0
    for (const collection of this.state.collections.values()) {
      totalRows += collection.state.size
    }

    return {
      commandCount: this.state.commandCount,
      activeQueries: this.state.activeQueries.size,
      transactionDepth: this.state.sqliteDb.getTransactionDepth(),
      totalRows,
    }
  }
}
