import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import { sql } from "../../db/postgres"
import { validateUpdateTodo } from "../../db/validation"
import type { Txid } from "@tanstack/electric-db-collection"

// Generate a transaction ID
async function generateTxId(tx: any): Promise<Txid> {
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = result[0]?.txid

  if (txid === undefined) {
    throw new Error(`Failed to get transaction ID`)
  }

  return parseInt(txid, 10)
}

export const ServerRoute = createServerFileRoute(`/api/todos/$id`).methods({
  GET: async ({ params }) => {
    try {
      const { id } = params
      const [todo] = await sql`SELECT * FROM todos WHERE id = ${id}`

      if (!todo) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      return json(todo)
    } catch (error) {
      console.error(`Error fetching todo:`, error)
      return json(
        {
          error: `Failed to fetch todo`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
  PUT: async ({ params, request }) => {
    try {
      const { id } = params
      const body = await request.json()
      const todoData = validateUpdateTodo(body)
      console.log(`Updating todo ${id}:`, todoData)

      // Capture LSN before transaction
      const beforeLSNResult = await sql`SELECT pg_current_wal_lsn() as lsn`
      const beforeLSN = beforeLSNResult[0]?.lsn
      if (!beforeLSN) throw new Error(`Failed to get beforeLSN`)

      let txid!: Txid
      const updatedTodo = await sql.begin(async (tx) => {
        txid = await generateTxId(tx)

        const [result] = await tx`
          UPDATE todos
          SET ${tx(todoData)}
          WHERE id = ${id}
          RETURNING *
        `

        if (!result) {
          throw new Error(`Todo not found`)
        }

        return result
      })

      // Capture LSN after transaction completes
      const afterLSNResult = await sql`SELECT pg_current_wal_lsn() as lsn`
      const afterLSN = afterLSNResult[0]?.lsn
      if (!afterLSN) throw new Error(`Failed to get afterLSN`)

      return json({ todo: updatedTodo, txid, beforeLSN, afterLSN })
    } catch (error) {
      if (error instanceof Error && error.message === `Todo not found`) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      console.error(`Error updating todo:`, error)
      return json(
        {
          error: `Failed to update todo`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
  DELETE: async ({ params }) => {
    try {
      const { id } = params
      console.log(`Deleting todo ${id}`)

      // Capture LSN before transaction
      const beforeLSNResult = await sql`SELECT pg_current_wal_lsn() as lsn`
      const beforeLSN = beforeLSNResult[0]?.lsn
      if (!beforeLSN) throw new Error(`Failed to get beforeLSN`)

      let txid!: Txid
      await sql.begin(async (tx) => {
        txid = await generateTxId(tx)

        const [result] = await tx`
          DELETE FROM todos
          WHERE id = ${id}
          RETURNING id
        `

        if (!result) {
          throw new Error(`Todo not found`)
        }
      })

      // Capture LSN after transaction completes
      const afterLSNResult = await sql`SELECT pg_current_wal_lsn() as lsn`
      const afterLSN = afterLSNResult[0]?.lsn
      if (!afterLSN) throw new Error(`Failed to get afterLSN`)

      return json({ success: true, txid, beforeLSN, afterLSN })
    } catch (error) {
      if (error instanceof Error && error.message === `Todo not found`) {
        return json({ error: `Todo not found` }, { status: 404 })
      }

      console.error(`Error deleting todo:`, error)
      return json(
        {
          error: `Failed to delete todo`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
})
