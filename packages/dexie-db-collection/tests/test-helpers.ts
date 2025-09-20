// Ensure fake IndexedDB is installed before Dexie is dynamically imported
import "fake-indexeddb/auto"
import "./fake-db"
import { createCollection } from "@tanstack/db"
import { z } from "zod"
import dexieCollectionOptions from "../src/dexie"
import type Dexie from "dexie"

/**
 * Centralized function to ensure IndexedDB is available in test environment
 * Provides clear error messages if IndexedDB setup fails
 */
export function ensureIndexedDB(): void {
  // Check if IndexedDB is available globally
  if (typeof globalThis.indexedDB === `undefined`) {
    // Try to import fake-indexeddb if not already available
    try {
      // This should have been loaded by the import at the top
      // If it's still not available, something is wrong
      if (typeof globalThis.indexedDB === `undefined`) {
        throw new Error(`fake-indexeddb failed to initialize`)
      }
    } catch (error) {
      throw new Error(
        `IndexedDB is not available in this environment. ` +
          `Make sure to install and import 'fake-indexeddb/auto' before running Dexie tests. ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}

/**
 * Safely import Dexie after ensuring IndexedDB is available
 * This replaces the inline imports scattered throughout test files
 */
export async function getDexie() {
  ensureIndexedDB()
  const { default: Dexie } = await import(`dexie`)
  return Dexie
}

// Test schema following StandardSchemaV1 pattern
export const TestItemSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export type TestItem = z.infer<typeof TestItemSchema>

export function getTestData(amount: number): Array<TestItem> {
  return new Array(amount)
    .fill(0)
    .map((_v, i) => ({ id: String(i + 1), name: `Item ${i + 1}` }))
}

const DB_PREFIX = `test-dexie-`
let dbId = 0

export const createdDbs: Array<Dexie> = []
export const createdCollections: Array<any> = []

export async function waitForCollectionSize(
  collection: any,
  expected: number,
  timeoutMs = 1000
) {
  const start = Date.now()
  while (collection.size !== expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for collection size ${expected}, current=${collection.size}`
      )
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function waitForKey(
  collection: any,
  key: string,
  timeoutMs = 1000
) {
  // Prefer driver-provided awaitIds for determinism when available
  const utils = collection.utils as unknown as
    | {
        awaitIds?: (
          ids: Array<string | number>,
          timeoutMs?: number
        ) => Promise<void>
      }
    | undefined

  if (utils?.awaitIds) {
    await utils.awaitIds([key], timeoutMs)
    return
  }

  const start = Date.now()
  while (!collection.has(String(key))) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for key ${key}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function waitForNoKey(
  collection: any,
  key: string,
  timeoutMs = 1000
) {
  const start = Date.now()
  while (collection.has(String(key))) {
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for key ${key} to be removed`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function createMultiTabState(
  initialA: Array<TestItem> = [],
  initialB: Array<TestItem> = []
) {
  const dbid = dbId++
  const dbA = await createDexieDatabase(initialA, dbid)
  const dbB = await createDexieDatabase(initialB, dbid)

  const optsA = dexieCollectionOptions({
    id: `multi-tab-a`,
    tableName: `test`,
    dbName: dbA.name,
    schema: TestItemSchema,
    getKey: (item) => item.id,
  })

  const optsB = dexieCollectionOptions({
    id: `multi-tab-b`,
    tableName: `test`,
    dbName: dbB.name,
    schema: TestItemSchema,
    getKey: (item) => item.id,
  })

  const colA = createCollection(optsA)
  const colB = createCollection(optsB)
  await colA.stateWhenReady()
  await colB.stateWhenReady()
  createdCollections.push(colA, colB)

  // Force initial refetch to sync with DB state
  const utilsA = colA.utils as unknown as { refetch?: () => Promise<void> }
  const utilsB = colB.utils as unknown as { refetch?: () => Promise<void> }
  if (utilsA.refetch) await utilsA.refetch()
  if (utilsB.refetch) await utilsB.refetch()

  return { colA, colB, dbA, dbB }
}

export async function waitForBothCollections(
  colA: any,
  colB: any,
  expectedSize: number,
  timeoutMs = 2000
) {
  const start = Date.now()
  while (colA.size !== expectedSize || colB.size !== expectedSize) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out waiting for both collections to reach size ${expectedSize}. ColA: ${colA.size}, ColB: ${colB.size}`
      )
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

export async function createDexieDatabase(
  initialDocs: Array<TestItem> = [],
  id = dbId++
) {
  const name = DB_PREFIX + id
  const Dexie = await getDexie()
  const db = new Dexie(name)
  // Include metadata indexes to match the collection implementation
  // which defines the table as `&id, _updatedAt, _createdAt`. This prevents
  // Dexie from trying to upgrade/delete the DB when tests create
  // a database with a mismatched schema.
  db.version(1).stores({ test: `&id, _updatedAt, _createdAt` })
  await db.open()
  if (initialDocs.length > 0) {
    // Add metadata to initial docs for proper syncing
    const docsWithMeta = initialDocs.map((doc) => ({
      ...doc,
      _updatedAt: Date.now(),
      _createdAt: Date.now(),
    }))
    await db.table(`test`).bulkPut(docsWithMeta)
  }
  createdDbs.push(db)
  return db
}

export async function createTestState(initialDocs: Array<TestItem> = []) {
  const db = await createDexieDatabase(initialDocs)
  const options = dexieCollectionOptions({
    id: `test`,
    tableName: `test`,
    dbName: db.name,
    schema: TestItemSchema,
    getKey: (item) => item.id,
    // note: new dexieCollectionOptions uses Dexie's liveQuery internally
    // and does not accept `startSync` or `syncBatchSize` options anymore.
  })
  const collection = createCollection(options)
  await collection.stateWhenReady()
  createdCollections.push(collection)
  // In Node tests change events / BroadcastChannel may not propagate.
  // Trigger a refetch if available so initial DB contents are loaded.
  const utils = collection.utils as unknown as {
    refetch?: () => Promise<void>
    refresh?: () => void
  }
  if (utils.refetch) await utils.refetch()
  else if (utils.refresh) utils.refresh()
  return { collection, db }
}

export async function cleanupTestResources() {
  // Clean up collections first to ensure their drivers unsubscribe and close DBs
  for (const col of createdCollections.splice(0)) {
    try {
      await col.cleanup()
    } catch {
      // ignore
    }
  }

  for (const db of createdDbs.splice(0)) {
    db.close()

    try {
      const Dexie = await getDexie()
      await Dexie.delete(db.name)
    } catch {
      // ignore
    }
  }
}
