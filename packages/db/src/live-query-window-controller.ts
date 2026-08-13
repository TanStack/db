import {
  LiveQueryWindowControllerDisposedError,
  SetWindowRequiresOrderByError,
} from './errors.js'
import { getLiveQueryStatusFlags } from './live-query-adapter.js'
import { createLiveQueryObserver } from './live-query-observer.js'
import type {
  LiveQueryObserver,
  LiveQuerySnapshot,
} from './live-query-observer.js'
import type { Collection } from './collection/index.js'
import type { CollectionStatus } from './types.js'

const DEFAULT_PAGE_SIZE = 20

/** @internal This contract is unstable while RFC #1623 is being implemented. */
export function normalizeLiveQueryWindowPageSize(
  pageSize: number | undefined,
): number {
  if (
    pageSize === undefined ||
    !Number.isSafeInteger(pageSize) ||
    pageSize <= 0 ||
    pageSize >= Number.MAX_SAFE_INTEGER
  ) {
    return DEFAULT_PAGE_SIZE
  }
  return pageSize
}

type WindowResult = true | Promise<void>

type WindowTarget = object & {
  utils?: {
    setWindow?: (options: { offset: number; limit: number }) => WindowResult
    getWindow?: () => { offset: number; limit: number } | undefined
  }
}

type PendingWindow = {
  generation: number
  limit: number
  promise: Promise<void>
}

class WindowCoordinator {
  private readonly leases = new Map<symbol, number>()
  private readonly leaseVersions = new Map<symbol, number>()
  private readonly initialWindow: { offset: number; limit: number } | undefined
  private appliedLimit: number | undefined
  private pending: PendingWindow | undefined
  private generation = 0
  private leaseVersion = 0

  constructor(private readonly target: WindowTarget) {
    this.initialWindow = target.utils?.getWindow?.()
  }

  request(lease: symbol, limit: number): WindowResult {
    const previousLimit = this.leases.get(lease)
    const previousVersion = this.leaseVersions.get(lease)
    const version = ++this.leaseVersion
    this.leases.set(lease, limit)
    this.leaseVersions.set(lease, version)

    let result: WindowResult
    try {
      result = this.applyDesiredWindow()
    } catch (error) {
      this.rollbackLease(lease, version, previousLimit, previousVersion)
      this.appliedLimit = undefined
      throw error
    }

    if (result === true) return true
    return result.catch(async (error: unknown) => {
      if (this.rollbackLease(lease, version, previousLimit, previousVersion)) {
        this.generation++
        this.pending = undefined
        this.appliedLimit = undefined
        try {
          if (this.leases.size === 0) {
            this.restoreInitialWindow()
          } else {
            const rollback = this.applyDesiredWindow()
            if (rollback !== true) await rollback
          }
        } catch {
          // Preserve the failure from the requested window.
        }
      }
      throw error
    })
  }

  isLeaseSatisfied(lease: symbol, minimumLimit: number): boolean {
    const limit = this.leases.get(lease)
    if (limit === undefined || limit < minimumLimit) return false
    const desiredLimit = this.getDesiredLimit()
    const currentWindow = this.target.utils?.getWindow?.()
    return (
      currentWindow === undefined ||
      (currentWindow.offset === 0 && currentWindow.limit === desiredLimit)
    )
  }

  release(lease: symbol, restoreWhenEmpty: boolean): void {
    if (!this.leases.delete(lease)) return
    this.leaseVersions.delete(lease)

    // A pending request may still mutate the physical operator, but it no longer
    // establishes the accepted window for the remaining lease set.
    this.generation++
    this.pending = undefined
    this.appliedLimit = undefined

    if (this.leases.size === 0) {
      if (restoreWhenEmpty) this.restoreInitialWindow()
      return
    }

    try {
      const result = this.applyDesiredWindow()
      if (result !== true) {
        void result.catch(() => {
          // Unsubscribe has no async error channel. Leave the physical window
          // unaccepted so the next request retries it.
          this.appliedLimit = undefined
        })
      }
    } catch {
      // The remaining controller will retry on its next request.
      this.appliedLimit = undefined
    }
  }

  private getDesiredLimit(): number | undefined {
    let desired: number | undefined
    for (const limit of this.leases.values()) {
      desired = desired === undefined ? limit : Math.max(desired, limit)
    }
    return desired
  }

  private rollbackLease(
    lease: symbol,
    version: number,
    previousLimit: number | undefined,
    previousVersion: number | undefined,
  ): boolean {
    if (this.leaseVersions.get(lease) !== version) return false
    if (previousLimit === undefined) {
      this.leases.delete(lease)
      this.leaseVersions.delete(lease)
    } else {
      this.leases.set(lease, previousLimit)
      if (previousVersion === undefined) {
        this.leaseVersions.delete(lease)
      } else {
        this.leaseVersions.set(lease, previousVersion)
      }
    }
    return true
  }

  private restoreInitialWindow(): void {
    const setWindow = this.target.utils?.setWindow
    if (!this.initialWindow || typeof setWindow !== `function`) return
    try {
      const result = setWindow.call(this.target.utils, this.initialWindow)
      if (result !== true) void result.catch(() => {})
    } catch {
      // Release has no error channel. A future lease will retry its own window.
    }
  }

  private applyDesiredWindow(): WindowResult {
    const limit = this.getDesiredLimit()
    if (limit === undefined) return true
    if (this.pending?.limit === limit) return this.pending.promise
    if (this.pending) {
      // `setWindow` mutates the physical operator before its load promise
      // settles. A different desired window must therefore be applied again,
      // even when it matches the last settled limit.
      this.generation++
      this.pending = undefined
      this.appliedLimit = undefined
    }
    const currentWindow = this.target.utils?.getWindow?.()
    if (
      limit === this.appliedLimit &&
      currentWindow?.offset === 0 &&
      currentWindow.limit === limit
    ) {
      return true
    }

    const setWindow = this.target.utils?.setWindow
    if (typeof setWindow !== `function`) {
      throw new SetWindowRequiresOrderByError()
    }

    const generation = ++this.generation
    const result = setWindow.call(this.target.utils, { offset: 0, limit })
    if (result === true) {
      if (generation === this.generation && this.getDesiredLimit() === limit) {
        this.appliedLimit = limit
      }
      return true
    }

    const promise = result.then(
      () => {
        if (
          generation === this.generation &&
          this.getDesiredLimit() === limit
        ) {
          this.appliedLimit = limit
        }
        if (this.pending?.generation === generation) {
          this.pending = undefined
        }
      },
      (error: unknown) => {
        if (this.pending?.generation === generation) {
          this.pending = undefined
        }
        throw error
      },
    )
    this.pending = { generation, limit, promise }
    return promise
  }
}

const windowCoordinators = new WeakMap<object, WindowCoordinator>()

function getWindowCoordinator(target: WindowTarget): WindowCoordinator {
  let coordinator = windowCoordinators.get(target)
  if (!coordinator) {
    coordinator = new WindowCoordinator(target)
    windowCoordinators.set(target, coordinator)
  }
  return coordinator
}

/**
 * A page-windowed view of a live query at a point in time.
 *
 * @internal This contract is unstable while RFC #1623 is being implemented.
 */
export interface LiveQueryWindowSnapshot<
  T extends object,
  TKey extends string | number,
> {
  /** Rows across all committed pages, with the peek-ahead row removed. */
  data: ReadonlyArray<T>
  /** Rows grouped into committed pages of `pageSize`. */
  pages: ReadonlyArray<ReadonlyArray<T>>
  /** `initialPageParam + i` for each committed page. */
  pageParams: ReadonlyArray<number>
  hasNextPage: boolean
  isFetchingNextPage: boolean
  /** The last pagination failure, cleared when a retry begins. */
  error: unknown
  /** Keyed results for the physical window, or `undefined` when disabled. */
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

/** @internal This contract is unstable while RFC #1623 is being implemented. */
export interface CreateLiveQueryWindowControllerOptions {
  /** Rows per page (default 20). Invalid values use the default. */
  pageSize?: number
  /** Value of the first page's `pageParam` (default 0). */
  initialPageParam?: number
  /** Committed pages to preserve when a framework binding changes page shape. */
  initialPageCount?: number
}

/** @internal This contract is unstable while RFC #1623 is being implemented. */
export interface LiveQueryWindowController<
  T extends object,
  TKey extends string | number,
> {
  getSnapshot: () => LiveQueryWindowSnapshot<T, TKey>
  subscribe: (listener: () => void) => () => void
  /** Load one more page, resolving only after that page is committed. */
  fetchNextPage: () => Promise<void>
  /** Reset to the first page, resolving after the smaller window is accepted. */
  reset: () => Promise<void>
  preload: () => Promise<void>
  dispose: () => void
}

interface CachedFrom {
  observerSnapshot: unknown
  committedPageCount: number
  isFetchingNextPage: boolean
  hasPaginationError: boolean
  paginationError: unknown
  failedHasNextPage: boolean
}

interface SubscriptionRecord {
  listener: () => void
  active: boolean
}

interface Publication {
  targets: Array<SubscriptionRecord>
}

class LiveQueryWindowControllerImpl<
  T extends object,
  TKey extends string | number,
> implements LiveQueryWindowController<T, TKey> {
  private readonly observer: LiveQueryObserver<T, TKey>
  private readonly collection: Collection<T, TKey, any> | null
  private readonly coordinator: WindowCoordinator | null
  private readonly lease = Symbol(`liveQueryWindowLease`)
  private readonly pageSize: number
  private readonly initialPageParam: number

  private committedPageCount: number
  private isFetchingNextPage = false
  private hasPaginationError = false
  private paginationError: unknown
  private failedHasNextPage = false
  private windowGeneration = 0
  private pendingWindowGeneration: number | undefined
  private leaseActive = false
  private leaseGeneration = 0
  private inFlightLeaseHolders = 0
  private restoreInitialWindowOnRelease = false

  private readonly subscriptions = new Set<SubscriptionRecord>()
  private readonly publicationQueue: Array<Publication> = []
  private dispatching = false
  private blockDelivery = false
  private transitionDepth = 0
  private transitionNeedsNotify = false
  private observerUnsub: (() => void) | null = null
  private cachedSnapshot: LiveQueryWindowSnapshot<T, TKey> | null = null
  private cachedFrom: CachedFrom | null = null
  private disposed = false

  constructor(
    collection: Collection<T, TKey, any> | null,
    options: CreateLiveQueryWindowControllerOptions,
  ) {
    this.collection = collection
    this.coordinator = collection
      ? getWindowCoordinator(collection as unknown as WindowTarget)
      : null
    this.pageSize = normalizeLiveQueryWindowPageSize(options.pageSize)
    this.initialPageParam = options.initialPageParam ?? 0
    const initialPageCount = Math.floor(options.initialPageCount ?? 1)
    this.committedPageCount = Number.isFinite(initialPageCount)
      ? Math.max(1, initialPageCount)
      : 1
    // The controller listener carries no delta payload, so wholesale is the
    // only coherent observer contract and guarantees non-reentrant subscribe.
    this.observer = createLiveQueryObserver<T, TKey>(collection, {
      mode: `wholesale`,
    })
  }

  getSnapshot(): LiveQueryWindowSnapshot<T, TKey> {
    const observerSnapshot = this.observer.getSnapshot()
    const cached = this.cachedSnapshot
    if (
      cached &&
      this.cachedFrom &&
      this.cachedFrom.observerSnapshot === observerSnapshot &&
      this.cachedFrom.committedPageCount === this.committedPageCount &&
      this.cachedFrom.isFetchingNextPage === this.isFetchingNextPage &&
      this.cachedFrom.hasPaginationError === this.hasPaginationError &&
      this.cachedFrom.paginationError === this.paginationError &&
      this.cachedFrom.failedHasNextPage === this.failedHasNextPage
    ) {
      return cached
    }

    const enabled = observerSnapshot.isEnabled
    const rows =
      enabled && Array.isArray(observerSnapshot.data)
        ? (observerSnapshot.data as ReadonlyArray<T>)
        : []
    const totalRequested = this.committedPageCount * this.pageSize
    const computedHasNextPage = enabled && rows.length > totalRequested
    const hasNextPage = this.hasPaginationError
      ? this.failedHasNextPage
      : computedHasNextPage

    const pageCount = enabled ? this.committedPageCount : 0
    const pages: Array<ReadonlyArray<T>> = []
    const pageParams: Array<number> = []
    for (let i = 0; i < pageCount; i++) {
      pages.push(rows.slice(i * this.pageSize, (i + 1) * this.pageSize))
      pageParams.push(this.initialPageParam + i)
    }

    const status = this.hasPaginationError ? `error` : observerSnapshot.status
    const statusFlags = this.hasPaginationError
      ? getLiveQueryStatusFlags(`error`)
      : observerSnapshot
    this.cachedSnapshot = {
      data: rows.slice(0, totalRequested),
      pages,
      pageParams,
      hasNextPage,
      isFetchingNextPage: this.isFetchingNextPage,
      error: this.hasPaginationError ? this.paginationError : undefined,
      state: observerSnapshot.state,
      collection: observerSnapshot.collection,
      status,
      isLoading: statusFlags.isLoading,
      isReady: statusFlags.isReady,
      isIdle: statusFlags.isIdle,
      isError: statusFlags.isError,
      isCleanedUp: observerSnapshot.isCleanedUp,
      isEnabled: observerSnapshot.isEnabled,
    }
    this.cachedFrom = {
      observerSnapshot,
      committedPageCount: this.committedPageCount,
      isFetchingNextPage: this.isFetchingNextPage,
      hasPaginationError: this.hasPaginationError,
      paginationError: this.paginationError,
      failedHasNextPage: this.failedHasNextPage,
    }
    return this.cachedSnapshot
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) throw new LiveQueryWindowControllerDisposedError()

    const record: SubscriptionRecord = { listener, active: true }
    this.subscriptions.add(record)
    if (this.subscriptions.size === 1) {
      this.restoreInitialWindowOnRelease = false
      this.blockDelivery = true
      let observerUnsub: (() => void) | null = null
      try {
        // Store the desired physical window before observer activation can
        // compile or restart the live-query pipeline.
        const windowResult = this.ensureLeaseActive(this.committedPageCount)
        const leaseGeneration = this.leaseGeneration
        observerUnsub = this.observer.subscribe(() => this.onObserverNotify())
        this.observerUnsub = observerUnsub
        if (windowResult !== true) {
          this.trackAttachmentFailure(windowResult, leaseGeneration)
        }
      } catch (error) {
        observerUnsub?.()
        this.observerUnsub = null
        this.deactivateLease(true)
        record.active = false
        this.subscriptions.delete(record)
        throw error
      } finally {
        this.blockDelivery = false
      }
    }

    return () => {
      if (!record.active) return
      record.active = false
      this.subscriptions.delete(record)
      if (this.subscriptions.size === 0) {
        this.restoreInitialWindowOnRelease = true
        this.observerUnsub?.()
        this.observerUnsub = null
        if (this.inFlightLeaseHolders === 0) this.deactivateLease(true)
      }
    }
  }

  fetchNextPage(): Promise<void> {
    if (this.disposed || this.isFetchingNextPage) return Promise.resolve()
    if (!this.getSnapshot().hasNextPage) return Promise.resolve()
    return this.requestPageCount(this.committedPageCount + 1, true)
  }

  reset(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    if (
      this.committedPageCount === 1 &&
      !this.hasPaginationError &&
      !this.isFetchingNextPage &&
      this.pendingWindowGeneration === undefined
    ) {
      return Promise.resolve()
    }
    return this.requestPageCount(1, false)
  }

  async preload(): Promise<void> {
    if (this.disposed) throw new LiveQueryWindowControllerDisposedError()

    const hadPaginationError = this.hasPaginationError
    this.hasPaginationError = false
    this.paginationError = undefined
    this.acquireInFlightLease()
    try {
      const result = this.ensureLeaseActive(this.committedPageCount)
      if (result !== true) await result
      await this.observer.preload()
      this.failedHasNextPage = false
      if (hadPaginationError) this.notify()
    } catch (error) {
      this.hasPaginationError = true
      this.paginationError = error
      this.failedHasNextPage = this.getComputedHasNextPage()
      this.notify()
      throw error
    } finally {
      this.releaseInFlightLease()
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.windowGeneration++
    this.pendingWindowGeneration = undefined
    this.observerUnsub?.()
    this.observerUnsub = null
    this.deactivateLease(true)
    this.observer.dispose()
    for (const record of this.subscriptions) record.active = false
    this.subscriptions.clear()
    this.publicationQueue.length = 0
  }

  private requestPageCount(
    requestedPageCount: number,
    fetchingNextPage: boolean,
  ): Promise<void> {
    const generation = ++this.windowGeneration
    const previousHasNextPage = this.getSnapshot().hasNextPage
    this.pendingWindowGeneration = undefined
    this.acquireInFlightLease()

    this.beginTransition()
    this.isFetchingNextPage = fetchingNextPage
    this.hasPaginationError = false
    this.paginationError = undefined
    if (fetchingNextPage) this.notify()

    let result: WindowResult
    try {
      result = this.activateLease(requestedPageCount)
    } catch (error) {
      this.isFetchingNextPage = false
      this.hasPaginationError = true
      this.paginationError = error
      this.failedHasNextPage = previousHasNextPage
      this.notify()
      this.endTransition()
      this.releaseInFlightLease()
      return Promise.reject(error)
    }

    if (result === true) {
      if (!this.disposed && generation === this.windowGeneration) {
        this.committedPageCount = requestedPageCount
        this.isFetchingNextPage = false
        this.failedHasNextPage = false
        this.notify()
      }
      this.endTransition()
      this.releaseInFlightLease()
      return Promise.resolve()
    }

    this.pendingWindowGeneration = generation
    this.endTransition()

    return result
      .then(
        () => {
          if (this.disposed || generation !== this.windowGeneration) return
          this.beginTransition()
          this.pendingWindowGeneration = undefined
          this.committedPageCount = requestedPageCount
          this.isFetchingNextPage = false
          this.failedHasNextPage = false
          this.notify()
          this.endTransition()
        },
        (error: unknown) => {
          if (!this.disposed && generation === this.windowGeneration) {
            this.beginTransition()
            this.pendingWindowGeneration = undefined
            this.isFetchingNextPage = false
            this.hasPaginationError = true
            this.paginationError = error
            this.failedHasNextPage = previousHasNextPage
            this.notify()
            this.endTransition()
          }
          throw error
        },
      )
      .finally(() => {
        this.releaseInFlightLease()
      })
  }

  private acquireInFlightLease(): void {
    this.inFlightLeaseHolders++
  }

  private releaseInFlightLease(): void {
    this.inFlightLeaseHolders--
    if (this.inFlightLeaseHolders === 0 && this.subscriptions.size === 0) {
      this.deactivateLease(this.restoreInitialWindowOnRelease)
    }
  }

  private activateLease(pageCount: number): WindowResult {
    this.leaseGeneration++
    if (!this.coordinator || !this.collection) return true
    this.leaseActive = true
    return this.coordinator.request(this.lease, pageCount * this.pageSize + 1)
  }

  private ensureLeaseActive(pageCount: number): WindowResult {
    const minimumLimit = pageCount * this.pageSize + 1
    if (
      this.leaseActive &&
      this.coordinator?.isLeaseSatisfied(this.lease, minimumLimit)
    ) {
      return true
    }
    return this.activateLease(pageCount)
  }

  private deactivateLease(restoreWhenEmpty = false): void {
    if (!this.leaseActive || !this.coordinator) return
    this.leaseGeneration++
    this.leaseActive = false
    this.restoreInitialWindowOnRelease = false
    this.coordinator.release(this.lease, restoreWhenEmpty)
  }

  private trackAttachmentFailure(
    result: Promise<void>,
    leaseGeneration: number,
  ): void {
    void result.catch((error: unknown) => {
      if (
        this.disposed ||
        !this.leaseActive ||
        leaseGeneration !== this.leaseGeneration
      ) {
        return
      }
      this.beginTransition()
      this.hasPaginationError = true
      this.paginationError = error
      this.failedHasNextPage = this.getComputedHasNextPage()
      this.notify()
      this.endTransition()
    })
  }

  private getComputedHasNextPage(): boolean {
    const snapshot: LiveQuerySnapshot<T, TKey> = this.observer.getSnapshot()
    return (
      snapshot.isEnabled &&
      Array.isArray(snapshot.data) &&
      snapshot.data.length > this.committedPageCount * this.pageSize
    )
  }

  private onObserverNotify(): void {
    this.notify()
  }

  private beginTransition(): void {
    this.transitionDepth++
  }

  private endTransition(): void {
    this.transitionDepth--
    if (this.transitionDepth === 0 && this.transitionNeedsNotify) {
      this.transitionNeedsNotify = false
      this.publish()
    }
  }

  private notify(): void {
    if (this.transitionDepth > 0) {
      this.transitionNeedsNotify = true
      return
    }
    this.publish()
  }

  private publish(): void {
    if (this.disposed || this.blockDelivery || this.subscriptions.size === 0) {
      return
    }

    this.publicationQueue.push({ targets: [...this.subscriptions] })
    if (this.dispatching) return

    this.dispatching = true
    try {
      while (this.publicationQueue.length > 0) {
        const publication = this.publicationQueue.shift()!
        for (const record of publication.targets) {
          if (this.hasBeenDisposed()) return
          if (!record.active) continue
          record.listener()
        }
      }
    } finally {
      this.dispatching = false
    }
  }

  private hasBeenDisposed(): boolean {
    return this.disposed
  }
}

/**
 * Create an internal forward-window controller for an ordered live query.
 *
 * @internal This factory is unstable while RFC #1623 is being implemented.
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
