import {
  withArrayChangeTracking,
  withChangeTracking,
  withFlatChangeTracking,
} from '../proxy'
import { safeRandomUUID } from '../utils/uuid'
import { createTransaction, getActiveTransaction } from '../transactions'
import {
  DeleteKeyNotFoundError,
  DuplicateKeyError,
  InvalidKeyError,
  InvalidSchemaError,
  KeyUpdateNotAllowedError,
  MissingDeleteHandlerError,
  MissingInsertHandlerError,
  MissingUpdateArgumentError,
  MissingUpdateHandlerError,
  NoKeysPassedToDeleteError,
  NoKeysPassedToUpdateError,
  SchemaMustBeSynchronousError,
  SchemaValidationError,
  UndefinedKeyError,
  UpdateKeyNotFoundError,
} from '../errors'
import type { Collection, CollectionImpl } from './index.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  CollectionConfig,
  InsertConfig,
  OperationConfig,
  OperationType,
  PendingMutation,
  StandardSchema,
  TransactionConfig,
  Transaction as TransactionType,
  TransactionWithMutations,
  UtilsRecord,
  WritableDeep,
} from '../types'
import type { TransactionScope } from '../transactions'
import type { CollectionLifecycleManager } from './lifecycle'
import type { CollectionStateManager } from './state'

// One random prefix per runtime keeps mutation ids unique across tabs and
// sessions; the counter avoids generating a random UUID per mutation. The
// prefix waits for the first mutation, because some runtimes reject random
// values at module scope.
let mutationIdPrefix: string | undefined
let mutationCount = 0
function createMutationId(): string {
  mutationIdPrefix ??= safeRandomUUID()
  return `${mutationIdPrefix}-${++mutationCount}`
}

export class CollectionMutationsManager<
  TOutput extends object = Record<string, unknown>,
  TKey extends string | number = string | number,
  TUtils extends UtilsRecord = {},
  TSchema extends StandardSchemaV1 = StandardSchemaV1,
  TInput extends object = TOutput,
> {
  private lifecycle!: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
  private state!: CollectionStateManager<TOutput, TKey, TSchema, TInput>
  private collection!: CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
  private config!: CollectionConfig<TOutput, TKey, TSchema, TUtils>
  private transactionScope?: TransactionScope
  private id: string

  constructor(
    config: CollectionConfig<TOutput, TKey, TSchema, TUtils>,
    id: string,
  ) {
    this.id = id
    this.config = config
  }

  setDeps(deps: {
    lifecycle: CollectionLifecycleManager<TOutput, TKey, TSchema, TInput>
    state: CollectionStateManager<TOutput, TKey, TSchema, TInput>
    collection: CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
  }) {
    this.lifecycle = deps.lifecycle
    this.state = deps.state
    this.collection = deps.collection
  }

  setTransactionScope(transactionScope: TransactionScope): void {
    this.transactionScope = transactionScope
  }

  private getActiveTransaction() {
    return this.transactionScope
      ? this.transactionScope.getActiveTransactionForCollection()
      : getActiveTransaction()
  }

  private createTransaction<T extends object>(config: TransactionConfig<T>) {
    return this.transactionScope
      ? this.transactionScope.createTransaction(config)
      : createTransaction(config)
  }

  private ensureStandardSchema(schema: unknown): StandardSchema<TOutput> {
    // If the schema already implements the standard-schema interface, return it
    if (schema && `~standard` in (schema as {})) {
      return schema as StandardSchema<TOutput>
    }

    throw new InvalidSchemaError()
  }

  public validateData(
    data: unknown,
    type: `insert` | `update`,
    key?: TKey,
  ): TOutput | never {
    if (!this.config.schema) return data as TOutput

    const standardSchema = this.ensureStandardSchema(this.config.schema)

    // For updates, we need to merge with the existing data before validation
    if (type === `update` && key) {
      // Get the existing data for this key
      const existingData = this.state.get(key)

      if (
        existingData &&
        data &&
        typeof data === `object` &&
        typeof existingData === `object`
      ) {
        // Merge the update with the existing data
        const mergedData = { ...existingData, ...data }

        // Validate the merged data
        const result = standardSchema[`~standard`].validate(mergedData)

        // Ensure validation is synchronous
        if (result instanceof Promise) {
          throw new SchemaMustBeSynchronousError()
        }

        // If validation fails, throw a SchemaValidationError with the issues
        if (`issues` in result && result.issues) {
          const typedIssues = result.issues.map((issue) => ({
            message: issue.message,
            path: issue.path?.map((p) => String(p)),
          }))
          throw new SchemaValidationError(type, typedIssues)
        }

        // Extract only the modified keys from the validated result
        const validatedMergedData = result.value as TOutput
        const modifiedKeys = Object.keys(data)
        const extractedChanges = Object.fromEntries(
          modifiedKeys.map((k) => [k, validatedMergedData[k as keyof TOutput]]),
        ) as TOutput

        return extractedChanges
      }
    }

    // For inserts or updates without existing data, validate the data directly
    const result = standardSchema[`~standard`].validate(data)

    // Ensure validation is synchronous
    if (result instanceof Promise) {
      throw new SchemaMustBeSynchronousError()
    }

    // If validation fails, throw a SchemaValidationError with the issues
    if (`issues` in result && result.issues) {
      const typedIssues = result.issues.map((issue) => ({
        message: issue.message,
        path: issue.path?.map((p) => String(p)),
      }))
      throw new SchemaValidationError(type, typedIssues)
    }

    return result.value as TOutput
  }

  public generateGlobalKey(key: any, item: any): string {
    if (typeof key !== `string` && typeof key !== `number`) {
      // Preserve specific error for undefined keys
      if (typeof key === `undefined`) {
        throw new UndefinedKeyError(item)
      }
      throw new InvalidKeyError(key, item)
    }

    return `KEY::${this.id}/${key}`
  }

  private markPendingLocalChanges(
    mutations: Array<PendingMutation<TOutput>>,
  ): void {
    for (const mutation of mutations) {
      // The handler can sync synchronously before its transaction is registered.
      // This is provisional; only completed mutations retain a local origin.
      this.state.pendingLocalChanges.add(mutation.key as TKey)
    }
  }

  /**
   * A local-only Collection confirms its own writes. Without a user handler
   * for this operation type, and with no other transaction unsettled, write
   * the mutations as synced rows and return a completed transaction instead
   * of publishing an optimistic overlay and confirming it a tick later.
   */
  private commitLocalOnlyDirect(
    mutations: Array<PendingMutation<TOutput>>,
    type: OperationType,
  ): TransactionType<TOutput> | undefined {
    const direct = this.state.localOnlyDirectWrite
    if (!direct?.types.has(type)) return undefined
    for (const transaction of this.state.transactions.values()) {
      // A persisting transaction holds sync commits, and a pending one
      // overlays them.
      if (
        transaction.state === `pending` ||
        transaction.state === `persisting`
      ) {
        return undefined
      }
    }
    const transaction = this.createTransaction<TOutput>({
      autoCommit: false,
      mutationFn: () => Promise.resolve(),
    })
    transaction.applyMutations(mutations)
    direct.write(mutations)
    transaction.setState(`completed`)
    transaction.isPersisted.resolve(transaction)
    return transaction
  }

  /**
   * Inserts one or more items into the collection
   */
  insert = (data: TInput | Array<TInput>, config?: InsertConfig) => {
    this.lifecycle.validateCollectionUsable(`insert`)
    const state = this.state
    const ambientTransaction = this.getActiveTransaction()

    // If no ambient transaction exists, check for an onInsert handler early
    if (!ambientTransaction && !this.config.onInsert) {
      throw new MissingInsertHandlerError()
    }

    const items = Array.isArray(data) ? data : [data]
    // One timestamp per call; mutations replace these rather than mutate them.
    const now = new Date()
    const mutations: Array<PendingMutation<TOutput>> = []
    const keysInCurrentBatch = new Set<TKey>()

    // Create mutations for each item
    items.forEach((item) => {
      // Validate the data against the schema if one exists
      const validatedData = this.validateData(item, `insert`)

      // Reject duplicate keys within this batch before starting sync.
      const key = this.config.getKey(validatedData)
      if (keysInCurrentBatch.has(key)) {
        throw new DuplicateKeyError(key)
      }
      keysInCurrentBatch.add(key)
      const globalKey = this.generateGlobalKey(key, item)

      const mutation: PendingMutation<TOutput, `insert`> = {
        mutationId: createMutationId(),
        original: {},
        modified: validatedData,
        // Pick the values from validatedData based on what's passed in - this is for cases
        // where a schema has default values. The validated data has the extra default
        // values but for changes, we just want to show the data that was actually passed in.
        changes: Object.fromEntries(
          Object.keys(item).map((k) => [
            k,
            validatedData[k as keyof typeof validatedData],
          ]),
        ) as TInput,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: this.config.sync.getSyncMetadata?.() || {},
        optimistic: config?.optimistic ?? true,
        type: `insert`,
        createdAt: now,
        updatedAt: now,
        collection: this.collection,
      }

      mutations.push(mutation)
    })

    // Reject duplicates already visible before explicitly starting sync; startup may
    // synchronously reveal additional keys, so check again afterward.
    let duplicate = mutations.find(({ key }) => state.has(key))
    if (duplicate) throw new DuplicateKeyError(duplicate.key)
    this.collection._sync.startSync()
    duplicate = mutations.find(({ key }) => state.has(key))
    if (duplicate) throw new DuplicateKeyError(duplicate.key)

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      state.transactions.set(ambientTransaction.id, ambientTransaction)
      state.scheduleTransactionCleanup(ambientTransaction)
      state.recomputeOptimisticState(true)

      return ambientTransaction
    } else {
      const localOnly = this.commitLocalOnlyDirect(mutations, `insert`)
      if (localOnly) return localOnly
      // Create a new transaction with a mutation function that calls the onInsert handler
      const directOpTransaction = this.createTransaction<TOutput>({
        mutationFn: async (params) => {
          // Call the onInsert handler with the transaction and collection
          return await this.config.onInsert!({
            transaction:
              params.transaction as unknown as TransactionWithMutations<
                TOutput,
                `insert`,
                Collection<TOutput, TKey, TUtils>
              >,
            collection: this.collection as unknown as Collection<
              TOutput,
              TKey,
              TUtils
            >,
          })
        },
      })

      // Apply mutations to the new transaction
      directOpTransaction.applyMutations(mutations)
      this.markPendingLocalChanges(mutations)
      // The Collection owns the request before its handler can write through
      // sync, so a confirmation written by the handler waits for settlement.
      state.transactions.set(directOpTransaction.id, directOpTransaction)
      state.scheduleTransactionCleanup(directOpTransaction)
      state.recomputeOptimisticState(true)
      // Errors still reject tx.isPersisted.promise; this catch only prevents global unhandled rejections
      directOpTransaction.commit().catch(() => undefined)

      return directOpTransaction
    }
  }

  /**
   * Updates one or more items in the collection using a callback function
   */
  update(
    keys: TKey | Array<TKey>,
    configOrCallback:
      | ((draft: WritableDeep<TInput>) => void)
      | ((drafts: Array<WritableDeep<TInput>>) => void)
      | OperationConfig,
    maybeCallback?:
      | ((draft: WritableDeep<TInput>) => void)
      | ((drafts: Array<WritableDeep<TInput>>) => void),
  ) {
    if (typeof keys === `undefined`) {
      throw new MissingUpdateArgumentError()
    }

    const state = this.state
    this.lifecycle.validateCollectionUsable(`update`)

    const ambientTransaction = this.getActiveTransaction()

    // If no ambient transaction exists, check for an onUpdate handler early
    if (!ambientTransaction && !this.config.onUpdate) {
      throw new MissingUpdateHandlerError()
    }

    const isArray = Array.isArray(keys)
    const keysArray = isArray ? keys : [keys]

    if (isArray && keysArray.length === 0) {
      throw new NoKeysPassedToUpdateError()
    }

    const callback =
      typeof configOrCallback === `function` ? configOrCallback : maybeCallback
    if (typeof callback !== `function`) throw new TypeError()
    const config =
      typeof configOrCallback === `function` ? {} : configOrCallback

    this.collection._sync.startSync()

    // Get the current objects or empty objects if they don't exist
    const currentObjects = keysArray.map((key) => {
      const item = this.state.get(key)
      if (!item) {
        throw new UpdateKeyNotFoundError(key)
      }

      return item
    }) as unknown as Array<TInput>

    // Flat rows need no proxy; nested rows track changes through drafts.
    const changesArray =
      withFlatChangeTracking(
        currentObjects,
        callback as (drafts: Array<TInput> | TInput) => void,
        isArray,
      ) ??
      (isArray
        ? withArrayChangeTracking(
            currentObjects,
            callback as (draft: Array<TInput>) => void,
          )
        : [
            withChangeTracking(
              currentObjects[0]!,
              callback as (draft: TInput) => void,
            ),
          ])

    // Create mutations for each object that has changes
    // One timestamp per call; mutations replace these rather than mutate them.
    const now = new Date()
    const mutations: Array<
      PendingMutation<
        TOutput,
        `update`,
        CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
      >
    > = keysArray
      .map((key, index) => {
        const itemChanges = changesArray[index] // A fresh object the tracker recorded for this item

        // Skip items with no changes
        if (!itemChanges || Object.keys(itemChanges).length === 0) {
          return null
        }

        const originalItem = currentObjects[index] as unknown as TOutput
        // Validate the user-provided changes for this item
        const validatedUpdatePayload = this.validateData(
          itemChanges,
          `update`,
          key,
        )

        // Construct the full modified item by applying the validated update payload to the original item
        const modifiedItem = { ...originalItem, ...validatedUpdatePayload }

        // Check if the ID of the item is being changed
        const originalItemId = this.config.getKey(originalItem)
        const modifiedItemId = this.config.getKey(modifiedItem)

        if (originalItemId !== modifiedItemId) {
          throw new KeyUpdateNotAllowedError(originalItemId, modifiedItemId)
        }

        const globalKey = this.generateGlobalKey(modifiedItemId, modifiedItem)

        return {
          mutationId: createMutationId(),
          original: originalItem,
          modified: modifiedItem,
          // Pick the values from modifiedItem based on what's passed in - this is for cases
          // where a schema has default values or transforms. The modified data has the extra
          // default or transformed values but for changes, we just want to show the data that
          // was actually passed in.
          // Without a schema, validation returns the tracker's fresh change
          // object, which already holds exactly these values.
          changes: (validatedUpdatePayload === itemChanges
            ? itemChanges
            : Object.fromEntries(
                Object.keys(itemChanges).map((k) => [
                  k,
                  modifiedItem[k as keyof typeof modifiedItem],
                ]),
              )) as TInput,
          globalKey,
          key,
          metadata: config.metadata as unknown,
          syncMetadata: (state.syncedMetadata.get(key) || {}) as Record<
            string,
            unknown
          >,
          optimistic: config.optimistic ?? true,
          type: `update`,
          createdAt: now,
          updatedAt: now,
          collection: this.collection,
        }
      })
      .filter(Boolean) as Array<
      PendingMutation<
        TOutput,
        `update`,
        CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
      >
    >

    // If no changes were made, return an empty transaction early
    if (mutations.length === 0) {
      const emptyTransaction = this.createTransaction({
        mutationFn: async () => {},
      })
      // Errors still propagate through tx.isPersisted.promise; suppress the background commit from warning
      emptyTransaction.commit().catch(() => undefined)
      // Schedule cleanup for empty transaction
      state.scheduleTransactionCleanup(emptyTransaction)
      return emptyTransaction
    }

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      state.transactions.set(ambientTransaction.id, ambientTransaction)
      state.scheduleTransactionCleanup(ambientTransaction)
      state.recomputeOptimisticState(true)

      return ambientTransaction
    }

    // No need to check for onUpdate handler here as we've already checked at the beginning

    const localOnly = this.commitLocalOnlyDirect(mutations, `update`)
    if (localOnly) return localOnly

    // Create a new transaction with a mutation function that calls the onUpdate handler
    const directOpTransaction = this.createTransaction<TOutput>({
      mutationFn: async (params) => {
        // Call the onUpdate handler with the transaction and collection
        return this.config.onUpdate!({
          transaction:
            params.transaction as unknown as TransactionWithMutations<
              TOutput,
              `update`,
              Collection<TOutput, TKey, TUtils>
            >,
          collection: this.collection as unknown as Collection<
            TOutput,
            TKey,
            TUtils
          >,
        })
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    this.markPendingLocalChanges(mutations)
    // Own the request before its handler runs; see insert.
    state.transactions.set(directOpTransaction.id, directOpTransaction)
    state.scheduleTransactionCleanup(directOpTransaction)
    state.recomputeOptimisticState(true)
    // Errors still hit tx.isPersisted.promise; avoid leaking an unhandled rejection from the fire-and-forget commit
    directOpTransaction.commit().catch(() => undefined)

    return directOpTransaction
  }

  /**
   * Deletes one or more items from the collection
   */
  delete = (
    keys: Array<TKey> | TKey,
    config?: OperationConfig,
  ): TransactionType<any> => {
    const state = this.state
    this.lifecycle.validateCollectionUsable(`delete`)

    const ambientTransaction = this.getActiveTransaction()

    // If no ambient transaction exists, check for an onDelete handler early
    if (!ambientTransaction && !this.config.onDelete) {
      throw new MissingDeleteHandlerError()
    }

    if (Array.isArray(keys) && keys.length === 0) {
      throw new NoKeysPassedToDeleteError()
    }

    const keysArray = Array.isArray(keys) ? keys : [keys]
    this.collection._sync.startSync()
    // One timestamp per call; mutations replace these rather than mutate them.
    const now = new Date()
    const mutations: Array<
      PendingMutation<
        TOutput,
        `delete`,
        CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
      >
    > = []

    for (const key of keysArray) {
      if (!this.state.has(key)) {
        throw new DeleteKeyNotFoundError(key)
      }
      const globalKey = this.generateGlobalKey(key, this.state.get(key)!)
      const mutation: PendingMutation<
        TOutput,
        `delete`,
        CollectionImpl<TOutput, TKey, TUtils, TSchema, TInput>
      > = {
        mutationId: createMutationId(),
        original: this.state.get(key)!,
        modified: this.state.get(key)!,
        changes: this.state.get(key)!,
        globalKey,
        key,
        metadata: config?.metadata as unknown,
        syncMetadata: (state.syncedMetadata.get(key) || {}) as Record<
          string,
          unknown
        >,
        optimistic: config?.optimistic ?? true,
        type: `delete`,
        createdAt: now,
        updatedAt: now,
        collection: this.collection,
      }

      mutations.push(mutation)
    }

    // If an ambient transaction exists, use it
    if (ambientTransaction) {
      ambientTransaction.applyMutations(mutations)

      state.transactions.set(ambientTransaction.id, ambientTransaction)
      state.scheduleTransactionCleanup(ambientTransaction)
      state.recomputeOptimisticState(true)

      return ambientTransaction
    }

    const localOnly = this.commitLocalOnlyDirect(mutations, `delete`)
    if (localOnly) return localOnly

    // Create a new transaction with a mutation function that calls the onDelete handler
    const directOpTransaction = this.createTransaction<TOutput>({
      autoCommit: true,
      mutationFn: async (params) => {
        // Call the onDelete handler with the transaction and collection
        return this.config.onDelete!({
          transaction:
            params.transaction as unknown as TransactionWithMutations<
              TOutput,
              `delete`,
              Collection<TOutput, TKey, TUtils>
            >,
          collection: this.collection as unknown as Collection<
            TOutput,
            TKey,
            TUtils
          >,
        })
      },
    })

    // Apply mutations to the new transaction
    directOpTransaction.applyMutations(mutations)
    this.markPendingLocalChanges(mutations)
    // Own the request before its handler runs; see insert.
    state.transactions.set(directOpTransaction.id, directOpTransaction)
    state.scheduleTransactionCleanup(directOpTransaction)
    state.recomputeOptimisticState(true)
    // Errors still reject tx.isPersisted.promise; silence the internal commit promise to prevent test noise
    directOpTransaction.commit().catch(() => undefined)

    return directOpTransaction
  }
}
