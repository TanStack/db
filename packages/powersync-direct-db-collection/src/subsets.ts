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

/** Reports stream errors after provider synchronization, by their lease. */
export interface SubsetErrors {
  onError: (lease: StreamLease, error: StreamError, signal: AbortSignal) => void
  /** The lease was released, so its stream errors no longer apply. */
  onRelease: (lease: StreamLease) => void
}

/** Utilities to turn a function extracting Sync Stream subscriptions from queries into a {@link SyncConfigRes}. */
export function createSubsetHandlers(
  client: PowerSyncClient,
  getSubscriptions: GetSubscriptions,
  applied: (streams?: ReadonlyArray<StreamSubscription>) => SyncAppliedReceipt,
  errors: SubsetErrors,
): SyncConfigRes & { cleanup: CleanupFn } {
  type Acquisition = {
    streamLease: StreamLease
    abort: AbortController
    synced: boolean
    loading?: Promise<void>
    removeListener: () => void
  }
  const acquisitions = new Map<LoadSubsetOptions, Acquisition>()
  let active = true
  const assertActive = () => {
    if (!active) throw new Error('PowerSync collection is not syncing')
  }
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
    assertActive()
    options.signal?.throwIfAborted()
    // Loads of the same options share one acquisition: a later load waits for
    // the current one, and acquires again only if that one failed.
    const current = acquisitions.get(options)?.loading
    if (current) return current.catch(() => loadSubset(options))
    // Mapping failures occur before taking ownership of resources.
    const streams = getSubscriptions(options)
    assertActive()
    options.signal?.throwIfAborted()
    const streamLease = client.acquireStreams(streams, {
      // A failing load rejects loadSubset instead.
      onError: (error) => {
        if (acquisition.synced) errors.onError(streamLease, error, abort.signal)
      },
    })
    const abort = new AbortController()
    const onAbort = () => release(options, acquisition)
    const acquisition: Acquisition = {
      streamLease,
      abort,
      synced: false,
      removeListener: () =>
        options.signal?.removeEventListener('abort', onAbort),
    }
    acquisitions.set(options, acquisition)
    options.signal?.addEventListener('abort', onAbort, { once: true })
    const queued = streamLease.waitForSync(abort.signal)
    return (acquisition.loading = (async () => {
      try {
        await queued
        acquisition.synced = true
        // Unlike confirmWrites(), loadSubset promises visible data. Never await
        // this receipt in the stream delivery callback itself.
        // A ready listener can cancel after the checkpoint committed rows but
        // before this continuation. Await those rows without starting a new
        // snapshot for the canceled acquisition.
        await applied(abort.signal.aborted ? undefined : streams)
        abort.signal.throwIfAborted()
      } catch (error) {
        // A priority checkpoint can supply rows before full synchronization.
        // Cancellation still owes their application. A service rejection has
        // no result, and a fully synced acquisition awaited its receipt above.
        const pending =
          abort.signal.aborted && !acquisition.synced ? applied() : true
        release(options, acquisition)
        // Receipt failure is reported by the source; preserve this caller's
        // original rejection, including cancellation.
        await Promise.resolve(pending).catch(() => undefined)
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
