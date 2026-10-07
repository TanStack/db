import {
  DuplicateKeySyncError,
  SyncTransactionAbortedError,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  DeleteOperationItemNotFoundError,
  DuplicateKeyInBatchError,
  SyncNotInitializedError,
  UpdateOperationItemNotFoundError,
} from './errors'
import type { QueryClient } from '@tanstack/query-core'
import type {
  ChangeMessage,
  Collection,
  SyncAppliedReceipt,
} from '@tanstack/db'

// Track active batch operations per context to prevent cross-collection contamination
const activeBatchContexts = new WeakMap<
  SyncContext<any, any>,
  {
    operations: Array<SyncOperation<any, any, any>>
    completion: Promise<void>
  }
>()
const writeCompletionPromises = new WeakSet<object>()

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
  commit: () => SyncAppliedReceipt
  /**
   * Optional function to update the query cache with the latest synced data.
   * Handles both direct array caches and wrapped response formats (when `select` is used).
   * If not provided, falls back to directly setting the cache with the raw array.
   */
  updateCacheData?: (getItems: () => Array<TRow>) => void
  /**
   * Gives a direct write its position when it is called. A fetch that starts
   * later counts as newer than the write.
   */
  reserveDirectWrite?: () => number
  /**
   * Gives an accepted write's keys precedence from its reserved position.
   * A rejected write never calls this.
   */
  claimDirectWriteKeys?: (keys: Array<TKey>, position: number) => void
  /** Records a write that waits for earlier commits until it settles. */
  noteWaitingDirectWrite?: (waiting: Promise<void>) => void
  /** Settles once every earlier commit is accepted, or undefined if it is. */
  earlierCommits?: () => Promise<void> | undefined
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
  ctx: SyncContext<TRow, TKey>,
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
            op.type === `upsert` ? `insert` : op.type,
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
  ctx: SyncContext<TRow, TKey>,
): void {
  const seenKeys = new Set<TKey>()

  for (const op of operations) {
    // Check for duplicate keys within the batch
    if (seenKeys.has(op.key)) {
      throw new DuplicateKeyInBatchError(op.key)
    }
    seenKeys.add(op.key)

    // Validate operation-specific requirements
    // Validate against accepted synced rows, not the optimistic view, so a
    // write works while its row is optimistically modified or queued.
    if (op.type === `insert`) {
      // Persistence stores a sync insert as an update, so check here.
      if (ctx.collection._state.getAcceptedSyncedRow(op.key)) {
        throw new DuplicateKeySyncError(op.key, ctx.collection.id)
      }
    } else if (op.type === `update`) {
      if (!ctx.collection._state.getAcceptedSyncedRow(op.key)) {
        throw new UpdateOperationItemNotFoundError(op.key)
      }
    } else if (op.type === `delete`) {
      if (!ctx.collection._state.getAcceptedSyncedRow(op.key)) {
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
  ctx: SyncContext<TRow, TKey>,
  isCurrent: () => boolean,
): Promise<void> {
  let normalized: Array<NormalizedOperation<TRow, TKey>>
  try {
    normalized = normalizeOperations(operations, ctx)
  } catch (error) {
    return Promise.reject(error)
  }
  const position = ctx.reserveDirectWrite?.() ?? 0
  // Validate against, and apply on top of, every earlier commit. A commit
  // can wait for a persistence lock before it is accepted, so the write waits
  // too. A validation error rejects the returned promise.
  const earlier = ctx.earlierCommits?.()
  if (!earlier) {
    try {
      return applyWriteOperations(normalized, ctx, position)
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const written = earlier.then(() => {
    // Cleanup retired this sync run while the write waited.
    if (!isCurrent()) throw new SyncTransactionAbortedError()
    return applyWriteOperations(normalized, ctx, position)
  })
  ctx.noteWaitingDirectWrite?.(
    written.then(
      () => undefined,
      () => undefined,
    ),
  )
  return written
}

function applyWriteOperations<
  TRow extends object,
  TKey extends string | number = string | number,
>(
  normalized: Array<NormalizedOperation<TRow, TKey>>,
  ctx: SyncContext<TRow, TKey>,
  position: number,
): Promise<void> {
  validateOperations(normalized, ctx)
  ctx.claimDirectWriteKeys?.(
    normalized.map((op) => op.key),
    position,
  )

  // While an optimistic transaction persists, this sync transaction waits
  // and applies when that transaction settles.
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
        const currentItem = ctx.collection._state.getAcceptedSyncedRow(op.key)!
        const updatedItem = {
          ...currentItem,
          ...op.data,
        }
        const resolved = ctx.collection.validateData(
          updatedItem,
          `update`,
          op.key,
        )
        ctx.write({
          type: `update`,
          value: resolved,
        })
        break
      }
      case `delete`: {
        const currentItem = ctx.collection._state.getAcceptedSyncedRow(op.key)!
        ctx.write({
          type: `delete`,
          value: currentItem,
        })
        break
      }
      case `upsert`: {
        const existsInSyncedStore =
          ctx.collection._state.getAcceptedSyncedRow(op.key) !== undefined
        const resolved = ctx.collection.validateData(
          op.data,
          existsInSyncedStore ? `update` : `insert`,
          op.key,
        )
        if (existsInSyncedStore) {
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

  const applied = ctx.commit()

  // A handler awaits this write, so it resolves once the transaction is
  // accepted, including any durable step; while the handler's own mutation
  // persists, the rows become visible when that mutation settles. The Query
  // cache holds accepted rows.
  const accepted = whenSyncAccepted(applied)
  const updateCache = () => {
    const getItems = () =>
      Array.from(
        ctx.collection._state.acceptedSyncedEntries(),
        ([, row]) => row,
      )
    if (ctx.updateCacheData) ctx.updateCacheData(getItems)
    else ctx.queryClient.setQueryData(ctx.queryKey, getItems())
  }
  if (accepted === true) updateCache()
  const completion = Promise.resolve(accepted).then(() => {
    if (accepted !== true) updateCache()
  })
  void completion.catch(() => undefined)
  return completion
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

  function write(operation: SyncOperation<TRow, TKey, TInsertInput>) {
    const ctx = ensureContext()
    const batchContext = activeBatchContexts.get(ctx)
    if (batchContext) {
      batchContext.operations.push(operation)
      return batchContext.completion
    }
    const completion = performWriteOperations(
      operation,
      ctx,
      () => getContext() === ctx,
    )
    writeCompletionPromises.add(completion)
    return completion
  }

  return {
    writeInsert(data: TInsertInput | Array<TInsertInput>) {
      return write({ type: `insert`, data })
    },

    writeUpdate(data: Partial<TRow> | Array<Partial<TRow>>) {
      return write({ type: `update`, data })
    },

    writeDelete(key: TKey | Array<TKey>) {
      return write({ type: `delete`, key })
    },

    writeUpsert(data: Partial<TRow> | Array<Partial<TRow>>) {
      return write({ type: `upsert`, data })
    },

    writeBatch(callback: () => void) {
      const ctx = ensureContext()

      // Check if we're already in a batch (nested batch)
      const existingBatch = activeBatchContexts.get(ctx)
      if (existingBatch) {
        throw new Error(
          `Cannot nest writeBatch calls. Complete the current batch before starting a new one.`,
        )
      }

      let resolveBatch!: (completion: Promise<void>) => void
      let rejectBatch!: (reason: unknown) => void
      const completion = new Promise<void>((resolve, reject) => {
        resolveBatch = resolve
        rejectBatch = reject
      })
      writeCompletionPromises.add(completion)
      void completion.catch(() => undefined)

      // Set up the batch context for this specific collection
      const batchContext = {
        operations: [] as Array<SyncOperation<TRow, TKey, TInsertInput>>,
        completion,
      }
      activeBatchContexts.set(ctx, batchContext)

      try {
        // Execute the callback - any write operations will be collected
        const result: unknown = callback()

        // A direct write in another collection may be returned incidentally.
        if (
          result !== null &&
          typeof result === `object` &&
          `then` in result &&
          typeof result.then === `function` &&
          !writeCompletionPromises.has(result)
        ) {
          // Rejecting the batch can also reject an async callback awaiting it.
          void Promise.resolve(result).catch(() => undefined)
          throw new Error(
            `writeBatch does not support async callbacks. The callback must be synchronous.`,
          )
        }

        // A subscriber called during commit starts a separate write or batch.
        activeBatchContexts.delete(ctx)

        // Perform all collected operations
        resolveBatch(
          batchContext.operations.length > 0
            ? performWriteOperations(
                batchContext.operations,
                ctx,
                () => getContext() === ctx,
              )
            : Promise.resolve(),
        )
        return completion
      } catch (error) {
        rejectBatch(error)
        throw error
      } finally {
        if (activeBatchContexts.get(ctx) === batchContext) {
          activeBatchContexts.delete(ctx)
        }
      }
    },
  }
}
