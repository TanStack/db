import type { CollectionImpl } from "../../db/src/collection"
import type { Transaction } from "../../db/src/transactions"
import type { CollectionMetadata, TransactionDetails, DevtoolsStore } from "./types"

// Global type definitions for devtools
declare global {
  interface Window {
    __TANSTACK_DB_DEVTOOLS__?: {
      registerCollection: (
        collection: CollectionImpl<any, any, any>
      ) => (() => void) | undefined
      unregisterCollection: (id: string) => void
      registerTransaction: (
        transaction: Transaction<any>,
        collectionId: string
      ) => void
      updateCollection: (id: string) => void
      updateTransactions: (collectionId?: string) => void
      getCollection: (id: string) => CollectionImpl<any, any, any> | undefined
      releaseCollection: (id: string) => void
      getAllCollectionMetadata: () => Array<CollectionMetadata>
      getTransactions: (collectionId?: string) => Array<TransactionDetails>
      cleanup: () => void
      garbageCollect: () => void
      store: DevtoolsStore
    }
  }
}

// Export the type for use in other files
export type TanStackDbDevtools = NonNullable<Window['__TANSTACK_DB_DEVTOOLS__']>

// Helper function for accessing devtools with proper typing
export function getDevtools(): TanStackDbDevtools | undefined {
  if (typeof window === `undefined`) return undefined
  return window.__TANSTACK_DB_DEVTOOLS__
}
