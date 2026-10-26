import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { PowerSyncDatabase, Schema, Table, column } from '@powersync/node'
import { createCollection, createLiveQueryCollection, eq } from '@tanstack/db'
import pDefer from 'p-defer'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { powerSyncCollectionOptions } from '../src'
import type { Collection } from '@tanstack/db'

/**
 * # Does PowerSync settlement carry initial-query readiness?
 *
 * ARCHITECTURE.md law 10 makes a settled `loadSubset` the readiness evidence
 * for an on-demand source, and law 7 says a successful load settles only after
 * its rows are visible. These witnesses drive a real PowerSync database under a
 * real live query and record the rows visible at the first-ready transition.
 */

const APP_SCHEMA = new Schema({
  products: new Table({ name: column.text, category: column.text }),
})

async function createDatabase() {
  const db = new PowerSyncDatabase({
    database: {
      dbFilename: `test-readiness-${randomUUID()}.sqlite`,
      dbLocation: tmpdir(),
      implementation: { type: `node:sqlite` },
    },
    schema: APP_SCHEMA,
  })
  onTestFinished(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    await db.disconnectAndClear()
    await db.close()
  })
  await db.disconnectAndClear()
  await db.execute(`
    INSERT INTO products (id, name, category)
    VALUES ('a1', 'A', 'electronics'), ('a2', 'B', 'electronics'),
           ('c1', 'C', 'clothing')
  `)
  return db
}

function rowsAtFirstReady(query: Collection<any, any, any>) {
  const seen: { rows?: Array<unknown> } = {}
  query.onFirstReady(() => {
    seen.rows = query.toArray.map((row: { id: string }) => row.id).sort()
  })
  return seen
}

function createSource(
  database: PowerSyncDatabase,
  syncMode: `eager` | `on-demand` | undefined,
  onLoadSubset?: () => Promise<void>,
) {
  const table = APP_SCHEMA.props.products
  const source = createCollection(
    syncMode === `on-demand`
      ? powerSyncCollectionOptions({ database, table, syncMode, onLoadSubset })
      : powerSyncCollectionOptions({ database, table }),
  )
  onTestFinished(() => source.cleanup())
  return source
}

function electronics(source: ReturnType<typeof createSource>) {
  return createLiveQueryCollection((q) =>
    q
      .from({ product: source })
      .where(({ product }) => eq(product.category, `electronics`)),
  )
}

describe(`PowerSync initial readiness follows applied subset settlement`, () => {
  it(`an on-demand query is first ready with its subset rows visible`, async () => {
    const db = await createDatabase()
    const source = createSource(db, `on-demand`)
    const query = electronics(source)
    onTestFinished(() => query.cleanup())
    const seen = rowsAtFirstReady(query)
    await query.preload()
    expect(seen.rows).toEqual([`a1`, `a2`])
  })

  it(`a held subset hook holds readiness until the hook and rows settle`, async () => {
    const db = await createDatabase()
    const hook = pDefer<void>()
    const source = createSource(db, `on-demand`, () => hook.promise)
    const query = electronics(source)
    onTestFinished(() => query.cleanup())
    const seen = rowsAtFirstReady(query)
    const preload = query.preload()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(query.isReady()).toBe(false)
    hook.resolve()
    await preload
    expect(seen.rows).toEqual([`a1`, `a2`])
  })

  it(`a failed subset hook errors the query and never readies it`, async () => {
    const db = await createDatabase()
    const loggedError = vi.spyOn(console, `error`).mockImplementation(() => {})
    onTestFinished(() => loggedError.mockRestore())
    const source = createSource(db, `on-demand`, () =>
      Promise.reject(new Error(`hook failed`)),
    )
    const query = electronics(source)
    onTestFinished(() => query.cleanup())
    const seen = rowsAtFirstReady(query)
    await query.preload().catch(() => {})
    await vi.waitFor(() => expect(query.status).toBe(`error`))
    expect(seen.rows).toBeUndefined()
  })

  it(`a demand released during its hook installs no rows`, async () => {
    const db = await createDatabase()
    const hook = pDefer<void>()
    let entered = false
    const source = createSource(db, `on-demand`, () => {
      entered = true
      return hook.promise
    })
    const query = electronics(source)
    void query.preload().catch(() => {})
    await vi.waitFor(() => expect(entered).toBe(true))
    await query.cleanup()
    hook.resolve()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(source.size).toBe(0)
  })

  it(`a source with no syncMode is eager and gates readiness`, async () => {
    const db = await createDatabase()
    const source = createSource(db, undefined)
    expect(source.config.syncMode).not.toBe(`on-demand`)
    const query = electronics(source)
    onTestFinished(() => query.cleanup())
    let sourceReadyAtQueryReady: boolean | undefined
    query.onFirstReady(() => {
      sourceReadyAtQueryReady = source.isReady()
    })
    const seen = rowsAtFirstReady(query)
    await query.preload()
    expect(sourceReadyAtQueryReady).toBe(true)
    expect(seen.rows).toEqual([`a1`, `a2`])
  })
})
