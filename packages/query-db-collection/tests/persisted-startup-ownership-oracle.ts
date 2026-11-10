/**
 * A complete Query result replaces that Query's persisted ownership, including
 * rows whose persisted restore has not published yet. Other owners survive.
 * Authority: docs/collections/query-collection.md, "Direct Writes and Query
 * Sync" (a successful fetch reconciles ownership), and the ownership lifecycle
 * oracle. Complete initialData/cache responses have the same materialization
 * authority ("Initial Data" and "How Query Collections Work"). Persistence
 * changes neither that judgment nor its durable result. Startup work also
 * follows reload-class-oracle's one-row-read law; that model is shared below.
 *
 * This is a dimension of the ownership oracle, not a new ownership policy.
 * The model is set replacement: remove the old Query edge, add the response's
 * edges, and keep rows with another owner. It has no Query cache or hydration
 * machinery. A peer is a persisted owner that this run has not revalidated.
 *
 * Histories use nonempty prior subsets of three keys, any next subset (including
 * empty), optional peer ownership of the first prior key, and response delivery
 * before or after restore. Complete initialData and cached responses are
 * already available before restore, with fetching disabled or held pending.
 * Values change on overlapping keys. Removing timing
 * loses the reported race; removing overlap misses stale values; removing peers
 * admits truncation. Duplicate keys and a response-before-fetch are excluded.
 *
 * The shared driver runs through persistedCollectionOptions and real QueryClient.
 * A host holds the first baseline read, before its rows reach the wrapper. Query
 * cache success proves response delivery while the hold remains active. Public
 * rows and durable rows/owners are compared immediately after preload, before
 * refetch can repair storage, and again inside/after refetch's fulfillment.
 * The work recorder counts full row reads before its observation's own read. A final local-only reopen checks durable removal independently.
 * Node SQLite and Chromium OPFS supply the same driver and comparison. This
 * does not cover on-demand windows, multi-tab writes, or failed SQLite I/O.
 */
import { QueryClient, hashKey } from '@tanstack/query-core'
import { createCollection } from '@tanstack/db'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { persistedCollectionOptions } from '../../db-sqlite-persistence-core/src'
import { queryCollectionOptions } from '../src/query'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { expectedEagerRowScans } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import type { PersistedCollectionPersistence } from '../../db-sqlite-persistence-core/src'
import type { HeldCall } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'

export function isStartupRowRead(sql: string): boolean {
  return sql
    .replace(/\s+/g, ` `)
    .trim()
    .startsWith(`SELECT key, value, metadata, row_version FROM`)
}

export class StartupOwnershipViolationError extends Error {
  constructor(readonly violations: Array<string>) {
    super(violations.join(`\n`))
    this.name = `StartupOwnershipViolationError`
  }
}

export type StartupOwnershipHistory = {
  origin:
    | `fetch`
    | `initial-disabled`
    | `initial-pending`
    | `cached-disabled`
    | `cached-pending`
  previous: number
  next: number
  peer: boolean
  response: `before-restore` | `after-restore`
}
type Row = { id: string; value: number }
type Snapshot = { rows: Array<Row>; owners: Array<[string, Array<string>]> }
export type StartupOwnershipObservation = {
  responseBeforeRestore: boolean
  startupRowReads: number
  startupFetches: number
  pendingFetchAtStartup: boolean
  startupDurable: Snapshot
  startup: Snapshot
  refetch: Snapshot
  durable: Snapshot
  reopened: Array<Row>
}

const rows = (mask: number, value: number): Array<Row> =>
  [`a`, `b`, `c`].flatMap((id, index) =>
    mask & (1 << index) ? [{ id, value }] : [],
  )
const sorted = (values: Iterable<Row>): Array<Row> =>
  Array.from(values, ({ id, value }) => ({ id, value })).sort((a, b) =>
    a.id.localeCompare(b.id),
  )

export function expectedStartupOwnership(h: StartupOwnershipHistory): Snapshot {
  const next = new Map(rows(h.next, 2).map((row) => [row.id, row]))
  const peerKey = h.peer ? rows(h.previous, 1)[0]!.id : undefined
  if (peerKey && !next.has(peerKey))
    next.set(peerKey, { id: peerKey, value: 1 })
  return {
    rows: sorted(next.values()),
    owners: [...next.keys()]
      .sort()
      .map((key) => [
        key,
        [
          ...(rows(h.next, 2).some((row) => row.id === key) ? [`query`] : []),
          ...(key === peerKey ? [`peer`] : []),
        ].sort(),
      ]),
  }
}

// Each captured cut is checked before cleanup can throw. The final receiver
// comparison reuses the same judgment; no fixed history carries an answer.
export function startupOwnershipCutViolations(
  h: StartupOwnershipHistory,
  cut: string,
  actual: Snapshot,
): Array<string> {
  const expected = expectedStartupOwnership(h)
  return JSON.stringify(actual) === JSON.stringify(expected)
    ? []
    : [
        `${cut}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      ]
}

export function startupOwnershipPremiseViolations(
  h: StartupOwnershipHistory,
  observation: Pick<
    StartupOwnershipObservation,
    | `responseBeforeRestore`
    | `startupRowReads`
    | `startupFetches`
    | `pendingFetchAtStartup`
  >,
): Array<string> {
  const violations: Array<string> = []
  if (observation.responseBeforeRestore !== (h.response === `before-restore`))
    violations.push(`response/restore premise was not reached`)
  const expectedReads = expectedEagerRowScans(1, 0)
  if (observation.startupRowReads !== expectedReads)
    violations.push(
      `startup row reads: expected ${expectedReads}, got ${observation.startupRowReads}`,
    )
  const disabled = h.origin.endsWith(`disabled`)
  if (observation.startupFetches !== (disabled ? 0 : 1))
    violations.push(`startup fetch count did not match ${h.origin}`)
  if (observation.pendingFetchAtStartup !== h.origin.endsWith(`pending`))
    violations.push(`pending fetch premise did not match ${h.origin}`)
  return violations
}

export function startupOwnershipViolations(
  h: StartupOwnershipHistory,
  observation: StartupOwnershipObservation,
): Array<string> {
  const violations = startupOwnershipPremiseViolations(h, observation)
  for (const cut of [
    `startup`,
    `startupDurable`,
    `refetch`,
    `durable`,
  ] as const)
    violations.push(...startupOwnershipCutViolations(h, cut, observation[cut]))
  const expected = expectedStartupOwnership(h)
  if (JSON.stringify(observation.reopened) !== JSON.stringify(expected.rows))
    violations.push(
      `reopen: expected ${JSON.stringify(expected.rows)}, got ${JSON.stringify(observation.reopened)}`,
    )
  return violations
}

export const startupOwnershipHistories: Array<StartupOwnershipHistory> = [
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

const turn = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
async function until(premise: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 2_000; attempt++) {
    if (premise()) return
    await turn()
  }
  throw new Error(`Startup ownership driver did not reach its premise`)
}

export async function observeStartupOwnership(
  persistence: PersistedCollectionPersistence,
  holdBaseline: (id: string) => HeldCall,
  h: StartupOwnershipHistory,
  id: string,
  readRowCount: () => number,
  onStartup: () => void = () => {},
): Promise<StartupOwnershipObservation> {
  const queryHash = hashKey([id])
  const peerKey = h.peer ? rows(h.previous, 1)[0]!.id : undefined
  // Seed a valid durable row/owner snapshot through the public sync boundary.
  const seed = createCollection(
    persistedCollectionOptions<Row, string>({
      id,
      getKey: (row) => row.id,
      persistence,
      sync: {
        sync: ({ begin, write, metadata, commit, markReady }) => {
          begin()
          for (const row of rows(h.previous, 1)) {
            write({ type: `insert`, value: row })
            metadata!.row.set(row.id, {
              queryCollection: {
                owners: {
                  [queryHash]: true,
                  ...(row.id === peerKey ? { peer: true } : {}),
                },
              },
            })
          }
          commit()
          markReady()
        },
      },
    }),
  )
  await seed.preload()
  await seed.cleanup()

  const initialReadCount = readRowCount()
  const hold = holdBaseline(id)
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
  const pendingOrigin = h.origin.endsWith(`pending`)
  const disabledOrigin = h.origin.endsWith(`disabled`)
  if (h.origin.startsWith(`cached`))
    await client.fetchQuery({
      queryKey: [id],
      queryFn: () => Promise.resolve(rows(h.next, 2)),
    })
  const fetch = { completed: false, calls: 0 }
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type === `updated` && event.action.type === `success`)
      fetch.completed = true
  })
  const collection = createCollection(
    persistedCollectionOptions({
      ...queryCollectionOptions<Row>({
        id,
        queryKey: [id],
        queryClient: client,
        getKey: (row) => row.id,
        enabled: !disabledOrigin,
        staleTime: pendingOrigin ? 0 : Infinity,
        ...(h.origin.startsWith(`initial`)
          ? { initialData: rows(h.next, 2) }
          : {}),
        queryFn: async () => {
          fetch.calls++
          if (pendingOrigin || h.response === `after-restore`) await response
          return rows(h.next, 2)
        },
      }),
      persistence,
    }),
  )
  const snapshot = (): Snapshot => ({
    rows: sorted(collection.values()),
    owners: [...collection.keys()].sort().map((key) => {
      const metadata = collection._state.syncedMetadata.get(key) as
        { queryCollection?: { owners?: Record<string, true> } } | undefined
      return [
        String(key),
        Object.keys(metadata?.queryCollection?.owners ?? {})
          .map((owner) => (owner === queryHash ? `query` : owner))
          .sort(),
      ]
    }),
  })
  const assertCut = (cut: string, actual: Snapshot) => {
    const violations = startupOwnershipCutViolations(h, cut, actual)
    if (violations.length) throw new StartupOwnershipViolationError(violations)
  }
  const durableSnapshot = async (): Promise<Snapshot> => {
    const stored = await persistence.adapter.loadResumeSnapshot(
      { kind: `eager`, collectionId: id },
      { includeRows: true },
    )
    return {
      rows: sorted(stored.rows.map((row) => row.value as Row)),
      owners: [...stored.rows]
        .sort((a, b) => String(a.key).localeCompare(String(b.key)))
        .map((row) => [
          String(row.key),
          Object.keys(
            (
              row.metadata as
                | { queryCollection?: { owners?: Record<string, true> } }
                | undefined
            )?.queryCollection?.owners ?? {},
          )
            .map((owner) => (owner === queryHash ? `query` : owner))
            .sort(),
        ]),
    }
  }
  return withOracleCleanup(async () => {
    const ready = collection.preload()
    await until(hold.isHeld)
    if (h.response === `before-restore` && h.origin === `fetch`)
      await until(() => fetch.completed)
    await turn()
    const responseAvailable =
      h.origin === `fetch`
        ? fetch.completed
        : client.getQueryData([id]) !== undefined
    const responseBeforeRestore = responseAvailable && hold.isHeld()
    hold.release()
    if (h.response === `after-restore`) {
      await until(() => collection.size > 0)
      releaseResponse()
    }
    await ready
    const startup = snapshot()
    if (responseBeforeRestore !== (h.response === `before-restore`))
      throw new Error(`Startup response/restore premise was not reached`)
    onStartup()
    assertCut(`startup`, startup)
    // Count startup work before the observation's own durable read.
    const startupRowReads = readRowCount() - initialReadCount
    const startupFetches = fetch.calls
    const pendingFetchAtStartup =
      client.getQueryState([id])?.fetchStatus === `fetching`
    const premiseViolations = startupOwnershipPremiseViolations(h, {
      responseBeforeRestore,
      startupRowReads,
      startupFetches,
      pendingFetchAtStartup,
    })
    if (premiseViolations.length)
      throw new StartupOwnershipViolationError(premiseViolations)
    const startupDurable = await durableSnapshot()
    assertCut(`startupDurable`, startupDurable)
    releaseResponse()
    const refetch = await collection.utils.refetch().then(() => {
      const captured = snapshot()
      assertCut(`refetch`, captured)
      return captured
    })
    const durable = await durableSnapshot()
    assertCut(`durable`, durable)
    await collection.cleanup()
    const reopened = createCollection(
      persistedCollectionOptions<Row, string>({
        id,
        getKey: (row) => row.id,
        persistence,
      }),
    )
    return withOracleCleanup(async () => {
      await reopened.preload()
      const observation: StartupOwnershipObservation = {
        responseBeforeRestore,
        startupRowReads,
        startupFetches,
        pendingFetchAtStartup,
        startup,
        startupDurable,
        refetch,
        durable,
        reopened: sorted(reopened.values()),
      }
      const violations = startupOwnershipViolations(h, observation)
      if (violations.length)
        throw new StartupOwnershipViolationError(violations)
      return observation
    }, [() => reopened.cleanup()])
  }, [
    () => hold.uninstall(),
    releaseResponse,
    unsubscribe,
    () => collection.cleanup(),
    () => client.clear(),
  ])
}

declareOracle({
  model: [expectedStartupOwnership],
  check: [
    startupOwnershipCutViolations,
    startupOwnershipPremiseViolations,
    startupOwnershipViolations,
  ],
})
