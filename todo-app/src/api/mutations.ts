import { sql } from "../db/postgres"
import {
  validateInsertTodo,
  validateUpdateTodo,
  validateInsertConfig,
  validateUpdateConfig,
} from "../db/validation"
import { PendingMutation } from "../../../src/types"
import { processMutations } from "../../../src/lib/write-to-pg"
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

    // Validate each mutation before processing
    const validatedMutations = pendingMutations.map((mutation) => {
      const relation = mutation.syncMetadata.relation as string[] | undefined
      const tableName = relation?.[1]
      if (!tableName) {
        throw new Error(`Could not find table name in relation metadata`)
      }

      const mutationCopy = { ...mutation }

      // Validate based on operation type and table
      switch (mutation.type) {
        case `insert`: {
          mutationCopy.modified =
            tableName === `config`
              ? validateInsertConfig(mutation.modified)
              : validateInsertTodo(mutation.modified)
          break
        }
        case `update`: {
          mutationCopy.changes =
            tableName === `config`
              ? validateUpdateConfig(mutation.changes)
              : validateUpdateTodo(mutation.changes)
          break
        }
        case `delete`:
          // No validation needed for deletes
          break
        default:
          throw new Error(`Unknown operation type: ${mutation.type}`)
      }

      return mutationCopy
    })

    // Process the validated mutations
    const txid = await processMutations(sql, validatedMutations)

    // Return the transaction ID to the caller
    return res.status(200).json({ txid })
  } catch (error) {
    console.error(`Error processing mutations:`, error)
    return res.status(500).json({
      error: `Failed to process mutations`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

export default router
