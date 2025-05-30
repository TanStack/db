import { createElectricCollection } from "@tanstack/db-collections"
import { updateConfigSchema, updateTodoSchema } from "../db/validation"
import type {
  ElectricCollection,
  ElectricInitialData,
} from "@tanstack/db-collections"
import type { UpdateConfig, UpdateTodo } from "../db/validation"
import type { CollectionClient } from "./CollectionClientProvider"

export interface CreateCollectionClientOptions {
  defaultOptions?: {
    staleTime?: number
  }
}

// Generic type for initial data arrays
type InitialDataRecord = Record<string, Array<any>>

export function createCollectionClient(
  initialData: InitialDataRecord = {},
  options: CreateCollectionClientOptions = {}
): CollectionClient {
  const isClient = typeof window !== `undefined`
  const baseUrl = isClient ? window.location.origin : `http://localhost:3000`

  const collections: Record<string, ElectricCollection<any>> = {}
  const collectionGetters: Record<string, () => ElectricCollection<any>> = {}

  // Function to create an ElectricInitialData object from an array
  const toElectricInitialData = <T extends Record<string, unknown>>(
    dataArray: Array<T> = [],
    collectionId: string
  ): ElectricInitialData<T> => ({
    data: dataArray.map((item, index) => ({
      key: `${collectionId}-${(item as any).id || index}`, // Ensure key is unique
      value: item,
      metadata: undefined,
    })),
    txids: [],
    schema: undefined,
    lastOffset: undefined,
    shapeHandle: undefined,
  })

  collections.todos = createElectricCollection<UpdateTodo>({
    id: `todos`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: { table: `todos` },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateTodoSchema,
    initialData: toElectricInitialData(initialData.todos, `todos`),
  })
  collectionGetters.todos = () => collections.todos

  // Create configCollection if initial data exists for it
  collections.config = createElectricCollection<UpdateConfig>({
    id: `config`,
    streamOptions: {
      url: `${baseUrl}/api/electric`,
      params: { table: `config` },
      subscribe: isClient,
    },
    primaryKey: [`id`],
    schema: updateConfigSchema,
    initialData: toElectricInitialData(initialData.config, `config`),
  })
  collectionGetters.config = () => collections.config

  const client: CollectionClient = {
    // Use getters to ensure collections are only accessed if they exist
    get todoCollection() {
      return collectionGetters.todos()
    },
    get configCollection() {
      return collectionGetters.config()
    },
    mount() {},
    unmount() {},
    getAllCollections() {
      return collections
    },
  }

  return client
}

export function dehydrateCollections(client: CollectionClient) {
  const collections = client.getAllCollections()
  // Use LocalElectricInitialData for the return type annotation
  const dehydratedState: Record<string, ElectricInitialData<any>> = {}

  Object.entries(collections).forEach(([key, collection]) => {
    const collectionData: Array<{
      key: string
      value: any
      metadata?: Record<string, unknown>
    }> = []

    collection.state.forEach((value, key) => {
      // Get metadata if available from syncedMetadata
      const metadata = collection.syncedMetadata.state.get(key) as
        | Record<string, unknown>
        | undefined

      collectionData.push({
        key,
        value,
        metadata,
      })
    })

    dehydratedState[key] = {
      data: collectionData,
      txids: [], // We don't have access to txids from the library level, so empty array
      schema: undefined, // Schema not accessible from collection instance
      lastOffset: undefined, // Offset not accessible from collection instance
      shapeHandle: undefined, // Shape handle not accessible from collection instance
    }
  })

  return dehydratedState
}
