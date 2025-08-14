import { Show, createMemo } from "solid-js"
import { useLiveQuery } from "@tanstack/solid-db"
import { createLiveQueryCollection } from "@tanstack/db"
import { useStyles } from "../useStyles"
import { getDevtoolsRegistry } from "../devtools"
import { DataTable } from "./DataTable"
import type { CollectionMetadata } from "../types"

interface CollectionDataViewProps {
  collectionMetadata: CollectionMetadata
}

export function CollectionDataView(props: CollectionDataViewProps) {
  const styles = useStyles()

  // Create a live query to get all data from the collection
  const dataQuery = useLiveQuery(() => {
    // Get the collection from the registry
    const registry = getDevtoolsRegistry()
    if (!registry) {
      return createLiveQueryCollection({
        __devtoolsInternal: true,
        id: `__devtools_collection_data_empty`,
        startSync: true,
        gcTime: 3000,
        query: (q: any) => q.from({ empty: [] }),
      } as any)
    }

    const collection = registry.getCollection(props.collectionMetadata.id)
    if (!collection) {
      return createLiveQueryCollection({
        __devtoolsInternal: true,
        id: `__devtools_collection_data_empty`,
        startSync: true,
        gcTime: 3000,
        query: (q: any) => q.from({ empty: [] }),
      } as any)
    }

    console.log({ collection })

    // Query the collection directly
    return createLiveQueryCollection({
      __devtoolsInternal: true,
      id: `__devtools_collection_data_${props.collectionMetadata.id}`,
      startSync: true,
      gcTime: 5000,
      query: (q: any) => q.from({ data: collection }),
    } as any)
  })

  console.log({ dataQuery })

  const data = createMemo(() => {
    const raw = Array.isArray(dataQuery.data)
      ? (dataQuery.data as Array<any>).slice()
      : []
    return raw
  })

  return (
    <div class={styles().detailsContentNoPadding}>
      <Show
        when={data().length > 0}
        fallback={<div class={styles().noDataMessage}>No data available</div>}
      >
        <DataTable data={data()} />
      </Show>
    </div>
  )
}
