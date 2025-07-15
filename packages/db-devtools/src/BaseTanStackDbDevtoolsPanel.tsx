import { clsx as cx } from 'clsx'
import { Show, createMemo, onMount, createSignal } from 'solid-js'
import { useDevtoolsOnClose } from './contexts'
import { useStyles } from './useStyles'
import { useLocalStorage } from './useLocalStorage'
import { POLLING_INTERVAL_MS } from './constants'
import {
  Logo,
  CollectionsPanel,
  TransactionsPanel,
  UnifiedDetailsPanel,
  TabNavigation,
} from './components'
import type { Accessor, JSX } from 'solid-js'
import type { DbDevtoolsRegistry, CollectionMetadata, TransactionDetails } from './types'

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

  // Simple local state - no navigation store complexity
  const [selectedView, setSelectedView] = createSignal<'collections' | 'transactions'>('collections')
  const [activeCollectionId, setActiveCollectionId] = useLocalStorage('tanstackDbDevtoolsActiveCollectionId', '')
  const [selectedTransaction, setSelectedTransaction] = createSignal<string | null>(null)
  const [collections, setCollections] = createSignal<CollectionMetadata[]>([])
  const [transactions, setTransactions] = createSignal<TransactionDetails[]>([])

  // Computed values
  const activeCollection = createMemo(() => {
    const found = collections().find(c => c.id === activeCollectionId())
    return found
  })

  const activeTransaction = createMemo(() => {
    const found = transactions().find(t => t.id === selectedTransaction())
    return found
  })

  // Poll for collections and transactions data
  onMount(() => {
    const updateData = () => {
      if (typeof window === 'undefined') return
      try {
        // Update collections
        const newCollections = registry().getAllCollectionMetadata()
        const currentCollections = collections()
        
        // Only update if collections data actually changed
        if (hasCollectionsChanged(currentCollections, newCollections)) {
          setCollections(newCollections)
          
          // Simple auto-selection: if no collection is selected and we have collections, select the first one
          if (activeCollectionId() === '' && newCollections.length > 0) {
            setActiveCollectionId(newCollections[0]?.id ?? '')
          }
        }

        // Update transactions
        const newTransactions = registry().getTransactions()
        setTransactions(newTransactions)
      } catch (error) {
        console.error('Error updating collections:', error)
      }
    }
    updateData()
    const intervalId = setInterval(updateData, POLLING_INTERVAL_MS)
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
            <TabNavigation
              selectedView={selectedView}
              collectionsCount={() => collections().length}
              transactionsCount={() => transactions().length}
              onSelectView={setSelectedView}
            />
          </div>
        </div>
        <div class={styles().collectionsExplorerContainer}>
          {/* Content based on selected view */}
          <div class={styles().sidebarContent}>
            <Show when={selectedView() === 'collections'}>
              <CollectionsPanel
                collections={collections}
                activeCollectionId={activeCollectionId}
                onSelectCollection={(c) => setActiveCollectionId(c.id)}
              />
            </Show>

            <Show when={selectedView() === 'transactions'}>
              <TransactionsPanel
                transactions={transactions}
                selectedTransaction={selectedTransaction}
                onSelectTransaction={setSelectedTransaction}
              />
            </Show>
          </div>
        </div>
      </div>

      <div class={styles().secondContainer}>
        {(() => {
          // If these are placed directly in the attributes it breaks navigation
          const currentSelectedView = selectedView()
          const currentActiveCollection = activeCollection()
          const currentActiveTransaction = activeTransaction()
          return (
            <UnifiedDetailsPanel
              selectedView={currentSelectedView}
              activeCollection={currentActiveCollection}
              activeTransaction={currentActiveTransaction}
            />
          )
        })()}
      </div>
    </div>
  )
}

export default BaseTanStackDbDevtoolsPanel 