import { InfiniteQueryObserver } from '@tanstack/query-core'
import type { QueryClient, QueryKey } from '@tanstack/query-core'

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
 * Put it under the collection's query-key prefix so prefix invalidation reaches
 * both caches. A positive staleTime avoids refreshing on every read.
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
  const options = {
    queryKey,
    // Offsets address the complete sequence, never a selected or evicted prefix.
    maxPages: 0,
    select: undefined,
    ...(staleTime === undefined ? {} : { staleTime }),
    ...(gcTime === undefined ? {} : { gcTime }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({
      pageParam,
      signal,
    }: {
      pageParam: string | undefined
      signal: AbortSignal
    }) => fetchPage(pageParam, signal),
    getNextPageParam: (
      page: CursorPage<T>,
      _pages: Array<CursorPage<T>>,
      _lastParam: string | undefined,
      params: Array<string | undefined>,
    ) => {
      if (page.nextCursor !== null && params.includes(page.nextCursor)) {
        throw new Error(`Backend repeated a continuation cursor`)
      }
      return page.nextCursor
    },
  }

  const observeAcquisition = <TResult>(request: Promise<TResult>) => {
    const query = queryClient.getQueryCache().find({ queryKey, exact: true })
    let failure: { error: unknown } | undefined
    // Query can turn cancellation into cached success. Preserve the acquisition's
    // rejection, but let a fresh cache hit finish without waiting for another fetch.
    if (query?.state.fetchStatus !== `idle`) {
      void query?.promise?.catch((error: unknown) => {
        failure = { error }
      })
    }
    return request.then((result) => {
      if (failure) throw failure.error
      return result
    })
  }

  return {
    read({ offset = 0, limit }, signal) {
      const requestedGeneration = generation
      const checkCurrent = () => {
        signal?.throwIfAborted()
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
          let data = await observeAcquisition(
            queryClient.fetchInfiniteQuery(options),
          )
          checkCurrent()
          const observer = new InfiniteQueryObserver<
            CursorPage<T>,
            Error,
            typeof data,
            QueryKey,
            string | undefined
          >(queryClient, options)
          while (
            data.pages.reduce((count, page) => count + page.rows.length, 0) <
              end &&
            data.pages[data.pages.length - 1]?.nextCursor !== null
          ) {
            const result = await observeAcquisition(
              observer.fetchNextPage({
                throwOnError: true,
                cancelRefetch: false,
              }),
            )
            checkCurrent()
            data = result.data!
          }
          return data.pages.flatMap((page) => page.rows).slice(offset, end)
        } catch (error) {
          checkCurrent()
          throw error
        }
      }
      const result = tail.then(run)
      tail = result.then(
        () => {},
        () => {},
      )
      return result
    },
    reset() {
      generation++
      queryClient.removeQueries({ queryKey, exact: true })
    },
  }
}
