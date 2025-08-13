import { clsx as cx } from "clsx"
import { useStyles } from "../useStyles"
import { TransactionStats } from "./TransactionStats"
import type { TransactionDetails } from "../types"

interface TransactionItemProps {
  transaction: TransactionDetails
  isActive: boolean
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
        isActive && styles().collectionItemActive
      )}
      onClick={() => onSelect(transaction.id)}
    >
      <div class={styles().collectionName}>{transaction.id}</div>
      <TransactionStats transaction={transaction} />
    </div>
  )
}
