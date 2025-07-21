import { createServerFileRoute } from "@tanstack/react-start/server"
import { json } from "@tanstack/react-start"
import { sql } from "../../db/postgres"
import { validateUpdateConfig } from "../../db/validation"
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

export const ServerRoute = createServerFileRoute(`/api/config/$id`).methods({
  GET: async ({ params }) => {
    try {
      const { id } = params
      const [config] = await sql`SELECT * FROM config WHERE id = ${id}`

      if (!config) {
        return json({ error: `Config not found` }, { status: 404 })
      }

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
  PUT: async ({ params, request }) => {
    try {
      const { id } = params
      const body = await request.json()
      const configData = validateUpdateConfig(body)

      let txid!: Txid
      let beforeLSN!: string
      let afterLSN!: string
      const updatedConfig = await sql.begin(async (tx) => {
        beforeLSN = await getCurrentLSN(tx)
        txid = await generateTxId(tx)

        const [result] = await tx`
          UPDATE config
          SET ${tx(configData)}
          WHERE id = ${id}
          RETURNING *
        `

        if (!result) {
          throw new Error(`Config not found`)
        }

        afterLSN = await getCurrentLSN(tx)
        return result
      })

      return json({ config: updatedConfig, txid, beforeLSN, afterLSN })
    } catch (error) {
      if (error instanceof Error && error.message === `Config not found`) {
        return json({ error: `Config not found` }, { status: 404 })
      }

      console.error(`Error updating config:`, error)
      return json(
        {
          error: `Failed to update config`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
  DELETE: async ({ params }) => {
    try {
      const { id } = params

      let txid!: Txid
      let beforeLSN!: string
      let afterLSN!: string
      await sql.begin(async (tx) => {
        beforeLSN = await getCurrentLSN(tx)
        txid = await generateTxId(tx)

        const [result] = await tx`
          DELETE FROM config
          WHERE id = ${id}
          RETURNING id
        `

        if (!result) {
          throw new Error(`Config not found`)
        }

        afterLSN = await getCurrentLSN(tx)
      })

      return json({ success: true, txid, beforeLSN, afterLSN })
    } catch (error) {
      if (error instanceof Error && error.message === `Config not found`) {
        return json({ error: `Config not found` }, { status: 404 })
      }

      console.error(`Error deleting config:`, error)
      return json(
        {
          error: `Failed to delete config`,
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 }
      )
    }
  },
})
