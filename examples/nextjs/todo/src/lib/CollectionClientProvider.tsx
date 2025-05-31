"use client"

import * as React from "react"
import type { ElectricCollection } from "@tanstack/db-collections"

export interface CollectionClient {
  getCollection: <T extends { id?: number }>(
    name: string
  ) => ElectricCollection<T>
  mount: () => void
  unmount: () => void
  getAllCollections: () => Record<string, ElectricCollection<any>>
}

export const CollectionClientContext = React.createContext<
  CollectionClient | undefined
>(undefined)

export const useCollectionClient = (collectionClient?: CollectionClient) => {
  const client = React.useContext(CollectionClientContext)

  if (collectionClient) {
    return collectionClient
  }

  if (!client) {
    throw new Error(
      `No CollectionClient set, use CollectionClientProvider to set one`
    )
  }

  return client
}

export type CollectionClientProviderProps = {
  client: CollectionClient
  children?: React.ReactNode
}

export const CollectionClientProvider = ({
  client,
  children,
}: CollectionClientProviderProps): React.JSX.Element => {
  React.useEffect(() => {
    client.mount()
    return () => {
      client.unmount()
    }
  }, [client])

  return (
    <CollectionClientContext.Provider value={client}>
      {children}
    </CollectionClientContext.Provider>
  )
}
