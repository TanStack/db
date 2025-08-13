import { Show, createMemo } from "solid-js"
import { useStyles } from "../useStyles"
import { Explorer } from "./Explorer"
import type { CollectionMetadata, TransactionDetails } from "../types"
import type { Accessor } from "solid-js"

export interface DetailsPanelProps {
  selectedView: Accessor<`collections` | `transactions`>
  activeCollection: Accessor<CollectionMetadata | undefined>
  activeTransaction: Accessor<TransactionDetails | undefined>
  isSubPanel?: boolean
}

export function DetailsPanel({
  selectedView,
  activeCollection,
  activeTransaction: _activeTransaction,
}: DetailsPanelProps) {
  const styles = useStyles()

  return (
    <Show when={selectedView() === `collections`}>
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
            <div class={styles().detailsHeader}>{collection().id}</div>
            <div class={styles().detailsContent}>
              <Explorer
                label="Collection"
                value={() => collection()}
                defaultExpanded={{}}
              />
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}

export function TransactionDetailsPanel({
  selectedView,
  activeTransaction: _activeTransaction,
}: DetailsPanelProps) {
  const styles = useStyles()

  return (
    <Show when={selectedView() === `transactions`}>
      <Show
        when={_activeTransaction()}
        fallback={
          <div class={styles().detailsPanel}>
            <div class={styles().detailsHeader}>
              Select a transaction to view details
            </div>
          </div>
        }
      >
        {(transaction) => (
          <div class={styles().detailsPanel}>
            <div class={styles().detailsHeader}>
              Transaction {transaction().id}
            </div>
            <div class={styles().detailsContent}>
              <Explorer
                label="Transaction"
                value={() => transaction()}
                defaultExpanded={{}}
              />
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}

export function GenericDetailsPanel({
  selectedView,
  activeCollection,
  activeTransaction,
  isSubPanel = false,
}: DetailsPanelProps) {
  const styles = useStyles()

  // Create stable value functions using createMemo to prevent unnecessary re-renders
  const collectionValue = createMemo(() => activeCollection())
  const transactionValue = createMemo(() => activeTransaction())

  return (
    <>
      <Show when={selectedView() === `collections`}>
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
              <div class={styles().detailsHeader}>{collection().id}</div>
              <div class={styles().detailsContent}>
                <Explorer
                  label="Collection"
                  value={collectionValue}
                  defaultExpanded={{}}
                />
              </div>
            </div>
          )}
        </Show>
      </Show>

      <Show when={selectedView() === `transactions`}>
        <Show
          when={activeTransaction()}
          fallback={
            <div class={styles().detailsPanel}>
              <div
                class={
                  isSubPanel
                    ? styles().transactionSubHeader
                    : styles().transactionHeader
                }
              >
                Select a transaction to view details
              </div>
            </div>
          }
        >
          {(transaction) => (
            <div class={styles().detailsPanel}>
              <div
                class={
                  isSubPanel
                    ? styles().transactionSubHeader
                    : styles().transactionHeader
                }
              >
                Transaction {transaction().id}
              </div>
              <div class={styles().detailsContent}>
                <Explorer
                  label="Transaction"
                  value={transactionValue}
                  defaultExpanded={{}}
                />
              </div>
            </div>
          )}
        </Show>
      </Show>
    </>
  )
}
