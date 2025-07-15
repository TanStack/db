import { clsx as cx } from 'clsx'
import { Show, createMemo, createSignal, onMount, For } from 'solid-js'
import { useDevtoolsOnClose } from './contexts'
import { useStyles } from './useStyles'
import { useLocalStorage } from './useLocalStorage'
import { multiSortBy } from './utils'
import { POLLING_INTERVAL_MS } from './constants'
import type { Accessor, JSX } from 'solid-js'
import type { DbDevtoolsRegistry, CollectionMetadata } from './types'

export interface BaseDbDevtoolsPanelOptions {
  /**
   * The standard React style object used to style a component with inline styles
   */
  style?: Accessor<JSX.CSSProperties>
  /**
   * The standard React class property used to style a component with classes
   */
  className?: Accessor<string>
  /**
   * A boolean variable indicating whether the panel is open or closed
   */
  isOpen?: boolean
  /**
   * A function that toggles the open and close state of the panel
   */
  setIsOpen?: (isOpen: boolean) => void
  /**
   * Handles the opening and closing the devtools panel
   */
  handleDragStart?: (e: any) => void
  /**
   * The DB devtools registry instance
   */
  registry: Accessor<DbDevtoolsRegistry>
  /**
   * Use this to attach the devtool's styles to specific element in the DOM.
   */
  shadowDOMTarget?: ShadowRoot
}

function Logo(props: any) {
  const { className, ...rest } = props
  const styles = useStyles()
  return (
    <button {...rest} class={cx(styles().logo, className ? className() : '')}>
      <div class={styles().tanstackLogo}>TANSTACK</div>
      <div class={styles().dbLogo}>TanStack DB v0</div>
    </button>
  )
}

function formatTime(ms: number): string {
  if (ms === 0) return '0s'
  
  const units = ['s', 'min', 'h', 'd']
  const values = [ms / 1000, ms / 60000, ms / 3600000, ms / 86400000]

  let chosenUnitIndex = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i]! < 1) break
    chosenUnitIndex = i
  }

  const formatter = new Intl.NumberFormat(navigator.language, {
    compactDisplay: 'short',
    notation: 'compact',
    maximumFractionDigits: 0,
  })

  return formatter.format(values[chosenUnitIndex]!) + units[chosenUnitIndex]
}

function CollectionStats({ collection }: { collection: CollectionMetadata }) {
  const styles = useStyles()
  
  if (collection.type === 'collection') {
    // Standard collection stats
    return (
      <div class={styles().collectionStats}>
        <div>{collection.size}</div>
        <div>/</div>
        <div>{collection.transactionCount}</div>
        <div>/</div>
        <div>{formatTime(collection.gcTime || 0)}</div>
        <div>/</div>
        <div class={cx(
          styles().collectionStatus,
          collection.status === 'error' ? styles().collectionStatusError : ''
        )}>
          {collection.status}
        </div>
      </div>
    )
  } else {
    // Live query collection stats
    return (
      <div class={styles().collectionStats}>
        <div>{collection.size}</div>
        <div>/</div>
        <div>{formatTime(collection.gcTime || 0)}</div>
        <div>/</div>
        <div class={cx(
          styles().collectionStatus,
          collection.status === 'error' ? styles().collectionStatusError : ''
        )}>
          {collection.status}
        </div>
      </div>
    )
  }
}

function CollectionItem({
  collection,
  isActive,
  onSelect,
}: {
  collection: CollectionMetadata
  isActive: Accessor<boolean>
  onSelect: (collection: CollectionMetadata) => void
}) {
  const styles = useStyles()
  
  return (
    <div
      class={cx(
        styles().collectionItem,
        isActive() ? styles().collectionItemActive : ''
      )}
      onClick={() => onSelect(collection)}
    >
      <div class={styles().collectionName}>{collection.id}</div>
      <CollectionStats collection={collection} />
    </div>
  )
}

export const BaseTanStackDbDevtoolsPanel = function BaseTanStackDbDevtoolsPanel({
  ...props
}: BaseDbDevtoolsPanelOptions): JSX.Element {
  const {
    isOpen = true,
    setIsOpen,
    handleDragStart,
    registry,
    shadowDOMTarget,
    ...panelProps
  } = props

  const { onCloseClick } = useDevtoolsOnClose()
  const styles = useStyles()
  const { className, style, ...otherPanelProps } = panelProps

  const [activeCollectionId, setActiveCollectionId] = useLocalStorage(
    'tanstackDbDevtoolsActiveCollectionId',
    '',
  )

  const [selectedView, setSelectedView] = createSignal<'collections' | 'transactions'>('collections')
  const [selectedTransaction, setSelectedTransaction] = createSignal<string | null>(null)

  const [collections, setCollections] = createSignal<CollectionMetadata[]>([])

  // Poll for collections data
  onMount(() => {
    const updateCollections = () => {
      if (typeof window === 'undefined') return
      try {
        const newCollections = registry().getAllCollectionMetadata()
        const currentCollections = collections()
        
        // Only update if collections data actually changed
        if (hasCollectionsChanged(currentCollections, newCollections)) {
          setCollections(newCollections)
        }
      } catch (error) {
        // Silently handle errors when fetching collections metadata
      }
    }
    updateCollections()
    const intervalId = setInterval(updateCollections, POLLING_INTERVAL_MS)
    return () => clearInterval(intervalId)
  })

  // Helper function to detect if collections data actually changed
  const hasCollectionsChanged = (oldCollections: CollectionMetadata[], newCollections: CollectionMetadata[]): boolean => {
    if (oldCollections.length !== newCollections.length) return true
    
    // Create maps for O(1) lookup by ID
    const oldMap = new Map(oldCollections.map(c => [c.id, c]))
    const newMap = new Map(newCollections.map(c => [c.id, c]))
    
    // Check if any collection data changed by comparing by ID
    for (const [id, old] of oldMap) {
      const new_ = newMap.get(id)
      if (!new_) return true // Collection was removed
      
      if (old.status !== new_.status) return true
      if (old.size !== new_.size) return true
      if (old.hasTransactions !== new_.hasTransactions) return true
      if (old.transactionCount !== new_.transactionCount) return true
    }
    
    // Check if any new collections were added
    for (const [id] of newMap) {
      if (!oldMap.has(id)) return true
    }
    
    return false
  }

  // --- Fix: Ensure selection is always valid and highlight updates instantly ---
  // If the selected collection disappears, auto-select the first available one
  createMemo(() => {
    const ids = collections().map(c => c.id)
    if (ids.length === 0) {
      setActiveCollectionId('') // always a string
      return
    }
    if (!ids.includes(activeCollectionId())) {
      setActiveCollectionId(ids[0] ?? '')
    }
  })
  // --- End fix ---

  const activeCollection = createMemo(() => {
    const active = collections().find(c => c.id === activeCollectionId())
    return active || collections()[0]
  })

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
    <div
      class={cx(
        styles().devtoolsPanel,
        'TanStackDbDevtoolsPanel',
        className ? className() : '',
      )}
      style={style ? style() : ''}
      {...otherPanelProps}
    >
      {handleDragStart ? (
        <div class={styles().dragHandle} onMouseDown={handleDragStart}></div>
      ) : null}
      
      <button
        class={styles().panelCloseBtn}
        onClick={(e: any) => {
          if (setIsOpen) {
            setIsOpen(false)
          }
          onCloseClick(e)
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="10"
          height="6"
          fill="none"
          viewBox="0 0 10 6"
          class={styles().panelCloseBtnIcon}
        >
          <path
            stroke="currentColor"
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="1.667"
            d="M1 1l4 4 4-4"
          ></path>
        </svg>
      </button>

      <div class={styles().firstContainer}>
        <div class={styles().row}>
          <div class={styles().headerContainer}>
            <Logo />
            {/* Tab Navigation */}
            <div class={styles().tabNav}>
              <button
                onClick={() => setSelectedView('collections')}
                class={cx(
                  styles().tabBtn,
                  selectedView() === 'collections' && styles().tabBtnActive
                )}
              >
                Collections ({collections().length})
              </button>
              <button
                onClick={() => setSelectedView('transactions')}
                class={cx(
                  styles().tabBtn,
                  selectedView() === 'transactions' && styles().tabBtnActive
                )}
              >
                Transactions ({registry().getTransactions().length})
              </button>
            </div>
          </div>
        </div>
        <div class={styles().collectionsExplorerContainer}>
          {/* Content based on selected view */}
          <div class={styles().sidebarContent}>
            <Show when={selectedView() === 'collections'}>
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
                            onSelect={(c) => setActiveCollectionId(c.id)}
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
                            onSelect={(c) => setActiveCollectionId(c.id)}
                          />
                        }</For>
                      </div>
                    </Show>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={selectedView() === 'transactions'}>
              <div class={styles().transactionsExplorer}>
                <div class={styles().collectionsHeader}>
                  <div>Transactions ({registry().getTransactions().length})</div>
                </div>
                
                <div class={styles().collectionsList}>
                  <Show
                    when={registry().getTransactions().length > 0}
                    fallback={
                      <div style={{ padding: '16px', color: '#666' }}>
                        No transactions found
                      </div>
                    }
                  >
                    {registry().getTransactions().map((transaction) => (
                      <div
                        class={cx(
                          styles().collectionItem,
                          selectedTransaction() === transaction.id && styles().collectionItemActive
                        )}
                        onClick={() => setSelectedTransaction(transaction.id)}
                      >
                        <div class={styles().collectionName}>
                          Transaction {transaction.id.slice(0, 8)}...
                        </div>
                        <div class={styles().collectionCount}>
                          {transaction.mutations.length} mutations
                        </div>
                        <div class={cx(
                          styles().collectionStatus,
                          transaction.state === 'error' ? styles().collectionStatusError : ''
                        )}>
                          {transaction.state}
                        </div>
                      </div>
                    ))}
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>

      <div class={styles().secondContainer}>
        <Show
          when={activeCollection()}
          fallback={
            <div class={styles().detailsPanel}>
              <div class={styles().detailsHeader}>
                Select a collection to view details
              </div>
            </div>
          }
        >
          {(collection) => (
            <div class={styles().detailsPanel}>
              <div class={styles().detailsHeader}>
                {collection().id}
              </div>
              <div class={styles().detailsContent}>
                <pre>{JSON.stringify(collection(), null, 2)}</pre>
              </div>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

export default BaseTanStackDbDevtoolsPanel 