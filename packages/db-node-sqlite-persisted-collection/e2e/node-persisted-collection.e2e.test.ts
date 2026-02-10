import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { createCollection } from '@tanstack/db'
import {
  createBetterSqlite3Driver,
  createNodeSQLitePersistence,
  persistedCollectionOptions,
} from '../src'
import { generateSeedData } from '../../db-collection-e2e/src'
import { runPersistedCollectionConformanceSuite } from '../../db-sqlite-persisted-collection-core/tests/contracts/persisted-collection-conformance-contract'
import type { Collection, Transaction } from '@tanstack/db'
import type {
  Comment,
  E2ETestConfig,
  Post,
  User,
} from '../../db-collection-e2e/src'

type PersistableRow = {
  id: string
}

type NodePersistedCollectionTestConfig = E2ETestConfig

let config: NodePersistedCollectionTestConfig

function createPersistedCollection<T extends PersistableRow>(
  driver: ReturnType<typeof createBetterSqlite3Driver>,
  id: string,
  syncMode: `eager` | `on-demand`,
): Collection<T, string> {
  return createCollection(
    persistedCollectionOptions<T, string>({
      id,
      syncMode,
      getKey: (item) => item.id,
      persistence: createNodeSQLitePersistence<T, string>({
        driver,
      }),
    }),
  )
}

async function waitForPersisted(
  transaction: Transaction<unknown>,
): Promise<void> {
  await transaction.isPersisted.promise
}

async function seedCollection<T extends PersistableRow>(
  collection: Collection<T, string>,
  rows: Array<T>,
): Promise<void> {
  const tx = collection.insert(rows)
  await waitForPersisted(tx)
}

async function insertRowIntoCollections<T extends PersistableRow>(
  collections: ReadonlyArray<Collection<T, string>>,
  row: T,
): Promise<void> {
  for (const collection of collections) {
    const tx = collection.insert(row)
    await waitForPersisted(tx)
  }
}

async function updateRowAcrossCollections<T extends PersistableRow>(
  collections: ReadonlyArray<Collection<T, string>>,
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
  collections: ReadonlyArray<Collection<T, string>>,
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
  const tempDirectory = mkdtempSync(join(tmpdir(), `db-node-persisted-e2e-`))
  const dbPath = join(tempDirectory, `state.sqlite`)
  const suiteId = Date.now().toString(36)
  const driver = createBetterSqlite3Driver({
    filename: dbPath,
  })
  const seedData = generateSeedData()

  const eagerUsers = createPersistedCollection<User>(
    driver,
    `node-persisted-users-eager-${suiteId}`,
    `eager`,
  )
  const eagerPosts = createPersistedCollection<Post>(
    driver,
    `node-persisted-posts-eager-${suiteId}`,
    `eager`,
  )
  const eagerComments = createPersistedCollection<Comment>(
    driver,
    `node-persisted-comments-eager-${suiteId}`,
    `eager`,
  )

  const onDemandUsers = createPersistedCollection<User>(
    driver,
    `node-persisted-users-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandPosts = createPersistedCollection<Post>(
    driver,
    `node-persisted-posts-ondemand-${suiteId}`,
    `on-demand`,
  )
  const onDemandComments = createPersistedCollection<Comment>(
    driver,
    `node-persisted-comments-ondemand-${suiteId}`,
    `on-demand`,
  )

  await Promise.all([
    eagerUsers.preload(),
    eagerPosts.preload(),
    eagerComments.preload(),
  ])

  await seedCollection(eagerUsers, seedData.users)
  await seedCollection(eagerPosts, seedData.posts)
  await seedCollection(eagerComments, seedData.comments)
  await seedCollection(onDemandUsers, seedData.users)
  await seedCollection(onDemandPosts, seedData.posts)
  await seedCollection(onDemandComments, seedData.comments)

  config = {
    collections: {
      eager: {
        users: eagerUsers,
        posts: eagerPosts,
        comments: eagerComments,
      },
      onDemand: {
        users: onDemandUsers,
        posts: onDemandPosts,
        comments: onDemandComments,
      },
    },
    mutations: {
      insertUser: async (user) =>
        insertRowIntoCollections([eagerUsers, onDemandUsers], user),
      updateUser: async (id, updates) =>
        updateRowAcrossCollections([eagerUsers, onDemandUsers], id, updates),
      deleteUser: async (id) =>
        deleteRowAcrossCollections([eagerUsers, onDemandUsers], id),
      insertPost: async (post) =>
        insertRowIntoCollections([eagerPosts, onDemandPosts], post),
    },
    setup: async () => {},
    teardown: async () => {
      await Promise.all([
        eagerUsers.cleanup(),
        eagerPosts.cleanup(),
        eagerComments.cleanup(),
        onDemandUsers.cleanup(),
        onDemandPosts.cleanup(),
        onDemandComments.cleanup(),
      ])
      driver.close()
      rmSync(tempDirectory, { recursive: true, force: true })
    },
  }
})

afterAll(async () => {
  await config.teardown()
})

function getConfig(): Promise<NodePersistedCollectionTestConfig> {
  return Promise.resolve(config)
}

runPersistedCollectionConformanceSuite(
  `node persisted collection conformance`,
  getConfig,
)
