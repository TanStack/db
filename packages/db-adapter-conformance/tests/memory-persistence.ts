// Controlled persistence storage shared by adapter receiving drivers. This
// supplies storage facts, never expected source replacement results.
import type {
  PersistedStorageTarget,
  PersistedTx,
} from '../../db-sqlite-persistence-core/src'

type Row = { id: string; value: number }

/** Narrow a stored value and key to this oracle's row shape. */
export function asRow(value: Record<string, unknown>): Row {
  if (typeof value.id !== `string` || typeof value.value !== `number`) {
    throw new Error(`unexpected stored row: ${JSON.stringify(value)}`)
  }
  return { ...value, id: value.id, value: value.value }
}

export function asKey(key: string | number): string {
  if (typeof key !== `string`) throw new Error(`unexpected key: ${key}`)
  return key
}

export function createAdapter(seed: Array<Row>) {
  const rows = new Map(seed.map((row) => [row.id, row]))
  const rowMetadata = new Map<string, unknown>()
  const collectionMetadata = new Map<string, unknown>()
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0
  const entries = () =>
    Array.from(rows.values()).map((value) => ({
      key: value.id,
      value,
      metadata: rowMetadata.get(value.id),
    }))
  return {
    rows,
    loadSubset: async () => entries(),
    loadResumeSnapshot: async (
      _target: PersistedStorageTarget,
      options?: { includeRows?: boolean },
    ) => ({
      rows: options?.includeRows === false ? [] : entries(),
      keySet: { status: `consistent` as const },
      collectionMetadata: Array.from(
        collectionMetadata.entries(),
        ([key, value]) => ({ key, value }),
      ),
      latestTerm,
      latestSeq,
      latestRowVersion,
      resetEpoch: 0,
    }),
    loadCollectionMetadata: async () =>
      Array.from(collectionMetadata.entries()).map(([key, value]) => ({
        key,
        value,
      })),
    scanRows: async () => entries(),
    applyCommittedTx: async (
      _target: PersistedStorageTarget,
      tx: PersistedTx,
    ) => {
      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        const key = asKey(mutation.key)
        if (mutation.type === `delete`) {
          rows.delete(key)
          rowMetadata.delete(key)
        } else {
          rows.set(key, asRow(mutation.value))
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        const key = asKey(mutation.key)
        if (mutation.type === `delete`) rowMetadata.delete(key)
        else rowMetadata.set(key, mutation.value)
      }
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) collectionMetadata.delete(mutation.key)
        else collectionMetadata.set(mutation.key, mutation.value)
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
    },
    ensureIndex: async () => {},
  }
}
