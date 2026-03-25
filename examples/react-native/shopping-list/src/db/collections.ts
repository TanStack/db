import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/react-native-db-sqlite-persistence'
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { API_URL, itemsApi, listsApi } from '../utils/api'
import { createOfflineAwareFetch } from '../network/simulatedOffline'
import { simulatedOnlineDetector } from '../network/SimulatedOnlineDetector'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'
import type { PendingMutation } from '@tanstack/db'
import type { OpSQLiteDatabaseLike } from '@tanstack/react-native-db-sqlite-persistence'
import type { ElectricCollectionUtils } from '@tanstack/electric-db-collection'

export type ShoppingList = {
  id: string
  name: string
  createdAt: string
}

export type ShoppingItem = {
  id: string
  listId: string
  text: string
  checked: boolean
  createdAt: string
}

const database = open({
  name: `shopping-list.sqlite`,
  location: `default`,
}) as unknown as OpSQLiteDatabaseLike

const sharedPersistence = createReactNativeSQLitePersistence({
  database,
}) as any
const offlineStorage = new AsyncStorageAdapter(`shopping-offline:`)

type SQLiteResultWithRows = {
  rows?: {
    _array?: Array<Record<string, unknown>>
    length?: unknown
    item?: unknown
  }
  resultRows?: Array<Record<string, unknown>>
  results?: Array<SQLiteResultWithRows>
}

function getExecuteMethod(db: OpSQLiteDatabaseLike) {
  return db.executeAsync ?? db.execute ?? db.executeRaw ?? db.execAsync
}

function extractRows(result: unknown): Array<Record<string, unknown>> {
  const fromRowsObject = (
    rows: SQLiteResultWithRows[`rows`],
  ): Array<Record<string, unknown>> | null => {
    if (!rows) return null
    if (Array.isArray(rows._array)) {
      return rows._array
    }
    if (typeof rows.length === `number` && typeof rows.item === `function`) {
      const item = rows.item as (index: number) => unknown
      const extracted: Array<Record<string, unknown>> = []
      for (let i = 0; i < rows.length; i++) {
        const row = item(i)
        if (row && typeof row === `object`) {
          extracted.push(row as Record<string, unknown>)
        }
      }
      return extracted
    }
    return null
  }

  if (Array.isArray(result)) {
    if (result.length === 0) return []
    const first = result[0] as SQLiteResultWithRows
    if (Array.isArray(first.resultRows)) {
      return first.resultRows
    }
    const fromFirstRows = fromRowsObject(first.rows)
    if (fromFirstRows) {
      return fromFirstRows
    }
    if (Array.isArray(first.results) && first.results.length > 0) {
      return extractRows(first.results[0])
    }
    return result as Array<Record<string, unknown>>
  }
  const maybe = result as SQLiteResultWithRows
  if (Array.isArray(maybe.resultRows)) {
    return maybe.resultRows
  }
  const fromDirectRows = fromRowsObject(maybe.rows)
  if (fromDirectRows) {
    return fromDirectRows
  }
  if (Array.isArray(maybe.results) && maybe.results.length > 0) {
    return extractRows(maybe.results[0])
  }
  return []
}

async function executeSql(
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<unknown> {
  const execute = getExecuteMethod(database)
  if (!execute) {
    throw new Error(`No execute method available for op-sqlite database`)
  }
  return Promise.resolve(
    execute.call(database, sql, params.length ? params : undefined),
  )
}

export async function clearLocalState(
  offline: ReturnType<typeof createOfflineExecutor> | null,
): Promise<void> {
  if (offline) {
    await offline.clearOutbox()
  } else {
    await offlineStorage.clear()
  }

  const rows = extractRows(
    await executeSql(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ),
  )

  await executeSql(`PRAGMA foreign_keys = OFF`)
  try {
    for (const row of rows) {
      const tableName = row.name
      if (typeof tableName === `string`) {
        await executeSql(
          `DROP TABLE IF EXISTS "${tableName.replace(/"/g, `""`)}"`,
        )
      }
    }
  } finally {
    await executeSql(`PRAGMA foreign_keys = ON`)
  }
}

export const listsCollection = createCollection(
  persistedCollectionOptions<
    ShoppingList,
    string | number,
    never,
    ElectricCollectionUtils<ShoppingList>
  >({
    ...electricCollectionOptions<ShoppingList>({
      id: `lists-collection`,
      shapeOptions: {
        url: `${API_URL}/api/shapes/lists`,
        fetchClient: createOfflineAwareFetch(fetch),
        onError: (error) => {
          console.error(`[Electric] lists shape error`, error)
        },
      },
      getKey: (item) => item.id,
    }),
    persistence: sharedPersistence,
    schemaVersion: 1,
  }),
)

export const itemsCollection = createCollection(
  persistedCollectionOptions<
    ShoppingItem,
    string | number,
    never,
    ElectricCollectionUtils<ShoppingItem>
  >({
    ...electricCollectionOptions<ShoppingItem>({
      id: `items-collection`,
      shapeOptions: {
        url: `${API_URL}/api/shapes/items`,
        fetchClient: createOfflineAwareFetch(fetch),
        onError: (error) => {
          console.error(`[Electric] items shape error`, error)
        },
      },
      getKey: (item) => item.id,
    }),
    persistence: sharedPersistence,
    schemaVersion: 1,
  }),
)

async function syncLists({
  transaction,
}: {
  transaction: { mutations: Array<PendingMutation> }
  idempotencyKey: string
}) {
  for (const mutation of transaction.mutations) {
    const data = mutation.modified as ShoppingList
    switch (mutation.type) {
      case `insert`: {
        const created = await listsApi.create({
          id: data.id,
          name: data.name,
          createdAt: data.createdAt,
        })
        await listsCollection.utils.awaitTxId(created.txid)
        break
      }
      case `update`: {
        const updated = await listsApi.update(data.id, { name: data.name })
        if (updated) {
          await listsCollection.utils.awaitTxId(updated.txid)
        }
        break
      }
      case `delete`: {
        const deleted = await listsApi.delete(
          (mutation.original as ShoppingList).id,
        )
        if (deleted) {
          await listsCollection.utils.awaitTxId(deleted.txid)
        }
        break
      }
    }
  }
}

async function syncItems({
  transaction,
}: {
  transaction: { mutations: Array<PendingMutation> }
  idempotencyKey: string
}) {
  for (const mutation of transaction.mutations) {
    const data = mutation.modified as ShoppingItem
    switch (mutation.type) {
      case `insert`: {
        const created = await itemsApi.create({
          id: data.id,
          listId: data.listId,
          text: data.text,
          checked: data.checked,
          createdAt: data.createdAt,
        })
        await itemsCollection.utils.awaitTxId(created.txid)
        break
      }
      case `update`: {
        const updated = await itemsApi.update(data.id, {
          text: data.text,
          checked: data.checked,
        })
        if (updated) {
          await itemsCollection.utils.awaitTxId(updated.txid)
        }
        break
      }
      case `delete`: {
        const deleted = await itemsApi.delete(
          (mutation.original as ShoppingItem).id,
        )
        if (deleted) {
          await itemsCollection.utils.awaitTxId(deleted.txid)
        }
        break
      }
    }
  }
}

export function createOfflineExecutor() {
  return startOfflineExecutor({
    collections: {
      lists: listsCollection,
      items: itemsCollection,
    },
    storage: offlineStorage,
    mutationFns: {
      syncLists,
      syncItems,
    },
    onlineDetector: simulatedOnlineDetector,
    onLeadershipChange: (isLeader) => {
      console.log(`[Offline] Leadership changed:`, isLeader)
    },
    onStorageFailure: (diagnostic) => {
      console.warn(`[Offline] Storage failure:`, diagnostic)
    },
  })
}

export function createListActions(
  offline: ReturnType<typeof createOfflineExecutor> | null,
) {
  if (!offline) {
    return { addList: null, deleteList: null }
  }

  const addList = offline.createOfflineAction({
    mutationFnName: `syncLists`,
    onMutate: (name: string) => {
      const newList: ShoppingList = {
        id: crypto.randomUUID(),
        name: name.trim(),
        createdAt: new Date().toISOString(),
      }
      listsCollection.insert(newList)
      return newList
    },
  })

  const deleteList = offline.createOfflineAction({
    mutationFnName: `syncLists`,
    onMutate: (id: string) => {
      const list = listsCollection.get(id)
      if (list) {
        listsCollection.delete(id)
      }
      return list
    },
  })

  return { addList, deleteList }
}

export function createItemActions(
  offline: ReturnType<typeof createOfflineExecutor> | null,
) {
  if (!offline) {
    return { addItem: null, toggleItem: null, deleteItem: null }
  }

  const addItem = offline.createOfflineAction({
    mutationFnName: `syncItems`,
    onMutate: ({ listId, text }: { listId: string; text: string }) => {
      const newItem: ShoppingItem = {
        id: crypto.randomUUID(),
        listId,
        text: text.trim(),
        checked: false,
        createdAt: new Date().toISOString(),
      }
      itemsCollection.insert(newItem)
      return newItem
    },
  })

  const toggleItem = offline.createOfflineAction({
    mutationFnName: `syncItems`,
    onMutate: (id: string) => {
      const item = itemsCollection.get(id) as ShoppingItem | undefined
      if (!item) return
      itemsCollection.update(id, (draft) => {
        draft.checked = !draft.checked
      })
      return item
    },
  })

  const deleteItem = offline.createOfflineAction({
    mutationFnName: `syncItems`,
    onMutate: (id: string) => {
      const item = itemsCollection.get(id)
      if (item) {
        itemsCollection.delete(item.id)
      }
      return item
    },
  })

  return { addItem, toggleItem, deleteItem }
}
