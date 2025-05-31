"use client"

import type { CollectionClient } from "@/lib/CollectionHydrationBoundary"
import { CollectionClientProvider } from "@/lib/CollectionClientProvider"
import { makeCollectionClient } from "@/lib/collections"

const isServer = typeof window === `undefined`

let browserCollectionClient: CollectionClient | undefined = undefined

function getCollectionClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeCollectionClient()
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserCollectionClient)
      browserCollectionClient = makeCollectionClient()
    return browserCollectionClient
  }
}

export default function Providers({ children }: { children: React.ReactNode }) {
  // NOTE: Avoid useState when initializing the query client if you don't
  //       have a suspense boundary between this and the code that may
  //       suspend because React will throw away the client on the initial
  //       render if it suspends and there is no boundary
  const collectionClient = getCollectionClient()

  return (
    <CollectionClientProvider client={collectionClient}>
      {children}
    </CollectionClientProvider>
  )
}
