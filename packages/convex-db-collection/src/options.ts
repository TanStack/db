import {
  whenSyncAccepted,
  withCollectionConfigFactory,
  withCollectionSyncConfigFactory,
} from '@tanstack/db'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type {
  BaseCollectionConfig,
  CollectionConfig,
  SyncConfig,
  UtilsRecord,
} from '@tanstack/db'
import type { ConvexSubscription } from './subscription'

export interface ConvexCollectionUtils extends UtilsRecord {
  /** Last subscription or conversion error, cleared by the next valid result. */
  getSyncError: () => unknown
  /** Refresh the source cache and wait for sync acceptance, safe inside mutation handlers. */
  awaitSync: () => Promise<void>
}
export function createConvexOptions<
  TResult,
  TItem extends object,
  TKey extends string | number,
  TSchema extends StandardSchemaV1<TItem, TItem>,
>(
  config: Omit<
    BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils, unknown>,
    `syncMode` | `utils`
  > & {
    select?: (result: TResult) => ReadonlyArray<TItem>
    onError?: (error: unknown) => void
  },
  subscribe: (
    receive: (result: TResult) => void,
    fail: (error: unknown) => void,
  ) => ConvexSubscription<TResult>,
): CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & {
  utils: ConvexCollectionUtils
} & ([TSchema] extends [never] ? unknown : { schema: TSchema }) {
  const { select, onError, ...baseConfig } = config
  let syncError: unknown
  let readCurrent: (() => Promise<void>) | undefined

  const sync: SyncConfig<TItem, TKey> = {
    rowUpdateMode: `full`,
    sync: ({
      begin,
      write,
      commit,
      truncate,
      markReady,
      markError,
      collection,
    }) => {
      let active = true
      let previous = new Map<TKey, TItem>()
      let initialized = false
      let visible: true | Promise<void> = true
      let acceptanceFailure: { error: unknown } | undefined
      let resolveFirst!: () => void
      let rejectFirst!: (error: unknown) => void
      const firstResult = new Promise<void>((resolve, reject) => {
        resolveFirst = resolve
        rejectFirst = reject
      })
      // A subscription may fail before any caller asks to await its source.
      void firstResult.catch(() => {})
      const accepting = new Set<Promise<void>>()
      const fail = (error: unknown): void => {
        if (!active) return
        syncError = error
        rejectFirst(error)
        if (collection.status === `loading` || collection.status === `error`) {
          markError(error)
        }
        onError?.(error)
      }
      const accept = (result: TResult): void => {
        if (!active) return
        if (acceptanceFailure) throw acceptanceFailure.error
        // Validate the entire result before opening a sync transaction. A bad
        // snapshot must never leave a half-written transaction behind.
        const rows: unknown = select ? select(result) : result
        if (!Array.isArray(rows)) {
          throw new TypeError(
            `A Convex collection query must return an array, or supply select.`,
          )
        }
        const next = new Map<TKey, TItem>()
        for (const candidate of rows as Array<unknown>) {
          if (
            typeof candidate !== `object` ||
            candidate === null ||
            Array.isArray(candidate)
          ) {
            throw new TypeError(`Convex collection rows must be objects.`)
          }
          const row = candidate as TItem
          const key = config.getKey(row)
          if (
            (typeof key !== `string` && typeof key !== `number`) ||
            (typeof key === `number` && !Number.isFinite(key))
          ) {
            throw new TypeError(
              `Convex collection keys must be strings or finite numbers.`,
            )
          }
          if (next.has(key)) {
            throw new Error(`Duplicate Convex collection key: ${String(key)}`)
          }
          next.set(key, row)
        }
        if (
          initialized &&
          next.size === previous.size &&
          [...next].every(([key, row]) => previous.get(key) === row)
        ) {
          syncError = undefined
          if (visible === true) markReady()
          return
        }
        begin()
        // A restarted run replaces retained or hydrated data, including an
        // empty first result. Later results use keyed changes.
        if (!initialized) truncate()
        for (const [key, row] of next) {
          if (!previous.has(key) || !initialized) {
            write({ type: `insert`, value: row })
          } else if (previous.get(key) !== row) {
            write({ type: `update`, value: row })
          }
        }
        for (const key of previous.keys()) {
          if (!next.has(key)) write({ type: `delete`, key })
        }
        previous = next
        initialized = true
        syncError = undefined
        const receipt = commit()
        visible = receipt
        // Never await visibility from a mutation handler: DB may hold it until
        // that same optimistic transaction settles.
        const accepted = whenSyncAccepted(receipt)
        if (accepted !== true) {
          accepting.add(accepted)
          void accepted.then(
            () => accepting.delete(accepted),
            (error) => {
              accepting.delete(accepted)
              // Later diffs may depend on this rejected source proposal.
              // A new sync run must establish an authoritative base again.
              acceptanceFailure = { error }
              fail(error)
            },
          )
        }
        resolveFirst()
        if (receipt === true) markReady()
        else
          void receipt.then(() => {
            if (active) {
              visible = true
              markReady()
            }
          }, fail)
      }
      const receive = (result: TResult): void => {
        try {
          accept(result)
        } catch (error) {
          fail(error)
        }
      }
      let subscription: ConvexSubscription<TResult> | undefined
      const refresh = async (): Promise<void> => {
        if (acceptanceFailure) throw acceptanceFailure.error
        if (!active || !subscription) {
          if (syncError !== undefined) throw syncError
          throw new Error(`The Convex collection has no active subscription.`)
        }
        try {
          await subscription.waitForCurrent?.()
          // Cleanup can run while the asynchronous page acquisition waits.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
          if (!active)
            throw new Error(`Convex sync ended before source acceptance.`)
          const value = subscription.getCurrentValue()
          if (value !== undefined) accept(value)
        } catch (error) {
          fail(error)
          throw error
        }
        if (!initialized) await firstResult
        if (syncError !== undefined) throw syncError
        await Promise.all([...accepting])
      }
      readCurrent = refresh
      try {
        subscription = subscribe(receive, fail)
        const value = subscription.getCurrentValue()
        if (value !== undefined) receive(value)
      } catch (error) {
        fail(error)
      }
      return () => {
        active = false
        rejectFirst(new Error(`Convex sync ended before source acceptance.`))
        if (readCurrent === refresh) readCurrent = undefined
        subscription?.unsubscribe()
      }
    },
  }

  // Convex mutation promises resolve after the subscription has caught up.
  // Read the cache as well: a newly registered cached listener may still be
  // waiting for its scheduled initial callback when the mutation resolves.
  function wrapHandler<TParams>(
    handler: (params: TParams) => Promise<unknown>,
  ) {
    return async (params: TParams): Promise<void> => {
      await handler(params)
      await awaitSource()
    }
  }
  async function awaitSource(): Promise<void> {
    if (!readCurrent) {
      throw new Error(`The Convex collection has no active subscription.`)
    }
    await readCurrent()
  }
  const options: CollectionConfig<
    TItem,
    TKey,
    TSchema,
    ConvexCollectionUtils
  > & { utils: ConvexCollectionUtils } = {
    ...baseConfig,
    syncMode: `eager` as const,
    sync: withCollectionSyncConfigFactory(
      sync,
      (source, utils, startSyncIfIdle) => {
        ;(utils as ConvexCollectionUtils).awaitSync = async () => {
          startSyncIfIdle()
          await awaitSource()
        }
        return source
      },
    ),
    onInsert: config.onInsert && wrapHandler(config.onInsert),
    onUpdate: config.onUpdate && wrapHandler(config.onUpdate),
    onDelete: config.onDelete && wrapHandler(config.onDelete),
    utils: {
      getSyncError: () => syncError,
      awaitSync: awaitSource,
    },
  }
  let claimed = false
  return withCollectionConfigFactory(
    options,
    () => createConvexOptions(config, subscribe),
    () => {
      if (claimed) {
        throw new Error(
          `Convex options can create only one Collection. Create fresh options for each Collection.`,
        )
      }
      claimed = true
      return () => {
        claimed = false
      }
    },
  ) as CollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils> & {
    utils: ConvexCollectionUtils
  } & ([TSchema] extends [never] ? unknown : { schema: TSchema })
}
