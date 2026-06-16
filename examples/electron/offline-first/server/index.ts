import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

// Types
interface Todo {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

// Persist server state to a JSON file so data survives restarts
const TODOS_FILE = path.join(__dirname, 'todos.json')

function loadTodos(): Map<string, Todo> {
  try {
    const data = JSON.parse(fs.readFileSync(TODOS_FILE, 'utf-8')) as Array<Todo>
    return new Map(data.map((t) => [t.id, t]))
  } catch {
    return new Map()
  }
}

function saveTodos() {
  fs.writeFileSync(
    TODOS_FILE,
    JSON.stringify(Array.from(todosStore.values()), null, 2),
  )
}

const todosStore = loadTodos()

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// GET all todos
app.get('/api/todos', async (_req, res) => {
  console.log('GET /api/todos')
  await delay(200)
  const todos = Array.from(todosStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  res.json(todos)
})

// POST create todo — accepts client-generated ID
app.post('/api/todos', async (req, res) => {
  console.log('POST /api/todos', req.body)
  await delay(200)

  const { id, text, completed } = req.body
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Todo text is required' })
  }

  const now = new Date().toISOString()
  const todo: Todo = {
    id: id || generateId(),
    text,
    completed: completed ?? false,
    createdAt: now,
    updatedAt: now,
  }
  todosStore.set(todo.id, todo)
  saveTodos()
  res.status(201).json(todo)
})

// PUT update todo
app.put('/api/todos/:id', async (req, res) => {
  console.log('PUT /api/todos/' + req.params.id, req.body)
  await delay(200)

  const existing = todosStore.get(req.params.id)
  if (!existing) {
    return res.status(404).json({ error: 'Todo not found' })
  }

  const updated: Todo = {
    ...existing,
    ...req.body,
    updatedAt: new Date().toISOString(),
  }
  todosStore.set(req.params.id, updated)
  saveTodos()
  res.json(updated)
})

// DELETE todo
app.delete('/api/todos/:id', async (req, res) => {
  console.log('DELETE /api/todos/' + req.params.id)
  await delay(200)

  if (!todosStore.delete(req.params.id)) {
    return res.status(404).json({ error: 'Todo not found' })
  }
  saveTodos()
  res.json({ success: true })
})

// DELETE all todos
app.delete('/api/todos', async (_req, res) => {
  console.log('DELETE /api/todos (clear all)')
  await delay(200)
  todosStore.clear()
  saveTodos()
  res.json({ success: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`)
})
