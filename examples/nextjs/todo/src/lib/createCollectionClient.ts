import { collections } from "./collections"
import type {
  DehydratedState,
  ElectricCollection,
} from "@tanstack/db-collections"
import type { CollectionClient } from "./CollectionClientProvider"

type CollectionRecord = Record<string, ElectricCollection<{ id?: number }>>
type Collections = typeof collections
type CollectionKeys = keyof typeof collections

export function createCollectionClient(
  initialData?: DehydratedState
): CollectionClient {
  // Initialize collections with any initial data
  if (initialData) {
    Object.keys(initialData).forEach((key) => {
      if (key in collections) {
        collections[key as CollectionKeys].hydrate(initialData[key])
      }
    })
  }

  return {
    getCollection: <T extends { id?: number }>(name: string) => {
      if (!(name in collections)) {
        throw new Error(`Collection ${name} not found`)
      }
      return collections[
        name as CollectionKeys
      ] as unknown as ElectricCollection<T>
    },
    mount: () => {},
    unmount: () => {},
    getAllCollections: () => collections,
  }
}
