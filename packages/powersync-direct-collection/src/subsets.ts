import type {
  CleanupFn,
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfigRes,
} from '@tanstack/db'
import type {
  PowerSyncClient,
  StreamError,
  StreamLease,
  StreamSubscription,
} from '@powersync/standalone-client'

export type GetSubscriptions = (
  options: LoadSubsetOptions,
) => ReadonlyArray<StreamSubscription>

/** Reports stream errors of subsets that have loaded, by their lease. */
export interface SubsetErrors {
  onError: (lease: StreamLease, error: StreamError) => void
  /** The lease was released, so its stream errors no longer apply. */
  onRelease: (lease: StreamLease) => void
}

/** Utilities to turn a function extracting Sync Stream subscriptions from queries into a {@link SyncConfigRes}. */
export function createSubsetHandlers(
  client: PowerSyncClient,
  getSubscriptions: GetSubscriptions,
  applied: () => SyncAppliedReceipt,
  errors: SubsetErrors,
): SyncConfigRes & { cleanup: CleanupFn } {
  type Acquisition = {
    streamLease: StreamLease
    abort: AbortController
    loaded: boolean
    loading?: Promise<void>
    removeListener: () => void
  }
  const acquisitions = new Map<LoadSubsetOptions, Acquisition>()
  let active = true
  // Releases only this acquisition: a later load of the same options may
  // have replaced it.
  const release = (options: LoadSubsetOptions, acquisition?: Acquisition) => {
    if (!acquisition || acquisitions.get(options) !== acquisition) return
    acquisitions.delete(options)
    acquisition.removeListener()
    acquisition.abort.abort()
    acquisition.streamLease.release()
    errors.onRelease(acquisition.streamLease)
  }
  const unloadSubset = (options: LoadSubsetOptions) =>
    release(options, acquisitions.get(options))
  const loadSubset = (options: LoadSubsetOptions): Promise<void> => {
    if (!active) throw new Error('PowerSync collection is not syncing')
    options.signal?.throwIfAborted()
    // Loads of the same options share one acquisition: a later load waits for
    // the current one, and acquires again only if that one failed.
    const current = acquisitions.get(options)?.loading
    if (current) return current.catch(() => loadSubset(options))
    // Mapping failures occur before taking ownership of resources.
    const streams = getSubscriptions(options)
    const streamLease = client.acquireStreams(streams, {
      // A failing load rejects loadSubset instead.
      onError: (error) => {
        if (acquisition.loaded) errors.onError(streamLease, error)
      },
    })
    const abort = new AbortController()
    const onAbort = () => release(options, acquisition)
    const acquisition: Acquisition = {
      streamLease,
      abort,
      loaded: false,
      removeListener: () =>
        options.signal?.removeEventListener('abort', onAbort),
    }
    acquisitions.set(options, acquisition)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const queued = streamLease.waitForSync(abort.signal)
    return (acquisition.loading = (async () => {
      try {
        await queued
        // Unlike confirmWrites(), loadSubset promises visible data. Never await
        // this receipt in the stream delivery callback itself.
        await applied()
        abort.signal.throwIfAborted()
        acquisition.loaded = true
      } catch (error) {
        // A shared collection commit cannot be canceled by just one observer.
        // If it was already queued, let it become visible before settling the
        // canceled baseline, as required by TanStack's replay contract.
        release(options, acquisition)
        await applied()
        throw error
      }
    })())
  }
  return {
    loadSubset,
    unloadSubset,
    cleanup: () => {
      active = false
      for (const options of acquisitions.keys()) unloadSubset(options)
    },
  }
}
