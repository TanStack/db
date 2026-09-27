/**
 * Browser driver for the #1589 host history. The fixture uses real OPFS worker
 * handles, Web Locks, BroadcastChannel, and the installed Electric SDK against
 * the Playwright suite's PostgreSQL/Electric services. The spec supplies the
 * independent PostgreSQL rows and checks public plus durable Collection rows.
 * It does not claim Firefox/Zen, React rendering, or an exclusive-owner design.
 */
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { ElectricCollectionUtils } from '../../electric-db-collection/src/electric'
import type { BrowserWASQLiteDatabase } from '../src/index'

type Item = { id: string; label: string }

export type ElectricShapeRequest = {
  table: string | null
  offset: string | null
  handle: string | null
}

export type ElectricCollectionObservation = {
  collectionId: string
  schemaVersion: number
  status: string
  isLeader: boolean
  publicRows: Array<Item>
  durableRows: Array<Item>
  resetEpoch: number
  resume: unknown
}

export type ElectricOPFSObservation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  collections: Array<ElectricCollectionObservation>
  shapeRequests: Array<ElectricShapeRequest>
}

export type LegacyPoisonObservation = {
  resumeOffset: string
  rowsBefore: number
  rowsAfter: number
  metadataPreserved: boolean
}

type ElectricOPFSProbe = {
  phase: () => ElectricOPFSObservation[`phase`]
  diagnostic: () => {
    phase: ElectricOPFSObservation[`phase`]
    stage: string
    collections: Array<{ status: string; rows: Array<Item>; isLeader: boolean }>
    shapeRequests: Array<ElectricShapeRequest>
  }
  observe: () => Promise<ElectricOPFSObservation>
  poisonLegacy: (
    collectionId: string,
    missingId: string,
  ) => Promise<LegacyPoisonObservation>
  cleanup: () => Promise<Array<string>>
}

declare global {
  interface Window {
    __electricOPFSProbe?: ElectricOPFSProbe
  }
}

const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)
const collectionAId = parameters.get(`collectionAId`)
const collectionBId = parameters.get(`collectionBId`)
const tableA = parameters.get(`tableA`)
const tableB = parameters.get(`tableB`)
const mode = parameters.get(`mode`)
if (!databaseId || !collectionAId || !collectionBId || !tableA || !tableB) {
  throw new Error(`Missing Electric OPFS oracle parameters`)
}
if (mode !== `normal` && mode !== `maintenance`) {
  throw new Error(`Invalid Electric OPFS oracle mode`)
}

let phase: ElectricOPFSObservation[`phase`] = `starting`
let stage = `opening database`
let failure: string | undefined
let diagnosticCollections = (): Array<{
  status: string
  rows: Array<Item>
  isLeader: boolean
}> => []
let readCollections = (): Promise<Array<ElectricCollectionObservation>> =>
  Promise.resolve([])
let poisonLegacy: ElectricOPFSProbe[`poisonLegacy`] = () =>
  Promise.reject(new Error(`Legacy poison mode is not active`))
let cleaned = false
const cleanupTasks: Array<() => Promise<void> | void> = []
const shapeRequests: Array<ElectricShapeRequest> = []

const originalFetch = window.fetch
window.fetch = (input, init) => {
  const requestUrl =
    typeof input === `string`
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  const url = new URL(requestUrl, location.href)
  if (url.pathname === `/electric/v1/shape`) {
    shapeRequests.push({
      table: url.searchParams.get(`table`),
      offset: url.searchParams.get(`offset`),
      handle: url.searchParams.get(`handle`),
    })
  }
  return originalFetch.call(window, input, init)
}
cleanupTasks.unshift(() => {
  window.fetch = originalFetch
})

window.__electricOPFSProbe = {
  phase: () => phase,
  diagnostic: () => ({
    phase,
    stage,
    collections: diagnosticCollections(),
    shapeRequests: [...shapeRequests],
  }),
  observe: async () => ({
    phase,
    ...(failure ? { failure } : {}),
    collections: await readCollections(),
    shapeRequests: [...shapeRequests],
  }),
  poisonLegacy: (collectionId, missingId) =>
    poisonLegacy(collectionId, missingId),
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
    const failures: Array<string> = []
    for (const cleanup of cleanupTasks) {
      try {
        await cleanup()
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    return failures
  },
}

function rowsFromSnapshot(
  rows: Array<{ value: Record<string, unknown> }>,
): Array<Item> {
  return rows
    .map(({ value }) => ({
      id: String(value.id),
      label: String(value.label),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

function quoteTrustedIdentifier(identifier: string): string {
  if (!/^[a-z0-9_]+$/i.test(identifier)) {
    throw new Error(`Unexpected SQLite identifier in oracle fixture`)
  }
  return `"${identifier}"`
}

async function poisonLegacyResume(
  database: BrowserWASQLiteDatabase,
  collectionId: string,
  missingId: string,
): Promise<LegacyPoisonObservation> {
  const registration = await database.execute<{ table_name: string }>(
    `SELECT table_name FROM collection_registry WHERE collection_id = ?`,
    [collectionId],
  )
  const tableName = registration[0]?.table_name
  if (!tableName) throw new Error(`Missing persisted collection registration`)
  const collectionTable = quoteTrustedIdentifier(tableName)

  const metadataBefore = await database.execute<{ value: string }>(
    `SELECT value FROM collection_metadata WHERE collection_id = ? AND key = ?`,
    [collectionId, `electric:resume`],
  )
  const resume = metadataBefore[0]
    ? (JSON.parse(metadataBefore[0].value) as unknown)
    : undefined
  if (
    !resume ||
    typeof resume !== `object` ||
    !(`kind` in resume) ||
    resume.kind !== `resume` ||
    !(`offset` in resume) ||
    typeof resume.offset !== `string`
  ) {
    throw new Error(`Expected an Electric resume marker before legacy poison`)
  }

  const before = await database.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${collectionTable}`,
  )
  await database.execute(
    `DELETE FROM ${collectionTable} WHERE json_extract(value, '$.id') = ?`,
    [missingId],
  )
  const after = await database.execute<{ count: number }>(
    `SELECT COUNT(*) AS count FROM ${collectionTable}`,
  )
  const rowsBefore = before[0]?.count ?? -1
  const rowsAfter = after[0]?.count ?? -1
  if (rowsBefore - rowsAfter !== 1) {
    throw new Error(`Legacy poison did not remove exactly one durable row`)
  }

  // This reproduces the pre-key-ledger format, where an old resume marker
  // could outlive a lost row without durable evidence that the set was torn.
  const evidenceTriggers = await database.execute<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_key_evidence_%'`,
  )
  for (const { name } of evidenceTriggers) {
    await database.execute(`DROP TRIGGER ${quoteTrustedIdentifier(name)}`)
  }
  await database.execute(`DROP TABLE collection_expected_keys`)
  await database.execute(
    `ALTER TABLE collection_version RENAME TO collection_version_with_ledger`,
  )
  await database.execute(
    `CREATE TABLE collection_version (
      collection_id TEXT PRIMARY KEY,
      latest_row_version INTEGER NOT NULL
    )`,
  )
  await database.execute(
    `INSERT INTO collection_version (collection_id, latest_row_version)
     SELECT collection_id, latest_row_version
     FROM collection_version_with_ledger`,
  )
  await database.execute(`DROP TABLE collection_version_with_ledger`)

  const metadataAfter = await database.execute<{ value: string }>(
    `SELECT value FROM collection_metadata WHERE collection_id = ? AND key = ?`,
    [collectionId, `electric:resume`],
  )
  return {
    resumeOffset: resume.offset,
    rowsBefore,
    rowsAfter,
    metadataPreserved: metadataAfter[0]?.value === metadataBefore[0]?.value,
  }
}

try {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `${databaseId}.sqlite`,
  })
  stage = `database open`
  cleanupTasks.unshift(async () => database.close?.())

  if (mode === `maintenance`) {
    poisonLegacy = (collectionId, missingId) =>
      poisonLegacyResume(database, collectionId, missingId)
    phase = `ready`
  } else {
    stage = `building collections`
    const coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
    cleanupTasks.unshift(() => coordinator.dispose())
    const persistence = createBrowserWASQLitePersistence({
      database,
      coordinator,
    })
    const cells = [
      { collectionId: collectionAId, table: tableA, schemaVersion: 1 },
      { collectionId: collectionBId, table: tableB, schemaVersion: 2 },
    ].map(({ collectionId, table, schemaVersion }) => {
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
          getKey: (item) => item.id,
        }),
        persistence,
        schemaVersion,
      })
      const collection = createCollection(options)
      cleanupTasks.unshift(() => collection.cleanup())
      return {
        collectionId,
        schemaVersion,
        adapter: options.persistence.adapter,
        collection,
      }
    })
    diagnosticCollections = () =>
      cells.map(({ collectionId, collection }) => ({
        status: collection.status,
        rows: Array.from(collection.values(), ({ id, label }) => ({
          id,
          label,
        })),
        isLeader: coordinator.isLeader(collectionId),
      }))
    readCollections = async () =>
      Promise.all(
        cells.map(async ({ collectionId, adapter, collection }) => {
          const snapshot = await adapter.loadResumeSnapshot(collectionId)
          const registry = await database.execute<{ schema_version: number }>(
            `SELECT schema_version FROM collection_registry WHERE collection_id = ?`,
            [collectionId],
          )
          return {
            collectionId,
            schemaVersion: registry[0]?.schema_version ?? -1,
            status: collection.status,
            isLeader: coordinator.isLeader(collectionId),
            publicRows: Array.from(collection.values(), ({ id, label }) => ({
              id,
              label,
            })).sort((left, right) => left.id.localeCompare(right.id)),
            durableRows: rowsFromSnapshot(snapshot.rows),
            resetEpoch: snapshot.resetEpoch,
            resume: snapshot.collectionMetadata.find(
              ({ key }) => key === `electric:resume`,
            )?.value,
          } satisfies ElectricCollectionObservation
        }),
      )
    stage = `preloading collections`
    await Promise.all(cells.map(({ collection }) => collection.preload()))
    stage = `collections preloaded`
    phase = `ready`
  }
} catch (error) {
  failure =
    error instanceof Error
      ? `${error.name}: ${error.message}\n${error.stack ?? ``}`
      : String(error)
  phase = `failed`
}
