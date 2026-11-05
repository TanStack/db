// The evidence store: units of evidence by identity (check.mjs).
//
// A cold run keeps its units in memory and drops them. The daemon keeps them
// in a TanStack DB collection persisted to SQLite on disk, so a daemon that
// restarts reuses what an earlier one ran. The store is a cache over the
// evidence a check reports, never the record: a stored unit is used only
// while every input it recorded is unchanged.
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** A store that lives for one check. */
export function memoryStore() {
  const rows = new Map()
  return {
    get: (id) => rows.get(id),
    put: (row) => rows.set(row.id, row),
  }
}

/**
 * A store in `<dir>/evidence.sqlite`: a local-only persisted collection,
 * whose inserts and updates SQLite persists. `flush` waits until every
 * write so far is on disk.
 */
export async function diskStore(dir) {
  mkdirSync(dir, { recursive: true })
  // The workspace's own packages, until this CLI is published with them as
  // dependencies. Both are loaded as ES modules, so they share one copy of
  // TanStack DB.
  const persistence = join(here, `../../packages/node-db-sqlite-persistence`)
  const requirePersistence = createRequire(join(persistence, `package.json`))
  const { createCollection } = await import(
    pathToFileURL(join(here, `../../packages/db/dist/esm/index.js`)).href
  )
  const { createNodeSQLitePersistence, persistedCollectionOptions } =
    await import(pathToFileURL(join(persistence, `dist/esm/index.js`)).href)
  const Database = requirePersistence(`better-sqlite3`)
  const database = new Database(join(dir, `evidence.sqlite`))
  const units = createCollection(
    persistedCollectionOptions({
      id: `evidence-units`,
      getKey: (row) => row.id,
      persistence: createNodeSQLitePersistence({ database }),
      schemaVersion: 1,
    }),
  )
  await units.preload()
  let pending = []
  return {
    get: (id) => units.get(id),
    put(row) {
      const transaction = units.has(row.id)
        ? units.update(row.id, (draft) => {
            draft.inputs = row.inputs
            draft.unit = row.unit
          })
        : units.insert(row)
      pending.push(transaction.when(`settled`))
    },
    async flush() {
      const waiting = pending
      pending = []
      await Promise.all(waiting)
    },
    async close() {
      await this.flush()
      await units.cleanup()
      database.close()
    },
  }
}
