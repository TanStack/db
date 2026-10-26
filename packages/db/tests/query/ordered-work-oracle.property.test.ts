import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { toArray } from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { localOnlyCollectionOptions } from '../../src/local-only.js'
import { createDeferred } from '../../src/deferred.js'
import { LoadSubsetOperationAbortedError } from '../../src/errors.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { getCollectionBuilder } from '../../src/query/live/collection-registry.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gte, isUndefined, not } from '../../src/query/builder/functions.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import { withHistoryCleanup } from '../optimistic-history-oracle.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { DeltaEvent } from '../../src/query/effect.js'
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
 * Counts are contract bounds, not timing benchmarks. They pin established
 * request and graph-scheduling behavior only where the test names that promise.
 * These scenarios exercise local evaluation; they do not model a remote adapter
 * applying a relation hint.
 */

// A joined filter's marker in the eager harness. `rowId` is the join key,
// matched against a root row's `link`; `key` identifies the marker.
type JoinMarker = { key: number; rowId: number }
// Result-row ids at or above this name a matched (root row, marker) pair.
const PAIR_ID = 1_000_000

type Row = {
  id: number
  rank: number
  eligible: boolean
  label: string
  // The marker key a joined plan matches; the row's id unless eligibility is
  // held on the join key (EagerCase.via).
  link?: number
}

type Marker = { id: number; rowId: number }

type Scenario = {
  middleCount: number
  middleEligible: boolean
  lastEligible: boolean
  tied: boolean
  direction: `asc` | `desc`
}

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

// Grammar for the generated consumer-parity law: zero to three middle rows,
// either marker eligibility for middle and last rows, equal versus distinct
// middle ranks, and both order directions. Every combination is legal and the
// exhaustive matrix reconstructs all 64 cells before random sampling. Removing
// middleCount loses empty and refill histories; removing either eligibility
// bit loses matched/underfilled alternatives; removing tied loses the leading
// tie boundary; removing direction loses descending continuation. Counts four
// and 40 are an adjacent fixed range probe and a larger stress probe below.
// Negative counts, duplicate row IDs, and directions other than asc/desc are
// invalid in this grammar.
// "Scenario" is a model-only input description, not a runtime demand state.
const scenarioArbitrary: fc.Arbitrary<Scenario> = fc.record({
  middleCount: fc.constantFrom(0 as const, 1 as const, 2 as const, 3 as const),
  middleEligible: fc.boolean(),
  lastEligible: fc.boolean(),
  tied: fc.boolean(),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
})

const exhaustiveScenarios: ReadonlyArray<Scenario> = (
  [0, 1, 2, 3] as const
).flatMap((middleCount) =>
  [false, true].flatMap((middleEligible) =>
    [false, true].flatMap((lastEligible) =>
      [false, true].flatMap((tied) =>
        ([`asc`, `desc`] as const).map((direction) => ({
          middleCount,
          middleEligible,
          lastEligible,
          tied,
          direction,
        })),
      ),
    ),
  ),
)

function compareRows(direction: Scenario[`direction`]) {
  return (left: Row, right: Row): number => {
    const rank = left.rank - right.rank
    return (direction === `asc` ? rank : -rank) || left.id - right.id
  }
}

function rowsForScenario(scenario: Scenario): Array<Row> {
  return [
    { id: 1, rank: 0, eligible: true, label: `first` },
    ...Array.from({ length: scenario.middleCount }, (_, index) => ({
      id: index + 3,
      rank: scenario.tied ? 0 : index + 1,
      eligible: scenario.middleEligible,
      label: `middle-${index}`,
    })),
    {
      id: 2,
      rank: scenario.middleCount + 1,
      eligible: scenario.lastEligible,
      label: `last`,
    },
  ]
}

function matchesJoinFilter(row: Row, joinFilter: JoinFilter): boolean {
  return joinFilter === `none` ? !row.eligible : row.eligible
}

let harnessId = 0

// A finite request recorder, not another production identity implementation.
// Preserve fields and primitive kinds; reject opaque values rather than merging
// them into an empty object. Signals/subscriptions are ownership, while
// refetch controls the attempt; none of the three changes demand identity.
function requestFingerprint(options: LoadSubsetOptions): string {
  const semantic = new Set([`where`, `orderBy`, `limit`, `offset`, `cursor`])
  for (const key of Reflect.ownKeys(options)) {
    if (
      !semantic.has(String(key)) &&
      key !== `signal` &&
      key !== `subscription` &&
      key !== `refetch`
    )
      throw new Error(`Unsupported request field ${String(key)}`)
  }
  const encode = (value: unknown): unknown => {
    if (value === undefined) return [`undefined`]
    if (value === null) return [`null`]
    if (typeof value === `number`) {
      if (!Number.isFinite(value)) throw new Error(`Nonfinite request value`)
      return [`number`, Object.is(value, -0) ? `-0` : value]
    }
    if (typeof value === `boolean` || typeof value === `string`)
      return [typeof value, value]
    if (Array.isArray(value)) return [`array`, value.map(encode)]
    if (typeof value !== `object`) throw new Error(`Opaque request value`)
    const prototype = Object.getPrototypeOf(value)
    if (
      prototype !== Object.prototype &&
      prototype !== null &&
      !(value instanceof Func) &&
      !(value instanceof PropRef) &&
      !(value instanceof Value)
    )
      throw new Error(`Opaque request object`)
    if (Reflect.ownKeys(value).some((key) => typeof key !== `string`))
      throw new Error(`Symbol request field`)
    // Absent optional compare fields and explicit undefined mean the same option.
    return [
      `object`,
      Object.entries(value)
        .filter(([, field]) => field !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, field]) => [key, encode(field)]),
    ]
  }
  return JSON.stringify(
    encode(
      Object.fromEntries(
        [...semantic].map((key) => [
          key,
          options[key as keyof LoadSubsetOptions],
        ]),
      ),
    ),
  )
}

function copiedRow(row: Row): Row {
  const copy: Record<string, unknown> = { ...row }
  for (const field of [
    `$key`,
    `$collectionId`,
    `$origin`,
    `$hasPendingWrites`,
    `$synced`,
  ])
    delete copy[field]
  return copy as Row
}

function expectRawWindow(
  actual: ReadonlyArray<Row>,
  expected: ReadonlyArray<Row>,
  direction: Scenario[`direction`],
  idTieBreak: boolean,
) {
  expect([...actual].sort(compareRows(direction))).toStrictEqual(
    [...expected].sort(compareRows(direction)),
  )
  for (let index = 1; index < actual.length; index++) {
    const left = actual[index - 1]!
    const right = actual[index]!
    const rank =
      direction === `asc` ? left.rank - right.rank : right.rank - left.rank
    expect(rank || (idTieBreak ? left.id - right.id : 0)).toBeLessThanOrEqual(0)
  }
}

function expectInitialWindows(
  publications: ReadonlyArray<ReadonlyArray<Row>>,
  expected: ReadonlyArray<Row>,
  direction: Scenario[`direction`],
  idTieBreak: boolean,
) {
  let published = expected.length === 0
  for (const rows of publications) {
    if (!published && rows.length === 0) continue
    expectRawWindow(rows, expected, direction, idTieBreak)
    published = true
  }
  expect(published, `complete initial public window reached`).toBe(true)
}

function expectNoProviderStart(before: number, after: number) {
  expect(after, `no provider start during disposal`).toBe(before)
}

function expectDistinctRequests(
  requests: ReadonlyArray<{ fingerprint: string }>,
) {
  expect(new Set(requests.map(({ fingerprint }) => fingerprint)).size).toBe(
    requests.length,
  )
}

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
  expect(effect.rows).toEqual(collection.rows)
  expect(effect.errors).toEqual(collection.errors)
  expect(effect.live).toBe(collection.live)
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
    expect(semanticRequests(effect.requests)).toEqual(
      semanticRequests(collection.requests),
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

async function observeMutationDuringBoundedRepair(): Promise<{
  rows: Array<number>
  requests: number
  publications: Array<Array<number>>
}> {
  const truth = new Map<number, Row>([
    [1, { id: 1, rank: 1, eligible: true, label: `first` }],
    [2, { id: 2, rank: 2, eligible: true, label: `second` }],
    [3, { id: 3, rank: 3, eligible: true, label: `third` }],
  ])
  const delivered = new Set<number>()
  const repairPrefixStarted = createDeferred<void>()
  const releaseRepairPrefix = createDeferred<void>()
  const repairTieStarted = createDeferred<void>()
  const releaseRepairTie = createDeferred<void>()
  const publications: Array<Array<number>> = []
  let heldRepairPrefix = false
  let heldRepairTie = false
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-mutation-during-repair-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        operations.markReady()
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !delivered.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            delivered.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !heldRepairPrefix) {
              heldRepairPrefix = true
              repairPrefixStarted.resolve()
              return releaseRepairPrefix.promise.then(() => apply(options))
            }
            const isRepairTie =
              options.refetch === true &&
              options.orderBy === undefined &&
              options.where !== undefined
            if (isRepairTie && !heldRepairTie) {
              heldRepairTie = true
              repairTieStarted.resolve()
              return releaseRepairTie.promise.then(() => apply(options))
            }
            return apply(options)
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) =>
    q
      .from({ row: source })
      .orderBy(({ row }) => row.rank)
      .limit(1),
  )
  const subscription = live.subscribeChanges(() => {
    publications.push(live.toArray.map(({ id }) => id))
  })

  return withHistoryCleanup(
    async () => {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])
      publications.length = 0

      const first = { ...truth.get(1)!, rank: 10 }
      truth.set(1, first)
      begin()
      write({ type: `update`, value: { ...first } })
      const firstReceipt = commit()
      if (firstReceipt !== true) await firstReceipt
      await repairPrefixStarted.promise
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      releaseRepairPrefix.resolve()
      await repairTieStarted.promise

      const second = { ...truth.get(2)!, rank: 20 }
      truth.set(2, second)
      begin()
      write({ type: `update`, value: { ...second } })
      const secondReceipt = commit()
      if (secondReceipt !== true) await secondReceipt
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      releaseRepairTie.resolve()
      await vi.waitFor(() =>
        expect(live.toArray.map(({ id }) => id)).toEqual([3]),
      )
      expect(publications).toEqual([[3]])
      expect(requests).toBeGreaterThanOrEqual(6)
      return {
        rows: live.toArray.map(({ id }) => id),
        requests,
        publications: publications.map((rows) => [...rows]),
      }
    },
    () => [
      () => releaseRepairPrefix.resolve(),
      () => releaseRepairTie.resolve(),
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => source.cleanup(),
    ],
  )
}

async function observeHeldEffectRepair(
  repairPrefix: `synchronous` | `asynchronous`,
): Promise<Array<Array<number>>> {
  const truth: Array<Row> = [
    { id: 1, rank: 1, eligible: true, label: `first` },
    { id: 2, rank: 2, eligible: true, label: `second` },
  ]
  const repairStarted = createDeferred<void>()
  const releaseRepair = createDeferred<void>()
  const effectRows = new Set<number>()
  const publications: Array<Array<number>> = []
  let recovering = false
  let loadCount = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => void

  const source = createCollection<Row, number>({
    id: `ordered-held-effect-repair-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        operations.markReady()
        const apply = (options: LoadSubsetOptions) => {
          const selected = truth
            .filter(
              (row) =>
                (!options.where ||
                  evaluateReferenceExpression(options.where, row) === true) &&
                (!options.cursor ||
                  evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                    true),
            )
            .sort((left, right) => left.rank - right.rank || left.id - right.id)
            .slice(
              options.offset ?? 0,
              options.limit === undefined
                ? undefined
                : (options.offset ?? 0) + options.limit,
            )
          begin()
          for (const row of selected) {
            write({ type: `insert`, value: { ...row } })
          }
          commit()
        }
        return {
          loadSubset: (options) => {
            loadCount++
            const isRepair =
              recovering &&
              options.orderBy !== undefined &&
              options.limit === 1 &&
              options.cursor === undefined
            if (!isRepair) {
              apply(options)
              return true
            }
            if (repairPrefix === `synchronous`) {
              apply(options)
              return true
            }
            repairStarted.resolve()
            return releaseRepair.promise.then(() => apply(options))
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) effectRows.delete(event.key)
        else effectRows.add(event.key)
      }
      publications.push([...effectRows].sort((left, right) => left - right))
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect([...effectRows]).toEqual([1]))
      await vi.waitFor(() => expect(loadCount).toBeGreaterThanOrEqual(2))
      await flushPromises()
      publications.length = 0
      recovering = true
      const removed = truth.shift()!
      begin()
      write({ type: `delete`, value: removed })
      commit()
      if (repairPrefix === `asynchronous`) {
        await repairStarted.promise
        await flushPromises()

        expect(
          [...effectRows],
          `last complete effect result while held`,
        ).toEqual([1])
        expect(publications, `no intermediate effect publication`).toEqual([])

        releaseRepair.resolve()
      }
      await vi.waitFor(() => expect([...effectRows]).toEqual([2]))
      expect(publications).toEqual([[2]])
      return publications.map((rows) => [...rows])
    },
    () => [
      () => releaseRepair.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

async function observeEffectAfterObsoleteRepairAbort(): Promise<{
  rows: Array<number>
  batches: Array<Array<string>>
  finalLabel: string | undefined
}> {
  const truth = new Map<number, Row>([
    [1, { id: 1, rank: 1, eligible: true, label: `first` }],
    [2, { id: 2, rank: 2, eligible: true, label: `second` }],
  ])
  const installed = new Set<number>()
  const effectRows = new Map<number, Row>()
  const batches: Array<Array<string>> = []
  let repairHeld = false
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let truncate!: () => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-obsolete-effect-repair-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        truncate = operations.truncate
        commit = operations.commit
        operations.markReady()
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !installed.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            installed.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            requests++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !repairHeld) {
              repairHeld = true
              return new Promise<void>((_resolve, reject) => {
                const abort = () =>
                  reject(new LoadSubsetOperationAbortedError())
                if (options.signal?.aborted) abort()
                else {
                  options.signal?.addEventListener(`abort`, abort, {
                    once: true,
                  })
                }
              })
            }
            return apply(options)
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: (events) => {
      const labels: Array<string> = []
      for (const event of events) {
        labels.push(`${event.type}:${event.key}`)
        if (event.type === `exit`) effectRows.delete(event.key)
        else effectRows.set(event.key, copiedRow(event.value))
      }
      batches.push(labels)
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect([...effectRows.keys()]).toEqual([1]))
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(2))
      await flushPromises()
      batches.length = 0

      const removed = truth.get(1)!
      truth.delete(1)
      installed.delete(1)
      begin()
      write({ type: `delete`, value: removed })
      const deleteReceipt = commit()
      if (deleteReceipt !== true) await deleteReceipt
      await vi.waitFor(() => expect(repairHeld).toBe(true))

      installed.clear()
      begin()
      truncate()
      const truncateReceipt = commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(5))
      await flushPromises()

      const replacement = truth.get(2)!
      const updated = { ...replacement, label: `updated after replay` }
      truth.set(2, updated)
      begin()
      write({ type: `update`, value: updated })
      const updateReceipt = commit()
      if (updateReceipt !== true) await updateReceipt
      await vi.waitFor(() =>
        expect(effectRows.get(2)?.label).toBe(`updated after replay`),
      )

      return {
        rows: [...effectRows.keys()],
        batches: batches.map((batch) => [...batch]),
        finalLabel: effectRows.get(2)?.label,
      }
    },
    () => [() => effect.dispose(), () => source.cleanup()],
  )
}

async function observeSkipInitialOrderedLoad(): Promise<{
  initialEvents: Array<string>
  laterEvents: Array<string>
}> {
  const truth: Array<Row> = [
    { id: 1, rank: 1, eligible: true, label: `first` },
    { id: 2, rank: 2, eligible: true, label: `second` },
  ]
  const firstRequest = createDeferred<void>()
  const installed = new Set<number>()
  const events: Array<string> = []
  let requests = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-skip-initial-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        operations.markReady()
        return {
          loadSubset: async (options: LoadSubsetOptions) => {
            requests++
            if (requests === 1) await firstRequest.promise
            let selected = truth.filter(
              (row) =>
                (!options.where ||
                  evaluateReferenceExpression(options.where, row) === true) &&
                (!options.cursor ||
                  evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                    true),
            )
            selected.sort(
              (left, right) => left.rank - right.rank || left.id - right.id,
            )
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            selected = selected.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            const additions = selected.filter(({ id }) => !installed.has(id))
            if (additions.length === 0) return
            begin()
            for (const row of additions) {
              installed.add(row.id)
              write({ type: `insert`, value: { ...row } })
            }
            const receipt = commit()
            if (receipt !== true) await receipt
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    skipInitial: true,
    onBatch: (batch) => {
      events.push(...batch.map((event) => `${event.type}:${event.key}`))
    },
  })

  return withHistoryCleanup(
    async () => {
      await vi.waitFor(() => expect(requests).toBe(1))
      firstRequest.resolve()
      await vi.waitFor(() => expect(requests).toBeGreaterThanOrEqual(2))
      await flushPromises()
      const initialEvents = [...events]
      events.length = 0

      const inserted: Row = {
        id: 3,
        rank: 0,
        eligible: true,
        label: `later`,
      }
      truth.push(inserted)
      installed.add(inserted.id)
      begin()
      write({ type: `insert`, value: inserted })
      const receipt = commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() => expect(events.length).toBeGreaterThan(0))

      return { initialEvents, laterEvents: [...events] }
    },
    () => [
      () => firstRequest.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

async function observeHeldEffectDelta(
  history: `absent-cycle` | `present-update-exit`,
): Promise<{
  batches: Array<Array<string>>
  rows: Array<number>
  exitedValues: Map<number, Row>
}> {
  const limit = history === `absent-cycle` ? 1 : 2
  const truth = new Map<number, Row>(
    (history === `absent-cycle`
      ? [
          { id: 1, rank: 1, eligible: true, label: `first` },
          { id: 3, rank: 3, eligible: true, label: `third` },
        ]
      : [
          { id: 1, rank: 1, eligible: true, label: `first` },
          { id: 2, rank: 2, eligible: true, label: `second` },
          { id: 3, rank: 3, eligible: true, label: `third` },
          { id: 4, rank: 4, eligible: true, label: `fourth` },
        ]
    ).map((row) => [row.id, row]),
  )
  const delivered = new Set<number>()
  const repairStarted = createDeferred<void>()
  const releaseRepair = createDeferred<void>()
  const effectRows = new Map<number, Row>()
  const batches: Array<Array<string>> = []
  const exitedValues = new Map<number, Row>()
  let heldRepair = false
  let loadCount = 0
  let begin!: () => void
  let write!: (message: {
    type: `insert` | `update` | `delete`
    value: Row
  }) => void
  let commit!: () => true | Promise<void>

  const source = createCollection<Row, number>({
    id: `ordered-held-effect-delta-${history}-${harnessId++}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        begin = operations.begin
        write = operations.write
        commit = operations.commit
        operations.markReady()
        const apply = async (options: LoadSubsetOptions) => {
          let selected = [...truth.values()].filter(
            (row) =>
              (!options.where ||
                evaluateReferenceExpression(options.where, row) === true) &&
              (!options.cursor ||
                evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                  true),
          )
          selected.sort(
            (left, right) => left.rank - right.rank || left.id - right.id,
          )
          const offset = options.cursor ? 0 : (options.offset ?? 0)
          selected = selected.slice(
            offset,
            options.limit === undefined ? undefined : offset + options.limit,
          )
          const additions = selected.filter(({ id }) => !delivered.has(id))
          if (additions.length === 0) return
          begin()
          for (const row of additions) {
            delivered.add(row.id)
            write({ type: `insert`, value: { ...row } })
          }
          const receipt = commit()
          if (receipt !== true) await receipt
        }
        return {
          loadSubset: (options: LoadSubsetOptions) => {
            loadCount++
            const isRepairPrefix =
              options.refetch === true &&
              options.orderBy !== undefined &&
              options.cursor === undefined
            if (isRepairPrefix && !heldRepair) {
              heldRepair = true
              repairStarted.resolve()
              return releaseRepair.promise.then(() => apply(options))
            }
            return apply(options)
          },
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(limit),
    onBatch: (events: Array<DeltaEvent<Row, number>>) => {
      const labels: Array<string> = []
      for (const event of events) {
        labels.push(`${event.type}:${String(event.key)}`)
        if (event.type === `exit`) {
          exitedValues.set(event.key, copiedRow(event.value))
          effectRows.delete(event.key)
        } else {
          effectRows.set(event.key, { ...event.value })
        }
      }
      batches.push(labels)
    },
  })

  const applySourceChange = async (
    type: `insert` | `update` | `delete`,
    row: Row,
  ) => {
    begin()
    write({ type, value: { ...row } })
    const receipt = commit()
    if (receipt !== true) await receipt
  }

  return withHistoryCleanup(
    async () => {
      const initialIds = history === `absent-cycle` ? [1] : [1, 2]
      await vi.waitFor(() =>
        expect([...effectRows.keys()].sort((a, b) => a - b)).toEqual(
          initialIds,
        ),
      )
      await vi.waitFor(() => expect(loadCount).toBeGreaterThanOrEqual(2))
      await flushPromises()
      batches.length = 0

      const first = truth.get(1)!
      truth.delete(1)
      delivered.delete(1)
      await applySourceChange(`delete`, first)
      await repairStarted.promise

      if (history === `absent-cycle`) {
        const transient: Row = {
          id: 2,
          rank: 2,
          eligible: true,
          label: `transient`,
        }
        delivered.add(transient.id)
        await applySourceChange(`insert`, transient)
        delivered.delete(transient.id)
        await applySourceChange(`delete`, transient)
      } else {
        const previous = truth.get(2)!
        const updated = { ...previous, rank: 20, label: `updated` }
        truth.set(2, updated)
        await applySourceChange(`update`, updated)
        truth.delete(2)
        delivered.delete(2)
        await applySourceChange(`delete`, updated)
      }

      expect(batches).toEqual([])
      releaseRepair.resolve()
      const expectedIds = history === `absent-cycle` ? [3] : [3, 4]
      await vi.waitFor(() =>
        expect([...effectRows.keys()].sort((a, b) => a - b)).toEqual(
          expectedIds,
        ),
      )

      expect(batches).toHaveLength(1)
      const flattened = batches.flat()
      if (history === `absent-cycle`) {
        expect(flattened).not.toContain(`update:2`)
        expect(flattened).not.toContain(`enter:2`)
        expect(flattened).not.toContain(`exit:2`)
      } else {
        expect(flattened).toContain(`exit:2`)
        expect(flattened).not.toContain(`update:2`)
        expect(exitedValues.get(2)).toEqual({
          id: 2,
          rank: 2,
          eligible: true,
          label: `second`,
        })
      }
      return {
        batches: batches.map((batch) => [...batch]),
        rows: [...effectRows.keys()].sort((a, b) => a - b),
        exitedValues,
      }
    },
    () => [
      () => releaseRepair.resolve(),
      () => effect.dispose(),
      () => source.cleanup(),
    ],
  )
}

describe(`ordered source work oracle`, () => {
  it(`reconstructs every legal small scenario exactly once`, () => {
    expect(exhaustiveScenarios).toHaveLength(64)
    expect(
      new Set(exhaustiveScenarios.map((scenario) => JSON.stringify(scenario)))
        .size,
    ).toBe(64)
  })

  it(`rejects scrambled order and partial or regressed initial publications`, () => {
    const rows: Array<Row> = [
      { id: 1, rank: 1, eligible: true, label: `first` },
      { id: 2, rank: 2, eligible: true, label: `second` },
    ]
    expectInitialWindows([[], rows], rows, `asc`, true)
    expect(() =>
      expectRawWindow([...rows].reverse(), rows, `asc`, true),
    ).toThrow()
    expect(() =>
      expectInitialWindows([[rows[0]!], rows], rows, `asc`, true),
    ).toThrow()
    expect(() => expectInitialWindows([rows, []], rows, `asc`, true)).toThrow()
    const tied = rows.map((row) => ({ ...row, rank: 1 })).reverse()
    expectRawWindow(tied, tied, `asc`, false)
    expect(() => expectRawWindow(tied, tied, `asc`, true)).toThrow()
  })

  it(`identifies repeated finite requests without the production request key`, () => {
    const options: LoadSubsetOptions = { limit: 1 }
    const fingerprint = requestFingerprint(options)
    const requests = [
      { key: `a`, fingerprint },
      { key: `b`, fingerprint },
    ]
    expect(() => expectDistinctRequests(requests)).toThrow()
    options.limit = 2
    expectDistinctRequests([
      requests[0]!,
      { fingerprint: requestFingerprint(options) },
    ])
    expect(fingerprint).toBe(requestFingerprint({ limit: 1 }))
    expect(() =>
      requestFingerprint({
        where: new Func<boolean>(`eq`, [
          new Value(new Date()),
          new Value(new Date()),
        ]),
      }),
    ).toThrow()
  })

  it(`checks the live request recorder after disposal rather than its earlier copy`, () => {
    const requests = [{ fingerprint: requestFingerprint({ limit: 1 }) }]
    const returned = [...requests]
    const before = requests.length
    expectNoProviderStart(before, requests.length)
    requests.push({ fingerprint: requestFingerprint({ limit: 2 }) })
    expect(returned).toHaveLength(1)
    expect(() => expectNoProviderStart(before, requests.length)).toThrow()
  })

  it(`keeps later order-term invalidation equal across consumers`, async () => {
    const [collection, effect] = await Promise.all([
      observeLaterOrderTermMutation(`collection`),
      observeLaterOrderTermMutation(`effect`),
    ])
    expect(effect.rows).toEqual(collection.rows)
    // The two graph entry points may take a different bounded number of
    // refinement passes, but they must exercise the same demand forms.
    expect(new Set(effect.requests)).toEqual(new Set(collection.requests))
  })

  it.each([`move`, `delete`] as const)(
    `recovers a finite source prefix equally across consumers after %s`,
    async (mutation) => {
      const [collection, effect] = await Promise.all([
        observeFinitePrefixMutation(`collection`, mutation),
        observeFinitePrefixMutation(`effect`, mutation),
      ])

      expect(effect.rows).toEqual(collection.rows)
      expect(effect.publications.at(-1)).toEqual(collection.publications.at(-1))
    },
  )

  it(`holds the last complete Effect result across an asynchronous prefix and synchronous tie repair`, async () => {
    await expect(observeHeldEffectRepair(`asynchronous`)).resolves.toEqual([
      [2],
    ])
  })

  it(`publishes one Effect replacement when ordered repair settles synchronously`, async () => {
    await expect(observeHeldEffectRepair(`synchronous`)).resolves.toEqual([[2]])
  })

  it(`publishes the repaired ordered Effect delta when a source changes during startup`, async () => {
    // Fixed history: the first ordered page contains row 1. Subscribing to
    // the sibling updates row 1 before the Effect can run its initial graph.
    // The independent final rank order is row 2, then row 1. At the first
    // callback checkpoint, only row 2 may enter the width-one result.
    type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const truth = new Map<number, Row>([
      [1, { id: 1, rank: 1, eligible: true, label: `first` }],
      [2, { id: 2, rank: 2, eligible: true, label: `second` }],
    ])
    let rootSync!: Sync
    const delivered = new Set<number>()
    const requests: Array<LoadSubsetOptions> = []
    const root = createCollection<Row, number>({
      id: `ordered-effect-start-root-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              const selected = [...truth.values()]
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
                .sort((a, b) => a.rank - b.rank || a.id - b.id)
                .slice(
                  options.offset ?? 0,
                  options.limit === undefined
                    ? undefined
                    : (options.offset ?? 0) + options.limit,
                )
              operations.begin()
              for (const row of selected) {
                if (!delivered.has(row.id)) {
                  delivered.add(row.id)
                  operations.write({ type: `insert`, value: { ...row } })
                }
              }
              expect(
                operations.commit(),
                `ordered page applies synchronously`,
              ).toBe(true)
              return true
            },
          }
        },
      },
    })
    const marker = createCollection<Marker, number>({
      id: `ordered-effect-start-marker-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
        },
      },
    })
    const originalSubscribe = marker.subscribeChanges.bind(marker)
    let changedDuringStart = false
    vi.spyOn(marker, `subscribeChanges`).mockImplementation(((...args) => {
      const subscription = originalSubscribe(...args)
      // Only the first subscription after the ordered page can drive this
      // history; other subscribers must not repeat or preempt the update.
      if (changedDuringStart || requests.length === 0) return subscription
      expect(requests[0]?.orderBy, `first request is ordered`).toBeDefined()
      expect(requests[0]?.limit, `first request loads one row`).toBe(1)
      expect(delivered.has(1), `first page installed row 1`).toBe(true)
      expect(root.get(1)?.rank, `row 1 is present before its update`).toBe(1)
      changedDuringStart = true
      const updated = { ...truth.get(1)!, rank: 3, label: `moved` }
      truth.set(1, updated)
      rootSync.begin()
      rootSync.write({ type: `update`, value: updated })
      expect(rootSync.commit(), `startup update applies synchronously`).toBe(
        true,
      )
      return subscription
    }) as typeof marker.subscribeChanges)

    const batches: Array<Array<DeltaEvent<Row, string>>> = []
    let effect: ReturnType<typeof createEffect> | undefined
    // Drain the scheduled callback queue at the assertion checkpoint. A single
    // event-loop turn can miss a later duplicate batch.
    vi.useFakeTimers()
    try {
      await withHistoryCleanup(
        async () => {
          effect = createEffect<Row, string>({
            query: (q) =>
              q
                .from({ row: root })
                .leftJoin({ marker }, ({ row, marker: child }) =>
                  eq(row.id, child.rowId),
                )
                .orderBy(({ row }) => row.rank)
                .limit(1)
                .select(({ row }) => ({
                  id: row.id,
                  rank: row.rank,
                  eligible: row.eligible,
                  label: row.label,
                })),
            onBatch: (events) => {
              batches.push(events)
            },
          })
          expect(changedDuringStart).toBe(true)
          await vi.runAllTimersAsync()
          expect(batches).toEqual([
            [{ type: `enter`, key: `[2,null]`, value: truth.get(2) }],
          ])
          expect(requests.some((options) => options.refetch === true)).toBe(
            true,
          )
        },
        () => [
          () => effect?.dispose(),
          () => root.cleanup(),
          () => marker.cleanup(),
        ],
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it(`keeps an Effect live when truncate replay aborts an obsolete repair participant`, async () => {
    await expect(
      observeEffectAfterObsoleteRepairAbort(),
    ).resolves.toMatchObject({
      rows: [2],
      finalLabel: `updated after replay`,
    })
  })

  it(`suppresses an asynchronous initial ordered window when skipInitial is set`, async () => {
    await expect(observeSkipInitialOrderedLoad()).resolves.toEqual({
      initialEvents: [],
      laterEvents: expect.arrayContaining([`enter:3`, `exit:1`]),
    })
  })

  it(`suppresses the initial joined-filter window while child demand settles`, async () => {
    type Root = { id: number; rank: number; label: string }
    const initial = { id: 1, rank: 1, label: `initial` }
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    const root = createCollection<Root, number>({
      id: `ordered-skip-joined-root-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.begin()
          operations.write({ type: `insert`, value: initial })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const childGate = createDeferred<void>()
    let childLoads = 0
    const child = createCollection<Marker, number>({
      id: `ordered-skip-joined-child-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: () => {
              childLoads++
              return childGate.promise
            },
          }
        },
      },
    })
    const events: Array<string> = []
    const effect = createEffect<{ id: number; label: string }>({
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: child }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, label: row.label })),
      skipInitial: true,
      onBatch: (batch) => {
        events.push(...batch.map((event) => event.type))
      },
    })
    await withHistoryCleanup(
      async () => {
        await vi.waitFor(() => expect(childLoads).toBeGreaterThan(0))
        await flushPromises()
        expect(events).toEqual([])
        childGate.resolve()
        await flushPromises()
        expect(events).toEqual([])

        rootSync.begin()
        rootSync.write({
          type: `update`,
          value: { ...initial, label: `later` },
        })
        const receipt = rootSync.commit()
        if (receipt !== true) await receipt
        await vi.waitFor(() => expect(events).toContain(`update`))
      },
      () => [
        () => childGate.resolve(),
        () => effect.dispose(),
        () => root.cleanup(),
        () => child.cleanup(),
      ],
    )
  })

  it(`avoids an extra joined-filter graph turn when the root becomes ready`, async () => {
    type Root = { id: number; rank: number }
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    let joinedSync!: Parameters<SyncConfig<Marker, number>[`sync`]>[0]
    const root = createCollection<Root, number>({
      id: `ordered-ready-root-${harnessId++}`,
      getKey: ({ id }) => id,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: { sync: (operations) => void (rootSync = operations) },
    })
    const joined = createCollection<Marker, number>({
      id: `ordered-ready-joined-${harnessId++}`,
      getKey: ({ id }) => id,
      startSync: true,
      syncMode: `on-demand`,
      sync: {
        sync: (operations) => {
          joinedSync = operations
          return { loadSubset: () => true }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-ready-live-${harnessId++}`,
      startSync: true,
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: joined }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(0)
          .select(({ row }) => ({ id: row.id })),
    })
    await withHistoryCleanup(
      () => {
        const builder = getCollectionBuilder(live)!
        expect(
          Object.values(builder.optimizableOrderByCollections).some(
            (info) => info.joinedFilterSourceId !== undefined,
          ),
        ).toBe(true)
        const scheduled = vi.spyOn(builder, `scheduleGraphRun`)
        rootSync.markReady()
        // Root readiness already schedules its ordinary graph turn.
        expect(scheduled).toHaveBeenCalledTimes(1)
        joinedSync.markReady()
        // Joined readiness also rechecks the joined-filter demand gate.
        expect(scheduled).toHaveBeenCalledTimes(3)
        return Promise.resolve()
      },
      () => [
        () => live.cleanup(),
        () => root.cleanup(),
        () => joined.cleanup(),
      ],
    )
  })

  it(`restarts bounded repair when another order mutation arrives during its tie request`, async () => {
    await expect(observeMutationDuringBoundedRepair()).resolves.toMatchObject({
      rows: [3],
      publications: [[3]],
    })
  })

  it(`emits no Effect delta for a row that enters and exits during held repair`, async () => {
    await expect(observeHeldEffectDelta(`absent-cycle`)).resolves.toMatchObject(
      {
        rows: [3],
      },
    )
  })

  it(`emits the published value when an updated row exits during held repair`, async () => {
    await expect(
      observeHeldEffectDelta(`present-update-exit`),
    ).resolves.toMatchObject({ rows: [3, 4] })
  })

  it(`loads each source of a filtered join once`, async () => {
    type Order = {
      id: number
      scheduledAt: string
      status: string
      addressId: number
    }
    type Charge = { id: number; addressId: number }
    let orderLoads = 0
    let chargeLoads = 0
    const orders = createCollection<Order>({
      id: `ordered-filtered-join-orders`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({
            type: `insert`,
            value: {
              id: 1,
              scheduledAt: `2024-01-15`,
              status: `queued`,
              addressId: 1,
            },
          })
          write({
            type: `insert`,
            value: {
              id: 2,
              scheduledAt: `2024-01-10`,
              status: `queued`,
              addressId: 2,
            },
          })
          commit()
          markReady()
          return {
            loadSubset: () => {
              orderLoads++
              return true
            },
          }
        },
      },
    })
    const charges = createCollection<Charge>({
      id: `ordered-filtered-join-charges`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: 10, addressId: 1 } })
          write({ type: `insert`, value: { id: 20, addressId: 2 } })
          commit()
          markReady()
          return {
            loadSubset: () => {
              chargeLoads++
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ order: orders })
        .where(({ order }) => gte(order.scheduledAt, `2024-01-12`))
        .where(({ order }) => eq(order.status, `queued`))
        .innerJoin({ charge: charges }, ({ order, charge }) =>
          eq(order.addressId, charge.addressId),
        ),
    )

    try {
      await live.preload()
      expect(
        [...live.values()].map(({ order, charge }) => [order.id, charge.id]),
      ).toEqual([[1, 10]])
      expect(orderLoads).toBe(1)
      expect(chargeLoads).toBe(1)
    } finally {
      await Promise.all([live.cleanup(), orders.cleanup(), charges.cleanup()])
    }
  })

  it.each([`collection`, `effect`] as const)(
    `does no source work for a zero-sized %s window`,
    async (consumer) => {
      let loads = 0
      const source = createCollection<Row, number>({
        id: `ordered-zero-window`,
        getKey: (row) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                loads++
                return true
              },
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(0)
      const live =
        consumer === `collection`
          ? createLiveQueryCollection({
              id: `ordered-zero-window-live`,
              query,
              startSync: true,
            })
          : undefined
      const effect =
        consumer === `effect`
          ? createEffect({ query, onBatch: () => {} })
          : undefined

      try {
        if (live) await live.preload()
        else await flushPromises()
        expect(loads).toBe(0)
      } finally {
        if (effect) await effect.dispose()
        if (live) await live.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each(
    ([`collection`, `effect`] as const).flatMap((consumer) =>
      ([`eager`, `off`] as const).map((autoIndex) => ({
        consumer,
        autoIndex,
      })),
    ),
  )(
    `does no source work for a joined $consumer with a zero-sized $autoIndex window`,
    async ({ consumer, autoIndex }) => {
      let rowLoads = 0
      let markerLoads = 0
      const source = createCollection<Row, number>({
        id: `ordered-zero-window-unindexed-${consumer}-source`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex,
        defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                rowLoads++
                return true
              },
            }
          },
        },
      })
      const markers = createCollection<Marker, number>({
        id: `ordered-zero-window-unindexed-${consumer}-marker`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex,
        defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                markerLoads++
                return true
              },
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: source })
          .innerJoin({ marker: markers }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .orderBy(({ row }) => row.rank)
          .limit(0)
      const live =
        consumer === `collection`
          ? createLiveQueryCollection({ query, startSync: true })
          : undefined
      const effect =
        consumer === `effect`
          ? createEffect({ query, onBatch: () => {} })
          : undefined

      try {
        if (live) await live.preload()
        else await flushPromises()
        expect({ rowLoads, markerLoads }).toEqual({
          rowLoads: 0,
          markerLoads: 0,
        })
      } finally {
        if (effect) await effect.dispose()
        if (live) await live.cleanup()
        await Promise.all([source.cleanup(), markers.cleanup()])
      }
    },
  )

  it.each(
    ([`collection`, `effect`] as const).flatMap((consumer) =>
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
    ),
  )(
    `does not refetch when a visible row changes outside the ordering key: %j`,
    async ({ consumer, limit, position, direction }) => {
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
        const expected = [...rows].sort(compareRows(direction)).slice(0, limit)
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
    },
  )

  it.each([
    {
      name: `matching`,
      secondaryRows: [
        { id: `c-child`, joinKey: `c` },
        { id: `d-child`, joinKey: `d` },
      ],
      expected: [`c:c-child`, `d:d-child`],
    },
    {
      name: `empty`,
      secondaryRows: [] as Array<{ id: string; joinKey: string }>,
      expected: [] as Array<string>,
    },
  ])(
    `waits for a $name joined source after exhausting tied ordered rows`,
    async ({ name, secondaryRows, expected }) => {
      type Primary = { id: string; rank: number; joinKey: string }
      type Secondary = { id: string; joinKey: string }
      const primaryRows: Array<Primary> = [`a`, `b`, `c`, `d`].map((id) => ({
        id,
        rank: 0,
        joinKey: id,
      }))
      const deliveredPrimary = new Set<string>()
      const deliveredSecondary = new Set<string>()
      const secondaryLoads: Array<{
        options: LoadSubsetOptions
        gate: ReturnType<typeof createDeferred<void>>
      }> = []
      let primaryExhausted = false

      const primary = createCollection<Primary>({
        id: `ordered-late-join-primary-${name}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                const rows = options.orderBy
                  ? [
                      primaryRows[
                        options.cursor?.lastKey
                          ? primaryRows.findIndex(
                              ({ id }) => id === options.cursor?.lastKey,
                            ) + 1
                          : 0
                      ],
                    ].filter((row): row is Primary => row !== undefined)
                  : primaryRows.filter(
                      (row) =>
                        !options.where ||
                        evaluateReferenceExpression(options.where, row) ===
                          true,
                    )
                const fresh = rows.filter(({ id }) => !deliveredPrimary.has(id))
                if (fresh.length > 0) {
                  begin()
                  for (const row of fresh) {
                    deliveredPrimary.add(row.id)
                    write({ type: `insert`, value: row })
                  }
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
                primaryExhausted = deliveredPrimary.size === primaryRows.length
              },
            }
          },
        },
      })
      const secondary = createCollection<Secondary>({
        id: `ordered-late-join-secondary-${name}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                const gate = createDeferred<void>()
                secondaryLoads.push({ options, gate })
                await gate.promise
                const fresh = secondaryRows.filter(
                  (row) =>
                    !deliveredSecondary.has(row.id) &&
                    (!options.where ||
                      evaluateReferenceExpression(options.where, row) === true),
                )
                for (const row of fresh) {
                  deliveredSecondary.add(row.id)
                  begin()
                  write({ type: `insert`, value: row })
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
              },
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ primaryRow: primary })
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .limit(2),
      )

      try {
        const preload = live.preload()
        let settled = false
        void preload.finally(() => {
          settled = true
        })
        await vi.waitFor(() =>
          expect(
            primaryExhausted,
            JSON.stringify({
              deliveredPrimary: [...deliveredPrimary],
              secondaryLoads: secondaryLoads.length,
            }),
          ).toBe(true),
        )
        expect(secondaryLoads.length).toBeGreaterThan(0)
        expect(settled).toBe(false)

        for (const load of [...secondaryLoads].reverse()) {
          load.gate.resolve()
          await flushPromises()
        }
        await preload

        expect(
          live.toArray.map(
            ({ primaryRow, secondaryRow }) =>
              `${primaryRow.id}:${secondaryRow.id}`,
          ),
        ).toEqual(expected)
        expect(live.isLoadingSubset).toBe(false)
        expect(live.utils.lastSubsetError).toBeUndefined()
      } finally {
        for (const { gate } of secondaryLoads) gate.resolve()
        await Promise.all([
          live.cleanup(),
          primary.cleanup(),
          secondary.cleanup(),
        ])
      }
    },
  )

  it(`keeps independent joined loads isolated when they settle in reverse`, async () => {
    type Primary = { id: string; rank: number; joinKey: string }
    type Secondary = { id: string; joinKey: string }
    const pending: Array<{
      options: LoadSubsetOptions
      gate: ReturnType<typeof createDeferred<void>>
    }> = []
    const completionOrder: Array<number> = []
    const primary = createCollection<Primary>({
      id: `ordered-independent-primary`,
      getKey: ({ id }) => id,
      syncMode: `eager`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          write({ type: `insert`, value: { id: `a`, rank: 1, joinKey: `a` } })
          write({ type: `insert`, value: { id: `b`, rank: 2, joinKey: `b` } })
          commit()
          markReady()
        },
      },
    })
    const secondaryRows: Array<Secondary> = [
      { id: `a-child`, joinKey: `a` },
      { id: `b-child`, joinKey: `b` },
    ]
    const delivered = new Set<string>()
    const secondary = createCollection<Secondary>({
      id: `ordered-independent-secondary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: async (options) => {
              const index = pending.length
              const gate = createDeferred<void>()
              pending.push({ options, gate })
              await gate.promise
              const rows = secondaryRows.filter(
                (candidate) =>
                  !delivered.has(candidate.id) &&
                  (!options.where ||
                    evaluateReferenceExpression(options.where, candidate) ===
                      true),
              )
              for (const row of rows) {
                delivered.add(row.id)
                begin()
                write({ type: `insert`, value: row })
                const receipt = commit(options.signal)
                if (receipt !== true) await receipt
              }
              completionOrder.push(index)
            },
          }
        },
      },
    })
    const createJoined = (id: `a` | `b`) =>
      createLiveQueryCollection((q) =>
        q
          .from({ primaryRow: primary })
          .where(({ primaryRow }) => eq(primaryRow.id, id))
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .limit(1),
      )
    const first = createJoined(`a`)
    const second = createJoined(`b`)

    try {
      const firstPreload = first.preload()
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      const secondPreload = second.preload()
      await vi.waitFor(() => expect(pending).toHaveLength(2))
      let firstSettled = false
      void firstPreload.finally(() => {
        firstSettled = true
      })

      pending[1]!.gate.resolve()
      await secondPreload
      await flushPromises()
      expect(firstSettled).toBe(false)
      expect(
        second.toArray.map(
          ({ primaryRow, secondaryRow }) =>
            `${primaryRow.id}:${secondaryRow.id}`,
        ),
      ).toEqual([`b:b-child`])

      pending[0]!.gate.resolve()
      await firstPreload
      expect(completionOrder).toEqual([1, 0])
      expect(
        first.toArray.map(
          ({ primaryRow, secondaryRow }) =>
            `${primaryRow.id}:${secondaryRow.id}`,
        ),
      ).toEqual([`a:a-child`])
      expect(first.utils.lastSubsetError).toBeUndefined()
      expect(second.utils.lastSubsetError).toBeUndefined()
    } finally {
      for (const { gate } of pending) gate.resolve()
      await Promise.all([
        first.cleanup(),
        second.cleanup(),
        primary.cleanup(),
        secondary.cleanup(),
      ])
    }
  })

  it(`keeps one source's replay from suppressing another source's recovery`, async () => {
    type Primary = { id: number; rank: number }
    type Secondary = { id: number; primaryId: number }
    const primaryTruth = new Map<number, Primary>([
      [1, { id: 1, rank: 0 }],
      [2, { id: 2, rank: 1 }],
    ])
    const deliveredPrimary = new Set<number>()
    const secondaryReplay = createDeferred<void>()
    let primaryRequests = 0
    let replayingSecondary = false
    let primarySync!: Parameters<SyncConfig<Primary, number>[`sync`]>[0]
    let secondarySync!: Parameters<SyncConfig<Secondary, number>[`sync`]>[0]
    let secondaryReplayCalls = 0

    const primary = createCollection<Primary, number>({
      id: `ordered-independent-recovery-primary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          primarySync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              primaryRequests++
              let selected = [...primaryTruth.values()].sort(
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
              const fresh = selected.filter(
                ({ id }) => !deliveredPrimary.has(id),
              )
              if (fresh.length === 0) return
              operations.begin()
              for (const row of fresh) {
                deliveredPrimary.add(row.id)
                operations.write({ type: `insert`, value: { ...row } })
              }
              const receipt = operations.commit(options.signal)
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const secondary = createCollection<Secondary, number>({
      id: `ordered-independent-recovery-secondary`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          secondarySync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              if (replayingSecondary) {
                secondaryReplayCalls++
                await secondaryReplay.promise
              }
              operations.begin()
              operations.write({
                type: `insert`,
                value: { id: 1, primaryId: 1 },
              })
              const receipt = operations.commit(options.signal)
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: primary })
        .leftJoin({ child: secondary }, ({ row, child }) =>
          eq(row.id, child.primaryId),
        )
        .orderBy(({ row }) => row.rank)
        .limit(1)
        .select(({ row, child }) => ({
          id: row.id,
          rank: row.rank,
          childId: child.id,
        })),
    )

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      replayingSecondary = true
      secondarySync.begin()
      secondarySync.truncate()
      const truncateReceipt = secondarySync.commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(secondaryReplayCalls).toBeGreaterThan(0))

      const requestsBeforeMutation = primaryRequests
      const moved = { id: 1, rank: 10 }
      primaryTruth.set(1, moved)
      primarySync.begin()
      primarySync.write({ type: `update`, value: moved })
      const mutationReceipt = primarySync.commit()
      if (mutationReceipt !== true) await mutationReceipt
      await vi.waitFor(() =>
        expect(primaryRequests).toBeGreaterThan(requestsBeforeMutation),
      )
      expect(live.toArray.map(({ id }) => id)).toEqual([1])

      secondaryReplay.resolve()
      await vi.waitFor(() =>
        expect(live.toArray.map(({ id }) => id)).toEqual([2]),
      )
      expect(primaryRequests).toBeGreaterThan(requestsBeforeMutation)
    } finally {
      secondaryReplay.resolve()
      await Promise.all([
        live.cleanup(),
        primary.cleanup(),
        secondary.cleanup(),
      ])
    }
  })

  it(`publishes one complete batch after an indexed loader fills a window`, async () => {
    const remoteRows: ReadonlyArray<Row> = [
      { id: 1, rank: 1, eligible: true, label: `one` },
      { id: 2, rank: 2, eligible: true, label: `two` },
    ]
    const batches: Array<Array<number>> = []
    const callbackReads: Array<Array<number>> = []
    let loads = 0
    const delivered = new Set<number>()
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    const source = createCollection<Row, number>({
      id: `ordered-atomic-indexed-window`,
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
            loadSubset: (options) => {
              loads++
              const row = remoteRows.find(
                (candidate) =>
                  !delivered.has(candidate.id) &&
                  (!options.where ||
                    evaluateReferenceExpression(options.where, candidate) ===
                      true),
              )
              if (!row) return true
              delivered.add(row.id)
              sync.begin()
              sync.write({ type: `insert`, value: row })
              const receipt = sync.commit()
              if (receipt !== true) {
                throw new Error(`Expected synchronous source application`)
              }
              return true
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(0),
    )
    const readIds = () => live.toArray.map(({ id }) => id)
    const subscription = live.subscribeChanges(
      (changes) => {
        batches.push(changes.map(({ key }) => Number(key)).sort())
        callbackReads.push(readIds())
      },
      { includeInitialState: false },
    )

    await withHistoryCleanup(
      async () => {
        await live.preload()
        await live.utils.setWindow({ offset: 0, limit: 2 })
        await flushPromises()

        // Each page turn is followed by a tie-boundary request. The source
        // returns one row at a time while honoring both predicates.
        expect(loads).toBe(4)
        expect(readIds()).toEqual([1, 2])
        expect(batches).toEqual([[1, 2]])
        expect(callbackReads).toEqual([[1, 2]])
      },
      () => [
        () => subscription.unsubscribe(),
        () => live.cleanup(),
        () => source.cleanup(),
      ],
    )
  })

  it(`keeps live collections and Effects equal across the exhaustive small domain`, async () => {
    for (const scenario of exhaustiveScenarios) {
      await assertConsumerParity(scenario)
    }
  })

  it(`keeps the collection anti-join result when the joined row exists`, async () => {
    const observed = await observeConsumer(
      `collection`,
      exhaustiveScenarios[0]!,
      `none`,
    )
    expect(observed.rows.map(({ id }) => id)).toEqual([2])
  })

  it(`removes a matched parent from the anti-join Effect`, async () => {
    const observed = await observeConsumer(
      `effect`,
      exhaustiveScenarios[0]!,
      `none`,
    )
    expect(observed.rows.map(({ id }) => id)).toEqual([2])
  })

  it(`processes a synchronous root refill before joined publication`, async () => {
    type Root = { id: number; rank: number }
    type Child = { id: number; rootId: number }
    const truth: Array<Root> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
    ]
    const installed = new Set<number>()
    const rootRequests: Array<LoadSubsetOptions> = []
    const firstChildGate = createDeferred<void>()
    let childLoads = 0
    const rootCollection = createCollection<Root, number>({
      id: `ordered-synchronous-refill-root`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.markReady()
          return {
            loadSubset: (options) => {
              rootRequests.push(options)
              let selected = truth
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
                .filter(
                  (row) =>
                    !options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true,
                )
                .sort((left, right) => left.rank - right.rank)
              if (!options.cursor && options.offset) {
                selected = selected.slice(options.offset)
              }
              if (options.limit !== undefined) {
                selected = selected.slice(0, options.limit)
              }
              const fresh = selected.filter(({ id }) => !installed.has(id))
              if (fresh.length > 0) {
                operations.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  operations.write({ type: `insert`, value: row })
                }
                const receipt = operations.commit(options.signal)
                if (receipt !== true) {
                  throw new Error(`Expected synchronous root application`)
                }
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const childCollection = createCollection<Child, number>({
      id: `ordered-synchronous-refill-child`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          operations.begin()
          operations.write({
            type: `insert`,
            value: { id: 20, rootId: 2 },
          })
          if (operations.commit() !== true) {
            throw new Error(`Expected synchronous child application`)
          }
          operations.markReady()
          return {
            loadSubset: () => {
              childLoads++
              return childLoads === 1 ? firstChildGate.promise : true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-synchronous-refill-live`,
      startSync: false,
      query: (q) =>
        q
          .from({ root: rootCollection })
          .leftJoin({ child: childCollection }, ({ root, child }) =>
            eq(root.id, child.rootId),
          )
          .where(({ child }) => not(isUndefined(child.rootId)))
          .orderBy(({ root }) => root.rank)
          .limit(1)
          .select(({ root }) => ({ id: root.id })),
    })

    await withHistoryCleanup(
      async () => {
        const preload = live.preload()
        await vi.waitFor(() => {
          expect(childLoads).toBe(1)
          expect(rootRequests).toHaveLength(1)
        })
        expect(live.toArray).toEqual([])

        firstChildGate.resolve()
        await preload
        expect(childLoads).toBe(2)
        expect(live.toArray.map(({ id }) => id)).toEqual([2])
        expect(rootRequests.some(({ cursor }) => cursor !== undefined)).toBe(
          true,
        )
      },
      () => [
        () => firstChildGate.resolve(),
        () => live.cleanup(),
        () => rootCollection.cleanup(),
        () => childCollection.cleanup(),
      ],
    )
  })

  it.each([`resolve`, `reject`, `retire`] as const)(
    `keeps a widened window aligned with existing joined demand (%s)`,
    async (outcome) => {
      type Root = { id: number; rank: number }
      type Child = { id: number; rootId: number }
      const childGate = createDeferred<void>()
      const rootContinuationGate = createDeferred<void>()
      const rootRequests: Array<LoadSubsetOptions> = []
      let childLoads = 0
      let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
      const rootCollection = createCollection<Root, number>({
        id: `ordered-held-window-root`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: (operations) => {
            rootSync = operations
            const { begin, write, commit, markReady } = operations
            markReady()
            let delivered = false
            return {
              loadSubset: async (options) => {
                rootRequests.push(options)
                if (options.cursor) await rootContinuationGate.promise
                if (!delivered && options.orderBy) {
                  delivered = true
                  begin()
                  write({ type: `insert`, value: { id: 1, rank: 1 } })
                  const receipt = commit(options.signal)
                  if (receipt !== true) await receipt
                }
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const childCollection = createCollection<Child, number>({
        id: `ordered-held-window-child`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: () => {
                childLoads++
                return childGate.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live = createLiveQueryCollection({
        id: `ordered-held-window-live`,
        startSync: false,
        query: (q) =>
          q
            .from({ root: rootCollection })
            .leftJoin({ child: childCollection }, ({ root, child }) =>
              eq(root.id, child.rootId),
            )
            .where(({ child }) => isUndefined(child.rootId))
            .orderBy(({ root }) => root.rank)
            .limit(1)
            .select(({ root }) => ({ id: root.id })),
      })

      await withHistoryCleanup(
        async () => {
          const preload = live.preload()
          void preload.catch(() => {})
          await vi.waitFor(() => {
            expect(childLoads).toBe(1)
            expect(rootRequests).toHaveLength(2)
          })

          let moveSettled = false
          const move = Promise.resolve(
            live.utils.setWindow({ offset: 0, limit: 2 }),
          ).then(() => {
            moveSettled = true
          })
          await flushPromises()
          expect(moveSettled).toBe(false)
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
          expect(live.toArray.map(({ id }) => id)).toEqual([])

          if (outcome === `reject`) {
            childGate.reject(new Error(`joined demand failed`))
            await expect(move).rejects.toThrow(`joined demand failed`)
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
            await Promise.allSettled([preload])
            return
          }

          if (outcome === `retire`) {
            rootSync.begin()
            rootSync.write({
              type: `delete`,
              value: { id: 1, rank: 1 },
            })
            const receipt = rootSync.commit()
            if (receipt !== true) await receipt
            rootContinuationGate.resolve()
            await vi.waitFor(() => expect(moveSettled).toBe(true))
            expect(rootRequests.length).toBeGreaterThan(2)
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
            expect(live.toArray).toEqual([])
            childGate.reject(new Error(`obsolete joined demand failed`))
            await flushPromises()
            expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
            return
          }

          childGate.resolve()
          await vi.waitFor(() =>
            expect(
              rootRequests.some(({ cursor }) => cursor !== undefined),
            ).toBe(true),
          )
          await flushPromises()
          expect(moveSettled).toBe(false)
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
          rootContinuationGate.resolve()
          await Promise.all([move, preload])
          expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 2 })
          expect(live.toArray.map(({ id }) => id)).toEqual([1])
          expect(rootRequests.some(({ cursor }) => cursor !== undefined)).toBe(
            true,
          )
        },
        () => [
          () => childGate.resolve(),
          () => rootContinuationGate.resolve(),
          () => live.cleanup(),
          () => rootCollection.cleanup(),
          () => childCollection.cleanup(),
        ],
      )
    },
  )

  it(`resumes bounded ordered repair after joined demand settles`, async () => {
    type Root = { id: number; rank: number }
    type Child = { id: number; rootId: number }
    const truth: Array<Root> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const installed = new Set<number>()
    const rootRequests: Array<LoadSubsetOptions> = []
    const secondChildGate = createDeferred<void>()
    let childLoads = 0
    let rootSync!: Parameters<SyncConfig<Root, number>[`sync`]>[0]
    const rootCollection = createCollection<Root, number>({
      id: `ordered-held-repair-root`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.markReady()
          return {
            loadSubset: async (options) => {
              rootRequests.push(options)
              let selected = truth
                .filter(
                  (row) =>
                    !options.where ||
                    evaluateReferenceExpression(options.where, row) === true,
                )
                .filter(
                  (row) =>
                    !options.cursor ||
                    evaluateReferenceExpression(
                      options.cursor.whereFrom,
                      row,
                    ) === true,
                )
                .sort((left, right) => left.rank - right.rank)
              if (!options.cursor && options.offset) {
                selected = selected.slice(options.offset)
              }
              if (options.limit !== undefined) {
                selected = selected.slice(0, options.limit)
              }
              const fresh = selected.filter(({ id }) => !installed.has(id))
              if (fresh.length > 0) {
                operations.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  operations.write({ type: `insert`, value: row })
                }
                const receipt = operations.commit(options.signal)
                if (receipt !== true) await receipt
              }
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const childCollection = createCollection<Child, number>({
      id: `ordered-held-repair-child`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => {
              childLoads++
              return childLoads === 2 ? secondChildGate.promise : true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `ordered-held-repair-live`,
      startSync: false,
      query: (q) =>
        q
          .from({ root: rootCollection })
          .leftJoin({ child: childCollection }, ({ root, child }) =>
            eq(root.id, child.rootId),
          )
          .where(({ child }) => isUndefined(child.rootId))
          .orderBy(({ root }) => root.rank)
          .limit(1)
          .select(({ root }) => ({ id: root.id })),
    })

    const deleteRoot = async (id: number) => {
      const row = truth.find((candidate) => candidate.id === id)!
      truth.splice(truth.indexOf(row), 1)
      installed.delete(id)
      rootSync.begin()
      rootSync.write({ type: `delete`, value: row })
      const receipt = rootSync.commit()
      if (receipt !== true) await receipt
    }

    await withHistoryCleanup(
      async () => {
        await live.preload()
        expect(live.toArray.map(({ id }) => id)).toEqual([1])

        await deleteRoot(1)
        await vi.waitFor(() => {
          expect(childLoads).toBe(2)
          expect(rootRequests.filter(({ refetch }) => refetch)).toHaveLength(2)
        })
        expect(live.toArray.map(({ id }) => id)).toEqual([1])

        secondChildGate.resolve()
        await vi.waitFor(() =>
          expect(live.toArray.map(({ id }) => id)).toEqual([2]),
        )

        await deleteRoot(2)
        await vi.waitFor(() =>
          expect(live.toArray.map(({ id }) => id)).toEqual([3]),
        )
        expect(
          rootRequests.filter(({ refetch }) => refetch).length,
        ).toBeGreaterThan(2)
      },
      () => [
        () => secondChildGate.resolve(),
        () => live.cleanup(),
        () => rootCollection.cleanup(),
        () => childCollection.cleanup(),
      ],
    )
  })

  it(`bounds ordered root acquisition for a none left-join filter`, async () => {
    for (const scenario of exhaustiveScenarios) {
      const observed = await observeConsumer(`collection`, scenario, `none`)
      expect(observed.requests.length).toBeGreaterThan(0)
      expect(observed.requests[0]?.kind).toBe(`with-order`)
      expect(observed.requests[0]?.limit).toBeGreaterThan(0)
    }
  })

  it.each([`joined-only`, `some`, `to-one`] as const)(
    `bounds ordered root acquisition for a %s left-join filter`,
    async (joinFilter) => {
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
    },
  )

  it.each(
    ([`collection`, `effect`] as const).flatMap((consumer) =>
      ([`unindexed`, `custom`] as const).map((loadingMode) => ({
        consumer,
        loadingMode,
      })),
    ),
  )(
    `settles joined demand and publishes a complete $loadingMode $consumer window`,
    async ({ consumer, loadingMode }) => {
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
    },
  )

  it.each(
    ([`collection`, `effect`] as const).flatMap((consumer) =>
      ([`some`, `none`] as const).map((joinFilter) => ({
        consumer,
        joinFilter,
      })),
    ),
  )(
    `waits for a $joinFilter joined demand before requesting another root page in a $consumer`,
    async ({ consumer, joinFilter }) => {
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
    },
  )

  it.each([`collection`, `effect`] as const)(
    `refills a joined-filter %s window after a child leaves`,
    async (consumer) => {
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
    },
  )

  it.each([`collection`, `effect`] as const)(
    `stops a joined-filter %s after the needed root prefix`,
    async (consumer) => {
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
    },
  )

  it.each(
    [0, 1, 2, 3, 4].flatMap((middleCount) =>
      ([`asc`, `desc`] as const).flatMap((direction) =>
        [false, true].map((tied) => ({ middleCount, direction, tied })),
      ),
    ),
  )(
    `settles an underfilled source without repeating a continuation: %j`,
    async ({ middleCount, direction, tied }) => {
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
          observation.requests.filter(({ kind }) => kind === `with-order`)
            .length,
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
    },
  )

  it(`replaces an ordered snapshot after truncate without repeating void loads`, async () => {
    const initial: ReadonlyArray<Row> = [
      { id: 1, rank: 1, eligible: true, label: `old-one` },
      { id: 2, rank: 2, eligible: true, label: `old-two` },
    ]
    const replacement: ReadonlyArray<Row> = [
      { id: 3, rank: 3, eligible: true, label: `new-three` },
      { id: 4, rank: 4, eligible: true, label: `new-four` },
    ]
    let truth = initial
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let loads = 0
    const installed = new Set<number>()
    const source = createCollection<Row, number>({
      id: `ordered-void-truncate`,
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
              loads++
              if (loads > 12) {
                throw new Error(
                  `ordered void loading did not reach a fixed point`,
                )
              }
              const matching = options.where
                ? truth.filter(
                    (row) =>
                      evaluateReferenceExpression(options.where!, row) === true,
                  )
                : truth
              const rows = matching
                .slice(
                  options.offset ?? 0,
                  options.limit === undefined
                    ? undefined
                    : (options.offset ?? 0) + options.limit,
                )
                .filter(({ id }) => !installed.has(id))
              if (rows.length === 0) return
              sync.begin()
              for (const row of rows) {
                installed.add(row.id)
                sync.write({ type: `insert`, value: row })
              }
              const receipt = sync.commit()
              if (receipt !== true) await receipt
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])

      truth = replacement
      installed.clear()
      sync.begin()
      sync.truncate()
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await flushPromises()

      expect(live.toArray.map(({ id }) => id)).toEqual([3, 4])
      expect(loads).toBeLessThanOrEqual(8)
    } finally {
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it.each([false, true])(
    `cancels queued ordered recovery on cleanup (restart=%s)`,
    async (restart) => {
      const seedRow: Row = { id: 1, rank: 1, eligible: true, label: `retained` }
      let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
      let installed = false
      const requests: Array<LoadSubsetOptions> = []
      const source = createCollection<Row, number>({
        id: `queued-recovery-cleanup-${harnessId++}`,
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
              loadSubset: (options) => {
                requests.push(options)
                if (installed) return true
                installed = true
                operations.begin()
                operations.write({ type: `insert`, value: seedRow })
                return operations.commit()
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      )
      try {
        await live.preload()
        const initialRequests = requests.length
        sync.begin()
        sync.truncate()
        installed = false
        expect(sync.commit()).toBe(true)
        await live.cleanup()
        await flushPromises()
        expect(requests).toHaveLength(initialRequests)
        if (restart) {
          await live.preload()
          expect(live.toArray.map(({ id }) => id)).toEqual([1])
          expect(live.utils.lastSubsetError).toBeUndefined()
          expect(requests.length).toBeGreaterThan(initialRequests)
        }
        expect(
          requests.filter(
            ({ where, limit }) => where === undefined && limit === undefined,
          ),
        ).toEqual([])
      } finally {
        await Promise.all([live.cleanup(), source.cleanup()])
      }
    },
  )

  it.each([
    { name: `until full-source recovery settles`, failure: undefined },
    {
      name: `when full-source recovery throws synchronously`,
      failure: {
        mode: `sync` as const,
        attempts: 1,
        error: new Error(`full-source recovery failed`),
      },
    },
    {
      name: `after two synchronous full-source recovery failures`,
      failure: {
        mode: `sync` as const,
        attempts: 2,
        error: new Error(`full-source recovery failed twice`),
      },
    },
    {
      name: `after asynchronous full-source recovery retries`,
      failure: {
        mode: `async` as const,
        attempts: 1,
        error: new Error(`full-source recovery rejected`),
      },
    },
    {
      name: `after two asynchronous full-source recovery failures`,
      failure: {
        mode: `async` as const,
        attempts: 2,
        error: new Error(`full-source recovery rejected twice`),
      },
    },
  ])(`keeps an ordered snapshot unchanged $name`, async ({ failure }) => {
    const makeRows = (ranks: ReadonlyArray<number>): Array<Row> =>
      ranks.map((rank, index) => ({
        id: index + 1,
        rank,
        eligible: true,
        label: `row-${rank}`,
      }))
    let truth = makeRows([1, 2, 3, 4, 5])
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let recovering = false
    let fullSourceRequests = 0
    const fullSource = createDeferred<void>()
    const installed = new Set<number>()
    const publications: Array<Array<number>> = []
    const escapedErrors: Array<unknown> = []
    const acquisitions: Array<LoadSubsetOptions> = []
    const releases: Array<LoadSubsetOptions> = []
    const enqueueMicrotask = globalThis.queueMicrotask.bind(globalThis)
    const queueMicrotaskSpy =
      failure?.mode === `sync`
        ? vi
            .spyOn(globalThis, `queueMicrotask`)
            .mockImplementation((callback) =>
              enqueueMicrotask(() => {
                try {
                  callback()
                } catch (error) {
                  escapedErrors.push(error)
                }
              }),
            )
        : undefined

    const source = createCollection<Row, number>({
      id: `delayed-full-source-recovery`,
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
            loadSubset: (options) => {
              const isFullSource =
                options.where === undefined && options.limit === undefined
              if (recovering && isFullSource) {
                fullSourceRequests++
                if (failure && fullSourceRequests <= failure.attempts) {
                  if (failure.mode === `sync`) throw failure.error
                  acquisitions.push(options)
                  return Promise.reject(failure.error)
                }
              }
              acquisitions.push(options)

              return (async () => {
                if (recovering && isFullSource && !failure) {
                  await fullSource.promise
                }

                let selected = options.where
                  ? truth.filter(
                      (row) =>
                        evaluateReferenceExpression(options.where!, row) ===
                        true,
                    )
                  : [...truth]
                if (options.cursor) {
                  selected = selected.filter(
                    (row) =>
                      evaluateReferenceExpression(
                        options.cursor!.whereFrom,
                        row,
                      ) === true,
                  )
                }
                selected.sort((left, right) => left.rank - right.rank)
                if (!options.cursor && options.offset) {
                  selected = selected.slice(options.offset)
                }
                if (options.limit !== undefined) {
                  selected = selected.slice(0, options.limit)
                }

                const fresh = selected.filter(({ id }) => !installed.has(id))
                if (fresh.length === 0) return
                sync.begin()
                for (const row of fresh) {
                  installed.add(row.id)
                  sync.write({ type: `insert`, value: row })
                }
                const receipt = sync.commit()
                if (receipt !== true) await receipt
              })()
            },
            unloadSubset: (options) => {
              releases.push(options)
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )
    const subscription = live.subscribeChanges(() => {
      publications.push(live.toArray.map(({ rank }) => rank))
    })

    try {
      await live.preload()
      await live.utils.setWindow({ offset: 0, limit: 4 })
      await flushPromises()
      expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
      const publicationCount = publications.length

      truth = makeRows([0, 0.5, 1, 1.5, 2, 3])
      installed.clear()
      recovering = true
      sync.begin()
      sync.truncate()
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      await vi.waitFor(() => expect(fullSourceRequests).toBe(1))
      for (let index = 0; index < 4; index++) await flushPromises()

      expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
      expect(publications).toHaveLength(publicationCount)

      if (failure) {
        expect(live.utils.lastSubsetError).toBe(failure.error)
        expect(escapedErrors).toEqual([])
        truth[0] = { ...truth[0]!, label: `updated during failed recovery` }
        sync.begin()
        sync.write({ type: `update`, value: truth[0] })
        const updateReceipt = sync.commit()
        if (updateReceipt !== true) await updateReceipt
        await flushPromises()
        expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
        expect(live.get(1)?.label).toBe(`row-1`)
        expect(publications).toHaveLength(publicationCount)
        expect(fullSourceRequests).toBe(1)
        const retryCount = failure.attempts
        for (let retry = 0; retry < retryCount; retry++) {
          installed.clear()
          sync.begin()
          sync.truncate()
          const retryReceipt = sync.commit()
          if (retryReceipt !== true) await retryReceipt
          await vi.waitFor(() => expect(fullSourceRequests).toBe(retry + 2))
          if (retry + 1 < retryCount) {
            for (let index = 0; index < 4; index++) await flushPromises()
            expect(live.toArray.map(({ rank }) => rank)).toEqual([1, 2, 3, 4])
            expect(publications).toHaveLength(publicationCount)
            expect(live.utils.lastSubsetError).toBe(failure.error)
            expect(escapedErrors).toEqual([])
          }
        }
        await vi.waitFor(() =>
          expect(source.toArray.map(({ rank }) => rank).sort()).toEqual([
            0, 0.5, 1, 1.5, 2, 3,
          ]),
        )
        await vi.waitFor(() =>
          expect(live.toArray.map(({ rank }) => rank)).toEqual([
            0, 0.5, 1, 1.5,
          ]),
        )
        expect(fullSourceRequests).toBe(retryCount + 1)
        expect(live.get(1)?.label).toBe(`updated during failed recovery`)
      } else {
        fullSource.resolve()
        await flushPromises()
        expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5, 1, 1.5])
      }
      expect(publications.slice(publicationCount)).toEqual([[0, 0.5, 1, 1.5]])
      expect(escapedErrors).toEqual([])
      await live.utils.setWindow({ offset: 0, limit: 2 })
      expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5])
      const loadsBeforeReplay = fullSourceRequests
      installed.clear()
      sync.begin()
      sync.truncate()
      const nextReplay = sync.commit()
      if (nextReplay !== true) await nextReplay
      await flushPromises()
      expect(fullSourceRequests).toBeGreaterThan(loadsBeforeReplay)
      expect(live.toArray.map(({ rank }) => rank)).toEqual([0, 0.5])
    } finally {
      queueMicrotaskSpy?.mockRestore()
      fullSource.resolve()
      subscription.unsubscribe()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
    expect(releases).toHaveLength(acquisitions.length)
    for (const acquisition of acquisitions) {
      expect(
        releases.filter((release) => release === acquisition),
      ).toHaveLength(1)
    }
  })

  it.each([`collection`, `effect`] as const)(
    `continues an ordered anti-join %s while an unrelated include demand is pending`,
    async (kind) => {
      const rows = [
        { id: 1, rank: 1 },
        { id: 2, rank: 2 },
        { id: 3, rank: 3 },
      ]
      const delivered = new Set<number>()
      const rootRequests: Array<{ cursor: boolean; limit?: number }> = []
      const extraGate = createDeferred<void>()
      let extraLoads = 0

      const root = createCollection({
        id: `ordered-unrelated-root-${harnessId++}`,
        getKey: (row: (typeof rows)[number]) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: async (options) => {
                rootRequests.push({
                  cursor: !!options.cursor,
                  limit: options.limit,
                })
                if (rootRequests.length > 15) throw new Error(`request loop`)
                const matching = options.where
                  ? rows.filter(
                      (row) =>
                        evaluateReferenceExpression(options.where!, row) ===
                        true,
                    )
                  : rows
                const candidates = options.cursor
                  ? matching.filter(
                      (row) =>
                        evaluateReferenceExpression(
                          options.cursor!.whereFrom,
                          row,
                        ) === true,
                    )
                  : matching.slice(options.offset ?? 0)
                const fresh = candidates
                  .slice(0, options.limit)
                  .filter((row) => !delivered.has(row.id))
                if (fresh.length === 0) return
                begin()
                for (const row of fresh) {
                  delivered.add(row.id)
                  write({ type: `insert`, value: row })
                }
                const receipt = commit()
                if (receipt !== true) await receipt
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const markerSource = createCollection({
        id: `ordered-unrelated-marker-${harnessId++}`,
        getKey: (row: { id: number; rowId: number }) => row.id,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: `insert`, value: { id: 2, rowId: 2 } })
            commit()
            markReady()
          },
        },
      })
      const extraSource = createCollection({
        id: `ordered-unrelated-extra-${harnessId++}`,
        getKey: (row: { id: number; rowId: number }) => row.id,
        syncMode: `on-demand`,
        startSync: true,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ markReady }) => {
            markReady()
            return {
              loadSubset: async () => {
                extraLoads++
                await extraGate.promise
              },
              unloadSubset: () => {},
            }
          },
        },
      })
      const query = (q: InitialQueryBuilder) =>
        q
          .from({ row: root })
          .leftJoin({ marker: markerSource }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(2)
          .select(({ row }) => ({
            id: row.id,
            extras: toArray(
              q
                .from({ extra: extraSource })
                .where(({ extra }) => eq(extra.rowId, row.id)),
            ),
          }))
      const live =
        kind === `collection` ? createLiveQueryCollection(query) : undefined
      const effectRows = new Set<number>()
      const effect =
        kind === `effect`
          ? createEffect<{ id: number; extras: Array<unknown> }>({
              query,
              onBatch: (events) => {
                for (const event of events) {
                  if (event.type === `exit`) effectRows.delete(event.value.id)
                  else effectRows.add(event.value.id)
                }
              },
            })
          : undefined
      const preload = live?.preload()

      try {
        await vi.waitFor(() => expect(extraLoads).toBeGreaterThan(0))
        for (let i = 0; i < 12; i++) await flushPromises()
        expect(
          rootRequests.some((request) => request.cursor),
          JSON.stringify({
            rootRequests,
            extraLoads,
            rows: live?.toArray ?? [...effectRows],
          }),
        ).toBe(true)
        extraGate.resolve()
        await preload
        await vi.waitFor(() =>
          expect(rootRequests.some((request) => request.cursor)).toBe(true),
        )
        expect(live?.toArray.map(({ id }) => id) ?? [...effectRows]).toEqual([
          1, 3,
        ])
      } finally {
        extraGate.resolve()
        await Promise.all([
          effect?.dispose(),
          live?.cleanup(),
          root.cleanup(),
          markerSource.cleanup(),
          extraSource.cleanup(),
        ])
      }
    },
  )

  it(`releases held Effect changes after an empty joined replay`, async () => {
    type ReplayRow = { id: number; rank: number; label: string }
    const initialRow = { id: 1, rank: 1, label: `old` }
    let rootSync!: Parameters<SyncConfig<ReplayRow, number>[`sync`]>[0]
    const root = createCollection<ReplayRow, number>({
      id: `ordered-replay-wakeup-root-${harnessId++}`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rootSync = operations
          operations.begin()
          operations.write({ type: `insert`, value: initialRow })
          operations.commit()
          operations.markReady()
        },
      },
    })
    const replayGate = createDeferred<void>()
    let joinedLoads = 0
    let joinedSync!: Parameters<
      SyncConfig<{ id: number; rowId: number }, number>[`sync`]
    >[0]
    const joined = createCollection<{ id: number; rowId: number }, number>({
      id: `ordered-replay-wakeup-joined-${harnessId++}`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          joinedSync = operations
          operations.markReady()
          return {
            loadSubset: () => {
              joinedLoads++
              return joinedLoads === 1 ? true : replayGate.promise
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Map<number, string>()
    const effect = createEffect<{ id: number; label: string }>({
      query: (q) =>
        q
          .from({ row: root })
          .leftJoin({ marker: joined }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => isUndefined(marker.rowId))
          .orderBy(({ row }) => row.rank)
          .limit(1)
          .select(({ row }) => ({ id: row.id, label: row.label })),
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.value.id)
          else visible.set(event.value.id, event.value.label)
        }
      },
    })
    try {
      await vi.waitFor(() => expect(visible.get(1)).toBe(`old`))
      joinedSync.begin()
      joinedSync.truncate()
      const truncateReceipt = joinedSync.commit()
      if (truncateReceipt !== true) await truncateReceipt
      await vi.waitFor(() => expect(joinedLoads).toBeGreaterThan(1))

      rootSync.begin()
      rootSync.write({ type: `update`, value: { ...initialRow, label: `new` } })
      const updateReceipt = rootSync.commit()
      if (updateReceipt !== true) await updateReceipt
      for (let i = 0; i < 5; i++) await flushPromises()
      expect(visible.get(1)).toBe(`old`)

      replayGate.resolve()
      await vi.waitFor(() => expect(visible.get(1)).toBe(`new`))
    } finally {
      replayGate.resolve()
      await Promise.all([effect.dispose(), root.cleanup(), joined.cleanup()])
    }
  })

  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 20 * multiplier

  fcTest.prop([scenarioArbitrary], { numRuns: runs, seed: 17801 })(
    `keeps rows, request traces, batches, errors, and liveness equal for a fixed seed`,
    assertConsumerParity,
  )

  fcTest.prop(
    [scenarioArbitrary],
    oracleRandomParameters(runs, replay, `ordered-work.consumer-parity`),
  )(
    `keeps rows, request traces, batches, errors, and liveness equal for a random or replayed seed`,
    assertConsumerParity,
  )
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
 * touches over ids 0..29 and ranks 0..15, NaN, or null, so ties, deletes
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
 * to those cases. A peer over a refetching provider is excluded from the
 * grammar until #2155 is fixed: an indexed trace is fixed and pinned, but an
 * unindexed peer still keeps a short joined window after a refetch.
 * Joined filters can match a row through several markers, by `dup`, so a
 * LEFT-joined filter and a full join keep one result row per matched
 * (row, marker) pair, and an anti-join keeps a row once.
 */
type EagerCommand =
  | { type: `upsert`; id: number; rank: number; eligible: boolean }
  | { type: `delete`; id: number }
  // Changes only the label, so a row outside the window enters the query's
  // input without changing which rows are eligible or their order.
  | { type: `touch`; id: number }
  // Changes only eligibility. The order value stays, so a joined plan sees
  // the row leave or return only through the join.
  | { type: `flip`; id: number }
  // Adds another marker to a row that already has one, so a join matches
  // the row more than once.
  | { type: `dup`; id: number }
  | { type: `delete-visible` }
  // A refetching provider re-runs every request it served and sends the
  // results; any other path skips it.
  | { type: `refetch` }
  // A holding provider answers its oldest held request; `drain` answers
  // every held request, including the ones answers start, until none is
  // left. Any other provider skips both. (Not the glossary's acquisition
  // release, which aborts and unloads.)
  | { type: `answer` }
  // Cleans up the peer while its loads may be held. Its acquisition
  // release aborts each held request and gives the adapter an unload.
  | { type: `release-peer` }
  | { type: `drain` }
  // Moves the first query's window with `setWindow`. The Effect and the peer
  // keep their windows.
  | { type: `move`; offset: number; limit: number }

type EagerCase = {
  // How rows reach the source: sync writes to an eager source, local-only
  // direct writes, or an on-demand source whose provider serves each
  // request from the rows and installs only what it returns.
  path: `sync` | `local-only` | `on-demand`
  // How an on-demand provider delivers later changes. `forward` sends each
  // change to a row it sent, or to a row that matches a subset it served.
  // `refetch` sends nothing until a refetch, which keeps every served
  // ordered range whole: rows that now sort inside one arrive then, and rows
  // in no range leave. `refetch-signal` also waits for a refetch, but re-runs
  // each served request alone, as query-db-collection does, and then reports
  // `invalidateLoadedSubsets()` when any answer changed. Omitted means
  // `forward`.
  provider?: `forward` | `refetch` | `refetch-signal`
  // When an on-demand provider answers a load. `immediate` answers within
  // the request. `held` answers only at an `answer` or `drain` step, from the
  // rows at that moment, so live changes can arrive while a load is in flight.
  // Initial loads answer immediately. Omitted means `immediate`.
  latency?: `immediate` | `held`
  // What a holding provider does with an aborted or unloaded held request:
  // `cooperative` installs none of its rows and fulfills at once; `late`
  // cannot cancel it, so it answers it anyway. Omitted means `cooperative`.
  cancellation?: `cooperative` | `late`
  // A second live query over the same sources, with its own window: the
  // first `offset + limit + 1` rows. Its window law holds beside the first
  // query's, and the work laws, which count one consumer, do not apply.
  peer?: boolean
  // Where eligibility is decided: a predicate on the ordered source itself,
  // a JavaScript function filter, or a filter on a LEFT-joined marker, where
  // a marker admits its row (`joined`) or excludes it (`anti-joined`). The
  // last three drop rows only after the source's limit. `full-joined` keeps
  // every root row and adds a rootless row for each marker no root row
  // matches; deleting a matched root row leaves its marker behind.
  filter: `source` | `function` | `joined` | `anti-joined` | `full-joined`
  // How a joined plan changes a row's eligibility: by inserting or deleting
  // its marker, or by pointing the row's join key at a marker or at none.
  // A join-key change leaves the row's order value as it was.
  via?: `marker` | `link`
  indexed: boolean
  direction: `asc` | `desc`
  // Where null ranks sort, and a full join's rootless rows with them. The
  // index uses the same placement. Omitted means first, the default.
  nulls?: `first` | `last`
  // Filler rows sort after every domain row. Omitted means 200; a full-join
  // case may have none, so its window can reach the null group.
  fillers?: number
  // Full join only: markers whose id names no root row.
  orphans?: Array<number>
  terms: 1 | 2
  limit: number
  offset: number
  initial: Array<{ id: number; rank: number; eligible: boolean }>
  history: Array<EagerCommand>
}

const EAGER_FILLER = 200

function fillerRows(
  direction: `asc` | `desc`,
  count: number = EAGER_FILLER,
): Array<Row> {
  // Eligible rows that sort after every domain row, so a correct window never
  // needs them and a full rescan must deliver them.
  return Array.from({ length: count }, (_, index) => ({
    id: 1000 + index,
    rank: direction === `asc` ? 100 + index : -100 - index,
    eligible: true,
    label: `filler`,
  }))
}

function eagerRowOf(maxId: number) {
  return fc.record({
    id: fc.integer({ min: 0, max: maxId }),
    // NaN and null exercise comparator placement outside the integer order.
    rank: fc.oneof(
      { weight: 6, arbitrary: fc.integer({ min: 0, max: 15 }) },
      { weight: 1, arbitrary: fc.constant(Number.NaN) },
      { weight: 1, arbitrary: fc.constant(null as unknown as number) },
    ),
    eligible: fc.boolean(),
  })
}

const eagerRow = eagerRowOf(29)

function eagerHistory(
  flipWeight: number,
  maxId: number,
): fc.Arbitrary<Array<EagerCommand>> {
  return fc.array(
    fc.oneof(
      eagerRowOf(maxId).map((row) => ({ type: `upsert` as const, ...row })),
      fc.record({
        type: fc.constant(`delete` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      fc.record({
        type: fc.constant(`touch` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      {
        weight: flipWeight,
        arbitrary: fc.record({
          type: fc.constant(`flip` as const),
          id: fc.integer({ min: 0, max: maxId }),
        }),
      },
      fc.record({
        type: fc.constant(`dup` as const),
        id: fc.integer({ min: 0, max: maxId }),
      }),
      // Deletes the first visible row, so a repair runs on most histories.
      fc.constant({ type: `delete-visible` as const }),
      fc.constant({ type: `refetch` as const }),
      fc.constant({ type: `answer` as const }),
      fc.record({
        type: fc.constant(`move` as const),
        offset: fc.integer({ min: 0, max: 2 }),
        limit: fc.integer({ min: 1, max: 4 }),
      }),
    ),
    { minLength: 1, maxLength: 12 },
  )
}

// Every dimension, before the campaign exclusion below. Derived campaigns
// start from this and apply the exclusion after their own maps.
const eagerCaseBase: fc.Arbitrary<EagerCase> = fc.record({
  path: fc.constantFrom(
    `sync` as const,
    `local-only` as const,
    `on-demand` as const,
  ),
  provider: fc.constantFrom(
    `forward` as const,
    `refetch` as const,
    `refetch-signal` as const,
  ),
  latency: fc.constantFrom(`immediate` as const, `held` as const),
  cancellation: fc.constantFrom(`cooperative` as const, `late` as const),
  // One case in four has a peer, so most cases keep the work laws.
  peer: fc.oneof(
    { weight: 3, arbitrary: fc.constant(false) },
    { weight: 1, arbitrary: fc.constant(true) },
  ),
  filter: fc.constantFrom(
    `source` as const,
    `function` as const,
    `joined` as const,
    `anti-joined` as const,
    `full-joined` as const,
  ),
  via: fc.constantFrom(`marker` as const, `link` as const),
  indexed: fc.boolean(),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
  nulls: fc.constantFrom(`first` as const, `last` as const),
  terms: fc.constantFrom(1 as const, 2 as const),
  limit: fc.integer({ min: 1, max: 3 }),
  offset: fc.integer({ min: 0, max: 1 }),
  initial: fc.uniqueArray(eagerRow, {
    selector: (row) => row.id,
    maxLength: 20,
  }),
  history: eagerHistory(1, 29),
})

// A peer over a refetching on-demand provider can keep a short joined window
// after a refetch (#2155). An indexed plan's trace is fixed and pinned below,
// but an unindexed one still fails (a peer shows [100] where the model shows
// [100, 101]). Each campaign excludes only that pairing, as its last map,
// until the fix.
function withoutPeerRefetch(testCase: EagerCase): EagerCase {
  return testCase.path === `on-demand` &&
    (testCase.provider === `refetch` ||
      testCase.provider === `refetch-signal`) &&
    testCase.peer
    ? { ...testCase, peer: false }
    : testCase
}

const eagerCase = eagerCaseBase.map(withoutPeerRefetch)

// The premise of the joined-filter law: an indexed single-term plan whose
// filter drops rows after the bounded read.
// A repair before the gap forms reads the whole source for a joined plan, so
// no row can be missing afterwards. These histories therefore insert fresh
// keys (10 to 19), which can land past the bounded prefix, and change initial
// rows (0 to 9) mostly by eligibility alone, so a window row leaves only
// through the join.
const eagerJoinedHistory: fc.Arbitrary<Array<EagerCommand>> = fc.array(
  fc.oneof(
    {
      weight: 2,
      // Ids 10 to 29: fresh rows, and the root rows of a full join's orphan
      // markers (20 to 29), so an orphan can become matched.
      arbitrary: eagerRowOf(19).map((row) => ({
        type: `upsert` as const,
        ...row,
        id: row.id + 10,
      })),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        type: fc.constant(`flip` as const),
        id: fc.integer({ min: 0, max: 9 }),
      }),
    },
    fc.record({
      type: fc.constant(`dup` as const),
      id: fc.integer({ min: 0, max: 9 }),
    }),
    fc.record({
      type: fc.constant(`touch` as const),
      id: fc.integer({ min: 0, max: 19 }),
    }),
    fc.record({
      type: fc.constant(`delete` as const),
      id: fc.integer({ min: 0, max: 19 }),
    }),
    fc.constant({ type: `delete-visible` as const }),
    fc.constant({ type: `refetch` as const }),
    fc.constant({ type: `answer` as const }),
    fc.record({
      type: fc.constant(`move` as const),
      offset: fc.integer({ min: 0, max: 2 }),
      limit: fc.integer({ min: 1, max: 4 }),
    }),
  ),
  { minLength: 1, maxLength: 8 },
)

// Its histories favor eligibility-only changes: a row inserted past the
// bounded prefix, then a window row leaving only through the join.
const eagerJoinedCase: fc.Arbitrary<EagerCase> = fc
  .tuple(
    eagerCaseBase,
    fc.constantFrom(
      `joined` as const,
      `anti-joined` as const,
      `full-joined` as const,
    ),
    fc.uniqueArray(eagerRowOf(9), {
      selector: (row) => row.id,
      minLength: 4,
      maxLength: 8,
    }),
    eagerJoinedHistory,
  )
  .map(([testCase, filter, initial, history]) => ({
    ...testCase,
    filter,
    indexed: true,
    terms: 1 as const,
    initial,
    history,
  }))
  .map(withoutPeerRefetch)

// The law's premise directly: eligible rows at distinct ranks, so the bounded
// prefix leaves rows unsent; a fresh row that may land past the prefix; then
// an initial row changes eligibility alone, so it can leave the window only
// through the join. Random commands may follow.
const gapRank: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 15 }) },
  { weight: 1, arbitrary: fc.constant(Number.NaN) },
  { weight: 1, arbitrary: fc.constant(null as unknown as number) },
)

const eagerJoinedGapCase: fc.Arbitrary<EagerCase> = fc
  .record({
    base: eagerJoinedCase,
    // A null or NaN rank can end the bounded prefix. Neither is an
    // expressible cursor, so the loader takes its prefix fallback there.
    ranks: fc.uniqueArray(gapRank, {
      minLength: 4,
      maxLength: 8,
      selector: String,
    }),
    insertRank: gapRank,
    flipped: fc.nat(7),
    rest: eagerJoinedHistory,
  })
  .map(({ base, ranks, insertRank, flipped, rest }) => ({
    ...base,
    initial: ranks.map((rank, id) => ({ id, rank, eligible: true })),
    history: [
      { type: `upsert` as const, id: 10, rank: insertRank, eligible: true },
      { type: `flip` as const, id: flipped % ranks.length },
      ...rest,
    ],
  }))
  .map(withoutPeerRefetch)

// The full-join law's premise: a window that can reach the null group, where
// rootless rows and root rows with a null rank tie on the first order term.
// Cases favor no filler rows, so a few domain rows fill the window. Initial
// orphan markers (ids 20 to 29) start as rootless rows; root deletes and
// eligibility changes create and remove more.
const eagerFullJoinCase: fc.Arbitrary<EagerCase> = fc
  .record({
    base: eagerCaseBase,
    fillers: fc.oneof(
      { weight: 3, arbitrary: fc.constant(0) },
      { weight: 1, arbitrary: fc.constant(EAGER_FILLER) },
    ),
    initial: fc.uniqueArray(
      fc.record({ id: fc.nat(9), rank: gapRank, eligible: fc.boolean() }),
      { minLength: 2, maxLength: 8, selector: (row) => row.id },
    ),
    orphans: fc.uniqueArray(fc.integer({ min: 20, max: 29 }), {
      minLength: 1,
      maxLength: 3,
    }),
    history: eagerJoinedHistory,
  })
  .map(({ base, fillers, initial, orphans, history }) => ({
    ...base,
    filter: `full-joined` as const,
    via: `marker` as const,
    indexed: true,
    fillers,
    // Every case has a matched root row with a null rank and at least one
    // orphan marker, so the null group holds both kinds of row.
    initial: [
      ...initial.filter(({ id }) => id !== 9),
      { id: 9, rank: null as unknown as number, eligible: true },
    ],
    orphans,
    history,
  }))
  .map(withoutPeerRefetch)

// The in-flight premise: a holding on-demand provider, and a history that
// first deletes a visible row, so the refill request is in flight while the
// later commands change rows. Releases answer it from the rows at that
// moment, between those changes.
const eagerHeldCase: fc.Arbitrary<EagerCase> = fc
  .tuple(
    eagerCaseBase,
    // A change that lands while the refill is in flight: an eligible row
    // with an id no other command uses (40 to 49), so the forwarding
    // provider always sends it.
    eagerRowOf(9).map((row) => ({
      type: `upsert` as const,
      ...row,
      id: row.id + 40,
      eligible: true,
    })),
    fc.array(
      fc.oneof(
        { weight: 3, arbitrary: eagerHistory(1, 29).map(([first]) => first!) },
        { weight: 2, arbitrary: fc.constant({ type: `answer` as const }) },
        {
          weight: 1,
          arbitrary: fc.constant({ type: `release-peer` as const }),
        },
        {
          weight: 1,
          arbitrary: fc.constant({ type: `delete-visible` as const }),
        },
      ),
      { minLength: 2, maxLength: 10 },
    ),
  )
  .map(([testCase, change, rest]) => ({
    ...testCase,
    path: `on-demand` as const,
    // A forwarding provider sends the delete, and an indexed source filter
    // or a joined filter refills from the provider, so the refill is a held
    // request. An unindexed source filter issues no held request. With the
    // provider pinned, this campaign needs no peer exclusion (#2155 concerns
    // only a refetching provider).
    provider: `forward` as const,
    filter:
      testCase.filter === `function` || testCase.filter === `full-joined`
        ? (`source` as const)
        : testCase.filter,
    indexed:
      testCase.filter === `function` ||
      testCase.filter === `full-joined` ||
      testCase.filter === `source`
        ? true
        : testCase.indexed,
    // One order term, so the refill pages by cursor.
    terms: 1 as const,
    latency: `held` as const,
    // A loaded prefix can hold headroom rows, so three visible deletes make
    // a refill request likely before the change.
    history: [
      { type: `delete-visible` as const },
      { type: `delete-visible` as const },
      { type: `delete-visible` as const },
      change,
      ...rest,
    ],
  }))

function isJoinedFilter({ filter }: EagerCase): boolean {
  return filter === `joined` || filter === `anti-joined`
}

function eagerOrder(
  rows: ReadonlyMap<number, Row>,
  { direction, nulls }: EagerCase,
): Array<Row> {
  // Documented order (live-queries guide): nulls first in either direction
  // unless the query asks for them last; NaN is greater than every other
  // non-null value; ties by ascending id.
  const position = (rank: number | null): [number, number] => {
    if (rank === null) return [nulls === `last` ? 3 : 0, 0]
    if (Number.isNaN(rank)) return [direction === `asc` ? 2 : 1, 0]
    return [direction === `asc` ? 1 : 2, direction === `asc` ? rank : -rank]
  }
  return [...rows.values()]
    .filter((row) => row.eligible)
    .sort((left, right) => {
      const [leftGroup, leftValue] = position(left.rank)
      const [rightGroup, rightValue] = position(right.rank)
      return (
        leftGroup - rightGroup || leftValue - rightValue || left.id - right.id
      )
    })
}

function eagerWindow(
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
): Array<number> {
  return eagerOrder(rows, testCase)
    .slice(testCase.offset, testCase.offset + testCase.limit)
    .map((row) => row.id)
}

/**
 * The visible window agrees with the model. The guide promises order only by
 * the query's `orderBy` terms; rows that tie on every term may appear in any
 * order. A source-filter plan's ties follow the source key, which the model
 * also uses, so its window must match exactly. A joined plan's ties follow the
 * joined result key, so its window must be any valid first `limit` rows: the
 * same order values in sequence, each from an eligible row with that value.
 */
function expectEagerWindow(
  actual: Array<number>,
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
  label: string,
): void {
  const expected = eagerWindow(rows, testCase)
  if (!isJoinedFilter(testCase) && testCase.filter !== `full-joined`) {
    expect(actual, label).toEqual(expected)
    return
  }
  const rank = (id: number) => {
    const row = rows.get(id)
    return row?.eligible ? row.rank : `ineligible ${id}`
  }
  expect(actual.map(rank), label).toEqual(expected.map(rank))
  expect(new Set(actual).size, `${label}: distinct rows`).toBe(actual.length)
}

/** Ranks of the last window row and the first row after the window. */
function boundaryRanks(
  rows: ReadonlyMap<number, Row>,
  testCase: EagerCase,
): Array<number | null> {
  const end = testCase.offset + testCase.limit
  // Generated rows may carry a null rank behind the `number` row type.
  return eagerOrder(rows, testCase)
    .slice(end - 1, end + 1)
    .map((row): number | null => row.rank)
}

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
  // Bounded pages that ended on a null or NaN rank. Neither can be
  // expressed as a cursor (canExpressCursorOrder), so the loader then takes
  // the documented full-source fallback.
  let unexpressiblePageEnds = 0
  function servePage(options: LoadSubsetOptions): true | Promise<void> {
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
      if (end === null || Number.isNaN(end)) unexpressiblePageEnds++
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
  async function refetch(): Promise<void> {
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
    ).isPersisted.promise
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
    expect(ledgerRows(source.values()), `${label}: Collection rows`).toEqual(
      ledgerRows(sent.values()),
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
    if (boundary.some((rank) => rank === null || Number.isNaN(rank))) return
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
    expect(runaway, `loading reached a fixed point at the initial load`).toBe(
      false,
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
            (row.rank as number | null) !== null && !Number.isNaN(row.rank),
        )
      if (proven) {
        expect(
          fullSourceRequests,
          `full-source requests by the initial load of a proven prefix`,
        ).toBe(0)
        // A bounded but oversized read also fails: each consumer (the query
        // and its Effect load separately) receives at most the prefix, its
        // boundary ties, and a refill, and never more distinct rows than the
        // source holds.
        const consumerBound = prefixBound(
          prefix.map((row): number | null => row.rank).slice(-2),
          window,
        )
        for (const [consumer, consumerServed] of servedBy) {
          expect(
            consumerServed,
            `rows one consumer is served by the initial load of a proven prefix`,
          ).toBeLessThanOrEqual(consumerBound)
          expect(
            servedIdsBy.get(consumer)!.size,
            `distinct rows one consumer is served by the initial load`,
          ).toBeLessThanOrEqual(Math.min(consumerBound, rows.size))
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
      expect(served, `rows served by the initial load`).toBeLessThanOrEqual(
        initialBound,
      )
    } else if (initialBound !== undefined) {
      expect(read, `rows read by the initial load`).toBeLessThanOrEqual(
        initialBound,
      )
      expect(
        delivered,
        `rows delivered by the initial load`,
      ).toBeLessThanOrEqual(initialBound)
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
      expect(
        shownIds.filter((rowId) => !position.has(rowId)),
        `${label}: rows the ledger does not admit`,
      ).toEqual([])
      expect(new Set(shownIds).size, `${label}: distinct rows`).toBe(
        shownIds.length,
      )
      for (const [index, rowId] of shownIds.slice(1).entries()) {
        const predecessor = shownIds[index]!
        const sameRank = Object.is(
          ledger.get(predecessor)?.rank,
          ledger.get(rowId)?.rank,
        )
        expect(
          sameRank || position.get(predecessor)! < position.get(rowId)!,
          `${label}: rows in query order`,
        ).toBe(true)
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
      if (command.type === `refetch`) {
        const fullSourceBefore = fullSourceRequests
        const unexpressibleBefore = unexpressiblePageEnds
        await refetch()
        // The repair a report starts reads each window's bounded prefix,
        // tie, and refill; a whole-source read would be the cost the report
        // exists to avoid. A page that ends on a null or NaN rank takes the
        // documented full-source fallback instead.
        if (signalsRefetch && unexpressiblePageEnds === unexpressibleBefore) {
          expect(
            fullSourceRequests,
            `full-source requests after a signalling refetch at step ${step}`,
          ).toBe(fullSourceBefore)
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
        expect(
          heldMoves.filter((move) => !move.settled || move.error),
          `window moves unsettled or rejected after drain`,
        ).toEqual([])
      } else if (command.type === `delete`) {
        if (!before) continue
        rows.delete(command.id)
        if (testCase.path !== `local-only`) {
          sourceWrite(`delete`, before)
        } else {
          await source.delete(command.id).isPersisted.promise
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
          await source.update(command.id, (draft) => {
            draft.eligible = next.eligible
            draft.link = next.link
          }).isPersisted.promise
        }
        await setMarker(command.id, eligible)
      } else if (command.type === `dup`) {
        if (!(joined || fullJoin) || viaLink || !before) continue
        if (markersOf(before.link ?? before.id).length === 0) continue
        if (ledgerHasRoot(before.link ?? before.id)) noteChange()
        await markers.insert(marker(before.link ?? before.id)).isPersisted
          .promise
      } else if (command.type === `touch`) {
        if (!before) continue
        const next = { ...before, label: `touched-${step}` }
        rows.set(command.id, next)
        if (testCase.path !== `local-only`) {
          sourceWrite(`update`, next)
        } else {
          await source.update(command.id, (draft) => {
            draft.label = next.label
          }).isPersisted.promise
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
          await source.update(command.id, (draft) => {
            draft.rank = next.rank
            draft.eligible = next.eligible
            draft.link = next.link
          }).isPersisted.promise
        } else {
          await source.insert(next).isPersisted.promise
        }
        await setMarker(command.id, next.eligible)
      }
      await flushPromises()
      // While a refetching provider lags the rows, the Collection holds an
      // older state, so the window is checked over the provider's ledger
      // until the next refetch.
      expect(runaway, `loading reached a fixed point by step ${step}`).toBe(
        false,
      )
      if (changedInFlight()) caseHeldChanges++
      expectProviderLedger(`after step ${step}`)
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
        expect(
          published.length,
          `publications by step ${step}`,
        ).toBeGreaterThan(0)
      }
      const requests = providerRequests - requestsBefore
      const onDemand = requests > 0
      expect(
        published.length,
        `publications by step ${step}`,
      ).toBeLessThanOrEqual(commits + requests)
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
        expect(scanned, `rows scanned by step ${step}`).toBeLessThanOrEqual(
          Math.max(sizeBefore, rows.size),
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
        expect(
          requests,
          `provider requests by step ${step}`,
        ).toBeLessThanOrEqual(4)
      }
      if (bound !== undefined && testCase.path === `on-demand`) {
        expect(served, `rows served by step ${step}`).toBeLessThanOrEqual(bound)
      } else if (bound !== undefined) {
        expect(read, `rows read by step ${step}`).toBeLessThanOrEqual(bound)
        expect(delivered, `rows delivered by step ${step}`).toBeLessThanOrEqual(
          bound,
        )
        // A bounded read walks the index; it never scans the source.
        expect(
          scanned,
          `rows scanned by bounded step ${step}`,
        ).toBeLessThanOrEqual(bound)
      }
    }
    expect(runaway, `loading reached a fixed point by the end`).toBe(false)
    return {
      heldChanges: caseHeldChanges,
      heldRequests: caseHeldRequests,
      cooperativeCancels,
      lateAnswers,
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

type OptimisticWindowShape = `source` | `joined` | `anti-joined`
type OptimisticWindowMutation = `update` | `delete`
type OptimisticWindowConsumer = `collection` | `effect`
type OptimisticWindowOutcome = `acknowledge` | `rollback`
type OptimisticWindowExtent = `missing` | `installed` | `non-prefix`
type OptimisticWindowAcquisition = `required` | `forbidden` | `allowed`
type OptimisticWindowCheckpoint =
  `initial` | `optimistic` | `settled` | `restored`
const MAX_OPTIMISTIC_WINDOW_REQUESTS = 8
const OPTIMISTIC_ACQUISITION_OBSERVATION_TURNS = 8

type OptimisticWindowCase = {
  shape: OptimisticWindowShape
  mutation: OptimisticWindowMutation
  consumer: OptimisticWindowConsumer
  outcome: OptimisticWindowOutcome
  width: 1 | 2
  indexed: boolean
  extent: OptimisticWindowExtent
  installedIds: Array<number>
  acquisition: OptimisticWindowAcquisition
  answerTiming?: `before-settlement` | `after-settlement`
  mutationSource?: `root` | `marker`
  rankMove?: boolean
  rankDeparture?: boolean
  direction?: `asc` | `desc`
}

type OptimisticWindowPublication = {
  rows: Array<number>
}

function copyOptimisticWindowPublication(
  publication: OptimisticWindowPublication,
): OptimisticWindowPublication {
  return { rows: [...publication.rows] }
}

type OptimisticWindowObservation = {
  initial: Array<number>
  immediate: Array<number>
  acquiring: Array<number>
  answerQueued: Array<number>
  settled: Array<number>
  afterAnswer?: Array<number>
  afterRestore?: Array<number>
  afterRestorePublications?: Array<OptimisticWindowPublication>
  rowsAfterFirstTurn: Array<number>
  rowsAfterSecondTurn: Array<number>
  immediatePublications: Array<OptimisticWindowPublication>
  preSettlementPublications: Array<OptimisticWindowPublication>
  publicationsAtSettlement: Array<OptimisticWindowPublication>
  publicationsAfterSettlement: Array<OptimisticWindowPublication>
  attempts: Array<{
    submittedRows: Array<number>
    limit: number | undefined
    direction: string | undefined
    appliedReceiptPending: boolean
    providerPending: boolean
  }>
  acquisitionStartedBeforeSettlement?: boolean
  requestHistory?: Array<{
    identity: string
    newRows: number
    phase?: string
    submittedRows?: Array<number>
    limit?: number
    direction?: string
    allowsRejectedRoot?: boolean
    selectedRanks?: Array<number>
  }>
  settlementOutcome: `fulfilled` | `rejected`
}

function referenceOptimisticWindow(
  testCase: OptimisticWindowCase,
  checkpoint: OptimisticWindowCheckpoint,
): Array<number> {
  // All three predicates accept 1, 2, and 3 in the remote ledger; 4 is the
  // rejected leading root. The model starts from installed keys, applies the
  // one overlay, and recomputes the window without the loader's prefix logic.
  const authoritative =
    (checkpoint === `settled` || checkpoint === `restored`) &&
    testCase.outcome === `acknowledge`
  const installed = authoritative
    ? testCase.rankMove
      ? [1, 2, 3, 4]
      : testCase.mutationSource === `marker`
        ? [1, 2, 3, 4]
        : [1, 2, 4]
    : testCase.installedIds
  const overlayActive = checkpoint === `optimistic`
  const markerDeparturePersisted =
    checkpoint === `settled` &&
    testCase.outcome === `acknowledge` &&
    testCase.mutationSource === `marker`
  return installed
    .filter(
      (id) =>
        id !== 4 &&
        !(
          (overlayActive || markerDeparturePersisted) &&
          id === 3 &&
          (!testCase.rankMove || testCase.rankDeparture)
        ),
    )
    .sort((left, right) => {
      const moved = (overlayActive || authoritative) && testCase.rankMove
      const leftRank = moved && left === 3 ? 0 : left
      const rightRank = moved && right === 3 ? 0 : right
      return rightRank - leftRank
    })
    .slice(0, testCase.width)
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
      settled = transaction.isPersisted.promise.then(
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
          restoration.isPersisted.promise,
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

function optimisticWindowViolations(
  observation: OptimisticWindowObservation,
  testCase: OptimisticWindowCase,
): Array<string> {
  const violations: Array<string> = []
  const { outcome, width } = testCase
  const optimistic = referenceOptimisticWindow(testCase, `optimistic`)
  const settled = referenceOptimisticWindow(testCase, `settled`)
  const lateAnswer = testCase.answerTiming === `after-settlement`
  const expectedAtSettlement =
    lateAnswer && outcome === `acknowledge` ? optimistic : settled
  const compare = (label: string, actual: unknown, expected: unknown) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      violations.push(
        `${label}: ${JSON.stringify(actual)} instead of ${JSON.stringify(expected)}`,
      )
    }
  }
  compare(`immediate rows`, observation.immediate, optimistic)
  compare(
    `immediate publications`,
    observation.immediatePublications.map(({ rows }) => rows),
    [optimistic],
  )
  compare(`acquiring rows`, observation.acquiring, optimistic)
  compare(`queued-answer rows`, observation.answerQueued, optimistic)
  compare(
    `first optimistic publication`,
    observation.preSettlementPublications[0]?.rows,
    optimistic,
  )
  compare(
    `other pre-settlement publications`,
    observation.preSettlementPublications.slice(1).map(({ rows }) => rows),
    [],
  )
  compare(`settled rows`, observation.settled, expectedAtSettlement)
  if (lateAnswer)
    compare(`rows after late answer`, observation.afterAnswer, settled)
  if (testCase.mutationSource === `marker` && outcome === `acknowledge`) {
    compare(
      `rows after marker restoration`,
      observation.afterRestore,
      referenceOptimisticWindow(testCase, `restored`),
    )
    compare(
      `marker restoration publications`,
      observation.afterRestorePublications?.map(({ rows }) => rows),
      [referenceOptimisticWindow(testCase, `restored`)],
    )
  }
  compare(
    `rows after first settlement turn`,
    observation.rowsAfterFirstTurn,
    settled,
  )
  compare(
    `rows after second settlement turn`,
    observation.rowsAfterSecondTurn,
    settled,
  )
  const expectedSettledPublications =
    JSON.stringify(optimistic) === JSON.stringify(expectedAtSettlement)
      ? []
      : [expectedAtSettlement]
  compare(
    `settled publications`,
    observation.publicationsAtSettlement
      .slice(observation.preSettlementPublications.length)
      .map(({ rows }) => rows),
    expectedSettledPublications,
  )
  compare(
    `post-settlement publications`,
    observation.publicationsAfterSettlement.map(({ rows }) => rows),
    lateAnswer && outcome === `acknowledge` ? [settled] : [],
  )
  const needsAcquisition = testCase.acquisition === `required`
  if (
    needsAcquisition &&
    observation.acquisitionStartedBeforeSettlement === false
  ) {
    violations.push(`refill acquisition did not start before settlement`)
  }
  if (needsAcquisition && observation.attempts.length === 0) {
    violations.push(`refill acquisition did not start`)
  }
  const refillId = width === 1 ? 2 : 1
  const refillAttempt = observation.attempts.find(({ submittedRows }) =>
    submittedRows.includes(refillId),
  )
  if (needsAcquisition && !refillAttempt) {
    violations.push(`refill answer did not submit row ${refillId}`)
  } else if (
    needsAcquisition &&
    (refillAttempt?.direction !== (testCase.direction ?? `desc`) ||
      refillAttempt.limit === undefined ||
      refillAttempt.limit > width + 2)
  ) {
    violations.push(`refill used an unbounded provider request`)
  } else if (
    !lateAnswer &&
    refillAttempt &&
    !refillAttempt.appliedReceiptPending
  ) {
    violations.push(`applied receipt was not pending at the queued-answer cut`)
  }
  if (!lateAnswer && refillAttempt && !refillAttempt.providerPending) {
    violations.push(`provider was not pending at the queued-answer cut`)
  }
  if (testCase.acquisition === `forbidden` && observation.attempts.length > 0) {
    violations.push(`refill acquisition started with complete local extent`)
  }
  const requested = new Set<string>()
  for (const request of observation.requestHistory ?? []) {
    if (request.phase === `pending` && testCase.indexed) {
      const finiteOrdered =
        request.direction === (testCase.direction ?? `desc`) &&
        request.limit !== undefined &&
        request.limit <= width + 2
      const boundaryTie =
        request.direction === undefined &&
        request.selectedRanks !== undefined &&
        new Set(request.selectedRanks).size === 1
      if (!finiteOrdered && !boundaryTie) {
        violations.push(`optimistic acquisition used a broad provider request`)
      }
      if (testCase.shape === `source` && request.allowsRejectedRoot) {
        violations.push(`source refill omitted the source predicate`)
      }
    }
    if (requested.has(request.identity) && request.newRows === 0) {
      violations.push(`repeated an unchanged provider request without progress`)
      break
    }
    requested.add(request.identity)
  }
  compare(
    `settlement outcome`,
    observation.settlementOutcome,
    outcome === `acknowledge` ? `fulfilled` : `rejected`,
  )
  return violations
}

describe(`eager indexed ordered windows`, () => {
  const { multiplier, ...replay } = readOracleRunConfig()
  const runs = 40 * multiplier

  it(`places null ranks first in an indexed descending window`, async () => {
    await checkEagerWindow({
      path: `sync`,
      filter: `source`,
      indexed: true,
      direction: `desc`,
      terms: 1,
      limit: 1,
      offset: 0,
      initial: [{ id: 0, rank: null as unknown as number, eligible: true }],
      history: [{ type: `upsert`, id: 1, rank: 2, eligible: true }],
    })
  })

  it(`refills after a visible delete without resending the source`, async () => {
    await checkEagerWindow({
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
    })
  })

  it.each([`sync`, `local-only`] as const)(
    `publishes one complete window when a repair reaches a NaN tie group (%s)`,
    async (path) => {
      // The bounded prefix ends inside a NaN tie group, which cannot be a
      // cursor, so the repair falls back to a full-source read.
      await checkEagerWindow({
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
      })
    },
  )

  it(`refills a joined window over several pages after a refetch empties it`, async () => {
    // Every row the window held changes while the refetching provider lags.
    // The final refetch empties the window, and the loader refills it one
    // page at a time, publishing [], then one row, then the final two (#2131).
    await checkEagerWindow({
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
    })
  })

  it(`shows a row that moved between two served pages after a refetch`, async () => {
    // The loader pages the top two rows, then one more after a cursor. Rows
    // 10 and 11 arrive while the provider lags; the refetched first page now
    // ends at row 11, so row 10 sorts between the pages. A provider that
    // keeps served ranges whole sends it; one that re-runs each page alone
    // (query-db-collection today) never does, and the window shows [4, 1].
    await checkEagerWindow({
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
    })
  })

  // The same trace with a provider that refetches each page alone and then
  // reports the shift. Row 10 is in no answer after the refetch; the
  // report makes the loader re-establish the window with a bounded repair.
  it(`shows a row that moved between two served pages after a signalling refetch`, async () => {
    await checkEagerWindow({
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
    })
  })

  // A page with no later page whose end moves earlier. Two rank-0 rows
  // arrive while the provider lags; the refetched page ends at rank 0, but
  // the tie request still holds the rank-1 row, so the loader sees no
  // delete. The report repairs the window.
  it(`repairs a signalling refetch whose page now ends before its tie`, async () => {
    await checkEagerWindow({
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
    })
  })

  // A second live-query Collection over a refetched on-demand source kept a
  // short joined window (#2155): after the refetch the peer showed ranks
  // [0, 0] where the model shows [0, 0, 100]. The loader fix that resumes a
  // staged continuation after a synchronous answer the graph already
  // processed closed this trace.
  it(`shows a peer's full joined window after a refetch removes a tied row`, async () => {
    await checkEagerWindow({
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
    })
  })

  it(`publishes a full-join window that only loses a row`, async () => {
    // The delete leaves fewer result rows than the offset, so the window
    // only loses its row. A subscriber that did not start with that key
    // receives no removal; this one starts with every visible key and must
    // receive the change.
    await checkEagerWindow({
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
    })
  })

  it(`refills an unindexed on-demand anti-join window after a visible delete`, async () => {
    // The plan pages without an index; the anti-join drops row 0 after the
    // provider's limit. Before the compiler counted the rows this window
    // needs, the window stayed empty after the delete instead of reading the
    // full source.
    await checkEagerWindow({
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
    })
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
                acquisition: extent === `missing` ? `required` : `forbidden`,
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

  it.each(optimisticWindowCases)(
    `characterizes a width-$width $indexed indexed optimistic $shape $mutation from $mutationSource with $extent replacement extent for a $consumer before $outcome ($answerTiming)`,
    async (testCase) => {
      const observation = await checkOptimisticWindow(testCase)
      const actual = optimisticWindowViolations(observation, testCase)
      // Each legal history must refine the independent public-window model.
      expect(actual).toEqual([])
    },
  )

  it(`refills an optimistic rank move that leaves a full installed window`, async () => {
    // Moving the leading row below a missing source row does not shrink the
    // installed window. A local row-count check alone cannot discover that
    // the remote ordered prefix now contains row 1.
    const testCase: OptimisticWindowCase = {
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
    }
    const observation = await checkOptimisticWindow(testCase)
    expect(optimisticWindowViolations(observation, testCase)).toEqual([])
  })

  it(`restores an optimistic membership departure with a rank change on rollback`, async () => {
    // This is a membership departure, so the short-window law applies even
    // though its source row also changes order. Rollback must remove both
    // overlay effects at the same public cut.
    const testCase: OptimisticWindowCase = {
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
    }
    const observation = await checkOptimisticWindow(testCase)
    expect(optimisticWindowViolations(observation, testCase)).toEqual([])
  })

  it.each(
    ([`joined`, `anti-joined`] as const).flatMap((shape) =>
      ([`acknowledge`, `rollback`] as const).map((outcome) => ({
        shape,
        outcome,
      })),
    ),
  )(
    `publishes an ascending $shape limit-one optimistic delete before $outcome`,
    async ({ shape, outcome }) => {
      // Negated ranks make row 3 the ascending head and row 2 its provider
      // successor. The leading rejected row 4 remains ahead of both.
      const testCase: OptimisticWindowCase = {
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
      }
      const observation = await checkOptimisticWindow(testCase)
      expect(optimisticWindowViolations(observation, testCase)).toEqual([])
    },
  )

  it(`rejects a hostile optimistic observation that makes no refill progress`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `refill acquisition did not start`,
      `refill answer did not submit row 1`,
    ])
  })

  it(`rejects a delayed Collection publication`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `update`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [
        {
          submittedRows: [1],
          limit: 2,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `immediate publications: [] instead of [[2]]`,
    ])
  })

  it(`rejects a stale publication after transaction settlement`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `update`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [{ rows: [2] }],
      attempts: [
        {
          submittedRows: [1],
          limit: 2,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `rows after second settlement turn: [2] instead of [2,1]`,
      `post-settlement publications: [[2]] instead of []`,
    ])
  })

  it(`rejects a full-source refill disguised as useful bounded progress`, () => {
    const testCase: OptimisticWindowCase = {
      shape: `joined`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [4, 3, 2],
      acquisition: `required`,
    }
    const observation: OptimisticWindowObservation = {
      initial: [3, 2],
      immediate: [2],
      acquiring: [2],
      answerQueued: [2],
      settled: [2, 1],
      rowsAfterFirstTurn: [2, 1],
      rowsAfterSecondTurn: [2, 1],
      immediatePublications: [{ rows: [2] }],
      preSettlementPublications: [{ rows: [2] }],
      publicationsAtSettlement: [{ rows: [2] }, { rows: [2, 1] }],
      publicationsAfterSettlement: [],
      attempts: [
        {
          submittedRows: [4, 3, 2, 1, 0, -1],
          limit: 6,
          direction: `desc`,
          appliedReceiptPending: true,
          providerPending: true,
        },
      ],
      settlementOutcome: `fulfilled`,
    }

    expect(optimisticWindowViolations(observation, testCase)).toEqual([
      `refill used an unbounded provider request`,
    ])
    const repeated = {
      ...observation,
      attempts: [{ ...observation.attempts[0]!, limit: 2 }],
      requestHistory: [
        { identity: `same ordered page`, newRows: 1 },
        { identity: `same ordered page`, newRows: 0 },
      ],
    }
    expect(optimisticWindowViolations(repeated, testCase)).toEqual([
      `repeated an unchanged provider request without progress`,
    ])
  })

  it(`rejects a source refill that omits eligibility or adds broad work`, async () => {
    const testCase: OptimisticWindowCase = {
      shape: `source`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [3, 2],
      acquisition: `required`,
    }
    const observation = await checkOptimisticWindow(testCase)
    expect(optimisticWindowViolations(observation, testCase)).toEqual([])
    const refill = observation.requestHistory!.find(
      ({ phase, submittedRows }) =>
        phase === `pending` && submittedRows?.includes(1),
    )!

    // A finite, ordered request that drops the source predicate still returns
    // the needed row, but a rejected peer at the same rank exposes the omission.
    const missingPredicate: OptimisticWindowObservation = {
      ...observation,
      requestHistory: observation.requestHistory!.map((request) =>
        request === refill ? { ...request, allowsRejectedRoot: true } : request,
      ),
    }
    expect(optimisticWindowViolations(missingPredicate, testCase)).toContain(
      `source refill omitted the source predicate`,
    )

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
    expect(optimisticWindowViolations(extraBroadRequest, testCase)).toContain(
      `optimistic acquisition used a broad provider request`,
    )
  })

  it(`rejects acquisition deferred until after optimistic settlement`, async () => {
    const testCase: OptimisticWindowCase = {
      shape: `source`,
      mutation: `delete`,
      consumer: `collection`,
      outcome: `acknowledge`,
      width: 2,
      indexed: true,
      extent: `missing`,
      installedIds: [3, 2],
      acquisition: `required`,
    }
    const observation = await checkOptimisticWindow(testCase)
    expect(optimisticWindowViolations(observation, testCase)).toEqual([])
    expect(
      optimisticWindowViolations(
        { ...observation, acquisitionStartedBeforeSettlement: false },
        testCase,
      ),
    ).toContain(`refill acquisition did not start before settlement`)
  })

  /**
   * These complete-local-extent histories isolate the immediate publication
   * law from provider timing. The reference filters one deleted key from a
   * plain row list, orders it, then takes the requested slice. A tie deletes
   * whichever equal-ranked key the initial window selected; the remaining
   * peer is then the only valid top row, independent of tie-breaking policy.
   */
  it.each(
    [
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
    ),
  )(
    `publishes an optimistic departure in an installed $name before $outcome`,
    async ({ ranks, direction, offset, limit, outcome }) => {
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
        rows
          .filter(({ id }) => id !== removed)
          .sort((left, right) =>
            direction === `asc`
              ? left.rank - right.rank
              : right.rank - left.rank,
          )
          .slice(offset, offset + limit)
          .map(({ id }) => id)
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
        await transaction.isPersisted.promise.catch(() => undefined)
        expect(ids(), `settled installed rows`).toEqual(
          outcome === `acknowledge` ? expected : initial,
        )
      } finally {
        persistence.resolve()
        unsubscribe?.()
        await query.cleanup()
        await source.cleanup()
      }
    },
  )

  it.each([
    [`sync`, 1],
    [`local-only`, 1],
    [`sync`, 2],
    [`local-only`, 2],
  ] as const)(
    `shows no rootless full-join row for a null-ranked root past the prefix (%s, %s terms)`,
    async (path, terms) => {
      // Nulls last. Row 2 and the marker of row 3 tie on rank in the null
      // group. A full join reads its full source, so row 3's marker is
      // matched. A loader that paged this plan and ended its prefix inside
      // the null group would leave row 3 unloaded and could show its marker
      // as a rootless row; restoring the old join rule fails this case.
      await checkEagerWindow({
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
      })
    },
  )

  it.each([`sync`, `local-only`] as const)(
    `shows no rootless full-join row whose root row is past the prefix (%s)`,
    async (path) => {
      // Every domain row has a marker, and nulls sort first. A bounded root
      // prefix of one row would leave the other markers unmatched in the
      // graph, and their null-ranked rootless rows would take the window
      // from the first root row.
      await checkEagerWindow({
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
      })
    },
  )

  it.each([`sync`, `local-only`] as const)(
    `refills a joined-filter window when a row leaves only through the join (%s)`,
    async (path) => {
      // The bounded prefix holds rows 3 and 1; row 0 then enters the query's
      // input past it. Row 3 loses its marker without a root delete, so row 0
      // must not stand in for row 4, which the prefix never sent.
      // Shrunk from seed -1253945411.
      await checkEagerWindow({
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
      })
    },
  )

  it.each([`sync`, `local-only`] as const)(
    `refills a joined-filter window past a retained distant row (%s)`,
    async (path) => {
      // A label update brings eligible row 10 into the query's input. After
      // row 2 leaves, a prefix of one root row (row 1) fails the joined
      // filter, and row 10 must not stand in for row 4.
      await checkEagerWindow({
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
      })
    },
  )

  fcTest.prop([eagerCase], { numRuns: runs, seed: 2044 })(
    `keeps rows and per-change work bounded for a fixed seed`,
    checkEagerWindow,
  )

  fcTest.prop(
    [eagerCase],
    oracleRandomParameters(runs, replay, `ordered-work.eager-indexed-window`),
  )(
    `keeps rows and per-change work bounded for a random or replayed seed`,
    checkEagerWindow,
  )

  // Reconstruction: the fixed-seed campaign reaches the premise. Sampling
  // its arbitrary with its seed and run count yields exactly the cases it
  // executes. Their initial windows include rootless rows and, separately,
  // windows that hold a rootless row beside a root row with a null rank.
  const FULL_JOIN_SEED = 2073
  it(`generates full-join windows that reach the null group`, () => {
    let rootless = 0
    let mixedNullGroup = 0
    for (const [testCase] of fc.sample(fc.tuple(eagerFullJoinCase), {
      numRuns: runs,
      seed: FULL_JOIN_SEED,
    })) {
      const roots = [
        ...fillerRows(testCase.direction, testCase.fillers),
        ...testCase.initial,
      ]
      const model = new Map<number, Row>()
      for (const row of roots) {
        model.set(row.id, { label: `row`, ...row, eligible: true })
      }
      for (const markerId of testCase.orphans ?? []) {
        model.set(-1 - markerId, {
          id: -1 - markerId,
          rank: null as unknown as number,
          eligible: true,
          label: `marker`,
        })
      }
      const window = eagerWindow(model, testCase)
      const hasRootless = window.some((id) => id < 0)
      if (hasRootless) rootless++
      if (
        hasRootless &&
        window.some(
          (id) => id >= 0 && (model.get(id)!.rank as number | null) === null,
        )
      ) {
        mixedNullGroup++
      }
    }
    // At one times the run count: 19 and 7 of 40 cases.
    expect(rootless).toBeGreaterThanOrEqual(10)
    expect(mixedNullGroup).toBeGreaterThanOrEqual(5)
  })

  fcTest.prop([eagerFullJoinCase], { numRuns: runs, seed: FULL_JOIN_SEED })(
    `keeps a full-join window to the first result rows for a fixed seed`,
    checkEagerWindow,
  )

  fcTest.prop(
    [eagerFullJoinCase],
    oracleRandomParameters(runs, replay, `ordered-work.eager-full-join`),
  )(
    `keeps a full-join window to the first result rows for a random or replayed seed`,
    checkEagerWindow,
  )

  // The fixed-seed held campaign and its reconstruction run in one test, so
  // the reach check always reads the cases that test just executed. Reach is
  // keyed by case, so rerunning an identical case overwrites its entry;
  // shrinking runs only after a failure, which ends the test first.
  it(`keeps a window whose loads answer between live changes for a fixed seed`, async () => {
    const HELD_SEED = 2081
    const heldReach = new Map<
      string,
      Awaited<ReturnType<typeof runEagerWindow>>
    >()
    await fc.assert(
      fc.asyncProperty(eagerHeldCase, async (testCase) => {
        heldReach.set(fc.stringify(testCase), await runEagerWindow(testCase))
      }),
      { numRuns: runs, seed: HELD_SEED },
    )
    // Reconstruction: sampling the arbitrary with the same seed and run
    // count yields the executed cases.
    const executed = new Set(
      fc
        .sample(eagerHeldCase, { numRuns: runs, seed: HELD_SEED })
        .map((testCase) => fc.stringify(testCase)),
    )
    expect(
      [...executed].filter((key) => !heldReach.has(key)),
      `executed held cases without recorded reach`,
    ).toEqual([])
    const reach = [...executed].map((key) => heldReach.get(key)!)
    // A case whose deletes refill from rows the query already holds issues
    // no held request; at one times the run count, 35 of 40 cases issue one.
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
    // cooperative provider cancels 4 and a late provider answers 1 anyway.
    expect(
      reach.reduce((sum, count) => sum + count.cooperativeCancels, 0),
      `held requests a cooperative provider cancelled`,
    ).toBeGreaterThanOrEqual(3)
    expect(
      reach.reduce((sum, count) => sum + count.lateAnswers, 0),
      `aborted held requests a late provider answered`,
    ).toBeGreaterThanOrEqual(1)
  })

  fcTest.prop(
    [eagerHeldCase],
    oracleRandomParameters(runs, replay, `ordered-work.eager-held-load`),
  )(
    `keeps a window whose loads answer between live changes for a random or replayed seed`,
    checkEagerWindow,
  )

  // A local null-ranked row can appear to fill the window while the settled
  // provider prefix ends before a better row. Held answers must not let that
  // local row stand in for source coverage after earlier visible deletes.
  it(`keeps a joined window within its settled source prefix after held answers`, async () => {
    await checkEagerWindow({
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
    })
  })

  fcTest.prop([eagerJoinedGapCase], { numRuns: runs, seed: 2063 })(
    `keeps a joined-filter window whose row leaves only through the join for a fixed seed`,
    checkEagerWindow,
  )

  fcTest.prop(
    [eagerJoinedGapCase],
    oracleRandomParameters(runs, replay, `ordered-work.eager-joined-gap`),
  )(
    `keeps a joined-filter window whose row leaves only through the join for a random or replayed seed`,
    checkEagerWindow,
  )

  fcTest.prop([eagerJoinedCase], { numRuns: runs, seed: 2059 })(
    `keeps a joined-filter window to the first eligible rows for a fixed seed`,
    checkEagerWindow,
  )

  fcTest.prop(
    [eagerJoinedCase],
    oracleRandomParameters(runs, replay, `ordered-work.eager-joined-window`),
  )(
    `keeps a joined-filter window to the first eligible rows for a random or replayed seed`,
    checkEagerWindow,
  )
})
