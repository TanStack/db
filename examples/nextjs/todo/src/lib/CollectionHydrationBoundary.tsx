"use client"

import * as React from "react"
import { useCollectionClient } from "./CollectionClientProvider"
import type { CollectionClient } from "./CollectionClientProvider"
import type { DehydratedState } from "@tanstack/db-collections"

export interface CollectionHydrationBoundaryProps {
  state?: DehydratedState
  children?: React.ReactNode
  collectionClient?: CollectionClient
}

export const CollectionHydrationBoundary = ({
  children,
  state,
  collectionClient: providedClient,
}: CollectionHydrationBoundaryProps) => {
  const client = useCollectionClient(providedClient)

  React.useMemo(() => {
    if (state && Object.keys(state).length > 0) {
      const collections = client.getAllCollections()
      Object.entries(state).forEach(([collectionName, collectionState]) => {
        collections[collectionName].hydrate(collectionState)
      })
    }
  }, [state, client])

  return children as React.ReactElement
}
