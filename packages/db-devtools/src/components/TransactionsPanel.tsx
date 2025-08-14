import { For, Show } from "solid-js"
import { useStyles } from "../useStyles"
import { TransactionItem } from "./TransactionItem"
import type { Accessor } from "solid-js"
import type { TransactionDetails } from "../types"

interface TransactionsPanelProps {
  transactions: Accessor<Array<TransactionDetails>>
  selectedTransaction: Accessor<string | null>
  onSelectTransaction: (transactionId: string) => void
}

export function TransactionsPanel({
  transactions,
  selectedTransaction,
  onSelectTransaction,
}: TransactionsPanelProps) {
  const styles = useStyles()

  return (
    <div class={styles().transactionsExplorer}>
      <div class={styles().collectionsList}>
        <div class={styles().collectionGroup}>
          <div class={styles().collectionGroupHeader}>
            <div>Transactions</div>
            <div class={styles().collectionGroupStats}>
              <span>Mutations</span>
              <span>/</span>
              <span>Collections</span>
              <span>/</span>
              <span>Age</span>
              <span>/</span>
              <span>Status</span>
            </div>
          </div>
          <Show
            when={transactions().length > 0}
            fallback={
              <div style={{ padding: `16px`, color: `#666` }}>
                No transactions found
              </div>
            }
          >
            <For each={transactions()}>
              {(transaction) => (
                <TransactionItem
                  transaction={transaction}
                  isActive={() => selectedTransaction() === transaction.id}
                  onSelect={onSelectTransaction}
                />
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  )
}
