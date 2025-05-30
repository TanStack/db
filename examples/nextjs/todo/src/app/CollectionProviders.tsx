"use client"

import * as React from "react"
import { createCollectionClient } from "../lib/createCollectionClient"
import { CollectionClientProvider } from "../lib/CollectionClientProvider"

export function CollectionProviders({
  children,
}: {
  children: React.ReactNode
}) {
  const [collectionClient] = React.useState(() =>
    createCollectionClient(
      {},
      {
        defaultOptions: {
          staleTime: 60 * 1000,
        },
      }
    )
  )

  return (
    <CollectionClientProvider client={collectionClient}>
      {children}
    </CollectionClientProvider>
  )
}
