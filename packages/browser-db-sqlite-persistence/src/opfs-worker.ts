import SQLiteESMFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs'
import * as SQLite from '@journeyapps/wa-sqlite'
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js'
import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persistence-core'
import { packageVersion } from './package-version'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from './opfs-worker-protocol'

const workerGlobal = globalThis as typeof globalThis & {
  postMessage: (message: BrowserOPFSWorkerResponse) => void
  addEventListener: (
    type: `message`,
    listener: (event: MessageEvent<BrowserOPFSWorkerRequest>) => void,
  ) => void
}

const SQLITE_ROW = 100
const SQLITE_DONE = 101

type SQLiteCompatibleBinding =
  null | string | number | bigint | Uint8Array | Array<number>

type WorkerOPFSGlobal = {
  navigator?: {
    storage?: {
      getDirectory?: () => Promise<unknown>
    }
  }
  FileSystemFileHandle?: {
    prototype?: {
      createSyncAccessHandle?: () => Promise<unknown>
    }
  }
}

let sqlite3Instance: ReturnType<typeof SQLite.Factory> | null = null
let sqliteDatabaseHandle: number | null = null
let opfsVfsInstance: { close?: () => Promise<void> | void } | null = null

function hasWorkerOPFSSyncAccessSupport(globalObject: unknown): boolean {
  const candidate = globalObject as WorkerOPFSGlobal
  const getDirectory = candidate.navigator?.storage?.getDirectory
  const createSyncAccessHandle =
    candidate.FileSystemFileHandle?.prototype?.createSyncAccessHandle

  return (
    typeof getDirectory === `function` &&
    typeof createSyncAccessHandle === `function`
  )
}

function toBindableValue(value: unknown): SQLiteCompatibleBinding {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === `string`) {
    return value
  }

  if (typeof value === `number`) {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === `bigint`) {
    return value
  }

  if (typeof value === `boolean`) {
    return value ? 1 : 0
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Uint8Array) {
    return value
  }

  if (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === `number` && Number.isFinite(entry))
  ) {
    return [...value]
  }

  throw new InvalidPersistedCollectionConfigError(
    `Unsupported parameter type for wa-sqlite binding`,
  )
}

function toErrorCode(error: unknown): BrowserOPFSWorkerErrorCode {
  if (error instanceof PersistenceUnavailableError) {
    return `PERSISTENCE_UNAVAILABLE`
  }
  if (error instanceof InvalidPersistedCollectionConfigError) {
    return `INVALID_CONFIG`
  }
  return `INTERNAL`
}

async function closeWorkerDatabase(): Promise<void> {
  const sqlite3 = sqlite3Instance
  const dbHandle = sqliteDatabaseHandle
  const vfs = opfsVfsInstance

  sqlite3Instance = null
  sqliteDatabaseHandle = null
  opfsVfsInstance = null

  let closeError: unknown
  if (sqlite3 && dbHandle !== null) {
    try {
      await sqlite3.close(dbHandle)
    } catch (error) {
      closeError = error
    }
  }

  try {
    await Promise.resolve(vfs?.close?.())
  } catch (error) {
    closeError ??= error
  }

  if (closeError) {
    throw closeError
  }
}

async function initializeWorkerDatabase(request: {
  databaseName: string
  vfsName: string
  wasmUrl: string
  packageVersion: string
}): Promise<void> {
  if (request.packageVersion !== packageVersion) {
    throw new PersistenceUnavailableError(
      `The OPFS worker is ${packageVersion}, but its opener is ${request.packageVersion}. Install one copy of the package, or exclude it from Vite pre-bundling.`,
    )
  }
  if (!hasWorkerOPFSSyncAccessSupport(workerGlobal)) {
    throw new PersistenceUnavailableError(
      `Browser OPFS sync access is not available in this worker runtime`,
    )
  }

  await closeWorkerDatabase()

  // The WASM file is a separate asset, so loading it is part of the capability.
  const sqliteModule = await SQLiteESMFactory({
    locateFile: () => request.wasmUrl,
  }).catch((error: unknown) => {
    throw new PersistenceUnavailableError(
      `Failed to load wa-sqlite WebAssembly from ${request.wasmUrl}: ${String(error)}`,
    )
  })
  const sqlite3 = SQLite.Factory(sqliteModule)
  const opfsVfs = await OPFSCoopSyncVFS.create(request.vfsName, sqliteModule)
  sqlite3.vfs_register(opfsVfs as never, true)

  const openFlags =
    SQLite.SQLITE_OPEN_CREATE |
    SQLite.SQLITE_OPEN_READWRITE |
    SQLite.SQLITE_OPEN_URI
  const databaseFileUri = `file:${request.databaseName}?vfs=${encodeURIComponent(request.vfsName)}`
  let dbHandle: number
  try {
    dbHandle = await sqlite3.open_v2(
      databaseFileUri,
      openFlags,
      request.vfsName,
    )
  } catch (error) {
    const cause = opfsVfs.lastError
    if (error instanceof Error && cause instanceof Error) {
      throw new Error(`${error.message}: ${cause.name}: ${cause.message}`, {
        cause,
      })
    }
    throw error
  }

  sqlite3Instance = sqlite3
  sqliteDatabaseHandle = dbHandle
  opfsVfsInstance = opfsVfs
}

function getInitializedDatabaseState(): {
  sqlite3: ReturnType<typeof SQLite.Factory>
  dbHandle: number
} {
  if (!sqlite3Instance || sqliteDatabaseHandle === null) {
    throw new InvalidPersistedCollectionConfigError(
      `OPFS worker database has not been initialized`,
    )
  }

  return {
    sqlite3: sqlite3Instance,
    dbHandle: sqliteDatabaseHandle,
  }
}

async function executeSqlInWorker(
  sql: string,
  params: ReadonlyArray<unknown>,
): Promise<ReadonlyArray<Record<string, unknown>>> {
  const { sqlite3, dbHandle } = getInitializedDatabaseState()
  const rows = new Array<Record<string, unknown>>()
  let parametersBound = false

  for await (const statement of sqlite3.statements(dbHandle, sql)) {
    if (params.length > 0) {
      if (parametersBound) {
        throw new InvalidPersistedCollectionConfigError(
          `wa-sqlite worker only supports parameter binding for a single SQL statement`,
        )
      }

      sqlite3.bind_collection(
        statement,
        params.map((param) => toBindableValue(param)),
      )
      parametersBound = true
    }

    let columns = [...sqlite3.column_names(statement)]
    for (;;) {
      const stepResult = await sqlite3.step(statement)

      if (stepResult === SQLITE_ROW) {
        if (columns.length === 0) {
          columns = [...sqlite3.column_names(statement)]
        }
        const values = sqlite3.row(statement)
        const row: Record<string, unknown> = {}
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const columnName = columns[columnIndex]
          if (!columnName) {
            continue
          }
          row[columnName] = values[columnIndex]
        }
        rows.push(row)
        continue
      }

      if (stepResult === SQLITE_DONE) {
        break
      }

      throw new InvalidPersistedCollectionConfigError(
        `wa-sqlite step returned unexpected result code: ${String(stepResult)}`,
      )
    }
  }

  if (params.length > 0 && !parametersBound) {
    throw new InvalidPersistedCollectionConfigError(
      `SQL query parameters were provided but no statement accepted bindings`,
    )
  }

  return rows
}

async function handleWorkerRequest(
  request: BrowserOPFSWorkerRequest,
): Promise<BrowserOPFSWorkerResponse> {
  try {
    switch (request.type) {
      case `init`:
        await initializeWorkerDatabase(request)
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
        }
      case `execute`: {
        const rows = await executeSqlInWorker(request.sql, request.params)
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
          rows,
        }
      }
      case `close`:
        await closeWorkerDatabase()
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
        }
      default:
        throw new InvalidPersistedCollectionConfigError(
          `Unknown OPFS worker request type`,
        )
    }
  } catch (error) {
    return {
      type: `response`,
      requestId: request.requestId,
      ok: false,
      code: toErrorCode(error),
      error: (error as Error).message,
    }
  }
}

// The worker owns one SQLite connection, so it handles one request at a time.
// A statement waiting for the OPFS access handle yields to later messages;
// queuing keeps close from running while that statement is unfinalized.
let previousRequest = Promise.resolve()
workerGlobal.addEventListener(`message`, (event) => {
  previousRequest = previousRequest
    .then(() => handleWorkerRequest(event.data))
    .then((response) => {
      workerGlobal.postMessage(response)
    })
    // A failed reply must not stall later requests; surface it as an uncaught
    // worker error, which the connection treats as terminal.
    .catch((error: unknown) => {
      queueMicrotask(() => {
        throw error
      })
    })
})
