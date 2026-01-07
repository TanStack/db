/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Store } from '@tanstack/store'
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

export type TrailBaseSyncMode = SyncMode

/**
 * Configuration interface for Trailbase Collection
 */
export interface TrailBaseCollectionConfig<
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
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

  parse: Conversions<TRecord, TItem>
  serialize: Conversions<TItem, TRecord>
}

export type AwaitTxIdFn = (txId: string, timeout?: number) => Promise<boolean>

export interface TrailBaseCollectionUtils extends UtilsRecord {
  cancel: () => void
}

export function trailBaseCollectionOptions<
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
  TKey extends string | number = string | number,
>(
  config: TrailBaseCollectionConfig<TItem, TRecord, TKey>,
): CollectionConfig<TItem, TKey> & { utils: TrailBaseCollectionUtils } {
  const getKey = config.getKey

  const parse = (record: TRecord) =>
    convert<TRecord, TItem>(config.parse, record)
  const serialUpd = (item: Partial<TItem>) =>
    convertPartial<TItem, TRecord>(config.serialize, item)
  const serialIns = (item: TItem) =>
    convert<TItem, TRecord>(config.serialize, item)

  const seenIds = new Store(new Map<string, number>())

  const internalSyncMode = config.syncMode ?? `eager`
  let fullSyncCompleted = false

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
        unsubscribe()
        reject(new TimeoutWaitingForIdsError(ids.toString()))
      }, timeout)

      const unsubscribe = seenIds.subscribe((value) => {
        if (completed(value.currentVal)) {
          clearTimeout(timeoutId)
          unsubscribe()
          resolve()
        }
      })
    })
  }

  let eventReader: ReadableStreamDefaultReader<Event> | undefined
  const cancelEventReader = () => {
    if (eventReader) {
      eventReader.cancel()
      eventReader.releaseLock()
      eventReader = undefined
    }
  }

  type SyncParams = Parameters<SyncConfig<TItem, TKey>[`sync`]>[0]
  const sync = {
    sync: (params: SyncParams) => {
      const { begin, write, commit, markReady } = params

      // NOTE: We cache cursors from prior fetches. TanStack/db expects that
      // cursors can be derived from a key, which is not true for TB, since
      // cursors are encrypted. This is leaky and therefore not ideal.
      const cursors = new Map<string | number, string>()

      // Load (more) data.
      async function load(opts: LoadSubsetOptions) {
        const lastKey = opts.cursor?.lastKey
        let cursor: string | undefined =
          lastKey !== undefined ? cursors.get(lastKey) : undefined
        let offset: number | undefined =
          (opts.offset ?? 0) > 0 ? opts.offset : undefined

        const order: Array<string> | undefined = buildOrder(opts)
        const filters: Array<FilterOrComposite> | undefined = buildFilters(
          opts,
          config,
        )

        let remaining: number = opts.limit ?? Number.MAX_VALUE
        if (remaining <= 0) {
          return
        }

        while (true) {
          const limit = Math.min(remaining, 256)
          const response = await config.recordApi.list({
            pagination: {
              limit,
              offset,
              cursor,
            },
            order,
            filters,
          })

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

          commit()

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
      }

      // Afterwards subscribe.
      async function listen(reader: ReadableStreamDefaultReader<Event>) {
        while (true) {
          const { done, value: event } = await reader.read()

          if (done || !event) {
            reader.releaseLock()
            eventReader = undefined
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
          commit()

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
        const eventStream = await config.recordApi.subscribe(`*`)
        const reader = (eventReader = eventStream.getReader())

        // Start listening for subscriptions first. Otherwise, we'd risk a gap
        // between the initial fetch and starting to listen.
        listen(reader)

        try {
          // Eager mode: perform initial fetch to populate everything
          if (internalSyncMode === `eager`) {
            // Load everything on initial load.
            await load({})
            fullSyncCompleted = true
          }
        } catch (e) {
          cancelEventReader()
          throw e
        } finally {
          // Mark ready both if everything went well or if there's an error to
          // avoid blocking apps waiting for `.preload()` to finish.
          markReady()
        }

        // Lastly, start a periodic cleanup task that will be removed when the
        // reader closes.
        const periodicCleanupTask = setInterval(() => {
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

        reader.closed.finally(() => clearInterval(periodicCleanupTask))
      }

      start()

      // Eager mode doesn't need subset loading
      if (internalSyncMode === `eager`) {
        return
      }

      return {
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

  return {
    ...config,
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
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
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
    const convert = (config.serialize as any)[column]
    if (convert) {
      return `${convert(value)}`
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
