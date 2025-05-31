import React from "react"
import { dehydrateCollections } from "@tanstack/db-collections"
import { CollectionHydrationBoundary } from "../lib/CollectionHydrationBoundary"
import TodoClient from "./TodoClient"
import { makeCollections } from "@/lib/collections"

export default async function TodoPage() {
  const collections = makeCollections()
  const promises = Object.values(collections).map(async (collection) => {
    await collection.stateWhenReady()
  })
  await Promise.all(promises)

  const dehydratedState = dehydrateCollections(collections)

  return (
    <CollectionHydrationBoundary state={dehydratedState}>
      <TodoClient />
    </CollectionHydrationBoundary>
  )
}
