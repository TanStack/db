import { For, Show, createMemo } from "solid-js"
import { useStyles } from "../useStyles"
import { multiSortBy } from "../utils"
import { CollectionItem } from "./CollectionItem"
import type { Accessor } from "solid-js"
import type { CollectionMetadata } from "../types"

interface CollectionsPanelProps {
  collections: Accessor<Array<CollectionMetadata>>
  activeCollectionId: Accessor<string>
  onSelectCollection: (collection: CollectionMetadata) => void
}

export function CollectionsPanel({
  collections,
  activeCollectionId,
  onSelectCollection,
}: CollectionsPanelProps) {
  const styles = useStyles()

  const sortedCollections = createMemo(() => {
    return multiSortBy(collections(), [
      (c) => (c.status === `error` ? 0 : 1), // Errors first
      (c) => c.id.toLowerCase(), // Then alphabetically by ID
    ])
  })

  // Group collections by type
  const groupedCollections = createMemo(() => {
    const groups: Record<string, Array<CollectionMetadata>> = {}

    sortedCollections().forEach((collection) => {
      const type = collection.type
      if (!groups[type]) {
        groups[type] = []
      }
      const targetGroup = groups[type]
      targetGroup.push(collection)
    })

    // Sort collections within each group alphabetically
    Object.keys(groups).forEach((key) => {
      const group = groups[key]
      if (group) {
        group.sort((a, b) =>
          a.id.toLowerCase().localeCompare(b.id.toLowerCase())
        )
      }
    })

    return groups
  })

  const getGroupDisplayName = (type: string): string => {
    switch (type) {
      case `live-query`:
        return `Live Queries`
      case `electric`:
        return `Electric Collections`
      case `query`:
        return `Query Collections`
      case `local-only`:
        return `Local-Only Collections`
      case `local-storage`:
        return `Local Storage Collections`
      case `generic`:
        return `Generic Collections`
      default:
        return `${type.charAt(0).toUpperCase() + type.slice(1)} Collections`
    }
  }

  const getGroupStats = (type: string): Array<string> => {
    switch (type) {
      case `live-query`:
        return [`Items`, `/`, `GC`, `/`, `Status`]
      case `electric`:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
      case `query`:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
      case `local-only`:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
      case `local-storage`:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
      case `generic`:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
      default:
        return [`Items`, `/`, `Txn`, `/`, `GC`, `/`, `Status`]
    }
  }

  // Get sorted group entries with live-query first, then alphabetical
  const sortedGroupEntries = createMemo(() => {
    const entries = Object.entries(groupedCollections())
    return entries.sort(([a], [b]) => {
      // Live-query always comes first
      if (a === `live-query`) return -1
      if (b === `live-query`) return 1
      // Others are sorted alphabetically
      return a.localeCompare(b)
    })
  })

  return (
    <div class={styles().collectionsExplorer}>
      <div class={styles().collectionsList}>
        <Show
          when={sortedCollections().length > 0}
          fallback={
            <div style={{ padding: `16px`, color: `#666` }}>
              No collections found
            </div>
          }
        >
          <For each={sortedGroupEntries()}>
            {([type, groupCollections]) => (
              <Show when={groupCollections.length > 0}>
                <div class={styles().collectionGroup}>
                  <div class={styles().collectionGroupHeader}>
                    <div>
                      {getGroupDisplayName(type)} ({groupCollections.length})
                    </div>
                    <div class={styles().collectionGroupStats}>
                      <For each={getGroupStats(type)}>
                        {(stat) => <span>{stat}</span>}
                      </For>
                    </div>
                  </div>
                  <For each={groupCollections}>
                    {(collection) => (
                      <CollectionItem
                        collection={collection}
                        isActive={() => collection.id === activeCollectionId()}
                        onSelect={onSelectCollection}
                      />
                    )}
                  </For>
                </div>
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  )
}
