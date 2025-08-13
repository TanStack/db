import { Show, createMemo, createSignal } from "solid-js"
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

type CollectionTab = `summary` | `config` | `state` | `transactions` | `data`

export function CollectionDetailsPanel({
  activeCollection,
}: CollectionDetailsPanelProps) {
  const styles = useStyles()
  const [selectedTab, setSelectedTab] = createSignal<CollectionTab>(`summary`)
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

  const collectionTransactions = createMemo(() => {
    const metadata = activeCollection()
    if (!metadata || !registry) return []

    return registry.getTransactions(metadata.id)
  })

  const activeTransaction = createMemo(() => {
    const transactions = collectionTransactions()
    const selectedId = selectedTransaction()
    return transactions.find((t) => t.id === selectedId)
  })

  const tabs: Array<{ id: CollectionTab; label: string }> = [
    { id: `summary`, label: `Summary` },
    { id: `config`, label: `Config` },
    { id: `state`, label: `State` },
    { id: `transactions`, label: `Transactions` },
    { id: `data`, label: `Data` },
  ]

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
            value={() => instance.config}
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
              {tabs.map((tab) => (
                <button
                  onClick={() => setSelectedTab(tab.id)}
                  class={cx(
                    styles().collectionTabBtn,
                    selectedTab() === tab.id && styles().collectionTabBtnActive
                  )}
                >
                  {tab.label}
                  {tab.id === `transactions` &&
                    collectionTransactions().length > 0 && (
                      <span class={styles().tabBadge}>
                        {collectionTransactions().length}
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
