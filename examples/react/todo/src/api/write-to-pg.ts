import type postgres from "postgres"
import type { PendingMutation } from "@tanstack/react-db"

/**
 * Get the table name from the relation metadata
 */
function getTableName(relation?: Array<string>): string {
  if (!relation || relation.length < 2) {
    throw new Error(`could not find the table name`)
  }

  // The table name is typically the second element in the relation array
  // e.g. ['public', 'todos'] -> 'todos'
  return relation[1]!
}

/**
 * Process an array of PendingMutations and write to the database
 */
export async function processMutations(
  sql: postgres.Sql<Record<string, unknown>>,
  pendingMutations: Array<PendingMutation>
): Promise<number> {
  return await sql.begin(async (tx) => {
    // Get the transaction ID
    const result = await tx`SELECT txid_current() as txid`
    const txid = result[0]?.txid

    if (txid === undefined) {
      throw new Error(`Failed to get transaction ID`)
    }

    // Process each mutation in order
    for (const mutation of pendingMutations) {
      // Get the table name from the relation metadata
      const tableName = getTableName(
        mutation.syncMetadata.relation as Array<string> | undefined
      )

      // Get the primary key columns from metadata
      const primaryKey = (mutation.syncMetadata.primaryKey as
        | Array<string>
        | undefined) || [`id`]

      // Process based on operation type
      switch (mutation.type) {
        case `insert`: {
          const columns = Object.keys(mutation.modified)
          const values = Object.values(mutation.modified)
          const placeholders = values.map((_, i) => `$${i + 1}`).join(`, `)

          await tx.unsafe(
            `INSERT INTO ${tableName} (${columns.join(`, `)}) VALUES (${placeholders})`,
            values
          )
          break
        }

        case `update`: {
          // Build SET clause
          const setColumns = Object.keys(mutation.changes)
          const setValues = Object.values(mutation.changes)
          const setClause = setColumns
            .map((col, i) => `${col} = $${i + 1}`)
            .join(`, `)

          // Build WHERE clause for primary key columns starting after SET values
          const whereClause = primaryKey
            .map((column, i) => `${column} = $${i + setValues.length + 1}`)
            .join(` AND `)

          // Combine all values
          const allValues = [
            ...setValues,
            ...primaryKey.map(
              (k) => (mutation.original as Record<string, unknown>)[k]
            ),
          ]

          await tx.unsafe(
            `UPDATE ${tableName}
             SET ${setClause}
             WHERE ${whereClause}`,
            allValues
          )
          break
        }

        case `delete`: {
          // Build WHERE clause for primary key columns
          const whereClause = primaryKey
            .map((column, i) => `${column} = $${i + 1}`)
            .join(` AND `)

          // Extract primary key values in same order as columns
          const primaryKeyValues = primaryKey.map(
            (k) => (mutation.original as Record<string, unknown>)[k]
          )

          await tx.unsafe(
            `DELETE FROM ${tableName}
             WHERE ${whereClause}`,
            primaryKeyValues
          )
          break
        }

        default:
          throw new Error(`Unknown operation type: ${mutation.type}`)
      }
    }

    return Number(txid)
  })
}
