import express from 'express'
import cors from 'cors'

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

// In-memory store
const todosStore = new Map<string, Todo>()

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Add some initial data
const initialTodos = [
  { id: '1', text: 'Learn TanStack DB', completed: false },
  { id: '2', text: 'Build offline-first app', completed: false },
  { id: '3', text: 'Test on React Native', completed: true },
]

initialTodos.forEach((todo) => {
  const now = new Date().toISOString()
  todosStore.set(todo.id, {
    ...todo,
    createdAt: now,
    updatedAt: now,
  })
})

// Simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// GET all todos
app.get('/api/todos', async (_req, res) => {
  console.log('GET /api/todos')
  await delay(200)
  const todos = Array.from(todosStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )
  res.json(todos)
})

// POST create todo
app.post('/api/todos', async (req, res) => {
  console.log('POST /api/todos', req.body)
  await delay(200)
  
  const { text, completed } = req.body
  if (!text || text.trim() === '') {
    return res.status(400).json({ error: 'Todo text is required' })
  }

  const now = new Date().toISOString()
  const todo: Todo = {
    id: generateId(),
    text,
    completed: completed ?? false,
    createdAt: now,
    updatedAt: now,
  }
  todosStore.set(todo.id, todo)
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
  res.json(updated)
})

// DELETE todo
app.delete('/api/todos/:id', async (req, res) => {
  console.log('DELETE /api/todos/' + req.params.id)
  await delay(200)

  if (!todosStore.delete(req.params.id)) {
    return res.status(404).json({ error: 'Todo not found' })
  }
  res.json({ success: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`)
  console.log(`\nFor Android emulator, use: http://10.0.2.2:${PORT}`)
  console.log(`For iOS simulator, use: http://localhost:${PORT}`)
})
