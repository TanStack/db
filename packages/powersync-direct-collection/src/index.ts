import { createSubsetHandlers } from './subsets'
import type { GetSubscriptions } from './subsets'
import type {
  CollectionConfig,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'
import type {
  ConfirmWritesOptions,
  PowerSyncClient,
  StreamError,
  StreamLease,
  StreamSubscription,
  TableChanges,
} from '@powersync/standalone-client'

export type { GetSubscriptions } from './subsets'
export type { LoadSubsetOptions } from '@tanstack/db'
export {
  PowerSyncClient,
  StreamError,
  UnexpectedResponseError,
  type ConfirmWritesOptions,
  type PowerSyncClientOptions,
  type StreamLease,
  type StreamLeaseOptions,
  type StreamSubscription,
  type SyncStatus,
  type TableChanges,
  type TableListener,
} from '@powersync/standalone-client'

interface BaseCollectionOptions<T extends { id: string }> {
  id?: string
  client: PowerSyncClient
  /**
   * The table to include in this collection.
   *
   * Typically, one uses a single collection per table (with subsets determining the Sync Streams and parameters to
   * subscribe to).
   *
   * When multiple collections on the same client use the same table, all synced rows of that table are included.
   */
  table: string
  /** Decode and validate PowerSync's JSON values into application values. */
  parse: (row: Record<string, unknown>) => T
  onInsert?: CollectionConfig<
    T,
    string,
    never,
    PowerSyncCollectionUtils
  >['onInsert']
  onUpdate?: CollectionConfig<
    T,
    string,
    never,
    PowerSyncCollectionUtils
  >['onUpdate']
  onDelete?: CollectionConfig<
    T,
    string,
    never,
    PowerSyncCollectionUtils
  >['onDelete']
}

export type PowerSyncCollectionOptions<T extends { id: string }> =
  BaseCollectionOptions<T> &
    (
      | {
          /** Query-driven subscriptions; this is the default when getSubscriptions is provided. */
          syncMode?: 'on-demand'
          getSubscriptions: GetSubscriptions
          streams?: never
        }
      | {
          /**
           * Streams to request while the collection is syncing, with all query filtering performed locally. May be
           * empty when rows for this table are synced through other collections or default streams.
           */
          syncMode?: 'eager'
          streams?: ReadonlyArray<StreamSubscription>
          /**
           * Whether to also request Sync Streams marked as `auto_subscribe: true` in the Sync Config.
           *
           * Defaults to false.
           */
          includeDefaultStreams?: boolean
          getSubscriptions?: never
        }
    )

export type PowerSyncCollectionUtils = {
  /**
   * Call after the app's backend write commits.
   *
   * This requests a checkpoint from the PowerSync service. As this happens _after_ the write has made it into the
   * source database, PowerSync can determine when data including the write has synced back down.
   *
   * This waits for the checkpoint to be requested _and_ to have been downloaded, validated and applied locally.
   * Awaiting this in an `onInsert`, `onUpdate` or `onDelete` callback ensures the optimistic state is replaced with
   * confirmed data without flickering.
   */
  confirmWrites: (options?: ConfirmWritesOptions) => Promise<void>
}

type PowerSyncConfig<T extends { id: string }> = CollectionConfig<
  T,
  string,
  never,
  PowerSyncCollectionUtils
> & {
  utils: PowerSyncCollectionUtils
}

export function powerSyncCollectionOptions<T extends { id: string }>(
  options: PowerSyncCollectionOptions<T>,
): PowerSyncConfig<T> {
  const { client } = options
  const onDemand = options.getSubscriptions !== undefined
  const sync: SyncConfig<T, string> = {
    rowUpdateMode: 'full',
    sync: ({
      begin,
      write,
      commit,
      markReady,
      reportError,
      reportHealthy,
      fail,
      truncate,
      collection,
    }) => {
      const controller = new AbortController()
      let first = true
      // An eager sync run shows no rows until its streams have synced: the
      // client may still hold rows from an earlier run. A run without streams
      // has nothing to wait for and shows the rows the client already holds.
      let synced = onDemand
      let active = true
      let lastApplied: SyncAppliedReceipt = true
      let unlisten = () => {}
      let unsubscribeStatus = () => {}
      let lease: StreamLease | undefined
      let subsets: ReturnType<typeof createSubsetHandlers> | undefined
      // The open failure of each source: the connection, and each lease. A
      // source shows its first failure until it recovers; later failures of
      // the same outage do not replace it.
      let connectionError: Error | undefined
      const streamErrors = new Map<StreamLease, StreamError>()

      const cleanup = () => {
        if (!active) return
        active = false
        controller.abort()
        unsubscribeStatus()
        subsets?.cleanup()
        lease?.release()
        unlisten()
      }
      const stop = (error: Error) => {
        if (!active) return
        cleanup()
        fail(error)
      }
      // The client retries failed connections: before the first ready the
      // collection keeps loading, and after it the outage is reported.
      const onConnectionError = (error: Error) => {
        if (!active || collection.status !== 'ready' || connectionError) return
        connectionError = error
        reportError(error)
      }
      // A stream error lasts until a reconnect with other parameters, so it
      // fails the first load. After it, the rows stay and it is reported.
      const onStreamError = (source: StreamLease, error: StreamError) => {
        if (!active) return
        if (collection.status !== 'ready') return stop(error)
        streamErrors.set(source, error)
        reportError(error)
      }
      const clearStreamError = (source: StreamLease) => {
        const previous = streamErrors.get(source)
        if (!active || !previous) return
        streamErrors.delete(source)
        reportHealthy(previous)
      }
      // The client enters `ready` when a full checkpoint is applied after
      // (re)connecting, and each lease's `waitForSync()` then settles at once
      // with that checkpoint's stream errors. A checkpoint is a successful
      // delivery for this collection once none of its streams fail.
      const onCheckpointApplied = () => {
        if (!active || client.status.state !== 'ready') return
        const sources = new Set(streamErrors.keys())
        if (lease) sources.add(lease)
        Promise.all(
          [...sources].map((source) =>
            source.waitForSync().then(() => clearStreamError(source)),
          ),
        ).then(
          () => {
            if (!active || !connectionError) return
            reportHealthy(connectionError)
            connectionError = undefined
          },
          // A stream that still fails keeps its failure, and the outage.
          () => {},
        )
      }
      const onChanges = (changes: TableChanges) => {
        if (!active || !synced) return
        // Changes are only delivered once, so rows that cannot be applied
        // leave the collection out of sync for good.
        try {
          applyChanges(changes)
        } catch (error) {
          stop(error instanceof Error ? error : new Error(String(error)))
        }
      }
      const applyChanges = (changes: TableChanges) => {
        const writes = [...changes].map(([id, row]) => {
          if (row == null) return { type: 'delete' as const, key: id }
          const value = options.parse({ ...row, id })
          if (value.id !== id)
            throw new Error('parse must preserve the PowerSync row id')
          return { type: 'update' as const, value }
        })
        if (!first && !writes.length) return
        begin()
        // The initial snapshot replaces earlier rows, readiness is tracked separately.
        if (first) truncate({ markReady: false })
        for (const operation of writes) write(operation)
        const applied = commit(controller.signal)
        lastApplied = applied
        first = false
        // Never block ingestion on application: TanStack can hold this receipt
        // behind a mutation handler which is itself waiting for confirmWrites().
        if (applied !== true) {
          applied.then(undefined, (cause) =>
            stop(cause instanceof Error ? cause : new Error(String(cause))),
          )
        }
      }

      // Delivers the current rows synchronously, so a parse error may already
      // have stopped the run when this returns.
      unlisten = client.listen(options.table, {
        onChanges,
        onError: onConnectionError,
      })
      if (controller.signal.aborted) {
        unlisten()
        return
      }
      unsubscribeStatus = client.subscribeStatus(onCheckpointApplied)
      if (onDemand) {
        subsets = createSubsetHandlers(
          client,
          options.getSubscriptions,
          () => lastApplied,
          { onError: onStreamError, onRelease: clearStreamError },
        )
      } else {
        const eager = client.acquireStreams(options.streams ?? [], {
          onError: (error) => onStreamError(eager, error),
          includeDefaultStreams: options.includeDefaultStreams ?? false,
        })
        lease = eager
      }

      if (lease) {
        lease.waitForSync(controller.signal).then(
          async () => {
            if (controller.signal.aborted) return
            synced = true
            // The changes until now were skipped, so read the whole table.
            onChanges(client.tableSnapshot(options.table))
            await lastApplied
            if (active) markReady()
          },
          // Stream errors are reported through the lease, cancellation needs no handling.
          () => {},
        )
      } else {
        // Readiness for on-demand data is tracked by each loadSubset promise.
        // Starting the collection itself requires no remote table snapshot.
        markReady()
      }

      return subsets
        ? {
            loadSubset: subsets.loadSubset,
            unloadSubset: subsets.unloadSubset,
            cleanup,
          }
        : cleanup
    },
  }

  return {
    id: options.id,
    syncMode: onDemand ? 'on-demand' : 'eager',
    getKey: (row) => row.id,
    onInsert: options.onInsert,
    onUpdate: options.onUpdate,
    onDelete: options.onDelete,
    utils: { confirmWrites: client.confirmWrites.bind(client) },
    sync,
  }
}
