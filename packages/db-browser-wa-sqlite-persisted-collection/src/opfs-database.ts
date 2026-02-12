import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persisted-collection-core'
import type {
  BrowserWASQLiteAPI,
  BrowserWASQLiteDatabase,
} from './wa-sqlite-driver'

const DEFAULT_WASM_MODULE_PATH = `@journeyapps/wa-sqlite/dist/wa-sqlite.mjs`
const DEFAULT_SQLITE_API_MODULE_PATH = `@journeyapps/wa-sqlite`
const DEFAULT_OPFS_VFS_MODULE_PATH = `@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js`
const DEFAULT_VFS_NAME = `opfs`

type WASQLiteModuleFactory = (config?: object) => Promise<unknown>

type WASQLiteRuntimeModule = {
  Factory: (module: unknown) => BrowserWASQLiteAPI
  SQLITE_OPEN_CREATE: number
  SQLITE_OPEN_READWRITE: number
  SQLITE_OPEN_URI: number
}

type OPFSVFSLike = {
  close?: () => Promise<void> | void
}

type OPFSCoopSyncVFSFactory = {
  create: (name: string, module: unknown) => Promise<OPFSVFSLike>
}

type BrowserOPFSGlobal = {
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

export type OpenBrowserWASQLiteOPFSDatabaseOptions = {
  databaseName: string
  vfsName?: string
  wasmModulePath?: string
  sqliteApiModulePath?: string
  opfsVfsModulePath?: string
}

function hasOPFSSyncAccessSupport(globalObject: unknown): boolean {
  const candidate = globalObject as BrowserOPFSGlobal
  const getDirectory = candidate.navigator?.storage?.getDirectory
  const createSyncAccessHandle =
    candidate.FileSystemFileHandle?.prototype?.createSyncAccessHandle

  return (
    typeof getDirectory === `function` &&
    typeof createSyncAccessHandle === `function`
  )
}

function toWASQLiteRuntimeModule(
  moduleValue: unknown,
  modulePath: string,
): WASQLiteRuntimeModule {
  if (typeof moduleValue !== `object` || moduleValue === null) {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid wa-sqlite API module loaded from "${modulePath}"`,
    )
  }

  const candidate = moduleValue as Partial<WASQLiteRuntimeModule>
  if (
    typeof candidate.Factory !== `function` ||
    typeof candidate.SQLITE_OPEN_CREATE !== `number` ||
    typeof candidate.SQLITE_OPEN_READWRITE !== `number` ||
    typeof candidate.SQLITE_OPEN_URI !== `number`
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite API module "${modulePath}" is missing required exports`,
    )
  }

  return candidate as WASQLiteRuntimeModule
}

function toOPFSCoopSyncVFSFactory(
  moduleValue: unknown,
  modulePath: string,
): OPFSCoopSyncVFSFactory {
  if (typeof moduleValue !== `object` || moduleValue === null) {
    throw new InvalidPersistedCollectionConfigError(
      `Invalid OPFS VFS module loaded from "${modulePath}"`,
    )
  }

  const moduleRecord = moduleValue as Record<string, unknown>
  const exportCandidate = moduleRecord.OPFSCoopSyncVFS ?? moduleRecord.default
  if (
    typeof exportCandidate !== `object` ||
    exportCandidate === null ||
    typeof (exportCandidate as { create?: unknown }).create !== `function`
  ) {
    throw new InvalidPersistedCollectionConfigError(
      `OPFS VFS module "${modulePath}" does not export OPFSCoopSyncVFS.create(...)`,
    )
  }

  return exportCandidate as OPFSCoopSyncVFSFactory
}

function assertOpenApiMethods(
  sqlite3: BrowserWASQLiteAPI,
): asserts sqlite3 is BrowserWASQLiteAPI & {
  open_v2: (
    filename: string,
    flags?: number,
    vfsName?: string,
  ) => Promise<number>
  vfs_register: (vfs: unknown, makeDefault?: boolean) => number
  close: (db: number) => Promise<number> | number
} {
  if (typeof sqlite3.vfs_register !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite API instance is missing vfs_register(...)`,
    )
  }

  if (typeof sqlite3.open_v2 !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite API instance is missing open_v2(...)`,
    )
  }

  if (typeof sqlite3.close !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `wa-sqlite API instance is missing close(...)`,
    )
  }
}

/**
 * Creates a browser wa-sqlite database handle backed by OPFS and
 * OPFSCoopSyncVFS.
 */
export async function openBrowserWASQLiteOPFSDatabase(
  options: OpenBrowserWASQLiteOPFSDatabaseOptions,
): Promise<BrowserWASQLiteDatabase> {
  const databaseName = options.databaseName.trim()
  if (databaseName.length === 0) {
    throw new InvalidPersistedCollectionConfigError(
      `Browser wa-sqlite databaseName cannot be empty`,
    )
  }

  if (!hasOPFSSyncAccessSupport(globalThis)) {
    throw new PersistenceUnavailableError(
      `Browser OPFS sync access is not available in this runtime`,
    )
  }

  const wasmModulePath = options.wasmModulePath ?? DEFAULT_WASM_MODULE_PATH
  const sqliteApiModulePath =
    options.sqliteApiModulePath ?? DEFAULT_SQLITE_API_MODULE_PATH
  const opfsVfsModulePath =
    options.opfsVfsModulePath ?? DEFAULT_OPFS_VFS_MODULE_PATH
  const vfsName = options.vfsName ?? DEFAULT_VFS_NAME

  const moduleFactoryImport = (await import(
    /* @vite-ignore */ wasmModulePath
  )) as {
    default?: WASQLiteModuleFactory
  }
  const moduleFactory = moduleFactoryImport.default
  if (typeof moduleFactory !== `function`) {
    throw new InvalidPersistedCollectionConfigError(
      `WASM module "${wasmModulePath}" does not expose a default module factory`,
    )
  }

  const sqliteImport = await import(/* @vite-ignore */ sqliteApiModulePath)
  const sqliteRuntime = toWASQLiteRuntimeModule(
    sqliteImport,
    sqliteApiModulePath,
  )

  const sqliteModule = await moduleFactory()
  const sqlite3 = sqliteRuntime.Factory(sqliteModule)
  assertOpenApiMethods(sqlite3)

  const opfsVfsImport = await import(/* @vite-ignore */ opfsVfsModulePath)
  const opfsFactory = toOPFSCoopSyncVFSFactory(opfsVfsImport, opfsVfsModulePath)
  const opfsVfs = await opfsFactory.create(vfsName, sqliteModule)

  sqlite3.vfs_register(opfsVfs as never, true)
  const openFlags =
    sqliteRuntime.SQLITE_OPEN_CREATE |
    sqliteRuntime.SQLITE_OPEN_READWRITE |
    sqliteRuntime.SQLITE_OPEN_URI
  const databaseFileUri = `file:${databaseName}?vfs=${encodeURIComponent(vfsName)}`
  const db = await sqlite3.open_v2(databaseFileUri, openFlags, vfsName)

  return {
    sqlite3,
    db,
    close: async () => {
      await Promise.resolve(sqlite3.close(db))
      await Promise.resolve(opfsVfs.close?.())
    },
  }
}
