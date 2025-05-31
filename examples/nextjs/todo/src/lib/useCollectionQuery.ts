import { useLiveQuery } from "@tanstack/react-db"
import { useCollectionClient } from "./CollectionClientProvider"
import type { Collection } from "@tanstack/react-db"
import type { UpdateConfig, UpdateTodo } from "../db/validation"
import type { CollectionClient } from "./CollectionClientProvider"

// Hook to use todos collection (similar to useQuery)
export function useTodosCollection(collectionClient?: CollectionClient) {
  const client = useCollectionClient(collectionClient)
  const todoCollection = client.getCollection<UpdateTodo>(`todos`)

  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todoCollection: todoCollection as Collection<UpdateTodo> })
      .keyBy(`@id`)
      .orderBy({ "@created_at": `desc` })
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
  const configCollection = client.getCollection<UpdateConfig>(`config`)

  const { data: configData } = useLiveQuery((q) =>
    q
      .from({
        configCollection: configCollection as Collection<UpdateConfig>,
      })
      .keyBy(`@id`)
      .select(`@id`, `@key`, `@value`)
  )

  return {
    data: configData,
    collection: configCollection,
  }
}
