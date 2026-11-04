/* eslint-disable @typescript-eslint/no-unnecessary-condition */
import { Store } from '@tanstack/store'
import {
  LoadSubsetOperationAbortedError,
  withCollectionConfigFactory,
} from '@tanstack/db'
import {
  ExpectedDeleteTypeError,
  ExpectedInsertTypeError,
  ExpectedUpdateTypeError,
  TimeoutWaitingForIdsError,
} from './errors'
import type { OrderByClause } from '../../db/dist/esm/query/ir'
import type {
  Client,
  CompareOp,
  CreateOperation,
  DeleteOperation,
  Event,
  FilterOrComposite,
  RecordApi,
  UpdateOperation,
} from 'trailbase'

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
  [
    K in keyof InputType as InputType[K] extends OutputType[K] ? K : never
  ]?: Conversion<InputType[K], OutputType[K]>
}

type RequiredConversions<
  InputType extends ShapeOf<OutputType>,
  OutputType extends ShapeOf<InputType>,
> = {
  // Excludes all keys that do not strictly require a conversation.
  [
    K in keyof InputType as InputType[K] extends OutputType[K] ? never : K
  ]: Conversion<InputType[K], OutputType[K]>
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
      // A removed field is an own `undefined`, which JSON would drop; it is
      // the column's `NULL`.
      if (value === undefined) return [k, null]
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
   * The TrailBase client the record API belongs to. Each transaction's
   * writes go through its `execute` as one TrailBase transaction, so they
   * commit together or not at all.
   */
  client: Client

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
  /**
   * Per-field conversions for values sent to TrailBase. An update that
   * removes a field sends `null`, which clears the column, without calling
   * that field's conversion.
   */
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
): CollectionConfig<TItem, TKey, never, TrailBaseCollectionUtils> & {
  utils: TrailBaseCollectionUtils
} {
  const getKey = config.getKey

  const parse = (record: TRecord) =>
    convert<TRecord, TItem>(config.parse, record)
  const serialUpd = (item: Partial<TItem>) =>
    convertPartial<TItem, TRecord>(config.serialize, item)
  const serialIns = (item: TItem) =>
    convert<TItem, TRecord>(config.serialize, item)

  // Change events per key, and this client's answered writes per key,
  // counted while a write is admitted or an answered write's event is still
  // to come. Each answered write on a key produces one event there, in
  // order, so a write is confirmed by the event its answer is numbered for,
  // not by an earlier write's late one (MUT-7).
  const seenIds = new Store(new Map<string, number>())
  const answeredIds = new Map<string, number>()
  let eventSequence = 0
  // Writes admitted and not yet settled.
  let writes = 0
  // The run whose listing has not committed yet; no write settles until it
  // has, since the listing confirms the writes it credits.
  let listing: object | undefined

  const internalSyncMode = config.syncMode ?? `eager`
  let fullSyncCompleted = false

  // Numbers an answered write on a key as soon as TrailBase answers it.
  const ticket = (id: string): readonly [string, number] => {
    const number = (answeredIds.get(id) ?? 0) + 1
    answeredIds.set(id, number)
    return [id, number]
  }

  const awaitIds = (
    tickets: Array<readonly [string, number]>,
    timeout: number = 120 * 1000,
  ): Promise<void> => {
    const completed = (value: Map<string, number>) =>
      !listing &&
      tickets.every(([id, ticket]) => (value.get(id) ?? 0) >= ticket)
    if (completed(seenIds.state)) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        sub.unsubscribe()
        reject(
          new TimeoutWaitingForIdsError(tickets.map(([id]) => id).toString()),
        )
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

  // Writes reach TrailBase in author order: a write starts at once when no
  // other is being sent, and otherwise after the earlier one's response
  // (MUT-10). It does not wait for the earlier one's change event. A write
  // returns a ticket per request TrailBase answered and settles once the
  // change stream carries each of them (MUT-7).
  let sending = 0
  let turn: Promise<unknown> = Promise.resolve()
  const inTurn = <T>(send: () => Promise<T>): Promise<T> => {
    const sent = (sending++ === 0 ? send() : turn.then(send)).finally(() => {
      sending--
    })
    turn = sent.catch(() => {})
    return sent
  }
  const persist = async (
    write: () => Promise<Array<readonly [string, number]>>,
  ) => {
    writes++
    try {
      await awaitIds(await inTurn(write))
    } finally {
      writes--
      forgetSeenIds()
    }
  }

  // The counts are kept while a write is admitted or an answered request's
  // event is still to come, and cleared once neither holds.
  const forgetSeenIds = () => {
    if (
      writes === 0 &&
      [...answeredIds].every(
        ([id, number]) => (seenIds.state.get(id) ?? 0) >= number,
      )
    ) {
      seenIds.setState(() => new Map())
      answeredIds.clear()
    }
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
      const { begin, write, commit, markReady, fail, collection } = params
      let cancelled = false
      const cleanup = () => {
        cancelled = true
        leaveTurn()
        creditListing()
        settleListener()
        cancelEventReader()
      }

      // TrailBase cursors are opaque. Cache a cursor by its last fetched key
      // for callers that supply an established lastKey on a later request.
      // CollectionSubscription does not derive lastKey from local snapshots,
      // so its ordered requests use the offset fallback.
      const cursors = new Map<string | number, string>()

      let listening = false
      // Orders change events against this run's list calls. Only loads in
      // flight compare against it, so it is kept only while one runs.
      const eventSequenceByKey = new Map<TKey, number>()
      let loadsInFlight = 0
      // Settles when the listener runs, cannot start (with the failure), or
      // the session cleans up, so a waiting load never depends on the order
      // of their continuations.
      let settleListener!: (failure?: { error: unknown }) => void
      const listenerSettled = new Promise<{ error: unknown } | undefined>(
        (resolve) => {
          settleListener = resolve
        },
      )

      // Wait for the listener, but let the caller's abort end the wait even
      // when the subscription never resolves.
      async function waitForListener(signal: AbortSignal | undefined) {
        if (!signal) return listenerSettled
        let onAbort!: () => void
        const aborted = new Promise<undefined>((resolve) => {
          onAbort = () => resolve(undefined)
          signal.addEventListener(`abort`, onAbort, { once: true })
        })
        try {
          return await Promise.race([listenerSettled, aborted])
        } finally {
          // The request signal can outlive this wait; do not keep its listener.
          signal.removeEventListener(`abort`, onAbort)
        }
      }

      // Load (more) data.
      // A caller that aborts sees `AbortError`. Pages a commit accepted still
      // apply, and the load waits until they are visible; cleanup is quiet.
      // `everyRow` marks the eager load, which lists every row.
      async function load(opts: LoadSubsetOptions, everyRow = false) {
        if (cancelled) return
        if (opts.signal?.aborted) throw new LoadSubsetOperationAbortedError()
        if (!listening) {
          const failure = await waitForListener(opts.signal)
          if (cancelled) return
          if (opts.signal?.aborted) throw new LoadSubsetOperationAbortedError()
          if (failure) throw failure.error
        }

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
        const listed = new Set<TKey>()

        loadsInFlight++
        try {
          while (true) {
            const limit = Math.min(remaining, 256)
            let response
            // A change event after this point is newer than the page.
            const listedAfter = eventSequence
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
              if (cancelled) return
              if (opts.signal?.aborted) break
              throw error
            }
            if (cancelled) return
            // Check the signal before commit to discard a stale page.
            if (opts.signal?.aborted) break

            const length = response.records.length
            if (length === 0) {
              // Drained - read everything.
              break
            }

            begin()

            for (let i = 0; i < Math.min(length, remaining); ++i) {
              const value = parse(response.records[i]!)
              const key = getKey(value)
              listed.add(key)
              // The listener already applied a newer change for this row.
              if ((eventSequenceByKey.get(key) ?? 0) > listedAfter) continue
              // A page row is a full row. An update creates a missing row and
              // replaces a held one, including one an accepted event queued.
              write({ type: `update`, value })
            }

            // An accepted page always applies.
            const applied = commit(opts.signal)
            if (applied !== true) {
              appliedPages.push(applied)
            }
            if (cancelled || opts.signal?.aborted) break

            remaining -= length

            // Drained or read enough.
            if (length < limit || remaining <= 0) {
              // Core subscriptions cannot send lastKey, so retaining their
              // cursors only grows this cache. Direct callers can use the key
              // from a completed page as their next opaque boundary.
              if (
                response.cursor &&
                (opts.subscription === undefined || lastKey !== undefined)
              ) {
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
          // A reload keeps the retired run's rows, and the pages update them.
          // The eager load lists every row, so a held row that it did not
          // list and that no change event touched is gone.
          // Only the gone keys are collected, since a write during the walk
          // would change the entries it reads.
          const gone: Array<TKey> = []
          if (everyRow)
            for (const [key] of collection._state.acceptedSyncedEntries())
              if (!listed.has(key) && !eventSequenceByKey.has(key))
                gone.push(key)
          if (gone.length > 0) {
            begin()
            for (const key of gone) write({ type: `delete`, key })
            const applied = commit()
            if (applied !== true) appliedPages.push(applied)
          }
          // Every page is committed; core may hold them behind a credited
          // write, so the credit cannot wait for them to apply.
          if (everyRow) creditListing()
        } finally {
          if (--loadsInFlight === 0) eventSequenceByKey.clear()
        }

        await Promise.all(appliedPages)
        // An accepted page applies, but a caller that aborted still sees
        // `AbortError`.
        if (opts.signal?.aborted) throw new LoadSubsetOperationAbortedError()
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
            // A page may already hold a newer value for this row, so an
            // insert is written as a full-row update; it creates a missing row.
            write({ type: `update`, value })
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
            const sequence = ++eventSequence
            if (loadsInFlight > 0)
              eventSequenceByKey.set(getKey(value), sequence)
            if (writes > 0 || answeredIds.size > 0) {
              const id = String(getKey(value))
              seenIds.setState((curr: Map<string, number>) =>
                new Map(curr).set(id, (curr.get(id) ?? 0) + 1),
              )
              forgetSeenIds()
            }
          }
        }
      }

      // The adapter does not resubscribe, so it stops when its stream ends;
      // the first end reports why, and core ignores a later fail() in the same
      // run. A later stream failure is only logged. These flags belong to this
      // sync run: a reload runs `sync` again while the Collection still shows
      // the previous run's status.
      let streamEnded = false
      function reportStreamEnd(error: unknown, closed = false) {
        if (cancelled) return
        if (streamEnded && !closed)
          console.error(`TrailBase subscription failed`, error)
        streamEnded = true
        fail(error)
      }

      // Each run subscribes in the write queue, once every write admitted
      // before it is answered: each of those committed before the stream
      // opened, so its event may be on the retired stream only, and the
      // eager listing carries it. The open stream credits their numbers,
      // and no write settles until the listing has committed (MUT-7).
      const run = {}
      let leaveTurn!: () => void
      const left = new Promise<void>((resolve) => (leaveTurn = resolve))
      const creditListing = () => {
        if (listing !== run) return
        listing = undefined
        seenIds.setState((curr: Map<string, number>) => new Map(curr))
      }

      async function start() {
        try {
          let opening: Promise<ReadableStream<Event>> | undefined
          // The turn ends when the stream opens or fails, or at cleanup, so a
          // stale subscription holds neither a replacement run nor a write.
          await inTurn(() => {
            if (cancelled) return left
            opening = config.recordApi.subscribe(`*`).then((stream) => {
              if (!cancelled) {
                listing = run
                seenIds.setState((curr: Map<string, number>) => {
                  const next = new Map(curr)
                  for (const [id, answered] of answeredIds)
                    next.set(id, Math.max(next.get(id) ?? 0, answered))
                  return next
                })
              }
              return stream
            })
            return Promise.race([opening.catch(() => {}), left])
          })
          if (!opening) return
          const eventStream = await opening
          if (cancelled) {
            await eventStream.cancel()
            return
          }
          const subscribedReader = eventStream.getReader()
          eventReader = subscribedReader

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
            .then(
              () =>
                reportStreamEnd(
                  new Error(`TrailBase change stream closed`),
                  true,
                ),
              (error: unknown) => reportStreamEnd(error),
            )
          listening = true
          settleListener()

          // Eager mode: perform initial fetch to populate everything
          if (internalSyncMode === `eager`) {
            // Load everything on initial load.
            await load({}, true)
            if (cancelled) return
            fullSyncCompleted = true
          } else {
            // On demand, no listing carries every row: the open stream
            // credits the answered writes.
            creditListing()
          }
          // After this run's fail(), markReady() does nothing.
          if (!cancelled) markReady()
        } catch (error) {
          // An abandoned startup must not cancel a replacement provider session's reader.
          if (cancelled) return
          settleListener({ error })
          cancelEventReader()
          reportStreamEnd(error, true)
          return
        }
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

  const execute = (
    operations: Array<CreateOperation | UpdateOperation | DeleteOperation>,
  ) => config.client.execute(operations, true)

  const {
    client: _client,
    recordApi: _recordApi,
    parse: _parse,
    serialize: _serialize,
    ...collectionConfig
  } = config

  const options = {
    ...collectionConfig,
    sync,
    getKey,
    // The optimistic mutation overlay is removed when a handler returns, so
    // each one waits until the subscription has applied what it wrote.
    // A transaction is one TrailBase transaction: its writes commit
    // together or not at all, and a rejection rejects it whole.
    onInsert: (params: InsertMutationFnParams<TItem, TKey>) =>
      persist(async () => {
        const ids = await execute(
          params.transaction.mutations.map(({ type, modified }) => {
            if (type !== `insert`) throw new ExpectedInsertTypeError(type)
            return config.recordApi.createOp(serialIns(modified))
          }),
        )
        return ids.map((id) => ticket(String(id)))
      }),
    onUpdate: (params: UpdateMutationFnParams<TItem, TKey>) =>
      persist(async () => {
        const { mutations } = params.transaction
        await execute(
          mutations.map(({ type, changes, key }) => {
            if (type !== `update`) throw new ExpectedUpdateTypeError(type)
            return config.recordApi.updateOp(key, serialUpd(changes))
          }),
        )
        return mutations.map(({ key }) => ticket(String(key)))
      }),
    onDelete: (params: DeleteMutationFnParams<TItem, TKey>) =>
      persist(async () => {
        const { mutations } = params.transaction
        await execute(
          mutations.map(({ type, key }) => {
            if (type !== `delete`) throw new ExpectedDeleteTypeError(type)
            return config.recordApi.deleteOp(key)
          }),
        )
        return mutations.map(({ key }) => ticket(String(key)))
      }),
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
