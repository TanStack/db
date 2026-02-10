import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '@tanstack/db-sqlite-persisted-collection-core'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistenceAdapter,
} from '@tanstack/db-node-sqlite-persisted-collection'
import {
  createElectronPersistenceMainHost,
  createElectronRendererPersistence,
} from '../src'
import { generateSeedData } from '../../db-collection-e2e/src/fixtures/seed-data'
import { runPersistedCollectionConformanceSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/persisted-collection-conformance-contract'
import {
  createElectronRuntimeBridgeInvoke,
  isElectronFullE2EEnabled,
} from './e2e/electron-process-client'
import type { PersistedTx } from '@tanstack/db-sqlite-persisted-collection-core'
import type { Collection } from '@tanstack/db'
import type { ElectronPersistenceInvoke } from '../src'
import type {
  Comment,
  E2ETestConfig,
  Post,
  User,
} from '../../db-collection-e2e/src/types'

type PersistableRow = {
  id: string
}

type ElectronPersistedCollectionTestConfig = E2ETestConfig
type PersistedCollectionHarness<T extends PersistableRow> = {
  collection: Collection<T, string | number>
  seedPersisted: (rows: Array<T>) => Promise<void>
}

type InvokeHarness = {
  invoke: ElectronPersistenceInvoke
  close: () => void
}

let config: ElectronPersistedCollectionTestConfig | undefined

function createInvokeHarness(dbPath: string): InvokeHarness {
  if (isElectronFullE2EEnabled()) {
    return {
      invoke: createElectronRuntimeBridgeInvoke({
        dbPath,
        collectionId: `seed`,
        allowAnyCollectionId: true,
        timeoutMs: 12_000,
      }),
      close: () => {},
    }
  }

  const driver = createBetterSqlite3Driver({ filename: dbPath })
  const adapter = createNodeSQLitePersistenceAdapter<
    Record<string, unknown>,
    string | number
  >({
    driver,
  })
  const host = createElectronPersistenceMainHost({
    getAdapter: () => adapter,
  })

  return {
    invoke: async (_channel, request) => host.handleRequest(request),
    close: () => {
      driver.close()
    },
  }
}

function createSeedTx<T extends PersistableRow>(
  collectionId: string,
  seedSequence: number,
  rows: Array<T>,
): PersistedTx<T, string | number> {
  return {
    txId: `seed-${collectionId}-${seedSequence}`,
    term: 1,
    seq: seedSequence,
    rowVersion: seedSequence,
    mutations: rows.map((row) => ({
      type: `insert` as const,
      key: row.id,
      value: row,
    })),
  }
}

function createPersistedCollection<T extends PersistableRow>(
  invoke: ElectronPersistenceInvoke,
  id: string,
  syncMode: `eager` | `on-demand`,
): PersistedCollectionHarness<T> {
  const persistence = createElectronRendererPersistence<T, string | number>({
    invoke,
  })
  let seedSequence = 0
  const seedPersisted = async (rows: Array<T>): Promise<void> => {
    if (rows.length === 0) {
      return
    }
    seedSequence++
    await persistence.adapter.applyCommittedTx(
      id,
      createSeedTx(id, seedSequence, rows),
    )
  }

  const collection = createCollection(
    persistedCollectionOptions<T, string | number>({
      id,
      syncMode,
      getKey: (item) => item.id,
      persistence,
    }),
  )

  return {
    collection,
    seedPersisted,
  }
}

type PersistedTransactionHandle = {
  isPersisted: {
    promise: Promise<unknown>
  }
}

async function waitForPersisted(
  transaction: PersistedTransactionHandle,
): Promise<void> {
  await transaction.isPersisted.promise
}

async function seedCollection<T extends PersistableRow>(
  collection: Collection<T, string | number>,
  rows: Array<T>,
): Promise<void> {
  const tx = collection.insert(rows)
  await waitForPersisted(tx)
}

async function insertRowIntoCollections<T extends PersistableRow>(
  collections: ReadonlyArray<Collection<T, string | number>>,
  row: T,
): Promise<void> {
  for (const collection of collections) {
    const tx = collection.insert(row)
    await waitForPersisted(tx)
  }
}

async function updateRowAcrossCollections<T extends PersistableRow>(
  collections: ReadonlyArray<Collection<T, string | number>>,
  id: string,
  updates: Partial<T>,
): Promise<void> {
  for (const collection of collections) {
    if (!collection.has(id)) {
      continue
    }
    const tx = collection.update(id, (draft) => {
      Object.assign(draft, updates)
    })
    await waitForPersisted(tx)
  }
}

async function deleteRowAcrossCollections<T extends PersistableRow>(
  collections: ReadonlyArray<Collection<T, string | number>>,
  id: string,
): Promise<void> {
  for (const collection of collections) {
    if (!collection.has(id)) {
      continue
    }
    const tx = collection.delete(id)
    await waitForPersisted(tx)
  }
}

beforeAll(async () => {
  const tempDirectory = mkdtempSync(
    join(tmpdir(), `db-electron-persisted-e2e-`),
  )
  const dbPath = join(tempDirectory, `state.sqlite`)
  const suiteId = Date.now().toString(36)
  const invokeHarness = createInvokeHarness(dbPath)
  const seedData = generateSeedData()

  const eagerUsers = createPersistedCollection<User>(
    invokeHarness.invoke,
    `electron-persisted-users-eager-${suiteId}`,
    `eager`,
  )
  const eagerPosts = createPersistedCollection<Post>(
    invokeHarness.invoke,
    `electron-persisted-posts-eager-${suiteId}`,
    `eager`,
  )
  const eagerComments = createPersistedCollection<Comment>(
    invokeHarness.invoke,
    `electron-persisted-comments-eager-${suiteId}`,
    `eager`,
  )
  const onDemandUsers = createPersistedCollection<User>(
    invokeHarness.invoke,
    `electron-persisted-users-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandPosts = createPersistedCollection<Post>(
    invokeHarness.invoke,
    `electron-persisted-posts-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandComments = createPersistedCollection<Comment>(
    invokeHarness.invoke,
    `electron-persisted-comments-ondemand-${suiteId}`,
    `on-demand`,
  )

  await eagerUsers.collection.preload()
  await eagerPosts.collection.preload()
  await eagerComments.collection.preload()

  await seedCollection(eagerUsers.collection, seedData.users)
  await seedCollection(eagerPosts.collection, seedData.posts)
  await seedCollection(eagerComments.collection, seedData.comments)
  await onDemandUsers.seedPersisted(seedData.users)
  await onDemandPosts.seedPersisted(seedData.posts)
  await onDemandComments.seedPersisted(seedData.comments)

  config = {
    collections: {
      eager: {
        users: eagerUsers.collection,
        posts: eagerPosts.collection,
        comments: eagerComments.collection,
      },
      onDemand: {
        users: onDemandUsers.collection,
        posts: onDemandPosts.collection,
        comments: onDemandComments.collection,
      },
    },
    mutations: {
      insertUser: async (user) =>
        insertRowIntoCollections(
          [eagerUsers.collection, onDemandUsers.collection],
          user,
        ),
      updateUser: async (id, updates) =>
        updateRowAcrossCollections(
          [eagerUsers.collection, onDemandUsers.collection],
          id,
          updates,
        ),
      deleteUser: async (id) =>
        deleteRowAcrossCollections(
          [eagerUsers.collection, onDemandUsers.collection],
          id,
        ),
      insertPost: async (post) =>
        insertRowIntoCollections(
          [eagerPosts.collection, onDemandPosts.collection],
          post,
        ),
    },
    setup: async () => {},
    afterEach: async () => {
      await onDemandUsers.collection.cleanup()
      await onDemandPosts.collection.cleanup()
      await onDemandComments.collection.cleanup()

      onDemandUsers.collection.startSyncImmediate()
      onDemandPosts.collection.startSyncImmediate()
      onDemandComments.collection.startSyncImmediate()
    },
    teardown: async () => {
      await eagerUsers.collection.cleanup()
      await eagerPosts.collection.cleanup()
      await eagerComments.collection.cleanup()
      await onDemandUsers.collection.cleanup()
      await onDemandPosts.collection.cleanup()
      await onDemandComments.collection.cleanup()
      invokeHarness.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
})

afterEach(async () => {
  if (config?.afterEach) {
    await config.afterEach()
  }
})

afterAll(async () => {
  if (config) {
    await config.teardown()
  }
})

function getConfig(): Promise<ElectronPersistedCollectionTestConfig> {
  if (!config) {
    throw new Error(`Electron persisted collection conformance is not initialized`)
  }
  return Promise.resolve(config)
}

const conformanceMode = isElectronFullE2EEnabled()
  ? `real electron ipc`
  : `in-process invoke`

runPersistedCollectionConformanceSuite(
  `electron persisted collection conformance (${conformanceMode})`,
  getConfig,
)
