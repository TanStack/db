import express from 'express'
import cors from 'cors'

const app = express()
const PORT = 3001

app.use(cors())
app.use(express.json())

// Types
interface ShoppingList {
  id: string
  name: string
  createdAt: string
}

interface ShoppingItem {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: string
}

// In-memory stores
const listsStore = new Map<string, ShoppingList>()
const itemsStore = new Map<string, ShoppingItem>()

// Helper function to generate IDs
function generateId(): string {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Seed data
const seedLists: Array<{ id: string; name: string }> = [
  { id: `list-grocery`, name: `Grocery` },
  { id: `list-hardware`, name: `Hardware Store` },
]

const seedItems: Array<{
  id: string
  listId: string
  text: string
  checked: boolean
}> = [
  { id: `item-milk`, listId: `list-grocery`, text: `Milk`, checked: false },
  { id: `item-eggs`, listId: `list-grocery`, text: `Eggs`, checked: false },
  { id: `item-bread`, listId: `list-grocery`, text: `Bread`, checked: true },
  {
    id: `item-screwdriver`,
    listId: `list-hardware`,
    text: `Screwdriver`,
    checked: false,
  },
  {
    id: `item-nails`,
    listId: `list-hardware`,
    text: `Nails`,
    checked: false,
  },
]

seedLists.forEach((list) => {
  listsStore.set(list.id, {
    ...list,
    createdAt: new Date().toISOString(),
  })
})

seedItems.forEach((item) => {
  itemsStore.set(item.id, {
    ...item,
    createdAt: new Date().toISOString(),
  })
})

// Simulate network delay
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ─── Lists ──────────────────────────────────────────────

app.get('/api/lists', async (_req, res) => {
  console.log('GET /api/lists')
  await delay(200)
  const lists = Array.from(listsStore.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  )
  res.json(lists)
})

app.post('/api/lists', async (req, res) => {
  console.log('POST /api/lists', req.body)
  await delay(200)

  const { id, name } = req.body
  if (!name || name.trim() === '') {
    return res.status(400).json({ error: 'List name is required' })
  }

  const list: ShoppingList = {
    id: id || generateId(),
    name,
    createdAt: new Date().toISOString(),
  }
  listsStore.set(list.id, list)
  res.status(201).json(list)
})

app.put('/api/lists/:id', async (req, res) => {
  console.log('PUT /api/lists/' + req.params.id, req.body)
  await delay(200)

  const existing = listsStore.get(req.params.id)
  if (!existing) {
    return res.status(404).json({ error: 'List not found' })
  }

  const updated: ShoppingList = {
    ...existing,
    ...req.body,
  }
  listsStore.set(req.params.id, updated)
  res.json(updated)
})

app.delete('/api/lists/:id', async (req, res) => {
  console.log('DELETE /api/lists/' + req.params.id)
  await delay(200)

  if (!listsStore.delete(req.params.id)) {
    return res.status(404).json({ error: 'List not found' })
  }

  // Cascade delete: remove all items belonging to this list
  for (const [itemId, item] of itemsStore) {
    if (item.listId === req.params.id) {
      itemsStore.delete(itemId)
    }
  }

  res.json({ success: true })
})

// ─── Items ──────────────────────────────────────────────

app.get('/api/items', async (_req, res) => {
  console.log('GET /api/items')
  await delay(200)
  const items = Array.from(itemsStore.values()).sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  )
  res.json(items)
})

app.post('/api/items', async (req, res) => {
  console.log('POST /api/items', req.body)
  await delay(200)

  const { id, listId, text, checked } = req.body
  if (!listId || !text || text.trim() === '') {
    return res.status(400).json({ error: 'listId and text are required' })
  }

  const item: ShoppingItem = {
    id: id || generateId(),
    listId,
    text,
    checked: checked ?? false,
    createdAt: new Date().toISOString(),
  }
  itemsStore.set(item.id, item)
  res.status(201).json(item)
})

app.put('/api/items/:id', async (req, res) => {
  console.log('PUT /api/items/' + req.params.id, req.body)
  await delay(200)

  const existing = itemsStore.get(req.params.id)
  if (!existing) {
    return res.status(404).json({ error: 'Item not found' })
  }

  const updated: ShoppingItem = {
    ...existing,
    ...req.body,
  }
  itemsStore.set(req.params.id, updated)
  res.json(updated)
})

app.delete('/api/items/:id', async (req, res) => {
  console.log('DELETE /api/items/' + req.params.id)
  await delay(200)

  if (!itemsStore.delete(req.params.id)) {
    return res.status(404).json({ error: 'Item not found' })
  }
  res.json({ success: true })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`)
  console.log(`\nFor Android emulator, use: http://10.0.2.2:${PORT}`)
  console.log(`For iOS simulator, use: http://localhost:${PORT}`)
  console.log(`\nSeed data:`)
  console.log(`  Lists: ${listsStore.size}`)
  console.log(`  Items: ${itemsStore.size}`)
})
