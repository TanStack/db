import { createLiveQueryObserver } from './live-query-observer.js'
import type {
  CreateLiveQueryObserverOptions,
  LiveQueryObserver,
} from './live-query-observer.js'
import type { Collection } from './collection/index.js'
import type { CollectionStatus } from './types.js'

const DEFAULT_PAGE_SIZE = 20

/**
 * A page-windowed view of a live query at a point in time. Extends the live
 * query's status/data contract with forward pagination derived from a
 * peek-ahead window (`limit = loadedPages * pageSize + 1`): the extra row tells
 * us whether another page exists and is then dropped from `data`/`pages`.
 *
 * `getSnapshot()` returns a stable identity that only changes when the query,
 * the page count, or the fetching state changes, so `useSyncExternalStore`-style
 * consumers can compare by reference.
 */
export interface LiveQueryWindowSnapshot<
  T extends object,
  TKey extends string | number,
> {
  /** Rows across all loaded pages, peek-ahead row removed. */
  data: ReadonlyArray<T>
  /** Rows grouped into pages of `pageSize`. */
  pages: ReadonlyArray<ReadonlyArray<T>>
  /** `initialPageParam + i` for each loaded page. */
  pageParams: ReadonlyArray<number>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** Keyed results for the whole window (incl. peek row), or `undefined` when disabled. */
  state: ReadonlyMap<TKey, T> | undefined
  collection: Collection<T, TKey, any> | undefined
  status: CollectionStatus | `disabled`
  isLoading: boolean
  isReady: boolean
  isIdle: boolean
  isError: boolean
  isCleanedUp: boolean
  isEnabled: boolean
}

export interface CreateLiveQueryWindowControllerOptions extends CreateLiveQueryObserverOptions {
  /** Rows per page (default 20). A falsy value falls back to the default. */
  pageSize?: number
  /** Value of the first page's `pageParam` (default 0). */
  initialPageParam?: number
  /**
   * Defer applying the first window until the collection is ready. Set for
   * query-function inputs whose collection is created lazily and already carries
   * the first page's window in its query; leave off for a pre-created collection
   * whose window must be established up front.
   */
  waitForReady?: boolean
}

/**
 * Owns the forward-pagination state machine for an ordered live query: the
 * loaded-page count, the peek-ahead window (via `collection.utils.setWindow`),
 * page slicing, and `hasNextPage`/`isFetchingNextPage`. Composes a
 * {@link LiveQueryObserver} for the data + lifecycle channel. Framework adapters
 * resolve the input to a collection and materialize the snapshot natively.
 */
export interface LiveQueryWindowController<
  T extends object,
  TKey extends string | number,
> {
  getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>
  subscribe: (listener: () => void) => () => void
  /** Load one more page (no-op when already fetching or no next page exists). */
  fetchNextPage: () => void
  /** Reset back to the first page — call when the input identity/deps change. */
  reset: () => void
  preload: () => Promise<void>
  dispose: () => void
}

interface CachedFrom {
  observerSnapshot: unknown
  loadedPageCount: number
  isFetchingNextPage: boolean
}

class LiveQueryWindowControllerImpl<
  T extends object,
  TKey extends string | number,
> implements LiveQueryWindowController<T, TKey> {
  private readonly observer: LiveQueryObserver<T, TKey>
  private readonly collection: Collection<T, TKey, any> | null
  private readonly pageSize: number
  private readonly initialPageParam: number
  private readonly waitForReady: boolean

  private loadedPageCount = 1
  private isFetchingNextPage = false
  // The limit last handed to `setWindow`, so we don't re-apply an unchanged
  // window on every observer notification.
  private appliedLimit: number | undefined
  // Bumped on each window application so a superseded load promise doesn't clear
  // the fetching flag for a window that no longer applies.
  private windowGeneration = 0

  private readonly listeners = new Set<() => void>()
  private observerUnsub: (() => void) | null = null
  private cachedSnapshot: LiveQueryWindowSnapshot<T, TKey> | null = null
  private cachedFrom: CachedFrom | null = null
  private disposed = false

  constructor(
    collection: Collection<T, TKey, any> | null,
    options: CreateLiveQueryWindowControllerOptions,
  ) {
    this.collection = collection
    this.pageSize = options.pageSize || DEFAULT_PAGE_SIZE
    this.initialPageParam = options.initialPageParam ?? 0
    this.waitForReady = options.waitForReady ?? false
    this.observer = createLiveQueryObserver<T, TKey>(collection, {
      deferInitialNotify: options.deferInitialNotify,
    })
  }

  getSnapshot(): LiveQueryWindowSnapshot<T, TKey> {
    const observerSnapshot = this.observer.getSnapshot()
    const cached = this.cachedSnapshot
    if (
      cached &&
      this.cachedFrom &&
      this.cachedFrom.observerSnapshot === observerSnapshot &&
      this.cachedFrom.loadedPageCount === this.loadedPageCount &&
      this.cachedFrom.isFetchingNextPage === this.isFetchingNextPage
    ) {
      return cached
    }

    const enabled = observerSnapshot.isEnabled
    const rows =
      enabled && Array.isArray(observerSnapshot.data)
        ? (observerSnapshot.data as ReadonlyArray<T>)
        : []
    const totalRequested = this.loadedPageCount * this.pageSize
    // The window peeks one row past what was requested; its presence means
    // there is another page. It is not part of the visible result.
    const hasNextPage = enabled && rows.length > totalRequested

    // A disabled query has no pages; an enabled query always has `loadedPageCount`
    // pages (the last may be empty when there is no data yet).
    const pageCount = enabled ? this.loadedPageCount : 0
    const pages: Array<ReadonlyArray<T>> = []
    const pageParams: Array<number> = []
    for (let i = 0; i < pageCount; i++) {
      pages.push(rows.slice(i * this.pageSize, (i + 1) * this.pageSize))
      pageParams.push(this.initialPageParam + i)
    }

    this.cachedSnapshot = {
      data: rows.slice(0, totalRequested),
      pages,
      pageParams,
      hasNextPage,
      isFetchingNextPage: this.isFetchingNextPage,
      state: observerSnapshot.state,
      collection: observerSnapshot.collection,
      status: observerSnapshot.status,
      isLoading: observerSnapshot.isLoading,
      isReady: observerSnapshot.isReady,
      isIdle: observerSnapshot.isIdle,
      isError: observerSnapshot.isError,
      isCleanedUp: observerSnapshot.isCleanedUp,
      isEnabled: observerSnapshot.isEnabled,
    }
    this.cachedFrom = {
      observerSnapshot,
      loadedPageCount: this.loadedPageCount,
      isFetchingNextPage: this.isFetchingNextPage,
    }
    return this.cachedSnapshot
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      this.observerUnsub = this.observer.subscribe(() =>
        this.onObserverNotify(),
      )
      // Establish the current window now that the query is active.
      this.applyWindow()
    }

    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
      if (this.listeners.size === 0) {
        this.observerUnsub?.()
        this.observerUnsub = null
      }
    }
  }

  fetchNextPage(): void {
    if (this.disposed || this.isFetchingNextPage) return
    if (!this.getSnapshot().hasNextPage) return
    this.loadedPageCount++
    this.applyWindow()
    this.notify()
  }

  reset(): void {
    if (this.disposed) return
    if (this.loadedPageCount === 1 && this.appliedLimit !== undefined) {
      // Already on the first page; nothing to reset.
      return
    }
    this.loadedPageCount = 1
    this.appliedLimit = undefined
    this.applyWindow()
    this.notify()
  }

  preload(): Promise<void> {
    return this.observer.preload()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.observerUnsub?.()
    this.observerUnsub = null
    this.observer.dispose()
    this.listeners.clear()
  }

  private onObserverNotify(): void {
    // Re-apply the window in case readiness just changed (a deferred first
    // apply) — idempotent when the window is unchanged — then republish.
    this.applyWindow()
    this.notify()
  }

  private applyWindow(): void {
    const collection = this.collection
    if (!collection || this.disposed) return
    if (this.waitForReady && !this.observer.getSnapshot().isReady) return

    const limit = this.loadedPageCount * this.pageSize + 1
    if (limit === this.appliedLimit) return
    this.appliedLimit = limit

    const utils = collection.utils as
      | {
          setWindow?: (o: {
            offset: number
            limit: number
          }) => true | Promise<void>
        }
      | undefined
    if (typeof utils?.setWindow !== `function`) return

    const generation = ++this.windowGeneration
    const result = utils.setWindow({ offset: 0, limit })
    if (result === true) {
      this.setFetching(false)
      return
    }

    this.setFetching(true)
    result
      .catch(() => {
        // Swallow — the load error surfaces through the collection's status.
      })
      .finally(() => {
        // Only clear for the window this call requested; a newer apply owns the
        // flag otherwise.
        if (!this.disposed && generation === this.windowGeneration) {
          this.setFetching(false)
        }
      })
  }

  private setFetching(value: boolean): void {
    if (this.isFetchingNextPage === value) return
    this.isFetchingNextPage = value
    this.notify()
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener())
  }
}

/**
 * Create a {@link LiveQueryWindowController} for a resolved, ordered live-query
 * collection (which must have an `orderBy`), or a disabled controller when
 * `collection` is `null`/`undefined`.
 */
export function createLiveQueryWindowController<
  T extends object,
  TKey extends string | number,
>(
  collection: Collection<T, TKey, any> | null | undefined,
  options: CreateLiveQueryWindowControllerOptions = {},
): LiveQueryWindowController<T, TKey> {
  return new LiveQueryWindowControllerImpl<T, TKey>(collection ?? null, options)
}
