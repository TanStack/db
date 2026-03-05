import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/react-db'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'
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
  close: () => void
}

export function createPersistedTodoCollection(): PersistedTodosHandle {
  const database = open({
    name: `tanstack-db-demo.sqlite`,
    location: `default`,
  })

  const persistence = createReactNativeSQLitePersistence({ database })

  const collection = createCollection<PersistedTodo, string>(
    persistedCollectionOptions<PersistedTodo, string>({
      id: `persisted-todos`,
      getKey: (todo) => todo.id,
      persistence,
      schemaVersion: 1,
    }),
  )

  return {
    collection,
    close: () => {
      database.close()
    },
  }
}
