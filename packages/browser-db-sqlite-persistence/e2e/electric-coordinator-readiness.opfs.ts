import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '../src/index'
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'

type Row = { id: string; title: string }
type Mode = `non-empty` | `empty` | `network-wins` | `on-demand`

type ReadinessObservation = {
  mode: Mode
  status: string
  rows: Array<Row>
  readyEvents: number
  hydrationCalls: number
  upstreamRequests: number
  readyBeforeHydrationRelease: boolean
}

export type ReadinessOracleResult =
  | {
      status: `complete`
      provider: `Chromium OPFSCoopSyncVFS + BrowserCollectionCoordinator + Electric ShapeStream`
      observation: ReadinessObservation
      cleanupFailures: ReadonlyArray<string>
    }
  | {
      status: `failed-before-checkpoint`
      provider: `Chromium OPFSCoopSyncVFS + BrowserCollectionCoordinator + Electric ShapeStream`
      primaryFailure: string
      cleanupFailures: ReadonlyArray<string>
    }

declare global {
  interface Window {
    __tanstackElectricCoordinatorReadiness?: ReadinessOracleResult
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function currentMode(): Mode {
  const mode = new URL(location.href).searchParams.get(`mode`)
  if (mode === `empty` || mode === `network-wins` || mode === `on-demand`) {
    return mode
  }
  return `non-empty`
}

function publicRows(rows: ReadonlyArray<Row>): Array<Row> {
  return rows
    .map((row) => ({ id: row.id, title: row.title }))
    .sort((left, right) => left.id.localeCompare(right.id))
}

async function removeOPFSArtifacts(
  databaseName: string,
): Promise<ReadonlyArray<string>> {
  const failures: Array<string> = []
  const root = await navigator.storage.getDirectory()
  for (const suffix of [``, `-journal`, `-wal`]) {
    try {
      await root.removeEntry(`${databaseName}${suffix}`)
    } catch (error) {
      if (!(error instanceof DOMException && error.name === `NotFoundError`)) {
        failures.push(
          `${databaseName}${suffix}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }
  }

  const iterableRoot = root as FileSystemDirectoryHandle & {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>
  }
  for await (const [name, handle] of iterableRoot.entries()) {
    if (handle.kind !== `directory` || !name.startsWith(`.ahp-`)) continue
    try {
      await root.removeEntry(name, { recursive: true })
    } catch (error) {
      failures.push(
        `${name}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return failures
}

async function nextFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

async function observe(mode: Mode): Promise<ReadinessObservation> {
  const databaseName = `r6-${crypto.randomUUID()}.sqlite`
  const collectionId = `electric-${mode}`
  const cleanupTasks: Array<() => void | Promise<void>> = []
  const hydrationRelease = deferred()
  let outcome:
    | { ok: true; observation: ReadinessObservation }
    | { ok: false; error: unknown }
  try {
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
    cleanupTasks.unshift(async () => {
      await Promise.resolve(database.close?.())
    })
    const coordinator = new BrowserCollectionCoordinator({
      dbName: databaseName,
    })
    cleanupTasks.unshift(() => coordinator.dispose())
    const rootPersistence = createBrowserWASQLitePersistence({
      database,
      coordinator,
    })
    const persistence = rootPersistence.resolvePersistenceForCollection?.({
      collectionId,
      mode: `sync-present`,
    })
    if (!persistence) {
      throw new Error(`Browser persistence did not resolve sync-present mode`)
    }

    const seededRows: Array<Row> =
      mode === `non-empty`
        ? [{ id: `persisted`, title: `Persisted while upstream is pending` }]
        : mode === `network-wins`
          ? [{ id: `stale`, title: `Late local row` }]
          : []
    if (seededRows.length > 0) {
      await persistence.adapter.applyCommittedTx(collectionId, {
        txId: `seed`,
        term: 1,
        seq: 1,
        rowVersion: 1,
        mutations: seededRows.map((row) => ({
          type: `insert` as const,
          key: row.id,
          value: row,
        })),
      })
    }

    let hydrationCalls = 0
    const hydrationReturned = deferred()
    const loadSubset = persistence.adapter.loadSubset.bind(persistence.adapter)
    persistence.adapter.loadSubset = async (...args) => {
      hydrationCalls++
      const rows = await loadSubset(...args)
      if (mode === `network-wins`) await hydrationRelease.promise
      hydrationReturned.resolve()
      return rows
    }

    let upstreamRequests = 0
    let deliveredNetworkSnapshot = false
    const upstreamRequested = deferred()
    const fetchClient: typeof fetch = (_input, init) => {
      upstreamRequests++
      upstreamRequested.resolve()
      if (mode === `network-wins` && !deliveredNetworkSnapshot) {
        deliveredNetworkSnapshot = true
        return Promise.resolve(
          new Response(
            JSON.stringify([
              {
                key: `network`,
                value: { id: `network`, title: `Network winner` },
                headers: { operation: `insert` },
              },
              {
                headers: {
                  control: `up-to-date`,
                  global_last_seen_lsn: `1`,
                },
              },
            ]),
            {
              headers: {
                'electric-handle': `network-shape`,
                'electric-offset': `1_0`,
                'electric-schema': JSON.stringify({
                  id: { type: `text` },
                  title: { type: `text` },
                }),
              },
            },
          ),
        )
      }
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        const abort = () =>
          reject(
            signal?.reason ??
              new DOMException(`Electric request aborted`, `AbortError`),
          )
        if (signal?.aborted) abort()
        else signal?.addEventListener(`abort`, abort, { once: true })
      })
    }

    const collection = createCollection(
      persistedCollectionOptions<
        Row,
        string | number,
        never,
        ElectricCollectionUtils<Row>
      >({
        ...electricCollectionOptions<Row>({
          id: collectionId,
          shapeOptions: {
            url: `http://electric.invalid/v1/shape`,
            params: { table: `todos` },
            fetchClient,
          },
          syncMode: mode === `on-demand` ? `on-demand` : `eager`,
          startSync: true,
          getKey: (row) => row.id,
        }),
        persistence,
      }),
    )
    cleanupTasks.unshift(() => collection.cleanup())
    let readyEvents = 0
    const readyObserved = deferred()
    collection.on(`status:ready`, () => {
      readyEvents++
      readyObserved.resolve()
    })

    await upstreamRequested.promise
    let readyBeforeHydrationRelease = false
    if (mode === `network-wins`) {
      await readyObserved.promise
      readyBeforeHydrationRelease = collection.status === `ready`
      hydrationRelease.resolve()
      await hydrationReturned.promise
    } else if (mode !== `on-demand`) {
      await hydrationReturned.promise
    }
    await nextFrame()
    await nextFrame()
    outcome = {
      ok: true,
      observation: {
        mode,
        status: collection.status,
        rows: publicRows(collection.toArray),
        readyEvents,
        hydrationCalls,
        upstreamRequests,
        readyBeforeHydrationRelease,
      },
    }
  } catch (error) {
    outcome = { ok: false, error }
  }

  hydrationRelease.resolve()
  const cleanupFailures: Array<unknown> = []
  for (const cleanup of cleanupTasks) {
    try {
      await cleanup()
    } catch (error) {
      cleanupFailures.push(error)
    }
  }
  try {
    cleanupFailures.push(...(await removeOPFSArtifacts(databaseName)))
  } catch (error) {
    cleanupFailures.push(error)
  }

  if (!outcome.ok) {
    if (cleanupFailures.length > 0) {
      throw new AggregateError(
        cleanupFailures,
        `Readiness observation failed`,
        {
          cause: outcome.error,
        },
      )
    }
    throw outcome.error
  }
  if (cleanupFailures.length > 0) {
    throw new AggregateError(cleanupFailures, `OPFS cleanup failed`)
  }
  return outcome.observation
}

async function run(): Promise<void> {
  const provider =
    `Chromium OPFSCoopSyncVFS + BrowserCollectionCoordinator + Electric ShapeStream` as const
  const status = document.querySelector<HTMLOutputElement>(`#oracle-status`)
  let cleanupFailures: ReadonlyArray<string> = []
  try {
    const observation = await observe(currentMode())
    window.__tanstackElectricCoordinatorReadiness = {
      status: `complete`,
      provider,
      observation,
      cleanupFailures,
    }
    if (status) status.value = `complete`
  } catch (error) {
    if (error instanceof AggregateError) {
      cleanupFailures = error.errors.map(String)
    }
    const primaryError =
      error instanceof AggregateError && error.cause !== undefined
        ? error.cause
        : error
    window.__tanstackElectricCoordinatorReadiness = {
      status: `failed-before-checkpoint`,
      provider,
      primaryFailure:
        primaryError instanceof Error
          ? primaryError.message
          : String(primaryError),
      cleanupFailures,
    }
    if (status) status.value = `failed-before-checkpoint`
  }
}

void run()
