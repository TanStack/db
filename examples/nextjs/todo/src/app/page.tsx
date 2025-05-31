import React from "react"
import { dehydrateCollections } from "@tanstack/db-collections"
import { CollectionHydrationBoundary } from "../lib/CollectionHydrationBoundary"
import { collections } from "../lib/collections"
import TodoClient from "./TodoClient"

export default async function TodoPage() {
  const promises = Object.values(collections).map(async (collection) => {
    await collection.stateWhenReady()
  })
  await Promise.all(promises)

  const dehydratedState = dehydrateCollections(collections)
  const serializableState = JSON.parse(JSON.stringify(dehydratedState))

  return (
    <CollectionHydrationBoundary state={serializableState}>
      <TodoClient />
    </CollectionHydrationBoundary>
  )
}
