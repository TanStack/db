import { DeleteOperationItemNotFoundError } from '@tanstack/query-db-collection'
import {
  cursorCurrentToSearch,
  cursorWhereFromToSearch,
  keyColumnsToSearch,
  loadSubsetOptionsToSearch,
  splitLoadSubsetOptions,
  subsetParamsToSearch,
} from './postgrest-filters'
import { postgrestRequest } from './postgrest-request'
import { isSynced } from './realtime'
import { parseRow, serializeRow } from './row-conversions'
import type { ColumnConversions } from './row-conversions'
import type {
  DeleteMutationFnParams,
  InsertMutationFnParams,
  LoadSubsetOptions,
  UpdateMutationFnParams,
} from '@tanstack/db'
import type { QueryClient, QueryMeta } from '@tanstack/query-core'
import type { SupabaseClient } from '@supabase/supabase-js'

export const subsetOptionsToQueryKey = (
  tableName: string,
  ctx: LoadSubsetOptions,
): Array<string> => {
  // The key shares the request URL's where/order/limit encoding
  // (`subsetParamsToSearch`) so the two cannot drift; the constant `select` is
  // excluded because it never distinguishes one subset from another.
  //
  // Pagination params (cursor/offset) ARE included: query-db-collection keys row
  // ownership by this key, so distinct windows of the same subset (same
  // where/order/limit, different cursor/offset) must not collide — otherwise a
  // later page's result would take over the earlier page's rows and delete them.
  // The key still starts with `[tableName]` so `syncTableSubscription` keeps
  // matching every window of the table by prefix.
  const search = subsetParamsToSearch(ctx)
  if (ctx.cursor) {
    try {
      for (const [k, v] of cursorWhereFromToSearch(ctx.cursor)) {
        search.append(k, v)
      }
    } catch {
      // The queryKey function must never throw — query-db-collection calls it
      // synchronously to key row ownership. If the cursor cannot be rendered
      // (an un-pushable predicate), fall back to a deterministic discriminator
      // so distinct windows still get distinct keys and cannot take over and
      // delete each other's rows.
      search.append('cursor', JSON.stringify(ctx.cursor.whereFrom))
    }
  }
  if (ctx.offset && !ctx.cursor) {
    search.append('offset', `${ctx.offset}`)
  }
  const key = search.toString()
  return key ? [tableName, key] : [tableName]
}

type PageOptions = {
  /** The caller's row limit; `undefined` means "the full matching set". */
  limit?: number
  /** The starting offset (always 0 for cursor reads). */
  offset: number
  signal?: AbortSignal
  /**
   * Columns that uniquely identify a row. Pages are ordered by them after the
   * caller's order so that the rows tied on that order keep one position
   * across the page requests; see {@link withKeyOrder}.
   */
  keys: Array<string>
}

/**
 * Extends the `order` param with the key columns it does not already sort by.
 *
 * Offset paging is only sound over a total order. When the caller's order has
 * ties (or there is none), Postgres may order the tied rows differently for
 * each page request, so a row can show up on two pages while another shows up
 * on none. Ordering by the unique key last makes every page agree.
 */
function withKeyOrder(
  search: URLSearchParams,
  keys: Array<string>,
): URLSearchParams {
  const sorts = search.get('order')?.split(',') ?? []
  // Each sort is `column.direction[.nulls]`; the column is the first segment.
  const sortedColumns = new Set(sorts.map((sort) => sort.split('.')[0]))
  const missing = keys.filter((key) => !sortedColumns.has(key))
  if (missing.length === 0) {
    return search
  }
  const ordered = new URLSearchParams(search)
  ordered.set(
    'order',
    [...sorts, ...missing.map((key) => `${key}.asc`)].join(','),
  )
  return ordered
}

/**
 * Read a full matching set (or the caller's `limit` rows) with offset paging,
 * looping past PostgREST's `db-max-rows` cap instead of silently truncating at
 * it. The first request asks for `count=exact` so the loop knows the total up
 * front and stops without a trailing empty probe; each later page advances the
 * offset by the rows actually received (self-correcting under concurrent
 * writes) and is capped by the observed page size and the rows still owed.
 *
 * A result that fits in one page is returned as read. When more pages are
 * needed, the first page is read again under a total order (see
 * {@link withKeyOrder}) so that all pages are cut from the same sequence.
 */
async function fetchAllPages<TItem>(
  supabase: SupabaseClient,
  tableName: string,
  baseSearch: URLSearchParams,
  { limit, offset: startOffset, signal, keys }: PageOptions,
): Promise<Array<TItem>> {
  // A zero limit is an empty window: return it without touching the network.
  if (limit === 0) {
    return []
  }

  // The base search already carries the caller's limit/offset (from the search
  // builders), so the first request is sent verbatim — its URL stays identical
  // to the single-request behaviour, and the query key that mirrors it.
  const first = await postgrestRequest<Array<TItem>>(supabase, tableName, {
    method: 'GET',
    search: baseSearch,
    signal,
    count: 'exact',
  })
  let rows: Array<TItem> = first.data ? [...first.data] : []

  // The rows the first page returned size the server's cap; a later page that
  // comes back shorter than this means the server has no more rows.
  const pageSize = rows.length
  // `Content-Range` reports the whole matching set, so the rows reachable from
  // the starting offset are what remains past it. When the count header is
  // missing we fall back to paging until a short page appears.
  const total = first.count ?? Number.POSITIVE_INFINITY
  const remaining = Math.max(0, total - startOffset)
  const target = limit === undefined ? remaining : Math.min(limit, remaining)

  // The first page was read under the caller's order, whose ties the server may
  // break differently on the next request. If more pages follow, discard it and
  // page through a total order instead.
  let pagedSearch = baseSearch
  if (pageSize > 0 && rows.length < target) {
    pagedSearch = withKeyOrder(baseSearch, keys)
    if (pagedSearch !== baseSearch) {
      rows = []
    }
  }

  let lastPageSize = pageSize
  while (lastPageSize === pageSize && pageSize > 0 && rows.length < target) {
    const pageSearch = new URLSearchParams(pagedSearch)
    pageSearch.set('offset', `${startOffset + rows.length}`)
    pageSearch.set('limit', `${Math.min(pageSize, target - rows.length)}`)
    const page = await postgrestRequest<Array<TItem>>(supabase, tableName, {
      method: 'GET',
      search: pageSearch,
      signal,
    })
    const pageRows = page.data ?? []
    rows.push(...pageRows)
    lastPageSize = pageRows.length
  }

  return rows
}

/**
 * Read one already-in-budget subset's full window: the keyset tie request (if
 * any) plus the main paged request. This is what runs once per chunk when
 * `splitLoadSubsetOptions` had to split an oversized subset into several.
 */
async function loadWindow<TItem>(
  supabase: SupabaseClient,
  tableName: string,
  keys: Array<string>,
  options: LoadSubsetOptions,
  signal: AbortSignal,
): Promise<Array<TItem>> {
  const search = loadSubsetOptionsToSearch(options)
  // Cursor reads pin their own window start, so they never carry an offset (see
  // loadSubsetOptionsToSearch); only a cursor-less read advances from `offset`.
  const startOffset = options.offset && !options.cursor ? options.offset : 0

  // A keyset request whose boundary column has ties (e.g. `orderBy(created_at)`
  // with repeated values) needs a second, unlimited request for the rows equal
  // to the boundary; the limited `whereFrom` page alone would skip them.
  //
  // Do not drop this on the grounds that core's ordered-source loader also
  // probes the boundary (`requestSnapshot({ where: eq(col, boundary) })`) and
  // usually pre-loads the same tie class: that probe is a window-path
  // optimization the adapter cannot assume ran. It is skipped when the boundary
  // value is unchanged, falls back to a full-source load for non-keyset orders,
  // and never runs for `loadSubset({ cursor })` calls made outside that path.
  // Honouring `whereCurrent` here is what makes the cursor correct on its own.
  const tiesSearch = cursorCurrentToSearch(options)
  if (!tiesSearch) {
    return await fetchAllPages<TItem>(supabase, tableName, search, {
      limit: options.limit,
      offset: startOffset,
      signal,
      keys,
    })
  }

  const [ties, rows] = await Promise.all([
    // The tie read is deliberately unbounded by the caller's limit — every row
    // tied at the boundary must come back — but it is still paged so a tie class
    // larger than the cap is not truncated.
    fetchAllPages<TItem>(supabase, tableName, tiesSearch, {
      offset: 0,
      signal,
      keys,
    }),
    fetchAllPages<TItem>(supabase, tableName, search, {
      limit: options.limit,
      offset: startOffset,
      signal,
      keys,
    }),
  ])
  // `whereCurrent` (== boundary) and `whereFrom` (> / < boundary) are disjoint,
  // so concatenation never duplicates; the collection re-sorts locally.
  return [...ties, ...rows]
}

// PostgREST has no body-carried filters for reads and the Supabase API gateway
// rejects request lines over about 8 KB with 414, so a big `inArray(...)`
// predicate (the common shape a lazy join's on-demand collection produces)
// can make a subset's URL too long to send. This matches postgrest-js's own
// `urlLengthLimit` default so the two agree on what counts as "too long".
export const MAX_URL_LENGTH = 8000

// At most this many chunk requests run at once; splitting a large IN list can
// produce far more chunks than are worth having in flight simultaneously.
const MAX_CONCURRENT_CHUNKS = 6

// Pages after the first (`fetchAllPages`) set `offset` and `limit` on top of
// the subset's own search; no real value is wider than this one.
const WIDEST_PAGE_PARAM = `${Number.MAX_SAFE_INTEGER}`

/**
 * The length of the longest URL `fetchAllPages` could send for `search`: the
 * base URL, the `?`, and the query string with the key-column tiebreak order
 * that multi-page reads add (see {@link withKeyOrder}) and `offset`/`limit` at
 * their widest, so every page — not only the first — stays within budget.
 */
function pagedUrlLength(
  baseLength: number,
  search: URLSearchParams,
  keys: Array<string>,
): number {
  const paged = new URLSearchParams(withKeyOrder(search, keys))
  paged.set('offset', WIDEST_PAGE_PARAM)
  paged.set('limit', WIDEST_PAGE_PARAM)
  return baseLength + '?'.length + paged.toString().length
}

/**
 * The length of the longest URL a subset would produce: the main request's
 * pages, and — when the subset has a cursor — the unlimited `whereCurrent` tie
 * request's pages too, since `loadWindow` sends both for a cursor read.
 * Measuring rendered URLs (rather than estimating) accounts for quoting and
 * percent-encoding exactly.
 */
function measureSubset(
  supabase: SupabaseClient,
  tableName: string,
  keys: Array<string>,
  options: LoadSubsetOptions,
): number {
  const base = supabase.from(tableName).url.toString().length
  const mainLength = pagedUrlLength(
    base,
    loadSubsetOptionsToSearch(options),
    keys,
  )
  const tiesSearch = cursorCurrentToSearch(options)
  return tiesSearch
    ? Math.max(mainLength, pagedUrlLength(base, tiesSearch, keys))
    : mainLength
}

/**
 * Runs one `loadWindow` per chunk with at most `MAX_CONCURRENT_CHUNKS` in
 * flight at a time, and concatenates their rows. Chunks are disjoint on the
 * split column (see `splitLoadSubsetOptions`), so concatenation order does not
 * matter and needs no dedupe.
 *
 * On the first failure, every other chunk's request is aborted through a
 * local `AbortController` that also follows the caller's own signal — this
 * keeps the same all-or-nothing semantics an unsplit request has ("one failed
 * page fails the whole load") instead of surfacing a partial result, and the
 * first error encountered is what `Promise.all` rejects with.
 */
async function loadChunks<TItem>(
  supabase: SupabaseClient,
  tableName: string,
  keys: Array<string>,
  chunks: Array<LoadSubsetOptions>,
  signal: AbortSignal,
): Promise<Array<TItem>> {
  // Not `AbortSignal.any`: React Native (Hermes) and Safari before 17.4 lack it.
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal.reason)
  if (signal.aborted) {
    abortFromCaller()
  } else {
    signal.addEventListener('abort', abortFromCaller, { once: true })
  }
  const results: Array<Array<TItem>> = new Array(chunks.length)
  let nextIndex = 0

  const runWorker = async (): Promise<void> => {
    while (nextIndex < chunks.length) {
      const index = nextIndex++
      try {
        results[index] = await loadWindow<TItem>(
          supabase,
          tableName,
          keys,
          chunks[index]!,
          controller.signal,
        )
      } catch (error) {
        controller.abort()
        throw error
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_CHUNKS, chunks.length)
  try {
    await Promise.all(Array.from({ length: workerCount }, runWorker))
  } finally {
    signal.removeEventListener('abort', abortFromCaller)
  }
  return results.flat()
}

/**
 * Reads the rows a query needs, converted to the rows the collection holds
 * (see {@link RowConversions}).
 */
export const supabaseQueryFn = async <TItem extends object>(
  supabase: SupabaseClient,
  tableName: string,
  ctx: {
    client: QueryClient
    queryKey: ReadonlyArray<unknown>
    signal: AbortSignal
    meta: QueryMeta | undefined
    pageParam?: unknown
    direction?: unknown
  },
  {
    keys = [],
    conversions = {},
  }: { keys?: Array<string>; conversions?: ColumnConversions } = {},
): Promise<Array<TItem>> => {
  const options = ctx.meta?.loadSubsetOptions ?? {}
  // The query key stays the full, unchunked subset (subsetOptionsToQueryKey
  // never sees these chunks), so this fan-out is invisible to
  // query-db-collection: one query still owns every row it returns.
  const chunks = splitLoadSubsetOptions(options, {
    maxUrlLength: MAX_URL_LENGTH,
    measure: (chunkOptions) =>
      measureSubset(supabase, tableName, keys, chunkOptions),
  })

  const rows =
    chunks.length === 1
      ? await loadWindow<object>(
          supabase,
          tableName,
          keys,
          chunks[0]!,
          ctx.signal,
        )
      : await loadChunks<object>(supabase, tableName, keys, chunks, ctx.signal)
  return rows.map((row) => parseRow<TItem>(row, conversions))
}

export const supabaseOnInsert = async <TItem extends object>(
  supabase: SupabaseClient,
  tableName: string,
  { transaction, collection }: InsertMutationFnParams<TItem, string | number>,
  conversions: ColumnConversions = {},
) => {
  await Promise.all(
    transaction.mutations.map(async (mutation) => {
      const { data } = await postgrestRequest<TItem>(supabase, tableName, {
        method: 'POST',
        search: new URLSearchParams({ select: '*' }),
        body: serializeRow(mutation.modified, conversions),
        returnRows: true,
        single: true,
      })

      // A single-row insert with `Prefer: return=representation` always returns
      // the created row.
      const inserted = parseRow<TItem>(data as object, conversions)
      mutation.modified = inserted
      // The data has been inserted and confirmed by the server, so we can write
      // it to the collection. Realtime may already have echoed the insert, in
      // which case this is an update of the synced row rather than an insert.
      await collection.utils.writeUpsert(inserted)
    }),
  )
}

export const supabaseOnUpdate = async <TItem extends object>(
  supabase: SupabaseClient,
  tableName: string,
  keys: Array<string>,
  { transaction, collection }: UpdateMutationFnParams<TItem, string | number>,
  conversions: ColumnConversions = {},
) => {
  await Promise.all(
    transaction.mutations.map(async (mutation) => {
      const { original, changes } = mutation
      const search = keyColumnsToSearch(
        keys,
        serializeRow(original, conversions),
      )
      search.set('select', '*')
      const { data } = await postgrestRequest<TItem>(supabase, tableName, {
        method: 'PATCH',
        search,
        body: serializeRow({ ...original, ...changes }, conversions),
        returnRows: true,
        single: true,
      })

      // A single-row update with `Prefer: return=representation` always returns
      // the updated row.
      const updated = parseRow<TItem>(data as object, conversions)
      mutation.modified = updated
      await collection.utils.writeUpdate(updated)
    }),
  )
}

export const supabaseOnDelete = async <TItem extends object>(
  supabase: SupabaseClient,
  tableName: string,
  keys: Array<string>,
  { transaction, collection }: DeleteMutationFnParams<TItem, string | number>,
  conversions: ColumnConversions = {},
) => {
  await Promise.all(
    transaction.mutations.map(async (mutation) => {
      await postgrestRequest(supabase, tableName, {
        method: 'DELETE',
        search: keyColumnsToSearch(
          keys,
          serializeRow(mutation.original, conversions),
        ),
      })

      // The data has been deleted and confirmed by the server, so we can write
      // it to the collection — unless Realtime already echoed the delete, in
      // which case the synced row is gone and writing again would throw.
      const key = collection.getKeyFromItem(mutation.original)
      if (!isSynced(collection, key)) {
        return
      }
      try {
        await collection.utils.writeDelete(key)
      } catch (error) {
        // Direct writes are applied asynchronously, so a Realtime echo can
        // remove the row between the check above and this write being applied.
        // The row is gone either way, so the delete is already confirmed.
        if (!(error instanceof DeleteOperationItemNotFoundError)) {
          throw error
        }
      }
    }),
  )
}
