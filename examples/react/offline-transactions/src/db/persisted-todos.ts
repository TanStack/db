import { createCollection } from '@tanstack/react-db'
import {
  BrowserCollectionCoordinator,
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
  persistedCollectionOptions,
} from '@tanstack/browser-db-sqlite-persistence'
import type { Collection } from '@tanstack/db'

export type PersistedTodo = {
  id: string
  text: string
  completed: boolean
  createdAt: string
  updatedAt: string
}

export type PersistedTodosHandle = {
  collection: Collection<PersistedTodo, string>
  close: () => Promise<void>
}

export async function createPersistedTodoCollection(): Promise<PersistedTodosHandle> {
  const database = await openBrowserWASQLiteOPFSDatabase({
    databaseName: `tanstack-db-demo-v2.sqlite`,
  })

  const coordinator = new BrowserCollectionCoordinator({
    dbName: `tanstack-db-demo`,
  })

  const persistence = createBrowserWASQLitePersistence<PersistedTodo, string>({
    database,
    coordinator,
  })

  const collection = createCollection(
    persistedCollectionOptions<PersistedTodo, string>({
      id: `persisted-todos`,
      getKey: (todo) => todo.id,
      persistence,
      schemaVersion: 1,
    }),
  )

  return {
    collection: collection,
    close: async () => {
      coordinator.dispose()
      await database.close?.()
    },
  }
}
