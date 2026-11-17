/**
 * In-memory persistence collaborators that Query Collection tests and oracles
 * share: a sync metadata API with a persistence capability, and a persisted
 * storage adapter for `persistedCollectionOptions`. They hold data only and
 * judge nothing.
 */
import type { SyncMetadataApi } from '@tanstack/db'
import type { PersistedStorageTarget } from '../../db-sqlite-persistence-core/src'

export function createInMemorySyncMetadataApi<
  TKey extends string | number = string | number,
  TItem extends object = Record<string, unknown>,
>(seed?: {
  rowMetadata?: ReadonlyMap<TKey, unknown>
  collectionMetadata?: ReadonlyMap<string, unknown>
  persistedRows?: ReadonlyMap<TKey, TItem>
}): {
  api: SyncMetadataApi<TKey>
  rowMetadata: Map<TKey, unknown>
  collectionMetadata: Map<string, unknown>
  persistedRows: Map<TKey, TItem>
} {
  const rowMetadata = new Map(seed?.rowMetadata)
  const collectionMetadata = new Map(seed?.collectionMetadata)
  const persistedRows = new Map(seed?.persistedRows)
  const api: SyncMetadataApi<TKey> = {
    row: {
      get: (key: TKey) => rowMetadata.get(key),
      set: (key: TKey, value: unknown) => {
        rowMetadata.set(key, value)
      },
      delete: (key: TKey) => {
        rowMetadata.delete(key)
      },
    },
    persistence: {
      protocol: `@tanstack/db/sync-persistence`,
      version: 1,
      hydrateBaseline: async () => {},
      reserveCommitTurn: () => {},
      scanPersistedRows: async () =>
        Array.from(persistedRows.entries()).map(([key, value]) => ({
          key,
          value,
          metadata: rowMetadata.get(key),
        })),
      resumeSnapshot: {
        certify: async () => {},
        getKeySetEvidence: () => ({ status: `consistent` }),
        expectCurrentCommit: () => {},
      },
    },
    collection: {
      get: (key: string) => collectionMetadata.get(key),
      set: (key: string, value: unknown) => {
        collectionMetadata.set(key, value)
      },
      delete: (key: string) => {
        collectionMetadata.delete(key)
      },
      list: (prefix?: string) =>
        Array.from(collectionMetadata.entries())
          .filter(([key]) => (prefix ? key.startsWith(prefix) : true))
          .map(([key, value]) => ({ key, value })),
    },
  }

  return {
    rowMetadata,
    collectionMetadata,
    persistedRows,
    api,
  }
}

export function createPersistedQueryAdapter<TItem extends { id: string }>(
  seed: {
    rows?: ReadonlyMap<string, TItem>
    rowMetadata?: ReadonlyMap<string, unknown>
    collectionMetadata?: ReadonlyMap<string, unknown>
  } = {},
) {
  const rows = new Map(seed.rows)
  const rowMetadata = new Map(seed.rowMetadata)
  const collectionMetadata = new Map(seed.collectionMetadata)
  let latestTerm = 0
  let latestSeq = 0
  let latestRowVersion = 0

  return {
    rows,
    rowMetadata,
    collectionMetadata,
    loadSubset: async () =>
      Array.from(rows.values()).map((value) => ({
        key: value.id,
        value,
        metadata: rowMetadata.get(value.id),
      })),
    loadResumeSnapshot: async (
      _target: PersistedStorageTarget,
      options?: { includeRows?: boolean },
    ) => ({
      rows:
        options?.includeRows === false
          ? []
          : Array.from(rows.values()).map((value) => ({
              key: value.id,
              value,
              metadata: rowMetadata.get(value.id),
            })),
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
    scanRows: async () =>
      Array.from(rows.values()).map((value) => ({
        key: value.id,
        value,
        metadata: rowMetadata.get(value.id),
      })),
    applyCommittedTx: async (_target: PersistedStorageTarget, tx: any) => {
      if (tx.truncate) {
        rows.clear()
        rowMetadata.clear()
      }
      for (const mutation of tx.mutations) {
        if (mutation.type === `delete`) {
          rows.delete(mutation.key)
          rowMetadata.delete(mutation.key)
        } else {
          rows.set(mutation.key, mutation.value)
        }
      }
      for (const mutation of tx.rowMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          rowMetadata.delete(mutation.key)
        } else {
          rowMetadata.set(mutation.key, mutation.value)
        }
      }
      for (const mutation of tx.collectionMetadataMutations ?? []) {
        if (mutation.type === `delete`) {
          collectionMetadata.delete(mutation.key)
        } else {
          collectionMetadata.set(mutation.key, mutation.value)
        }
      }
      latestTerm = tx.term
      latestSeq = tx.seq
      latestRowVersion = tx.rowVersion
    },
    ensureIndex: async () => {},
  }
}
