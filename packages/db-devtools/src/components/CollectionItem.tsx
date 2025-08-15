import { clsx as cx } from "clsx"
import { useStyles } from "../useStyles"
import { CollectionStats } from "./CollectionStats"
import type { Accessor } from "solid-js"
import type { CollectionMetadata } from "../types"

interface CollectionItemProps {
  collection: CollectionMetadata
  isActive: Accessor<boolean>
  onSelect: (collection: CollectionMetadata) => void
}

export function CollectionItem({
  collection,
  isActive,
  onSelect,
}: CollectionItemProps) {
  const styles = useStyles()

  return (
    <div
      class={cx(
        styles().collectionItem,
        isActive() ? styles().collectionItemActive : ``
      )}
      onClick={() => onSelect(collection)}
    >
      <div class={styles().collectionName}>{collection.id}</div>
      <CollectionStats collection={collection} />
    </div>
  )
}
