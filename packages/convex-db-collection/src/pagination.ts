import { paginationDemand } from './pagination-demand'
import { subscribeQuery } from './subscription'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { ConvexQueryOrder } from './paginated-options'
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
 * chain can replace the Collection's authoritative snapshot: eager mode needs
 * exhaustion; on-demand mode needs every active scope and its complete tie.
 */
export function subscribePages<TQuery extends FunctionReference<`query`>, TRow>(
  client: ConvexCollectionClient,
  query: TQuery,
  args: Omit<FunctionArgs<TQuery>, `paginationOpts`>,
  pageSize: number,
  maxRows: number,
  receive: (rows: ReadonlyArray<TRow>) => void,
  fail: (error: unknown) => void,
  queryOrder?: ConvexQueryOrder<TRow>,
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
  const demands = new Map<
    LoadSubsetOptions,
    {
      complete: ReturnType<typeof paginationDemand<TRow>>
      promise: Promise<void>
      resolve: () => void
      reject: (reason: unknown) => void
      cancel: () => void
      pending: boolean
    }
  >()
  let publishedPages = new Set<Page<TRow>>()
  const pages: Array<Page<TRow>> = []
  const boundaries = new Set<string>()
  const reject = (reason: unknown): void => {
    if (!active) return
    error = reason
    result = undefined
    for (const demand of demands.values())
      if (demand.pending) {
        demand.pending = false
        demand.reject(reason)
      }
    for (const waiter of waiters) waiter.reject(reason)
    waiters.clear()
    fail(reason)
  }
  const schedule = (): void => {
    if (!active || scheduled) return
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
      () => {
        // Pending tail acquisition leaves prior applied shallow coverage usable.
        // An update to a published range invalidates that cache until a new
        // coherent prefix establishes every still-active served scope.
        if (publishedPages.has(page)) result = undefined
        schedule()
      },
      reject,
    ) as ConvexSubscription<PaginationResult<TRow>>
    return page
  }
  const replace = (
    index: number,
    page: Page<TRow>,
    boundary: string,
    continueTail = true,
    endCursor = page.endCursor,
  ): void => {
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
    let right: Page<TRow> | undefined
    try {
      if (continueTail) right = createPage(boundary, endCursor)
    } catch (cause) {
      left.subscription?.unsubscribe()
      throw cause
    }
    boundaries.add(boundary)
    pages.splice(index, 1, left, ...(right ? [right] : []))
    page.subscription?.unsubscribe()
    schedule()
  }
  function flush(): void {
    if (!active || flushing || (queryOrder && demands.size === 0)) return
    flushing = true
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
          // Convex defines split children inside (cursor, continueCursor].
          // An unbounded right child would also start an unrelated successor.
          replace(
            index,
            page,
            value.splitCursor,
            true,
            page.endCursor ?? value.continueCursor,
          )
          return
        }
        completePages.push(value.page)
        if (page.endCursor === undefined && !value.isDone) {
          const needTail =
            !queryOrder ||
            [...demands.values()].some(
              (demand) => !demand.complete(completePages.flat(), false),
            )
          // Sealing keeps the returned range stable without speculatively
          // opening its unrelated successor. Future growth resumes from here.
          replace(index, page, value.continueCursor, needTail)
          return
        }
      }
      // Acquisition can add many ranges. Materialize rows only once every
      // range is available, rather than copying each incomplete prefix.
      const rows = completePages.flat()
      const tail = pages.at(-1)
      const exhausted =
        tail?.endCursor === undefined &&
        tail?.subscription?.getCurrentValue()?.isDone === true
      if (
        queryOrder
          ? [...demands.values()].some(
              (demand) => !demand.complete(rows, exhausted),
            )
          : !exhausted
      ) {
        if (tail?.endCursor !== undefined) {
          pages.push(createPage(tail.endCursor))
          schedule()
        }
        return
      }
      error = undefined
      result = rows
      publishedPages = new Set(pages)
      receive(rows)
      for (const demand of demands.values())
        if (demand.pending) {
          demand.pending = false
          demand.resolve()
        }
      for (const waiter of waiters) waiter.resolve()
      waiters.clear()
    } catch (cause) {
      reject(cause)
    } finally {
      flushing = false
    }
  }
  try {
    if (!queryOrder) pages.push(createPage(null))
    schedule()
  } catch (cause) {
    for (const page of pages) page.subscription?.unsubscribe()
    throw cause
  }
  const abortError = (): Error =>
    Object.assign(new Error(`Convex subset was canceled.`), {
      name: `AbortError`,
    })
  return {
    ...(queryOrder
      ? {
          loadSubset: (request: LoadSubsetOptions): true | Promise<void> => {
            if (!active || request.signal?.aborted)
              return Promise.reject(abortError())
            const existing = demands.get(request)
            if (existing?.pending) return existing.promise
            existing?.cancel()
            const complete = paginationDemand(request, queryOrder)
            let resolve!: () => void
            let rejectWaiter!: (error: unknown) => void
            const pending = new Promise<void>((yes, no) => {
              resolve = yes
              rejectWaiter = no
            })
            const cancel = (): void => {
              const demand = demands.get(request)
              if (!demand) return
              request.signal?.removeEventListener(`abort`, cancel)
              demands.delete(request)
              if (demand.pending) {
                demand.pending = false
                demand.reject(abortError())
              }
            }
            const demand = {
              complete,
              promise: pending,
              resolve,
              reject: rejectWaiter,
              cancel,
              pending: true,
            }
            demands.set(request, demand)
            request.signal?.addEventListener(`abort`, cancel, { once: true })
            if (complete([], false)) {
              demand.pending = false
              resolve()
              return pending
            }
            if (request.refetch) result = undefined
            flush()
            if (
              result !== undefined &&
              complete(
                result,
                pages.at(-1)?.endCursor === undefined &&
                  pages.at(-1)?.subscription?.getCurrentValue()?.isDone ===
                    true,
              )
            ) {
              demand.pending = false
              resolve()
              return pending
            }
            if (!pages.length) pages.push(createPage(null))
            schedule()
            return pending
          },
          unloadSubset: (request: LoadSubsetOptions): void => {
            demands.get(request)?.cancel()
          },
        }
      : {}),
    getCurrentValue: () => {
      flush()
      return result
    },
    waitForCurrent: () => {
      flush()
      if (error !== undefined) return Promise.reject(error)
      if (result !== undefined || (queryOrder && demands.size === 0))
        return Promise.resolve()
      return new Promise<void>((resolve, rejectWaiter) => {
        waiters.add({ resolve, reject: rejectWaiter })
      })
    },
    unsubscribe: () => {
      active = false
      for (const demand of [...demands.values()]) demand.cancel()
      for (const page of pages) page.subscription?.unsubscribe()
      const cause = new Error(`Convex pagination was cleaned up.`)
      cause.name = `AbortError`
      for (const waiter of waiters) waiter.reject(cause)
      waiters.clear()
    },
  }
}
