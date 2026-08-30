import { attachLoadSubsetRequestSignal } from '../load-subset-request-provenance.js'
import {
  isLoadSubsetRequestSubsumedBy,
  isWhereSubset,
  minusWherePredicates,
  unionWherePredicates,
} from './predicate-utils.js'
import { cloneLoadSubsetOptions } from './load-subset-options.js'
import {
  recordLoadSubsetPromiseDemandMatcher,
  recordLoadSubsetResultDemandMatcher,
} from './load-subset-outcome.js'
import type { BasicExpression } from './ir.js'
import type {
  LoadSubsetFn,
  LoadSubsetOptions,
  LoadSubsetResult,
} from '../types.js'

type SharedAbortLease = {
  signal: AbortSignal | undefined
  aborted: boolean
  attach: (signal: AbortSignal | undefined) => void
  dispose: () => void
}

type LogicalLoadReservation = {
  generation: number
  invalidatesCoverage: boolean
  active: boolean
  acquisition?: AcquisitionOwnership
}

type AcquisitionOwnership = {
  matchesPhysicalRequest: (options: LoadSubsetOptions) => boolean
  generation: number
  reservations: Set<LogicalLoadReservation>
}

type InflightCall = AcquisitionOwnership & {
  options: LoadSubsetOptions
  promise: Promise<void | LoadSubsetResult>
  lease: SharedAbortLease
  trackable: boolean
}

function isInflightCall(
  acquisition: AcquisitionOwnership,
): acquisition is InflightCall {
  return `lease` in acquisition
}

/**
 * Deduplicated wrapper for a loadSubset function.
 * Tracks what data has been loaded and avoids redundant calls by applying
 * subset logic to predicates.
 *
 * @param opts - The options for the DeduplicatedLoadSubset
 * @param opts.loadSubset - The underlying loadSubset function to wrap
 * @param opts.onDeduplicate - An optional callback function that is invoked when a loadSubset call is deduplicated.
 *                              If the call is deduplicated because the requested data is being loaded by an inflight request,
 *                              then this callback is invoked when the inflight request completes successfully and the data is fully loaded.
 *                              This callback is useful if you need to track rows per query, in which case you can't ignore deduplicated calls
 *                              because you need to know which rows were loaded for each query.
 * @example
 * const dedupe = new DeduplicatedLoadSubset({ loadSubset: myLoadSubset, onDeduplicate: (opts) => console.log(`Call was deduplicated:`, opts) })
 *
 * // First call - fetches data
 * await dedupe.loadSubset({ where: gt(ref('age'), val(10)) })
 *
 * // Second call - subset of first, returns true immediately
 * await dedupe.loadSubset({ where: gt(ref('age'), val(20)) })
 *
 * // Clear state to start fresh
 * dedupe.reset()
 */
export class DeduplicatedLoadSubset {
  // The underlying loadSubset function to wrap
  private readonly _loadSubset: LoadSubsetFn

  // An optional callback function that is invoked when a loadSubset call is deduplicated.
  private readonly onDeduplicate:
    | ((options: LoadSubsetOptions) => void)
    | undefined

  // Combined where predicate for all unlimited calls (no limit)
  private unlimitedWhere: BasicExpression<boolean> | undefined = undefined

  // Flag to track if we've loaded all data (unlimited call with no where clause)
  private hasLoadedAllData = false

  // List of calls with a finite or cursor-relative result window.
  // We clone options before storing to prevent mutation of stored predicates
  private limitedCalls: Array<LoadSubsetOptions> = []

  // Track in-flight calls to prevent concurrent duplicate requests
  // Each entry also owns the shared cancellation lease for its requesters.
  private inflightCalls: Array<InflightCall> = []

  // Retain exact acquisition ownership after settlement so a later exact
  // owner can share its evidence until the final logical lease releases.
  private exactAcquisitions: Array<AcquisitionOwnership> = []

  // Generation counter to invalidate in-flight requests after reset()
  // When reset() is called, this increments, and any in-flight completion handlers
  // check if their captured generation matches before updating tracking state
  private generation = 0

  // Core releases the exact options object that it passed to loadSubset.
  // A queue preserves that identity when one object is reused across calls.
  private ownerReservations = new WeakMap<
    LoadSubsetOptions,
    Array<LogicalLoadReservation>
  >()

  constructor(opts: {
    loadSubset: LoadSubsetFn
    onDeduplicate?: (options: LoadSubsetOptions) => void
  }) {
    this._loadSubset = opts.loadSubset
    this.onDeduplicate = opts.onDeduplicate
  }

  /**
   * Load a subset of data, with automatic deduplication based on previously
   * loaded predicates and in-flight requests.
   *
   * This method is auto-bound, so it can be safely passed as a callback without
   * losing its `this` context (e.g., `loadSubset: dedupe.loadSubset` in a sync config).
   *
   * @param options - The predicate options (where, orderBy, limit)
   * @returns true if data is already loaded, or a Promise that resolves when data is loaded
   */
  loadSubset = (
    options: LoadSubsetOptions,
  ): true | Promise<void | LoadSubsetResult> => {
    const reservation = this.reserveOwner(options, options.limit !== 0)
    try {
      // A zero-width window has no rows to acquire and establishes no coverage.
      // Keep only its logical reservation so reused option objects still
      // release in invocation order without invalidating another request.
      if (options.limit === 0) {
        this.onDeduplicate?.(options)
        return true
      }

      return this.loadSubsetRequest(options, reservation)
    } catch (error) {
      this.removeOwnerReservation(options, reservation)
      throw error
    }
  }

  private loadSubsetRequest(
    options: LoadSubsetOptions,
    reservation: LogicalLoadReservation,
  ): true | Promise<void | LoadSubsetResult> {
    const exactAcquisition = this.exactAcquisitions.find(
      (acquisition) =>
        acquisition.generation === this.generation &&
        acquisition.matchesPhysicalRequest(options),
    )
    if (exactAcquisition) {
      exactAcquisition.reservations.add(reservation)
      reservation.acquisition = exactAcquisition
      this.onDeduplicate?.(options)
      return true
    }

    // If we've loaded all data, everything is covered
    if (this.hasLoadedAllData) {
      this.onDeduplicate?.(options)
      return true
    }

    // Check against unlimited combined predicate
    // If we've loaded all data matching a where clause, we don't need to refetch subsets
    if (this.unlimitedWhere !== undefined && options.where !== undefined) {
      if (isWhereSubset(options.where, this.unlimitedWhere)) {
        this.onDeduplicate?.(options)
        return true // Data already loaded via unlimited call
      }
    }

    // Check against limited calls
    if (options.limit !== undefined || options.cursor !== undefined) {
      const alreadyLoaded = this.limitedCalls.some((loaded) =>
        isLoadSubsetRequestSubsumedBy(options, loaded),
      )

      if (alreadyLoaded) {
        this.onDeduplicate?.(options)
        return true // Already loaded
      }
    }

    // Check against in-flight calls using the same subset logic as resolved calls
    // This prevents duplicate requests when concurrent calls have subset relationships
    const matchingInflight = this.inflightCalls.find(
      (inflight) =>
        !inflight.lease.aborted &&
        isLoadSubsetRequestSubsumedBy(options, inflight.options),
    )

    if (matchingInflight !== undefined) {
      matchingInflight.reservations.add(reservation)
      reservation.acquisition = matchingInflight
      matchingInflight.lease.attach(options.signal)
      // An in-flight call will load data that covers this request
      // Every requester shares the physical work and cancellation lease. A
      // narrower requester receives a caller-relative result whose extent is
      // conservative even if an outer adapter rebuilds the result object.
      // The in-flight promise already handles tracking updates when it completes
      const prom = projectLoadSubsetResultForCaller(
        matchingInflight.promise,
        options,
        matchingInflight.matchesPhysicalRequest,
      )
      // Call `onDeduplicate` when the inflight request has loaded the data
      void prom
        .then(() => this.onDeduplicate?.(options))
        .catch(() => {
          // The original caller owns the transport failure. This observer only
          // waits to publish successful deduplication.
        })
      return prom
    }

    // Preserve the original request for tracking and in-flight dedupe, but allow
    // the backend request to be narrowed to only the missing subset.
    const lease = createSharedAbortLease(options.signal)
    const trackingOptions = cloneLoadSubsetOptions({
      ...options,
      signal: lease.signal,
    })
    const loadOptions = cloneLoadSubsetOptions(trackingOptions)
    if (
      this.unlimitedWhere !== undefined &&
      options.limit === undefined &&
      options.cursor === undefined
    ) {
      // Compute difference to get only the missing data
      // We can only do this for unlimited queries
      // and we can only remove data that was loaded from unlimited queries
      // because with limited queries we have no way to express that we already loaded part of the matching data
      loadOptions.where =
        minusWherePredicates(loadOptions.where, this.unlimitedWhere) ??
        loadOptions.where
    }
    const physicalRequest = cloneLoadSubsetOptions(loadOptions)
    const matchesPhysicalRequest = (candidate: LoadSubsetOptions) =>
      isLoadSubsetRequestSubsumedBy(candidate, physicalRequest) &&
      isLoadSubsetRequestSubsumedBy(physicalRequest, candidate)

    // Call underlying loadSubset to load the missing data
    const requestGeneration = this.generation
    let resultPromise: true | Promise<void | LoadSubsetResult>
    try {
      resultPromise = this._loadSubset(loadOptions)
    } catch (error) {
      lease.dispose()
      throw error
    }

    // Handle both sync (true) and async (Promise<void>) return values
    if (resultPromise === true) {
      if (
        requestGeneration === this.generation &&
        reservation.active &&
        !lease.aborted
      ) {
        this.updateTracking(trackingOptions)
        const acquisition: AcquisitionOwnership = {
          matchesPhysicalRequest,
          generation: requestGeneration,
          reservations: new Set([reservation]),
        }
        reservation.acquisition = acquisition
        this.exactAcquisitions.push(acquisition)
      }
      lease.dispose()
      return true
    } else {
      const ownsRequestAtAdapterReturn =
        requestGeneration === this.generation && reservation.active
      // Promise subclasses can run or throw from handler installation. Keep the
      // entry optional until the complete observation chain exists so failed
      // installation cannot leave an owner or abort lease behind.
      const installation: { entry: InflightCall | undefined } = {
        entry: undefined,
      }
      let observedPromise: Promise<void | LoadSubsetResult>
      try {
        observedPromise = resultPromise
          .then((result) => {
            // Only update tracking if this request is still from the current generation
            // If reset() was called, the generation will have incremented and we should
            // not repopulate the state that was just cleared
            if (
              installation.entry?.trackable &&
              installation.entry.generation === this.generation &&
              !lease.aborted
            ) {
              this.updateTracking(trackingOptions)
              this.exactAcquisitions.push(installation.entry)
            }
            return recordLoadSubsetResultDemandMatcher(
              result,
              matchesPhysicalRequest,
            )
          })
          .finally(() => {
            // Always remove from in-flight array on completion OR rejection
            // This ensures failed requests can be retried instead of being cached forever
            if (installation.entry) {
              const index = this.inflightCalls.indexOf(installation.entry)
              if (index !== -1) {
                this.inflightCalls.splice(index, 1)
              }
            }
            lease.dispose()
          })
      } catch (error) {
        lease.dispose()
        throw error
      }
      const inflightEntry: InflightCall = {
        options: trackingOptions,
        lease,
        matchesPhysicalRequest,
        generation: requestGeneration,
        trackable: ownsRequestAtAdapterReturn,
        reservations: ownsRequestAtAdapterReturn
          ? new Set([reservation])
          : new Set(),
        promise: observedPromise,
      }
      installation.entry = inflightEntry
      const ownsRequestAfterHandlerInstallation =
        requestGeneration === this.generation && reservation.active
      inflightEntry.trackable = ownsRequestAfterHandlerInstallation
      if (ownsRequestAfterHandlerInstallation) {
        reservation.acquisition = inflightEntry
      } else {
        inflightEntry.reservations.clear()
      }

      recordLoadSubsetPromiseDemandMatcher(
        inflightEntry.promise,
        matchesPhysicalRequest,
      )

      // Store the in-flight entry so concurrent subset calls can wait for it
      if (ownsRequestAfterHandlerInstallation) {
        this.inflightCalls.push(inflightEntry)
      }
      return projectLoadSubsetResultForCaller(
        inflightEntry.promise,
        options,
        matchesPhysicalRequest,
      )
    }
  }

  /**
   * Invalidates request coverage when its Collection owner releases it.
   *
   * Deduplication is safe only while the rows established by the remembered
   * requests remain available to the Collection. Core may delete those rows
   * after the final subset owner releases, so adapters that retain this helper
   * across live-query lifetimes must return this method as their unloadSubset
   * callback.
   *
   * Settled exact evidence and in-flight work are tracked by logical owner, so
   * a late release cannot retire a newer generation or work that another owner
   * still needs. Broader inferred coverage remains conservative. Core must
   * release the same options object that it passed to loadSubset; unmatched
   * releases are no-ops.
   */
  unloadSubset = (options: LoadSubsetOptions): void => {
    const reservation = this.shiftOwnerReservation(options)
    // A synchronous adapter throw never established helper state. Core may
    // still release that logical demand later, but it must not invalidate a
    // newer request that happens to use equivalent options.
    if (!reservation || reservation.generation !== this.generation) return
    if (!reservation.invalidatesCoverage) return

    const acquisition = reservation.acquisition
    if (acquisition) {
      acquisition.reservations.delete(reservation)
      if (acquisition.reservations.size > 0) return
      this.retireAcquisition(acquisition)
    }
    this.clearInferredTracking()
  }

  /**
   * Reset all tracking state.
   * Clears the history of loaded predicates and in-flight calls.
   * Use this when you want to start fresh, for example after clearing the underlying data store.
   *
   * Note: Any in-flight requests will still complete, but they will not update the tracking
   * state after the reset. This prevents old requests from repopulating cleared state.
   */
  reset(): void {
    this.clearLoadedTracking()
    for (const inflight of this.inflightCalls) inflight.trackable = false
    this.inflightCalls = []
    // Increment generation to invalidate any in-flight completion handlers
    // This ensures requests that were started before reset() don't repopulate the state
    this.generation++
  }

  private reserveOwner(
    options: LoadSubsetOptions,
    invalidatesCoverage: boolean,
  ): LogicalLoadReservation {
    const reservation = {
      generation: this.generation,
      invalidatesCoverage,
      active: true,
    }
    const reservations = this.ownerReservations.get(options)
    if (reservations) reservations.push(reservation)
    else this.ownerReservations.set(options, [reservation])
    return reservation
  }

  private shiftOwnerReservation(
    options: LoadSubsetOptions,
  ): LogicalLoadReservation | undefined {
    const reservations = this.ownerReservations.get(options)
    const reservation = reservations?.shift()
    if (reservation) reservation.active = false
    if (reservations?.length === 0) this.ownerReservations.delete(options)
    return reservation
  }

  private removeOwnerReservation(
    options: LoadSubsetOptions,
    reservation: LogicalLoadReservation,
  ): void {
    reservation.active = false
    const reservations = this.ownerReservations.get(options)
    const reservationIndex = reservations?.indexOf(reservation) ?? -1
    if (reservationIndex !== -1) reservations!.splice(reservationIndex, 1)
    if (reservations?.length === 0) this.ownerReservations.delete(options)

    const acquisition = reservation.acquisition
    if (!acquisition) return
    acquisition.reservations.delete(reservation)
    if (acquisition.reservations.size > 0) return
    this.retireAcquisition(acquisition)
  }

  private retireAcquisition(acquisition: AcquisitionOwnership): void {
    const exactIndex = this.exactAcquisitions.indexOf(acquisition)
    if (exactIndex !== -1) this.exactAcquisitions.splice(exactIndex, 1)
    if (!isInflightCall(acquisition)) return
    acquisition.trackable = false
    const inflightIndex = this.inflightCalls.indexOf(acquisition)
    if (inflightIndex !== -1) this.inflightCalls.splice(inflightIndex, 1)
  }

  private clearLoadedTracking(): void {
    this.clearInferredTracking()
    this.exactAcquisitions = []
  }

  private clearInferredTracking(): void {
    this.unlimitedWhere = undefined
    this.hasLoadedAllData = false
    this.limitedCalls = []
  }

  private updateTracking(options: LoadSubsetOptions): void {
    // Update tracking based on whether this was a limited or unlimited call
    if (options.limit === undefined && options.cursor === undefined) {
      // Unlimited call - update combined where predicate
      // We ignore orderBy for unlimited calls as mentioned in requirements
      if (options.where === undefined) {
        // No where clause = all data loaded
        this.hasLoadedAllData = true
        this.unlimitedWhere = undefined
        this.limitedCalls = []
        this.inflightCalls = []
      } else if (this.unlimitedWhere === undefined) {
        this.unlimitedWhere = options.where
      } else {
        this.unlimitedWhere = unionWherePredicates([
          this.unlimitedWhere,
          options.where,
        ])
      }
    } else {
      // Limited call - add to list for future subset checks
      // Options are already cloned by caller to prevent mutation issues
      this.limitedCalls.push(options)
    }
  }
}

function projectLoadSubsetResultForCaller(
  physicalPromise: Promise<void | LoadSubsetResult>,
  callerOptions: LoadSubsetOptions,
  matchesPhysicalRequest: (options: LoadSubsetOptions) => boolean,
): Promise<void | LoadSubsetResult> {
  if (matchesPhysicalRequest(callerOptions)) return physicalPromise

  const callerRequest = cloneLoadSubsetOptions(callerOptions)
  const matchesCallerRequest = (candidate: LoadSubsetOptions) =>
    isLoadSubsetRequestSubsumedBy(candidate, callerRequest) &&
    isLoadSubsetRequestSubsumedBy(callerRequest, candidate)
  const projectedPromise = physicalPromise.then((result) =>
    recordLoadSubsetResultDemandMatcher(
      result === undefined ? undefined : { ...result, hasMore: undefined },
      matchesCallerRequest,
    ),
  )
  recordLoadSubsetPromiseDemandMatcher(projectedPromise, matchesCallerRequest)
  return projectedPromise
}

function createSharedAbortLease(
  initialSignal: AbortSignal | undefined,
): SharedAbortLease {
  const controller = initialSignal ? new AbortController() : undefined
  const listeners = new Map<AbortSignal, () => void>()
  let hasUnabortableOwner = initialSignal === undefined
  let activeAbortableOwners = 0

  const abortIfUnused = (reason?: unknown) => {
    if (
      !hasUnabortableOwner &&
      listeners.size > 0 &&
      activeAbortableOwners === 0
    ) {
      controller?.abort(reason)
    }
  }

  const attach = (signal: AbortSignal | undefined) => {
    attachLoadSubsetRequestSignal(controller?.signal, signal)
    if (!signal) {
      hasUnabortableOwner = true
      return
    }
    if (listeners.has(signal)) return

    const onAbort = () => {
      activeAbortableOwners -= 1
      abortIfUnused(signal.reason)
    }
    listeners.set(signal, onAbort)
    if (signal.aborted) {
      abortIfUnused(signal.reason)
    } else {
      activeAbortableOwners += 1
      signal.addEventListener(`abort`, onAbort, { once: true })
    }
  }

  attach(initialSignal)

  return {
    signal: controller?.signal,
    get aborted() {
      return controller?.signal.aborted ?? false
    },
    attach,
    dispose: () => {
      for (const [signal, listener] of listeners) {
        signal.removeEventListener(`abort`, listener)
      }
      listeners.clear()
    },
  }
}

/**
 * Clones a LoadSubsetOptions object to prevent mutation of stored predicates.
 * This is crucial because callers often reuse the same options object and mutate
 * properties like limit or where between calls. Without cloning, our stored history
 * would reflect the mutated values rather than what was actually loaded.
 */
export { cloneLoadSubsetOptions as cloneOptions } from './load-subset-options.js'
