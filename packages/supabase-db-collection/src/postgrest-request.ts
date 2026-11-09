import { PostgrestError, PostgrestFilterBuilder } from '@supabase/postgrest-js'
import { CLIENT_INFO, CLIENT_INFO_HEADER } from './request-headers'
import type { SupabaseClient } from '@supabase/supabase-js'

const SINGLE_ROW_ACCEPT = 'application/vnd.pgrst.object+json'

interface PostgrestRequestOptions {
  /** JSON body for insert/update. */
  body?: unknown
  /**
   * Ask PostgREST for the total matching-row count (`Prefer: count=…`). The
   * count is read back off the `Content-Range` header; the paging loop uses it
   * to fetch a set larger than the server's `db-max-rows` cap without probing.
   */
  count?: 'exact' | 'planned' | 'estimated'
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  /** Ask PostgREST to return the affected rows (`Prefer: return=representation`). */
  returnRows?: boolean
  /** The full query string, built by the params helpers. */
  search: URLSearchParams
  /** Abort signal, threaded from the query's `ctx.signal`. */
  signal?: AbortSignal
  /** Expect exactly one row (`Accept: application/vnd.pgrst.object+json`). */
  single?: boolean
}

/** A PostgREST read result: the rows plus the total count when one was asked for. */
export interface PostgrestResult<TData> {
  /** Total matching rows when `count` was requested, else `null`. */
  count: number | null
  /** The response body: an array of rows, a single row, or `null` when empty. */
  data: TData | null
}

/**
 * Issue a PostgREST request with a hand-built query string while leaving
 * supabase-js in charge of auth, schema, tracing, timeout, and transport.
 *
 * `supabase.from(table)` yields a `PostgrestQueryBuilder` whose `url`,
 * `headers`, `schema`, and `fetch` are the auth-injecting, timeout-wrapped
 * request state (the `fetch` wrapper derives `apikey`/`Authorization`, the
 * headers already carry the user's `global.headers`). We clone that state,
 * swap in our own search string, and hand it to `PostgrestFilterBuilder` — a
 * documented standalone entry point — so we reuse its `Accept-Profile`/
 * `Content-Profile`, response parsing, and error handling without re-deriving
 * auth ourselves.
 */
export async function postgrestRequest<TData = unknown>(
  supabase: SupabaseClient,
  table: string,
  {
    method,
    search,
    body,
    returnRows,
    single,
    count,
    signal,
  }: PostgrestRequestOptions,
): Promise<PostgrestResult<TData>> {
  const queryBuilder = supabase.from(table)

  const url = new URL(queryBuilder.url.toString())
  url.search = search.toString()

  const headers = new Headers(queryBuilder.headers)
  headers.set(CLIENT_INFO_HEADER, CLIENT_INFO)
  if (returnRows) {
    headers.append('Prefer', 'return=representation')
  }
  if (count) {
    headers.append('Prefer', `count=${count}`)
  }
  if (single) {
    headers.set('Accept', SINGLE_ROW_ACCEPT)
  }

  // PostgrestFilterBuilder's generics describe database schema types that are
  // unavailable without codegen and irrelevant here, since only `data`, `error`
  // and `count` are read off the awaited response. Pinning them to `any` also
  // keeps this call valid across postgrest-js versions that differ in the
  // number of generic parameters.
  const builder = new PostgrestFilterBuilder<any, any, any, any>({
    method,
    url,
    headers,
    schema: queryBuilder.schema,
    body,
    fetch: queryBuilder.fetch,
    // The builder threads its own `signal` straight into the underlying fetch,
    // so aborting the query cancels the in-flight request.
    signal,
  })

  const { data, error, count: total } = await builder
  if (error) {
    throw error instanceof Error ? error : new PostgrestError(error)
  }
  // The caller states the response shape it expects for this request.
  return { data: data as TData | null, count: total ?? null }
}
