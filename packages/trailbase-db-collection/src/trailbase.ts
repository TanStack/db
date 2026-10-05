/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Store } from '@tanstack/store'
import { withCollectionConfigFactory } from '@tanstack/db'
import {
  ExpectedDeleteTypeError,
  ExpectedInsertTypeError,
  ExpectedUpdateTypeError,
  TimeoutWaitingForIdsError,
} from './errors'
import type { OrderByClause } from '../../db/dist/esm/query/ir'
import type { CompareOp, Event, FilterOrComposite, RecordApi } from 'trailbase'

import type {
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  SyncConfig,
  SyncMode,
  UpdateMutationFnParams,
  UtilsRecord,
} from '@tanstack/db'

/**
 * Symbol for internal test hooks - allows tests to control sync timing
 */
export const TRAILBASE_TEST_HOOKS = Symbol.for(`TRAILBASE_TEST_HOOKS`)

/**
 * Test hooks interface for controlling sync behavior in tests
 */
export interface TrailBaseTestHooks {
  /**
   * Called before marking the collection as ready in progressive mode.
   * Return a promise that resolves when the collection should be marked ready.
   * This allows tests to pause and inspect the collection state during initial sync.
   */
  beforeMarkingReady?: () => Promise<void>
}

type ShapeOf<T> = Record<keyof T, unknown>
type Conversion<I, O> = (value: I) => O

type OptionalConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = {
  // Excludes all keys that require a conversation.
  [K in keyof InputType as InputType[K] extends OutputType[K]
    ? K
    : never]?: Conversion<InputType[K], OutputType[K]>
}

type RequiredConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = {
  // Excludes all keys that do not strictly require a conversation.
  [K in keyof InputType as InputType[K] extends OutputType[K]
    ? never
    : K]: Conversion<InputType[K], OutputType[K]>
}

type Conversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = OptionalConversions<InputType, OutputType> &
  RequiredConversions<InputType, OutputType>

function convert<
  InputType extends ShapeOf<OutputType> & Record<string, unknown>,
  OutputType extends ShapeOf<InputType>,
>(
  conversions: Conversions<InputType, OutputType>,
  input: InputType,
): OutputType {
  const c = conversions as Record<string, Conversion<InputType, OutputType>>

  return Object.fromEntries(
    Object.keys(input).map((k: string) => {
      const value = input[k]
      return [k, c[k]?.(value as any) ?? value]
    }),
  ) as OutputType
}

function convertPartial<
  InputType extends ShapeOf<OutputType> & Record<string, unknown>,
  OutputType extends ShapeOf<InputType>,
>(
  conversions: Conversions<InputType, OutputType>,
  input: Partial<InputType>,
): Partial<OutputType> {
  const c = conversions as Record<string, Conversion<InputType, OutputType>>

  return Object.fromEntries(
    Object.keys(input).map((k: string) => {
      const value = input[k]
      return [k, c[k]?.(value as any) ?? value]
    }),
  ) as OutputType
}

/**
 * The mode of sync to use for the collection.
 * @default `eager`
 * @description
 * - `eager`:
 *   - syncs all data immediately on preload
 *   - collection will be marked as ready once the sync is complete
 *   - there is no incremental sync
 * - `on-demand`:
 *   - syncs data incrementally when the collection is queried
 *   - collection will be marked as ready immediately after the subscription starts
 * - `progressive`:
 *   - syncs all data for the collection in the background
 *   - uses loadSubset during the initial sync to provide a fast path to the data required for queries
 *   - collection will be marked as ready immediately, with full sync completing in background
 */
export type TrailBaseSyncMode = SyncMode | `progressive`

/**
 * Configuration interface for Trailbase Collection
 */
export interface TrailBaseCollectionConfig<
  TItem extends object,
  TRecord extends object = TItem,
  TKey extends string | number = string | number,
> extends Omit<
  BaseCollectionConfig<TItem, TKey>,
  `onInsert` | `onUpdate` | `onDelete` | `syncMode`
> {
  /**
   * Record API name
   */
  recordApi: RecordApi<TRecord>

  /**
   * The mode of sync to use for the collection.
   * @default `eager`
   */
  syncMode?: TrailBaseSyncMode

  /**
   * Function to parse a TrailBase record into the app item type.
   * Use this for full control over the transformation including key renaming.
   */
  parse:
    | ((record: TRecord) => TItem)
    | Conversions<TRecord & ShapeOf<TItem>, TItem & ShapeOf<TRecord>>

  /**
   * Function to serialize an app item into a TrailBase record.
   * Use this for full control over the transformation including key renaming.
   */
  serialize:
    | ((item: TItem) => TRecord)
    | Conversions<TItem & ShapeOf<TRecord>, TRecord & ShapeOf<TItem>>

  /**
   * Function to serialize a partial app item into a partial TrailBase record.
   * Used for updates. If not provided, serialize will be used.
   */
  serializePartial?: (item: Partial<TItem>) => Partial<TRecord>

  /**
   * Internal test hooks for controlling sync behavior.
   * This is intended for testing only and should not be used in production.
   */
  [TRAILBASE_TEST_HOOKS]?: TrailBaseTestHooks
}

export type AwaitTxIdFn = (txId: string, timeout?: number) => Promise<boolean>

export interface TrailBaseCollectionUtils extends UtilsRecord {
  cancel: () => void
}

export function trailBaseCollectionOptions<
  TItem extends object,
  TRecord extends object = TItem,
  TKey extends string | number = string | number,
>(
  config: TrailBaseCollectionConfig<TItem, TRecord, TKey>,
): CollectionConfig<TItem, TKey, never, TrailBaseCollectionUtils> & {
  utils: TrailBaseCollectionUtils
} {
  const getKey = config.getKey

  // Support both function and Conversions for parse
  const parse: (record: TRecord) => TItem =
    typeof config.parse === `function`
      ? config.parse
      : (record: TRecord) =>
          convert<TRecord & ShapeOf<TItem>, TItem & ShapeOf<TRecord>>(
            config.parse as Conversions<
              TRecord & ShapeOf<TItem>,
              TItem & ShapeOf<TRecord>
            >,
            record as TRecord & ShapeOf<TItem>,
          ) as TItem

  // Support both function and Conversions for serialize
  const serialIns: (item: TItem) => TRecord =
    typeof config.serialize === `function`
      ? config.serialize
      : (item: TItem) =>
          convert<TItem & ShapeOf<TRecord>, TRecord & ShapeOf<TItem>>(
            config.serialize as Conversions<
              TItem & ShapeOf<TRecord>,
              TRecord & ShapeOf<TItem>
            >,
            item as TItem & ShapeOf<TRecord>,
          ) as TRecord

  // For partial updates, use serializePartial if provided, otherwise fall back to a simple implementation
  const serialUpd: (item: Partial<TItem>) => Partial<TRecord> =
    config.serializePartial ??
    (typeof config.serialize === `function`
      ? (item: Partial<TItem>) => {
          // For function serializers, we need to handle partial items carefully
          // We serialize and then extract only the keys that were in the partial
          const keys = Object.keys(item) as Array<keyof TItem>
          const full = serialIns(item as TItem)
          const result: Partial<TRecord> = {}
          for (const key of keys) {
            // Map the key if there's a known mapping (simplified approach)
            const recordKey = key as unknown as keyof TRecord
            if (recordKey in full) {
              result[recordKey] = full[recordKey]
            }
          }
          return result
        }
      : (item: Partial<TItem>) =>
          convertPartial<TItem & ShapeOf<TRecord>, TRecord & ShapeOf<TItem>>(
            config.serialize as Conversions<
              TItem & ShapeOf<TRecord>,
              TRecord & ShapeOf<TItem>
            >,
            item as Partial<TItem & ShapeOf<TRecord>>,
          ) as Partial<TRecord>)

  const seenIds = new Store(new Map<string, number>())

  const internalSyncMode = config.syncMode ?? `eager`
  // For the collection config, progressive acts like on-demand (needs loadSubset)
  const finalSyncMode =
    internalSyncMode === `progressive` ? `on-demand` : internalSyncMode
  let fullSyncCompleted = false

  // Get test hooks if provided
  const testHooks = config[TRAILBASE_TEST_HOOKS]

  const awaitIds = (
    ids: Array<string>,
    timeout: number = 120 * 1000,
  ): Promise<void> => {
    const completed = (value: Map<string, number>) =>
      ids.every((id) => value.has(id))
    if (completed(seenIds.state)) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        sub.unsubscribe()
        reject(new TimeoutWaitingForIdsError(ids.toString()))
      }, timeout)

      const sub = seenIds.subscribe((value) => {
        if (completed(value)) {
          clearTimeout(timeoutId)
          sub.unsubscribe()
          resolve()
        }
      })
    })
  }

  let eventReader: ReadableStreamDefaultReader<Event> | undefined
  const cancelEventReader = () => {
    if (eventReader) {
      // An already-errored stream rejects cancellation too. Cleanup still
      // retires its reader; that rejection must not escape as detached work.
      void eventReader.cancel().catch(() => undefined)
      eventReader.releaseLock()
      eventReader = undefined
    }
  }

  type SyncParams = Parameters<SyncConfig<TItem, TKey>[`sync`]>[0]
  const sync = {
    sync: (params: SyncParams) => {
      const { begin, write, commit, markReady, markError, collection } = params
      let cancelled = false
      let periodicCleanupTask: ReturnType<typeof setInterval> | undefined

      const cleanup = () => {
        cancelled = true
        cancelEventReader()
        if (periodicCleanupTask !== undefined) {
          clearInterval(periodicCleanupTask)
          periodicCleanupTask = undefined
        }
      }

      // NOTE: We cache cursors from prior fetches. TanStack/db expects that
      // cursors can be derived from a key, which is not true for TB, since
      // cursors are encrypted. This is leaky and therefore not ideal.
      const cursors = new Map<string | number, string>()

      // Load (more) data.
      async function load(opts: LoadSubsetOptions) {
        if (cancelled || opts.signal?.aborted) return

        const lastKey = opts.cursor?.lastKey
        let cursor: string | undefined =
          lastKey !== undefined ? cursors.get(lastKey) : undefined
        let offset: number | undefined =
          cursor === undefined && (opts.offset ?? 0) > 0
            ? opts.offset
            : undefined

        const order: Array<string> | undefined = buildOrder(opts)
        const filters: Array<FilterOrComposite> | undefined = buildFilters(
          opts,
          config,
        )

        let remaining: number = opts.limit ?? Number.MAX_VALUE
        if (remaining <= 0) {
          return
        }
        const appliedPages: Array<Promise<void>> = []

        while (true) {
          const limit = Math.min(remaining, 256)
          let response
          try {
            response = await config.recordApi.list({
              pagination: {
                limit,
                offset,
                cursor,
              },
              order,
              filters,
            })
          } catch (error) {
            if (cancelled || opts.signal?.aborted) return
            throw error
          }
          if (cancelled || opts.signal?.aborted) return

          const length = response.records.length
          if (length === 0) {
            // Drained - read everything.
            break
          }

          begin()

          for (let i = 0; i < Math.min(length, remaining); ++i) {
            write({
              type: `insert`,
              value: parse(response.records[i]!),
            })
          }

          const applied = commit(opts.signal)
          if (applied !== true) {
            appliedPages.push(applied)
          }
          if (cancelled || opts.signal?.aborted) return

          remaining -= length

          // Drained or read enough.
          if (length < limit || remaining <= 0) {
            if (response.cursor) {
              cursors.set(
                getKey(parse(response.records.at(-1)!)),
                response.cursor,
              )
            }
            break
          }

          // Update params for next iteration.
          if (offset !== undefined) {
            offset += length
          } else {
            cursor = response.cursor
          }
        }

        await Promise.all(appliedPages)
      }

      // Afterwards subscribe.
      async function listen(reader: ReadableStreamDefaultReader<Event>) {
        while (true) {
          const { done, value: event } = await reader.read()

          if (done || !event) {
            return
          }

          begin()
          let value: TItem | undefined
          if (`Insert` in event) {
            value = parse(event.Insert as TRecord)
            write({ type: `insert`, value })
          } else if (`Delete` in event) {
            value = parse(event.Delete as TRecord)
            write({ type: `delete`, value })
          } else if (`Update` in event) {
            value = parse(event.Update as TRecord)
            write({ type: `update`, value })
          } else {
            console.error(`Error: ${event.Error}`)
          }
          void commit()

          if (value) {
            seenIds.setState((curr: Map<string, number>) => {
              const newIds = new Map(curr)
              newIds.set(String(getKey(value)), Date.now())
              return newIds
            })
          }
        }
      }

      async function start() {
        let reader: ReadableStreamDefaultReader<Event> | undefined
        try {
          const eventStream = await config.recordApi.subscribe(`*`)
          if (cancelled) {
            await eventStream.cancel()
            return
          }
          const subscribedReader = eventStream.getReader()
          reader = eventReader = subscribedReader

          // Start listening for subscriptions first. Otherwise, we'd risk a gap
          // between the initial fetch and starting to listen.
          void listen(subscribedReader)
            .finally(() => {
              // A closed stream can still have a final event being processed.
              // Release only after the listener has finished draining it.
              // A processing failure can leave the stream open; cancel it too.
              // Preserve the original failure if the stream already errored.
              // Error settlement must not wait for transport cleanup.
              void subscribedReader.cancel().catch(() => undefined)
              subscribedReader.releaseLock()
              if (eventReader === subscribedReader) eventReader = undefined
            })
            .catch((error: unknown) => {
              if (!cancelled && collection.status === `loading`) {
                markError(error)
              } else if (!cancelled) {
                console.error(`TrailBase subscription failed`, error)
              }
            })

          // Eager mode: perform initial fetch to populate everything
          if (internalSyncMode === `eager`) {
            // Load everything on initial load.
            await load({})
            if (cancelled) return
            fullSyncCompleted = true
          }
          // For progressive mode with test hooks, use non-blocking pattern
          if (
            internalSyncMode === `progressive` &&
            testHooks?.beforeMarkingReady
          ) {
            // DON'T start full sync yet - let loadSubset handle data fetching
            // Wait for the hook to resolve, THEN do full sync and mark ready
            testHooks.beforeMarkingReady().then(async () => {
              try {
                // Now do the full sync
                await load({})
                fullSyncCompleted = true
              } catch (e) {
                console.error(`TrailBase progressive full sync failed`, e)
              }
              markReady()
            })
          } else {
            // Mark ready immediately for eager/on-demand modes
            if (!cancelled && collection.status === `loading`) {
              markReady()
            }

            // If progressive without test hooks, start background sync
            if (internalSyncMode === `progressive`) {
              // Defer background sync to avoid racing with preload assertions
              setTimeout(() => {
                void (async () => {
                  try {
                    await load({})
                    fullSyncCompleted = true
                  } catch (e) {
                    console.error(`TrailBase progressive full sync failed`, e)
                  }
                })()
              }, 0)
            }
          }
        } catch (error) {
          // An abandoned startup must not cancel a replacement session's reader.
          if (cancelled) return
          cancelEventReader()
          if (collection.status === `loading`) {
            markError(error)
          }
          return
        }

        // Lastly, start a periodic cleanup task that will be removed when the
        // reader closes.
        if (cancelled || !reader) return

        periodicCleanupTask = setInterval(() => {
          seenIds.setState((curr) => {
            const now = Date.now()
            let anyExpired = false

            const notExpired = Array.from(curr.entries()).filter(([_, v]) => {
              const expired = now - v > 300 * 1000
              anyExpired = anyExpired || expired
              return !expired
            })

            if (anyExpired) {
              return new Map(notExpired)
            }
            return curr
          })
        }, 120 * 1000)

        const clearCleanupTask = () => {
          if (periodicCleanupTask !== undefined) {
            clearInterval(periodicCleanupTask)
            periodicCleanupTask = undefined
          }
        }
        // listen() reports read errors. Observe this separate promise too.
        void reader.closed.then(clearCleanupTask, clearCleanupTask)
      }

      void start()

      // Eager mode doesn't need subset loading
      if (internalSyncMode === `eager`) {
        return { cleanup }
      }

      return {
        cleanup,
        loadSubset: load,
        getSyncMetadata: () =>
          ({
            syncMode: internalSyncMode,
          }) as const,
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata: () =>
      ({
        syncMode: internalSyncMode,
        fullSyncComplete: fullSyncCompleted,
      }) as const,
  }

  const options = {
    ...config,
    syncMode: finalSyncMode,
    sync,
    getKey,
    onInsert: async (
      params: InsertMutationFnParams<TItem, TKey>,
    ): Promise<Array<number | string>> => {
      const ids = await config.recordApi.createBulk(
        params.transaction.mutations.map((tx) => {
          const { type, modified } = tx
          if (type !== `insert`) {
            throw new ExpectedInsertTypeError(type)
          }
          return serialIns(modified)
        }),
      )

      // The optimistic mutation overlay is removed on return, so at this point
      // we have to ensure that the new record was properly added to the local
      // DB by the subscription.
      await awaitIds(ids.map((id) => String(id)))

      return ids
    },
    onUpdate: async (params: UpdateMutationFnParams<TItem, TKey>) => {
      const ids: Array<string> = await Promise.all(
        params.transaction.mutations.map(async (tx) => {
          const { type, changes, key } = tx
          if (type !== `update`) {
            throw new ExpectedUpdateTypeError(type)
          }

          await config.recordApi.update(key, serialUpd(changes))

          return String(key)
        }),
      )

      // The optimistic mutation overlay is removed on return, so at this point
      // we have to ensure that the new record was properly updated in the local
      // DB by the subscription.
      await awaitIds(ids)
    },
    onDelete: async (params: DeleteMutationFnParams<TItem, TKey>) => {
      const ids: Array<string> = await Promise.all(
        params.transaction.mutations.map(async (tx) => {
          const { type, key } = tx
          if (type !== `delete`) {
            throw new ExpectedDeleteTypeError(type)
          }

          await config.recordApi.delete(key)
          return String(key)
        }),
      )

      // The optimistic mutation overlay is removed on return, so at this point
      // we have to ensure that the new record was properly updated in the local
      // DB by the subscription.
      await awaitIds(ids)
    },
    utils: {
      cancel: cancelEventReader,
    },
  }

  return withCollectionConfigFactory(
    options,
    () => trailBaseCollectionOptions(config) as typeof options,
  )
}

function buildOrder(opts: LoadSubsetOptions): undefined | Array<string> {
  return opts.orderBy
    ?.map((o: OrderByClause) => {
      switch (o.expression.type) {
        case 'ref': {
          const field = o.expression.path[0]
          if (o.compareOptions.direction == 'asc') {
            return `+${field}`
          }
          return `-${field}`
        }
        default: {
          console.warn(
            'Skipping unsupported order clause:',
            JSON.stringify(o.expression),
          )
          return undefined
        }
      }
    })
    .filter((f: string | undefined) => f !== undefined)
}

function buildCompareOp(name: string): CompareOp | undefined {
  switch (name) {
    case 'eq':
      return 'equal'
    case 'ne':
      return 'notEqual'
    case 'gt':
      return 'greaterThan'
    case 'gte':
      return 'greaterThanEqual'
    case 'lt':
      return 'lessThan'
    case 'lte':
      return 'lessThanEqual'
    default:
      return undefined
  }
}

function buildFilters<
  TItem extends object,
  TRecord extends object = TItem,
  TKey extends string | number = string | number,
>(
  opts: LoadSubsetOptions,
  config: TrailBaseCollectionConfig<TItem, TRecord, TKey>,
): undefined | Array<FilterOrComposite> {
  const where = opts.where
  if (where === undefined) {
    return undefined
  }

  function serializeValue<T = any>(column: string, value: T): string {
    const conv = (config.serialize as any)[column]
    if (conv) {
      return `${conv(value)}`
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }

    return `${value}`
  }

  switch (where.type) {
    case 'func': {
      const field = where.args[0]
      const val = where.args[1]

      const op = buildCompareOp(where.name)
      if (op === undefined) {
        break
      }

      if (field?.type === 'ref' && val?.type === 'val') {
        const column = field.path.at(0)
        if (column) {
          const f = [
            {
              column: field.path.at(0) ?? '',
              op,
              value: serializeValue(column, val.value),
            },
          ]

          return f
        }
      }
      break
    }
    case 'ref':
    case 'val':
      break
  }

  console.warn('where clause which is not (yet) supported', opts.where)

  return undefined
}
