import { Show } from 'solid-js'
import { useStyles } from '../useStyles'
import type { CollectionMetadata, TransactionDetails } from '../types'

interface DetailsPanelProps {
  selectedView: 'collections' | 'transactions'
  activeCollection?: CollectionMetadata
  activeTransaction?: TransactionDetails
}

export function DetailsPanel({
  selectedView,
  activeCollection,
  activeTransaction,
}: DetailsPanelProps) {
  const styles = useStyles()

  return (
    <Show when={selectedView === 'collections'}>
      <Show
        when={activeCollection}
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
    </Show>
  )
}

export function TransactionDetailsPanel({
  selectedView,
  activeTransaction,
}: DetailsPanelProps) {
  const styles = useStyles()

  return (
    <Show when={selectedView === 'transactions'}>
      <Show
        when={activeTransaction}
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
              <pre>{JSON.stringify(transaction(), null, 2)}</pre>
            </div>
          </div>
        )}
      </Show>
    </Show>
  )
}

export function UnifiedDetailsPanel({
  selectedView,
  activeCollection,
  activeTransaction,
}: DetailsPanelProps) {
  const styles = useStyles()

  // Simple conditional rendering
  if (selectedView === 'collections') {
    if (activeCollection) {
      return (
        <div class={styles().detailsPanel}>
          <div class={styles().detailsHeader}>
            {activeCollection.id}
          </div>
          <div class={styles().detailsContent}>
            <pre>{JSON.stringify(activeCollection, null, 2)}</pre>
          </div>
        </div>
      )
    } else {
      return (
        <div class={styles().detailsPanel}>
          <div class={styles().detailsHeader}>
            Select a collection to view details
          </div>
        </div>
      )
    }
  } else if (selectedView === 'transactions') {
    if (activeTransaction) {
      return (
        <div class={styles().detailsPanel}>
          <div class={styles().detailsHeader}>
            Transaction {activeTransaction.id}
          </div>
          <div class={styles().detailsContent}>
            <pre>{JSON.stringify(activeTransaction, null, 2)}</pre>
          </div>
        </div>
      )
    } else {
      return (
        <div class={styles().detailsPanel}>
          <div class={styles().detailsHeader}>
            Select a transaction to view details
          </div>
        </div>
      )
    }
  }

  // Fallback
  return (
    <div class={styles().detailsPanel}>
      <div class={styles().detailsHeader}>
        Unknown view: {selectedView}
      </div>
    </div>
  )
} 