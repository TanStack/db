import { InfiniteQueryObserver, isCancelledError } from '@tanstack/query-core'
import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/query-core'

/** One backend page. Only null means the ordered result is exhausted. */
export interface CursorPage<T> {
  rows: ReadonlyArray<T>
  nextCursor: string | null
}

export interface CursorPagerOptions<T> {
  queryClient: QueryClient
  /** Dedicated infinite-query key: include the source, filters and order, not the window. */
  queryKey: QueryKey
  fetchPage: (
    cursor: string | undefined,
    signal: AbortSignal,
  ) => Promise<CursorPage<T>>
  /** Query's freshness interval. Defaults to the QueryClient's setting. */
  staleTime?: number
  /** Query's inactive cache lifetime. Defaults to the QueryClient's setting. */
  gcTime?: number
}

export interface CursorPager<T> {
  read: (
    window: { offset?: number; limit?: number },
    signal?: AbortSignal,
  ) => Promise<Array<T>>
  /** Remove this key's cached pages and invalidate this pager's queued reads. */
  reset: () => void
}

/**
 * Fulfill offset/limit windows using opaque backend cursors. Query owns the
 * pages, freshness, invalidation and garbage collection. Use one dedicated key
 * per filtered, totally ordered source. Loading more reuses fresh pages; refreshing
 * stale data rebuilds the loaded sequence from its first page.
 *
 * The key must not also be used for ordinary QueryCollection row arrays.
 * Use sibling row/page prefixes under one resource prefix, not pages beneath
 * the row prefix (manual writes update that whole prefix). For a forced refresh,
 * cancel the resource prefix before invalidating it. A positive staleTime avoids
 * refreshing on every read.
 *
 * Reads on one pager serialize; separate pagers share Query's cache and fetches.
 * Aborting a reader discards its answer, not shared cached
 * pages. Cancel the query through QueryClient to cancel its transport. Neither
 * cancellation nor a TTL can repair a backend's inconsistent cursor sequence.
 */
export function createCursorPager<T>({
  queryClient,
  queryKey,
  fetchPage,
  staleTime,
  gcTime,
}: CursorPagerOptions<T>): CursorPager<T> {
  let generation = 0
  let tail = Promise.resolve()
  const sequences = new WeakMap<AbortSignal, Set<string | undefined>>()
  type Pages = InfiniteData<CursorPage<T>, string | undefined>
  const nextCursor = (page: CursorPage<T>) => {
    if (
      !Array.isArray(page.rows) ||
      (page.nextCursor !== null && typeof page.nextCursor !== `string`)
    )
      throw new TypeError(
        `Invalid cursor page: expected rows and a string or null nextCursor`,
      )
    return page.nextCursor
  }
  const options = {
    queryKey,
    // Offsets address the complete sequence, never a selected or evicted prefix.
    maxPages: 0,
    select: undefined,
    enabled: true,
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(gcTime === undefined ? {} : { gcTime }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({
      pageParam,
      signal,
    }: {
      pageParam: string | undefined
      signal: AbortSignal
    }) => {
      let params = sequences.get(signal)
      if (pageParam === undefined || !params) {
        // Refresh starts a new sequence; growth extends the validated cache.
        // Query gives every page/retry in an acquisition the same signal.
        params = new Set(
          pageParam === undefined
            ? []
            : queryClient.getQueryData<
                InfiniteData<CursorPage<T>, string | undefined>
              >(queryKey)?.pageParams,
        )
        sequences.set(signal, params)
      }
      params.add(pageParam)
      const page = await fetchPage(pageParam, signal)
      // Validate even the final response, before Query publishes success or
      // resolves shared waiters. getNextPageParam runs too late for that.
      const next = nextCursor(page)
      if (next !== null && params.has(next)) {
        throw new Error(`Backend repeated a continuation cursor`)
      }
      return page
    },
    getNextPageParam: nextCursor,
  }

  const abortError = () =>
    new DOMException(`Cursor acquisition was canceled`, `AbortError`)
  const abortable = <TResult>(
    request: Promise<TResult>,
    signal?: AbortSignal,
  ) => {
    if (!signal) return request
    return new Promise<TResult>((resolve, reject) => {
      const abort = () => reject(signal.reason ?? abortError())
      const cleanup = () => signal.removeEventListener(`abort`, abort)
      request.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (error) => {
          cleanup()
          reject(error)
        },
      )
      if (signal.aborted) abort()
      else signal.addEventListener(`abort`, abort, { once: true })
    })
  }

  return {
    read({ offset = 0, limit }, signal) {
      const requestedGeneration = generation
      const checkCurrent = () => {
        if (signal?.aborted) throw signal.reason ?? abortError()
        if (requestedGeneration !== generation) {
          throw new DOMException(`Cursor sequence was reset`, `AbortError`)
        }
      }
      const run = async () => {
        checkCurrent()
        const end = limit === undefined ? Infinity : offset + limit
        if (
          !Number.isSafeInteger(offset) ||
          offset < 0 ||
          (limit !== undefined &&
            (!Number.isSafeInteger(limit) ||
              limit < 0 ||
              !Number.isSafeInteger(end)))
        )
          throw new RangeError(`Expected a nonnegative finite integer window`)
        if (limit === 0) return []
        try {
          const defaults = queryClient.defaultQueryOptions(options)
          // Match imperative fetchQuery defaults in browsers as well as Node.
          defaults.retry ??= false
          const observer = new InfiniteQueryObserver<
            CursorPage<T>,
            Error,
            Pages,
            QueryKey,
            string | undefined
          >(queryClient, { ...options, retry: defaults.retry })
          const query = observer.getCurrentQuery()
          const acquire = async (next: boolean): Promise<Pages> => {
            let request = (
              next
                ? observer.fetchNextPage({
                    throwOnError: true,
                    cancelRefetch: false,
                  })
                : observer.refetch({ throwOnError: true, cancelRefetch: false })
            ).then((result) => result.data!)
            let acquisition = query.promise!
            for (;;) {
              try {
                const [data] = await Promise.all([request, acquisition])
                return data
              } catch (error) {
                if (!isCancelledError(error)) throw error
                if (!error.silent || query.promise === acquisition)
                  throw abortError()
                // A cancelling refetch supersedes the old transport. Follow
                // its replacement, but never leak Query's control error into
                // an enclosing row query as though that query was canceled.
                acquisition = query.promise!
                request = acquisition
              }
            }
          }
          const current = observer.getCurrentResult()
          let data =
            current.data && !current.isStale
              ? current.data
              : await acquire(false)
          checkCurrent()
          if (!data.pages.length)
            throw new TypeError(`Invalid cursor page: empty cached sequence`)
          while (
            data.pages.reduce((count, page) => count + page.rows.length, 0) <
              end &&
            data.pages[data.pages.length - 1]?.nextCursor !== null
          ) {
            data = await acquire(true)
            checkCurrent()
          }
          const rows: Array<T> = []
          let start = 0
          for (const page of data.pages) {
            if (start >= end) break
            const stop = Math.min(page.rows.length, end - start)
            for (let index = Math.max(0, offset - start); index < stop; index++)
              rows.push(page.rows[index]!)
            start += page.rows.length
          }
          return rows
        } catch (error) {
          checkCurrent()
          throw error
        }
      }
      const result = tail.then(() => abortable(run(), signal))
      tail = result.then(
        () => {},
        () => {},
      )
      return abortable(result, signal)
    },
    reset() {
      generation++
      queryClient.removeQueries({ queryKey, exact: true })
    },
  }
}
