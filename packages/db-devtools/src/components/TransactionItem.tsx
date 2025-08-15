import { clsx as cx } from "clsx"
import { useStyles } from "../useStyles"
import { TransactionStats } from "./TransactionStats"
import type { Accessor } from "solid-js"
import type { TransactionDetails } from "../types"

interface TransactionItemProps {
  transaction: TransactionDetails
  isActive: Accessor<boolean>
  onSelect: (transactionId: string) => void
}

export function TransactionItem({
  transaction,
  isActive,
  onSelect,
}: TransactionItemProps) {
  const styles = useStyles()

  return (
    <div
      class={cx(
        styles().collectionItem,
        isActive() && styles().collectionItemActive
      )}
      onClick={() => onSelect(transaction.id)}
    >
      {isActive() ? <div class={styles().activeIndicator} /> : null}
      <div class={styles().collectionName}>{transaction.id}</div>
      <TransactionStats transaction={transaction} />
    </div>
  )
}
