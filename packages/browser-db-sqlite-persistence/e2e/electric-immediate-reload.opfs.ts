/**
 * Browser driver for the insert -> awaitTxId -> immediate reload history.
 * PostgreSQL owns the expected row. The hold is before the OPFS adapter write,
 * so a successful awaitTxId cannot accidentally stand in for local durability.
 * This fixture exercises Chromium, not the reporter's Windows/Edge host.
 */
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { ElectricCollectionUtils } from '../../electric-db-collection/src/electric'

type Item = { id: string; label: string }

export type ImmediateReloadObservation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  status: string
  insertAcknowledged: boolean
  sourcePersistenceHeld: boolean
  publicRows: Array<Item>
  durableRows: Array<Item>
}

type ImmediateReloadProbe = {
  phase: () => ImmediateReloadObservation[`phase`]
  insert: (row: Item) => Promise<void>
  observe: () => Promise<ImmediateReloadObservation>
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __electricImmediateReloadProbe?: ImmediateReloadProbe
  }
}

function gate(): { promise: Promise<void>; open: () => void } {
  let open!: () => void
  const promise = new Promise<void>((resolve) => {
    open = resolve
  })
  return { promise, open }
}

function sortedRows(rows: Iterable<Item>): Array<Item> {
  return Array.from(rows, ({ id, label }) => ({ id, label })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )
}

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const collectionId = parameters.get(`collectionId`)
const table = parameters.get(`table`)
const mode = parameters.get(`mode`)
if (!databaseId || !collectionId || !table) {
  throw new Error(`Missing Electric immediate-reload parameters`)
}
if (mode !== `hold` && mode !== `plain`) {
  throw new Error(`Invalid Electric immediate-reload mode`)
}

const releasePersistence = gate()
let phase: ImmediateReloadObservation[`phase`] = `starting`
let failure: string | undefined
let insertAcknowledged = false
let sourcePersistenceHeld = false
let status = () => `unavailable`
let publicRows = (): Array<Item> => []
let durableRows = (): Promise<Array<Item>> => Promise.resolve([])
let insert: ImmediateReloadProbe[`insert`] = () =>
  Promise.reject(new Error(`Collection is not ready`))
let cleaned = false
const cleanupTasks: Array<() => Promise<void> | void> = []

window.__electricImmediateReloadProbe = {
  phase: () => phase,
  insert: (row) => insert(row),
  observe: async () => ({
    phase,
    ...(failure ? { failure } : {}),
    status: status(),
    insertAcknowledged,
    sourcePersistenceHeld,
    publicRows: publicRows(),
    durableRows: await durableRows(),
  }),
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
    releasePersistence.open()
    const failures: Array<string> = []
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(failureMessage(error))
      }
    }
    return failures
  },
}

try {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  cleanupTasks.unshift(async () => database.close?.())
  const persistence = createBrowserWASQLitePersistence({ database })
  const options = persistedCollectionOptions<
    Item,
    string | number,
    never,
    ElectricCollectionUtils<Item>
  >({
    ...electricCollectionOptions<Item>({
      id: collectionId,
      shapeOptions: {
        url: `${location.origin}/electric/v1/shape`,
        params: { table: `public.${table}` },
      },
      syncMode: `eager`,
      getKey: (row) => row.id,
      onInsert: async ({ transaction, collection }) => {
        const row = transaction.mutations[0].modified
        const response = await fetch(`/__issue1456/insert`, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify(row),
        })
        if (!response.ok) {
          throw new Error(`PostgreSQL insert failed: ${await response.text()}`)
        }
        const result: unknown = await response.json()
        if (
          !result ||
          typeof result !== `object` ||
          !(`txid` in result) ||
          typeof result.txid !== `number`
        ) {
          throw new Error(`PostgreSQL insert returned no numeric txid`)
        }
        await collection.utils.awaitTxId(result.txid, 60_000)
      },
    }),
    persistence,
    schemaVersion: 1,
  })

  const adapter = options.persistence.adapter
  const applyCommittedTx = adapter.applyCommittedTx.bind(adapter)
  adapter.applyCommittedTx = async (id, tx) => {
    if (
      mode === `hold` &&
      tx.mutations.some((mutation) => mutation.type !== `delete`)
    ) {
      sourcePersistenceHeld = true
      await releasePersistence.promise
    }
    await applyCommittedTx(id, tx)
  }

  const collection = createCollection(options)
  cleanupTasks.unshift(() => collection.cleanup())
  status = () => collection.status
  publicRows = () => sortedRows(collection.values())
  durableRows = async () => {
    const snapshot = await adapter.loadResumeSnapshot(collectionId)
    return sortedRows(snapshot.rows.map(({ value }) => value as Item))
  }
  insert = async (row) => {
    try {
      const transaction = collection.insert(row)
      await transaction.isPersisted.promise
      insertAcknowledged = true
    } catch (error) {
      failure = failureMessage(error)
      phase = `failed`
      throw error
    }
  }
  await collection.preload()
  phase = `ready`
} catch (error) {
  failure = failureMessage(error)
  phase = `failed`
}
