import { Show, For, createMemo } from 'solid-js'
import { useStyles } from '../useStyles'
import { CollectionItem } from './CollectionItem'
import { multiSortBy } from '../utils'
import type { Accessor } from 'solid-js'
import type { CollectionMetadata } from '../types'

interface CollectionsPanelProps {
  collections: Accessor<CollectionMetadata[]>
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
    return multiSortBy(
      collections(),
      [
        (c) => c.status === 'error' ? 0 : 1, // Errors first
        (c) => c.id.toLowerCase(), // Then alphabetically by ID
      ]
    )
  })

  // Group collections by type
  const standardCollections = createMemo(() => 
    sortedCollections().filter(c => c.type === 'collection')
  )
  
  const liveCollections = createMemo(() => 
    sortedCollections().filter(c => c.type === 'live-query')
  )

  return (
    <div class={styles().collectionsExplorer}>
      <div class={styles().collectionsList}>
        <Show
          when={sortedCollections().length > 0}
          fallback={
            <div style={{ padding: '16px', color: '#666' }}>
              No collections found
            </div>
          }
        >
          {/* Standard Collections */}
          <Show when={standardCollections().length > 0}>
            <div class={styles().collectionGroup}>
              <div class={styles().collectionGroupHeader}>
                <div>Standard Collections ({standardCollections().length})</div>
                <div class={styles().collectionGroupStats}>
                  <span>Items</span>
                  <span>/</span>
                  <span>Txn</span>
                  <span>/</span>
                  <span>GC</span>
                  <span>/</span>
                  <span>Status</span>
                </div>
              </div>
              <For each={standardCollections()}>{(collection) =>
                <CollectionItem
                  collection={collection}
                  isActive={() => collection.id === activeCollectionId()}
                  onSelect={onSelectCollection}
                />
              }</For>
            </div>
          </Show>

          {/* Live Collections */}
          <Show when={liveCollections().length > 0}>
            <div class={styles().collectionGroup}>
              <div class={styles().collectionGroupHeader}>
                <div>Live Collections ({liveCollections().length})</div>
                <div class={styles().collectionGroupStats}>
                  <span>Items</span>
                  <span>/</span>
                  <span>GC</span>
                  <span>/</span>
                  <span>Status</span>
                </div>
              </div>
              <For each={liveCollections()}>{(collection) =>
                <CollectionItem
                  collection={collection}
                  isActive={() => collection.id === activeCollectionId()}
                  onSelect={onSelectCollection}
                />
              }</For>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  )
} 