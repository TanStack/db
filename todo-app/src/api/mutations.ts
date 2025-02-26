import { db } from "../db/kysely"
import { validateInsertTodo, validateUpdateTodo } from "../db/validation"
import { PendingMutation } from "../../../src/types"
import { sql } from "kysely"
import express from "express"

const router = express.Router()

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

      // Process each mutation in order
      for (const mutation of pendingMutations) {
        // Validate and process based on operation type
        switch (mutation.type) {
          case `insert`: {
            // Validate the data using our validation helpers
            const insertData = validateInsertTodo(mutation.modified)

            // Insert the new todo
            await trx.insertInto(`todos`).values(insertData).execute()
            break
          }

          case `update`: {
            // Validate the update data
            const updateData = validateUpdateTodo(mutation.changes)

            // Get the ID from the key
            const updateId = Number(mutation.original.id)
            if (isNaN(updateId)) {
              throw new Error(`Invalid todo ID: ${mutation.key}`)
            }

            console.log({ updateId, updateData })

            // Update the todo
            await trx
              .updateTable(`todos`)
              .set(updateData)
              .where(`id`, `=`, updateId)
              .execute()
            break
          }

          case `delete`: {
            // Get the ID from the key
            const deleteId = Number(mutation.key)
            if (isNaN(deleteId)) {
              throw new Error(`Invalid todo ID: ${mutation.key}`)
            }

            // Delete the todo
            await trx.deleteFrom(`todos`).where(`id`, `=`, deleteId).execute()
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
