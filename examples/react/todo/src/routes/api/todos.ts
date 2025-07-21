import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import { sql } from "../../db/postgres"
import { validateInsertTodo } from "../../db/validation"
import type { Txid } from "@tanstack/electric-db-collection"

// Generate a transaction ID
async function generateTxId(tx: any): Promise<Txid> {
  // The ::xid cast strips off the epoch, giving you the raw 32-bit value
  // that matches what PostgreSQL sends in logical replication streams
  // (and then exposed through Electric which we'll match against
  // in the client).
  const result = await tx`SELECT pg_current_xact_id()::xid::text as txid`
  const txid = result[0]?.txid

  if (txid === undefined) {
    throw new Error(`Failed to get transaction ID`)
  }

  return parseInt(txid, 10)
}

// Get current WAL LSN for Materialize tracking
async function getCurrentLSN(tx: any): Promise<string> {
  const result = await tx`SELECT pg_current_wal_lsn() as lsn`
  console.log(`getCurrentLSN`, { result })
  const lsn = result[0]?.lsn

  if (lsn === undefined) {
    throw new Error(`Failed to get current LSN`)
  }

  return lsn
}

export const ServerRoute = createServerFileRoute(`/api/todos`).methods({
  GET: async ({ request: _request }) => {
    try {
      const todos = await sql`SELECT * FROM todos`
      return json(todos)
    } catch (error) {
      console.error(`Error fetching todos:`, error)
      return json(
        {
          error: `Failed to fetch todos`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
  POST: async ({ request }) => {
    try {
      const body = await request.json()
      const todoData = validateInsertTodo(body)
      console.log(`Creating todo:`, todoData)

      let txid!: Txid
      let beforeLSN!: string
      let afterLSN!: string
      const newTodo = await sql.begin(async (tx) => {
        beforeLSN = await getCurrentLSN(tx)
        txid = await generateTxId(tx)

        const [result] = await tx`
          INSERT INTO todos ${tx(todoData)}
          RETURNING *
        `

        afterLSN = await getCurrentLSN(tx)
        return result
      })

      return json({ todo: newTodo, txid, beforeLSN, afterLSN }, { status: 201 })
    } catch (error) {
      console.error(`Error creating todo:`, error)
      return json(
        {
          error: `Failed to create todo`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
})
