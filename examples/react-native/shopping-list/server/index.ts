import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import cors from 'cors'
import express from 'express'
import postgres from 'postgres'
import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client'

const app = express()
const PORT = 3001
const ELECTRIC_URL = process.env.ELECTRIC_URL ?? `http://localhost:3003`
const sql = postgres({
  host: `localhost`,
  port: 54322,
  user: `postgres`,
  password: `postgres`,
  database: `shopping_list`,
})

const HOP_BY_HOP_HEADERS = new Set([
  `connection`,
  `content-length`,
  `keep-alive`,
  `proxy-authenticate`,
  `proxy-authorization`,
  `te`,
  `trailer`,
  `transfer-encoding`,
  `upgrade`,
  `host`,
])

app.use(cors())
app.use(express.json())

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

function asIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  return new Date(String(value)).toISOString()
}

function toShoppingList(row: {
  id: string
  name: string
  createdAt: unknown
}): ShoppingList {
  return {
    id: row.id,
    name: row.name,
    createdAt: asIso(row.createdAt),
  }
}

function toShoppingItem(row: {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: unknown
}): ShoppingItem {
  return {
    id: row.id,
    listId: row.listId,
    text: row.text,
    checked: row.checked,
    createdAt: asIso(row.createdAt),
  }
}

function buildElectricShapeUrl(requestUrl: string, table: string): URL {
  const url = new URL(requestUrl)
  const originUrl = new URL(`/v1/shape`, ELECTRIC_URL)

  url.searchParams.forEach((value, key) => {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) {
      originUrl.searchParams.set(key, value)
    }
  })

  originUrl.searchParams.set(`table`, table)

  if (process.env.ELECTRIC_SOURCE_ID) {
    originUrl.searchParams.set(`source_id`, process.env.ELECTRIC_SOURCE_ID)
  }
  const sourceSecret =
    process.env.ELECTRIC_SOURCE_SECRET ?? process.env.ELECTRIC_SECRET
  if (sourceSecret) {
    originUrl.searchParams.set(`secret`, sourceSecret)
  }

  return originUrl
}

function buildForwardHeaders(req: express.Request): Headers {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    const lowerKey = key.toLowerCase()
    if (HOP_BY_HOP_HEADERS.has(lowerKey)) {
      continue
    }
    if (value === undefined) {
      continue
    }
    headers.set(key, Array.isArray(value) ? value.join(`,`) : value)
  }
  return headers
}

async function proxyElectricShape(
  req: express.Request,
  res: express.Response,
  table: string,
) {
  const requestUrl = `${req.protocol}://${req.get(`host`)}${req.originalUrl}`
  const originUrl = buildElectricShapeUrl(requestUrl, table)
  const forwardHeaders = buildForwardHeaders(req)
  const body =
    req.method === `POST` && req.body !== undefined
      ? JSON.stringify(req.body)
      : undefined

  if (body && !forwardHeaders.has(`content-type`)) {
    forwardHeaders.set(`content-type`, `application/json`)
  }

  const response = await fetch(originUrl, {
    method: req.method,
    headers: forwardHeaders,
    body,
  })

  response.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (
      lower === `content-encoding` ||
      lower === `content-length` ||
      lower === `transfer-encoding`
    ) {
      return
    }
    res.setHeader(key, value)
  })
  const varyHeader = response.headers.get(`vary`)
  res.setHeader(
    `Vary`,
    varyHeader ? `${varyHeader}, Authorization` : `Authorization`,
  )
  res.status(response.status)

  if (!response.body) {
    res.end()
    return
  }

  const nodeStream = Readable.fromWeb(response.body as any)
  res.on(`close`, () => nodeStream.destroy())
  await pipeline(nodeStream, res)
}

async function ensureDb() {
  await sql`
    CREATE TABLE IF NOT EXISTS shopping_lists (
      id text PRIMARY KEY,
      name text NOT NULL,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `

  await sql`
    CREATE TABLE IF NOT EXISTS shopping_items (
      id text PRIMARY KEY,
      "listId" text NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
      text text NOT NULL,
      checked boolean NOT NULL DEFAULT false,
      "createdAt" timestamptz NOT NULL DEFAULT now()
    )
  `

  const [{ count }] = await sql<Array<{ count: string }>>`
    SELECT count(*)::text as count FROM shopping_lists
  `
  if (Number.parseInt(count, 10) > 0) {
    return
  }

  await sql`
    INSERT INTO shopping_lists (id, name)
    VALUES
      ('list-grocery', 'Grocery'),
      ('list-hardware', 'Hardware Store')
    ON CONFLICT (id) DO NOTHING
  `

  await sql`
    INSERT INTO shopping_items (id, "listId", text, checked)
    VALUES
      ('item-milk', 'list-grocery', 'Milk', false),
      ('item-eggs', 'list-grocery', 'Eggs', false),
      ('item-bread', 'list-grocery', 'Bread', true),
      ('item-screwdriver', 'list-hardware', 'Screwdriver', false),
      ('item-nails', 'list-hardware', 'Nails', false)
    ON CONFLICT (id) DO NOTHING
  `
}

app.get('/api/shapes/lists', async (req, res) => {
  try {
    await proxyElectricShape(req, res, `shopping_lists`)
  } catch (error) {
    console.error(`Failed to proxy lists shape`, error)
    if (!res.headersSent) {
      res.status(502).json({ error: `Failed to proxy lists shape` })
    }
  }
})

app.post('/api/shapes/lists', async (req, res) => {
  try {
    await proxyElectricShape(req, res, `shopping_lists`)
  } catch (error) {
    console.error(`Failed to proxy lists shape`, error)
    if (!res.headersSent) {
      res.status(502).json({ error: `Failed to proxy lists shape` })
    }
  }
})

app.get('/api/shapes/items', async (req, res) => {
  try {
    await proxyElectricShape(req, res, `shopping_items`)
  } catch (error) {
    console.error(`Failed to proxy items shape`, error)
    if (!res.headersSent) {
      res.status(502).json({ error: `Failed to proxy items shape` })
    }
  }
})

app.post('/api/shapes/items', async (req, res) => {
  try {
    await proxyElectricShape(req, res, `shopping_items`)
  } catch (error) {
    console.error(`Failed to proxy items shape`, error)
    if (!res.headersSent) {
      res.status(502).json({ error: `Failed to proxy items shape` })
    }
  }
})

app.get('/api/lists', async (_req, res) => {
  const rows = await sql<
    Array<{
      id: string
      name: string
      createdAt: unknown
    }>
  >`
    SELECT id, name, "createdAt"
    FROM shopping_lists
    ORDER BY "createdAt" DESC
  `
  res.json(rows.map(toShoppingList))
})

app.post('/api/lists', async (req, res) => {
  const { id, name, createdAt } = req.body as {
    id?: string
    name?: string
    createdAt?: string
  }
  if (!name?.trim()) {
    return res.status(400).json({ error: `List name is required` })
  }

  const [inserted] = await sql<
    Array<{
      txid: string
      id: string
      name: string
      createdAt: unknown
    }>
  >`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    inserted AS (
      INSERT INTO shopping_lists (id, name, "createdAt")
      VALUES (
        ${id ?? crypto.randomUUID()},
        ${name.trim()},
        COALESCE(${createdAt ?? null}, now())
      )
      RETURNING id, name, "createdAt"
    )
    SELECT tx.txid, inserted.id, inserted.name, inserted."createdAt"
    FROM tx, inserted
  `

  return res.status(201).json({
    list: toShoppingList(inserted),
    txid: Number.parseInt(inserted.txid, 10),
  })
})

app.put('/api/lists/:id', async (req, res) => {
  const { id } = req.params
  const { name } = req.body as { name?: string }
  if (name !== undefined && !name.trim()) {
    return res.status(400).json({ error: `List name cannot be empty` })
  }

  const updatedRows = await sql`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    updated AS (
      UPDATE shopping_lists
      SET name = COALESCE(${name?.trim() ?? null}, name)
      WHERE id = ${id}
      RETURNING id, name, "createdAt"
    )
    SELECT tx.txid, updated.id, updated.name, updated."createdAt"
    FROM tx, updated
  `
  const updated = updatedRows[0] as
    | { txid: string; id: string; name: string; createdAt: unknown }
    | undefined

  if (!updated) {
    return res.status(404).json({ error: `List not found` })
  }

  return res.json({
    list: toShoppingList(updated),
    txid: Number.parseInt(updated.txid, 10),
  })
})

app.delete('/api/lists/:id', async (req, res) => {
  const { id } = req.params

  const deletedRows = await sql`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    deleted AS (
      DELETE FROM shopping_lists
      WHERE id = ${id}
      RETURNING id
    )
    SELECT tx.txid, deleted.id
    FROM tx, deleted
  `
  const deleted = deletedRows[0] as { txid: string; id: string } | undefined

  if (!deleted) {
    return res.status(404).json({ error: `List not found` })
  }

  return res.json({ success: true, txid: Number.parseInt(deleted.txid, 10) })
})

app.get('/api/items', async (_req, res) => {
  const rows = await sql<
    Array<{
      id: string
      listId: string
      text: string
      checked: boolean
      createdAt: unknown
    }>
  >`
    SELECT id, "listId", text, checked, "createdAt"
    FROM shopping_items
    ORDER BY "createdAt" ASC
  `
  res.json(rows.map(toShoppingItem))
})

app.post('/api/items', async (req, res) => {
  const { id, listId, text, checked, createdAt } = req.body as {
    id?: string
    listId?: string
    text?: string
    checked?: boolean
    createdAt?: string
  }

  if (!listId || !text?.trim()) {
    return res.status(400).json({ error: `listId and text are required` })
  }

  const [inserted] = await sql<
    Array<{
      txid: string
      id: string
      listId: string
      text: string
      checked: boolean
      createdAt: unknown
    }>
  >`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    inserted AS (
      INSERT INTO shopping_items (id, "listId", text, checked, "createdAt")
      VALUES (
        ${id ?? crypto.randomUUID()},
        ${listId},
        ${text.trim()},
        COALESCE(${checked ?? null}, false),
        COALESCE(${createdAt ?? null}, now())
      )
      RETURNING id, "listId", text, checked, "createdAt"
    )
    SELECT tx.txid, inserted.id, inserted."listId", inserted.text, inserted.checked, inserted."createdAt"
    FROM tx, inserted
  `

  return res.status(201).json({
    item: toShoppingItem(inserted),
    txid: Number.parseInt(inserted.txid, 10),
  })
})

app.put('/api/items/:id', async (req, res) => {
  const { id } = req.params
  const { text, checked } = req.body as { text?: string; checked?: boolean }
  if (text !== undefined && !text.trim()) {
    return res.status(400).json({ error: `Item text cannot be empty` })
  }

  const updatedRows = await sql`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    updated AS (
      UPDATE shopping_items
      SET
        text = COALESCE(${text?.trim() ?? null}, text),
        checked = COALESCE(${checked ?? null}, checked)
      WHERE id = ${id}
      RETURNING id, "listId", text, checked, "createdAt"
    )
    SELECT tx.txid, updated.id, updated."listId", updated.text, updated.checked, updated."createdAt"
    FROM tx, updated
  `
  const updated = updatedRows[0] as
    | {
        txid: string
        id: string
        listId: string
        text: string
        checked: boolean
        createdAt: unknown
      }
    | undefined

  if (!updated) {
    return res.status(404).json({ error: `Item not found` })
  }

  return res.json({
    item: toShoppingItem(updated),
    txid: Number.parseInt(updated.txid, 10),
  })
})

app.delete('/api/items/:id', async (req, res) => {
  const { id } = req.params

  const deletedRows = await sql`
    WITH tx AS (
      SELECT pg_current_xact_id()::xid::text as txid
    ),
    deleted AS (
      DELETE FROM shopping_items
      WHERE id = ${id}
      RETURNING id
    )
    SELECT tx.txid, deleted.id
    FROM tx, deleted
  `
  const deleted = deletedRows[0] as { txid: string; id: string } | undefined

  if (!deleted) {
    return res.status(404).json({ error: `Item not found` })
  }

  return res.json({ success: true, txid: Number.parseInt(deleted.txid, 10) })
})

async function start() {
  try {
    await ensureDb()

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running at http://0.0.0.0:${PORT}`)
      console.log(`For Android emulator API: http://10.0.2.2:${PORT}`)
      console.log(`For iOS simulator API: http://localhost:${PORT}`)
      console.log(`Electric shape endpoint: http://localhost:3003/v1/shape`)
    })
  } catch (error) {
    console.error(`Failed to start shopping-list server`, error)
    console.error(
      `Did you run 'pnpm db:up' in examples/react-native/shopping-list?`,
    )
    process.exit(1)
  }
}

void start()
