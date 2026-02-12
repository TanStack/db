import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persisted-collection-core'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { createWASQLiteTestDatabase } from './helpers/wa-sqlite-test-db'

const activeCleanupFns: Array<() => void | Promise<void>> = []

afterEach(async () => {
  while (activeCleanupFns.length > 0) {
    const cleanupFn = activeCleanupFns.pop()
    await Promise.resolve(cleanupFn?.())
  }
})

function createTempSqlitePath(): string {
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-browser-single-tab-test-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  activeCleanupFns.push(() => {
    rmSync(tempDirectory, { recursive: true, force: true })
  })
  return dbPath
}

it(`works without browser election primitives`, async () => {
  const dbPath = createTempSqlitePath()
  const database = createWASQLiteTestDatabase({
    filename: dbPath,
  })
  activeCleanupFns.push(() => Promise.resolve(database.close?.()))

  const originalBroadcastDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    `BroadcastChannel`,
  )
  Object.defineProperty(globalThis, `BroadcastChannel`, {
    value: class {
      constructor() {
        throw new Error(`BroadcastChannel should not be used in single-tab mode`)
      }
    },
    configurable: true,
    writable: true,
  })
  activeCleanupFns.push(() => {
    if (originalBroadcastDescriptor) {
      Object.defineProperty(globalThis, `BroadcastChannel`, originalBroadcastDescriptor)
      return
    }
    Reflect.deleteProperty(globalThis, `BroadcastChannel`)
  })

  const navigatorWithOptionalLocks = globalThis.navigator as
    | (Navigator & { locks?: unknown })
    | undefined
  const originalLocks = navigatorWithOptionalLocks?.locks
  if (navigatorWithOptionalLocks) {
    try {
      Object.defineProperty(navigatorWithOptionalLocks, `locks`, {
        value: {
          request: () => {
            throw new Error(`Web Locks should not be used in single-tab mode`)
          },
        },
        configurable: true,
        writable: true,
      })
      activeCleanupFns.push(() => {
        Object.defineProperty(navigatorWithOptionalLocks, `locks`, {
          value: originalLocks,
          configurable: true,
          writable: true,
        })
      })
    } catch {
      // Some runtimes expose a non-configurable navigator.locks property.
    }
  }

  const persistence = createBrowserWASQLitePersistence<{
    id: string
    title: string
    score: number
  }>({
    database,
  })

  await persistence.adapter.applyCommittedTx(`todos`, {
    txId: `tx-1`,
    term: 1,
    seq: 1,
    rowVersion: 1,
    mutations: [
      {
        type: `insert`,
        key: `1`,
        value: {
          id: `1`,
          title: `single-tab`,
          score: 1,
        },
      },
    ],
  })

  const rows = await persistence.adapter.loadSubset(`todos`, {})
  expect(rows).toEqual([
    {
      key: `1`,
      value: {
        id: `1`,
        title: `single-tab`,
        score: 1,
      },
    },
  ])
})

it(`throws PersistenceUnavailableError when OPFS sync access is missing`, async () => {
  await expect(
    openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    }),
  ).rejects.toBeInstanceOf(PersistenceUnavailableError)
})

it(`rejects empty browser OPFS database names`, async () => {
  await expect(
    openBrowserWASQLiteOPFSDatabase({
      databaseName: `   `,
    }),
  ).rejects.toBeInstanceOf(InvalidPersistedCollectionConfigError)
})
