import { clsx as cx } from 'clsx'
import { useStyles } from '../useStyles'
import { formatTime } from '../utils/formatTime'
import type { TransactionDetails } from '../types'

interface TransactionStatsProps {
  transaction: TransactionDetails
}

export function TransactionStats({ transaction }: TransactionStatsProps) {
  const styles = useStyles()
  
  const age = Date.now() - transaction.createdAt.getTime()
  
  return (
    <div class={styles().collectionStats}>
      <div>{transaction.mutations.length}</div>
      <div>/</div>
      <div>1</div>
      <div>/</div>
      <div>{formatTime(age)}</div>
      <div>/</div>
      <div class={cx(
        styles().collectionStatus,
        transaction.state === 'error' ? styles().collectionStatusError : ''
      )}>
        {transaction.state}
      </div>
    </div>
  )
} 