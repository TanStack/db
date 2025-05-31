import { useLiveQuery } from "@tanstack/react-db"
import { useCollectionClient } from "./CollectionClientProvider"
import type { UpdateConfig, UpdateTodo } from "../db/validation"
import type { ElectricCollection } from "@tanstack/db-collections"
import type { CollectionClient } from "./CollectionHydrationBoundary"

// Hook to use todos collection (similar to useQuery)
export function useTodosCollection(collectionClient?: CollectionClient) {
  const client = useCollectionClient(collectionClient)
  const todoCollection: ElectricCollection<UpdateTodo> = client.todos

  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todoCollection: todoCollection })
      .keyBy(`@id`)
      .orderBy(`@created_at`)
      .select(`@id`, `@created_at`, `@text`, `@completed`)
  )

  return {
    data: todos,
    collection: todoCollection,
  }
}

// Hook to use config collection (similar to useQuery)
export function useConfigCollection(collectionClient?: CollectionClient) {
  const client = useCollectionClient(collectionClient)
  const configCollection: ElectricCollection<UpdateConfig> = client.config

  const { data: configData } = useLiveQuery((q) =>
    q
      .from({
        configCollection: configCollection,
      })
      .keyBy(`@id`)
      .select(`@id`, `@key`, `@value`)
  )

  return {
    data: configData,
    collection: configCollection,
  }
}
