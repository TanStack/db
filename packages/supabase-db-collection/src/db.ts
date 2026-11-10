import { BasicIndex } from '@tanstack/db'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import {
  subsetOptionsToQueryKey,
  supabaseOnDelete,
  supabaseOnInsert,
  supabaseOnUpdate,
  supabaseQueryFn,
} from './functions'
import { getQueryClient } from './query-client'
import { syncTableSubscription } from './realtime'
import type { TableEntry } from './realtime'
import type { ColumnConversions, RowConversions } from './row-conversions'
import type { StringCollationConfig } from '@tanstack/db'
import type { QueryClient } from '@tanstack/query-core'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { StandardSchemaV1 } from '@standard-schema/spec'

interface SupabaseCollectionOptions<
  TSchema extends StandardSchemaV1,
> extends RowConversions<StandardSchemaV1.InferOutput<TSchema>> {
  /**
   * Controls how string columns are compared when ordering, matching the
   * database's collation settings. If omitted, TanStack DB's default is used.
   */
  defaultStringCollation?: StringCollationConfig
  /**
   * The columns that uniquely identify a row. Used to extract the key for
   * storing the item in the collection and to build the where clause for
   * update and delete operations.
   */
  keys: Array<keyof StandardSchemaV1.InferOutput<TSchema> & string>
  /** The query client */
  queryClient?: QueryClient
  /** Whether to receive updates when a record has been inserted, updated, or deleted by another user */
  realtime?: boolean
  /**
   * Whether to push each query's WHERE clause to the Realtime subscription as a
   * server-side `postgres_changes` filter. Only applies when `realtime` is on.
   * Defaults to `false`, which subscribes to every change on the table and
   * filters client-side — simpler, at the cost of more Realtime traffic. Set to
   * `true` to narrow the subscription server-side.
   */
  realtimeUseFilter?: boolean
  /** The schema of the collection */
  schema: TSchema
  /** The supabase browser client */
  supabase: SupabaseClient
  /**
   * When the table's rows are fetched.
   *
   * - `'on-demand'` (default): rows are loaded per live query, pushing each
   *   query's where/order/limit to PostgREST.
   * - `'eager'`: the whole table is fetched (paging past PostgREST's
   *   `db-max-rows`) as soon as the collection starts syncing, regardless of
   *   the queries run against it. Realtime then subscribes to every change on
   *   the table.
   */
  syncMode?: 'on-demand' | 'eager'
  /** The name of the table in the database */
  tableName: string
}

// Per-QueryClient registry of table entries, with a single cache subscription
// per client. Weakly keyed so a discarded QueryClient (and the Supabase clients
// and collections its entries reference) can be garbage collected.
const queryClientRegistries = new WeakMap<
  QueryClient,
  Map<string, TableEntry>
>()

const ensureQueryCacheSubscription = (
  queryClient: QueryClient,
): Map<string, TableEntry> => {
  const existing = queryClientRegistries.get(queryClient)
  if (existing) {
    return existing
  }

  const tables = new Map<string, TableEntry>()
  queryClientRegistries.set(queryClient, tables)

  queryClient.getQueryCache().subscribe((args) => {
    if (args.type !== 'observerAdded' && args.type !== 'observerRemoved') {
      return
    }
    for (const [tableName, entry] of tables) {
      syncTableSubscription(queryClient, tableName, entry)
    }
  })

  return tables
}

const registerTable = (
  queryClient: QueryClient,
  tableName: string,
  supabase: SupabaseClient,
  realtimeUseFilter: boolean,
): TableEntry => {
  const tables = ensureQueryCacheSubscription(queryClient)

  let entry = tables.get(tableName)
  if (!entry) {
    entry = {
      supabase,
      collectionRef: null,
      conversions: {},
      realtimeChannel: null,
      realtimeFiltersKey: null,
      realtimePendingChannel: null,
      realtimePendingFiltersKey: null,
      rejectedFilterKeys: new Set(),
      realtimeUseFilter,
    }
    tables.set(tableName, entry)
  }

  return entry
}

export const supabaseCollectionOptions = <TSchema extends StandardSchemaV1>({
  tableName,
  keys,
  schema,
  queryClient,
  supabase,
  realtime,
  realtimeUseFilter = false,
  syncMode = 'on-demand',
  defaultStringCollation,
  parse,
  serialize,
}: SupabaseCollectionOptions<TSchema>) => {
  // if the query client is not provided, use the global query client
  queryClient = queryClient ?? getQueryClient()

  type TItem = StandardSchemaV1.InferOutput<TSchema>

  // Derive the collection key from the configured key columns. A single column
  // keeps its string form (`6` becomes `'6'`). Composite keys encode each
  // value's string form as a JSON array, so distinct tuples cannot share a key
  // the way `'-'` joining let `['a-b', 'c']` and `['a', 'b-c']` do.
  const getKey = (item: TItem): string | number => {
    const values = keys.map((key) => `${item[key] ?? ``}`)
    return values.length === 1 ? values[0]! : JSON.stringify(values)
  }

  const conversions = { parse, serialize } as ColumnConversions

  // Key columns used to match rows on update and delete.
  const keyColumns = keys as Array<string>

  // A server-side Supabase client has no `channel`, so Realtime is a no-op there
  // and the table is never registered. Checking here keeps attachSupabaseListeners
  // able to always return a live subscription.
  let entry: TableEntry | null = null
  if (realtime && typeof supabase.channel === 'function') {
    entry = registerTable(queryClient, tableName, supabase, realtimeUseFilter)
  }
  const config = queryCollectionOptions({
    id: tableName,
    queryClient,
    getKey,
    schema,
    queryKey: (ctx) => subsetOptionsToQueryKey(tableName, ctx),
    syncMode,
    // Known limitation: the initial fetch does not wait for the Realtime channel
    // to finish subscribing. A row written in the window between this fetch and
    // the subscription going live can be missed by both — the fetch ran before
    // the row existed, and the subscription started after the change was
    // published. Gating the fetch on the subscription closes this gap but couples
    // every first load to Realtime connect latency, so it is intentionally left
    // out and tracked separately.
    queryFn: (ctx) =>
      supabaseQueryFn(supabase, tableName, ctx, {
        keys: keyColumns,
        conversions,
      }),
    onInsert: (ctx) => supabaseOnInsert(supabase, tableName, ctx, conversions),
    onUpdate: (ctx) =>
      supabaseOnUpdate(supabase, tableName, keyColumns, ctx, conversions),
    onDelete: (ctx) =>
      supabaseOnDelete(supabase, tableName, keyColumns, ctx, conversions),
    autoIndex: 'eager',
    defaultIndexType: BasicIndex,
    defaultStringCollation,
  })

  const originalSync = config.sync.sync

  return {
    ...config,
    sync: {
      sync: (
        ...args: Parameters<typeof originalSync>
      ): ReturnType<typeof originalSync> => {
        if (entry) {
          entry.collectionRef = args[0].collection
          entry.conversions = conversions
        }
        return originalSync(...args)
      },
    },
  }
}
