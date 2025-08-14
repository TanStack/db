import { clsx as cx } from "clsx"
import { Show, createEffect, createMemo, createSignal } from "solid-js"
import { useLiveQuery } from "@tanstack/solid-db"
import { createLiveQueryCollection, createCollection, localOnlyCollectionOptions } from "@tanstack/db"
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
  DbDevtoolsRegistry,
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

    // Reactive views derived from live queries
    // We'll compute these as memos that create fresh arrays so Solid tracks per-update

    // Use useLiveQuery for reactive data from devtools collections
    // Wrap in try-catch to prevent crashes if collections are not properly initialized
    let collectionsQuery: any
    let transactionsQuery: any
    let collectionsLQ: any
    let transactionsLQ: any
    // Local-only empty placeholders for early-render fallbacks
    let emptyCollectionsCol: any
    let emptyTransactionsCol: any
    
    try {
      // Precreate a live query collection for collections, mark as devtools internal to avoid self-registration
      collectionsQuery = useLiveQuery(() => {
        const reg = registry()
        if (!reg || !reg.store || !reg.store.collections) {
          if (!emptyCollectionsCol) {
            emptyCollectionsCol = createCollection(
              localOnlyCollectionOptions({
                id: `__devtools_empty_collections`,
                __devtoolsInternal: true,
                getKey: (entry: any) => entry.id ?? Math.random().toString(36),
              })
            )
          }
          return createLiveQueryCollection({
            __devtoolsInternal: true,
            id: `__devtools_view_collections_empty`,
            query: (q: any) => q.from({ collections: emptyCollectionsCol }),
            startSync: true,
            gcTime: 5000,
          } as any)
        }
        if (!collectionsLQ) {
          collectionsLQ = createLiveQueryCollection({
            __devtoolsInternal: true,
            id: `__devtools_view_collections`,
            startSync: true,
            gcTime: 5000,
            query: (q: any) =>
              q
                .from({ collections: reg.store.collections })
                .select(({ collections }: any) => ({
                  id: collections.id,
                  type: collections.metadata.type,
                  status: collections.metadata.status,
                  size: collections.metadata.size,
                  hasTransactions: collections.metadata.hasTransactions,
                  transactionCount: collections.metadata.transactionCount,
                  createdAt: collections.metadata.createdAt,
                  lastUpdated: collections.metadata.lastUpdated,
                  gcTime: collections.metadata.gcTime,
                  timings: collections.metadata.timings,
                })),
          } as any)
        }
        return collectionsLQ
      })

      transactionsQuery = useLiveQuery(() => {
        const reg = registry()
        if (!reg || !reg.store || !reg.store.transactions) {
          if (!emptyTransactionsCol) {
            emptyTransactionsCol = createCollection(
              localOnlyCollectionOptions({
                id: `__devtools_empty_transactions`,
                __devtoolsInternal: true,
                getKey: (entry: any) => entry.id ?? Math.random().toString(36),
              })
            )
          }
          return createLiveQueryCollection({
            __devtoolsInternal: true,
            id: `__devtools_view_transactions_empty`,
            query: (q: any) => q.from({ transactions: emptyTransactionsCol }),
            startSync: true,
            gcTime: 5000,
          } as any)
        }
        if (!transactionsLQ) {
          transactionsLQ = createLiveQueryCollection({
            __devtoolsInternal: true,
            id: `__devtools_view_transactions`,
            startSync: true,
            gcTime: 5000,
            query: (q: any) =>
              q
                .from({ transactions: reg.store.transactions })
                .select(({ transactions }: any) => ({
                  id: transactions.id,
                  collectionId: transactions.collectionId,
                  state: transactions.state,
                  mutations: transactions.mutations,
                  createdAt: transactions.createdAt,
                  updatedAt: transactions.updatedAt,
                  isPersisted: transactions.isPersisted,
                })),
          } as any)
        }
        return transactionsLQ
      })

      // No explicit effects needed; we'll read from queries directly in memos below
    } catch (error) {
      console.error('Error initializing useLiveQuery:', error)
      collectionsQuery = { data: [] as any[] }
      transactionsQuery = { data: [] as any[] }
    }

    // Reactive arrays derived from live queries (copy to trigger tracking)
    const collectionsArray = createMemo(() =>
      Array.isArray(collectionsQuery.data)
        ? (collectionsQuery.data as Array<any>).slice()
        : []
    )
    const transactions = createMemo(() => {
      const raw = Array.isArray(transactionsQuery.data)
        ? (transactionsQuery.data as Array<any>).slice()
        : []
      return raw.map((entry: any) => ({
        id: entry.id,
        collectionId: entry.collectionId,
        state: entry.state,
        mutations: entry.mutations,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        isPersisted: entry.isPersisted,
      }))
    })

    // Computed values
    const activeCollection = createMemo(() => {
      try {
        const data = collectionsArray()
        if (!data || !Array.isArray(data)) {
          return undefined
        }
        const found = data.find((c: any) => c.id === activeCollectionId())
        return found
      } catch (error) {
        console.error('Error in activeCollection memo:', error)
        return undefined
      }
    })

    const activeTransaction = createMemo(() => {
      try {
        const transactionsData = transactions()
        if (!transactionsData || !Array.isArray(transactionsData)) return undefined
        const found = transactionsData.find((t: any) => t.id === selectedTransaction())
        return found
      } catch (error) {
        console.error('Error in activeTransaction memo:', error)
        return undefined
      }
    })

    // Use reactive data for immediate updates
    createEffect(() => {
      try {
        // Get collections from reactive signal
        const newCollections = collectionsArray()
        if (!newCollections || !Array.isArray(newCollections)) {
          return
        }

        // Simple auto-selection: if no collection is selected and we have collections, select the first one
        if (activeCollectionId() === `` && newCollections.length > 0) {
          setActiveCollectionId(newCollections[0]?.id ?? ``)
        }
      } catch (error) {
        console.error('Error updating collections:', error)
      }
    })

    // Note: Transactions are handled reactively through useLiveQuery

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
                collectionsCount={() => collectionsArray().length}
                transactionsCount={() => {
                  try {
                    return transactions().length
                  } catch (error) {
                    console.error('Error getting transactions count:', error)
                    return 0
                  }
                }}
                onSelectView={setSelectedView}
              />
            </div>
          </div>
          <div class={styles().collectionsExplorerContainer}>
            {/* Content based on selected view */}
            <div class={styles().sidebarContent}>
              <Show when={selectedView() === `collections`}>
                <CollectionsPanel
                  collections={collectionsArray as any}
                  activeCollectionId={activeCollectionId}
                  onSelectCollection={(c) => setActiveCollectionId(c.id)}
                />
              </Show>

              <Show when={selectedView() === `transactions`}>
                <TransactionsPanel
                  transactions={() => {
                    try {
                      if (typeof transactions !== 'function') return []
                      return transactions()
                    } catch (error) {
                      console.error('Error getting transactions for panel:', error)
                      return []
                    }
                  }}
                  selectedTransaction={selectedTransaction}
                  onSelectTransaction={setSelectedTransaction}
                />
              </Show>
            </div>
          </div>
        </div>

        <div class={styles().secondContainer}>
          <Show when={selectedView() === `collections`}>
            <CollectionDetailsPanel activeCollection={activeCollection as any} />
          </Show>
          <Show when={selectedView() === `transactions`}>
            <GenericDetailsPanel
              selectedView={selectedView}
              activeCollection={activeCollection as any}
              activeTransaction={activeTransaction as any}
            />
          </Show>
        </div>
      </div>
    )
  }

export default BaseTanStackDbDevtoolsPanel
