import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/react-db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  createReactNativeSQLitePersistence,
  OpSQLiteDatabaseLike,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'
import { startOfflineExecutor } from '@tanstack/offline-transactions/react-native'
import { queryClient } from '../utils/queryClient'
import { listsApi, itemsApi } from '../utils/api'
import { AsyncStorageAdapter } from './AsyncStorageAdapter'
import type { Collection, PendingMutation } from '@tanstack/db'

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

// ─── SQLite Persistence (shared) ────────────────────────

const database = open({
  name: `shopping-list.sqlite`,
  location: `default`,
}) as unknown as OpSQLiteDatabaseLike
const persistence = createReactNativeSQLitePersistence({ database })

// ─── Collections ────────────────────────────────────────

export const listsCollection = createCollection<ShoppingList, string>(
  persistedCollectionOptions<ShoppingList, string>({
    ...queryCollectionOptions<ShoppingList, string>({
      id: `lists-collection`,
      queryClient,
      queryKey: [`lists`],
      queryFn: async (): Promise<Array<ShoppingList>> => {
        const lists = await listsApi.getAll()
        return lists.map((l) => ({
          ...l,
          createdAt: l.createdAt.toISOString(),
        }))
      },
      getKey: (item) => item.id,
      refetchInterval: 3000,
    }),
    persistence,
    schemaVersion: 1,
  }),
)

export const itemsCollection = createCollection<ShoppingItem, string>(
  persistedCollectionOptions<ShoppingItem, string>({
    ...queryCollectionOptions<ShoppingItem, string>({
      id: `items-collection`,
      queryClient,
      queryKey: [`items`],
      queryFn: async (): Promise<Array<ShoppingItem>> => {
        const items = await itemsApi.getAll()
        return items.map((i) => ({
          ...i,
          createdAt: i.createdAt.toISOString(),
        }))
      },
      getKey: (item) => item.id,
      refetchInterval: 3000,
    }),
    persistence,
    schemaVersion: 1,
  }),
)

// ─── Sync Functions ─────────────────────────────────────

async function syncLists({
  transaction,
}: {
  transaction: { mutations: Array<PendingMutation> }
  idempotencyKey: string
}) {
  for (const mutation of transaction.mutations) {
    const data = mutation.modified as ShoppingList
    switch (mutation.type) {
      case `insert`:
        await listsApi.create({ id: data.id, name: data.name })
        break
      case `update`:
        await listsApi.update(data.id, { name: data.name })
        break
      case `delete`: {
        const id = (mutation.original as ShoppingList).id
        await listsApi.delete(id)
        break
      }
    }
  }
  await listsCollection.utils.refetch()
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
      case `insert`:
        await itemsApi.create({
          id: data.id,
          listId: data.listId,
          text: data.text,
          checked: data.checked,
        })
        break
      case `update`:
        await itemsApi.update(data.id, {
          text: data.text,
          checked: data.checked,
        })
        break
      case `delete`: {
        const id = (mutation.original as ShoppingItem).id
        await itemsApi.delete(id)
        break
      }
    }
  }
  await itemsCollection.utils.refetch()
}

// ─── Offline Executor ───────────────────────────────────

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

// ─── Offline Actions ────────────────────────────────────

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
        // Also delete all items in this list
        const allItems =
          itemsCollection.toArray as unknown as Array<ShoppingItem>
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
      const item = itemsCollection.get(id) as unknown as
        | ShoppingItem
        | undefined
      if (!item) return
      itemsCollection.update(id, (draft: any) => {
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
