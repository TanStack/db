import {
  DeleteOperationItemNotFoundError,
  DuplicateKeyInBatchError,
  SyncNotInitializedError,
  UpdateOperationItemNotFoundError,
} from "./errors"
import type { QueryClient } from "@tanstack/query-core"
import type { ChangeMessage, Collection } from "@tanstack/db"

// Track active batch operations
let activeBatchContext: {
  operations: Array<SyncOperation<any, any, any>>
  ctx: SyncContext<any, any>
} | null = null

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
export function performWriteOperations<
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
  }

  ctx.commit()

  // Update query cache after successful commit
  const updatedData = ctx.collection.toArray
  ctx.queryClient.setQueryData(ctx.queryKey, updatedData)
}

// Factory function to create write utils
export function createWriteUtils<
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
    writeInsert(data: TInsertInput | Array<TInsertInput>) {
      const operation: SyncOperation<TRow, TKey, TInsertInput> = {
        type: `insert`,
        data,
      }

      // If we're in a batch, just add to the batch operations
      if (activeBatchContext) {
        activeBatchContext.operations.push(operation)
        return
      }

      // Otherwise, perform the operation immediately
      const ctx = ensureContext()
      performWriteOperations(operation, ctx)
    },

    writeUpdate(data: Partial<TRow> | Array<Partial<TRow>>) {
      const operation: SyncOperation<TRow, TKey, TInsertInput> = {
        type: `update`,
        data,
      }

      if (activeBatchContext) {
        activeBatchContext.operations.push(operation)
        return
      }

      const ctx = ensureContext()
      performWriteOperations(operation, ctx)
    },

    writeDelete(key: TKey | Array<TKey>) {
      const operation: SyncOperation<TRow, TKey, TInsertInput> = {
        type: `delete`,
        key,
      }

      if (activeBatchContext) {
        activeBatchContext.operations.push(operation)
        return
      }

      const ctx = ensureContext()
      performWriteOperations(operation, ctx)
    },

    writeUpsert(data: Partial<TRow> | Array<Partial<TRow>>) {
      const operation: SyncOperation<TRow, TKey, TInsertInput> = {
        type: `upsert`,
        data,
      }

      if (activeBatchContext) {
        activeBatchContext.operations.push(operation)
        return
      }

      const ctx = ensureContext()
      performWriteOperations(operation, ctx)
    },

    writeBatch(callback: () => void) {
      const ctx = ensureContext()

      // Set up the batch context
      activeBatchContext = {
        operations: [],
        ctx,
      }

      try {
        // Execute the callback - any write operations will be collected
        callback()

        // Perform all collected operations
        if (activeBatchContext.operations.length > 0) {
          performWriteOperations(activeBatchContext.operations, ctx)
        }
      } finally {
        // Always clear the batch context
        activeBatchContext = null
      }
    },
  }
}
