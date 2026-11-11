import { REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js'
import {
  DeleteOperationItemNotFoundError,
  UpdateOperationItemNotFoundError,
} from '@tanstack/query-db-collection'
import { realtimeFiltersToSearch } from './postgrest-filters'
import { parseRow } from './row-conversions'
import type { ColumnConversions } from './row-conversions'
import type {
  RealtimePostgresChangesFilter,
  RealtimePostgresDeletePayload,
  RealtimePostgresUpdatePayload,
  SupabaseClient,
} from '@supabase/supabase-js'
import type { Collection } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'

type ChangeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export type RealtimeSubscription = {
  channel: ReturnType<SupabaseClient['channel']>
  /**
   * Resolves with the terminal subscribe status — `SUBSCRIBED`,
   * `CHANNEL_ERROR`, or `CLOSED`. It is not time-bounded: while realtime-js is
   * still retrying the join (e.g. `TIMED_OUT`) it stays pending. Callers
   * distinguish a filter rejection (`CHANNEL_ERROR` on a filtered subscription)
   * from a transient connection error, so a dropped connection is not mistaken
   * for a server rejection.
   */
  outcome: Promise<REALTIME_SUBSCRIBE_STATES>
}

/**
 * Whether a row is in the collection's synced store.
 *
 * `collection.has()` reflects the optimistic view, which includes local
 * mutations that are still in flight. The manual sync writes here (and the
 * delete guard in {@link ./functions}) validate against the synced store only,
 * so that is the store to check: a Realtime echo of a pending local insert must
 * not be treated as an update, and a row with a pending local delete is still
 * there to be updated or deleted.
 */
export const isSynced = <T extends object, TKey extends string | number>(
  collection: Collection<T, TKey>,
  key: TKey,
): boolean => collection._state.syncedData.has(key)

/**
 * Direct writes are applied asynchronously, so the row can be removed — e.g. by
 * the local delete handler confirming the same delete — between the
 * {@link isSynced} check and the write landing. The row is gone either way.
 */
const ignoreRemovedRow = (error: unknown) => {
  if (
    error instanceof UpdateOperationItemNotFoundError ||
    error instanceof DeleteOperationItemNotFoundError
  ) {
    return
  }
  throw error
}

/**
 * Subscribes to Supabase Realtime changes for a table and writes inserts,
 * updates, and deletes into the collection.
 *
 * Filters are applied to INSERT and UPDATE listeners only: a filtered event is
 * Realtime telling us the row matches an active query, which is what makes it
 * belong in the collection — including a row that an UPDATE moved into that
 * query's window. Two extra unfiltered listeners cover what a filtered
 * subscription cannot see:
 *
 * - UPDATE, so a row already in the collection still receives its changes after
 *   it stops matching the filter instead of going stale.
 * - DELETE, because Realtime only delivers filtered delete events for tables
 *   with `replica identity full`, and delete payloads are just the key anyway.
 *
 * `filters` is the {@link ./postgrest-filters!realtimeFiltersToSearch} result:
 * one `filter` entry per active query, each a comma-joined Realtime condition
 * list. No entries means a catch-all subscription to every change on the table.
 */
export const attachSupabaseListeners = <
  T extends Record<string, any>,
  TKey extends string | number,
>(
  supabase: SupabaseClient,
  topic: string,
  tableName: string,
  collection: Collection<T, TKey>,
  filters: URLSearchParams = new URLSearchParams(),
  conversions: ColumnConversions = {},
): RealtimeSubscription => {
  const channel = supabase.channel(topic)

  const changesFilter = <TEvent extends ChangeEvent>(
    event: TEvent,
    filter?: string,
  ): RealtimePostgresChangesFilter<TEvent> => {
    const config: RealtimePostgresChangesFilter<TEvent> = {
      event,
      schema: 'public',
      table: tableName,
    }
    if (filter) {
      config.filter = filter
    }
    return config
  }

  // The row matches an active query's filter, so it belongs in the collection
  // whether or not we have seen it before. Upsert decides insert-vs-update on
  // the synced store, which also makes replayed or racing events harmless.
  const handleUpsert = (payload: { new: T }) => {
    collection.utils.writeUpsert(parseRow<T>(payload.new, conversions))
  }

  // Unfiltered updates arrive for every row in the table, so only rows the
  // collection already holds are written — otherwise it would mirror the whole
  // table locally.
  const handleKnownUpdate = (payload: RealtimePostgresUpdatePayload<T>) => {
    const row = parseRow<T>(payload.new, conversions)
    if (isSynced(collection, collection.getKeyFromItem(row))) {
      collection.utils.writeUpdate(row).catch(ignoreRemovedRow)
    }
  }

  const handleDelete = (payload: RealtimePostgresDeletePayload<T>) => {
    const id = collection.getKeyFromItem(parseRow<T>(payload.old, conversions))
    if (isSynced(collection, id)) {
      collection.utils.writeDelete(id).catch(ignoreRemovedRow)
    }
  }

  const conditions = filters.getAll('filter')
  // A catch-all subscription registers one unfiltered INSERT/UPDATE pair.
  for (const filter of conditions.length > 0 ? conditions : [undefined]) {
    channel.on<T>(
      'postgres_changes',
      changesFilter('INSERT', filter),
      handleUpsert,
    )
    channel.on<T>(
      'postgres_changes',
      changesFilter('UPDATE', filter),
      handleUpsert,
    )
  }

  // The extra unfiltered UPDATE listener only earns its keep when the INSERT/
  // UPDATE listeners above are filtered; a catch-all already sees every update.
  if (conditions.length > 0) {
    channel.on<T>(
      'postgres_changes',
      changesFilter('UPDATE'),
      handleKnownUpdate,
    )
  }

  channel.on<T>('postgres_changes', changesFilter('DELETE'), handleDelete)

  let resolveOutcome: (status: REALTIME_SUBSCRIBE_STATES) => void = () =>
    undefined
  const outcome = new Promise<REALTIME_SUBSCRIBE_STATES>((resolve) => {
    resolveOutcome = resolve
  })

  channel.subscribe((status) => {
    // SUBSCRIBED means the join succeeded. CHANNEL_ERROR is how the server
    // rejects a subscription — typically a filter it cannot evaluate — but it is
    // also emitted for a transient transport failure, so the caller tells the
    // two apart. CLOSED is a terminal close before joining. TIMED_OUT is
    // deliberately not terminal: realtime-js keeps retrying the join and reports
    // the outcome through this same callback.
    if (
      status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED ||
      status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR ||
      status === REALTIME_SUBSCRIBE_STATES.CLOSED
    ) {
      resolveOutcome(status)
    }
  })

  return { channel, outcome }
}

/**
 * A table's Realtime channel lifecycle state, held by the registry in
 * {@link ./db}. The joined channel and any in-flight swap are tracked
 * separately so a replacement can be superseded or torn down without losing the
 * channel that is still delivering changes.
 */
export interface TableEntry {
  /**
   * The collection receiving realtime writes. Its row type comes from the
   * caller's schema, so the registry (keyed only by table name) cannot name it.
   */
  collectionRef: Collection<any, any> | null
  /** Converts Realtime payload rows to the rows the collection holds. */
  conversions: ColumnConversions
  /** The joined channel currently delivering changes (null when none). */
  realtimeChannel: ReturnType<SupabaseClient['channel']> | null
  /** Serialized set of Realtime filters the current channel was subscribed with */
  realtimeFiltersKey: string | null
  /**
   * A replacement channel that is still subscribing and has not joined yet. It
   * is tracked separately from {@link realtimeChannel} so an in-flight swap can
   * be superseded or torn down without losing the channel that is still
   * delivering changes.
   */
  realtimePendingChannel: ReturnType<SupabaseClient['channel']> | null
  /** Serialized set of Realtime filters {@link realtimePendingChannel} is subscribing with */
  realtimePendingFiltersKey: string | null
  /**
   * Whether WHERE clauses are pushed to Realtime as server-side filters. When
   * `false`, the table always subscribes with a catch-all and filters
   * client-side.
   */
  realtimeUseFilter: boolean
  /**
   * Filter sets the server has rejected. They are replaced by a catch-all
   * subscription instead of being retried on every observer change.
   */
  rejectedFilterKeys: Set<string>
  supabase: SupabaseClient
}

/** A subscription that receives every change for the table. */
const CATCH_ALL_FILTERS = new URLSearchParams()
/** The registry key of the catch-all: an empty filter set serializes to "". */
const CATCH_ALL_KEY = ''

/**
 * Channel topics are namespaced and numbered because `supabase.channel()`
 * returns the *existing* channel for a topic that is already registered, and
 * subscribing to an already-joined channel throws. Reusing the table name would
 * hand back the channel currently being torn down, and could collide with a
 * channel the application opened itself or with another QueryClient sharing the
 * same Supabase client — so the counter is module-level, not per table.
 */
let channelCount = 0

/**
 * Every channel this adapter opens for `tableName` has a topic starting with
 * this prefix (supabase-js exposes it under its own `realtime:` prefix).
 */
export const realtimeChannelTopicPrefix = (tableName: string) =>
  `supabase-tanstack-db:${tableName}:`

const nextChannelTopic = (tableName: string) => {
  channelCount += 1
  return `${realtimeChannelTopicPrefix(tableName)}${channelCount}`
}

/**
 * Opens a channel for `filters` as the table's *pending* channel. The joined
 * channel keeps listening until the replacement actually joins, so no change
 * slips through while the swap is in flight; only then is the predecessor
 * removed. A swap already in flight is superseded (and torn down) first.
 *
 * On a terminal failure the pending channel is disposed. A filter the server
 * rejects is remembered and retried as a catch-all, while the previous channel
 * keeps working. A `CHANNEL_ERROR` on the catch-all itself is treated as a
 * transient connection error, not a rejection: if a previous channel is still
 * working it is kept, otherwise the errored channel is retained so realtime-js
 * reconnects it instead of leaving the table with no subscription at all.
 */
function subscribeToChanges(
  queryClient: QueryClient,
  entry: TableEntry,
  tableName: string,
  collection: Collection<any, any>,
  filters: URLSearchParams,
  filtersKey: string,
) {
  const previousChannel = entry.realtimeChannel
  const previousFiltersKey = entry.realtimeFiltersKey

  // A swap already in flight is now stale: tear it down before opening the next
  // so a superseded replacement never leaks.
  if (entry.realtimePendingChannel) {
    entry.supabase.removeChannel(entry.realtimePendingChannel)
    entry.realtimePendingChannel = null
    entry.realtimePendingFiltersKey = null
  }

  const subscription = attachSupabaseListeners(
    entry.supabase,
    nextChannelTopic(tableName),
    tableName,
    collection,
    filters,
    entry.conversions,
  )

  entry.realtimePendingChannel = subscription.channel
  entry.realtimePendingFiltersKey = filtersKey

  // True once a newer swap (or a teardown) has taken over this pending channel.
  const superseded = () => entry.realtimePendingChannel !== subscription.channel

  const onJoined = () => {
    if (superseded()) {
      return
    }
    if (previousChannel) {
      entry.supabase.removeChannel(previousChannel)
    }
    entry.realtimeChannel = subscription.channel
    entry.realtimeFiltersKey = filtersKey
    entry.realtimePendingChannel = null
    entry.realtimePendingFiltersKey = null
  }

  const onError = () => {
    if (superseded()) {
      entry.supabase.removeChannel(subscription.channel)
      return
    }
    entry.realtimePendingChannel = null
    entry.realtimePendingFiltersKey = null

    if (filtersKey !== CATCH_ALL_KEY) {
      // A filtered subscription the server refused: drop it, remember it, and
      // let syncTableSubscription pick the catch-all it now maps to — the same
      // decision the observer makes — while the previous channel keeps working.
      entry.supabase.removeChannel(subscription.channel)
      entry.rejectedFilterKeys.add(filtersKey)
      syncTableSubscription(queryClient, tableName, entry)
      return
    }

    // A catch-all has nothing to reject, so CHANNEL_ERROR here is a transient
    // connection error rather than a filter rejection.
    if (previousChannel) {
      // A previous channel is still delivering changes: drop the failed
      // catch-all and hand the swap back to the predecessor.
      entry.supabase.removeChannel(subscription.channel)
      entry.realtimeChannel = previousChannel
      entry.realtimeFiltersKey = previousFiltersKey
      return
    }
    // Nothing else is subscribed: keep the errored channel so realtime-js
    // reconnects it (its listeners stay attached) instead of leaving the table
    // with no subscription until an observer changes.
    entry.realtimeChannel = subscription.channel
    entry.realtimeFiltersKey = filtersKey
  }

  const onClosed = () => {
    // A terminal close before joining will not reconnect: drop it and hand the
    // swap back to the still-open previous channel.
    if (superseded()) {
      entry.supabase.removeChannel(subscription.channel)
      return
    }
    entry.supabase.removeChannel(subscription.channel)
    entry.realtimeChannel = previousChannel
    entry.realtimeFiltersKey = previousFiltersKey
    entry.realtimePendingChannel = null
    entry.realtimePendingFiltersKey = null
  }

  subscription.outcome.then((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.SUBSCRIBED) {
      onJoined()
    } else if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR) {
      onError()
    } else {
      onClosed()
    }
  })
}

/**
 * Reconcile one table's Realtime subscription with its active queries: tear the
 * channel down when there are none, otherwise derive the filters and (re)open a
 * channel unless the current (or in-flight) one already matches. This is the
 * single place that maps active queries to filters, so both the cache observer
 * and the rejection fallback route through it.
 */
export function syncTableSubscription(
  queryClient: QueryClient,
  tableName: string,
  entry: TableEntry,
) {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: [tableName],
    type: 'active',
  })

  // No active queries: tear down any existing subscription, including a swap
  // still in flight, so neither the joined nor the pending channel leaks.
  if (queries.length === 0) {
    if (entry.realtimeChannel) {
      entry.supabase.removeChannel(entry.realtimeChannel)
    }
    if (entry.realtimePendingChannel) {
      entry.supabase.removeChannel(entry.realtimePendingChannel)
    }
    entry.realtimeChannel = null
    entry.realtimeFiltersKey = null
    entry.realtimePendingChannel = null
    entry.realtimePendingFiltersKey = null
    return
  }

  if (!entry.collectionRef) {
    return
  }

  // Derive the Realtime filters from the WHERE clause of every active query so
  // the subscription only receives changes that those queries care about. When
  // server-side filtering is disabled, skip that and subscribe to every change.
  let filters = CATCH_ALL_FILTERS
  let filtersKey = CATCH_ALL_KEY
  if (entry.realtimeUseFilter) {
    const whereExpressions = queries.map(
      (query) => query.meta?.loadSubsetOptions?.where,
    )
    filters = realtimeFiltersToSearch(whereExpressions)
    filtersKey = filters.toString()
    if (entry.rejectedFilterKeys.has(filtersKey)) {
      filters = CATCH_ALL_FILTERS
      filtersKey = CATCH_ALL_KEY
    }
  }

  // Reuse the existing subscription when the set of filters hasn't changed.
  // While a swap is in flight the pending channel already targets the new
  // filters, so compare against it to avoid firing the same swap twice.
  const currentFiltersKey = entry.realtimePendingChannel
    ? entry.realtimePendingFiltersKey
    : entry.realtimeFiltersKey
  if (
    (entry.realtimeChannel || entry.realtimePendingChannel) &&
    currentFiltersKey === filtersKey
  ) {
    return
  }

  subscribeToChanges(
    queryClient,
    entry,
    tableName,
    entry.collectionRef,
    filters,
    filtersKey,
  )
}
