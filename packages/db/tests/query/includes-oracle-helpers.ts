import { createCollection } from '../../src/collection/index.js'
import { mockSyncCollectionOptions } from '../utils.js'
import type { Collection } from '../../src/collection/index.js'

export type OracleSyncChange<T> = {
  type: `insert` | `update` | `delete`
  value: T
}

export type ControlledCollection<T extends { id: number }> = {
  collection: Collection<T>
  write: (type: OracleSyncChange<T>[`type`], value: T) => void
  writeBatch: (changes: ReadonlyArray<OracleSyncChange<T>>) => void
  resolveSync: () => void
  rejectSync: (error: Error) => void
}

type ControlledCollectionOptions = {
  autoIndex?: `off` | `eager`
  rowUpdateMode?: `partial` | `full`
}

let nextControlledCollectionId = 0

export function createControlledCollection<T extends { id: number }>(
  name: string,
  initialData: ReadonlyArray<T> = [],
  options: ControlledCollectionOptions = {},
): ControlledCollection<T> {
  const collectionOptions = mockSyncCollectionOptions<T>({
    id: `${name}-${nextControlledCollectionId++}`,
    getKey: (row) => row.id,
    initialData: initialData.map((row) => ({ ...row })),
    ...(options.autoIndex ? { autoIndex: options.autoIndex } : {}),
  })
  collectionOptions.sync.rowUpdateMode = options.rowUpdateMode ?? `partial`
  const collection = createCollection(collectionOptions)
  const writeBatch: ControlledCollection<T>[`writeBatch`] = (changes) => {
    collectionOptions.utils.begin()
    for (const change of changes) {
      collectionOptions.utils.write({
        type: change.type,
        value: { ...change.value },
      })
    }
    collectionOptions.utils.commit()
  }

  return {
    collection,
    write(type, value) {
      writeBatch([{ type, value }])
    },
    writeBatch,
    resolveSync: collectionOptions.utils.resolveSync,
    rejectSync: collectionOptions.utils.rejectSync,
  }
}
