import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { API_URL, itemsApi, listsApi } from '../utils/api'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'
import type {
  OpSQLiteDatabaseLike} from '@tanstack/db-react-native-sqlite-persisted-collection';
import type { PendingMutation } from '@tanstack/db'
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

const listPersistence = createReactNativeSQLitePersistence<
  ShoppingList,
  string | number
>({ database })
const itemPersistence = createReactNativeSQLitePersistence<
  ShoppingItem,
  string | number
>({ database })

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
        onError: (error) => {
          console.error(`[Electric] lists shape error`, error)
        },
      },
      getKey: (item) => item.id,
    }),
    persistence: listPersistence,
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
        onError: (error) => {
          console.error(`[Electric] items shape error`, error)
        },
      },
      getKey: (item) => item.id,
    }),
    persistence: itemPersistence,
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
        const deleted = await listsApi.delete((mutation.original as ShoppingList).id)
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
        const deleted = await itemsApi.delete((mutation.original as ShoppingItem).id)
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
    storage: new AsyncStorageAdapter(`shopping-offline:`),
    mutationFns: {
      syncLists,
      syncItems,
    },
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
        const allItems = itemsCollection.toArray as Array<ShoppingItem>
        for (const item of allItems) {
          if (item.listId === id) {
            itemsCollection.delete(item.id)
          }
        }
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
