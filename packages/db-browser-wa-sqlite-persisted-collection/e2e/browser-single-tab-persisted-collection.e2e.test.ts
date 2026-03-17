import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createBrowserWASQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { generateSeedData } from '../../db-collection-e2e/src/fixtures/seed-data'
import { runPersistedCollectionConformanceSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/persisted-collection-conformance-contract'
import { createWASQLiteTestDatabase } from '../tests/helpers/wa-sqlite-test-db'
import type { Collection } from '@tanstack/db'
import type { BrowserWASQLiteDatabase } from '../src'
import type {
  Comment,
  E2ETestConfig,
  Post,
  User,
} from '../../db-collection-e2e/src/types'

type PersistableRow = {
  id: string
}

type BrowserPersistedCollectionTestConfig = E2ETestConfig
type PersistedCollectionHarness<T extends PersistableRow> = {
  collection: Collection<T, string | number>
  seedPersisted: (rows: Array<T>) => Promise<void>
}

let config: BrowserPersistedCollectionTestConfig

function createPersistedCollection<T extends PersistableRow>(
  database: BrowserWASQLiteDatabase,
  id: string,
  syncMode: `eager` | `on-demand`,
): PersistedCollectionHarness<T> {
  const persistence = createBrowserWASQLitePersistence<T, string | number>({
    database,
  })
  let seedTxSequence = 0
  const seedPersisted = async (rows: Array<T>): Promise<void> => {
    if (rows.length === 0) {
      return
    }
    seedTxSequence++
    await persistence.adapter.applyCommittedTx(id, {
      txId: `seed-${id}-${seedTxSequence}`,
      term: 1,
      seq: seedTxSequence,
      rowVersion: seedTxSequence,
      mutations: rows.map((row) => ({
        type: `insert` as const,
        key: row.id,
        value: row,
      })),
    })
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
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-browser-persisted-e2e-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const suiteId = Date.now().toString(36)
  const database = createWASQLiteTestDatabase({
    filename: dbPath,
  })
  const seedData = generateSeedData()

  const eagerUsers = createPersistedCollection<User>(
    database,
    `browser-persisted-users-eager-${suiteId}`,
    `eager`,
  )
  const eagerPosts = createPersistedCollection<Post>(
    database,
    `browser-persisted-posts-eager-${suiteId}`,
    `eager`,
  )
  const eagerComments = createPersistedCollection<Comment>(
    database,
    `browser-persisted-comments-eager-${suiteId}`,
    `eager`,
  )

  const onDemandUsers = createPersistedCollection<User>(
    database,
    `browser-persisted-users-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandPosts = createPersistedCollection<Post>(
    database,
    `browser-persisted-posts-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandComments = createPersistedCollection<Comment>(
    database,
    `browser-persisted-comments-ondemand-${suiteId}`,
    `on-demand`,
  )

  await Promise.all([
    eagerUsers.collection.preload(),
    eagerPosts.collection.preload(),
    eagerComments.collection.preload(),
  ])

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
      await Promise.all([
        onDemandUsers.collection.cleanup(),
        onDemandPosts.collection.cleanup(),
        onDemandComments.collection.cleanup(),
      ])

      onDemandUsers.collection.startSyncImmediate()
      onDemandPosts.collection.startSyncImmediate()
      onDemandComments.collection.startSyncImmediate()
    },
    teardown: async () => {
      await Promise.all([
        eagerUsers.collection.cleanup(),
        eagerPosts.collection.cleanup(),
        eagerComments.collection.cleanup(),
        onDemandUsers.collection.cleanup(),
        onDemandPosts.collection.cleanup(),
        onDemandComments.collection.cleanup(),
      ])
      await Promise.resolve(database.close?.())
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
})

afterEach(async () => {
  if (config.afterEach) {
    await config.afterEach()
  }
})

afterAll(async () => {
  await config.teardown()
})

function getConfig(): Promise<BrowserPersistedCollectionTestConfig> {
  return Promise.resolve(config)
}

runPersistedCollectionConformanceSuite(
  `browser single-tab persisted collection conformance`,
  getConfig,
)
