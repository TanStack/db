import express from "express"
import cors from "cors"
import { sql } from "../db/postgres"
import {
  validateInsertConfig,
  validateInsertTodo,
  validateUpdateConfig,
  validateUpdateTodo,
} from "../db/validation"
import type { Express } from "express"
import type { Txid } from "@tanstack/electric-db-collection"

// Create Express app
const app: Express = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get(`/api/health`, (req, res) => {
  res.status(200).json({ status: `ok` })
})

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
  const lsn = result[0]?.lsn

  if (lsn === undefined) {
    throw new Error(`Failed to get current LSN`)
  }

  return lsn
}

// ===== TODOS API =====

// GET all todos
app.get(`/api/todos`, async (req, res) => {
  try {
    const todos = await sql`SELECT * FROM todos`
    return res.status(200).json(todos)
  } catch (error) {
    console.error(`Error fetching todos:`, error)
    return res.status(500).json({
      error: `Failed to fetch todos`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// GET a single todo by ID
app.get(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params
    const [todo] = await sql`SELECT * FROM todos WHERE id = ${id}`

    if (!todo) {
      return res.status(404).json({ error: `Todo not found` })
    }

    return res.status(200).json(todo)
  } catch (error) {
    console.error(`Error fetching todo:`, error)
    return res.status(500).json({
      error: `Failed to fetch todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// POST create a new todo
app.post(`/api/todos`, async (req, res) => {
  try {
    const todoData = validateInsertTodo(req.body)

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

    return res.status(201).json({ todo: newTodo, txid, beforeLSN, afterLSN })
  } catch (error) {
    console.error(`Error creating todo:`, error)
    return res.status(500).json({
      error: `Failed to create todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// PUT update a todo
app.put(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params
    const todoData = validateUpdateTodo(req.body)

    let txid!: Txid
    let beforeLSN!: string
    let afterLSN!: string
    const updatedTodo = await sql.begin(async (tx) => {
      beforeLSN = await getCurrentLSN(tx)
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

      afterLSN = await getCurrentLSN(tx)
      return result
    })

    return res
      .status(200)
      .json({ todo: updatedTodo, txid, beforeLSN, afterLSN })
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error updating todo:`, error)
    return res.status(500).json({
      error: `Failed to update todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// DELETE a todo
app.delete(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params

    let txid!: Txid
    let beforeLSN!: string
    let afterLSN!: string
    await sql.begin(async (tx) => {
      beforeLSN = await getCurrentLSN(tx)
      txid = await generateTxId(tx)

      const [result] = await tx`
        DELETE FROM todos
        WHERE id = ${id}
        RETURNING id
      `

      if (!result) {
        throw new Error(`Todo not found`)
      }

      afterLSN = await getCurrentLSN(tx)
    })

    return res.status(200).json({ success: true, txid, beforeLSN, afterLSN })
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error deleting todo:`, error)
    return res.status(500).json({
      error: `Failed to delete todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// ===== CONFIG API =====

// GET all config entries
app.get(`/api/config`, async (req, res) => {
  try {
    const config = await sql`SELECT * FROM config`
    return res.status(200).json(config)
  } catch (error) {
    console.error(`Error fetching config:`, error)
    return res.status(500).json({
      error: `Failed to fetch config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// GET a single config by ID
app.get(`/api/config/:id`, async (req, res) => {
  try {
    const { id } = req.params
    const [config] = await sql`SELECT * FROM config WHERE id = ${id}`

    if (!config) {
      return res.status(404).json({ error: `Config not found` })
    }

    return res.status(200).json(config)
  } catch (error) {
    console.error(`Error fetching config:`, error)
    return res.status(500).json({
      error: `Failed to fetch config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// POST create a new config
app.post(`/api/config`, async (req, res) => {
  try {
    console.log(`POST /api/config`, req.body)
    const configData = validateInsertConfig(req.body)

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

    return res
      .status(201)
      .json({ config: newConfig, txid, beforeLSN, afterLSN })
  } catch (error) {
    console.error(`Error creating config:`, error)
    return res.status(500).json({
      error: `Failed to create config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// PUT update a config
app.put(`/api/config/:id`, async (req, res) => {
  try {
    const { id } = req.params
    const configData = validateUpdateConfig(req.body)

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

    return res
      .status(200)
      .json({ config: updatedConfig, txid, beforeLSN, afterLSN })
  } catch (error) {
    if (error instanceof Error && error.message === `Config not found`) {
      return res.status(404).json({ error: `Config not found` })
    }

    console.error(`Error updating config:`, error)
    return res.status(500).json({
      error: `Failed to update config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// DELETE a config
app.delete(`/api/config/:id`, async (req, res) => {
  try {
    const { id } = req.params

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

    return res.status(200).json({ success: true, txid, beforeLSN, afterLSN })
  } catch (error) {
    if (error instanceof Error && error.message === `Config not found`) {
      return res.status(404).json({ error: `Config not found` })
    }

    console.error(`Error deleting config:`, error)
    return res.status(500).json({
      error: `Failed to delete config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// API endpoint to get current LSN from PostgreSQL
app.get("/api/materialize/lsn", async (req, res) => {
  try {
    const result = await sql`SELECT pg_current_wal_lsn() as lsn`
    const lsn = result[0]?.lsn

    if (!lsn) {
      throw new Error("Failed to get current LSN")
    }

    res.json({ lsn })
  } catch (error) {
    console.error("Error getting LSN:", error)
    res.status(500).json({ error: "Failed to get LSN" })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
