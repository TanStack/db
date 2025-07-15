import { clsx as cx } from 'clsx'
import { useStyles } from '../useStyles'
import { formatTime } from '../utils/formatTime'
import type { CollectionMetadata } from '../types'

interface CollectionStatsProps {
  collection: CollectionMetadata
}

export function CollectionStats({ collection }: CollectionStatsProps) {
  const styles = useStyles()
  
  if (collection.type === 'collection') {
    // Standard collection stats
    return (
      <div class={styles().collectionStats}>
        <div>{collection.size}</div>
        <div>/</div>
        <div>{collection.transactionCount}</div>
        <div>/</div>
        <div>{formatTime(collection.gcTime || 0)}</div>
        <div>/</div>
        <div class={cx(
          styles().collectionStatus,
          collection.status === 'error' ? styles().collectionStatusError : ''
        )}>
          {collection.status}
        </div>
      </div>
    )
  } else {
    // Live query collection stats
    return (
      <div class={styles().collectionStats}>
        <div>{collection.size}</div>
        <div>/</div>
        <div>{formatTime(collection.gcTime || 0)}</div>
        <div>/</div>
        <div class={cx(
          styles().collectionStatus,
          collection.status === 'error' ? styles().collectionStatusError : ''
        )}>
          {collection.status}
        </div>
      </div>
    )
  }
} 