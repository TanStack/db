import {
  DeleteOperationItemNotFoundError,
  DuplicateKeyInBatchError,
  SyncNotInitializedError,
  UpdateOperationItemNotFoundError,
} from "./errors"
import type { QueryClient } from "@tanstack/query-core"
import type { ChangeMessage, Collection } from "@tanstack/db"

// Types for sync operations
export type SyncOperation<
  TRow extends object,
  TKey extends string | number = string | number,
  TInsertInput extends object = TRow,
> =
  | { type: `insert`; data: TInsertInput | Array<TInsertInput> }
  | { type: `update`; data: Partial<TRow> | Array<Partial<TRow>> }
  | { type: `delete`; key: TKey | Array<TKey> }
  | { type: `upsert`; data: Partial<TRow> | Array<Partial<TRow>> }

export interface SyncContext<
  TRow extends object,
  TKey extends string | number = string | number,
> {
  collection: Collection<TRow>
  queryClient: QueryClient
  queryKey: Array<unknown>
  getKey: (item: TRow) => TKey
  begin: () => void
  write: (message: Omit<ChangeMessage<TRow>, `key`>) => void
  commit: () => void
}

interface NormalizedOperation<
  TRow extends object,
  TKey extends string | number = string | number,
> {
  type: `insert` | `update` | `delete` | `upsert`
  key: TKey
  data?: TRow | Partial<TRow>
}

// Normalize operations into a consistent format
function normalizeOperations<
  TRow extends object,
  TKey extends string | number = string | number,
  TInsertInput extends object = TRow,
>(
  ops:
    | SyncOperation<TRow, TKey, TInsertInput>
    | Array<SyncOperation<TRow, TKey, TInsertInput>>,
  ctx: SyncContext<TRow, TKey>
): Array<NormalizedOperation<TRow, TKey>> {
  const operations = Array.isArray(ops) ? ops : [ops]
  const normalized: Array<NormalizedOperation<TRow, TKey>> = []

  for (const op of operations) {
    if (op.type === `delete`) {
      const keys = Array.isArray(op.key) ? op.key : [op.key]
      for (const key of keys) {
        normalized.push({ type: `delete`, key })
      }
    } else {
      const items = Array.isArray(op.data) ? op.data : [op.data]
      for (const item of items) {
        let key: TKey
        if (op.type === `update`) {
          // For updates, we need to get the key from the partial data
          key = ctx.getKey(item as TRow)
        } else {
          // For insert/upsert, validate and resolve the full item first
          const resolved = ctx.collection.validateData(
            item,
            op.type === `upsert` ? `insert` : op.type
          )
          key = ctx.getKey(resolved)
        }
        normalized.push({ type: op.type, key, data: item })
      }
    }
  }

  return normalized
}

// Validate operations before executing
function validateOperations<
  TRow extends object,
  TKey extends string | number = string | number,
>(
  operations: Array<NormalizedOperation<TRow, TKey>>,
  ctx: SyncContext<TRow, TKey>
): void {
  const seenKeys = new Set<TKey>()

  for (const op of operations) {
    // Check for duplicate keys within the batch
    if (seenKeys.has(op.key)) {
      throw new DuplicateKeyInBatchError(op.key)
    }
    seenKeys.add(op.key)

    // Validate operation-specific requirements
    if (op.type === `update`) {
      if (!ctx.collection.has(op.key)) {
        throw new UpdateOperationItemNotFoundError(op.key)
      }
    } else if (op.type === `delete`) {
      if (!ctx.collection.has(op.key)) {
        throw new DeleteOperationItemNotFoundError(op.key)
      }
    }
  }
}

// Execute a batch of operations
export function performSyncOperations<
  TRow extends object,
  TKey extends string | number = string | number,
  TInsertInput extends object = TRow,
>(
  operations:
    | SyncOperation<TRow, TKey, TInsertInput>
    | Array<SyncOperation<TRow, TKey, TInsertInput>>,
  ctx: SyncContext<TRow, TKey>
): void {
  const normalized = normalizeOperations(operations, ctx)
  validateOperations(normalized, ctx)

  ctx.begin()

  for (const op of normalized) {
    switch (op.type) {
      case `insert`: {
        const resolved = ctx.collection.validateData(op.data, `insert`)
        ctx.write({
          type: `insert`,
          value: resolved,
        })
        break
      }
      case `update`: {
        const currentItem = ctx.collection.get(op.key)!
        const updatedItem = {
          ...currentItem,
          ...op.data,
        }
        const resolved = ctx.collection.validateData(
          updatedItem,
          `update`,
          op.key
        )
        ctx.write({
          type: `update`,
          value: resolved,
        })
        break
      }
      case `delete`: {
        const currentItem = ctx.collection.get(op.key)!
        ctx.write({
          type: `delete`,
          value: currentItem,
        })
        break
      }
      case `upsert`: {
        const resolved = ctx.collection.validateData(
          op.data,
          ctx.collection.has(op.key) ? `update` : `insert`,
          op.key
        )
        if (ctx.collection.has(op.key)) {
          ctx.write({
            type: `update`,
            value: resolved,
          })
        } else {
          ctx.write({
            type: `insert`,
            value: resolved,
          })
        }
        break
      }
    }

    ctx.commit()

    // Update query cache after successful commit
    const updatedData = ctx.collection.toArray
    ctx.queryClient.setQueryData(ctx.queryKey, updatedData)
  }
}

// Factory function to create sync utils
export function createSyncUtils<
  TRow extends object,
  TKey extends string | number = string | number,
  TInsertInput extends object = TRow,
>(getContext: () => SyncContext<TRow, TKey> | null) {
  function ensureContext(): SyncContext<TRow, TKey> {
    const context = getContext()
    if (!context) {
      throw new SyncNotInitializedError()
    }
    return context
  }

  return {
    syncInsert(data: TInsertInput | Array<TInsertInput>) {
      const ctx = ensureContext()
      performSyncOperations({ type: `insert`, data }, ctx)
    },

    syncUpdate(data: Partial<TRow> | Array<Partial<TRow>>) {
      const ctx = ensureContext()
      performSyncOperations({ type: `update`, data }, ctx)
    },

    syncDelete(key: TKey | Array<TKey>) {
      const ctx = ensureContext()
      performSyncOperations({ type: `delete`, key }, ctx)
    },

    syncUpsert(data: Partial<TRow> | Array<Partial<TRow>>) {
      const ctx = ensureContext()
      performSyncOperations({ type: `upsert`, data }, ctx)
    },

    syncBatch(operations: Array<SyncOperation<TRow, TKey, TInsertInput>>) {
      const ctx = ensureContext()
      performSyncOperations(operations, ctx)
    },
  }
}
