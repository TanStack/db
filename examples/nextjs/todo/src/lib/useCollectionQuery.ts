import { useLiveQuery } from "@tanstack/react-db"
import { useCollectionClient } from "./CollectionClientProvider"
import type { Collection } from "@tanstack/react-db"
import type { UpdateConfig, UpdateTodo } from "../db/validation"
import type { CollectionClient } from "./CollectionClientProvider"

// Hook to use todos collection (similar to useQuery)
export function useTodosCollection(collectionClient?: CollectionClient) {
  const client = useCollectionClient(collectionClient)

  const { data: todos } = useLiveQuery((q) =>
    q
      .from({ todoCollection: client.todoCollection as Collection<UpdateTodo> })
      .keyBy(`@id`)
      .orderBy({ "@created_at": `desc` })
      .select(`@id`, `@created_at`, `@text`, `@completed`)
  )

  return {
    data: todos,
    collection: client.todoCollection,
  }
}

// Hook to use config collection (similar to useQuery)
export function useConfigCollection(collectionClient?: CollectionClient) {
  const client = useCollectionClient(collectionClient)

  const { data: configData } = useLiveQuery((q) =>
    q
      .from({
        configCollection: client.configCollection as Collection<UpdateConfig>,
      })
      .keyBy(`@id`)
      .select(`@id`, `@key`, `@value`)
  )

  return {
    data: configData,
    collection: client.configCollection,
  }
}
