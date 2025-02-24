import { useSyncExternalStoreWithSelector } from "use-sync-external-store/shim/with-selector.js"
import type { SyncConfig, MutationFn } from "./types"
import { Collection } from "./collection"

interface UseCollectionConfig {
  id: string
  sync: SyncConfig
  mutationFn: MutationFn
}

// Store collections in memory
const collections = new Map<string, Collection>()

export function useCollection(config: UseCollectionConfig) {
  // Get or create collection instance
  if (!collections.has(config.id)) {
    collections.set(
      config.id,
      new Collection({
        sync: config.sync,
        mutationFn: config.mutationFn,
      })
    )
  }
  const collection = collections.get(config.id)!

  // Subscribe to collection's derivedState
  const data = useSyncExternalStoreWithSelector(
    collection.derivedState.subscribe,
    () => collection.derivedState.state,
    () => collection.derivedState.state,
    (state) => state || new Map(),
    (a, b) => {
      if (a === b) return true
      if (!(a instanceof Map) || !(b instanceof Map)) return false
      if (a.size !== b.size) return false
      for (const [key, value] of a) {
        if (!b.has(key) || !Object.is(value, b.get(key))) return false
      }
      return true
    }
  )

  return {
    data,
    update: collection.update.bind(collection),
    insert: collection.insert.bind(collection),
    delete: collection.delete.bind(collection),
    // withMutation: collection.withMutation.bind(collection),
  }
}
