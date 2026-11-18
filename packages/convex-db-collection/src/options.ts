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
    BaseCollectionConfig<TItem, TKey, TSchema, ConvexCollectionUtils>,
    `utils`
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
  const { select, onError, syncMode = `eager`, ...baseConfig } = config
  let syncError: unknown
  let readCurrent: (() => Promise<void>) | undefined

  const sync: SyncConfig<TItem, TKey> = {
    rowUpdateMode: `full`,
    sync: ({
      collection,
      begin,
      write,
      commit,
      truncate,
      markReady,
      fail: failSync,
      reportError,
      reportHealthy,
    }) => {
      let active = true
      let ready = false
      const markValidReady = (): void => {
        if (!active || stopped) return
        if (!ready) {
          ready = true
          markReady()
        }
      }
      let previous = new Map<TKey, TItem>()
      let initialized = false
      let visible: true | Promise<void> = true
      let stopped: { error: unknown } | undefined
      let resolveFirst!: () => void
      let rejectFirst!: (error: unknown) => void
      const firstResult = new Promise<void>((resolve, reject) => {
        resolveFirst = resolve
        rejectFirst = reject
      })
      // A subscription may fail before any caller asks to await its source.
      void firstResult.catch(() => {})
      const accepting = new Set<Promise<void>>()
      // A wrapping sync may defer whole proposals before core accepts them.
      // Keep their ordered keyed effects, including deletes, until handoff.
      const proposals = new Set<Map<TKey, TItem | undefined>>()
      const fail = (error: unknown, terminal = false): void => {
        if (!active || stopped) return
        syncError = error
        rejectFirst(error)
        if (!ready || terminal) {
          stopped = { error }
          failSync(error)
          // LIFE-10: the stopped run releases its subscription at once.
          release()
        } else reportError(error)
        onError?.(error)
      }
      const accept = (result: TResult): void => {
        if (!active) return
        if (stopped) throw stopped.error
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
        const baseline =
          syncMode === `on-demand`
            ? new Map(collection._state.acceptedSyncedEntries())
            : previous
        if (syncMode === `on-demand`)
          for (const proposal of proposals)
            for (const [key, row] of proposal)
              if (row === undefined) baseline.delete(key)
              else baseline.set(key, row)
        const changes = new Map<TKey, TItem | undefined>()
        for (const [key, row] of next)
          if (!initialized || !previous.has(key) || baseline.get(key) !== row)
            changes.set(key, row)
        for (const [key, row] of baseline)
          if (
            !next.has(key) &&
            (syncMode !== `on-demand` ||
              previous.has(key) ||
              subscription?.isCurrentRowInScope?.(row))
          )
            changes.set(key, undefined)
        if (initialized && changes.size === 0) {
          previous = next
          syncError = undefined
          if (ready) reportHealthy()
          if (visible === true) markValidReady()
          return
        }
        begin()
        const replace = !initialized && syncMode !== `on-demand`
        if (replace) truncate()
        for (const [key, row] of changes) {
          if (row === undefined) write({ type: `delete`, key })
          else
            write({
              type: replace || !baseline.has(key) ? `insert` : `update`,
              value: row,
            })
        }
        previous = next
        initialized = true
        syncError = undefined
        if (ready) reportHealthy()
        // Register before commit: publishing can reenter with a newer result.
        if (syncMode === `on-demand`) proposals.add(changes)
        let receipt: ReturnType<typeof commit>
        try {
          receipt = commit()
        } catch (error) {
          proposals.delete(changes)
          throw error
        }
        visible = receipt
        // Never await visibility from a mutation handler: DB may hold it until
        // that same optimistic transaction settles.
        const accepted = whenSyncAccepted(receipt)
        if (accepted === true) proposals.delete(changes)
        else {
          accepting.add(accepted)
          void accepted.then(
            () => {
              proposals.delete(changes)
              accepting.delete(accepted)
            },
            (error) => {
              proposals.delete(changes)
              accepting.delete(accepted)
              // Later diffs may depend on this rejected source proposal.
              // A new sync run must establish an authoritative base again.
              fail(error, true)
            },
          )
        }
        resolveFirst()
        if (receipt === true) markValidReady()
        else
          void receipt.then(() => {
            if (active && visible === receipt) {
              visible = true
              markValidReady()
            }
          }, fail)
      }
      // The latest result the source delivered, accepted or rejected.
      let received: TResult | undefined
      const receive = (result: TResult): void => {
        received = result
        try {
          accept(result)
        } catch (error) {
          fail(error)
        }
      }
      let subscription: ConvexSubscription<TResult> | undefined
      let released = false
      const release = (): void => {
        if (released || !subscription) return
        released = true
        subscription.unsubscribe()
      }
      const refresh = async (): Promise<void> => {
        if (stopped) throw stopped.error
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
          let value: TResult | undefined
          try {
            value = subscription.getCurrentValue()
          } catch (error) {
            // The latest result is a failure already reported: the client
            // builds a new error on each read, so reject with the reported
            // one rather than report it again (EVID-1, HEALTH-2).
            if (syncError !== undefined) throw syncError
            throw error
          }
          // A result already received is not delivered again: a rejected one
          // keeps its reported failure.
          if (value !== undefined && value !== received) {
            received = value
            accept(value)
          }
        } catch (error) {
          if (error !== syncError) fail(error)
          throw error
        }
        if (!initialized) await firstResult
        if (syncError !== undefined) throw syncError
        await Promise.all([...accepting])
      }
      readCurrent = refresh
      try {
        subscription = subscribe(receive, fail)
        // A failure during subscription comes before it can be released.
        if (stopped) release()
        // A lazy run is ready before demand, but has no authoritative result
        // yet. Keep restored rows until actual provider evidence supersedes them.
        if (syncMode === `on-demand`) {
          markValidReady()
          resolveFirst()
        }
        const value = subscription.getCurrentValue()
        if (value !== undefined) receive(value)
      } catch (error) {
        fail(error)
      }
      const loadSubset = subscription?.loadSubset
      return {
        ...(loadSubset
          ? {
              loadSubset: async (request) => {
                let failure: { error: unknown } | undefined
                try {
                  await loadSubset(request)
                } catch (error) {
                  failure = { error }
                }
                // The pager publishes coherent batches. Its latest establishing
                // receipt follows every earlier accepted batch in core's FIFO.
                // Cancellation after acceptance cannot withdraw those writes.
                if (visible !== true) await visible
                if (failure) throw failure.error
                if (!active || request.signal?.aborted) {
                  const error = new Error(`Convex subset was canceled.`)
                  error.name = `AbortError`
                  throw error
                }
                if (syncError !== undefined) throw syncError
              },
              unloadSubset: subscription?.unloadSubset,
            }
          : {}),
        cleanup: () => {
          active = false
          rejectFirst(new Error(`Convex sync ended before source acceptance.`))
          if (readCurrent === refresh) readCurrent = undefined
          release()
        },
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
    syncMode,
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
