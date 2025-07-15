import { clsx as cx } from "clsx"
import { Show, createMemo, createSignal, onMount } from "solid-js"
import { useDevtoolsOnClose } from "./contexts"
import { useStyles } from "./useStyles"
import { useLocalStorage } from "./useLocalStorage"
import { POLLING_INTERVAL_MS } from "./constants"
import {
  CollectionsPanel,
  Logo,
  TabNavigation,
  TransactionsPanel,
  UnifiedDetailsPanel,
} from "./components"
import type { Accessor, JSX } from "solid-js"
import type {
  CollectionMetadata,
  DbDevtoolsRegistry,
  TransactionDetails,
} from "./types"

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

export const BaseTanStackDbDevtoolsPanel =
  function BaseTanStackDbDevtoolsPanel({
    ...props
  }: BaseDbDevtoolsPanelOptions): JSX.Element {
    const { setIsOpen, handleDragStart, registry, ...panelProps } = props

    const { onCloseClick } = useDevtoolsOnClose()
    const styles = useStyles()
    const { className, style, ...otherPanelProps } = panelProps

    // Simple local state - no navigation store complexity
    const [selectedView, setSelectedView] = createSignal<
      `collections` | `transactions`
    >(`collections`)
    const [activeCollectionId, setActiveCollectionId] = useLocalStorage(
      `tanstackDbDevtoolsActiveCollectionId`,
      ``
    )
    const [selectedTransaction, setSelectedTransaction] = createSignal<
      string | null
    >(null)
    const [collections, setCollections] = createSignal<
      Array<CollectionMetadata>
    >([])
    const [transactions, setTransactions] = createSignal<
      Array<TransactionDetails>
    >([])

    // Computed values
    const activeCollection = createMemo(() => {
      const found = collections().find((c) => c.id === activeCollectionId())
      return found
    })

    const activeTransaction = createMemo(() => {
      const found = transactions().find((t) => t.id === selectedTransaction())
      return found
    })

    // Poll for collections and transactions data
    onMount(() => {
      const updateData = () => {
        if (typeof window === `undefined`) return
        try {
          // Update collections
          const newCollections = registry().getAllCollectionMetadata()
          const currentCollections = collections()

          // Only update if collections data actually changed
          if (hasCollectionsChanged(currentCollections, newCollections)) {
            // Patch/update instead of replace: preserve references for unchanged collections
            setCollections((prev) =>
              newCollections.map((newCol) => {
                const oldCol = prev.find((c) => c.id === newCol.id)
                if (
                  oldCol &&
                  oldCol.status === newCol.status &&
                  oldCol.size === newCol.size &&
                  oldCol.hasTransactions === newCol.hasTransactions &&
                  oldCol.transactionCount === newCol.transactionCount &&
                  oldCol.type === newCol.type &&
                  oldCol.gcTime === newCol.gcTime
                  // Note: We intentionally ignore lastUpdated since it changes on every poll
                ) {
                  return oldCol // preserve reference
                } else {
                  return newCol // use new object if changed
                }
              })
            )
            // Simple auto-selection: if no collection is selected and we have collections, select the first one
            if (activeCollectionId() === `` && newCollections.length > 0) {
              setActiveCollectionId(newCollections[0]?.id ?? ``)
            }
          }

          // Update transactions
          const newTransactions = registry().getTransactions()
          const currentTransactions = transactions()

          // Only update if transactions data actually changed
          if (hasTransactionsChanged(currentTransactions, newTransactions)) {
            // Patch/update instead of replace: preserve references for unchanged transactions
            setTransactions((prev) =>
              newTransactions.map((newTx) => {
                const oldTx = prev.find((t) => t.id === newTx.id)
                if (
                  oldTx &&
                  oldTx.state === newTx.state &&
                  oldTx.isPersisted === newTx.isPersisted &&
                  oldTx.mutations.length === newTx.mutations.length &&
                  oldTx.collectionId === newTx.collectionId
                  // Note: We intentionally ignore updatedAt since it might change
                ) {
                  return oldTx // preserve reference
                } else {
                  return newTx // use new object if changed
                }
              })
            )
          }
        } catch {
          // console.error(`Error updating collections:`, error)
        }
      }
      updateData()
      const intervalId = setInterval(updateData, POLLING_INTERVAL_MS)
      return () => clearInterval(intervalId)
    })

    // Helper function to detect if collections data actually changed
    const hasCollectionsChanged = (
      oldCollections: Array<CollectionMetadata>,
      newCollections: Array<CollectionMetadata>
    ): boolean => {
      if (oldCollections.length !== newCollections.length) return true

      // Create maps for O(1) lookup by ID
      const oldMap = new Map(oldCollections.map((c) => [c.id, c]))
      const newMap = new Map(newCollections.map((c) => [c.id, c]))

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

    // Helper function to detect if transactions data actually changed
    const hasTransactionsChanged = (
      oldTransactions: Array<TransactionDetails>,
      newTransactions: Array<TransactionDetails>
    ): boolean => {
      if (oldTransactions.length !== newTransactions.length) return true

      // Create maps for O(1) lookup by ID
      const oldMap = new Map(oldTransactions.map((t) => [t.id, t]))
      const newMap = new Map(newTransactions.map((t) => [t.id, t]))

      // Check if any transaction data changed by comparing by ID
      for (const [id, old] of oldMap) {
        const new_ = newMap.get(id)
        if (!new_) return true // Transaction was removed

        if (old.state !== new_.state) return true
        if (old.isPersisted !== new_.isPersisted) return true
        if (old.mutations.length !== new_.mutations.length) return true
        if (old.collectionId !== new_.collectionId) return true
      }

      // Check if any new transactions were added
      for (const [id] of newMap) {
        if (!oldMap.has(id)) return true
      }

      return false
    }

    return (
      <div
        class={cx(
          styles().devtoolsPanel,
          `TanStackDbDevtoolsPanel`,
          className ? className() : ``
        )}
        style={style ? style() : ``}
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
              <Show when={selectedView() === `collections`}>
                <CollectionsPanel
                  collections={collections}
                  activeCollectionId={activeCollectionId}
                  onSelectCollection={(c) => setActiveCollectionId(c.id)}
                />
              </Show>

              <Show when={selectedView() === `transactions`}>
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
          <UnifiedDetailsPanel
            selectedView={selectedView}
            activeCollection={activeCollection}
            activeTransaction={activeTransaction}
          />
        </div>
      </div>
    )
  }

export default BaseTanStackDbDevtoolsPanel
