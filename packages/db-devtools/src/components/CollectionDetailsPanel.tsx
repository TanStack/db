import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js"
import { useLiveQuery } from "@tanstack/solid-db"
import {
  createCollection,
  createLiveQueryCollection,
  eq,
  localOnlyCollectionOptions,
} from "@tanstack/db"
import { clsx as cx } from "clsx"
import { useStyles } from "../useStyles"
import { getDevtoolsRegistry } from "../devtools"
import { Explorer } from "./Explorer"
import { TransactionsPanel } from "./TransactionsPanel"
import { GenericDetailsPanel } from "./DetailsPanel"
import type { CollectionMetadata } from "../types"
import type { Accessor } from "solid-js"

export interface CollectionDetailsPanelProps {
  activeCollection: Accessor<CollectionMetadata | undefined>
}

type CollectionTab = `summary` | `config` | `state` | `transactions` | `data` | `query-ir`

export function CollectionDetailsPanel({
  activeCollection,
}: CollectionDetailsPanelProps) {
  const styles = useStyles()
  const [selectedTab, setSelectedTab] = createSignal<CollectionTab>(`summary`)
  
  // Reset selected tab if it's not available for the current collection
  createEffect(() => {
    const currentCollection = collection()
    const availableTabs = tabs()
    const currentTab = selectedTab()
    
    if (currentCollection && !availableTabs.find(tab => tab.id === currentTab)) {
      setSelectedTab(`summary`)
    }
  })
  const [selectedTransaction, setSelectedTransaction] = createSignal<
    string | null
  >(null)
  const registry = getDevtoolsRegistry()

  const collection = createMemo(() => {
    const metadata = activeCollection()
    if (!metadata || !registry) return null

    // Get the actual collection instance
    const collectionInstance = registry.getCollection(metadata.id)
    return { metadata, instance: collectionInstance }
  })

  // Bump a reactive tick when the underlying collection emits changes
  const [stateVersion, setStateVersion] = createSignal(0)
  createEffect(() => {
    const current = collection()
    if (!current || !current.instance) return
    const unsubscribe = current.instance.subscribeChanges(() => {
      // Any change to the collection should retrigger the state view
      setStateVersion((v) => v + 1)
    })
    onCleanup(() => {
      unsubscribe()
    })
  })

  // Live query for transactions filtered to the active collection
  let emptyTransactionsCol: any
  const transactionsForCollectionQuery: any = useLiveQuery(() => {
    const metadata = activeCollection()
    if (!emptyTransactionsCol) {
      emptyTransactionsCol = createCollection(
        localOnlyCollectionOptions({
          id: `__devtools_empty_transactions_for_collection`,
          __devtoolsInternal: true,
          getKey: (entry: any) => entry.id ?? Math.random().toString(36),
        })
      )
    }

    if (!registry || !metadata) {
      return createLiveQueryCollection({
        __devtoolsInternal: true,
        id: `__devtools_view_transactions_for_collection_empty_local`,
        startSync: true,
        gcTime: 3000,
        query: (q: any) => q.from({ transactions: emptyTransactionsCol }),
      } as any)
    }

    return createLiveQueryCollection({
      __devtoolsInternal: true,
      id: `__devtools_view_transactions_for_collection_${metadata.id}`,
      startSync: true,
      gcTime: 5000,
      query: (q: any) =>
        q
          .from({ transactions: registry.store.transactions })
          .where(({ transactions }: any) =>
            eq(transactions.collectionId, metadata.id)
          )
          .orderBy(({ transactions }: any) => transactions.createdAt, `desc`)
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
  })

  const collectionTransactions = createMemo(() => {
    const raw = Array.isArray(transactionsForCollectionQuery.data)
      ? (transactionsForCollectionQuery.data as Array<any>).slice()
      : []
    return raw
  })

  const activeTransaction = createMemo(() => {
    const txs = collectionTransactions()
    const selectedId = selectedTransaction()
    return txs.find((t) => t.id === selectedId)
  })

  const tabs = createMemo(() => {
    const currentCollection = collection()
    const baseTabs: Array<{ id: CollectionTab; label: string }> = [
      { id: `summary`, label: `Summary` },
      { id: `config`, label: `Config` },
      { id: `state`, label: `State` },
      { id: `transactions`, label: `Transactions` },
      { id: `data`, label: `Data` },
    ]
    
    // Only add Query IR tab for live query collections
    if (currentCollection?.metadata.type === `live-query`) {
      baseTabs.push({ id: `query-ir`, label: `Query IR` })
    }
    
    return baseTabs
  })

  const renderTabContent = () => {
    const currentCollection = collection()
    if (!currentCollection) return null

    const { metadata, instance } = currentCollection

    switch (selectedTab()) {
      case `summary`: {
        return (
          <Explorer
            label="Collection Metadata"
            value={() => metadata}
            defaultExpanded={{}}
          />
        )
      }

      case `config`: {
        return instance ? (
          <Explorer
            label="Collection Config"
            value={() => {
              // Filter out devtools internal properties
              const config = { ...instance.config }
              delete config.__devtoolsInternal
              delete config.__devtoolsQueryIR
              return config
            }}
            defaultExpanded={{}}
          />
        ) : (
          <div class={styles().noDataMessage}>
            Collection instance not available
          </div>
        )
      }

      case `state`: {
        if (!instance) {
          return (
            <div class={styles().noDataMessage}>
              Collection instance not available
            </div>
          )
        }

        // Depend on stateVersion so updates re-render this block
        stateVersion()
        const stateData = {
          syncedData: instance.syncedData,
          optimisticUpserts: instance.optimisticUpserts,
          optimisticDeletes: instance.optimisticDeletes,
        }

        return (
          <Explorer
            label="Collection State"
            value={() => stateData}
            defaultExpanded={{}}
          />
        )
      }

      case `transactions`: {
        const transactions = collectionTransactions()
        return (
          <div class={styles().splitPanelContainer}>
            <div class={styles().splitPanelLeft}>
              <TransactionsPanel
                transactions={() => transactions}
                selectedTransaction={selectedTransaction}
                onSelectTransaction={setSelectedTransaction}
              />
            </div>
            <div class={styles().splitPanelRight}>
              <GenericDetailsPanel
                selectedView={() => `transactions` as const}
                activeCollection={() => undefined}
                activeTransaction={activeTransaction}
                isSubPanel={true}
              />
            </div>
          </div>
        )
      }

      case `data`: {
        return (
          <div class={styles().noDataMessage}>Grid view coming soon...</div>
        )
      }

      case `query-ir`: {
        const currentCollection = collection()
        if (!currentCollection?.instance) {
          return (
            <div class={styles().noDataMessage}>
              Collection instance not available
            </div>
          )
        }

        // Only show for live query collections
        if (currentCollection.metadata.type !== `live-query`) {
          return (
            <div class={styles().noDataMessage}>
              Query IR is only available for live query collections
            </div>
          )
        }

        const queryIR = currentCollection.instance.config.__devtoolsQueryIR
        if (!queryIR) {
          return (
            <div class={styles().noDataMessage}>
              Query IR not available for this collection
            </div>
          )
        }

        return (
          <div>
            <Explorer
              label="Unoptimized Query IR"
              value={() => queryIR.unoptimized}
              defaultExpanded={{}}
            />
            <Explorer
              label="Optimized Query IR"
              value={() => queryIR.optimized}
              defaultExpanded={{}}
            />
          </div>
        )
      }

      default:
        return null
    }
  }

  return (
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
      {(collectionMetadata) => (
        <div class={styles().detailsPanel}>
          <div class={styles().detailsHeaderRow}>
            <div class={styles().detailsHeader}>{collectionMetadata().id}</div>
            <div class={styles().collectionTabNav}>
              {tabs().map((tab) => (
                <button
                  onClick={() => setSelectedTab(tab.id)}
                  class={cx(
                    styles().collectionTabBtn,
                    selectedTab() === tab.id && styles().collectionTabBtnActive
                  )}
                >
                  {tab.label}
                  {tab.id === `transactions` &&
                    Array.isArray(transactionsForCollectionQuery.data) &&
                    (transactionsForCollectionQuery.data as Array<any>).length >
                      0 && (
                      <span class={styles().tabBadge}>
                        {
                          (transactionsForCollectionQuery.data as Array<any>)
                            .length
                        }
                      </span>
                    )}
                </button>
              ))}
            </div>
          </div>

          {/* Tab Content */}
          <div
            class={
              selectedTab() === `transactions`
                ? styles().detailsContentNoPadding
                : styles().detailsContent
            }
          >
            {renderTabContent()}
          </div>
        </div>
      )}
    </Show>
  )
}
