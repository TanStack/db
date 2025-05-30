/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import express from "express"
import cors from "cors"
import { sql } from "../db/postgres"
import {
  validateInsertConfig,
  validateInsertTodo,
  validateUpdateConfig,
  validateUpdateTodo,
} from "../db/validation"

// Create Express app
const app = express()
const PORT = process.env.PORT || 3001

// Middleware
app.use(cors())
app.use(express.json())

// Health check endpoint
app.get(`/api/health`, (req, res) => {
  res.status(200).json({ status: `ok` })
})

// Generate a transaction ID
async function generateTxId(tx: any): Promise<number> {
  const [{ txid }] = await tx`SELECT txid_current() as txid`
  return Number(txid)
}

// ===== TODOS API =====

// GET all todos
app.get(`/api/todos`, async (req, res) => {
  try {
    const todos = await sql`SELECT * FROM todos`
    res.status(200).json(todos)
  } catch (error) {
    console.error(`Error fetching todos:`, error)
    res.status(500).json({
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

    res.status(200).json(todo)
  } catch (error) {
    console.error(`Error fetching todo:`, error)
    res.status(500).json({
      error: `Failed to fetch todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// POST create a new todo
app.post(`/api/todos`, async (req, res) => {
  try {
    const todoData = validateInsertTodo(req.body)

    const { result: newTodo, txid } = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        INSERT INTO todos ${tx(todoData)}
        RETURNING *
      `
      return { result, txid: generatedTxid }
    })

    res.status(201).json({ todo: newTodo, txid })
  } catch (error) {
    console.error(`Error creating todo:`, error)
    res.status(500).json({
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

    const { result: updatedTodo, txid } = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        UPDATE todos
        SET ${tx(todoData)}
        WHERE id = ${id}
        RETURNING *
      `

      if (!result) {
        throw new Error(`Todo not found`)
      }

      return { result, txid: generatedTxid }
    })

    res.status(200).json({ todo: updatedTodo, txid })
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error updating todo:`, error)
    res.status(500).json({
      error: `Failed to update todo`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// DELETE a todo
app.delete(`/api/todos/:id`, async (req, res) => {
  try {
    const { id } = req.params

    const txid = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        DELETE FROM todos
        WHERE id = ${id}
        RETURNING id
      `

      if (!result) {
        throw new Error(`Todo not found`)
      }

      return generatedTxid
    })

    res.status(200).json({ success: true, txid })
  } catch (error) {
    if (error instanceof Error && error.message === `Todo not found`) {
      return res.status(404).json({ error: `Todo not found` })
    }

    console.error(`Error deleting todo:`, error)
    res.status(500).json({
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
    res.status(200).json(config)
  } catch (error) {
    console.error(`Error fetching config:`, error)
    res.status(500).json({
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

    res.status(200).json(config)
  } catch (error) {
    console.error(`Error fetching config:`, error)
    res.status(500).json({
      error: `Failed to fetch config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// POST create a new config
app.post(`/api/config`, async (req, res) => {
  try {
    const configData = validateInsertConfig(req.body)

    const { result: newConfig, txid } = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        INSERT INTO config ${tx(configData)}
        RETURNING *
      `
      return { result, txid: generatedTxid }
    })

    res.status(201).json({ config: newConfig, txid })
  } catch (error) {
    console.error(`Error creating config:`, error)
    res.status(500).json({
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

    const { result: updatedConfig, txid } = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        UPDATE config
        SET ${tx(configData)}
        WHERE id = ${id}
        RETURNING *
      `

      if (!result) {
        throw new Error(`Config not found`)
      }

      return { result, txid: generatedTxid }
    })

    res.status(200).json({ config: updatedConfig, txid })
  } catch (error) {
    if (error instanceof Error && error.message === `Config not found`) {
      return res.status(404).json({ error: `Config not found` })
    }

    console.error(`Error updating config:`, error)
    res.status(500).json({
      error: `Failed to update config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// DELETE a config
app.delete(`/api/config/:id`, async (req, res) => {
  try {
    const { id } = req.params

    const txid = await sql.begin(async (tx) => {
      const generatedTxid = await generateTxId(tx)

      const [result] = await tx`
        DELETE FROM config
        WHERE id = ${id}
        RETURNING id
      `

      if (!result) {
        throw new Error(`Config not found`)
      }

      return generatedTxid
    })

    res.status(200).json({ success: true, txid })
  } catch (error) {
    if (error instanceof Error && error.message === `Config not found`) {
      return res.status(404).json({ error: `Config not found` })
    }

    console.error(`Error deleting config:`, error)
    res.status(500).json({
      error: `Failed to delete config`,
      details: error instanceof Error ? error.message : String(error),
    })
  }
})

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

export default app
