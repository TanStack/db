"use client"

import * as React from "react"
import {
  CollectionClientProvider,
  useCollectionClient,
} from "./CollectionClientProvider"
import { createCollectionClient } from "./createCollectionClient"
import type { CollectionClient } from "./CollectionClientProvider"
import type { UpdateConfig, UpdateTodo } from "../db/validation"

// Define the ElectricInitialData interface to match the new format
interface ElectricInitialData<T extends Record<string, unknown>> {
  data: Array<{ key: string; value: T; metadata?: Record<string, unknown> }>
  txids: Array<number>
  schema?: string
  lastOffset?: string
  shapeHandle?: string
}

export interface DehydratedCollectionState {
  [collectionKey: string]: ElectricInitialData<any>
}

export interface CollectionHydrationBoundaryProps {
  state?: DehydratedCollectionState
  children?: React.ReactNode
  collectionClient?: CollectionClient
}

export const CollectionHydrationBoundary = ({
  children,
  state,
  collectionClient: providedClient,
}: CollectionHydrationBoundaryProps) => {
  const contextClient = useCollectionClient(providedClient)

  const client = React.useMemo(() => {
    if (!state || Object.keys(state).length === 0) {
      return contextClient
    }

    const initialDataArrays: Record<string, Array<any>> = {}
    Object.entries(state).forEach(([collectionKey, electricData]) => {
      initialDataArrays[collectionKey] = electricData.data.map(
        (item) => item.value
      )
    })

    return createCollectionClient(initialDataArrays, {
      defaultOptions: {
        staleTime: 60 * 1000,
      },
    })
  }, [state, contextClient])

  if (client !== contextClient) {
    return (
      <CollectionClientProvider client={client}>
        {children}
      </CollectionClientProvider>
    )
  }

  return children as React.ReactElement
}

// Helper function to hydrate collections with data - no longer needed
function hydrateCollections(
  client: CollectionClient,
  data: DehydratedCollectionState
) {
  // This function is now obsolete since we recreate the client with proper initial data
}
