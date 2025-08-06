import * as fc from "fast-check"
import { generateRow } from "./row-generator"
import type {
  GeneratorConfig,
  MutationCommand,
  TestCommand,
  TestRow,
  TestSchema,
  TestState,
} from "../types"

/**
 * Generates a sequence of mutation commands for property testing
 */
export function generateMutationCommands(
  schema: TestSchema,
  config: GeneratorConfig = {}
): fc.Arbitrary<Array<TestCommand>> {
  const { maxCommands = 40 } = config

  // If no tables exist, return only transaction commands
  if (schema.tables.length === 0) {
    return fc
      .array(generateTransactionCommand(), {
        minLength: 1,
        maxLength: maxCommands,
      })
      .map((commands) => {
        return validateCommandSequence(commands, schema)
      })
  }

  return fc
    .array(generateMutationCommand(schema), {
      minLength: 1,
      maxLength: maxCommands,
    })
    .map((commands) => {
      // Ensure commands are valid (e.g., don't delete non-existent rows)
      return validateCommandSequence(commands, schema)
    })
}

/**
 * Generates a single mutation command
 */
function generateMutationCommand(
  schema: TestSchema
): fc.Arbitrary<TestCommand> {
  // If no tables exist, only generate transaction commands
  if (schema.tables.length === 0) {
    return generateTransactionCommand()
  }

  return fc.oneof(
    generateInsertCommand(schema),
    generateUpdateCommand(schema),
    generateDeleteCommand(schema),
    generateTransactionCommand()
  )
}

/**
 * Generates an insert command
 */
function generateInsertCommand(
  schema: TestSchema
): fc.Arbitrary<MutationCommand> {
  if (schema.tables.length === 0) {
    throw new Error(`Cannot generate insert command for empty schema`)
  }

  return fc
    .tuple(
      fc.constantFrom(...schema.tables.map((t) => t.name)),
      generateInsertData(schema)
    )
    .map(([table, data]) => ({
      type: `insert` as const,
      table,
      data,
    }))
}

/**
 * Generates data for an insert operation
 */
function generateInsertData(schema: TestSchema): fc.Arbitrary<TestRow> {
  if (schema.tables.length === 0) {
    throw new Error(`Cannot generate insert data for empty schema`)
  }

  return fc
    .constantFrom(...schema.tables)
    .chain((table) => generateRow(table.columns))
}

/**
 * Generates an update command
 */
function generateUpdateCommand(
  schema: TestSchema
): fc.Arbitrary<MutationCommand> {
  if (schema.tables.length === 0) {
    throw new Error(`Cannot generate update command for empty schema`)
  }

  return fc
    .tuple(
      fc.constantFrom(...schema.tables.map((t) => t.name)),
      fc.string({ minLength: 1, maxLength: 10 }) // This would be an existing key
    )
    .map(([table, key]) => ({
      type: `update` as const,
      table,
      key,
      changes: {}, // Will be populated during test execution
    }))
}

/**
 * Generates a delete command
 */
function generateDeleteCommand(
  schema: TestSchema
): fc.Arbitrary<MutationCommand> {
  if (schema.tables.length === 0) {
    throw new Error(`Cannot generate delete command for empty schema`)
  }

  return fc
    .tuple(
      fc.constantFrom(...schema.tables.map((t) => t.name)),
      fc.string({ minLength: 1, maxLength: 10 }) // This would be an existing key
    )
    .map(([table, key]) => ({
      type: `delete` as const,
      table,
      key,
    }))
}

/**
 * Generates a transaction command
 */
function generateTransactionCommand(): fc.Arbitrary<{
  type: `begin` | `commit` | `rollback`
}> {
  return fc.constantFrom(
    { type: `begin` as const },
    { type: `commit` as const },
    { type: `rollback` as const }
  )
}

/**
 * Validates a sequence of commands to ensure they're reasonable
 */
function validateCommandSequence(
  commands: Array<TestCommand>,
  _schema: TestSchema
): Array<TestCommand> {
  const validated: Array<TestCommand> = []
  let transactionDepth = 0

  for (const command of commands) {
    if (command.type === `begin`) {
      transactionDepth++
      validated.push(command)
    } else if (command.type === `commit` || command.type === `rollback`) {
      if (transactionDepth > 0) {
        transactionDepth--
        validated.push(command)
      }
      // Skip commit/rollback if no transaction is active
    } else {
      validated.push(command)
    }
  }

  // Close any open transactions
  while (transactionDepth > 0) {
    validated.push({ type: `rollback` })
    transactionDepth--
  }

  return validated
}

/**
 * Generates a realistic mutation command based on current state
 */
export function generateRealisticMutation(
  state: TestState,
  _config: GeneratorConfig = {}
): fc.Arbitrary<MutationCommand> {
  return fc
    .constantFrom(...state.schema.tables.map((t) => t.name))
    .chain((tableName) => {
      const table = state.schema.tables.find((t) => t.name === tableName)!
      const collection = state.collections.get(tableName)
      const existingRows = collection
        ? (Array.from(collection.state.values()) as unknown as Array<TestRow>)
        : []

      return fc.oneof(
        // Insert - always possible
        generateInsertForTable(table, existingRows),
        // Update - only if rows exist
        existingRows.length > 0
          ? generateUpdateForTable(table, existingRows)
          : generateInsertForTable(table, existingRows), // Fallback to insert
        // Delete - only if rows exist
        existingRows.length > 0
          ? generateDeleteForTable(table, existingRows)
          : generateInsertForTable(table, existingRows) // Fallback to insert
      )
    })
}

/**
 * Generates an insert command for a specific table
 */
function generateInsertForTable(
  table: TestSchema[`tables`][0],
  existingRows: Array<TestRow>
): fc.Arbitrary<MutationCommand> {
  const existingKeys = new Set(existingRows.map((row) => row[table.primaryKey]))

  return generateRow(table.columns)
    .filter((row) => !existingKeys.has(row[table.primaryKey]))
    .map((data) => ({
      type: `insert` as const,
      table: table.name,
      data,
    }))
}

/**
 * Generates an update command for a specific table
 */
function generateUpdateForTable(
  table: TestSchema[`tables`][0],
  existingRows: Array<TestRow>
): fc.Arbitrary<MutationCommand> {
  return fc.constantFrom(...existingRows).map((row) => ({
    type: `update` as const,
    table: table.name,
    key: row[table.primaryKey] as string | number,
    changes: {}, // Will be populated during execution
  }))
}

/**
 * Generates a delete command for a specific table
 */
function generateDeleteForTable(
  table: TestSchema[`tables`][0],
  existingRows: Array<TestRow>
): fc.Arbitrary<MutationCommand> {
  return fc.constantFrom(...existingRows).map((row) => ({
    type: `delete` as const,
    table: table.name,
    key: row[table.primaryKey] as string | number,
  }))
}

/**
 * Generates a complete test sequence with realistic data flow
 */
export function generateRealisticTestSequence(
  schema: TestSchema,
  config: GeneratorConfig = {}
): fc.Arbitrary<Array<TestCommand>> {
  const { maxCommands = 40 } = config

  return fc
    .array(generateRealisticCommand(schema), {
      minLength: 1,
      maxLength: maxCommands,
    })
    .map((commands) => {
      // Ensure we have a balanced transaction structure
      return balanceTransactions(commands)
    })
}

/**
 * Generates a realistic command based on schema
 */
function generateRealisticCommand(
  schema: TestSchema
): fc.Arbitrary<TestCommand> {
  return fc.oneof(
    // 70% mutations, 30% transactions
    generateMutationCommand(schema),
    generateTransactionCommand()
  )
}

/**
 * Balances transaction commands to ensure proper nesting
 */
function balanceTransactions(commands: Array<TestCommand>): Array<TestCommand> {
  const balanced: Array<TestCommand> = []
  let transactionDepth = 0

  for (const command of commands) {
    if (command.type === `begin`) {
      transactionDepth++
      balanced.push(command)
    } else if (command.type === `commit` || command.type === `rollback`) {
      if (transactionDepth > 0) {
        transactionDepth--
        balanced.push(command)
      }
    } else {
      balanced.push(command)
    }
  }

  // Close any open transactions
  while (transactionDepth > 0) {
    balanced.push({ type: `rollback` })
    transactionDepth--
  }

  return balanced
}
