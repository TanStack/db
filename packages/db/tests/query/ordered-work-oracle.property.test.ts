import { isDeepStrictEqual } from 'node:util'
import { fc } from '@fast-check/vitest'
import { afterAll, afterEach, beforeEach, describe, expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gte, isUndefined, not } from '../../src/query/builder/functions.js'
import {
  isGeneratedOracleCampaign,
  oracleFixedSeed,
  oracleProperty,
  oracleReplayRequested,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import {
  compareAt,
  observeComparison,
  recordedComparison,
  rejectAt,
} from './ordered-comparison-oracle.js'
import { receiveOrderedCompilerCacheHistory } from './ordered-compiler-cache-driver.js'
import { receiveOrderedJoinedPlanHistory } from './ordered-joined-plan-driver.js'
import {
  compareRows,
  expectDistinctRequests,
  expectInitialWindows,
  expectNoProviderStart,
  expectRawWindow,
  requestFingerprint,
  rowsForScenario,
} from './ordered-work-support.js'
import { copiedRow } from './ordered-work-fixtures.js'
import {
  FULL_JOIN_SEED,
  MAX_OPTIMISTIC_WINDOW_REQUESTS,
  OPTIMISTIC_ACQUISITION_OBSERVATION_TURNS,
  boundaryRanks,
  copyOptimisticWindowPublication,
  eagerCase,
  eagerFullJoinCase,
  eagerHeldCase,
  eagerJoinedCase,
  eagerJoinedGapCase,
  eagerOrder,
  eagerProvenReportCase,
  eagerWindow,
  exhaustiveScenarios,
  expectEagerWindow,
  fillerRows,
  isJoinedFilter,
  optimisticWindowViolations,
  prefixLeavesWindowShort,
  referenceOptimisticWindow,
  scenarioArbitrary,
} from './ordered-work-model-oracle.js'
import type { Marker, Row, Scenario } from './ordered-work-support.js'
import type {
  EagerCase,
  EagerCommand,
  OptimisticWindowCase,
  OptimisticWindowExtent,
  OptimisticWindowObservation,
  OptimisticWindowPublication,
} from './ordered-work-model-oracle.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { Observation } from '../oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

/**
 * # Does ordered acquisition do only the work its result requires?
 *
 * Row truth and work truth are different laws. An ordered query must match an
 * independent filter/sort/window recomputation. It must also avoid duplicate
 * finite requests, partial initial publications, and cross-source suppression
 * when joined loads overlap or replay.
 * `pagination-oracle.property.test.ts` owns general ordered-window rows and
 * publication.
 * This file checks rows again at eager indexed and joined work cuts so a work
 * bound cannot pass by dropping required rows.
 * Direct LEFT-joined filters require a finite indexed root prefix, settlement
 * of child demand before continuation, and one complete initial publication.
 * Custom collation uses one full-source request, while an unindexed underfilled
 * prefix falls back to full source. Both must wait for joined demand before
 * publishing an anti-join result.
 * Demand for a separate include cannot hold the ordered root continuation.
 * An empty joined replay still wakes held Effect deltas.
 * An initial Effect with skipInitial waits for joined demand before it starts
 * publishing callbacks. Only joined-source readiness rechecks that demand.
 * If another source changes an ordered source during Effect startup, the
 * buffered change still invalidates its settled prefix before callbacks run.
 * A window move started during existing joined demand waits for its later root
 * refill and publication. Joined demand cannot discard a repair continuation.
 * The authority is `packages/db/src/query/live/ARCHITECTURE.md`, especially
 * "Ordered requests, continuation, and recovery", "Atomic window publication",
 * and the initial-readiness law. This owner checks the local, controlled
 * adapter boundary for these laws. It does not establish provider collation,
 * remote relation-hint evaluation, or arbitrary source scheduling.
 *
 * The value model is a plain sorted array. The work recorder captures normalized
 * request shapes with and without order hints, graph schedules, publications,
 * and errors.
 * Live Collections and Effects receive the same scenario and must agree with
 * each other and the model. Exhaustive small domains cover ties, eligibility,
 * direction, and middle-row count; generated runs vary the same grammar.
 * The driver starts a real live-query Collection or Effect over controlled
 * source Collections. It compares complete public rows and callback-visible
 * publications after initial preload/demand settlement and after each named
 * mutation or repair checkpoint. Adapter requests and work counts are separate
 * observations; they are not public rows or evidence of remote provider work.
 *
 * Counts are contract bounds, not timing benchmarks. They check established
 * request and graph-scheduling behavior only where the test names that promise.
 * These scenarios exercise local evaluation; they do not model a remote adapter
 * applying a relation hint.
 */

// A joined filter's marker in the eager harness. `rowId` is the join key,
// matched against a root row's `link`; `key` identifies the marker.
type JoinMarker = { key: number; rowId: number }
// Result-row ids at or above this name a matched (root row, marker) pair.
const PAIR_ID = 1_000_000

type JoinFilter = `two-alias` | `joined-only` | `some` | `none` | `to-one`

// These recorder categories describe only the presence of adapter orderBy.
// With-order combines indexed pages and unindexed prefixes. Without-order
// combines tie-boundary requests and filtered or unfiltered full-source loads;
// it does not describe the local query order.
type RequestObservation = {
  kind: `with-order` | `without-order`
  key: string | undefined
  fingerprint: string
  hasCursor: boolean
  limit: number | undefined
  offset: number | undefined
  lastKey: string | number | undefined
}

type ConsumerObservation = {
  rows: Array<Row>
  requests: Array<RequestObservation>
  compareRequestTrace: boolean
  publications: Array<Array<Row>>
  errors: Array<string>
  live: boolean
}

function matchesJoinFilter(row: Row, joinFilter: JoinFilter): boolean {
  return joinFilter === `none` ? !row.eligible : row.eligible
}

let harnessId = 0

async function observeConsumer(
  kind: `collection` | `effect`,
  scenario: Scenario,
  joinFilter: JoinFilter = `two-alias`,
  delayJoinedDemand = false,
  removeJoinedMarker = false,
  loadingMode: `indexed` | `unindexed` | `custom` = `indexed`,
): Promise<ConsumerObservation> {
  type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const truth = rowsForScenario(scenario).sort(compareRows(scenario.direction))
  const sourceSize = truth.length
  // The reference evaluates relation existence from authoritative marker
  // membership. It does not use the compiler's predicate classifier.
  const matchingTruth = truth.filter((row) =>
    matchesJoinFilter(row, joinFilter),
  )
  const rowToDelete =
    !removeJoinedMarker &&
    matchingTruth.length >= 3 &&
    matchingTruth[0]!.rank !== matchingTruth[1]!.rank
      ? matchingTruth[0]
      : undefined
  const delivered = new Set<number>()
  const requests: Array<RequestObservation> = []
  const errors: Array<string> = []
  const effectRows = new Map<number, Row>()
  const joinedLoadGate = createDeferred<void>()
  let joinedRequests = 0
  const deliveredMarkers = new Set<number>()
  let sync!: Sync
  let markerSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]

  const apply = async (rows: ReadonlyArray<Row>) => {
    const fresh = rows.filter((row) => !delivered.has(row.id))
    if (fresh.length === 0) return
    sync.begin()
    for (const row of fresh) {
      delivered.add(row.id)
      sync.write({ type: `insert`, value: { ...row } })
    }
    const receipt = sync.commit()
    if (receipt !== true) await receipt
  }

  const source = createCollection<Row, number>({
    id: `ordered-consumer-${kind}-${harnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: loadingMode === `unindexed` ? `off` : `eager`,
    defaultIndexType: loadingMode === `unindexed` ? undefined : BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: async (options) => {
            const hasOrderHint = options.orderBy !== undefined
            requests.push({
              kind: hasOrderHint ? `with-order` : `without-order`,
              key: getLoadSubsetDemandKey(options),
              fingerprint: requestFingerprint(options),
              hasCursor: options.cursor !== undefined,
              limit: options.limit,
              offset: options.offset,
              lastKey: options.cursor?.lastKey,
            })
            if (requests.length > truth.length * 3 + 4) {
              throw new Error(`ordered loading did not reach a fixed point`)
            }

            const matching = options.where
              ? truth.filter(
                  (row) =>
                    evaluateReferenceExpression(options.where!, row) === true,
                )
              : truth

            if (!hasOrderHint) {
              await apply(matching.filter((row) => !delivered.has(row.id)))
              return
            }

            const candidates = options.cursor
              ? matching.filter(
                  (row) =>
                    evaluateReferenceExpression(
                      options.cursor!.whereFrom,
                      row,
                    ) === true,
                )
              : matching.slice(options.offset ?? 0)
            const page = candidates.slice(0, options.limit)
            if (page.length > 0) {
              await apply(page)
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const markers = truth
    .filter(({ eligible }) => eligible)
    .map(({ id }) => ({ id, rowId: id }))
  const markerSource = createCollection<Marker, number>({
    id: `ordered-marker-${kind}-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: delayJoinedDemand ? `on-demand` : `eager`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        markerSync = operations
        const { begin, write, commit, markReady } = operations
        if (delayJoinedDemand) {
          markReady()
          return {
            loadSubset: async ({ where, signal }) => {
              joinedRequests++
              await joinedLoadGate.promise
              const fresh = markers.filter(
                (marker) =>
                  !deliveredMarkers.has(marker.id) &&
                  (!where ||
                    evaluateReferenceExpression(where, marker) === true),
              )
              if (fresh.length === 0) return
              begin()
              for (const marker of fresh) {
                deliveredMarkers.add(marker.id)
                write({ type: `insert`, value: marker })
              }
              const receipt = commit(signal)
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        }
        begin()
        for (const marker of markers) {
          write({ type: `insert`, value: marker })
        }
        commit()
        markReady()
        return undefined
      },
    },
  })

  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let effect: ReturnType<typeof createEffect> | undefined
  const publications: Array<Array<Row>> = []
  const rawPublications: Array<Array<Row>> = []
  let subscription:
    ReturnType<NonNullable<typeof live>[`subscribeChanges`]> | undefined
  const query = (q: InitialQueryBuilder) => {
    const joined = q
      .from({ row: source })
      .leftJoin({ marker: markerSource }, ({ row, marker }) =>
        eq(row.id, joinFilter === `to-one` ? marker.id : marker.rowId),
      )
      .where(({ row, marker }) => {
        switch (joinFilter) {
          case `joined-only`:
          case `to-one`:
            return gte(marker.rowId, 0)
          case `some`:
            return not(isUndefined(marker.rowId))
          case `none`:
            return isUndefined(marker.rowId)
          case `two-alias`:
            return eq(row.id, marker.rowId)
        }
      })
    const labelRanks = new Map(truth.map(({ label, rank }) => [label, rank]))
    const ordered =
      loadingMode === `custom`
        ? joined.orderBy(({ row }) => row.label, {
            direction: scenario.direction,
            stringSort: `custom`,
            compare: (a, b) => labelRanks.get(a)! - labelRanks.get(b)!,
          })
        : joined.orderBy(({ row }) => row.rank, scenario.direction)
    return (rowToDelete ? ordered.orderBy(({ row }) => row.id, `asc`) : ordered)
      .limit(2)
      .select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        eligible: row.eligible,
        label: row.label,
      }))
  }

  const visibleRows = () =>
    (live ? [...live.values()] : [...effectRows.values()])
      .map(({ id, rank, eligible, label }) => ({ id, rank, eligible, label }))
      .sort(compareRows(scenario.direction))

  return withHistoryCleanup(
    async () => {
      let preload: Promise<void> | undefined
      if (kind === `collection`) {
        live = createLiveQueryCollection(query)
        subscription = live.subscribeChanges(() => {
          publications.push(visibleRows())
          rawPublications.push([...live!.values()].map(copiedRow))
        })
        preload = live.preload()
      } else {
        effect = createEffect<Row, number>({
          query,
          onBatch: (events) => {
            for (const event of events) {
              if (event.type === `exit`) effectRows.delete(event.key)
              else effectRows.set(event.key, { ...event.value })
            }
            publications.push(visibleRows())
          },
          onSourceError: (error) => errors.push(error.message),
        })
      }

      if (delayJoinedDemand) {
        await vi.waitFor(() => expect(joinedRequests).toBeGreaterThan(0))
        for (let turn = 0; turn < sourceSize * 3 + 6; turn++) {
          await flushPromises()
        }
        if (loadingMode === `indexed`)
          expect(
            requests.filter(
              ({ kind: requestKind }) => requestKind === `with-order`,
            ),
          ).toHaveLength(1)
        else if (loadingMode === `custom`) expect(requests).toHaveLength(1)
        else
          expect(requests.some(({ limit }) => limit === undefined)).toBe(true)
        joinedLoadGate.resolve()
      }
      await preload

      for (let turn = 0; turn < truth.length * 3 + 6; turn++) {
        await flushPromises()
      }

      const rows = visibleRows()
      if (joinFilter === `none` && !delayJoinedDemand) {
        expect(
          [...markerSource.values()].map(({ rowId }) => rowId).sort(),
        ).toEqual(markers.map(({ rowId }) => rowId).sort())
      }
      const expected = matchingTruth.slice(0, 2)
      expect(
        rows,
        JSON.stringify({ kind, scenario, requests, publications }),
      ).toEqual(expected)
      if (live) {
        expectRawWindow(
          [...live.values()].map(copiedRow),
          expected,
          scenario.direction,
          rowToDelete !== undefined,
        )
        expectInitialWindows(
          rawPublications,
          expected,
          scenario.direction,
          rowToDelete !== undefined,
        )
      }
      for (const publication of publications) {
        expect(publication).toEqual(expected.slice(0, publication.length))
      }
      const semanticPublications = publications.filter(
        (publication, index) =>
          index === 0 ||
          JSON.stringify(publication) !==
            JSON.stringify(publications[index - 1]),
      )
      for (let index = 1; index < semanticPublications.length; index++) {
        expect(semanticPublications[index]!.length).toBeGreaterThan(
          semanticPublications[index - 1]!.length,
        )
      }
      // Single-term bootstrap demand should be identical across entry points.
      // Multi-term loading may schedule a different bounded number of prefix
      // and tie refinements, so compare that path by rows and work bounds.
      let finalRows = rows
      const publicationsBeforeMutation = publications.length
      if (removeJoinedMarker) {
        const removed = markers[0]!
        markerSync.begin()
        markerSync.write({ type: `delete`, value: removed })
        const receipt = markerSync.commit()
        if (receipt !== true) await receipt
        for (let turn = 0; turn < sourceSize * 3 + 6; turn++) {
          await flushPromises()
        }
        finalRows = visibleRows()
        expect(finalRows).toEqual(
          truth
            .filter((row) => row.eligible && row.id !== removed.id)
            .slice(0, 2),
        )
      }
      if (rowToDelete) {
        truth.splice(truth.indexOf(rowToDelete), 1)
        delivered.delete(rowToDelete.id)
        sync.begin()
        sync.write({ type: `delete`, value: { ...rowToDelete } })
        const receipt = sync.commit()
        if (receipt !== true) await receipt
        for (let turn = 0; turn < sourceSize * 3 + 6; turn++) {
          await flushPromises()
        }
        finalRows = visibleRows()
        expect(finalRows, JSON.stringify({ kind, scenario, requests })).toEqual(
          truth.filter((row) => matchesJoinFilter(row, joinFilter)).slice(0, 2),
        )
        if (live)
          expectRawWindow(
            [...live.values()].map(copiedRow),
            truth
              .filter((row) => matchesJoinFilter(row, joinFilter))
              .slice(0, 2),
            scenario.direction,
            true,
          )
        expect(
          publications.length - publicationsBeforeMutation,
        ).toBeLessThanOrEqual(1)
      }
      expect(publications.at(-1) ?? []).toEqual(finalRows)
      // The explicit source deletion can publish without another provider call.
      expect(publications.length).toBeLessThanOrEqual(
        requests.length +
          1 +
          Number(rowToDelete !== undefined) +
          Number(removeJoinedMarker),
      )
      expect(requests.length).toBeLessThanOrEqual(sourceSize * 3 + 2)
      expect(
        requests.every(
          (request) =>
            request.kind === `without-order` || request.limit !== undefined,
        ),
      ).toBe(true)

      return {
        rows: finalRows,
        requests: requests.map((request) => ({ ...request })),
        compareRequestTrace: rowToDelete === undefined,
        publications: publications.map((publication) =>
          publication.map(copiedRow),
        ),
        errors: [...errors],
        live: live ? live.status === `ready` : effect?.disposed === false,
      }
    },
    () => {
      joinedLoadGate.resolve()
      const requestCount = requests.length
      return [
        () => subscription?.unsubscribe(),
        () => effect?.dispose(),
        () => live?.cleanup(),
        () => markerSource.cleanup(),
        () => source.cleanup(),
        () => {
          expectNoProviderStart(requestCount, requests.length)
        },
      ]
    },
  )
}

async function assertConsumerParity(scenario: Scenario): Promise<void> {
  const [collection, effect] = await Promise.all([
    observeConsumer(`collection`, scenario),
    observeConsumer(`effect`, scenario),
  ])
  compareAt(`ordered-work-oracle.property.test.ts:555`, () =>
    expect(effect.rows).toEqual(collection.rows),
  )
  compareAt(`ordered-work-oracle.property.test.ts:556`, () =>
    expect(effect.errors).toEqual(collection.errors),
  )
  compareAt(`ordered-work-oracle.property.test.ts:557`, () =>
    expect(effect.live).toBe(collection.live),
  )
  const semanticRequests = (requests: ReadonlyArray<RequestObservation>) =>
    requests.map(({ kind, hasCursor, limit, offset }) => ({
      kind,
      hasCursor,
      limit,
      // Once a cursor is present, the original offset no longer changes the
      // provider slice. Live collections retain it in the exact demand while
      // Effects omit it, so compare the adapter-visible operation instead.
      offset: hasCursor ? 0 : offset,
    }))
  if (effect.compareRequestTrace && collection.compareRequestTrace) {
    compareAt(`ordered-work-oracle.property.test.ts:569`, () =>
      expect(semanticRequests(effect.requests)).toEqual(
        semanticRequests(collection.requests),
      ),
    )
  }
}

async function observeLaterOrderTermMutation(
  kind: `collection` | `effect`,
): Promise<{ rows: Array<number>; requests: Array<string | undefined> }> {
  const truth: Array<Row> = [
    { id: 1, rank: 0, eligible: true, label: `a` },
    { id: 2, rank: 0, eligible: true, label: `b` },
    { id: 3, rank: 0, eligible: true, label: `c` },
  ]
  const delivered = new Set<number>()
  const requests: Array<string | undefined> = []
  const fingerprints: Array<string> = []
  const effectRows = new Map<number, Row>()
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]

  const source = createCollection<Row, number>({
    id: `ordered-later-term-${kind}-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: async (options) => {
            requests.push(getLoadSubsetDemandKey(options))
            fingerprints.push(requestFingerprint(options))
            let selected = options.where
              ? truth.filter(
                  (row) =>
                    evaluateReferenceExpression(options.where!, row) === true,
                )
              : [...truth]
            selected.sort(
              (left, right) =>
                left.rank - right.rank ||
                left.label.localeCompare(right.label) ||
                left.id - right.id,
            )
            if (options.cursor) {
              selected = selected.filter(
                (row) =>
                  evaluateReferenceExpression(
                    options.cursor!.whereFrom,
                    row,
                  ) === true,
              )
            } else if (options.offset) {
              selected = selected.slice(options.offset)
            }
            if (options.limit !== undefined) {
              selected = selected.slice(0, options.limit)
            }
            const fresh = selected.filter(({ id }) => !delivered.has(id))
            if (fresh.length === 0) return
            operations.begin()
            for (const row of fresh) {
              delivered.add(row.id)
              operations.write({ type: `insert`, value: { ...row } })
            }
            const receipt = operations.commit()
            if (receipt !== true) await receipt
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const query = (q: InitialQueryBuilder) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank)
      .orderBy(({ row }) => row.label)
      .limit(2)
  const live =
    kind === `collection` ? createLiveQueryCollection({ query }) : undefined
  const effect =
    kind === `effect`
      ? createEffect<Row, number>({
          query,
          onBatch: (events) => {
            for (const event of events) {
              if (event.type === `exit`) effectRows.delete(event.key)
              else effectRows.set(event.key, { ...event.value })
            }
          },
        })
      : undefined

  const visibleIds = () =>
    (live ? live.toArray : [...effectRows.values()])
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.label.localeCompare(right.label) ||
          left.id - right.id,
      )
      .map(({ id }) => id)

  return withHistoryCleanup(
    async () => {
      if (live) await live.preload()
      else await vi.waitFor(() => expect(visibleIds()).toEqual([1, 2]))
      expect(visibleIds()).toEqual([1, 2])
      if (live) expect([...live.values()].map(({ id }) => id)).toEqual([1, 2])

      const first = { ...source.get(1)!, label: `z` }
      sync.begin()
      sync.write({ type: `update`, value: { ...first } })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() => expect(visibleIds()).toEqual([2, 3]))
      if (live) expect([...live.values()].map(({ id }) => id)).toEqual([2, 3])

      expect(requests.length).toBeLessThanOrEqual(6)
      expect(fingerprints).toHaveLength(requests.length)
      return { rows: visibleIds(), requests: [...requests] }
    },
    () => {
      const requestCount = requests.length
      return [
        () => effect?.dispose(),
        () => live?.cleanup(),
        () => source.cleanup(),
        () => {
          expectNoProviderStart(requestCount, requests.length)
        },
      ]
    },
  )
}

async function observeFinitePrefixMutation(
  kind: `collection` | `effect`,
  mutation: `move` | `delete`,
): Promise<{
  rows: Array<number>
  requests: number
  publications: Array<Array<number>>
}> {
  const truth = new Map<number, Row>([
    [1, { id: 1, rank: 0, eligible: true, label: `visible` }],
    [2, { id: 2, rank: 1, eligible: true, label: `hidden` }],
  ])
  const delivered = new Set<number>()
  const effectRows = new Map<number, Row>()
  const publications: Array<Array<number>> = []
  let requests = 0
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]

  const source = createCollection<Row, number>({
    id: `ordered-finite-prefix-${kind}-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        const deduplicated = new DeduplicatedLoadSubset({
          loadSubset: async (options) => {
            requests++
            let selected = [...truth.values()].sort(
              (left, right) => left.rank - right.rank || left.id - right.id,
            )
            if (options.where) {
              selected = selected.filter(
                (row) =>
                  evaluateReferenceExpression(options.where!, row) === true,
              )
            }
            if (options.cursor) {
              selected = selected.filter(
                (row) =>
                  evaluateReferenceExpression(
                    options.cursor!.whereFrom,
                    row,
                  ) === true,
              )
            } else if (options.offset) {
              selected = selected.slice(options.offset)
            }
            if (options.limit !== undefined) {
              selected = selected.slice(0, options.limit)
            }
            const fresh = selected.filter(({ id }) => !delivered.has(id))
            if (fresh.length === 0) return
            operations.begin()
            for (const row of fresh) {
              delivered.add(row.id)
              operations.write({ type: `insert`, value: { ...row } })
            }
            const receipt = operations.commit()
            if (receipt !== true) await receipt
          },
        })
        return {
          loadSubset: deduplicated.loadSubset,
          unloadSubset: () => {},
        }
      },
    },
  })
  const query = (q: InitialQueryBuilder) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank)
      .limit(1)
  const live =
    kind === `collection` ? createLiveQueryCollection({ query }) : undefined
  const effect =
    kind === `effect`
      ? createEffect<Row, number>({
          query,
          onBatch: (events) => {
            for (const event of events) {
              if (event.type === `exit`) effectRows.delete(event.key)
              else effectRows.set(event.key, { ...event.value })
            }
            publications.push(
              [...effectRows.values()]
                .sort((left, right) => left.rank - right.rank)
                .map(({ id }) => id),
            )
          },
        })
      : undefined
  const visibleIds = () =>
    (live ? live.toArray : [...effectRows.values()])
      .sort((left, right) => left.rank - right.rank)
      .map(({ id }) => id)

  return withHistoryCleanup(
    async () => {
      if (live) {
        live.subscribeChanges(() => publications.push(visibleIds()))
        await live.preload()
      } else {
        await vi.waitFor(() => expect(visibleIds()).toEqual([1]))
      }
      if (live) expect([...live.values()].map(({ id }) => id)).toEqual([1])
      const requestsBeforeMutation = requests
      const moved = { ...truth.get(1)!, rank: 10 }
      if (mutation === `delete`) truth.delete(1)
      else truth.set(1, moved)
      sync.begin()
      sync.write({
        type: mutation === `delete` ? `delete` : `update`,
        value: { ...moved },
      })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() =>
        expect(
          visibleIds(),
          JSON.stringify({ kind, requests, source: source.toArray }),
        ).toEqual([2]),
      )

      expect(requests).toBeGreaterThan(requestsBeforeMutation)
      if (live) expect([...live.values()].map(({ id }) => id)).toEqual([2])
      return {
        rows: visibleIds(),
        requests,
        publications: publications.map((rows) => [...rows]),
      }
    },
    () => {
      const requestCount = requests
      return [
        () => effect?.dispose(),
        () => live?.cleanup(),
        () => source.cleanup(),
        () => {
          expectNoProviderStart(requestCount, requests)
        },
      ]
    },
  )
}

// Registration transports an existing judgment. The named function runs
// production with its authored comparisons and models; observeComparison
// forwards only a comparison marked with compareAt as a verdict, and keeps any
// other error as a driver error. Each history is wrapped in a plan object,
// which keys that judgment.
function orderedWorkJudgment<THistory>(
  judge: (history: THistory) => Promise<void>,
) {
  return {
    resolve: (history: THistory) => ({ history }),
    model: (
      plan: { history: THistory },
      observations: ReadonlyArray<Observation>,
    ) => recordedComparison(plan, observations),
    driver: (
      plan: { history: THistory },
      observe: (checkpoint: string, value: unknown) => void,
    ) => observeComparison(plan, observe, () => judge(plan.history)),
  }
}

describe(`ordered source work oracle`, () => {
  async function runOrderTermParity(): Promise<void> {
    const [collection, effect] = await Promise.all([
      observeLaterOrderTermMutation(`collection`),
      observeLaterOrderTermMutation(`effect`),
    ])
    expect(effect.rows).toEqual(collection.rows)
    // The two graph entry points may take a different bounded number of
    // refinement passes, but they must exercise the same demand forms.
    expect(new Set(effect.requests)).toEqual(new Set(collection.requests))
  }
  oracleProperty({
    id: `ordered-work.work-order-term-parity`,
    law: {
      statement: `A live Collection and an Effect keep equal rows and exercise the same demand forms after a later order-term invalidation.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `One fixed history through the controlled on-demand adapter.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: [`keeps later order-term invalidation equal across consumers`],
    label: (name) => name,
    ...orderedWorkJudgment(runOrderTermParity),
    check: (_plan, _observations, verdict) => verdict,
  })

  const finitePrefixParityHistories = [`move`, `delete`] as const
  async function runFinitePrefixParity(
    mutation: (typeof finitePrefixParityHistories)[number],
  ): Promise<void> {
    const [collection, effect] = await Promise.all([
      observeFinitePrefixMutation(`collection`, mutation),
      observeFinitePrefixMutation(`effect`, mutation),
    ])

    expect(effect.rows).toEqual(collection.rows)
    expect(effect.publications.at(-1)).toEqual(collection.publications.at(-1))
  }
  oracleProperty({
    id: `ordered-work.work-finite-prefix-parity`,
    law: {
      statement: `A live Collection and an Effect recover a finite source prefix to equal rows and an equal final publication after a move or a delete.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The move and delete histories through the controlled on-demand adapter.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: finitePrefixParityHistories,
    label: (mutation) =>
      `recovers a finite source prefix equally across consumers after ${mutation}`,
    ...orderedWorkJudgment(runFinitePrefixParity),
    check: (_plan, _observations, verdict) => verdict,
  })

  const valueUpdateHistories = ([`collection`, `effect`] as const).flatMap(
    (consumer) =>
      [2, 5].flatMap((limit) =>
        ([`first`, `last`] as const).flatMap((position) =>
          ([`asc`, `desc`] as const).map((direction) => ({
            consumer,
            limit,
            position,
            direction,
          })),
        ),
      ),
  )
  async function runValueUpdate({
    consumer,
    limit,
    position,
    direction,
  }: (typeof valueUpdateHistories)[number]): Promise<void> {
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let loads = 0
    const rows = rowsForScenario({
      middleCount: 1,
      middleEligible: true,
      lastEligible: true,
      tied: false,
      direction,
    })
    const source = createCollection<Row, number>({
      id: `ordered-value-update`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          sync = operations
          operations.markReady()
          return {
            loadSubset: async () => {
              loads++
              if (loads > 1) return
              operations.begin()
              for (const row of rows) {
                operations.write({ type: `insert`, value: { ...row } })
              }
              const receipt = operations.commit()
              if (receipt !== true) await receipt
            },
          }
        },
      },
    })
    const query = (q: InitialQueryBuilder) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank, direction)
        .limit(limit)
    const effectRows = new Map<number, Row>()
    const live =
      consumer === `collection` ? createLiveQueryCollection(query) : undefined
    const effect =
      consumer === `effect`
        ? createEffect<Row, number>({
            query,
            onBatch: (events) => {
              for (const event of events) {
                if (event.type === `exit`) effectRows.delete(event.key)
                else effectRows.set(event.key, event.value)
              }
            },
          })
        : undefined
    const readRows = () =>
      (live ? [...live.values()] : [...effectRows.values()])
        .map(({ id, rank, eligible, label }) => ({
          id,
          rank,
          eligible,
          label,
        }))
        .sort(compareRows(direction))

    try {
      if (live) await live.preload()
      await flushPromises()
      const expected = expectedVisibleWindow(rows, direction, limit)
      expect(readRows()).toEqual(expected)
      const loadCount = loads
      const row = position === `first` ? expected[0]! : expected.at(-1)!
      sync.begin()
      sync.write({ type: `update`, value: { ...row, label: `changed` } })
      sync.commit()
      await flushPromises()

      expect(readRows()).toEqual(
        expected.map((value) =>
          value.id === row.id ? { ...value, label: `changed` } : value,
        ),
      )
      expect(loads).toBe(loadCount)
    } finally {
      if (effect) await effect.dispose()
      if (live) await live.cleanup()
      await source.cleanup()
    }
  }
  oracleProperty({
    id: `ordered-work.work-value-update`,
    law: {
      statement: `A value change outside the ordering key keeps the visible window equal to the model window with the changed value and starts no request.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Both consumers, limits 2 and 5, the first and last window row, and both directions.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: valueUpdateHistories,
    label: (history) =>
      `does not refetch when a visible row changes outside the ordering key: ${JSON.stringify(history)}`,
    ...orderedWorkJudgment(runValueUpdate),
    check: (_plan, _observations, verdict) => verdict,
  })

  const antiJoinExistingRowHistories = [
    {
      name: `keeps the collection anti-join result when the joined row exists`,
      consumer: `collection`,
    },
    {
      name: `removes a matched parent from the anti-join Effect`,
      consumer: `effect`,
    },
  ] as const
  async function runAntiJoinExistingRow({
    consumer,
  }: (typeof antiJoinExistingRowHistories)[number]): Promise<void> {
    const observed = await observeConsumer(
      consumer,
      exhaustiveScenarios[0]!,
      `none`,
    )
    expect(observed.rows.map(({ id }) => id)).toEqual([2])
  }
  oracleProperty({
    id: `ordered-work.work-anti-join-existing-row`,
    law: {
      statement: `A none-filtered anti-join keeps only the unmatched row when the joined row exists, for a live Collection and an Effect.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The first exhaustive scenario through the shared consumer driver and its window model, for both consumers.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: antiJoinExistingRowHistories,
    label: ({ name }) => name,
    ...orderedWorkJudgment(runAntiJoinExistingRow),
    check: (_plan, _observations, verdict) => verdict,
  })

  async function runNoneFilterBound(): Promise<void> {
    for (const scenario of exhaustiveScenarios) {
      const observed = await observeConsumer(`collection`, scenario, `none`)
      expect(observed.requests.length).toBeGreaterThan(0)
      expect(observed.requests[0]?.kind).toBe(`with-order`)
      expect(observed.requests[0]?.limit).toBeGreaterThan(0)
    }
  }
  oracleProperty({
    id: `ordered-work.work-none-filter-bound`,
    law: {
      statement: `A direct LEFT-joined none filter keeps finite ordered root acquisition across the exhaustive small domain.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The 64 exhaustive scenarios in one history, through the shared consumer driver and its window model.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: [`bounds ordered root acquisition for a none left-join filter`],
    label: (name) => name,
    ...orderedWorkJudgment(runNoneFilterBound),
    check: (_plan, _observations, verdict) => verdict,
  })

  const leftJoinBoundHistories = [`joined-only`, `some`, `to-one`] as const
  async function runLeftJoinBound(
    joinFilter: (typeof leftJoinBoundHistories)[number],
  ): Promise<void> {
    for (const scenario of exhaustiveScenarios) {
      const [collection, effect] = await Promise.all([
        observeConsumer(`collection`, scenario, joinFilter),
        observeConsumer(`effect`, scenario, joinFilter),
      ])
      expect(collection.rows).toEqual(effect.rows)
      expect(collection.errors).toEqual([])
      expect(effect.errors).toEqual([])

      // A direct LEFT-joined filter retains finite root acquisition.
      for (const observation of [collection, effect]) {
        expect(observation.requests.length).toBeGreaterThan(0)
        expect(observation.requests[0]?.kind).toBe(`with-order`)
        expect(observation.requests[0]?.limit).toBeGreaterThan(0)
      }
    }
  }
  oracleProperty({
    id: `ordered-work.work-left-join-bound`,
    law: {
      statement: `A direct LEFT-joined filter keeps finite ordered root acquisition, equal rows across consumers, and no errors across the exhaustive small domain.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The joined-only, some, and to-one filters, each over the 64 exhaustive scenarios.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: leftJoinBoundHistories,
    label: (joinFilter) =>
      `bounds ordered root acquisition for a ${joinFilter} left-join filter`,
    ...orderedWorkJudgment(runLeftJoinBound),
    check: (_plan, _observations, verdict) => verdict,
  })

  const joinedDemandSettlesHistories = (
    [`collection`, `effect`] as const
  ).flatMap((consumer) =>
    ([`unindexed`, `custom`] as const).map((loadingMode) => ({
      consumer,
      loadingMode,
    })),
  )
  async function runJoinedDemandSettles({
    consumer,
    loadingMode,
  }: (typeof joinedDemandSettlesHistories)[number]): Promise<void> {
    const observed = await observeConsumer(
      consumer,
      {
        middleCount: 1,
        middleEligible: false,
        lastEligible: true,
        tied: false,
        direction: `asc`,
      },
      `none`,
      true,
      false,
      loadingMode,
    )
    expect(observed.rows.map(({ id }) => id)).toEqual([3])
    expect(observed.errors).toEqual([])
    if (loadingMode === `custom`) {
      // The full-source acquisition uses the without-order request shape.
      expect(observed.requests).toHaveLength(1)
      expect(observed.requests[0]?.kind).toBe(`without-order`)
      expect(observed.requests[0]?.limit).toBeUndefined()
      expect(observed.requests[0]?.hasCursor).toBe(false)
      expect(observed.requests[0]?.offset).toBeUndefined()
    } else {
      expect(observed.requests[0]?.kind).toBe(`with-order`)
      expect(observed.requests.some(({ limit }) => limit === undefined)).toBe(
        true,
      )
    }
  }
  oracleProperty({
    id: `ordered-work.work-joined-demand-settles`,
    law: {
      statement: `Unindexed and custom-collation loading settle joined demand before one complete window publishes.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Both consumers and both loading modes over one fixed scenario.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: joinedDemandSettlesHistories,
    label: (history) =>
      `settles joined demand and publishes a complete ${history.loadingMode} ${history.consumer} window`,
    ...orderedWorkJudgment(runJoinedDemandSettles),
    check: (_plan, _observations, verdict) => verdict,
  })

  const joinedDemandWaitsHistories = (
    [`collection`, `effect`] as const
  ).flatMap((consumer) =>
    ([`some`, `none`] as const).map((joinFilter) => ({
      consumer,
      joinFilter,
    })),
  )
  async function runJoinedDemandWaits({
    consumer,
    joinFilter,
  }: (typeof joinedDemandWaitsHistories)[number]): Promise<void> {
    const observed = await observeConsumer(
      consumer,
      {
        middleCount: 1,
        middleEligible: false,
        lastEligible: true,
        tied: false,
        direction: `asc`,
      },
      joinFilter,
      true,
    )
    expect(observed.errors).toEqual([])
    expect(observed.requests[0]?.kind).toBe(`with-order`)
  }
  oracleProperty({
    id: `ordered-work.work-joined-demand-waits`,
    law: {
      statement: `Joined demand settles before the ordered root requests another page.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Both consumers and the some and none filters over one fixed scenario.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: joinedDemandWaitsHistories,
    label: (history) =>
      `waits for a ${history.joinFilter} joined demand before requesting another root page in a ${history.consumer}`,
    ...orderedWorkJudgment(runJoinedDemandWaits),
    check: (_plan, _observations, verdict) => verdict,
  })

  const joinedFilterRefillHistories = [`collection`, `effect`] as const
  async function runJoinedFilterRefill(
    consumer: (typeof joinedFilterRefillHistories)[number],
  ): Promise<void> {
    const observed = await observeConsumer(
      consumer,
      {
        middleCount: 1,
        middleEligible: true,
        lastEligible: true,
        tied: false,
        direction: `asc`,
      },
      `some`,
      false,
      true,
    )
    expect(observed.rows.map(({ id }) => id)).toEqual([3, 2])
    expect(observed.requests.some(({ hasCursor }) => hasCursor)).toBe(true)
  }
  oracleProperty({
    id: `ordered-work.work-joined-filter-refill`,
    law: {
      statement: `A joined-filter window refills through a cursor after a child leaves.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Both consumers over one fixed scenario.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: joinedFilterRefillHistories,
    label: (consumer) =>
      `refills a joined-filter ${consumer} window after a child leaves`,
    ...orderedWorkJudgment(runJoinedFilterRefill),
    check: (_plan, _observations, verdict) => verdict,
  })

  const joinedFilterStopsHistories = [`collection`, `effect`] as const
  async function runJoinedFilterStops(
    consumer: (typeof joinedFilterStopsHistories)[number],
  ): Promise<void> {
    const observed = await observeConsumer(
      consumer,
      {
        middleCount: 40,
        middleEligible: true,
        lastEligible: true,
        tied: false,
        direction: `asc`,
      },
      `some`,
    )
    expect(observed.requests.length).toBeLessThan(10)
    expect(
      observed.requests.every(
        ({ kind, key }) => kind === `with-order` || key !== undefined,
      ),
    ).toBe(true)
  }
  oracleProperty({
    id: `ordered-work.work-joined-filter-stops`,
    law: {
      statement: `A joined-filter window stops acquisition after the root prefix that its result needs.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Both consumers over one fixed 40-row scenario.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: joinedFilterStopsHistories,
    label: (consumer) =>
      `stops a joined-filter ${consumer} after the needed root prefix`,
    ...orderedWorkJudgment(runJoinedFilterStops),
    check: (_plan, _observations, verdict) => verdict,
  })

  const underfilledSourceHistories = [0, 1, 2, 3, 4].flatMap((middleCount) =>
    ([`asc`, `desc`] as const).flatMap((direction) =>
      [false, true].map((tied) => ({ middleCount, direction, tied })),
    ),
  )
  async function runUnderfilledSource({
    middleCount,
    direction,
    tied,
  }: (typeof underfilledSourceHistories)[number]): Promise<void> {
    const scenario: Scenario = {
      middleCount,
      middleEligible: false,
      lastEligible: false,
      tied,
      direction,
    }
    const [collection, effect] = await Promise.all([
      observeConsumer(`collection`, scenario),
      observeConsumer(`effect`, scenario),
    ])

    expect(collection.rows.map(({ id }) => id)).toEqual([1])
    expect(effect.rows).toEqual(collection.rows)
    expect(effect.errors).toEqual(collection.errors)
    expect(effect.live).toBe(collection.live)
    for (const observation of [collection, effect]) {
      expect(observation.errors).toEqual([])
      expect(observation.live).toBe(true)
      // At most one page and one tie-boundary load per source row, including
      // the final empty page. A fixed cap mistakes longer finite walks for loops.
      const sourceSize = rowsForScenario(scenario).length
      expect(
        observation.requests.length,
        JSON.stringify(observation.requests),
      ).toBeLessThanOrEqual(2 * sourceSize)
      expect(
        observation.requests.filter(({ kind }) => kind === `with-order`).length,
      ).toBeLessThanOrEqual(sourceSize)
      expect(
        observation.requests.filter(({ kind }) => kind === `without-order`)
          .length,
      ).toBeLessThanOrEqual(sourceSize)
      expect(
        new Set(observation.requests.map(({ key }) => key)).size,
        JSON.stringify(observation.requests),
      ).toBe(observation.requests.length)
      expectDistinctRequests(observation.requests)
    }
  }
  oracleProperty({
    id: `ordered-work.work-underfilled-source`,
    law: {
      statement: `An underfilled source settles to equal rows across consumers without repeating a continuation, within the per-row request bound.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Zero to four middle rows, both directions, and tied or distinct ranks.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: underfilledSourceHistories,
    label: (history) =>
      `settles an underfilled source without repeating a continuation: ${JSON.stringify(history)}`,
    ...orderedWorkJudgment(runUnderfilledSource),
    check: (_plan, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `ordered-work.consumer-parity`,
    law: {
      statement: `keeps rows, request traces, batches, errors, and liveness equal for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: {
      arbitrary: scenarioArbitrary,
      runs: 20,
      fixedSeeds: [17801],
      // The exhaustive small domain: every legal scenario, replayed through
      // the same consumer-parity judgment.
      fixed: exhaustiveScenarios.map((scenario) => ({
        name: `keeps live collections and Effects equal across the exhaustive small domain: ${JSON.stringify(scenario)}`,
        history: scenario,
      })),
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await assertConsumerParity(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })
})

/**
 * ## Does an eager indexed window refine from its source in bounded work?
 *
 * An eager source installs every row before and during the query, so its local
 * state is the complete source. When an ordered, limited query reads that
 * source through an index on its leading order term, the loader sends D2 only
 * the rows the window needs. A visible delete or an order change can then make
 * a row that D2 has not seen belong in the window, so the loader reacquires the
 * ordered prefix (ARCHITECTURE.md, "Ordered requests, continuation, and
 * recovery").
 *
 * Two laws hold after every source change:
 *
 * - **Rows:** the visible window equals the first `limit` rows after `offset`
 *   of the eligible source rows, sorted by rank and then id. The model is a
 *   plain array of the current source rows, filtered and sorted here; it shares
 *   no code with the loader or the index. The guide orders rows only by the
 *   query's `orderBy` terms, so a joined plan, whose ties follow the joined
 *   result key, may return any rows that tie on rank: its window must have the
 *   model's ranks in sequence, each from a distinct eligible row. A full window
 *   is not evidence by itself: a filter that drops rows after the source's
 *   limit can leave a row an earlier live update sent in place of an eligible
 *   row the bounded read never sent.
 * - **Work:** with an index on a single order term, the source delivers at
 *   most a bounded number of rows per change, independent of the source size.
 *   The bound is `2 * (offset + limit) + boundary ties + 1`: one reacquired
 *   prefix of the window, the rows tied with a boundary value, one refill of
 *   at most the window, and the changed row itself. A boundary value is the
 *   rank of the last window row or the first row after the window, before or
 *   after the change. The source holds 200 eligible filler rows outside every
 *   window, and its domain holds up to 20 more. A loader that resends every
 *   eligible row on each repair, or every domain row, exceeds the bound and
 *   fails. The initial load has the same bound. A joined or function filter
 *   keeps the full read, so the work law covers source-predicate plans. Without
 *   an index, or when a
 *   boundary value is NaN or null (such a
 *   boundary cannot be expressed as a cursor), the loader legitimately reads
 *   the full source, so only the rows law and the scan law apply there.
 * - **Scan:** for a source-predicate plan, a change visits each installed
 *   source row at most once. A second order term keeps the loader on its full
 *   read, which is one pass; a bounded read that then sorts the whole source in
 *   memory makes a second pass and fails. A joined plan reads its full source
 *   twice per change on `main` too, so the scan law does not cover it.
 * - **Full join:** the result holds every root row, and one rootless row for
 *   each marker whose id names no root row. A rootless row sorts with the null
 *   ranks. Its window is the first result rows in that order. The plan reads
 *   its full source, because a marker looks unmatched until its root row has
 *   loaded; a bounded root prefix showed such markers as rootless rows. Only
 *   the rows law applies.
 *
 * The grammar crosses the sync path (sync writes, or local-only direct writes),
 * the filter (a predicate on the source, a function filter, or a filter on a
 * LEFT-joined marker per eligible row; the last two drop rows after the
 * source's limit), the index (present or absent), the direction, one or two
 * order terms (rank, then ascending id), limit 1..3, offset 0..1, and a history
 * of upserts, deletes, deletes of the first visible row, and label-only
 * touches over ids 0..29 and ranks 0..15, NaN, null, or undefined, so ties, deletes
 * inside and at the edge of the window, rank changes across its boundary, and
 * distant rows the query has already received all occur. A second campaign
 * fixes the premise of the joined law: a joined filter, an index and one order
 * term. Null ranks sort first or last, with a matching index. Joined filters
 * also run as anti-joins and change eligibility through the marker or the root
 * row's join key, and an Effect runs the same query beside the Collection.
 * A third campaign fixes the full-join premise: few or no filler rows, a
 * matched root row with a null rank, and at least one orphan marker, so a
 * window can reach the null group where rootless rows and null-ranked root
 * rows tie. A reconstruction check samples the cases that campaign executes
 * and requires such windows. A joined step can
 * change a row and its marker in two commits; each
 * commit publishes at most once, and the last publication shows the final
 * window. The observation point is after each change and a flush. Work is
 * counted twice, and both counts are bounded: rows a local snapshot returns
 * from the Collection's `currentStateAsChanges`, and rows the source delivers
 * to the query's subscription, which include index refills. Scan is counted
 * as the rows the Collection's `entries()` yields.
 * The sync path also runs against an on-demand source.
 *
 * Model terms (glossary, model alignment rule). The test provider combines a
 * sync adapter and its provider: it accepts each `loadSubset` call as a
 * physical acquisition, owns the model's source rows, and writes sync
 * transactions. A held request is a physical acquisition whose provider
 * answer is delayed until an `answer` step. A served range is a model
 * abstraction: the prefix and boundary that one answer establishes, up to
 * the last order value a nonempty limited answer returned. A short answer
 * does not prove source exhaustion. The ledger is the model's record of the
 * rows the provider has sent. The peer is a second live-query Collection
 * over the same source Collections.
 *
 * The provider answers each request from the rows: filtered with the
 * reference evaluator, sorted by the requested order, with the offset only
 * when there is no cursor, up to the limit. Its load fulfills when the
 * commit's applied receipt fulfills, and rejects if it rejects. A forwarding provider sends live changes
 * only for rows it sent or rows that match a subset it served; the rows law
 * holds after each step, and the work law bounds the rows it serves. A
 * refetching provider, like query-db-collection, sends nothing until a
 * `refetch` step. The LoadSubset contract gives a refetch two ways to stay
 * correct, and the oracle has a provider for each. A whole-range refetch
 * keeps every served range whole: it sends every row from the start of the
 * order through the range's boundary, so a row that moves between two
 * answers still arrives, and rows in no served range leave. A signalling
 * refetch re-runs each request alone, as query-db-collection does, so a row
 * can fall between two answers; when any answer changed, it then calls
 * `invalidateLoadedSubsets()`, and each ordered loader must re-establish its
 * window with a bounded repair. Until then the Collection may
 * lag the rows, so the rows law over the model applies only once no change
 * is pending, and every refetching history ends with a refetch. On either
 * provider, after every step the Collection holds exactly the rows in the
 * ledger, and the query and the Effect show their window over those rows.
 *
 * A joined or anti-joined filter over an on-demand source must not request
 * the whole source at its initial load when the first window's worth of
 * source rows all pass the join and no boundary value is null or NaN, and
 * each consumer (query or Effect) is served at most the prefix, its
 * boundary ties and a refill in total, so a repeated request for the same
 * prefix counts against that bound, and at most the source's size in
 * distinct rows.
 *
 * A holding provider answers a held request only at an `answer` step, from
 * the rows at that moment, so live changes and other loads can arrive while
 * it is in flight. It counts a request as served only once it answers it.
 * An abort (or an adapter unload) of a held request follows
 * `LoadSubsetOptions.signal`: a cooperative provider installs none of its
 * rows and its load fulfills at once; a provider that cannot cancel
 * in-flight work (`late` cancellation) answers it anyway at its `answer`
 * step, and its load fulfills after those rows become visible. Neither is
 * counted as served. Every holding history ends by
 * answering all held requests, and every window-move promise it made must
 * then have fulfilled. While a load is in flight, the Collection must still
 * hold exactly the ledger, and a query and its peer either keep the window
 * they showed at the previous checkpoint or show distinct ledger rows that
 * pass the query, in its order. This is weaker than the architecture's
 * barrier rule (a repair or window move keeps the last public snapshot
 * until it settles), which on-demand joined plans break today (#2131). The
 * Effect is not checked while a load is in flight. A campaign fixed to that
 * premise uses a forwarding provider and an indexed source filter or a
 * joined filter that refills from it, deletes three visible rows, then
 * upserts an eligible row with an unshared id; a reconstruction check, in
 * the same test as the fixed-seed campaign, reads its per-case counts and
 * requires every case that issues a held request to change rows while it is
 * in flight. Loading must
 * reach a fixed point: past a request budget the provider rejects and
 * records it, and every checkpoint asserts it did not. A bounded step makes
 * at most four provider requests. On either provider a step may publish one
 * intermediate window per provider request it made, and only its last
 * publication must show the final window (#2131).
 *
 * A `move` step changes the first query's window with `setWindow`; its laws
 * then follow the moved window. On an adapter unload, a refetching
 * provider drops the request and removes the rows that no
 * remaining request's last answer holds, as query-db-collection does. The
 * per-step work law applies only to forwarding, immediate, single-consumer
 * cases; it skips refetching, holding and peer cases, and move steps.
 * One case in four adds a peer with its own window, the first
 * `offset + limit + 1` rows. Its rows law holds beside the first query's at
 * every checkpoint; the work laws count one consumer, so they do not apply
 * to those cases. A peer over a refetching provider with a joined filter is
 * excluded from the grammar until #2155 is fixed: an indexed trace is kept as a
 * fixed history, but an unindexed peer still keeps a short joined window after
 * a refetch. A peer over a source filter stays in the grammar.
 *
 * `null` and `undefined` ranks are both nullish, so they tie: either may
 * come first, and neither is an expressible cursor value.
 *
 * - **Proven report:** a signalling refetch can report a shift that changes
 *   nothing the first query's own first page proves. Its page and the tie
 *   of the page's end answer the same rows, the page ends on a plain number,
 *   and the model's next row sorts strictly after that end and is
 *   installed, as a peer's longer page installs it. The refetch also deletes
 *   and reorders no installed row the first query received, because such a
 *   change starts the repair path by itself. Then the report starts no
 *   request for the first query, and until a step that can change source
 *   ordering, the first query issues no repair (`refetch: true`) request.
 *   A campaign fixed to that premise must reach it, and a loader that
 *   repairs every report fails it.
 * Joined filters can match a row through several markers, by `dup`, so a
 * LEFT-joined filter and a full join keep one result row per matched
 * (row, marker) pair, and an anti-join keeps a row once.
 */

// Properties take this as their predicate, which must return nothing;
// runEagerWindow also returns the held-load reach counts.
async function checkEagerWindow(testCase: EagerCase): Promise<void> {
  await runEagerWindow(testCase)
}

/** Runs one case and returns its held-load reach counts. */
async function runEagerWindow(testCase: EagerCase): Promise<{
  heldChanges: number
  heldRequests: number
  cooperativeCancels: number
  lateAnswers: number
  ignoredProvenReports: number
  unindexedRefetchChecks: number
  shortUnindexedRefills: number
}> {
  const joined = isJoinedFilter(testCase)
  const fullJoin = testCase.filter === `full-joined`
  const viaLink = joined && testCase.via === `link`
  // A marker admits its row in a joined plan and excludes it in an anti-joined
  // one. Under `link`, every row id has a marker and a row's join key points
  // at its own (matched) or at a negative key (unmatched).
  const admitsWhenMatched = testCase.filter !== `anti-joined`
  const linkFor = (id: number, eligible: boolean) =>
    !viaLink || eligible === admitsWhenMatched ? id : -1 - id
  const rows = new Map<number, Row>()
  for (const row of [
    ...fillerRows(testCase.direction, testCase.fillers),
    ...testCase.initial,
  ]) {
    rows.set(row.id, {
      label: `row`,
      ...row,
      link: linkFor(row.id, row.eligible),
    })
  }
  let syncControls:
    | {
        begin: () => void
        write: (message: {
          type: `insert` | `update` | `delete`
          value: Row
        }) => void
        commit: Parameters<SyncConfig<Row, number>[`sync`]>[0][`commit`]
        invalidateLoadedSubsets: () => void
      }
    | undefined
  const id = `eager-window-${Math.random()}`
  const source =
    testCase.path === `local-only`
      ? createCollection(
          localOnlyCollectionOptions<Row, number>({
            id,
            getKey: (row) => row.id,
            initialData: [...rows.values()],
          }),
        )
      : createCollection<Row, number>({
          id,
          getKey: (row) => row.id,
          syncMode: testCase.path === `on-demand` ? `on-demand` : `eager`,
          startSync: true,
          sync: {
            sync: ({
              begin,
              write,
              commit,
              markReady,
              invalidateLoadedSubsets,
            }) => {
              syncControls = { begin, write, commit, invalidateLoadedSubsets }
              if (testCase.path === `on-demand`) {
                markReady()
                return {
                  loadSubset: (options) => servePage(options),
                  unloadSubset: (options) => unload(options),
                }
              }
              begin()
              for (const row of rows.values()) {
                write({ type: `insert`, value: row })
              }
              commit()
              markReady()
              return undefined
            },
          },
        })
  // The on-demand provider: a page is the rows matching the request's
  // predicate and cursor, in the model's order, after the offset when there
  // is no cursor, up to the limit. It sends each page row it has not sent, or
  // whose value changed since it sent it, and keeps its own ledger of sent
  // values, so its behavior never depends on the Collection under test. It
  // evaluates predicates with the reference evaluator, not production's.
  const refetching =
    testCase.path === `on-demand` &&
    (testCase.provider === `refetch` || testCase.provider === `refetch-signal`)
  const signalsRefetch = refetching && testCase.provider === `refetch-signal`
  let providerRequests = 0
  const sent = new Map<number, Row>()
  // Rows the provider returns, the on-demand transfer the work law bounds,
  // in total and per consumer subscription (the query and its Effect load
  // separately).
  let served = 0
  const servedBy = new Map<unknown, number>()
  const servedIdsBy = new Map<unknown, Set<number>>()
  // The requests the provider has served. A request without a predicate
  // covers every row.
  const servedRequests: Array<LoadSubsetOptions> = []
  // Loader requests per consumer subscription. The first query starts its
  // sync run before any peer, so the first request is its own.
  const requestsBy = new Map<unknown, number>()
  let firstSubscription: unknown
  // A refetching provider has skipped a change since its last refetch, so
  // the Collection may lag the rows and the window laws wait for a refetch.
  let stale = false
  // Read through a call: the provider's callbacks assign `stale`, which the
  // step loop's control flow cannot see.
  const lagging = () => stale
  const matches = (expression: unknown, row: Row) =>
    evaluateReferenceExpression(
      expression as Parameters<typeof evaluateReferenceExpression>[0],
      row,
    ) === true
  const matchesServedSubset = (row: Row) =>
    servedRequests.some(
      ({ where }) => where === undefined || matches(where, row),
    )
  const sameRow = (left: Row | undefined, right: Row) =>
    left !== undefined &&
    Object.is(left.rank, right.rank) &&
    left.eligible === right.eligible &&
    left.label === right.label &&
    left.link === right.link
  // One commit that sends the changed rows and removes the given sent rows.
  // A load settles only after its writes apply, so this returns the commit's
  // applied receipt, which is a promise while the transaction is queued.
  function send(
    page: Array<Row>,
    removed: Array<number> = [],
  ): true | Promise<void> {
    const changed = page.filter((row) => !sameRow(sent.get(row.id), row))
    if (changed.length === 0 && removed.length === 0) return true
    syncControls!.begin()
    for (const row of changed) {
      syncControls!.write({
        type: sent.has(row.id) ? `update` : `insert`,
        value: { ...row },
      })
      sent.set(row.id, { ...row })
    }
    for (const rowId of removed) {
      syncControls!.write({ type: `delete`, value: sent.get(rowId)! })
      sent.delete(rowId)
    }
    const applied = syncControls!.commit()
    return applied === true ? true : applied.then(() => undefined)
  }
  // The last row of each nonempty, limited, ordered answer: the boundary
  // of its served range. A short answer does not prove source exhaustion
  // (glossary), so its range also ends at its last row.
  const rangeEnds = new Map<LoadSubsetOptions, Row>()
  // Requests a holding provider has not answered yet, oldest first. Holding
  // starts after the initial load.
  const heldRequests: Array<{
    options: LoadSubsetOptions
    resolve: () => void
    reject: (error: unknown) => void
    // Aborted or unloaded, but answered anyway: its rows install and its
    // load fulfills after they become visible.
    answeredAfterAbort?: boolean
  }> = []
  let holding = false
  const inFlight = () => heldRequests.length > 0
  // Whether the current step changed rows while a held load was in flight,
  // and how many steps of this case did.
  let stepChangedInFlight = false
  let caseHeldChanges = 0
  let caseHeldRequests = 0
  // Held requests a late provider answered after their abort.
  let lateAnswers = 0
  // Held requests a cooperative provider cancelled (once each: the unload
  // after an abort finds the request already gone).
  let cooperativeCancels = 0
  const noteChange = () => {
    if (holding && inFlight()) stepChangedInFlight = true
  }
  // Read through a call, as `lagging` is: the write callbacks assign it.
  const changedInFlight = () => stepChangedInFlight
  const ledgerHasRoot = (rowId: number) =>
    [...sent.values()].some((row) => (row.link ?? row.id) === rowId)
  // An abort (or an adapter unload) of a held request. Cancellation is
  // cooperative (LoadSubsetOptions.signal): a cooperative provider installs
  // none of its rows and fulfills its load at once. A provider that cannot
  // cancel in-flight work answers it anyway at its `answer` step, installing
  // its rows, and fulfills the load after they become visible. Neither
  // counts the request as served.
  const dropHeld = (options: LoadSubsetOptions): boolean => {
    const index = heldRequests.findIndex((entry) => entry.options === options)
    if (index === -1) return false
    if (testCase.cancellation === `late`) {
      heldRequests[index]!.answeredAfterAbort = true
      return true
    }
    cooperativeCancels++
    heldRequests.splice(index, 1)[0]!.resolve()
    return true
  }
  // A loader that keeps asking never reaches a fixed point. The provider
  // stops answering and records it; every step asserts that it did not.
  let runaway = false
  // Requests for the whole source: no predicate, cursor, or limit.
  let fullSourceRequests = 0
  // The rows each served request last returned, at its answer or at the
  // latest refetch. A refetching provider keeps exactly these rows.
  const lastAnswered = new Map<LoadSubsetOptions, Set<number>>()
  let refetchedAnswers = new Map<LoadSubsetOptions, Set<number>>()
  // Bounded pages that ended on a null or NaN rank. Neither can be
  // expressed as a cursor (canExpressCursorOrder), so the loader then takes
  // the documented full-source fallback.
  let unexpressiblePageEnds = 0
  // Reports that the first query's own page proved, so it owed no request,
  // and the first query's request count before the latest such report.
  let ignoredProvenReports = 0
  // Signalling refetches of an unindexed plan where the full-source law
  // applied, and where the documented short-prefix fallback excused it.
  let unindexedRefetchChecks = 0
  let shortUnindexedRefills = 0
  let provenReportRequestsBefore: number | undefined
  // Set by such a report until a step that can change source ordering, and
  // the first repair request the first query issued meanwhile.
  let provenSinceOrderingChange = false
  let repairAfterProvenReport: string | undefined
  function servePage(options: LoadSubsetOptions): true | Promise<void> {
    firstSubscription ??= options.subscription
    // A repair marks its requests `refetch: true`. After a report the first
    // query's own page proved, it owes none until ordering changes again.
    if (
      provenSinceOrderingChange &&
      options.subscription === firstSubscription &&
      options.refetch === true
    ) {
      repairAfterProvenReport ??= `request ${providerRequests + 1}`
    }
    requestsBy.set(
      options.subscription,
      (requestsBy.get(options.subscription) ?? 0) + 1,
    )
    providerRequests++
    if (providerRequests > 4 * rows.size + 100) {
      // A rejected load is a provider failure the loader must handle, so it
      // stops a loader that asks synchronously; the flag reports it.
      runaway = true
      return Promise.reject(new Error(`ordered loading did not stop`))
    }
    if (!options.where && !options.cursor && options.limit === undefined) {
      fullSourceRequests++
    }
    if (!holding) return answer(options)
    // A request whose signal is already aborted starts no work: it installs
    // no rows and its load fulfills.
    if (options.signal?.aborted) return true
    caseHeldRequests++
    return new Promise((resolve, reject) => {
      heldRequests.push({ options, resolve, reject })
      options.signal?.addEventListener(`abort`, () => dropHeld(options))
    })
  }
  // Answers one held request from the current rows and fulfills its load
  // once the rows apply.
  // The held load fulfills when the applied receipt fulfills, and rejects
  // if it rejects; a rejection also fails the step.
  async function answerOldest(): Promise<void> {
    const { options, resolve, reject, answeredAfterAbort } =
      heldRequests.shift()!
    if (answeredAfterAbort) lateAnswers++
    const applied = answeredAfterAbort
      ? send(pageFor(options))
      : answer(options)
    try {
      if (applied !== true) await applied
      resolve()
    } catch (error) {
      // No signal or cleanup rejects a receipt here, so a rejection is an
      // invariant violation: reject the held load and fail the step.
      reject(error)
      throw error
    }
  }
  // A request counts as served once it is answered.
  function answer(options: LoadSubsetOptions): true | Promise<void> {
    servedRequests.push(options)
    const page = pageFor(options)
    lastAnswered.set(options, new Set(page.map((row) => row.id)))
    if (options.orderBy && options.limit !== undefined && page.length > 0) {
      rangeEnds.set(options, { ...page.at(-1)! })
      // Generated rows may carry a null rank behind the `number` row type.
      const end = page.at(-1)!.rank as number | null
      if (end == null || Number.isNaN(end)) unexpressiblePageEnds++
    }
    served += page.length
    servedBy.set(
      options.subscription,
      (servedBy.get(options.subscription) ?? 0) + page.length,
    )
    const ids = servedIdsBy.get(options.subscription) ?? new Set<number>()
    for (const row of page) ids.add(row.id)
    servedIdsBy.set(options.subscription, ids)
    return send(page)
  }
  // A refetch keeps every served ordered range whole, as the LoadSubset
  // contract requires: it sends every row that now sorts from the start of
  // the order through the last order value a limited page returned, so a
  // row that moves between two pages still arrives. A request without a
  // limit or an order re-runs as it is. Rows in no range leave, as a
  // query-db-collection refetch removes rows no query holds. (query-db
  // re-runs each page alone and reports the shift instead; the signalling
  // provider below models that.)
  const coverage = (options: LoadSubsetOptions): Array<Row> => {
    const end = rangeEnds.get(options)
    if (end === undefined) return pageFor(options)
    const { direction, nulls } = options.orderBy![0]!.compareOptions
    // A sentinel at the end value sorts after every row tied with it. It
    // bypasses the predicate, which may reject its id or eligibility.
    const sentinel = { ...end, id: Number.MAX_SAFE_INTEGER, eligible: true }
    const ordered = eagerOrder(
      new Map(
        [
          ...[...rows.values()].filter(
            (row) => !options.where || matches(options.where, row),
          ),
          sentinel,
        ].map((row) => [row.id, { ...row, eligible: true }]),
      ),
      { ...testCase, direction, nulls },
    )
    const endIndex = ordered.findIndex((row) => row.id === sentinel.id)
    if (endIndex === -1) throw new Error(`coverage sentinel missing`)
    return ordered.slice(0, endIndex).map((row) => rows.get(row.id)!)
  }
  // On an adapter unload, a refetching provider (like query-db-collection)
  // drops the request and removes the rows that no
  // remaining request's last answer holds. It sends nothing new. A
  // forwarding provider keeps what it sent.
  function unload(options: LoadSubsetOptions): void {
    if (dropHeld(options)) return
    const index = servedRequests.indexOf(options)
    if (!refetching || index === -1) return
    servedRequests.splice(index, 1)
    rangeEnds.delete(options)
    lastAnswered.delete(options)
    const kept = new Set(
      [...lastAnswered.values()].flatMap((rowIds) => [...rowIds]),
    )
    const removed = [...sent.keys()].filter((rowId) => !kept.has(rowId))
    if (removed.length > 0) void send([], removed)
  }
  // A signalling refetch re-runs each served request alone, so a row that
  // now sorts between two answers is in neither. It reports the shift once
  // the rows apply, and only when some answer changed; the contract lets a
  // sync adapter report whenever its pages may have shifted, so this
  // provider judges the loader's response, not query-db's gate.
  async function refetch(): Promise<boolean> {
    const current = new Map<number, Row>()
    let changed = false
    for (const request of servedRequests) {
      const covered = signalsRefetch ? pageFor(request) : coverage(request)
      const ids = new Set(covered.map((row) => row.id))
      const before = lastAnswered.get(request)
      if (
        !before ||
        before.size !== ids.size ||
        [...ids].some((rowId) => !before.has(rowId))
      ) {
        changed = true
      }
      lastAnswered.set(request, ids)
      for (const row of covered) current.set(row.id, row)
    }
    // The answers as this refetch produced them, before a report's repair
    // can retire the requests that gave them.
    refetchedAnswers = new Map(
      [...lastAnswered].map(([request, ids]) => [request, new Set(ids)]),
    )
    const applied = send(
      [...current.values()],
      [...sent.keys()].filter((rowId) => !current.has(rowId)),
    )
    if (applied !== true) await applied
    stale = false
    if (signalsRefetch && changed) {
      syncControls!.invalidateLoadedSubsets()
      // Core reports in a microtask; the repair then runs its requests.
      await flushPromises()
    }
    return signalsRefetch && changed
  }
  // The first query's own served requests, when they are only its first
  // page and one tie request: the answers a report could change for it.
  function firstPageAnswers():
    | {
        page: LoadSubsetOptions
        tie: LoadSubsetOptions
        pageIds: Set<number>
        tieIds: Set<number>
      }
    | undefined {
    if (testCase.filter !== `source` || inFlight()) return
    const own = servedRequests.filter(
      (options) => options.subscription === firstSubscription,
    )
    const size = shown.offset + shown.limit
    const page = own.find(
      (options) =>
        options.orderBy !== undefined &&
        options.cursor === undefined &&
        options.limit === size,
    )
    const tie = own.find(
      (options) => options.where !== undefined && options.orderBy === undefined,
    )
    const pageIds = page && lastAnswered.get(page)
    const tieIds = tie && lastAnswered.get(tie)
    if (own.length !== 2 || !page || !tie || !pageIds || !tieIds) return
    return { page, tie, pageIds: new Set(pageIds), tieIds: new Set(tieIds) }
  }
  // After a refetch, the first query's window is proven by its own page
  // alone when the refetch left its page and tie answers unchanged, the page
  // holds the model's first rows through a plain numeric end, the tie reads
  // that end, and the model's next row sorts strictly after the end and is
  // installed. Then a report has nothing to repair for it.
  function provenFirstPage(
    before: NonNullable<ReturnType<typeof firstPageAnswers>>,
  ): boolean {
    // Read the answers of the requests judged before the refetch. Requests
    // the step added, such as a repair, must not hide the premise.
    const pageIds = refetchedAnswers.get(before.page)
    const tieIds = refetchedAnswers.get(before.tie)
    if (!pageIds || !tieIds) return false
    const after = { ...before, pageIds, tieIds }
    const sameIds = (left: Set<number>, right: Set<number>) =>
      left.size === right.size && [...left].every((key) => right.has(key))
    const size = shown.offset + shown.limit
    const ordered = eagerOrder(rows, shown)
    const end = ordered[size - 1]
    const next = ordered[size]
    const endRank = end?.rank as number | null | undefined
    return (
      sameIds(before.pageIds, after.pageIds) &&
      sameIds(before.tieIds, after.tieIds) &&
      end !== undefined &&
      next !== undefined &&
      endRank != null &&
      !Number.isNaN(endRank) &&
      !Object.is(next.rank, endRank) &&
      sent.has(next.id) &&
      after.pageIds.size === size &&
      ordered.slice(0, size).every((row) => after.pageIds.has(row.id)) &&
      // The tie admits the end's rank and nothing on either side of it.
      matches(after.tie.where, end) &&
      !matches(after.tie.where, { ...end, rank: endRank + 0.5 }) &&
      !matches(after.tie.where, { ...end, rank: endRank - 0.5 })
    )
  }
  function pageFor(options: LoadSubsetOptions): Array<Row> {
    let page = [...rows.values()].filter(
      (row) =>
        (!options.where || matches(options.where, row)) &&
        (!options.cursor || matches(options.cursor.whereFrom, row)),
    )
    if (options.orderBy) {
      // Serve the order the request names, not the query's: a loader that
      // asks for the wrong direction or null placement gets the wrong rows.
      const { direction, nulls } = options.orderBy[0]!.compareOptions
      const order = eagerOrder(
        new Map(page.map((row) => [row.id, { ...row, eligible: true }])),
        { ...testCase, direction, nulls },
      ).map((row) => row.id)
      const pageRows = new Map(page.map((row) => [row.id, row]))
      page = order.map((rowId) => pageRows.get(rowId)!)
      // `offset` is the alternative to `cursor` (LoadSubsetOptions), so a
      // provider applies it only to a request without a cursor.
      if (!options.cursor) page = page.slice(options.offset ?? 0)
      if (options.limit !== undefined) page = page.slice(0, options.limit)
    }
    return page
  }
  // A live source write. A forwarding provider sends changes for rows it
  // has sent, and for rows that now match a subset it has served (inserted);
  // it writes nothing for any other row. A refetching provider writes
  // nothing until its next refetch.
  const sourceWrite = (type: `insert` | `update` | `delete`, value: Row) => {
    if (refetching) {
      stale = true
      return
    }
    const installed = sent.has(value.id)
    if (
      testCase.path === `on-demand` &&
      !installed &&
      (type === `delete` || !matchesServedSubset(value))
    ) {
      return
    }
    noteChange()
    if (type === `delete`) sent.delete(value.id)
    else sent.set(value.id, { ...value })
    syncControls!.begin()
    syncControls!.write({
      type:
        type === `delete`
          ? `delete`
          : testCase.path === `on-demand`
            ? installed
              ? `update`
              : `insert`
            : type,
      value,
    })
    syncControls!.commit()
  }
  if (testCase.indexed) {
    source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: testCase.nulls ?? `first`,
          stringSort: `locale`,
        },
      },
    })
  }
  // A joined filter keeps eligibility on markers. A marker has its own key;
  // its `rowId` is the join key, so several markers can match one row.
  // The model keeps its own copy of every marker it writes, so the expected
  // rows never come from the Collection under test.
  let nextMarkerKey = 100_000
  const markerModel = new Map<number, JoinMarker>()
  const marker = (rowId: number): JoinMarker => {
    const entry = { key: nextMarkerKey++, rowId }
    markerModel.set(entry.key, entry)
    return { ...entry }
  }
  const markers = createCollection(
    localOnlyCollectionOptions<JoinMarker, number>({
      id: `${id}-markers`,
      getKey: (entry) => entry.key,
      initialData: !(joined || fullJoin)
        ? []
        : viaLink
          ? [
              ...Array.from({ length: 30 }, (_, rowId) => rowId),
              ...[...rows.keys()].filter((rowId) => rowId >= 1000),
            ].map(marker)
          : [...rows.values()]
              // A full join's markers are sparse: fillers have none, so a
              // window can need far fewer root rows than the source holds.
              .filter(
                (row) =>
                  row.eligible === admitsWhenMatched &&
                  !(fullJoin && row.id >= 1000),
              )
              .map((row) => marker(row.id))
              .concat((testCase.orphans ?? []).map(marker)),
    }),
  )
  // Source changes committed by the current step. A joined step can change a
  // row and its marker in two commits, and each commit may publish.
  let commits = 0
  const setMarker = async (rowId: number, eligible: boolean) => {
    // Under `link`, the root write already moved the row's join key.
    if (!(joined || fullJoin) || viaLink) return
    const matched = eligible === admitsWhenMatched
    const current = markersOf(rowId)
    if (matched === current.length > 0) return
    commits++
    // A marker changes a result row only while the Collection holds a root
    // row it matches (the ledger).
    if (ledgerHasRoot(rowId)) noteChange()
    if (!matched) for (const { key } of current) markerModel.delete(key)
    await (
      matched
        ? markers.insert(marker(rowId))
        : markers.delete(current.map(({ key }) => key))
    ).when(`settled`)
  }
  const markersOf = (rowId: number) =>
    [...markerModel.values()].filter((entry) => entry.rowId === rowId)
  // One result row's identity: a matched pair is its marker, a root row
  // without a marker is the row, and a rootless row is -1 - its marker.
  const resultId = (row: Row | undefined, match: JoinMarker | undefined) =>
    row && match ? PAIR_ID + match.key : row ? row.id : -1 - match!.key
  // Work has two counts: rows a local snapshot reads for the query, and rows
  // the source delivers to it, which include index refills. Both are bounded.
  let read = 0
  const readSnapshot = source.currentStateAsChanges.bind(source)
  source.currentStateAsChanges = ((...args) => {
    const result = readSnapshot(...args)
    read += result?.length ?? 0
    return result
  }) as typeof source.currentStateAsChanges
  let delivered = 0
  const subscribe = source.subscribeChanges.bind(source)
  source.subscribeChanges = ((callback, options) =>
    subscribe((changes) => {
      delivered += changes.length
      callback(changes)
    }, options)) as typeof source.subscribeChanges
  // Scan: installed rows a change visits.
  let scanned = 0
  const entries = source.entries.bind(source)
  source.entries = function* () {
    for (const entry of entries()) {
      scanned++
      yield entry
    }
  } as typeof source.entries
  const buildQuery = (
    q: InitialQueryBuilder,
    { offset, limit }: { offset: number; limit: number } = testCase,
  ) => {
    const joinedRows = q
      .from({ row: source })
      .leftJoin({ marker: markers }, ({ row, marker }) =>
        eq(row.link, marker.rowId),
      )
    const ordered = (
      fullJoin
        ? // Same aliases as the LEFT join; only the join kind differs.
          (q
            .from({ row: source })
            .fullJoin({ marker: markers }, ({ row, marker }) =>
              eq(row.link, marker.rowId),
            ) as unknown as typeof joinedRows)
        : joined
          ? admitsWhenMatched
            ? joinedRows.where(({ marker }) => not(isUndefined(marker.rowId)))
            : joinedRows.where(({ marker }) => isUndefined(marker.rowId))
          : testCase.filter === `function`
            ? q.from({ row: source }).fn.where(({ row }) => row.eligible)
            : q.from({ row: source }).where(({ row }) => eq(row.eligible, true))
    ).orderBy(({ row }) => row.rank, {
      direction: testCase.direction,
      nulls: testCase.nulls ?? `first`,
    })
    return (
      testCase.terms === 2 ? ordered.orderBy(({ row }) => row.id) : ordered
    )
      .offset(offset)
      .limit(limit)
  }
  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) => buildQuery(q),
  })
  // The first query's current window, which `move` changes.
  let shown: EagerCase = testCase
  const peerCase: EagerCase = {
    ...testCase,
    offset: 0,
    limit: testCase.offset + testCase.limit + 1,
  }
  let peer = testCase.peer
    ? createLiveQueryCollection({
        startSync: true,
        query: (q) => buildQuery(q, peerCase),
      })
    : undefined
  // Read through a call: `release-peer` clears it inside the step loop.
  const currentPeer = () => peer
  // An Effect runs the same joined query through its own graph loop, so the
  // window law must hold for both consumers. It holds its rows by result key.
  const effectRows = new Map<string | number, number>()
  const effect =
    joined || fullJoin
      ? createEffect({
          query: (q) => buildQuery(q),
          onBatch: (events) => {
            for (const event of events) {
              if (event.type === `exit`) {
                effectRows.delete(event.key)
                continue
              }
              const { row, marker: match } = event.value as {
                row?: Row
                marker?: JoinMarker
              }
              effectRows.set(event.key, resultId(row, match))
            }
          },
        })
      : undefined
  // Effect events carry no position; order its rows as the model orders all
  // rows, so a row that should not be visible still shows its rank.
  const effectIds = (sourceRows: ReadonlyMap<number, Row> = rows) => {
    const everyRow = new Map(
      [...modelRows(sourceRows)].map(([rowId, row]) => [
        rowId,
        { ...row, eligible: true },
      ]),
    )
    const order = eagerOrder(everyRow, testCase).map((row) => row.id)
    return [...effectRows.values()].sort(
      (left, right) => order.indexOf(left) - order.indexOf(right),
    )
  }
  // A joined query's rows nest the source row and its marker under their
  // aliases; resultId names each one.
  const visibleIds = (collection: typeof query = query) =>
    collection.toArray.map((result) => {
      if (!(joined || fullJoin)) return (result as Row).id
      const { row, marker: match } = result as unknown as {
        row?: Row
        marker?: JoinMarker
      }
      return resultId(row, match)
    })
  // The query's result rows, from the fixture inputs alone (root rows'
  // `link` and markers' `rowId`), as join semantics define them:
  // - a LEFT-join filter keeps one row per matched (root row, marker) pair;
  // - an anti-join keeps each root row that no marker matches, once;
  // - a full join keeps every pair, each unmatched root row once, and each
  //   unmatched marker as a rootless row, which sorts with the null ranks.
  // The expected result rows over the given source rows: the rows the
  // model holds by default, or the provider's ledger of what it sent.
  const modelRows = (
    sourceRows: ReadonlyMap<number, Row> = rows,
  ): ReadonlyMap<number, Row> => {
    if (!(joined || fullJoin)) return sourceRows
    const model = new Map<number, Row>()
    const matchedRoots = new Set<number>()
    for (const entry of markerModel.values()) {
      const roots = [...sourceRows.values()].filter(
        (row) => row.link === entry.rowId,
      )
      for (const row of roots) {
        matchedRoots.add(row.id)
        if (testCase.filter === `anti-joined`) continue
        model.set(PAIR_ID + entry.key, {
          ...row,
          id: PAIR_ID + entry.key,
          eligible: true,
        })
      }
      if (fullJoin && roots.length === 0) {
        model.set(-1 - entry.key, {
          id: -1 - entry.key,
          rank: null as unknown as number,
          eligible: true,
          label: `marker`,
        })
      }
    }
    if (testCase.filter === `anti-joined` || fullJoin) {
      for (const row of sourceRows.values()) {
        if (!matchedRoots.has(row.id))
          model.set(row.id, { ...row, eligible: true })
      }
    }
    return model
  }
  // On demand, the Collection holds exactly the rows the provider sent, and
  // a live query shows its window over those rows. This holds after every
  // step, also while a refetching provider lags the model's rows.
  const ledgerRows = (rowsToList: Iterable<Row>) =>
    [...rowsToList]
      .map((row) => [row.id, row.rank, row.eligible, row.label, row.link])
      .sort(([left], [right]) => Number(left) - Number(right))
  const expectProviderLedger = (label: string) => {
    if (testCase.path !== `on-demand`) return
    compareAt(`ordered-work-oracle.property.test.ts:5032`, () =>
      expect(ledgerRows(source.values()), `${label}: Collection rows`).toEqual(
        ledgerRows(sent.values()),
      ),
    )
    // While a load is in flight, a query may keep its last public snapshot.
    if (inFlight()) return
    expectEagerWindow(
      visibleIds(),
      modelRows(sent),
      shown,
      `${label}: rows over the provider ledger`,
    )
    const ledgerPeer = currentPeer()
    if (ledgerPeer) {
      expectEagerWindow(
        visibleIds(ledgerPeer),
        modelRows(sent),
        peerCase,
        `${label}: peer rows over the provider ledger`,
      )
    }
    if (effect) {
      expectEagerWindow(
        effectIds(sent),
        modelRows(sent),
        testCase,
        `${label}: Effect rows over the provider ledger`,
      )
    }
  }
  const window = testCase.offset + testCase.limit
  // A prefix, the rows in a tie group (two or more equal ranks) at a
  // boundary value, a refill, and the changed row.
  const prefixBound = (boundary: Array<number | null>, size: number) => {
    const all = [...rows.values()]
    const ties = all.filter(
      (row) =>
        boundary.some((rank) => Object.is(rank, row.rank)) &&
        all.some(
          (other) => other.id !== row.id && Object.is(other.rank, row.rank),
        ),
    ).length
    return 2 * size + ties + 1
  }
  // The bound for one load: a prefix, the boundary ties, a refill, and the
  // changed row. Null when a boundary value cannot be expressed as a cursor.
  const workBound = (boundary: Array<number | null>): number | undefined => {
    // A joined or function filter drops rows after the source's limit, so a
    // bounded prefix cannot prove the window is the first eligible rows; the
    // loader reads the full source and only the rows law applies.
    if (!testCase.indexed || testCase.terms !== 1) return undefined
    // A full join reads its full source too: a rootless row cannot be shown
    // unmatched until every root row has loaded.
    if (testCase.filter !== `source`) return undefined
    if (boundary.some((rank) => rank == null || Number.isNaN(rank))) return
    return prefixBound(boundary, shown.offset + shown.limit)
  }
  // Publication: a change publishes its window once. Each batch a subscriber
  // receives must already show the window the change produces.
  const published: Array<Array<number>> = []
  let unsubscribe: (() => void) | undefined
  try {
    await query.preload()
    await peer?.preload()
    expectEagerWindow(visibleIds(), modelRows(), testCase, `initial rows`)
    if (peer) {
      expectEagerWindow(
        visibleIds(peer),
        modelRows(),
        peerCase,
        `initial peer rows`,
      )
    }
    expectProviderLedger(`initial`)
    compareAt(`ordered-work-oracle.property.test.ts:5105`, () =>
      expect(runaway, `loading reached a fixed point at the initial load`).toBe(
        false,
      ),
    )
    if (effect) {
      await flushPromises()
      expectEagerWindow(
        effectIds(),
        modelRows(),
        testCase,
        `initial Effect rows`,
      )
    }
    // The subscriber starts with every visible key, so it receives each
    // later change to them, including a removal.
    const subscription = query.subscribeChanges(
      () => {
        published.push(visibleIds())
      },
      { includeInitialState: true },
    )
    unsubscribe = () => subscription.unsubscribe()
    // A joined filter needs the whole on-demand source only when the first
    // window's worth of source rows, in query order, cannot prove the
    // window: one fails the join, or a boundary value is null or NaN and
    // cannot be a cursor. When every such row passes, the initial load
    // must not request the whole source.
    if (testCase.path === `on-demand` && joined && !peer) {
      const sourceOrder = eagerOrder(
        new Map(
          [...rows].map(([rowId, row]) => [rowId, { ...row, eligible: true }]),
        ),
        testCase,
      )
      const prefix = sourceOrder.slice(0, window + 1)
      const passesJoin = (row: Row) =>
        markersOf(row.link ?? row.id).length > 0 === admitsWhenMatched
      const proven =
        prefix.slice(0, window).every(passesJoin) &&
        // Generated rows may carry a null rank behind the `number` row type.
        prefix.every(
          (row) =>
            (row.rank as number | null) != null && !Number.isNaN(row.rank),
        )
      if (proven) {
        compareAt(`ordered-work-oracle.property.test.ts:5149`, () =>
          expect(
            fullSourceRequests,
            `full-source requests by the initial load of a proven prefix`,
          ).toBe(0),
        )
        // A bounded but oversized read also fails: each consumer (the query
        // and its Effect load separately) receives at most the prefix, its
        // boundary ties, and a refill, and never more distinct rows than the
        // source holds.
        const consumerBound = prefixBound(
          prefix.map((row): number | null => row.rank).slice(-2),
          window,
        )
        for (const [consumer, consumerServed] of servedBy) {
          compareAt(`ordered-work-oracle.property.test.ts:5162`, () =>
            expect(
              consumerServed,
              `rows one consumer is served by the initial load of a proven prefix`,
            ).toBeLessThanOrEqual(consumerBound),
          )
          compareAt(`ordered-work-oracle.property.test.ts:5166`, () =>
            expect(
              servedIdsBy.get(consumer)!.size,
              `distinct rows one consumer is served by the initial load`,
            ).toBeLessThanOrEqual(Math.min(consumerBound, rows.size)),
          )
        }
      }
    }
    // The work laws count one consumer, so a peer query turns them off.
    const initialBound = peer
      ? undefined
      : workBound(boundaryRanks(rows, testCase))
    // On demand, the provider's transfer is bounded; the local snapshot
    // delivers every installed row, so read and delivered counts are not.
    if (initialBound !== undefined && testCase.path === `on-demand`) {
      compareAt(`ordered-work-oracle.property.test.ts:5180`, () =>
        expect(served, `rows served by the initial load`).toBeLessThanOrEqual(
          initialBound,
        ),
      )
    } else if (initialBound !== undefined) {
      compareAt(`ordered-work-oracle.property.test.ts:5184`, () =>
        expect(read, `rows read by the initial load`).toBeLessThanOrEqual(
          initialBound,
        ),
      )
      compareAt(`ordered-work-oracle.property.test.ts:5187`, () =>
        expect(
          delivered,
          `rows delivered by the initial load`,
        ).toBeLessThanOrEqual(initialBound),
      )
    }
    // While a load is in flight, a query may hold the window it showed at
    // the previous checkpoint. A window that changes shows only distinct rows
    // from the provider's ledger that pass the query, in the query's order.
    let previousShown = visibleIds()
    let previousPeerShown = peer ? visibleIds(peer) : []
    const expectInFlightWindow = (
      shownIds: Array<number>,
      previous: Array<number>,
      windowCase: EagerCase,
      label: string,
    ) => {
      if (JSON.stringify(shownIds) === JSON.stringify(previous)) return
      const ledger = modelRows(sent)
      const position = new Map(
        eagerOrder(ledger, windowCase).map((row, index) => [row.id, index]),
      )
      compareAt(`ordered-work-oracle.property.test.ts:5208`, () =>
        expect(
          shownIds.filter((rowId) => !position.has(rowId)),
          `${label}: rows the ledger does not admit`,
        ).toEqual([]),
      )
      compareAt(`ordered-work-oracle.property.test.ts:5212`, () =>
        expect(new Set(shownIds).size, `${label}: distinct rows`).toBe(
          shownIds.length,
        ),
      )
      for (const [index, rowId] of shownIds.slice(1).entries()) {
        const predecessor = shownIds[index]!
        // `null` and `undefined` ranks tie, so either may come first.
        const sameRank = Object.is(
          ledger.get(predecessor)?.rank ?? null,
          ledger.get(rowId)?.rank ?? null,
        )
        compareAt(`ordered-work-oracle.property.test.ts:5222`, () =>
          expect(
            sameRank || position.get(predecessor)! < position.get(rowId)!,
            `${label}: rows in query order`,
          ).toBe(true),
        )
      }
    }
    // Moves on a holding provider settle after `drain`.
    const heldMoves: Array<{ settled: boolean; error?: unknown }> = []
    // A refetching provider ends with a refetch, so the last step shows
    // the rows.
    // A holding provider ends by answering every held request.
    const held = testCase.path === `on-demand` && testCase.latency === `held`
    holding = held
    const history: Array<EagerCommand> = [
      ...testCase.history,
      ...(refetching ? [{ type: `refetch` as const }] : []),
      ...(held ? [{ type: `drain` as const }] : []),
    ]
    for (const [step, generated] of history.entries()) {
      if (generated.type === `refetch` && !refetching) continue
      if (
        (generated.type === `answer` || generated.type === `drain`) &&
        !held
      ) {
        continue
      }
      if (generated.type === `answer` && !inFlight()) continue
      if (generated.type === `release-peer` && !held) continue
      // Resolve a visible-row delete against the model's current window.
      const visibleId = eagerWindow(rows, shown)[0]
      if (generated.type === `delete-visible` && visibleId === undefined) {
        continue
      }
      const command: Exclude<EagerCommand, { type: `delete-visible` }> =
        generated.type === `delete-visible`
          ? { type: `delete`, id: visibleId! }
          : generated
      const before = `id` in command ? rows.get(command.id) : undefined
      const boundaryBefore = boundaryRanks(rows, shown)
      const sizeBefore = rows.size
      read = 0
      delivered = 0
      scanned = 0
      served = 0
      published.length = 0
      commits = 1
      const requestsBefore = providerRequests
      const visibleBefore = JSON.stringify(visibleIds())
      stepChangedInFlight = false
      // Only a window move keeps a proven report's no-repair premise; any
      // other step can change source ordering.
      if (command.type !== `move`) provenSinceOrderingChange = false
      if (command.type === `refetch`) {
        const fullSourceBefore = fullSourceRequests
        const unexpressibleBefore = unexpressiblePageEnds
        const firstAnswers = firstPageAnswers()
        const firstRequestsBefore = requestsBy.get(firstSubscription) ?? 0
        const installedBefore = new Map(sent)
        const reported = await refetch()
        // A delete or rank change of an installed row that the first query's
        // subscription received starts the repair path by itself
        // (ARCHITECTURE.md), so only a refetch that changes neither is judged.
        // A source-filter subscription receives every eligible row.
        const keptInstalledRows = [...installedBefore.values()]
          .filter((row) => row.eligible)
          .every((row) => {
            const now = sent.get(row.id)
            return now !== undefined && Object.is(now.rank, row.rank)
          })
        // A report that changes nothing the first query's own page proves
        // starts no request for it (ARCHITECTURE.md: a window inside the
        // loader's own first page needs no repair).
        // The report's repair would start on a later pass, so the step's
        // checkpoint judges it.
        if (
          reported &&
          keptInstalledRows &&
          firstAnswers &&
          provenFirstPage(firstAnswers)
        ) {
          provenReportRequestsBefore = firstRequestsBefore
        }
        // The repair a report starts reads each window's bounded prefix,
        // tie, and refill; a whole-source read would be the cost the report
        // exists to avoid. One documented fallback reads the full source
        // instead: a page that ends on a null or NaN rank. An unindexed plan
        // whose bounded prefix leaves the window short grows the prefix
        // (ARCHITECTURE.md, "an underfilled unindexed prefix grows").
        const shortRefill =
          !testCase.indexed && prefixLeavesWindowShort(rows, shown)
        if (signalsRefetch && unexpressiblePageEnds === unexpressibleBefore) {
          if (!testCase.indexed) {
            if (shortRefill) shortUnindexedRefills++
            else unindexedRefetchChecks++
          }
        }
        if (signalsRefetch && unexpressiblePageEnds === unexpressibleBefore) {
          compareAt(`ordered-work-oracle.property.test.ts:5319`, () =>
            expect(
              fullSourceRequests,
              `full-source requests after a signalling refetch at step ${step}`,
            ).toBe(fullSourceBefore),
          )
        }
      } else if (command.type === `move`) {
        shown = { ...testCase, offset: command.offset, limit: command.limit }
        // A held load can block the move's settlement, so a holding history
        // moves without waiting; `drain` settles it.
        const settled = query.utils.setWindow({
          offset: command.offset,
          limit: command.limit,
        })
        if (settled !== true && !held) await settled
        else if (settled !== true) {
          const move: { settled: boolean; error?: unknown } = {
            settled: false,
          }
          heldMoves.push(move)
          settled.then(
            () => (move.settled = true),
            (error: unknown) => {
              move.settled = true
              move.error = error
            },
          )
        }
      } else if (command.type === `release-peer`) {
        const released = currentPeer()
        if (!released) continue
        peer = undefined
        await released.cleanup()
      } else if (command.type === `answer`) {
        await answerOldest()
      } else if (command.type === `drain`) {
        commits = 0
        while (inFlight()) {
          commits++
          await answerOldest()
          await flushPromises()
        }
        // No load fails here, so every held move must settle successfully.
        compareAt(`ordered-work-oracle.property.test.ts:5361`, () =>
          expect(
            heldMoves.filter((move) => !move.settled || move.error),
            `window moves unsettled or rejected after drain`,
          ).toEqual([]),
        )
      } else if (command.type === `delete`) {
        if (!before) continue
        rows.delete(command.id)
        if (testCase.path !== `local-only`) {
          sourceWrite(`delete`, before)
        } else {
          await source.delete(command.id).when(`settled`)
        }
        // A full join keeps the marker, which becomes a rootless row. An
        // anti-join's deleted row needs no marker change.
        if (!fullJoin && admitsWhenMatched) {
          await setMarker(command.id, false)
        }
      } else if (command.type === `flip`) {
        if (!before) continue
        const eligible = !before.eligible
        const next = {
          ...before,
          eligible,
          link: linkFor(command.id, eligible),
        }
        rows.set(command.id, next)
        if (testCase.path !== `local-only`) {
          sourceWrite(`update`, next)
        } else {
          await source
            .update(command.id, (draft) => {
              draft.eligible = next.eligible
              draft.link = next.link
            })
            .when(`settled`)
        }
        await setMarker(command.id, eligible)
      } else if (command.type === `dup`) {
        if (!(joined || fullJoin) || viaLink || !before) continue
        if (markersOf(before.link ?? before.id).length === 0) continue
        if (ledgerHasRoot(before.link ?? before.id)) noteChange()
        await markers.insert(marker(before.link ?? before.id)).when(`settled`)
      } else if (command.type === `touch`) {
        if (!before) continue
        const next = { ...before, label: `touched-${step}` }
        rows.set(command.id, next)
        if (testCase.path !== `local-only`) {
          sourceWrite(`update`, next)
        } else {
          await source
            .update(command.id, (draft) => {
              draft.label = next.label
            })
            .when(`settled`)
        }
      } else {
        const next = {
          id: command.id,
          rank: command.rank,
          eligible: command.eligible,
          label: `row`,
          link: linkFor(command.id, command.eligible),
        }
        rows.set(command.id, next)
        if (testCase.path !== `local-only`) {
          sourceWrite(before ? `update` : `insert`, next)
        } else if (before) {
          await source
            .update(command.id, (draft) => {
              draft.rank = next.rank
              draft.eligible = next.eligible
              draft.link = next.link
            })
            .when(`settled`)
        } else {
          await source.insert(next).when(`settled`)
        }
        await setMarker(command.id, next.eligible)
      }
      await flushPromises()
      // While a refetching provider lags the rows, the Collection holds an
      // older state, so the window is checked over the provider's ledger
      // until the next refetch.
      compareAt(`ordered-work-oracle.property.test.ts:5444`, () =>
        expect(runaway, `loading reached a fixed point by step ${step}`).toBe(
          false,
        ),
      )
      if (changedInFlight()) caseHeldChanges++
      expectProviderLedger(`after step ${step}`)
      if (provenReportRequestsBefore !== undefined) {
        ignoredProvenReports++
        compareAt(`ordered-work-oracle.property.test.ts:5451`, () =>
          expect(
            (requestsBy.get(firstSubscription) ?? 0) -
              provenReportRequestsBefore!,
            `requests the first query issued for a report its own page proves, at step ${step}`,
          ).toBe(0),
        )
        provenReportRequestsBefore = undefined
        provenSinceOrderingChange = true
      }
      compareAt(`ordered-work-oracle.property.test.ts:5458`, () =>
        expect(
          repairAfterProvenReport,
          `a repair the first query issued after a report its own page proved, by step ${step}`,
        ).toBeUndefined(),
      )
      if (inFlight()) {
        expectInFlightWindow(
          visibleIds(),
          previousShown,
          shown,
          `in-flight rows after step ${step}`,
        )
        const inFlightPeer = currentPeer()
        if (inFlightPeer) {
          expectInFlightWindow(
            visibleIds(inFlightPeer),
            previousPeerShown,
            peerCase,
            `in-flight peer rows after step ${step}`,
          )
        }
      }
      previousShown = visibleIds()
      const stepPeer = currentPeer()
      previousPeerShown = stepPeer ? visibleIds(stepPeer) : []
      if (!lagging() && !inFlight()) {
        expectEagerWindow(
          visibleIds(),
          modelRows(),
          shown,
          `rows after step ${step}`,
        )
        if (stepPeer) {
          expectEagerWindow(
            visibleIds(stepPeer),
            modelRows(),
            peerCase,
            `peer rows after step ${step}`,
          )
        }
      }
      if (effect && !lagging() && !inFlight()) {
        expectEagerWindow(
          effectIds(),
          modelRows(),
          testCase,
          `Effect rows after step ${step}`,
        )
      }
      // Each commit publishes at most once, and the commit that completes
      // the step publishes the final window. With one commit, every batch
      // shows it. A step that changes the visible rows (their keys or order)
      // publishes at least once; the subscriber holds every visible key, so
      // no change is filtered away. An on-demand repair or refill can publish
      // an intermediate window after each provider round trip (#2131), so a
      // step allows one more publication per provider request it made, and
      // only its last must show the final window.
      if (JSON.stringify(visibleIds()) !== visibleBefore) {
        compareAt(`ordered-work-oracle.property.test.ts:5515`, () =>
          expect(
            published.length,
            `publications by step ${step}`,
          ).toBeGreaterThan(0),
        )
      }
      const requests = providerRequests - requestsBefore
      const onDemand = requests > 0
      compareAt(`ordered-work-oracle.property.test.ts:5522`, () =>
        expect(
          published.length,
          `publications by step ${step}`,
        ).toBeLessThanOrEqual(commits + requests),
      )
      for (const publishedWindow of lagging() || inFlight()
        ? []
        : commits === 1 && !onDemand
          ? published
          : published.slice(-1)) {
        expectEagerWindow(
          publishedWindow,
          modelRows(),
          shown,
          `published window at step ${step}`,
        )
      }
      // A post-limit filter plan reads its full source more than once per
      // change on main too (402 of 201 rows here), so the scan law covers
      // source-filter plans, whose bounded read could add a second pass.
      if (
        testCase.filter === `source` &&
        testCase.path !== `on-demand` &&
        !peer &&
        // A window move is not a row change; a two-term move can scan the
        // source four times, which no law here bounds.
        command.type !== `move`
      ) {
        compareAt(`ordered-work-oracle.property.test.ts:5549`, () =>
          expect(scanned, `rows scanned by step ${step}`).toBeLessThanOrEqual(
            Math.max(sizeBefore, rows.size),
          ),
        )
      }
      // A NaN or null boundary cannot be expressed as a cursor
      // (canExpressCursorOrder), so the loader takes the documented
      // full-source fallback; only the rows and scan laws apply then.
      // A refetching provider's loads follow the Collection's older state,
      // so the work law applies only to a forwarding provider.
      const bound =
        refetching || held || peer || command.type === `move`
          ? undefined
          : workBound([...boundaryBefore, ...boundaryRanks(rows, shown)])
      // A bounded step makes at most two loads, each a page and its tie
      // request.
      if (bound !== undefined) {
        compareAt(`ordered-work-oracle.property.test.ts:5565`, () =>
          expect(
            requests,
            `provider requests by step ${step}`,
          ).toBeLessThanOrEqual(4),
        )
      }
      if (bound !== undefined && testCase.path === `on-demand`) {
        compareAt(`ordered-work-oracle.property.test.ts:5571`, () =>
          expect(served, `rows served by step ${step}`).toBeLessThanOrEqual(
            bound,
          ),
        )
      } else if (bound !== undefined) {
        compareAt(`ordered-work-oracle.property.test.ts:5573`, () =>
          expect(read, `rows read by step ${step}`).toBeLessThanOrEqual(bound),
        )
        compareAt(`ordered-work-oracle.property.test.ts:5574`, () =>
          expect(
            delivered,
            `rows delivered by step ${step}`,
          ).toBeLessThanOrEqual(bound),
        )
        // A bounded read walks the index; it never scans the source.
        compareAt(`ordered-work-oracle.property.test.ts:5578`, () =>
          expect(
            scanned,
            `rows scanned by bounded step ${step}`,
          ).toBeLessThanOrEqual(bound),
        )
      }
    }
    compareAt(`ordered-work-oracle.property.test.ts:5584`, () =>
      expect(runaway, `loading reached a fixed point by the end`).toBe(false),
    )
    return {
      heldChanges: caseHeldChanges,
      heldRequests: caseHeldRequests,
      cooperativeCancels,
      lateAnswers,
      ignoredProvenReports,
      unindexedRefetchChecks,
      shortUnindexedRefills,
    }
  } finally {
    unsubscribe?.()
    await effect?.dispose()
    await query.cleanup()
    await currentPeer()?.cleanup()
    await source.cleanup()
    await markers.cleanup()
  }
}

async function observeAcquisitionAcrossTaskTurns(
  initialRequests: number,
  currentRequests: () => number,
): Promise<boolean> {
  for (let turn = 0; turn < OPTIMISTIC_ACQUISITION_OBSERVATION_TURNS; turn++) {
    if (currentRequests() > initialRequests) return true
    await flushPromises()
  }
  return currentRequests() > initialRequests
}

// A stalled held event must report its named checkpoint and enter cleanup;
// an outer test timeout would strand the provider and obscure the violated law.
async function awaitOptimisticCheckpoint<T>(
  checkpoint: string,
  pending: Promise<T>,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`optimistic ${checkpoint} stalled`)),
          2000,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * An optimistic row that leaves an on-demand ordered window is public before
 * its mutation settles. This law does not depend on whether departure comes
 * from a source predicate, a joined or anti-joined predicate, an update, or a
 * delete. It also applies to both live-query Collections and Effects.
 *
 * The independent installed-row model states the public cuts for one
 * six-row base ledger and one pending departure. The legal-history grammar
 * crosses one- and two-row windows, indexed and unindexed loading, all three
 * predicate shapes, both departure operations, both consumers, and
 * acknowledgement or rollback. Two extra histories install replacement extent
 * behind indexed plans, independently of query shape. Production receives each
 * history through a controlled on-demand provider and a real live-query plan.
 *
 * The observation cuts keep distinct responsibilities distinguishable:
 * mutation admission must update rows and callback membership synchronously;
 * missing extent must start one useful acquisition before persistence settles;
 * a provider answer whose real applied receipt is still pending must remain
 * private; and transaction settlement must publish the complete acknowledged
 * window or restore the original rollback window. Later task turns check for
 * immediate repeated work. Collection order and Effect membership are the
 * public observations; exact callback payload coherence remains separately
 * owned.
 */
async function checkOptimisticWindow(
  testCase: OptimisticWindowCase,
): Promise<OptimisticWindowObservation> {
  const { shape, mutation, consumer, outcome, width, indexed, extent } =
    testCase
  const remote = new Map<number, Row>(
    [-1, 0, 1, 2, 3, 4].map((id) => [
      id,
      {
        id,
        rank: testCase.direction === `asc` ? -id : id,
        eligible: id !== 4,
        label: `row`,
        link: id,
      },
    ]),
  )
  let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const sent = new Map<number, Row>()
  const refillStarted = createDeferred<void>()
  const providerAnswer = createDeferred<void>()
  const answerSubmitted = createDeferred<void>()
  const persistence = createDeferred<void>()
  let holdLaterAcquisition = false
  let settlementPhase = `pending`
  const requestHistory: NonNullable<
    OptimisticWindowObservation[`requestHistory`]
  > = []
  const attempts: Array<{
    submittedRows: Array<number>
    limit: number | undefined
    direction: string | undefined
    bounded: boolean
    appliedReceiptSettled: boolean
    providerSettled: boolean
    provider: Promise<unknown>
  }> = []
  let requests = 0
  const persistAuthoritativeMutation = async () => {
    await persistence.promise
    const previous = remote.get(3)!
    const next = {
      ...previous,
      eligible:
        shape === `source` && (!testCase.rankMove || testCase.rankDeparture)
          ? false
          : previous.eligible,
      link: shape === `source` ? previous.link : -previous.id,
      rank: testCase.rankMove ? 0 : previous.rank,
    }
    if (mutation === `delete`) remote.delete(3)
    else remote.set(3, next)
    sync.begin()
    sync.write({
      type: mutation,
      value: mutation === `delete` ? previous : next,
    })
    // This authoritative echo is queued behind the transaction. Its applied
    // receipt must not be mistaken for optimistic-publication permission.
    sync.commit()
  }
  const source = createCollection<Row, number>({
    id: `optimistic-window-${shape}-${mutation}-${consumer}-${outcome}-${Math.random()}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    onUpdate: persistAuthoritativeMutation,
    onDelete: persistAuthoritativeMutation,
    sync: {
      sync: (controls) => {
        sync = controls
        controls.markReady()
        return {
          loadSubset: (options) => {
            requests++
            if (requests > MAX_OPTIMISTIC_WINDOW_REQUESTS) {
              throw new Error(`optimistic ordered loading did not stop`)
            }
            const attempt = holdLaterAcquisition
              ? {
                  submittedRows: [] as Array<number>,
                  limit: options.limit,
                  direction: options.orderBy?.[0]?.compareOptions.direction,
                  bounded:
                    options.limit !== undefined || options.where !== undefined,
                  appliedReceiptSettled: false,
                  providerSettled: false,
                  provider: Promise.resolve(),
                }
              : undefined
            if (attempt) attempts.push(attempt)
            const requestRecord = holdLaterAcquisition
              ? {
                  identity: JSON.stringify({
                    phase: settlementPhase,
                    where: options.where,
                    orderBy: options.orderBy,
                    cursor: options.cursor,
                    offset: options.offset,
                    limit: options.limit,
                    refetch: options.refetch,
                  }),
                  newRows: 0,
                  phase: settlementPhase,
                  submittedRows: [] as Array<number>,
                  limit: options.limit,
                  direction: options.orderBy?.[0]?.compareOptions.direction,
                  allowsRejectedRoot:
                    !options.where ||
                    evaluateReferenceExpression(options.where, {
                      ...remote.get(2)!,
                      eligible: false,
                    }) === true,
                  selectedRanks: [...remote.values()]
                    .filter(
                      (row) =>
                        (!options.where ||
                          evaluateReferenceExpression(options.where, row) ===
                            true) &&
                        (!options.cursor ||
                          evaluateReferenceExpression(
                            options.cursor.whereFrom,
                            row,
                          ) === true),
                    )
                    .map(({ rank }) => rank),
                }
              : undefined
            if (requestRecord) requestHistory.push(requestRecord)
            const answer = () => {
              try {
                let page = [...remote.values()].filter(
                  (row) =>
                    (!options.where ||
                      evaluateReferenceExpression(options.where, row) ===
                        true) &&
                    (!options.cursor ||
                      evaluateReferenceExpression(
                        options.cursor.whereFrom,
                        row,
                      ) === true),
                )
                if (options.orderBy) {
                  const { compareOptions } = options.orderBy[0]!
                  page.sort((left, right) =>
                    compareOptions.direction === `desc`
                      ? right.rank - left.rank
                      : left.rank - right.rank,
                  )
                  if (!options.cursor) page = page.slice(options.offset ?? 0)
                  if (options.limit !== undefined)
                    page = page.slice(0, options.limit)
                }
                if (requestRecord) {
                  requestRecord.newRows = page.filter(
                    ({ id }) => !sent.has(id),
                  ).length
                  requestRecord.submittedRows.push(...page.map(({ id }) => id))
                }
                controls.begin()
                for (const row of page) {
                  controls.write({
                    type: sent.has(row.id) ? `update` : `insert`,
                    value: { ...row },
                  })
                  sent.set(row.id, { ...row })
                }
                if (attempt)
                  attempt.submittedRows.push(...page.map(({ id }) => id))
                const applied = controls.commit()
                if (attempt) {
                  attempt.appliedReceiptSettled = applied === true
                  if (applied !== true) {
                    void applied.then(
                      () => (attempt.appliedReceiptSettled = true),
                      () => (attempt.appliedReceiptSettled = true),
                    )
                  }
                  answerSubmitted.resolve()
                }
                return applied === true ? true : applied.then(() => undefined)
              } catch (error) {
                if (attempt) answerSubmitted.reject(error)
                throw error
              }
            }
            if (!holdLaterAcquisition) return answer()
            refillStarted.resolve()
            const provider = providerAnswer.promise
              .then(answer)
              .then(() => undefined)
            attempt!.provider = provider
            void provider.then(
              () => (attempt!.providerSettled = true),
              () => (attempt!.providerSettled = true),
            )
            return provider.then(() => undefined)
          },
        }
      },
    },
  })
  if (indexed) {
    source.createIndex((row) => row.rank, {
      indexType: BTreeIndex,
      options: {
        compareOptions: {
          direction: `asc`,
          nulls: `first`,
          stringSort: `locale`,
        },
      },
    })
  }
  const markers = createCollection(
    localOnlyCollectionOptions<Marker, number>({
      id: `optimistic-window-markers-${Math.random()}`,
      getKey: (marker) => marker.id,
      initialData:
        shape === `joined`
          ? [1, 2, 3].map((id) => ({ id, rowId: id }))
          : shape === `anti-joined`
            ? [
                { id: 4, rowId: 4 },
                { id: 3, rowId: -3 },
              ]
            : [],
      onUpdate: async () => {
        await persistence.promise
      },
    }),
  )
  markers.createIndex((marker) => marker.rowId, { indexType: BTreeIndex })
  const buildQuery = (q: InitialQueryBuilder) => {
    const direct = q
      .from({ row: source })
      .where(({ row }) => eq(row.eligible, true))
    const left = q
      .from({ row: source })
      .leftJoin({ marker: markers }, ({ row, marker }) =>
        eq(row.link, marker.rowId),
      )
    const filtered =
      shape === `source`
        ? direct
        : shape === `joined`
          ? left.where(({ marker }) => not(isUndefined(marker.rowId)))
          : left.where(({ marker }) => isUndefined(marker.rowId))
    return filtered
      .orderBy(({ row }) => row.rank, testCase.direction ?? `desc`)
      .limit(width)
  }
  const query =
    consumer === `collection`
      ? createLiveQueryCollection({ query: buildQuery })
      : undefined
  const effectRows = new Map<number, Row>()
  const publications: Array<OptimisticWindowPublication> = []
  const resultRow = (value: unknown): Row => {
    const result = value as Row & { row?: Row }
    return result.row ?? result
  }
  const ids = () => {
    if (query) return query.toArray.map(resultRow).map(({ id }) => id)
    // Effect callbacks expose membership deltas rather than positional
    // changes. Keep their membership deterministic without claiming that the
    // callback API reports an ordered sequence.
    return [...effectRows.values()]
      .sort((left, right) =>
        testCase.direction === `asc`
          ? left.rank - right.rank
          : right.rank - left.rank,
      )
      .map(({ id }) => id)
  }
  const recordPublication = () => {
    publications.push({ rows: ids() })
  }
  const effect =
    consumer === `effect`
      ? createEffect({
          query: buildQuery,
          onBatch: (events) => {
            for (const event of events) {
              const row = resultRow(event.value)
              if (event.type === `exit`) effectRows.delete(row.id)
              else effectRows.set(row.id, row)
            }
            recordPublication()
          },
        })
      : undefined
  let unsubscribe: (() => void) | undefined
  let settled: Promise<void> = Promise.resolve()
  return withHistoryCleanup(
    async () => {
      if (query) await awaitOptimisticCheckpoint(`preload`, query.preload())
      else
        await vi.waitFor(() =>
          expect(ids()).toEqual(referenceOptimisticWindow(testCase, `initial`)),
        )
      const initial = ids()
      expect(initial, `initial rows`).toEqual(
        referenceOptimisticWindow(testCase, `initial`),
      )
      const initialProviderRows = [...sent.keys()]
      expect(
        initialProviderRows,
        `initial provider rows include row 3`,
      ).toContain(3)
      if (shape !== `source`) {
        expect(
          initialProviderRows,
          `initial provider rows include the leading rejected row`,
        ).toContain(4)
      }
      if (extent === `missing` || extent === `non-prefix`) {
        expect(
          initialProviderRows,
          `initial provider rows omit the replacement row`,
        ).not.toContain(width === 1 ? 2 : 1)
      }
      for (const installedId of testCase.installedIds) {
        if (!sent.has(installedId)) {
          const replacement = remote.get(installedId)!
          sync.begin()
          sync.write({ type: `insert`, value: { ...replacement } })
          const applied = sync.commit()
          if (applied !== true) await applied
          sent.set(installedId, { ...replacement })
        }
      }
      const initialRequests = requests
      if (query) {
        const subscription = query.subscribeChanges(
          () => {
            recordPublication()
          },
          { includeInitialState: true },
        )
        unsubscribe = () => subscription.unsubscribe()
        publications.length = 0
      } else publications.length = 0
      holdLaterAcquisition = true

      const transaction =
        testCase.mutationSource === `marker`
          ? markers.update(3, (draft) => {
              draft.rowId = shape === `joined` ? -3 : 3
            })
          : mutation === `delete`
            ? source.delete(3)
            : source.update(3, (draft) => {
                if (testCase.rankMove) draft.rank = 0
                if (
                  shape === `source` &&
                  (!testCase.rankMove || testCase.rankDeparture)
                )
                  draft.eligible = false
                else if (shape !== `source`) draft.link = -draft.id
              })
      let settlementOutcome: `fulfilled` | `rejected` = `fulfilled`
      settled = transaction.when(`settled`).then(
        () => undefined,
        () => {
          settlementOutcome = `rejected`
        },
      )
      const immediate = ids()
      const immediatePublications = publications.map(
        copyOptimisticWindowPublication,
      )
      const acquisitionStarted = await observeAcquisitionAcrossTaskTurns(
        initialRequests,
        () => requests,
      )
      const acquiring = ids()
      let answerQueued = acquiring
      if (acquisitionStarted) {
        await awaitOptimisticCheckpoint(`refill start`, refillStarted.promise)
        if (testCase.answerTiming !== `after-settlement`) {
          providerAnswer.resolve()
          await awaitOptimisticCheckpoint(
            `provider submission`,
            answerSubmitted.promise,
          )
          await flushPromises()
          answerQueued = ids()
        }
      } else providerAnswer.resolve()
      const attemptsAtQueuedAnswer = attempts.map((attempt) => ({
        submittedRows: [...attempt.submittedRows],
        limit: attempt.limit,
        direction: attempt.direction,
        bounded: attempt.bounded,
        appliedReceiptPending: !attempt.appliedReceiptSettled,
        providerPending: !attempt.providerSettled,
      }))
      const preSettlementPublications = publications.map(
        copyOptimisticWindowPublication,
      )

      settlementPhase = outcome
      if (outcome === `acknowledge`) persistence.resolve()
      else persistence.reject(new Error(`rollback`))
      await awaitOptimisticCheckpoint(`settlement`, settled)
      const settledRows = ids()
      const publicationsAtSettlement = publications.map(
        copyOptimisticWindowPublication,
      )
      const publicationCountAtSettlement = publications.length
      if (testCase.answerTiming === `after-settlement` && acquisitionStarted) {
        providerAnswer.resolve()
        await awaitOptimisticCheckpoint(
          `late provider submission`,
          answerSubmitted.promise,
        )
        await awaitOptimisticCheckpoint(
          `late provider completion`,
          Promise.all(attempts.map((attempt) => attempt.provider)),
        )
        await flushPromises()
      }
      const afterAnswer = ids()
      const observedAttempts =
        testCase.answerTiming === `after-settlement`
          ? attempts.map((attempt) => ({
              submittedRows: [...attempt.submittedRows],
              limit: attempt.limit,
              direction: attempt.direction,
              bounded: attempt.bounded,
              appliedReceiptPending: !attempt.appliedReceiptSettled,
              providerPending: !attempt.providerSettled,
            }))
          : attemptsAtQueuedAnswer
      await flushPromises()
      const rowsAfterFirstTurn = ids()
      await flushPromises()
      const rowsAfterSecondTurn = ids()
      await awaitOptimisticCheckpoint(
        `provider completion`,
        Promise.all(attempts.map((attempt) => attempt.provider)),
      )
      const publicationsAfterSettlement = publications
        .slice(publicationCountAtSettlement)
        .map(copyOptimisticWindowPublication)
      let afterRestore: Array<number> | undefined
      let afterRestorePublications:
        Array<OptimisticWindowPublication> | undefined
      if (testCase.mutationSource === `marker` && outcome === `acknowledge`) {
        const beforeRestore = publications.length
        const restoration = markers.update(3, (draft) => {
          draft.rowId = shape === `joined` ? 3 : -3
        })
        afterRestore = ids()
        afterRestorePublications = publications
          .slice(beforeRestore)
          .map(copyOptimisticWindowPublication)
        await awaitOptimisticCheckpoint(
          `marker restoration`,
          restoration.when(`settled`),
        )
      }

      return {
        initial,
        immediate,
        acquiring,
        answerQueued,
        settled: settledRows,
        afterAnswer,
        afterRestore,
        afterRestorePublications,
        rowsAfterFirstTurn,
        rowsAfterSecondTurn,
        immediatePublications,
        preSettlementPublications,
        publicationsAtSettlement,
        publicationsAfterSettlement,
        attempts: observedAttempts,
        acquisitionStartedBeforeSettlement: acquisitionStarted,
        requestHistory: requestHistory.map((entry) => ({ ...entry })),
        settlementOutcome,
      }
    },
    () => [
      () => unsubscribe?.(),
      () => persistence.resolve(),
      () => providerAnswer.resolve(),
      () => awaitOptimisticCheckpoint(`settlement cleanup`, settled),
      () => effect?.dispose(),
      () => query?.cleanup(),
      () => source.cleanup(),
      () => markers.cleanup(),
      () =>
        expect(requests, `bounded refill requests`).toBeLessThanOrEqual(
          MAX_OPTIMISTIC_WINDOW_REQUESTS,
        ),
    ],
  )
}

describe(`eager indexed ordered windows`, () => {
  const { multiplier } = readOracleRunConfig()
  const runs = 40 * multiplier

  // Named eager regressions, each replayed through the same checkEagerWindow
  // driver and its row, work, and scan comparisons. The eager campaign
  // arbitraries end in maps without unmappers, so they cannot take these
  // histories back; they run as one enumerated source.
  type EagerNamedHistory = { name: string; testCase: EagerCase }
  const eagerNamedHistories: Array<EagerNamedHistory> = [
    {
      name: `places null ranks first in an indexed descending window`,
      testCase: {
        path: `sync`,
        filter: `source`,
        indexed: true,
        direction: `desc`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [{ id: 0, rank: null as unknown as number, eligible: true }],
        history: [{ type: `upsert`, id: 1, rank: 2, eligible: true }],
      },
    },
    {
      name: `refills after a visible delete without resending the source`,
      testCase: {
        path: `local-only`,
        filter: `source`,
        indexed: true,
        direction: `desc`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: 3, eligible: true },
          { id: 1, rank: 2, eligible: true },
          { id: 2, rank: 1, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 5, rank: 3, eligible: true },
          { type: `delete`, id: 5 },
          { type: `delete`, id: 0 },
          { type: `upsert`, id: 1, rank: 0, eligible: true },
        ],
      },
    },
    // The bounded prefix ends inside a NaN tie group, which cannot be a
    // cursor, so the repair falls back to a full-source read.
    ...([`sync`, `local-only`] as const).map((path): EagerNamedHistory => ({
      name: `publishes one complete window when a repair reaches a NaN tie group (${path})`,
      testCase: {
        path,
        filter: `source`,
        indexed: true,
        direction: `desc`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [1, 2, 3, 4, 5].map((id) => ({
          id,
          rank: Number.NaN,
          eligible: true,
        })),
        history: [
          { type: `delete`, id: 1 },
          { type: `delete`, id: 3 },
          { type: `upsert`, id: 6, rank: Number.NaN, eligible: true },
        ],
      },
    })),
    // Every row the window held changes while the refetching provider lags.
    // The final refetch empties the window, and the loader refills it one
    // page at a time, publishing [], then one row, then the final two (#2131).
    {
      name: `refills a joined window over several pages after a refetch empties it`,
      testCase: {
        path: `on-demand`,
        provider: `refetch`,
        filter: `joined`,
        via: `link`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 1,
        initial: [
          { id: 0, rank: 1, eligible: true },
          { id: 1, rank: 2, eligible: true },
          { id: 2, rank: 0, eligible: true },
          { id: 3, rank: 3, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 0, eligible: true },
          { type: `flip`, id: 1 },
          { type: `flip`, id: 3 },
          { type: `delete`, id: 0 },
          { type: `flip`, id: 2 },
        ],
      },
    },
    // The loader pages the top two rows, then one more after a cursor. Rows
    // 10 and 11 arrive while the provider lags; the refetched first page now
    // ends at row 11, so row 10 sorts between the pages. A provider that
    // keeps served ranges whole sends it; one that re-runs each page alone
    // (query-db-collection today) never does, and the window shows [4, 1].
    {
      name: `shows a row that moved between two served pages after a refetch`,
      testCase: {
        path: `on-demand`,
        provider: `refetch`,
        filter: `joined`,
        via: `marker`,
        indexed: true,
        direction: `desc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: Number.NaN, eligible: true },
          { id: 1, rank: 0, eligible: true },
          { id: 2, rank: 4, eligible: true },
          { id: 3, rank: 1, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 5, eligible: true },
          { type: `flip`, id: 0 },
          { type: `upsert`, id: 11, rank: 6, eligible: false },
          { type: `refetch` },
        ],
      },
    },
    // The same trace with a provider that refetches each page alone and then
    // reports the shift. Row 10 is in no answer after the refetch; the
    // report makes the loader re-establish the window with a bounded repair.
    {
      name: `shows a row that moved between two served pages after a signalling refetch`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        filter: `joined`,
        via: `marker`,
        indexed: true,
        direction: `desc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: Number.NaN, eligible: true },
          { id: 1, rank: 0, eligible: true },
          { id: 2, rank: 4, eligible: true },
          { id: 3, rank: 1, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 5, eligible: true },
          { type: `flip`, id: 0 },
          { type: `upsert`, id: 11, rank: 6, eligible: false },
          { type: `refetch` },
        ],
      },
    },
    // An unindexed joined window whose only domain row is ineligible. After a
    // signalling refetch the repair's bounded prefix holds just that row, so
    // the window is short. The refill grows the prefix instead of reading the
    // full source, which the refetch law forbids.
    {
      name: `grows the prefix of a short unindexed window after a signalling refetch`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `joined`,
        via: `marker`,
        indexed: false,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [],
        history: [
          { type: `upsert`, id: 0, rank: 0, eligible: false },
          { type: `dup`, id: 0 },
          { type: `refetch` },
        ],
      },
    },
    // The trace from #2221. A descending, nulls-first, unindexed window behind
    // an anti-joined marker has a NaN rank, so its boundary has no cursor.
    // After a signalling refetch the loader read the full source twice: the
    // short prefix took the full-source fallback. The prefix now grows, so the
    // refetch law, which allows no full-source read here, holds.
    {
      name: `reads no full source after a signalling refetch past a NaN boundary`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `anti-joined`,
        via: `marker`,
        indexed: false,
        direction: `desc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: 0, eligible: true },
          { id: 2, rank: Number.NaN, eligible: true },
          { id: 1, rank: 0, eligible: false },
        ],
        history: [
          { type: `delete-visible` },
          { type: `move`, offset: 0, limit: 1 },
        ],
      },
    },
    // Trace 1 from a comment on #2221: an ascending unindexed window behind an
    // anti-joined marker whose only row is ineligible. Before prefix growth the
    // short prefix took the full-source fallback, twice, after a signalling
    // refetch; the refetch law allows none.
    {
      name: `reads no full source after a signalling refetch of a short anti-joined window`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `anti-joined`,
        via: `marker`,
        indexed: false,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [],
        history: [
          { type: `upsert`, id: 0, rank: 0, eligible: false },
          { type: `refetch` },
        ],
      },
    },
    // Found by the unindexed-refetch random campaign. A refetch report moves
    // the page's end onto a null rank, which no cursor can express. Reading
    // that end's tie would take the boundary's full-source fallback, so the
    // loader repairs with its bounded prefix instead; a loader that read the
    // tie broke the refetch law.
    {
      name: `repairs instead of reading an unexpressible end's tie after a signalling refetch`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `joined`,
        via: `marker`,
        indexed: false,
        direction: `desc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 1,
        initial: [
          { id: 0, rank: null as unknown as number, eligible: true },
          { id: 2, rank: Number.NaN, eligible: true },
          { id: 1, rank: 0, eligible: true },
          { id: 3, rank: 0, eligible: true },
        ],
        history: [
          {
            type: `upsert`,
            id: 10,
            rank: null as unknown as number,
            eligible: false,
          },
          { type: `dup`, id: 0 },
        ],
      },
    },
    // A peer's tie answer changes, so the provider reports, but the first
    // query's page and tie answers stay the same and the peer installed the
    // row after its page. That page proves the window, so the report must
    // start no request for the first query and leave it owing no repair: the
    // window move that follows continues from its boundary instead.
    {
      name: `starts no request for a window its own first page still proves after a report`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: true,
        filter: `source`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [
          { id: 0, rank: 1, eligible: true },
          { id: 1, rank: 2, eligible: true },
          { id: 2, rank: 3, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 2, eligible: true },
          { type: `refetch` },
          { type: `move`, offset: 0, limit: 3 },
        ],
      },
    },
    // A signalling refetch moves the first page's end earlier, to a rank that
    // a row the provider never sent ties with. The window is still inside the
    // page, but the rank-2 row past it is local only because the old tie
    // request read it, so it proves nothing about the rows that now tie with
    // the end. The loader must read the new end's tie; ignoring the report
    // made a later window move read the local rows and skip row 11.
    {
      name: `repairs a signalling refetch before a window move reads past its page`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `joined`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: null as unknown as number, eligible: true },
          { id: 1, rank: 2, eligible: true },
          { id: 2, rank: 3, eligible: true },
          { id: 3, rank: Number.NaN, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 0, eligible: true },
          { type: `flip`, id: 2 },
          { type: `upsert`, id: 11, rank: 0, eligible: true },
          { type: `refetch` },
          { type: `move`, offset: 0, limit: 3 },
          { type: `delete`, id: 0 },
        ],
      },
    },
    // A page with no later page whose end moves earlier. Two rank-0 rows
    // arrive while the provider lags; the refetched page ends at rank 0, but
    // the tie request still holds the rank-1 row, so the loader sees no
    // delete. The report repairs the window.
    {
      name: `repairs a signalling refetch whose page now ends before its tie`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        filter: `anti-joined`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 3,
        offset: 0,
        initial: [
          { id: 0, rank: 0, eligible: true },
          { id: 1, rank: 0, eligible: true },
          { id: 2, rank: 1, eligible: true },
          { id: 5, rank: 13, eligible: false },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 0, eligible: false },
          { type: `upsert`, id: 11, rank: 0, eligible: true },
          { type: `refetch` },
        ],
      },
    },
    // A second live-query Collection over a refetched on-demand source kept a
    // short joined window (#2155): after the refetch the peer showed ranks
    // [0, 0] where the model shows [0, 0, 100]. The loader fix that resumes a
    // staged continuation after a synchronous answer the graph already
    // processed closed this trace.
    {
      name: `shows a peer's full joined window after a refetch removes a tied row`,
      testCase: {
        path: `on-demand`,
        provider: `refetch`,
        latency: `immediate`,
        peer: true,
        filter: `joined`,
        via: `link`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 9, rank: 0, eligible: true },
          { id: 0, rank: 0, eligible: true },
          { id: 1, rank: 0, eligible: true },
          { id: 2, rank: 1, eligible: false },
        ],
        history: [
          { type: `upsert`, id: 10, rank: 1, eligible: false },
          { type: `flip`, id: 0 },
        ],
      },
    },
    // The delete leaves fewer result rows than the offset, so the window
    // only loses its row. A subscriber that did not start with that key
    // receives no removal; this one starts with every visible key and must
    // receive the change.
    {
      name: `publishes a full-join window that only loses a row`,
      testCase: {
        path: `sync`,
        filter: `full-joined`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 1,
        initial: [
          { id: 0, rank: 0, eligible: false },
          { id: 1, rank: Number.NaN, eligible: false },
        ],
        history: [
          { type: `delete`, id: 0 },
          { type: `flip`, id: 0 },
        ],
        fillers: 0,
        orphans: [],
      },
    },
    // The plan pages without an index; the anti-join drops row 0 after the
    // provider's limit. Before the compiler counted the rows this window
    // needs, the window stayed empty after the delete instead of reading the
    // full source.
    {
      name: `refills an unindexed on-demand anti-join window after a visible delete`,
      testCase: {
        path: `on-demand`,
        filter: `anti-joined`,
        via: `marker`,
        indexed: false,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [],
        history: [
          { type: `upsert`, id: 0, rank: 0, eligible: false },
          { type: `delete-visible` },
          { type: `dup`, id: 0 },
        ],
      },
    },
    // Nulls last. Row 2 and the marker of row 3 tie on rank in the null
    // group. A full join reads its full source, so row 3's marker is
    // matched. A loader that paged this plan and ended its prefix inside
    // the null group would leave row 3 unloaded and could show its marker
    // as a rootless row; restoring the old join rule fails this case.
    ...(
      [
        [`sync`, 1],
        [`local-only`, 1],
        [`sync`, 2],
        [`local-only`, 2],
      ] as const
    ).map(([path, terms]): EagerNamedHistory => ({
      name: `shows no rootless full-join row for a null-ranked root past the prefix (${path}, ${terms} terms)`,
      testCase: {
        path,
        filter: `full-joined`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `last`,
        fillers: 0,
        terms,
        limit: 2,
        offset: 0,
        initial: [
          { id: 1, rank: 1, eligible: false },
          { id: 2, rank: null as unknown as number, eligible: false },
          { id: 3, rank: null as unknown as number, eligible: true },
        ],
        history: [{ type: `touch`, id: 1 }],
      },
    })),
    // Every domain row has a marker, and nulls sort first. A bounded root
    // prefix of one row would leave the other markers unmatched in the
    // graph, and their null-ranked rootless rows would take the window
    // from the first root row.
    ...([`sync`, `local-only`] as const).map((path): EagerNamedHistory => ({
      name: `shows no rootless full-join row whose root row is past the prefix (${path})`,
      testCase: {
        path,
        filter: `full-joined`,
        via: `marker`,
        indexed: true,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [0, 1, 2, 3, 4, 5].map((id) => ({
          id,
          rank: id,
          eligible: true,
        })),
        history: [{ type: `delete-visible` }],
      },
    })),
    // The bounded prefix holds rows 3 and 1; row 0 then enters the query's
    // input past it. Row 3 loses its marker without a root delete, so row 0
    // must not stand in for row 4, which the prefix never sent.
    // Shrunk from seed -1253945411.
    ...([`sync`, `local-only`] as const).map((path): EagerNamedHistory => ({
      name: `refills a joined-filter window when a row leaves only through the join (${path})`,
      testCase: {
        path,
        filter: `joined`,
        indexed: true,
        direction: `asc`,
        terms: 1,
        limit: 1,
        offset: 1,
        initial: [
          { id: 1, rank: 0, eligible: true },
          { id: 3, rank: null as unknown as number, eligible: true },
          { id: 4, rank: 1, eligible: true },
        ],
        history: [
          { type: `upsert`, id: 0, rank: 2, eligible: true },
          {
            type: `upsert`,
            id: 3,
            rank: null as unknown as number,
            eligible: false,
          },
        ],
      },
    })),
    // A label update brings eligible row 10 into the query's input. After
    // row 2 leaves, a prefix of one root row (row 1) fails the joined
    // filter, and row 10 must not stand in for row 4.
    ...([`sync`, `local-only`] as const).map((path): EagerNamedHistory => ({
      name: `refills a joined-filter window past a retained distant row (${path})`,
      testCase: {
        path,
        filter: `joined`,
        indexed: true,
        direction: `asc`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: Array.from({ length: 10 }, (_, index) => ({
          id: index + 1,
          rank: index + 1,
          eligible: (index + 1) % 2 === 0,
        })),
        history: [
          { type: `touch`, id: 10 },
          { type: `delete`, id: 2 },
        ],
      },
    })),
    ...[false, true].map((indexed): EagerNamedHistory => ({
      name: `revalidates an empty joined prefix after an ineligible insert (indexed: ${indexed})`,
      testCase: {
        path: `on-demand`,
        provider: `refetch-signal`,
        latency: `immediate`,
        cancellation: `cooperative`,
        peer: false,
        filter: `joined`,
        via: `marker`,
        indexed,
        direction: `asc`,
        nulls: `first`,
        terms: 1,
        limit: 1,
        offset: 0,
        initial: [],
        history: [
          { type: `upsert`, id: 0, rank: 0, eligible: false },
          { type: `flip`, id: 1 },
        ],
      },
    })),
    // A local null-ranked row can appear to fill the window while the settled
    // provider prefix ends before a better row. Held answers must not let that
    // local row stand in for source coverage after earlier visible deletes.
    {
      name: `keeps a joined window within its settled source prefix after held answers`,
      testCase: {
        path: `on-demand`,
        provider: `forward`,
        latency: `held`,
        cancellation: `cooperative`,
        peer: false,
        filter: `joined`,
        via: `marker`,
        indexed: false,
        direction: `desc`,
        nulls: `last`,
        terms: 1,
        limit: 2,
        offset: 0,
        initial: [
          { id: 0, rank: 0, eligible: false },
          { id: 1, rank: 0, eligible: true },
          { id: 2, rank: Number.NaN, eligible: true },
        ],
        history: [
          { type: `delete-visible` },
          { type: `delete-visible` },
          { type: `delete-visible` },
          {
            type: `upsert`,
            id: 40,
            rank: null as unknown as number,
            eligible: true,
          },
          { type: `delete-visible` },
          { type: `delete`, id: 1 },
        ],
      },
    },
  ]
  oracleProperty({
    id: `ordered-work.work-eager-fixed`,
    law: {
      statement: `keeps rows and per-change work bounded for each named eager history`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Named regressions outside the generated eager arbitraries, through the same driver and comparisons as the eager campaigns.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: eagerNamedHistories,
    label: ({ name }) => name,
    ...orderedWorkJudgment(({ testCase }: EagerNamedHistory) =>
      checkEagerWindow(testCase),
    ),
    check: (_plan, _observations, verdict) => verdict,
  })

  const baseOptimisticWindowCases = (
    [`source`, `joined`, `anti-joined`] as const
  ).flatMap((shape) =>
    ([`update`, `delete`] as const).flatMap((mutation) =>
      ([`collection`, `effect`] as const).flatMap((consumer) =>
        ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
          ([1, 2] as const).flatMap((width) =>
            [true, false].map((indexed): OptimisticWindowCase => {
              const extent: OptimisticWindowExtent = indexed
                ? `missing`
                : `installed`
              return {
                shape,
                mutation,
                consumer,
                outcome,
                width,
                indexed,
                extent,
                installedIds: indexed
                  ? shape === `source`
                    ? width === 1
                      ? [3]
                      : [3, 2]
                    : width === 1
                      ? [4, 3]
                      : [4, 3, 2]
                  : [1, 2, 3, 4],
                // An unindexed plan proves rows only up to its bounded
                // prefix, so behind a joined filter it may grow the prefix
                // even when the replacement row is installed (ARCHITECTURE.md,
                // "an underfilled unindexed prefix grows"). A source filter
                // leaves no rows out of the prefix, so it needs no request.
                acquisition:
                  extent === `missing`
                    ? `required`
                    : shape === `source`
                      ? `forbidden`
                      : `allowed`,
              }
            }),
          ),
        ),
      ),
    ),
  )
  const optimisticWindowCases: Array<OptimisticWindowCase> = [
    ...baseOptimisticWindowCases,
    ...([`joined`, `anti-joined`] as const).flatMap((shape) =>
      ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
        ([`collection`, `effect`] as const).map((consumer) => ({
          shape,
          mutation: `update` as const,
          mutationSource: `marker` as const,
          consumer,
          outcome,
          width: 2 as const,
          indexed: true,
          extent: `missing` as const,
          installedIds: [4, 3, 2],
          acquisition: `required` as const,
          answerTiming: `after-settlement` as const,
        })),
      ),
    ),
    ...([`source`, `joined`] as const).flatMap((shape) =>
      ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
        ([`collection`, `effect`] as const).map((consumer) => ({
          shape,
          mutation: `delete` as const,
          consumer,
          outcome,
          width: 2 as const,
          indexed: true,
          extent: `missing` as const,
          installedIds: shape === `source` ? [3, 2] : [4, 3, 2],
          acquisition: `required` as const,
          answerTiming: `after-settlement` as const,
        })),
      ),
    ),
    // An unindexed one-row window behind a joined filter installs only the
    // prefix it grew to: the rejected leading row 4 and the window row 3.
    // The departure of row 3 leaves the replacement row 2 missing, so the
    // refill must grow the prefix before persistence settles.
    ...([`joined`, `anti-joined`] as const).flatMap((shape) =>
      ([`update`, `delete`] as const).flatMap((mutation) =>
        ([`acknowledge`, `rollback`] as const).flatMap((outcome) =>
          ([`collection`, `effect`] as const).map((consumer) => ({
            shape,
            mutation,
            consumer,
            outcome,
            width: 1 as const,
            indexed: false,
            extent: `missing` as const,
            installedIds: [4, 3],
            acquisition: `required` as const,
          })),
        ),
      ),
    ),
    {
      shape: `source`,
      mutation: `update`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `installed`,
      installedIds: [3, 2, 1],
      acquisition: `allowed`,
    },
    {
      shape: `joined`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `installed`,
      installedIds: [4, 3, 2, 1],
      acquisition: `allowed`,
    },
    {
      shape: `source`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 1,
      indexed: true,
      extent: `non-prefix`,
      installedIds: [3, 1],
      acquisition: `required`,
    },
  ]

  // Every optimistic-window history replays through the same production
  // driver and the independent public-window check.
  type OptimisticNamedHistory = {
    name: string
    testCase: OptimisticWindowCase
  }
  const optimisticNamedHistories: Array<OptimisticNamedHistory> = [
    ...optimisticWindowCases.map((testCase) => ({
      name: `characterizes a width-${testCase.width} ${testCase.indexed} indexed optimistic ${testCase.shape} ${testCase.mutation} from ${testCase.mutationSource} with ${testCase.extent} replacement extent for a ${testCase.consumer} before ${testCase.outcome} (${testCase.answerTiming})`,
      testCase,
    })),
    // Moving the leading row below a missing source row does not shrink the
    // installed window. A local row-count check alone cannot discover that
    // the remote ordered prefix now contains row 1.
    {
      name: `refills an optimistic rank move that leaves a full installed window`,
      testCase: {
        shape: `source`,
        mutation: `update`,
        consumer: `collection`,
        outcome: `acknowledge`,
        width: 2,
        indexed: true,
        extent: `missing`,
        installedIds: [3, 2],
        acquisition: `required`,
        rankMove: true,
      },
    },
    // This is a membership departure, so the short-window law applies even
    // though its source row also changes order. Rollback must remove both
    // overlay effects at the same public cut.
    {
      name: `restores an optimistic membership departure with a rank change on rollback`,
      testCase: {
        shape: `source`,
        mutation: `update`,
        consumer: `collection`,
        outcome: `rollback`,
        width: 2,
        indexed: true,
        extent: `missing`,
        installedIds: [3, 2],
        acquisition: `required`,
        rankMove: true,
        rankDeparture: true,
      },
    },
    // Negated ranks make row 3 the ascending head and row 2 its provider
    // successor. The leading rejected row 4 remains ahead of both.
    ...([`joined`, `anti-joined`] as const)
      .flatMap((shape) =>
        ([`acknowledge`, `rollback`] as const).map((outcome) => ({
          shape,
          outcome,
        })),
      )
      .map(({ shape, outcome }): OptimisticNamedHistory => ({
        name: `publishes an ascending ${shape} limit-one optimistic delete before ${outcome}`,
        testCase: {
          shape,
          mutation: `delete`,
          consumer: `collection`,
          outcome,
          width: 1,
          indexed: true,
          extent: `missing`,
          installedIds: [4, 3],
          acquisition: `required`,
          direction: `asc`,
        },
      })),
  ]
  async function judgeOptimisticWindow({
    testCase,
  }: OptimisticNamedHistory): Promise<void> {
    const observation = await checkOptimisticWindow(testCase)
    const actual = optimisticWindowViolations(observation, testCase)
    // Each legal history must refine the independent public-window model.
    expect(actual).toEqual([])
  }
  oracleProperty({
    id: `ordered-work.work-optimistic-window`,
    law: {
      statement: `An optimistic departure from an on-demand ordered window is public before settlement, starts one useful bounded acquisition when extent is missing, keeps a pending answer private, and settles to the acknowledged or restored window.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The finite optimistic-window grammar and named histories over one six-row ledger; callback payload coherence is owned elsewhere.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: optimisticNamedHistories,
    label: ({ name }) => name,
    ...orderedWorkJudgment(judgeOptimisticWindow),
    check: (_plan, _observations, verdict) => verdict,
    calibrations: [
      {
        name: `rejects a source refill that omits eligibility or adds broad work`,
        law: `calibration: source refill eligibility and broad work`,
        // The old calibration ran this exact case; any other history runs
        // the clean judgment alone. Its matchers stay as they were: only when
        // they all hold has the check rejected the corrupted observation.
        driver: (
          plan: { history: OptimisticNamedHistory },
          observe: (checkpoint: string, value: unknown) => void,
        ) =>
          observeComparison(plan, observe, async () => {
            const { testCase } = plan.history
            const observation = await checkOptimisticWindow(testCase)
            expect(optimisticWindowViolations(observation, testCase)).toEqual(
              [],
            )
            if (
              !isDeepStrictEqual(testCase, {
                shape: `source`,
                mutation: `delete`,
                consumer: `collection`,
                outcome: `acknowledge`,
                width: 2,
                indexed: true,
                extent: `missing`,
                installedIds: [3, 2],
                acquisition: `required`,
              })
            )
              return
            const refill = observation.requestHistory!.find(
              ({ phase, submittedRows }) =>
                phase === `pending` && submittedRows?.includes(1),
            )!

            // A finite, ordered request that drops the source predicate still returns
            // the needed row, but a rejected peer at the same rank exposes the omission.
            const missingPredicate: OptimisticWindowObservation = {
              ...observation,
              requestHistory: observation.requestHistory!.map((request) =>
                request === refill
                  ? { ...request, allowsRejectedRoot: true }
                  : request,
              ),
            }
            expect(
              optimisticWindowViolations(missingPredicate, testCase),
            ).toContain(`source refill omitted the source predicate`)

            // Useful progress from the first page cannot license a later, unrelated
            // full-source fetch while the optimistic transaction remains pending.
            const extraBroadRequest: OptimisticWindowObservation = {
              ...observation,
              requestHistory: [
                ...observation.requestHistory!,
                {
                  identity: `distinct full-source request`,
                  phase: `pending`,
                  newRows: 0,
                  submittedRows: [4, 3, 2, 1, 0, -1],
                  selectedRanks: [4, 3, 2, 1, 0, -1],
                  allowsRejectedRoot: true,
                },
              ],
            }
            expect(
              optimisticWindowViolations(extraBroadRequest, testCase),
            ).toContain(`optimistic acquisition used a broad provider request`)
            rejectAt(
              `calibration: source refill eligibility and broad work`,
              new Error(
                `the optimistic window check reported the corrupted observation`,
              ),
            )
          }),
      },
      {
        name: `rejects acquisition deferred until after optimistic settlement`,
        law: `calibration: acquisition deferred until settlement`,
        // The old calibration ran this exact case; any other history runs
        // the clean judgment alone. Its matchers stay as they were: only when
        // they all hold has the check rejected the corrupted observation.
        driver: (
          plan: { history: OptimisticNamedHistory },
          observe: (checkpoint: string, value: unknown) => void,
        ) =>
          observeComparison(plan, observe, async () => {
            const { testCase } = plan.history
            const observation = await checkOptimisticWindow(testCase)
            expect(optimisticWindowViolations(observation, testCase)).toEqual(
              [],
            )
            if (
              !isDeepStrictEqual(testCase, {
                shape: `source`,
                mutation: `delete`,
                consumer: `collection`,
                outcome: `acknowledge`,
                width: 2,
                indexed: true,
                extent: `missing`,
                installedIds: [3, 2],
                acquisition: `required`,
              })
            )
              return
            expect(
              optimisticWindowViolations(
                { ...observation, acquisitionStartedBeforeSettlement: false },
                testCase,
              ),
            ).toContain(`refill acquisition did not start before settlement`)
            rejectAt(
              `calibration: acquisition deferred until settlement`,
              new Error(
                `the optimistic window check reported the corrupted observation`,
              ),
            )
          }),
      },
    ],
  })

  /**
   * These complete-local-extent histories isolate the immediate publication
   * law from provider timing. The reference filters one deleted key from a
   * plain row list, orders it, then takes the requested slice. A tie deletes
   * whichever equal-ranked key the initial window selected; the remaining
   * peer is then the only valid top row, independent of tie-breaking policy.
   */
  const installedDepartureHistories = [
    {
      name: `ascending head`,
      ranks: [1, 2, 3],
      direction: `asc` as const,
      offset: 0,
      limit: 1,
    },
    {
      name: `descending offset`,
      ranks: [1, 2, 3, 4],
      direction: `desc` as const,
      offset: 1,
      limit: 1,
    },
    {
      name: `tied head`,
      ranks: [2, 3, 3],
      direction: `desc` as const,
      offset: 0,
      limit: 1,
    },
    {
      name: `exhausted window`,
      ranks: [1, 2, 3],
      direction: `desc` as const,
      offset: 0,
      limit: 4,
    },
  ].flatMap((window) =>
    ([`acknowledge`, `rollback`] as const).map((outcome) => ({
      ...window,
      outcome,
    })),
  )
  async function runInstalledDeparture({
    ranks,
    direction,
    offset,
    limit,
    outcome,
  }: (typeof installedDepartureHistories)[number]): Promise<void> {
    const persistence = createDeferred<void>()
    const rows = ranks.map((rank, index) => ({ id: index + 1, rank }))
    const source = createCollection(
      localOnlyCollectionOptions({
        id: `optimistic-installed-${Math.random()}`,
        getKey: (row) => row.id,
        initialData: rows,
        onDelete: async () => {
          await persistence.promise
        },
      }),
    )
    source.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const query = createLiveQueryCollection({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank, direction)
          .offset(offset)
          .limit(limit),
    })
    const ids = () => query.toArray.map(({ id }) => id)
    const order = (removed?: number) =>
      expectedInstalledWindow(rows, { direction, offset, limit }, removed)
    let unsubscribe: (() => void) | undefined
    try {
      await query.preload()
      const initial = ids()
      if (ranks[1] !== ranks[2]) expect(initial).toEqual(order())
      const departed = initial[0]!
      const publications: Array<Array<number>> = []
      const subscription = query.subscribeChanges(
        () => publications.push(ids()),
        { includeInitialState: true },
      )
      unsubscribe = () => subscription.unsubscribe()
      publications.length = 0

      const transaction = source.delete(departed)
      const expected = order(departed)
      expect(ids(), `immediate installed rows`).toEqual(expected)
      expect(publications, `synchronous installed publication`).toEqual([
        expected,
      ])
      if (outcome === `acknowledge`) persistence.resolve()
      else persistence.reject(new Error(`rollback`))
      await transaction.when(`settled`).catch(() => undefined)
      expect(ids(), `settled installed rows`).toEqual(
        outcome === `acknowledge` ? expected : initial,
      )
    } finally {
      persistence.resolve()
      unsubscribe?.()
      await query.cleanup()
      await source.cleanup()
    }
  }
  oracleProperty({
    id: `ordered-work.work-installed-departure`,
    law: {
      statement: `An optimistic departure from a complete installed window publishes the model window at once, and settlement keeps it or restores the initial window.`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `Four installed windows crossed with acknowledgement and rollback.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: installedDepartureHistories,
    label: (history) =>
      `publishes an optimistic departure in an installed ${history.name} before ${history.outcome}`,
    ...orderedWorkJudgment(runInstalledDeparture),
    check: (_plan, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `ordered-work.eager-indexed-window`,
    law: {
      statement: `keeps rows and per-change work bounded for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: { arbitrary: eagerCase, runs: 40, fixedSeeds: [2044] },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await checkEagerWindow(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `ordered-work.eager-full-join`,
    law: {
      statement: `keeps a full-join window to the first result rows for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: {
      arbitrary: eagerFullJoinCase,
      runs: 40,
      fixedSeeds: [FULL_JOIN_SEED],
    },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await checkEagerWindow(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  // The fixed-seed held campaign and its reconstruction run in one test, so
  // the reach check always reads the cases that test just executed. Reach is
  // keyed by case, so rerunning an identical case overwrites its entry;
  // shrinking runs only after a failure, which ends the test first.
  // Reconstruction: the fixed campaign must reach the proven-report law, so
  // a loader that repairs every report fails it.
  describe(`proven report campaign reach`, () => {
    let reached = 0
    beforeEach(() => {
      reached = 0
    })
    afterEach(({ task }) => {
      if (
        isGeneratedOracleCampaign(task.name) &&
        task.result?.state !== `fail` &&
        !oracleReplayRequested()
      )
        expect(reached, `reports a first page proved`).toBeGreaterThan(0)
    })
    oracleProperty({
      id: `ordered-work.eager-proven-report`,
      law: {
        statement: `Ordered windows preserve the existing independent row, request, and publication judgment.`,
        authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
        limits: `The existing bounded eager history grammar and controlled provider; no new reach or provider coverage.`,
      },
      owns: [
        'src/collection/index.ts#createCollection',
        'src/indexes/btree-index.ts',
        'src/local-only.ts#localOnlyCollectionOptions',
        'src/query/compiler/index.ts#compileQuery',
        'src/query/effect.ts#createEffect',
        'src/query/live-query-collection.ts#createLiveQueryCollection',
        'src/query/live/ordered-source-loader.ts',
        'src/query/subset-dedupe.ts',
      ],
      histories: {
        arbitrary: eagerProvenReportCase,
        runs: 40,
        fixedSeeds: [2091],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const observed = await runEagerWindow(history)
          if (observed.ignoredProvenReports > 0) reached++
        }),
      check: (_history, _observations, verdict) => verdict,
    })
  })

  // The refetch law over unindexed joined windows behind a signalling
  // provider. A repair must not read the full source, including the refill
  // of an unindexed plan whose bounded prefix leaves the window short, which
  // grows the prefix. The campaign must reach windows the prefix fills and
  // windows it leaves short.
  // Ineligible rows crowd the bounded prefix and leave the window short, so
  // half the cases start with every row eligible, where the law applies.
  const eagerUnindexedRefetchCase = fc
    .tuple(eagerJoinedCase, fc.boolean())
    .map(([testCase, allEligible]) => ({
      ...testCase,
      path: `on-demand` as const,
      provider: `refetch-signal` as const,
      indexed: false,
      peer: false,
      initial: allEligible
        ? testCase.initial.map((row) => ({ ...row, eligible: true }))
        : testCase.initial,
    }))
  describe(`unindexed refetch campaign reach`, () => {
    const states = [`unindexedRefetchChecks`, `shortUnindexedRefills`] as const
    let counts = new Map<(typeof states)[number], number>()
    beforeEach(() => {
      counts = new Map(states.map((state) => [state, 0]))
    })
    afterEach(({ task }) => {
      if (
        isGeneratedOracleCampaign(task.name) &&
        task.result?.state !== `fail` &&
        !oracleReplayRequested()
      )
        for (const state of states)
          expect(
            counts.get(state),
            `${state} history minimum`,
          ).toBeGreaterThanOrEqual(5)
    })
    oracleProperty({
      id: `ordered-work.eager-unindexed-refetch`,
      law: {
        statement: `Ordered windows preserve the existing independent row, request, and publication judgment.`,
        authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
        limits: `The existing bounded eager history grammar and controlled provider; no new reach or provider coverage.`,
      },
      owns: [
        'src/collection/index.ts#createCollection',
        'src/indexes/btree-index.ts',
        'src/local-only.ts#localOnlyCollectionOptions',
        'src/query/compiler/index.ts#compileQuery',
        'src/query/effect.ts#createEffect',
        'src/query/live-query-collection.ts#createLiveQueryCollection',
        'src/query/live/ordered-source-loader.ts',
        'src/query/subset-dedupe.ts',
      ],
      // Keep the existing seed and five-history minima, without changing the grammar.
      histories: {
        arbitrary: eagerUnindexedRefetchCase,
        runs: 40,
        fixedSeeds: [2094],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          const observed = await runEagerWindow(history)
          for (const state of states)
            if (observed[state] > 0) counts.set(state, counts.get(state)! + 1)
        }),
      check: (_history, _observations, verdict) => verdict,
    })
  })

  describe(`held-load campaign reconstruction`, () => {
    const HELD_SEED = 2083
    let fixedCampaign = false
    let heldReach = new Map<
      string,
      Awaited<ReturnType<typeof runEagerWindow>>
    >()
    beforeEach(({ task }) => {
      fixedCampaign = task.name === `fixed seed ${HELD_SEED}: generated`
      heldReach = new Map()
    })
    afterEach(({ task }) => {
      if (!fixedCampaign || task.result?.state === `fail`) return
      // Reconstruction: sampling the arbitrary with the same seed and run
      // count yields the executed cases.
      const executed = new Set(
        fc
          .sample(eagerHeldCase, oracleFixedSeed(HELD_SEED, { numRuns: runs }))
          .map((testCase) => fc.stringify(testCase)),
      )
      expect(
        [...executed].filter((key) => !heldReach.has(key)),
        `executed held cases without recorded reach`,
      ).toEqual([])
      const reach = [...executed].map((key) => heldReach.get(key)!)
      // A case whose deletes refill from rows the query already holds issues
      // no held request; at one times the run count, 33 of 40 cases issue one.
      expect(
        reach.filter((count) => count.heldRequests > 0).length,
        `held cases that issue a held request`,
      ).toBeGreaterThanOrEqual(Math.ceil(runs * 0.75))
      expect(
        reach.filter(
          (count) => count.heldRequests > 0 && count.heldChanges === 0,
        ),
        `held cases with a held request but no in-flight change`,
      ).toEqual([])
      // `release-peer` aborts held requests: at one times the run count, a
      // cooperative provider cancels 6 and a late provider answers 4 anyway.
      expect(
        reach.reduce((sum, count) => sum + count.cooperativeCancels, 0),
        `held requests a cooperative provider cancelled`,
      ).toBeGreaterThanOrEqual(3)
      expect(
        reach.reduce((sum, count) => sum + count.lateAnswers, 0),
        `aborted held requests a late provider answered`,
      ).toBeGreaterThanOrEqual(1)
    })
    oracleProperty({
      id: `ordered-work.eager-held-load`,
      law: {
        statement: `Ordered windows preserve the existing independent row, request, and publication judgment.`,
        authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
        limits: `The existing bounded eager history grammar and controlled provider; no new reach or provider coverage.`,
      },
      owns: [
        'src/collection/index.ts#createCollection',
        'src/indexes/btree-index.ts',
        'src/local-only.ts#localOnlyCollectionOptions',
        'src/query/compiler/index.ts#compileQuery',
        'src/query/effect.ts#createEffect',
        'src/query/live-query-collection.ts#createLiveQueryCollection',
        'src/query/live/ordered-source-loader.ts',
        'src/query/subset-dedupe.ts',
      ],
      histories: {
        arbitrary: eagerHeldCase,
        runs: 40,
        fixedSeeds: [HELD_SEED],
      },
      model: (history, observations) =>
        recordedComparison(history, observations),
      driver: async (history, observe) =>
        observeComparison(history, observe, async () => {
          if (fixedCampaign)
            heldReach.set(fc.stringify(history), await runEagerWindow(history))
          else await checkEagerWindow(history)
        }),
      check: (_history, _observations, verdict) => verdict,
    })
  })

  oracleProperty({
    id: `ordered-work.eager-joined-gap`,
    law: {
      statement: `keeps a joined-filter window whose row leaves only through the join for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: { arbitrary: eagerJoinedGapCase, runs: 40, fixedSeeds: [2063] },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await checkEagerWindow(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })

  oracleProperty({
    id: `ordered-work.eager-joined-window`,
    law: {
      statement: `keeps a joined-filter window to the first eligible rows for a random or replayed seed`,
      authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
      limits: `The existing bounded history grammar and controlled-provider observations; this registration preserves the existing independent judgment.`,
    },
    owns: [
      'src/collection/index.ts#createCollection',
      'src/indexes/btree-index.ts',
      'src/local-only.ts#localOnlyCollectionOptions',
      'src/query/compiler/index.ts#compileQuery',
      'src/query/effect.ts#createEffect',
      'src/query/live-query-collection.ts#createLiveQueryCollection',
      'src/query/live/ordered-source-loader.ts',
      'src/query/subset-dedupe.ts',
    ],
    histories: { arbitrary: eagerJoinedCase, runs: 40, fixedSeeds: [2059] },
    model: (history, observations) => recordedComparison(history, observations),
    driver: async (history, observe) =>
      observeComparison(history, observe, async () => {
        const scenario = history

        await checkEagerWindow(scenario)
      }),
    check: (_history, _observations, verdict) => verdict,
  })
})

/**
 * A visible ordered window after a change that leaves the ordering key alone:
 * the first `limit` authored rows in `orderBy` order. The law is that a value
 * change outside the key does not move rows, so this prediction also holds
 * after such a change.
 */
function expectedVisibleWindow(
  rows: ReadonlyArray<Row>,
  direction: Scenario[`direction`],
  limit: number,
): Array<Row> {
  return [...rows].sort(compareRows(direction)).slice(0, limit)
}

/**
 * The installed window after one optimistic departure: the requested slice of
 * the authored rows without the departed key, in rank order. The departure
 * removes one key from a plain row list before the window is taken.
 */
function expectedInstalledWindow(
  rows: ReadonlyArray<{ id: number; rank: number }>,
  {
    direction,
    offset,
    limit,
  }: { direction: `asc` | `desc`; offset: number; limit: number },
  removed?: number,
): Array<number> {
  return rows
    .filter(({ id }) => id !== removed)
    .sort((left, right) =>
      direction === `asc` ? left.rank - right.rank : right.rank - left.rank,
    )
    .slice(offset, offset + limit)
    .map(({ id }) => id)
}

/** A source's ordered acquisition must serve every compiled window that reads
 * that lexical source. Authored/source metadata modes may have separate result
 * streams; overwriting one window's demand with the other's cannot change the
 * independent sorted slice. Authority: ordered acquisition and window laws in
 * ARCHITECTURE.md. The exported compiler plus real loader is a controlled core
 * receiving cut; the existing live Collection/Effect histories supply the host
 * gate. These finite histories do not promise a universal operator-count bound.
 */
const compilerCacheWindows = (
  [`authored-first`, `callback-first`] as const
).flatMap((order) =>
  ([`shared`, `separate`] as const).flatMap((cache) =>
    ([`query-ref`, `joined-source`, `union-branch`] as const).flatMap((path) =>
      ([`structured`, `functional`] as const).flatMap((shape) =>
        ([`asc`, `desc`] as const).flatMap((direction) =>
          [
            {
              initial: { limit: 1, offset: 0 },
              moved: { limit: 3, offset: 0 },
            },
            {
              initial: { limit: 3, offset: 0 },
              moved: { limit: 1, offset: 0 },
            },
            {
              initial: { limit: 1, offset: 0 },
              moved: { limit: 2, offset: 1 },
            },
          ].map((window) => ({
            order,
            cache,
            path,
            shape,
            direction,
            ...window,
          })),
        ),
      ),
    ),
  ),
)
const compilerWindowCuts = [`initial`, `moved`, `returned`] as const
const compilerWindowKey = (history: (typeof compilerCacheWindows)[number]) =>
  JSON.stringify(history)
const compilerWindowCounts = new Map<string, number>(
  compilerCacheWindows.flatMap((history) =>
    compilerWindowCuts.map(
      (cut) => [`${compilerWindowKey(history)}/${cut}`, 0] as const,
    ),
  ),
)
let compilerWindowEntered = false
afterAll(() => {
  if (compilerWindowEntered)
    expect(
      [...compilerWindowCounts].filter(([, count]) => count < 1),
      `compiled ordered cache windows`,
    ).toEqual([])
})
async function runCompilerCacheWindow(
  history: (typeof compilerCacheWindows)[number],
): Promise<void> {
  compilerWindowEntered = true
  const entered = new Set<string>()
  const rows = [
    { id: 1, rank: 1 },
    { id: 2, rank: 2 },
    { id: 3, rank: 3 },
  ]
  const failures: Array<unknown> = []
  const traces: Array<unknown> = []
  await receiveOrderedCompilerCacheHistory(history, rows, (cut, actual) => {
    const window = cut === `moved` ? history.moved : history.initial
    const expected = {
      authored: expectedInstalledWindow(rows, {
        ...window,
        direction: history.direction,
      }),
      callback: expectedInstalledWindow(rows, {
        ...history.initial,
        direction: history.direction,
      }),
    }
    // Compare signed-bag occurrences, not D2 output delivery order. Rank order
    // is independently exercised by the enclosing ordered-work owner.
    const byId = (ids: Array<number>) => [...ids].sort((a, b) => a - b)
    try {
      expect(
        { authored: byId(actual.authored), callback: byId(actual.callback) },
        `${compilerWindowKey(history)}/${cut}`,
      ).toStrictEqual({
        authored: byId(expected.authored),
        callback: byId(expected.callback),
      })
    } catch (error) {
      failures.push(error)
      traces.push({ cut, actual, expected })
    }
    const state = `${compilerWindowKey(history)}/${cut}`
    if (!compilerWindowCounts.has(state))
      throw new Error(`Undeclared compiled window cut: ${state}`)
    if (!entered.has(state)) {
      entered.add(state)
      compilerWindowCounts.set(state, compilerWindowCounts.get(state)! + 1)
    }
  })
  if (failures.length)
    throw new AggregateError(
      failures,
      `ordered compiler cache window mismatch: ${JSON.stringify(traces)}`,
      { cause: failures[0] },
    )
}
oracleProperty({
  id: `ordered-work.work-compiler-cache`,
  law: {
    statement: `An ordered source acquisition serves every compiled window that reads that lexical source, as the independent sorted slice.`,
    authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
    limits: `The finite compiler-cache window grammar through the exported compiler and real loader; no universal operator-count bound.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/local-only.ts#localOnlyCollectionOptions',
    'src/query/compiler/index.ts#compileQuery',
    'src/query/effect.ts#createEffect',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live/ordered-source-loader.ts',
    'src/query/subset-dedupe.ts',
  ],
  histories: compilerCacheWindows,
  label: (history) =>
    `serves every metadata-mode window of one ordered source: ${JSON.stringify(history)}`,
  ...orderedWorkJudgment(runCompilerCacheWindow),
  check: (_plan, _observations, verdict) => verdict,
})

/** Ordered publication waits for every joined dependency that any retained
 * source plan requires (ARCHITECTURE.md, atomic window publication). A QueryRef
 * adds ordering without removing its child's lazy join. Another ordered join
 * adds a dependency rather than replacing it. The model filters complete source
 * rows, then sorts and slices. While required adapter loads are held, every
 * public read and callback retains the preceding complete result.
 *
 * This finite history grammar varies receiving host, join polarity, nested
 * plan composition, window width, direction and which joined source answers
 * first. Direct plans are controls. It uses actual Collection/Effect receivers
 * with controlled adapters, not a provider or framework timing claim.
 */
const joinedPlanHistories = ([`collection`, `effect`] as const).flatMap(
  (receiver) =>
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`some`, `none`] as const).flatMap((filter) =>
        ([`direct`, `wrapped`, `two-filters`] as const).flatMap((placement) =>
          ([1, 2] as const).flatMap((width) =>
            ([`first`, `second`] as const).flatMap((releaseFirst) =>
              (placement === `two-filters`
                ? ([`first`, `second`] as const)
                : ([`first`] as const)
              ).map((blocker) => ({
                receiver,
                direction,
                filter,
                placement,
                width,
                releaseFirst,
                blocker,
              })),
            ),
          ),
        ),
      ),
    ),
)
function expectedJoinedPlanWindow(
  history: (typeof joinedPlanHistories)[number],
  added: boolean,
) {
  const rows = [1, 2, 3].map((id) => ({ id, rank: id }))
  if (added) rows.push({ id: 4, rank: history.direction === `asc` ? 0 : 4 })
  const markers =
    history.placement === `two-filters`
      ? [
          history.blocker === `first` ? [1, 4] : [1],
          history.blocker === `second` ? [1, 4] : [1],
        ]
      : [[1, 4]]
  const accepted = rows.filter(({ id }) =>
    markers.every((marked) =>
      history.filter === `some` ? marked.includes(id) : !marked.includes(id),
    ),
  )
  return expectedInstalledWindow(accepted, {
    direction: history.direction,
    offset: 0,
    limit: history.width,
  })
}
const joinedPlanCounts = new Map<string, number>(
  joinedPlanHistories.flatMap((history) =>
    [
      `${JSON.stringify(history)}/held`,
      `${JSON.stringify(history)}/settled`,
    ].map((state) => [state, 0] as const),
  ),
)
let joinedPlanEntered = false
afterAll(() => {
  if (joinedPlanEntered)
    expect(
      [...joinedPlanCounts].filter(([, count]) => count < 1),
      `ordered joined plan publication`,
    ).toEqual([])
})
async function runJoinedPlan(
  history: (typeof joinedPlanHistories)[number],
): Promise<void> {
  joinedPlanEntered = true
  const entered = new Set<string>()
  const reach = (state: string) => {
    if (!joinedPlanCounts.has(state))
      throw new Error(`Undeclared joined plan cut: ${state}`)
    if (!entered.has(state)) {
      entered.add(state)
      joinedPlanCounts.set(state, joinedPlanCounts.get(state)! + 1)
    }
  }
  const failures: Array<unknown> = []
  const traces: Array<unknown> = []
  await receiveOrderedJoinedPlanHistory(history, (observation) => {
    const added = observation.cut !== `initial` && observation.pending === 0
    const expected = expectedJoinedPlanWindow(history, added)
    try {
      expect(
        observation.rows,
        `${JSON.stringify(history)}/${observation.cut}`,
      ).toEqual(expected)
      // Ordinary Effect startup may deliver progressive callbacks
      // (ARCHITECTURE.md, atomic window publication). This history starts its
      // publication claim after readiness; the initial settled rows establish
      // the preceding complete result.
      if (observation.cut !== `initial`)
        for (const publication of observation.publications)
          expect(
            publication,
            `complete ${observation.cut} publication`,
          ).toEqual(expected)
    } catch (error) {
      failures.push(error)
      traces.push({ ...observation, expected })
    }
    if (observation.cut === `held` && observation.pending > 0)
      reach(`${JSON.stringify(history)}/held`)
    if (observation.cut === `settled` && observation.pending === 0)
      reach(`${JSON.stringify(history)}/settled`)
  })
  if (failures.length)
    throw new AggregateError(
      failures,
      `ordered joined plan publication mismatch: ${JSON.stringify(traces)}`,
      { cause: failures[0] },
    )
}
oracleProperty({
  id: `ordered-work.work-joined-plan`,
  law: {
    statement: `Ordered publication waits for every joined dependency that a retained source plan requires, and each public read and callback keeps the preceding complete result.`,
    authority: `query/live/ARCHITECTURE.md: ordered requests, continuation, and atomic window publication.`,
    limits: `The finite joined-plan grammar with controlled adapters; no provider or framework timing claim.`,
  },
  owns: [
    'src/collection/index.ts#createCollection',
    'src/indexes/btree-index.ts',
    'src/local-only.ts#localOnlyCollectionOptions',
    'src/query/compiler/index.ts#compileQuery',
    'src/query/effect.ts#createEffect',
    'src/query/live-query-collection.ts#createLiveQueryCollection',
    'src/query/live/ordered-source-loader.ts',
    'src/query/subset-dedupe.ts',
  ],
  histories: joinedPlanHistories,
  label: (history) =>
    `retains every joined dependency through ordered plans: ${JSON.stringify(history)}`,
  ...orderedWorkJudgment(runJoinedPlan),
  check: (_plan, _observations, verdict) => verdict,
})
