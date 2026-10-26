import { LiveQueryObserverDisposedError } from './errors.js'

/** The local-restore boundary of one opted-in persisted Collection. */
export type PersistedReadinessSnapshot =
  | { status: `loading`; error?: never }
  | { status: `ready`; error?: never }
  | { status: `error`; error: unknown }

/** @internal Capability supplied by a persistence adapter, not by core sync. */
export interface PersistedReadinessSource {
  /** Time to prefer network before a completed persisted restore may render. */
  networkTimeoutMs: number
  /**
   * An on-demand source restores per demand and waits inside each load, so
   * it permits local rendering once the query's demands on it have settled.
   */
  onDemand: boolean
  /** Anchor the deadline to this Collection's current sync run. */
  getOrStartNetworkDeadline: () => number
  getSnapshot: () => PersistedReadinessSnapshot
  subscribe: (listener: () => void) => () => void
  /**
   * The network-first initial-render wait, normally
   * `waitForPersistedInitialRender`. A persistence adapter supplies it with
   * its readiness, so an app with no persisted Collection does not ship it.
   */
  waitForInitialRender: typeof waitForPersistedInitialRender
}

/** A client query stream, as the initial-render wait reads it. */
interface InitialRenderClientQuery {
  status: string
  error?: unknown
  promise?: Promise<unknown>
}

/** @internal What a live query observer passes to the initial-render wait. */
export interface PersistedInitialRenderInput {
  sources: ReadonlyArray<{
    collection: { status: string }
    readiness: PersistedReadinessSource
  }>
  /** The network preload that this render prefers. */
  network: Promise<void>
  /** The client query stream at the start of the wait, if any. */
  clientQuery: InitialRenderClientQuery | undefined
  /** The client query stream now, for a failed stream's identity. */
  currentClientQuery: () => unknown
  /** The live query Collection's status now. */
  collectionStatus: () => string | undefined
  readPersisted: () => { status: string; error: unknown }
  /**
   * Whether every source permits local rendering: an eager source after its
   * deadline, an on-demand source once the query's demands on it settle.
   */
  localRenderPermitted: () => boolean
  /** Recheck when an on-demand source's demands settle. */
  subscribeDemandSettlement: (listener: () => void) => () => void
  /** Runs once the render may proceed, before the promise resolves. */
  onReady: () => void
}

/**
 * Resolve when network data is ready, or when the network deadline passes or
 * the network fails while every persisted source has restored. Reject with
 * the network error when no persisted fallback may render.
 */
export function waitForPersistedInitialRender({
  sources,
  network,
  clientQuery,
  currentClientQuery,
  collectionStatus,
  readPersisted,
  localRenderPermitted,
  subscribeDemandSettlement,
  onReady,
}: PersistedInitialRenderInput): {
  promise: Promise<void>
  cancel: () => void
} {
  const clientStream =
    clientQuery?.promise === network ? clientQuery : undefined
  const unsubscribers: Array<() => void> = []
  let cancel!: () => void
  let timer: ReturnType<typeof setTimeout> | undefined
  const initialRender = new Promise<void>((resolve, reject) => {
    let networkReady = false
    // React can start a new observer after the client stream has failed.
    let failedClientStream =
      clientQuery?.status === `error` ? clientQuery : undefined
    let networkFailed = failedClientStream !== undefined
    let networkError: unknown = failedClientStream?.error
    let settled = false
    const finish = (failure?: { error: unknown }) => {
      if (settled) return
      settled = true
      if (failure) reject(failure.error)
      else {
        onReady()
        resolve()
      }
    }
    cancel = () => finish({ error: new LiveQueryObserverDisposedError() })
    const check = () => {
      if (settled) return
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      if (networkReady) {
        finish()
        return
      }
      const persisted = readPersisted()
      // An on-demand source waits inside each load, so only eager sources
      // contribute a deadline here.
      const networkDeadlineAt = Math.max(
        ...sources.map((source) =>
          source.readiness.onDemand
            ? -Infinity
            : source.readiness.getOrStartNetworkDeadline(),
        ),
      )
      const remainingNetworkMs = Math.max(0, networkDeadlineAt - Date.now())
      // A pending on-demand demand rechecks when its demands settle.
      const localRenderAllowed =
        remainingNetworkMs === 0 && localRenderPermitted()
      const sourceFailed = sources.some(
        (source) => source.collection.status === `error`,
      )
      const clientStreamFailed =
        failedClientStream !== undefined &&
        currentClientQuery() === failedClientStream
      if (
        networkFailed &&
        !sourceFailed &&
        (collectionStatus() === `error` || !clientStreamFailed)
      ) {
        finish({ error: networkError })
      } else if (
        (localRenderAllowed || networkFailed) &&
        persisted.status === `ready`
      ) {
        finish()
      } else if (networkFailed && persisted.status === `error`) {
        finish({ error: networkError ?? persisted.error })
      } else if (remainingNetworkMs > 0 && !networkFailed) {
        timer = setTimeout(check, remainingNetworkMs)
      }
    }
    for (const source of sources) {
      unsubscribers.push(source.readiness.subscribe(check))
    }
    unsubscribers.push(subscribeDemandSettlement(check))
    void network.then(
      () => {
        networkReady = true
        check()
      },
      (error) => {
        networkFailed = true
        networkError = error
        failedClientStream =
          clientStream?.status === `error` ? clientStream : undefined
        check()
      },
    )
    check()
  })
  const promise = initialRender.finally(() => {
    unsubscribers.forEach((unsubscribe) => unsubscribe())
    if (timer !== undefined) clearTimeout(timer)
  })
  return { promise, cancel }
}

/** @internal Config capability shared with first-party persistence adapters. */
export const PERSISTED_READINESS = Symbol.for(`@tanstack/db.persistedReadiness`)

export function getPersistedReadinessSource(
  config: object,
): PersistedReadinessSource | undefined {
  return (config as { [PERSISTED_READINESS]?: PersistedReadinessSource })[
    PERSISTED_READINESS
  ]
}
