import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import cors from 'cors'
import express from 'express'

const app = express()
const PORT = 3001
const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'todos.json')

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

// In-memory store
const todosStore = new Map<string, Todo>()

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Load persisted data or seed with initial data
function loadData() {
  try {
    const raw = readFileSync(DATA_FILE, 'utf-8')
    const todos: Array<Todo> = JSON.parse(raw)
    todos.forEach((todo) => todosStore.set(todo.id, todo))
    console.log(`Loaded ${todos.length} todos from ${DATA_FILE}`)
  } catch {
    console.log(`No existing data file, starting empty`)
  }
}

function saveData() {
  writeFileSync(
    DATA_FILE,
    JSON.stringify(Array.from(todosStore.values()), null, 2),
  )
}

loadData()

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

// POST create todo
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
  saveData()
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
  saveData()
  res.json(updated)
})

// DELETE todo
app.delete('/api/todos/:id', async (req, res) => {
  console.log('DELETE /api/todos/' + req.params.id)
  await delay(200)

  if (!todosStore.delete(req.params.id)) {
    return res.status(404).json({ error: 'Todo not found' })
  }
  saveData()
  res.json({ success: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`)
  console.log(`\nFor Android emulator, use: http://10.0.2.2:${PORT}`)
  console.log(`For iOS simulator, use: http://localhost:${PORT}`)
})
