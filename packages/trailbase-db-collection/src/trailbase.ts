/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Store } from '@tanstack/store'
import {
  ExpectedDeleteTypeError,
  ExpectedInsertTypeError,
  ExpectedUpdateTypeError,
  TimeoutWaitingForIdsError,
} from './errors'
import type { Event, RecordApi } from 'trailbase'

import type {
  BaseCollectionConfig,
  CollectionConfig,
  DeleteMutationFnParams,
  InsertMutationFnParams,
  SyncConfig,
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

/**
 * Configuration interface for Trailbase Collection
 */
export interface TrailBaseCollectionConfig<
  TItem extends ShapeOf<TRecord>,
  TRecord extends ShapeOf<TItem> = TItem,
  TKey extends string | number = string | number,
> extends Omit<
  BaseCollectionConfig<TItem, TKey>,
  `onInsert` | `onUpdate` | `onDelete`
> {
  /**
   * Record API name
   */
  recordApi: RecordApi<TRecord>

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
): CollectionConfig<TItem, TKey> & {
  utils: TrailBaseCollectionUtils
} {
  const getKey = config.getKey

  const parse = (record: TRecord) =>
    convert<TRecord, TItem>(config.parse, record)
  const serialUpd = (item: Partial<TItem>) =>
    convertPartial<TItem, TRecord>(config.serialize, item)
  const serialIns = (item: TItem) =>
    convert<TItem, TRecord>(config.serialize, item)

  const abortController = new AbortController()

  const seenIds = new Store(new Map<string, number>())

  const internalSyncMode = (config as any).syncMode ?? `eager`
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
      const onAbort = () => {
        clearTimeout(timeoutId)
        reject(new TimeoutWaitingForIdsError(`Aborted while waiting for ids`))
      }

      abortController.signal.addEventListener(`abort`, onAbort)

      const timeoutId = setTimeout(() => reject(new TimeoutWaitingForIdsError(ids.toString())), timeout)

      const unsubscribe = seenIds.subscribe((value) => {
        if (completed(value.currentVal)) {
          clearTimeout(timeoutId)
          abortController.signal.removeEventListener(`abort`, onAbort)
          unsubscribe()
          resolve()
        }
      })
    })
  }

  type SyncParams = Parameters<SyncConfig<TItem, TKey>[`sync`]>[0]
  const sync = {
    sync: (params: SyncParams) => {
      const { begin, write, commit, markReady } = params

      // Initial fetch.
      async function initialFetch() {
        const limit = 256
        let response = await config.recordApi.list({
          pagination: {
            limit,
          },
        })
        let cursor = response.cursor
        let got = 0

        begin()

        while (true) {
          const length = response.records.length
          if (length === 0) break

          got = got + length
          for (const item of response.records) {
            write({
              type: `insert`,
              value: parse(item),
            })
          }

          if (length < limit) break

          response = await config.recordApi.list({
            pagination: {
              limit,
              cursor,
              offset: cursor === undefined ? got : undefined,
            },
          })
          cursor = response.cursor
        }

        commit()
      }

      // Afterwards subscribe.
      async function listen(reader: ReadableStreamDefaultReader<Event>) {
        while (true) {
          const { done, value: event } = await reader.read()

          if (done || !event) {
            try {
              if ((reader as any).locked) {
                reader.releaseLock()
              }
            } catch {
              // ignore if already released
            }
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
        const reader = eventStream.getReader()

        // Start listening for subscriptions first. Otherwise, we'd risk a gap
        // between the initial fetch and starting to listen.
        listen(reader)

        try {
          // Eager mode: perform initial fetch to populate everything
          if (internalSyncMode === `eager`) {
            await initialFetch()
            fullSyncCompleted = true
          }
        } catch (e) {
          abortController.abort()
          throw e
        } finally {
          // Mark ready both if everything went well or if there's an error to
          // avoid blocking apps waiting for `.preload()` to finish.
          // In on-demand/progressive mode we mark ready immediately after listener starts
          // to allow queries to drive snapshots via `loadSubset`.
          markReady()
          // If progressive, start the background full sync after we've marked ready
          if (internalSyncMode === `progressive`) {
            // Defer background sync to avoid racing with preload assertions
            setTimeout(() => {
              void (async () => {
                try {
                  await initialFetch()
                  fullSyncCompleted = true
                } catch (e) {
                  console.error(`TrailBase progressive full sync failed`, e)
                }
              })()
            }, 0)
          }
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

        const onAbort = () => {
          clearInterval(periodicCleanupTask)
          // It's safe to call cancel and releaseLock even if the stream is already closed.
          reader.cancel().catch(() => { /* ignore */ })
          try {
            reader.releaseLock()
          } catch {
            /* ignore */
          }
        }

        abortController.signal.addEventListener(`abort`, onAbort)
        reader.closed.finally(() => {
          abortController.signal.removeEventListener(`abort`, onAbort)
          clearInterval(periodicCleanupTask)
        })
      }

      start()

      // Eager mode doesn't need subset loading
      if (internalSyncMode === `eager`) {
        return
      }

      const loadSubset = async (opts: { limit?: number } = {}) => {
        const limit = opts.limit ?? 256
        const response = await config.recordApi.list({ pagination: { limit } })
        const records = (response?.records ?? [])

        if (records.length > 0) {
          begin()
          for (const item of records) {
            write({ type: `insert`, value: parse(item) })
          }
          commit()
        }
      }
      
      return {
        loadSubset,
        getSyncMetadata: () => ({
          syncMode: internalSyncMode,
          fullSyncComplete: fullSyncCompleted,
        } as const),
      }
    },
    // Expose the getSyncMetadata function
    getSyncMetadata: () => ({
      syncMode: internalSyncMode,
      fullSyncComplete: fullSyncCompleted,
    } as const),
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
      cancel: () => abortController.abort(),
    },
  }
}
