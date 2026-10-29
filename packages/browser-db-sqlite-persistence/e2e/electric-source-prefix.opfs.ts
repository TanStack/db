/** Real SDK/OPFS receiving driver for the shared source-head convergence law.
 * HTTP responses are acquired from Electric before delivery is held. The gate
 * never synthesizes messages or positions; it only delays a tab's next response.
 */
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '../../electric-db-collection/src/electric'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { Offset } from '../../electric-db-collection/node_modules/@electric-sql/client'

type Item = { id: string; label: string }
const parameters = new URL(location.href).searchParams
const databaseId = parameters.get(`databaseId`)!
const collectionId = parameters.get(`collectionId`)!
const table = parameters.get(`table`)!
if (!databaseId || !collectionId || !table)
  throw new Error(`Missing prefix driver parameters`)
let hold = false
let refresh = false
const pending: Array<{ release: () => void; rows: number }> = []
const requests: Array<{ offset: string | null; handle: string | null }> = []
let commits = 0
let emptyCommits = 0
let openWrites = 0
const database = await openBrowserWASQLiteOPFSDatabase({
  databaseName: `${databaseId}.sqlite`,
})
const coordinator = new BrowserCollectionCoordinator({ dbName: databaseId })
const persistence = createBrowserWASQLitePersistence({ database, coordinator })
const source = electricCollectionOptions<Item>({
  id: collectionId,
  syncMode: `eager`,
  getKey: (row) => row.id,
  shapeOptions: {
    offset: (parameters.get(`offset`) ?? undefined) as Offset | undefined,
    handle: parameters.get(`handle`) ?? undefined,
    url: `${location.origin}/electric/v1/shape`,
    params: { table: `public.${table}` },
    liveSse: false,
    fetchClient: async (input, init) => {
      const url = new URL(
        typeof input === `string` || input instanceof URL ? input : input.url,
      )
      requests.push({
        offset: url.searchParams.get(`offset`),
        handle: url.searchParams.get(`handle`),
      })
      // A non-live catch-up request is answered by Electric with its actual
      // up-to-date control, including when no row changed.
      if (refresh) {
        url.searchParams.delete(`live`)
        refresh = false
      }
      const response = await fetch(url, init)
      if (hold && response.ok) {
        const messages = (await response.clone().json()) as Array<{
          headers?: { operation?: string }
        }>
        await new Promise<void>((release) =>
          pending.push({
            release,
            rows: messages.filter(
              (message) => message.headers?.operation !== undefined,
            ).length,
          }),
        )
      }
      return response
    },
  },
})
const sourceSync = source.sync
const options = persistedCollectionOptions({
  ...source,
  sync: {
    ...sourceSync,
    sync: (params: Parameters<typeof sourceSync.sync>[0]) =>
      sourceSync.sync({
        ...params,
        begin: (...args) => {
          openWrites = 0
          return params.begin(...args)
        },
        write: (...args) => {
          openWrites++
          return params.write(...args)
        },
        commit: (...args) => {
          const receipt = params.commit(...args)
          const writes = openWrites
          void Promise.resolve(receipt)
            .then(() => {
              commits++
              if (writes === 0) emptyCommits++
            })
            .catch(() => undefined)
          return receipt
        },
      }),
  },
  persistence,
})
const collection = createCollection(options)
const rows = (values: Iterable<Item>) =>
  Array.from(values, ({ id, label }) => ({ id, label })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )
let cleaned = false
const probe = {
  arm: () => {
    hold = true
  },
  refresh: () => {
    refresh = true
  },
  legacy: async () => {
    // The old format's key ledger followed arrival-order writes even when
    // its rows no longer matched the prefix named by the resume position.
    await database.execute(
      `DELETE FROM collection_metadata WHERE collection_id = ? AND key = ?`,
      [collectionId, `electric:source-progress`],
    )
    await database.execute(
      `UPDATE collection_version SET source_progress_incompatible = 0 WHERE collection_id = ?`,
      [collectionId],
    )
  },
  releaseOne: () => {
    const next = pending.shift()
    if (!next) throw new Error(`No held response`)
    next.release()
  },
  observe: async () => {
    const snapshot = await options.persistence.adapter.loadResumeSnapshot({
      kind: `eager`,
      collectionId,
    })
    return {
      status: collection.status,
      rows: rows(collection.values()),
      durableRows: rows(snapshot.rows.map(({ value }) => value as Item)),
      resume: snapshot.collectionMetadata.find(
        ({ key }) => key === `electric:resume`,
      )?.value,
      commits,
      emptyCommits,
      pending: pending.map(({ rows: count }) => count),
      requests: [...requests],
      error: collection.health.error,
    }
  },
  cleanup: async () => {
    if (cleaned) return []
    cleaned = true
    hold = false
    const cleanup = collection.cleanup()
    for (const entry of pending.splice(0)) entry.release()
    const failures: Array<string> = []
    for (const action of [
      () => cleanup,
      () => coordinator.dispose(),
      () => database.close?.(),
    ]) {
      try {
        await action()
      } catch (error) {
        failures.push(String(error))
      }
    }
    return failures
  },
}
declare global {
  interface Window {
    __electricSourcePrefix?: typeof probe
  }
}
window.__electricSourcePrefix = probe
void collection.preload().catch(() => undefined)
