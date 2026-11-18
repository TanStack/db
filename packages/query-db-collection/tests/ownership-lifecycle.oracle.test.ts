/**
 * # Which observer lease owns a Query row?
 *
 * A row stays public while any active committed observer lease needs it.
 * Reacquiring a demand starts a new lease that a delayed old release cannot
 * retire. Publication and hydration must not copy released leases back.
 * Direct delete ends the fetched lifetime; a new direct insert has no inferred
 * subset owner. Physical fetch starts and accepted direct writes order values
 * per key; releasing a newer owner cannot revert a continuously owned value.
 * Authority: Query guide, Direct Writes and Query Sync; Query cache staleness
 * and refetch rules; the original ownership oracle's documented lease laws.
 *
 * Five independent models retain only authored claims, causal positions or
 * successful lease results. The complete finite grammars preserve all 101
 * prior histories without reducing a generated-run budget. Real QueryClient,
 * Collection, metadata and dehydrate/hydrate paths record the original cuts.
 * Native SQLite and arbitrary transport retries are separate receiving paths.
 */
import { hashKey } from '@tanstack/query-core'
import {
  DbClient,
  IR,
  collectionOptions,
  createCollection,
  createTransaction,
  eq,
  getLoadSubsetDemandKey,
} from '@tanstack/db'
import { afterEach, vi } from 'vitest'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property.js'

import { createDeferred } from '../../db/src/deferred.js'
import {
  compileSingleRowExpression,
  toBooleanPredicate,
} from '../../db/src/query/compiler/evaluators.js'
import { queryCollectionOptions } from '../src/query.js'
import {
  categorySubset,
  cleanups,
  createOwnershipFixture,
  createQueryClient,
  persistedOwners,
  rows,
  runCleanups,
  shared,
} from './ownership-lifecycle-support.js'
import type { Observation, Verdict } from '../../db/tests/oracle-property.js'
import type { Item, MetadataRecorder } from './ownership-lifecycle-support.js'
import type { LoadSubsetOptions } from '@tanstack/db'
import type { QueryFunctionContext } from '@tanstack/query-core'

afterEach(runCleanups)
type RecordFact = (checkpoint: string, value: unknown) => void

/** Wait for a production boundary without computing an expected row. If the
 * boundary does not arrive, record the last fact and return; the property's
 * check identifies that cut rather than losing the mismatch to a setup error. */
async function boundary(test: () => boolean): Promise<boolean> {
  for (let turn = 0; turn < 200; turn++) {
    if (test()) return true
    await new Promise<void>((resolve) => setTimeout(resolve, 5))
  }
  return test()
}

/** Domain checks retain every observation cut in the old driver. No expected
 * value is recorded by a production callback: models build the owed facts
 * from authored history data, and this check compares the ordered trace. */
function checkCuts(
  actual: ReadonlyArray<Observation>,
  expected: ReadonlyArray<Observation>,
  law: string,
): Verdict {
  for (let i = 0; i < expected.length; i++) {
    const wanted = expected[i]!
    const got = actual[i]
    if (!got)
      return violation(
        wanted.checkpoint,
        'the promised observation cut was not reached',
        law,
      )
    const difference = differs(wanted.checkpoint, law, got, wanted)
    if (difference) return difference
  }
  return differs('trace-length', law, actual.length, expected.length) ?? pass
}
const solo: Item = { id: `solo`, category: `detail`, name: `Solo` }

type ReacquisitionHistory = {
  /** `Infinity`: reacquisition starts no fetch. `0`: it starts a refetch. */
  staleTime: number
  /** The refetch outcome. It has no effect when no refetch starts. */
  refetch: `rejects` | `same-rows` | `empty`
  /** The refetch settles before or after the older release publishes. */
  settles: `while-held` | `after-publication`
  /** Peer leases that also own `shared` until after the refetch. */
  peers: 0 | 1 | 2
  /** Rows in the reacquired lease's result; the second is owned only here. */
  rows: 1 | 2
}

type ReacquisitionObservation = {
  /** Public rows after reacquisition, while publication is still held. */
  held: Array<string>
  /** Public rows after the held transactions publish. */
  published: Array<string>
  /** Public rows after the refetch, if any, has settled. */
  settled: Array<string>
  /** Public rows after every peer is released. */
  peerReleased: Array<string>
  /** Public rows after the reacquired demand is released. */
  released: Array<string>
  /** Query function calls. Query staleness decides this count. */
  queryCalls: number
}

/**
 * The model keeps each active lease's latest successful result. Public
 * synced rows are the union of those results at the last publication. Each
 * peer's result is always `shared`; peers are active until `peerReleased`.
 * A peer hides a lost `shared` until the peers leave, which is why that
 * checkpoint exists; the lease-only `solo` row shows a loss at once. While the optimistic blocker
 * holds publication, the public view is the blocker plus the rows published
 * before the release, which the first lease owned. The model does not
 * represent tombstones, ownership maps, or sync transactions.
 */
const modelReacquisition = (
  history: ReacquisitionHistory,
): ReacquisitionObservation => {
  const cached = history.rows === 2 ? [shared.id, solo.id] : [shared.id]
  const refetchStarts = history.staleTime === 0
  const refetched = !refetchStarts
    ? cached
    : history.refetch === `empty`
      ? []
      : // Both a same-rows result and a failed refetch leave the rows owned.
        cached
  const union = (...results: Array<Array<string>>) =>
    [...new Set(results.flat())].sort()
  const peerRows = history.peers > 0 ? [shared.id] : []
  return {
    held: union([`blocker`], cached, peerRows),
    published: union(
      history.settles === `while-held` ? refetched : cached,
      peerRows,
    ),
    settled: union(refetched, peerRows),
    peerReleased: union(refetched),
    released: [],
    queryCalls: 1 + history.peers + (refetchStarts ? 1 : 0),
  }
}

/**
 * The grammar crosses the refetch's start, outcome, and placement relative to
 * the older release's publication. A fresh reacquisition starts no refetch,
 * so it has one history. The `empty` histories reject a design that keeps the
 * row for any reacquired demand. The `rejects` and `same-rows` histories
 * that settle after publication reject a design that skips the cached
 * result because the older lease left an ownership entry behind. Removing
 * the already-applied guard altogether also passes this table; the
 * persisted direct-write histories that keep an accepted write through a
 * refetch start reject that repair. A repair that treats every empty
 * ownership entry as unapplied also passes this table; the sibling history
 * that keeps a direct insert through a refetch start of an empty result
 * rejects it. Each history runs with zero, one, or two peers and with a
 * one- or two-row result. With a peer, the older release keeps `shared`,
 * so only the `peerReleased` checkpoint shows whether the reacquired lease
 * owns it. On the original defect `shared` survives while a peer owns it
 * and disappears when the peers leave, while `solo` disappears at
 * publication. Two peers check that releasing every other owner, not just
 * one, leaves the reacquired lease as the row's owner.
 */
const reacquisitionHistories: Array<ReacquisitionHistory> = (
  [0, 1, 2] as const
).flatMap((peers) =>
  ([1, 2] as const).flatMap((resultRows) => [
    {
      staleTime: Number.POSITIVE_INFINITY,
      refetch: `rejects` as const,
      settles: `after-publication` as const,
      peers,
      rows: resultRows,
    },
    ...([`rejects`, `same-rows`, `empty`] as const).flatMap((refetch) =>
      ([`while-held`, `after-publication`] as const).map((settles) => ({
        staleTime: 0,
        refetch,
        settles,
        peers,
        rows: resultRows,
      })),
    ),
  ]),
)

/**
 * ## Published owners never name a released observer lease
 *
 * Law: each publication records, for each row, the observer leases that own
 * it. A released lease is not an owner, even while its release waits behind
 * held publication. A later lease that claims the row during that wait
 * must not copy the released lease back into the row's owners from metadata
 * that has not yet published the release. A hydrated client trusts those
 * owners: a row stays public there while any recorded owner may still need
 * it, so a stale owner keeps the row alive after its last real owner is
 * released.
 *
 * Authority: the file's opening law (a row remains public while any committed
 * owner needs it), and the hydration history above, which releases a
 * hydrated demand and expects its rows to leave. The reacquisition table
 * above changes how a released lease's ownership entry is read; this table
 * keeps a repair from simply deleting that entry at release.
 *
 * Limits: one row, one released lease `a`, one claiming lease `b`, and an
 * optional peer lease `c` that is never released. `a` may be reacquired
 * without cached data before `b` claims the row; its fetch then fails, so
 * the reacquired lease never applies a result. Hydration uses the public
 * `DbClient.dehydrate` and `hydrate` paths with a fresh QueryClient. Native
 * persistence and cold persisted scans are owned by the persisted histories.
 */
type PublishedOwnerHistory = {
  /** `b` claims the row while `a`'s release is held, or after it publishes. */
  claims: `while-held` | `after-publication`
  /** Whether peer `c` also owns the row and stays acquired. */
  peer: boolean
  /** Whether `a` is reacquired without cached data and its fetch fails. */
  reacquired: boolean
}

type PublishedOwnerObservation = {
  /** Owner edges for the row in the dehydrated state. Keys are opaque. */
  dehydratedOwners: number
  /** Public rows in the hydrated client after it acquires `b`. */
  hydratedLoaded: Array<string>
  /** Public rows in the hydrated client after it releases `b`. */
  hydratedReleased: Array<string>
}

/**
 * The model records the set of active leases whose result holds the row. A
 * release removes its lease at once, regardless of publication. Hydration
 * copies that set; after the hydrated client releases `b`, the row stays
 * exactly when another recorded owner remains. Publication timing is absent
 * from the model, because the law says it cannot change the owner set.
 */
const modelPublishedOwners = (
  history: PublishedOwnerHistory,
): PublishedOwnerObservation => {
  const activeOwners = new Set([`a`, ...(history.peer ? [`c`] : [])])
  activeOwners.delete(`a`)
  activeOwners.add(`b`)
  const afterHydratedRelease = new Set(activeOwners)
  afterHydratedRelease.delete(`b`)
  return {
    dehydratedOwners: activeOwners.size,
    hydratedLoaded: [shared.id],
    hydratedReleased: afterHydratedRelease.size > 0 ? [shared.id] : [],
  }
}

/**
 * `while-held` reaches the premise: `b`'s sync transaction reads row
 * metadata that still names `a`. `after-publication` is the nearby boundary
 * where the release has published first. The peer histories require `c` to
 * remain an owner, so a repair that drops every metadata owner at release,
 * or one that ignores recorded owners on hydration, fails them. A repair that
 * deletes the released lease's ownership entry at release instead of keeping
 * it until publication fails the `while-held` histories. Without a peer, it
 * fails at both the owner count and the leaked hydrated row; with a peer,
 * `c` keeps the row public, so only the owner count distinguishes it.
 *
 * The `reacquired` histories reject a repair that deletes the released
 * entry when the Query is reacquired. The reacquired lease has no result
 * yet, so `b` reads metadata naming `a` while `a` looks unresolved and
 * copies it back. A later result for `a` would correct the edge, so `a`'s
 * fetch fails and it never applies one. The model is unchanged: a lease
 * without a successful result owns nothing.
 */
const publishedOwnerHistories: Array<PublishedOwnerHistory> = (
  [`while-held`, `after-publication`] as const
).flatMap((claims) =>
  [false, true].flatMap((peer) =>
    [false, true].map((reacquired) => ({ claims, peer, reacquired })),
  ),
)

/** The old complete finite grammar is retained: 42 reacquisitions and eight
 * dehydrate/hydrate histories. Neither family had a generated-run budget or
 * literal reach table to retire. Publication holds and row observations are
 * the original real QueryClient cuts, now judged by the framework check. */
oracleProperty({
  id: 'query-db.ownership.reacquisition',
  law: {
    statement:
      'A reacquired observer lease owns the current successful result until its own release; a delayed release of an older lease cannot retire it.',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync and the documented Query stale/refetch behavior.',
    limits:
      'One released/reacquired on-demand demand, one/two rows, zero/two peer leases and an unrelated publication blocker; no native persistence.',
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: reacquisitionHistories,
  label: (h) =>
    JSON.stringify(h, (_key, value) =>
      value === Infinity ? 'Infinity' : value,
    ),
  model: modelReacquisition,
  driver: async (history, observe) => {
    try {
      const id = `reacquired-lease-${history.staleTime}-${history.refetch}-${history.settles}-${history.peers}-${history.rows}`
      const detail = categorySubset(`detail`)
      const peerSubsets = [
        categorySubset(`list`),
        {
          where: new IR.Func(`in`, [
            new IR.PropRef([`category`]),
            new IR.Value([`peer`, `shared`]),
          ]),
        },
      ].slice(0, history.peers)
      const leaseResult = history.rows === 2 ? [shared, solo] : [shared]
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const refetch = createDeferred<Array<Item>>()
      void refetch.promise.catch(() => undefined)
      const { collection, queryFn } = createOwnershipFixture({
        id,
        results: [leaseResult, ...peerSubsets.map(() => [shared])],
        staleTime: history.staleTime,
      })
      queryFn.mockImplementationOnce(() => refetch.promise)
      const settleRefetch = () => {
        if (history.refetch === `rejects`)
          refetch.reject(new Error(`refetch failed`))
        else
          refetch.resolve(
            history.refetch === `empty`
              ? []
              : leaseResult.map((item) => ({ ...item })),
          )
      }
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })

      await collection._sync.loadSubset(detail)
      for (const peer of peerSubsets) await collection._sync.loadSubset(peer)
      mutation.mutate(() => collection.insert(blocker))
      cleanups.push(async () => {
        persistence.resolve()
        refetch.reject(new Error(`cleanup`))
        await mutation.when(`settled`).catch(() => undefined)
      })

      // The release's sync transaction is accepted but held behind the blocker.
      const pendingBefore = collection._state.pendingSyncedTransactions.length
      collection._sync.unloadSubset(detail)
      const accepted = await boundary(
        () =>
          collection._state.pendingSyncedTransactions.length > pendingBefore,
      )
      observe('release-accepted', {
        before: pendingBefore,
        after: collection._state.pendingSyncedTransactions.length,
      })
      if (!accepted) return
      const reacquired = Promise.resolve(collection._sync.loadSubset(detail))
      void reacquired.catch(() => undefined)
      await settleTurn()
      observe('held', rows(collection))

      if (history.settles === `while-held`) {
        settleRefetch()
        await settleTurn()
      }
      persistence.resolve()
      await mutation.when(`settled`)
      await settleTurn()
      observe('published', rows(collection))

      if (history.settles === `after-publication`) {
        settleRefetch()
        await settleTurn()
      }
      await reacquired.catch(() => undefined)
      observe('settled', rows(collection))

      for (const peer of peerSubsets) {
        collection._sync.unloadSubset(peer)
        await settleTurn()
      }
      observe('peerReleased', rows(collection))

      collection._sync.unloadSubset(detail)
      await settleTurn()

      observe('released', rows(collection))
      observe('queryCalls', queryFn.mock.calls.length)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) => {
    const release = trace[0]
    if (release?.checkpoint !== 'release-accepted')
      return violation(
        'release-accepted',
        'release acceptance not observed',
        'lease ownership',
      )
    const counts = release.value as { before: number; after: number }
    if (!(counts.after > counts.before))
      return violation(
        'release-accepted',
        'the held release did not enter the accepted sync queue',
        'lease ownership',
      )
    return checkCuts(
      trace.slice(1),
      Object.entries(expected).map(([checkpoint, value]) => ({
        checkpoint,
        value,
      })),
      'lease ownership',
    )
  },
})

oracleProperty({
  id: 'query-db.ownership.published-owners',
  law: {
    statement:
      'Publication records only active leases with successful results; hydration cannot resurrect a released owner.',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync; DbClient dehydrate/hydrate row-ownership contract.',
    limits:
      'One released lease, one claimant and optional surviving peer; the reacquired original fetch may reject. Native SQLite is a separate receiving path.',
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: publishedOwnerHistories,
  model: modelPublishedOwners,
  driver: async (history, observe) => {
    try {
      const id = `published-owners-${history.claims}-${history.peer}-${history.reacquired}`
      const subset = (category: string): LoadSubsetOptions => ({
        where: new IR.Func(`in`, [
          new IR.PropRef([`category`]),
          new IR.Value([category, `shared`]),
        ]),
      })
      const [a, b, c] = [subset(`a`), subset(`b`), subset(`c`)]
      // Query keys embed the subset as JSON, so `a`'s key holds `\"a\"`.
      const isQueryForA = (queryKey: unknown) =>
        JSON.stringify(queryKey).includes(`\\"a\\"`)
      const reacquiredFetch = createDeferred<Array<Item>>()
      void reacquiredFetch.promise.catch(() => undefined)
      const createClient = (
        queryFn: (context: QueryFunctionContext) => Promise<Array<Item>> = () =>
          Promise.resolve([shared]),
      ) => {
        const queryClient = createQueryClient()
        const descriptor = collectionOptions(
          queryCollectionOptions<Item>({
            id,
            queryClient,
            queryKey: [id],
            queryFn,
            getKey: (item) => item.id,
            syncMode: `on-demand`,
            startSync: true,
          }),
        )
        const client = new DbClient({ queryClient })
        cleanups.push(async () => {
          await client.cleanup()
          queryClient.clear()
        })
        return {
          client,
          queryClient,
          collection: client.collection(descriptor),
        }
      }
      const settleTurn = async () => {
        for (let turn = 0; turn < 3; turn++)
          await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }

      let fetchesForA = 0
      const server = createClient(({ queryKey }) => {
        if (isQueryForA(queryKey) && fetchesForA++ > 0)
          return reacquiredFetch.promise
        return Promise.resolve([shared])
      })
      const blocker = { id: `blocker`, category: `local`, name: `Blocker` }
      const persistence = createDeferred<void>()
      const mutation = createTransaction({
        mutationFn: () => persistence.promise,
      })
      cleanups.push(async () => {
        persistence.resolve()
        reacquiredFetch.reject(new Error(`cleanup`))
        await mutation.when(`settled`).catch(() => undefined)
      })

      await server.collection._sync.loadSubset(a)
      if (history.peer) await server.collection._sync.loadSubset(c)
      mutation.mutate(() => server.collection.insert(blocker))
      server.collection._sync.unloadSubset(a)
      let reacquired: Promise<unknown> | undefined
      if (history.reacquired) {
        await settleTurn()
        server.queryClient.removeQueries({
          predicate: (query) => isQueryForA(query.queryKey),
        })
        reacquired = Promise.resolve(server.collection._sync.loadSubset(a))
        void reacquired.catch(() => undefined)
        await settleTurn()
      }
      const failReacquiredFetch = async () => {
        const pending = reacquired
        if (!pending) return
        reacquiredFetch.reject(new Error(`reacquired fetch failed`))
        await pending.catch(() => undefined)
        await settleTurn()
      }
      if (history.claims === `while-held`) {
        const claimed = Promise.resolve(server.collection._sync.loadSubset(b))
        await settleTurn()
        await failReacquiredFetch()
        persistence.resolve()
        await mutation.when(`settled`)
        await claimed
      } else {
        persistence.resolve()
        await mutation.when(`settled`)
        await settleTurn()
        await server.collection._sync.loadSubset(b)
        await failReacquiredFetch()
      }
      await settleTurn()
      const state = server.client.dehydrate({
        shouldDehydrateCollection: () => true,
      })
      const sharedRow = state.collections
        .flatMap((chunk) => chunk.rows)
        .find((row) => row.key === shared.id)
      const owners = (
        sharedRow?.metadata as
          { queryCollection?: { owners?: Record<string, true> } } | undefined
      )?.queryCollection?.owners

      const browser = createClient()
      browser.client.hydrate(state)
      await browser.collection._sync.loadSubset(b)
      observe('hydratedLoaded', rows(browser.collection))
      browser.collection._sync.unloadSubset(b)
      await settleTurn()

      observe('dehydratedOwners', Object.keys(owners ?? {}).length)
      observe('hydratedReleased', rows(browser.collection))
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(
      trace,
      [
        { checkpoint: 'hydratedLoaded', value: expected.hydratedLoaded },
        { checkpoint: 'dehydratedOwners', value: expected.dehydratedOwners },
        { checkpoint: 'hydratedReleased', value: expected.hydratedReleased },
      ],
      'published owners',
    ),
})

/** Row lifetime laws from Query guide Direct Writes and Query Sync. A delete
 * ends all fetched claims; a later insert/upsert starts an unowned lifetime.
 * Each action below is authored by the finite history, independent of cache
 * events, Collection membership and production commit timing. */
type LifetimeHistory = {
  ownerCount: 1 | 2
  withMetadata: boolean
  history:
    | 'update'
    | 'delete'
    | 'delete-insert'
    | 'delete-upsert'
    | 'delete-insert-refetch'
}
const lifetimeId = (h: LifetimeHistory) =>
  `direct-row-lifetime-${h.ownerCount}-${h.withMetadata}-${h.history}`
const lifetimeHistories: Array<LifetimeHistory> = ([1, 2] as const).flatMap(
  (ownerCount) =>
    [false, true].flatMap((withMetadata) =>
      (
        [
          'update',
          'delete',
          'delete-insert',
          'delete-upsert',
          'delete-insert-refetch',
        ] as const
      ).map((history) => ({ ownerCount, withMetadata, history })),
    ),
)
function lifetimeModel(h: LifetimeHistory): Array<Observation> {
  const expected: Array<Observation> = []
  const demands = [categorySubset('detail'), categorySubset('list')].slice(
    0,
    h.ownerCount,
  )
  // This is only the documented exact Query-key representation. Claim lifetime
  // is decided by the independent set of authored demand indices below.
  const hashes = demands.map((d) =>
    hashKey([lifetimeId(h), getLoadSubsetDemandKey(d)]),
  )
  const claims = new Set<number>()
  let name: string | undefined
  let direct = false
  const row = () =>
    expected.push({
      checkpoint: `row:${expected.length}`,
      value: {
        name,
        rows: name ? [shared.id] : [],
        ...(h.withMetadata
          ? { owners: [...claims].map((i) => hashes[i]!).sort() }
          : {}),
      },
    })
  for (let i = 0; i < h.ownerCount; i++) {
    claims.add(i)
    name = shared.name
    row()
  }
  if (h.history === 'update') {
    name = 'Updated'
    row()
  } else {
    name = undefined
    claims.clear()
    row()
    if (h.history !== 'delete') {
      name = 'Reinserted'
      direct = true
      row()
    }
  }
  if (h.history === 'delete-insert-refetch') {
    for (let i = 0; i < h.ownerCount; i++) claims.add(i)
    name = 'Server result'
    direct = false
    row()
  }
  for (let i = 0; i < h.ownerCount; i++) {
    claims.delete(i)
    if (claims.size === 0 && !direct) name = undefined
    row()
  }
  expected.push({
    checkpoint: 'queryCalls',
    value: h.ownerCount * (h.history === 'delete-insert-refetch' ? 2 : 1),
  })
  return expected
}

/** Fetch-start and accepted direct-write positions are authored actions. Cache
 * edits invalidate evidence but create no physical fetch position. Comparing
 * the two positions yields the authority at acquisition and after release. */
type DirectOrderHistory = {
  order: 'write-first' | 'fetch-first'
  laterWrite: 'none' | 'same-key' | 'other-key'
  cacheEdit: boolean
  finalRefetch: boolean
}
const directOrderHistories: Array<DirectOrderHistory> = (
  ['write-first', 'fetch-first'] as const
).flatMap((order) =>
  (['none', 'same-key', 'other-key'] as const).flatMap((laterWrite) =>
    [false, true].flatMap((cacheEdit) =>
      [false, true].map((finalRefetch) => ({
        order,
        laterWrite,
        cacheEdit,
        finalRefetch,
      })),
    ),
  ),
)
function directOrderModel(h: DirectOrderHistory): Array<Observation> {
  let position = 0
  let directX: { value: string; position: number } | undefined
  let remoteX: { value: string; position: number } | undefined
  if (h.order === 'write-first')
    directX = { value: 'Written', position: ++position }
  remoteX = { value: 'Server 1', position: ++position }
  if (h.order === 'fetch-first')
    directX = { value: 'Written', position: ++position }
  if (h.laterWrite === 'same-key')
    directX = { value: 'Later write', position: ++position }
  if (h.laterWrite === 'other-key') position++
  if (h.finalRefetch) remoteX = { value: 'Server 2', position: ++position }
  const revalidated = h.cacheEdit && !h.finalRefetch
  if (revalidated) remoteX = { value: 'Server 2', position: ++position }
  if (!directX) throw Error('Illegal authored direct-write history')
  const remoteMayReplace = remoteX.position > directX.position
  return [
    {
      checkpoint: 'acquisition-work',
      value: {
        before: 1 + Number(h.finalRefetch),
        after: 1 + Number(h.finalRefetch) + Number(revalidated),
      },
    },
    {
      checkpoint: 'acquired',
      value: {
        x: remoteMayReplace ? remoteX.value : directX.value,
        y:
          h.laterWrite === 'other-key' && !h.finalRefetch && !revalidated
            ? 'Other write'
            : undefined,
      },
    },
    {
      checkpoint: 'released',
      value: remoteMayReplace ? undefined : directX.value,
    },
  ]
}

/** A complete finite overlap grammar retains the original seven histories.
 * Started positions order accepted values, while independent claim indices
 * decide presence. Reacquisition starts a new row lifetime from its own cache. */
type OverlapHistory = {
  existingOwner: boolean
  settleNewerFirst: boolean
  directWrite: 'none' | 'between' | 'after'
  sameValue: boolean
}
const overlapHistories: Array<OverlapHistory> = [
  ...[false, true].flatMap((existingOwner) =>
    [false, true].map((settleNewerFirst) => ({
      existingOwner,
      settleNewerFirst,
      directWrite: 'none' as const,
      sameValue: false,
    })),
  ),
  {
    existingOwner: true,
    settleNewerFirst: true,
    directWrite: 'none',
    sameValue: true,
  },
  {
    existingOwner: true,
    settleNewerFirst: true,
    directWrite: 'between',
    sameValue: false,
  },
  {
    existingOwner: true,
    settleNewerFirst: true,
    directWrite: 'after',
    sameValue: false,
  },
]
function overlapModel(h: OverlapHistory): Array<Observation> {
  const expected: Array<Observation> = [
    {
      checkpoint: 'scope-admission',
      value: {
        distinct: true,
        initialMatchesOlder: true,
        olderMatchesOlder: true,
        newerMatchesNewer: true,
      },
    },
  ]
  let position = 0
  let acceptedAt = 0
  let value: string | undefined
  const owners = new Set<'older' | 'newer'>()
  let rowIndex = 0
  const row = () =>
    expected.push({
      checkpoint: `row:${rowIndex++}`,
      value: {
        name: owners.size > 0 ? value : undefined,
        present: owners.size > 0,
      },
    })
  const fetch = (owner: 'older' | 'newer', started: number, name: string) => {
    owners.add(owner)
    if (started > acceptedAt) {
      acceptedAt = started
      value = name
    }
  }
  const write = () => {
    value = 'Manual'
    acceptedAt = ++position
    row()
  }
  if (h.existingOwner) {
    fetch('older', ++position, 'Initial')
    row()
  }
  const older = ++position
  expected.push({
    checkpoint: 'older-started',
    value: h.existingOwner ? 2 : 1,
  })
  if (h.directWrite === 'between') write()
  const newer = ++position
  expected.push(
    { checkpoint: 'newer-started', value: h.existingOwner ? 3 : 2 },
    { checkpoint: 'physical-queries', value: 2 },
  )
  if (h.directWrite === 'after') write()
  const settle = (owner: 'older' | 'newer') => {
    fetch(
      owner,
      owner === 'older' ? older : newer,
      owner === 'older' ? 'Older' : h.sameValue ? 'Initial' : 'Newer',
    )
    row()
  }
  if (h.settleNewerFirst) {
    settle('newer')
    settle('older')
  } else {
    settle('older')
    settle('newer')
  }
  const release = (owner: 'older' | 'newer') => {
    owners.delete(owner)
    row()
  }
  if (h.existingOwner) {
    release('older')
    release('newer')
  } else {
    release('newer')
    release('older')
  }
  if (!h.existingOwner && h.settleNewerFirst && h.directWrite === 'none') {
    owners.add('older')
    value = 'Older'
    row()
    expected.push({ checkpoint: 'older-reacquired-work', value: 2 })
    owners.delete('older')
    row()
    owners.add('newer')
    value = h.sameValue ? 'Initial' : 'Newer'
    row()
    expected.push({ checkpoint: 'newer-reacquired-work', value: 2 })
  }
  return expected
}

async function runDirectRowLifetimeHistory(
  { ownerCount, withMetadata, history }: LifetimeHistory,
  observe: RecordFact,
): Promise<void> {
  const id = `direct-row-lifetime-${ownerCount}-${withMetadata}-${history}`
  const replacement = { ...shared, name: `Reinserted` }
  const serverReplacement = { ...shared, name: `Server result` }
  const initialResults = Array.from({ length: ownerCount }, () => [shared])
  const laterResults = Array.from({ length: ownerCount }, () => [
    serverReplacement,
  ])
  const metadata: MetadataRecorder = { rows: new Map(), writes: [] }
  const { collection, queryFn } = createOwnershipFixture({
    id,
    results: [...initialResults, ...laterResults],
    metadataRecorder: withMetadata ? metadata : undefined,
  })
  const demands = [categorySubset(`detail`), categorySubset(`list`)].slice(
    0,
    ownerCount,
  )
  let cut = 0
  const recordRow = () =>
    observe('row:' + cut++, {
      name: collection.get(shared.id)?.name,
      rows: rows(collection),
      ...(withMetadata
        ? {
            owners: persistedOwners(
              collection._state.syncedMetadata,
              shared.id,
            ),
          }
        : {}),
    })
  for (const demand of demands) {
    await collection._sync.loadSubset(demand)
    recordRow()
  }
  if (history === `update`) {
    await collection.utils.writeUpdate({ id: shared.id, name: `Updated` })
    recordRow()
  } else {
    await collection.utils.writeDelete(shared.id)
    recordRow()
    if (history !== `delete`) {
      if (history === `delete-upsert`)
        await collection.utils.writeUpsert(replacement)
      else await collection.utils.writeInsert(replacement)
      recordRow()
    }
  }
  if (history === `delete-insert-refetch`) {
    await collection.utils.refetch()
    recordRow()
  }
  for (const demand of demands) {
    collection._sync.unloadSubset(demand)
    recordRow()
  }
  observe('queryCalls', queryFn.mock.calls.length)
}

async function runDirectWriteOrderHistory(
  { order, laterWrite, cacheEdit, finalRefetch }: DirectOrderHistory,
  observe: RecordFact,
): Promise<void> {
  type Row = { id: string; name: string }
  const queryClient = createQueryClient()
  const queryKey = [`shared-post-write-cached-before-acquisition`]
  let requestNumber = 0
  const queryFn = vi.fn(() =>
    Promise.resolve([
      {
        id: `x`,
        name: ++requestNumber === 1 ? `Server 1` : `Server 2`,
      },
    ]),
  )
  const makeCollection = (id: string) =>
    createCollection(
      queryCollectionOptions<Row>({
        id,
        queryClient,
        queryKey,
        queryFn,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        staleTime: Infinity,
        startSync: true,
      }),
    )
  const a = makeCollection(`cached-newer-a`)
  const b = makeCollection(`cached-newer-b`)
  cleanups.push(async () => {
    await Promise.all([a.cleanup(), b.cleanup()])
    queryClient.clear()
  })
  const writeX = async (name: string) => {
    if (a.has(`x`)) await a.utils.writeUpdate({ id: `x`, name })
    else await a.utils.writeInsert({ id: `x`, name })
  }
  const fetchB = async (first: boolean) => {
    if (first) await b._sync.loadSubset({})
    else await b.utils.refetch({ throwOnError: true })
  }
  if (order === `write-first`) await writeX(`Written`)
  await fetchB(true)
  if (order === `fetch-first`) await writeX(`Written`)
  if (laterWrite === `same-key`) await writeX(`Later write`)
  if (laterWrite === `other-key`) {
    await a.utils.writeInsert({ id: `y`, name: `Other write` })
  }
  if (cacheEdit) {
    queryClient.setQueryData(queryKey, [{ id: `x`, name: `Local cache edit` }])
  }
  if (finalRefetch) await fetchB(false)
  const callsBeforeAcquisition = queryFn.mock.calls.length
  await a._sync.loadSubset({})
  observe('acquisition-work', {
    before: callsBeforeAcquisition,
    after: queryFn.mock.calls.length,
  })
  observe('acquired', { x: a.get('x')?.name, y: a.get('y')?.name })
  a._sync.unloadSubset({})
  observe('released', a.get('x')?.name)
}

async function runOverlappingSubsetHistory(
  { existingOwner, settleNewerFirst, directWrite, sameValue }: OverlapHistory,
  observe: RecordFact,
): Promise<void> {
  const id = `overlapping-fetch-value-${existingOwner}-${settleNewerFirst}-${directWrite}-${sameValue}`
  const older = createDeferred<Array<Item>>()
  const newer = createDeferred<Array<Item>>()
  const initial = { ...shared, name: `Initial` }
  const olderRow = { ...shared, name: `Older` }
  const newerRow = { ...shared, name: sameValue ? `Initial` : `Newer` }
  const manual = { ...shared, name: `Manual` }
  const { collection, queryClient, queryFn } = createOwnershipFixture({
    id,
    results: existingOwner
      ? [[initial], older.promise, newer.promise]
      : [older.promise, newer.promise],
  })
  cleanups.push(() => {
    older.resolve([olderRow])
    newer.resolve([newerRow])
    return Promise.resolve()
  })
  const olderSubset = { where: eq(new IR.PropRef([`category`]), `shared`) }
  const newerSubset = { where: eq(new IR.PropRef([`id`]), `shared`) }
  observe('scope-admission', {
    distinct:
      getLoadSubsetDemandKey(olderSubset) !==
      getLoadSubsetDemandKey(newerSubset),
    initialMatchesOlder: toBooleanPredicate(
      compileSingleRowExpression(olderSubset.where)(initial),
    ),
    olderMatchesOlder: toBooleanPredicate(
      compileSingleRowExpression(olderSubset.where)(olderRow),
    ),
    newerMatchesNewer: toBooleanPredicate(
      compileSingleRowExpression(newerSubset.where)(newerRow),
    ),
  })
  let cut = 0
  const recordRow = () =>
    observe('row:' + cut++, {
      name: collection.get(shared.id)?.name,
      present: collection.has(shared.id),
    })
  if (existingOwner) {
    await collection._sync.loadSubset(olderSubset)
    recordRow()
  }
  const olderLoad = collection._sync.loadSubset(
    existingOwner ? { ...olderSubset, refetch: true } : olderSubset,
  )
  void Promise.resolve(olderLoad).catch(() => undefined)
  const olderStarted = await boundary(
    () => queryFn.mock.calls.length === (existingOwner ? 2 : 1),
  )
  observe('older-started', queryFn.mock.calls.length)
  if (!olderStarted) return

  if (directWrite === `between`) {
    await collection.utils.writeUpdate(manual)
    recordRow()
  }
  const newerLoad = collection._sync.loadSubset(newerSubset)
  void Promise.resolve(newerLoad).catch(() => undefined)
  const newerStarted = await boundary(
    () => queryFn.mock.calls.length === (existingOwner ? 3 : 2),
  )
  observe('newer-started', queryFn.mock.calls.length)
  if (!newerStarted) return
  observe(
    'physical-queries',
    queryClient.getQueryCache().findAll({ queryKey: [id] }).length,
  )
  if (directWrite === `after`) {
    await collection.utils.writeUpdate(manual)
    recordRow()
  }

  const settle = async (owner: `older` | `newer`) => {
    if (owner === `older`) {
      older.resolve([olderRow])
      await olderLoad
    } else {
      newer.resolve([newerRow])
      await newerLoad
    }
    recordRow()
  }
  if (settleNewerFirst) {
    await settle(`newer`)
    await settle(`older`)
  } else {
    await settle(`older`)
    await settle(`newer`)
  }

  const release = (owner: `older` | `newer`) => {
    const subset = owner === `older` ? olderSubset : newerSubset
    collection._sync.unloadSubset(subset)
    if (owner === `older` && existingOwner)
      collection._sync.unloadSubset(subset)
    recordRow()
  }
  if (existingOwner) {
    release(`older`)
    release(`newer`)
  } else {
    release(`newer`)
    release(`older`)
  }

  // Reacquisition starts a new row-ownership lifetime. Only the acquired
  // Query's retained cache is projected; an earlier overlap does not
  // permanently rewrite a different Query entry. This legal neighbor
  // distinguishes continuous-owner precedence from global precedence.
  if (!existingOwner && settleNewerFirst && directWrite === `none`) {
    await collection._sync.loadSubset(olderSubset)
    recordRow()
    observe('older-reacquired-work', queryFn.mock.calls.length)
    collection._sync.unloadSubset(olderSubset)
    recordRow()
    await collection._sync.loadSubset(newerSubset)
    recordRow()
    observe('newer-reacquired-work', queryFn.mock.calls.length)
  }
}

/** The extraction retains all 20 lifetime, 24 cross-Collection order, and
 * seven overlap histories. The driver emits only Collection/cache/work facts;
 * models compute all expectations from authored actions before the check. */
oracleProperty({
  id: 'query-db.ownership.direct-lifetime',
  law: {
    statement:
      'Direct delete ends fetched ownership; reinsert/upsert starts an unowned lifetime, while update preserves existing claims.',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync',
    limits:
      'One key, one/two subset claims, optional metadata, and the five documented direct lifetime operations.',
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: lifetimeHistories,
  model: lifetimeModel,
  driver: async (h, observe) => {
    try {
      await runDirectRowLifetimeHistory(h, observe)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'direct row lifetime'),
})
oracleProperty({
  id: 'query-db.ownership.direct-order',
  law: {
    statement:
      'A later physical fetch may replace and claim a direct row; an earlier fetch or foreign cache edit cannot establish newer source authority.',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync',
    limits:
      'Two on-demand Collections share one exact Query; one extra same/other key write, optional cache edit and final refetch.',
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: directOrderHistories,
  model: directOrderModel,
  driver: async (h, observe) => {
    try {
      await runDirectWriteOrderHistory(h, observe)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'direct fetch order'),
})
oracleProperty({
  id: 'query-db.ownership.overlap',
  law: {
    statement:
      'Continuously owned overlapping rows take the latest started accepted fetch or direct write; releasing a newer owner does not revert their values.',
    authority:
      'docs/collections/query-collection.md#direct-writes-and-query-sync',
    limits:
      'Two exact predicates, one shared key, seven legal histories with both settlement orders, matching value, and neighboring direct-write positions.',
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: overlapHistories,
  model: overlapModel,
  driver: async (h, observe) => {
    try {
      await runOverlappingSubsetHistory(h, observe)
    } finally {
      await runCleanups()
    }
  },
  check: (_h, trace, expected) =>
    checkCuts(trace, expected, 'overlapping fetch values'),
})
