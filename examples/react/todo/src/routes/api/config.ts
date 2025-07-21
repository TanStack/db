import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import { sql } from "../../db/postgres"
import { validateInsertConfig } from "../../db/validation"
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

export const ServerRoute = createServerFileRoute(`/api/config`).methods({
  GET: async ({ request: _request }) => {
    try {
      const config = await sql`SELECT * FROM config`
      return json(config)
    } catch (error) {
      console.error(`Error fetching config:`, error)
      return json(
        {
          error: `Failed to fetch config`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
  POST: async ({ request }) => {
    try {
      const body = await request.json()
      console.log(`POST /api/config`, body)
      const configData = validateInsertConfig(body)

      let txid!: Txid
      let beforeLSN!: string
      let afterLSN!: string
      const newConfig = await sql.begin(async (tx) => {
        beforeLSN = await getCurrentLSN(tx)
        txid = await generateTxId(tx)

        const [result] = await tx`
          INSERT INTO config ${tx(configData)}
          RETURNING *
        `

        afterLSN = await getCurrentLSN(tx)
        return result
      })

      return json({ config: newConfig, txid, beforeLSN, afterLSN }, { status: 201 })
    } catch (error) {
      console.error(`Error creating config:`, error)
      return json(
        {
          error: `Failed to create config`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
})
