import { clsx as cx } from "clsx"
import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { useDevtoolsOnClose } from "./contexts"
import { useStyles } from "./useStyles"
import { useLocalStorage } from "./useLocalStorage"
import {
  CollectionDetailsPanel,
  CollectionsPanel,
  GenericDetailsPanel,
  Logo,
  TabNavigation,
  TransactionsPanel,
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

    // Use reactive signals for immediate updates
    createEffect(() => {
      try {
        // Get collections from reactive signal
        const newCollections = registry().collectionsSignal()

        // Simple auto-selection: if no collection is selected and we have collections, select the first one
        if (activeCollectionId() === `` && newCollections.length > 0) {
          setActiveCollectionId(newCollections[0]?.id ?? ``)
        }

        // Update collections state
        setCollections(newCollections)
      } catch {
        // console.error(`Error updating collections:`, error)
      }
    })

    createEffect(() => {
      try {
        // Get transactions from reactive signal
        const newTransactions = registry().transactionsSignal()

        // Update transactions state
        setTransactions(newTransactions)
      } catch {
        // console.error(`Error updating transactions:`, error)
      }
    })

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
          <Show when={selectedView() === `collections`}>
            <CollectionDetailsPanel activeCollection={activeCollection} />
          </Show>
          <Show when={selectedView() === `transactions`}>
            <GenericDetailsPanel
              selectedView={selectedView}
              activeCollection={activeCollection}
              activeTransaction={activeTransaction}
            />
          </Show>
        </div>
      </div>
    )
  }

export default BaseTanStackDbDevtoolsPanel
