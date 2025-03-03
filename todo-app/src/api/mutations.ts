import { db } from "../db/kysely"
import {
  validateInsertTodo,
  validateUpdateTodo,
  validateInsertConfig,
  validateUpdateConfig,
} from "../db/validation"
import { PendingMutation } from "../../../src/types"
import { sql } from "kysely"
import express from "express"

const router = express.Router()

/**
 * Get the table name from the relation metadata
 * @param relation - The relation array from syncMetadata
 * @returns The table name
 */
function getTableName(relation?: string[]): string {
  if (!relation || relation.length < 2) {
    throw new Error(`could not find the table name`)
  }

  // The table name is typically the second element in the relation array
  // e.g. ['public', 'todos'] -> 'todos'
  return relation[1]
}

/**
 * Build a where clause based on primary key columns
 * @param trx - The transaction object
 * @param tableName - The name of the table
 * @param primaryKey - Array of primary key column names
 * @param data - The data object containing primary key values
 * @returns A query builder with where clauses applied
 */
function buildWhereClause(
  query: unknown,
  primaryKey: string[],
  data: Record<string, unknown>
) {
  let whereQuery = query

  primaryKey.forEach((key, index) => {
    const value = data[key]
    if (value === undefined) {
      throw new Error(`Primary key column "${key}" not found in data`)
    }

    // First condition uses where, subsequent conditions use andWhere
    if (index === 0) {
      whereQuery = whereQuery.where(key, `=`, value)
    } else {
      whereQuery = whereQuery.andWhere(key, `=`, value)
    }
  })

  return whereQuery
}

/**
 * Process an array of PendingMutations, validate them, and write to the database
 */
router.post(`/api/mutations`, async (req, res) => {
  try {
    const pendingMutations: PendingMutation[] = req.body

    if (!Array.isArray(pendingMutations)) {
      return res.status(400).json({ error: `Expected an array of mutations` })
    }

    // Start a transaction
    const result = await db.transaction().execute(async (trx) => {
      // Get the transaction ID using sql template tag
      const txidResult = await trx
        .selectFrom(sql`(SELECT txid_current() as txid)`.as(`txid_query`))
        .select(`txid`)
        .executeTakeFirstOrThrow()

      // TODO handle 64-bit numbers
      const txid = Number(txidResult.txid)

      console.log(`mutations`, pendingMutations)
      // Process each mutation in order
      for (const mutation of pendingMutations) {
        // Get the table name from the relation metadata
        const tableName = getTableName(mutation.syncMetadata.relation)

        // Get the primary key columns from metadata
        const primaryKey = (mutation.syncMetadata.primaryKey || [
          `id`,
        ]) as string[]

        // Validate and process based on operation type
        switch (mutation.type) {
          case `insert`: {
            let insertData

            // Validate the data based on the table
            if (tableName === `config`) {
              insertData = validateInsertConfig(mutation.modified)
            } else {
              // Default to todos table
              insertData = validateInsertTodo(mutation.modified)
            }

            // Insert the data into the appropriate table
            await trx.insertInto(tableName).values(insertData).execute()
            break
          }

          case `update`: {
            let updateData

            // Validate the data based on the table
            if (tableName === `config`) {
              updateData = validateUpdateConfig(mutation.changes)
            } else {
              // Default to todos table
              updateData = validateUpdateTodo(mutation.changes)
            }

            // Build a query with where clauses for all primary key columns
            let query = trx.updateTable(tableName).set(updateData)
            query = buildWhereClause(query, primaryKey, mutation.original)

            // Execute the update
            await query.execute()
            break
          }

          case `delete`: {
            // Build a query with where clauses for all primary key columns
            let query = trx.deleteFrom(tableName)
            query = buildWhereClause(query, primaryKey, mutation.original)

            // Execute the delete
            await query.execute()
            break
          }

          default:
            throw new Error(`Unknown operation type: ${mutation.type}`)
        }
      }

      return txid
    })

    // Return the transaction ID to the caller
    return res.status(200).json({ txid: result })
  } catch (error) {
    console.error(`Error processing mutations:`, error)
    return res.status(500).json({
      error: `Failed to process mutations`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

export default router
