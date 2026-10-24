import { subscribeQuery } from './subscription'
import type { ConvexCollectionClient, ConvexSubscription } from './subscription'
import type {
  FunctionArgs,
  FunctionReference,
  PaginationResult,
} from 'convex/server'

type Page<T> = {
  cursor: string | null
  endCursor?: string
  subscription?: ConvexSubscription<PaginationResult<T>>
}

/**
 * Each bounded subscription owns (cursor, endCursor]. A changing page cannot
 * move its neighbour's boundary. Unbounded tails are sealed before continuing;
 * split hints replace a range with its two disjoint halves. Only a complete
 * chain ending in isDone can replace the Collection's authoritative snapshot.
 */
export function subscribePages<TQuery extends FunctionReference<`query`>, TRow>(
  client: ConvexCollectionClient,
  query: TQuery,
  args: Omit<FunctionArgs<TQuery>, `paginationOpts`>,
  pageSize: number,
  maxRows: number,
  receive: (rows: ReadonlyArray<TRow>) => void,
  fail: (error: unknown) => void,
): ConvexSubscription<ReadonlyArray<TRow>> {
  if (!Number.isSafeInteger(pageSize) || pageSize <= 0) {
    throw new RangeError(`Convex pageSize must be a positive safe integer.`)
  }
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0) {
    throw new RangeError(`Convex maxRows must be a positive safe integer.`)
  }
  let active = true
  let scheduled = false
  let flushing = false
  let result: ReadonlyArray<TRow> | undefined
  let error: unknown
  const waiters = new Set<{
    resolve: () => void
    reject: (reason: unknown) => void
  }>()
  const pages: Array<Page<TRow>> = []
  const boundaries = new Set<string>()
  const reject = (reason: unknown): void => {
    if (!active) return
    error = reason
    result = undefined
    for (const waiter of waiters) waiter.reject(reason)
    waiters.clear()
    fail(reason)
  }
  const schedule = (): void => {
    if (!active || scheduled) return
    result = undefined
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      flush()
    })
  }
  const createPage = (
    cursor: string | null,
    endCursor?: string,
  ): Page<TRow> => {
    const page: Page<TRow> = { cursor, endCursor }
    const paginationOpts = {
      cursor,
      numItems: pageSize,
      ...(endCursor === undefined ? {} : { endCursor }),
    }
    page.subscription = subscribeQuery(
      client,
      query,
      { ...args, paginationOpts } as FunctionArgs<TQuery>,
      schedule,
      reject,
    ) as ConvexSubscription<PaginationResult<TRow>>
    return page
  }
  const replace = (index: number, page: Page<TRow>, boundary: string): void => {
    if (
      boundary === page.cursor ||
      boundary === page.endCursor ||
      boundaries.has(boundary)
    ) {
      throw new Error(
        `Convex pagination returned a boundary that makes no progress.`,
      )
    }
    const left = createPage(page.cursor, boundary)
    let right: Page<TRow>
    try {
      right = createPage(boundary, page.endCursor)
    } catch (cause) {
      left.subscription?.unsubscribe()
      throw cause
    }
    boundaries.add(boundary)
    pages.splice(index, 1, left, right)
    page.subscription?.unsubscribe()
    schedule()
  }
  function flush(): void {
    if (!active || flushing) return
    flushing = true
    result = undefined
    try {
      const completePages: Array<Array<TRow>> = []
      let rowCount = 0
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index]!
        const value = page.subscription!.getCurrentValue()
        if (value === undefined) return
        if (
          !Array.isArray(value.page) ||
          typeof value.isDone !== `boolean` ||
          typeof value.continueCursor !== `string`
        ) {
          throw new TypeError(
            `Convex paginated queries must return PaginationResult.`,
          )
        }
        rowCount += value.page.length
        if (rowCount > maxRows) {
          throw new RangeError(
            `Convex eager mirror exceeds maxRows (${maxRows}).`,
          )
        }
        const split =
          value.pageStatus === `SplitRequired` ||
          value.pageStatus === `SplitRecommended`
        if (split) {
          if (!value.splitCursor)
            throw new Error(
              `Convex requested a page split without a splitCursor.`,
            )
          replace(index, page, value.splitCursor)
          return
        }
        if (page.endCursor === undefined && !value.isDone) {
          replace(index, page, value.continueCursor)
          return
        }
        completePages.push(value.page)
      }
      // Acquisition can add many ranges. Materialize rows only once every
      // range is available, rather than copying each incomplete prefix.
      const rows = completePages.flat()
      error = undefined
      result = rows
      receive(rows)
      for (const waiter of waiters) waiter.resolve()
      waiters.clear()
    } catch (cause) {
      reject(cause)
    } finally {
      flushing = false
    }
  }
  try {
    pages.push(createPage(null))
    schedule()
  } catch (cause) {
    for (const page of pages) page.subscription?.unsubscribe()
    throw cause
  }
  return {
    getCurrentValue: () => {
      flush()
      return result
    },
    waitForCurrent: () => {
      flush()
      if (error !== undefined) return Promise.reject(error)
      if (result !== undefined) return Promise.resolve()
      return new Promise<void>((resolve, rejectWaiter) => {
        waiters.add({ resolve, reject: rejectWaiter })
      })
    },
    unsubscribe: () => {
      active = false
      for (const page of pages) page.subscription?.unsubscribe()
      const cause = new Error(`Convex pagination was cleaned up.`)
      cause.name = `AbortError`
      for (const waiter of waiters) waiter.reject(cause)
      waiters.clear()
    },
  }
}
