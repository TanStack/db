/** Query receiving path for shared persisted-startup conformance.
 * The real QueryClient supplies fetch, initialData, and cached success results.
 * Only this driver knows Query hashes, row metadata, and fetching premises.
 * The shared model and comparison own replacement, peer survival and durability.
 */
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import {
  sortedStartupRows,
  startupRows,
  withStartupRender,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import {
  startupInitialRender,
  trackStartupSync,
  untilStartup,
} from '../../db-adapter-conformance/tests/persisted-startup-driver'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import type {
  PersistedStartupHistory,
  StartupRow,
  StartupSnapshot,
} from '../../db-adapter-conformance/src/persisted-startup-oracle'
import type { PersistedStartupAdapter } from '../../db-adapter-conformance/tests/persisted-startup-driver'

export type QueryStartupHistory = PersistedStartupHistory & {
  origin:
    | `fetch`
    | `initial-disabled`
    | `initial-pending`
    | `cached-disabled`
    | `cached-pending`
}
const baseQueryStartupHistories: Array<QueryStartupHistory> = [
  {
    origin: `fetch`,
    previous: 1,
    next: 2,
    peer: false,
    response: `before-restore`,
  },
  {
    origin: `fetch`,
    previous: 1,
    next: 0,
    peer: false,
    response: `before-restore`,
  },
  {
    origin: `fetch`,
    previous: 3,
    next: 6,
    peer: true,
    response: `before-restore`,
  },
  {
    origin: `fetch`,
    previous: 3,
    next: 6,
    peer: false,
    response: `after-restore`,
  },
  {
    origin: `initial-disabled`,
    previous: 1,
    next: 2,
    peer: false,
    response: `before-restore`,
  },
  {
    origin: `initial-pending`,
    previous: 3,
    next: 6,
    peer: true,
    response: `before-restore`,
  },
  {
    origin: `cached-disabled`,
    previous: 1,
    next: 0,
    peer: false,
    response: `before-restore`,
  },
  {
    origin: `cached-pending`,
    previous: 3,
    next: 6,
    peer: true,
    response: `before-restore`,
  },
]

export const queryStartupHistories = baseQueryStartupHistories.flatMap((h) => [
  h,
  withStartupRender(h, true, false),
  ...(h.origin === `fetch` ? [withStartupRender(h, true, true)] : []),
])

type QueryMetadata =
  { queryCollection?: { owners?: Record<string, true> } } | undefined
const owners = (metadata: unknown, id: string) =>
  Object.keys((metadata as QueryMetadata)?.queryCollection?.owners ?? {})
    .map((owner) => (owner === hashKey([id]) ? `source` : owner))
    .sort()

export const queryStartupAdapter: PersistedStartupAdapter<QueryStartupHistory> =
  {
    scope: `scoped`,
    seedMetadata: (h, id, row) => ({
      queryCollection: {
        owners: {
          [hashKey([id])]: true,
          ...(h.peer && row.id === startupRows(h.previous, 1)[0]!.id
            ? { peer: true }
            : {}),
        },
      },
    }),
    owners,
    async create(persistence, h, id) {
      let releaseResponse!: () => void
      const response = new Promise<void>((resolve) => {
        releaseResponse = resolve
      })
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            gcTime: Infinity,
            staleTime: Infinity,
          },
        },
      })
      const pending = h.origin.endsWith(`pending`)
      const disabled = h.origin.endsWith(`disabled`)
      if (h.origin.startsWith(`cached`))
        await client.fetchQuery({
          queryKey: [id],
          queryFn: () => Promise.resolve(startupRows(h.next, 2)),
        })
      const fetch = { completed: false, calls: 0 }
      const unsubscribe = client.getQueryCache().subscribe((event) => {
        if (event.type === `updated` && event.action.type === `success`)
          fetch.completed = true
      })
      const options = queryCollectionOptions<StartupRow>({
        id,
        queryKey: [id],
        queryClient: client,
        getKey: (row) => row.id,
        enabled: !disabled,
        staleTime: pending ? 0 : Infinity,
        ...(h.origin.startsWith(`initial`)
          ? { initialData: startupRows(h.next, 2) }
          : {}),
        queryFn: async () => {
          fetch.calls++
          if (pending || h.response !== `before-restore`) await response
          return startupRows(h.next, 2)
        },
      })
      const startup = trackStartupSync(options.sync)
      const collection = createCollection(
        persistedCollectionOptions({
          ...options,
          sync: startup.sync,
          ...startupInitialRender(h),
          persistence,
        }),
      )
      const snapshot = (): StartupSnapshot => ({
        rows: sortedStartupRows(collection.values()),
        owners: [...collection.keys()]
          .sort()
          .map((key) => [
            String(key),
            owners(collection._state.syncedMetadata.get(key), id),
          ]),
      })
      return {
        collection,
        initialResult: startup.initialResult,
        snapshot,
        deliver: async () => {
          if (h.origin === `fetch`) {
            if (h.response !== `before-restore`) releaseResponse()
            await untilStartup(() => fetch.completed)
          }
        },
        responseAvailable: () =>
          h.origin === `fetch`
            ? fetch.completed
            : client.getQueryData([id]) !== undefined,
        checkStartup: () => {
          const violations: Array<string> = []
          if (fetch.calls !== (disabled ? 0 : 1))
            violations.push(`startup fetch count did not match ${h.origin}`)
          if (
            (client.getQueryState([id])?.fetchStatus === `fetching`) !==
            pending
          )
            violations.push(`pending fetch premise did not match ${h.origin}`)
          return violations
        },
        refresh: () => {
          releaseResponse()
          return collection.utils.refetch()
        },
        dispose: () =>
          withOracleCleanup(async () => {}, [
            releaseResponse,
            unsubscribe,
            () => collection.cleanup(),
            () => client.clear(),
          ]),
      }
    },
  }
