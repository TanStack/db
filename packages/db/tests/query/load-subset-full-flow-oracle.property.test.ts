import { fc, test as fcTest } from '@fast-check/vitest'
import { expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex, ReverseIndex } from '../../src/index.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection, eq, gte } from '../../src/query/index.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { DeduplicatedLoadSubset } from '../../src/query/subset-dedupe.js'
import { normalizeValue } from '../../src/utils/comparison.js'
import { LIVE_QUERY_INTERNAL } from '../../src/query/live/internal.js'
import { computeOrderedLoadCursor } from '../../src/query/live/utils.js'
import { WindowState } from '../../src/query/live/window-state.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import {
  projectAdapterLifecycle,
  projectAtomicOrderedPublicationState,
  projectAtomicOrderedPublications,
  projectAuthorizedContinuationStarts,
  projectMultiSourceOrderedWindow,
  projectOrderedContinuationEvidence,
  projectOrderedPublicationBoundary,
  projectRetainedRowKeys,
  projectReusableDemands,
  projectTransportLoads,
} from '../load-subset-full-flow-model.js'
import {
  createCrossRealmUint8Array,
  flushPromises,
  mockSyncCollectionOptions,
} from '../utils.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import type { LoadSubsetOptions, WritableDeep } from '../../src/types.js'
import type { LoadSubsetFullFlowEvent } from '../load-subset-full-flow-model.js'

type AdapterLifecycleEvent =
  | { type: `start`; options: LoadSubsetOptions }
  | { type: `release`; options: LoadSubsetOptions }

function eventTypes(
  events: ReadonlyArray<AdapterLifecycleEvent>,
): Array<AdapterLifecycleEvent[`type`]> {
  return events.map((event) => event.type)
}

function visibleRows<Row extends { id: string; value: number }>(
  values: Iterable<Row>,
): Array<{ id: string; value: number }> {
  return Array.from(values, ({ id, value }) => ({ id, value }))
}

it(`loads each side of a filtered inner join once`, async () => {
  type Order = {
    id: number
    scheduledAt: string
    status: string
    addressId: number
  }
  type Charge = { id: number; addressId: number }

  const orderLoads: Array<LoadSubsetOptions> = []
  const chargeLoads: Array<LoadSubsetOptions> = []
  const orders = createCollection<Order>({
    id: `full-flow-filtered-join-orders`,
    getKey: (order) => order.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
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
          loadSubset: (options) => {
            orderLoads.push(options)
            return true
          },
        }
      },
    },
  })
  const charges = createCollection<Charge>({
    id: `full-flow-filtered-join-charges`,
    getKey: (charge) => charge.id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { id: 10, addressId: 1 } })
        write({ type: `insert`, value: { id: 20, addressId: 2 } })
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            chargeLoads.push(options)
            return true
          },
        }
      },
    },
  })
  const query = createLiveQueryCollection((q) =>
    q
      .from({ order: orders })
      .where(({ order }) => gte(order.scheduledAt, `2024-01-12`))
      .where(({ order }) => eq(order.status, `queued`))
      .innerJoin({ charge: charges }, ({ order, charge }) =>
        eq(order.addressId, charge.addressId),
      ),
  )

  try {
    await query.preload()

    expect(
      [...query.values()].map(({ order, charge }) => [order.id, charge.id]),
    ).toEqual([[1, 10]])
    expect(orderLoads).toHaveLength(1)
    expect(chargeLoads).toHaveLength(1)
  } finally {
    await Promise.all([query.cleanup(), orders.cleanup(), charges.cleanup()])
  }
})

const { multiplier: fullFlowMultiplier, replaySeed: fullFlowReplaySeed } =
  readOracleRunConfig()

type MultiSourceOrderedScenario = {
  primaryRows: ReadonlyArray<{
    id: string
    rank: number
    joinKey: string
  }>
  secondaryRows: ReadonlyArray<{ id: string; joinKey: string }>
  offset: number
  limit: number
  direction: `asc` | `desc`
  primaryAutoIndex: `eager` | `off`
  secondaryPublication:
    | `preloaded`
    | `preloaded-delayed-receipt`
    | `after-primary-continuation`
    | `after-primary-exhaustion`
  secondaryPageSize: 1 | 2
  secondaryCommitOrder: `insertion` | `reverse`
}

const multiSourceJoinKeyArbitrary = fc.constantFrom(`x`, `y`, `z`)
const secondaryJoinKeyOrders = [
  [`x`, `y`, `z`],
  [`x`, `z`, `y`],
  [`y`, `x`, `z`],
  [`y`, `z`, `x`],
  [`z`, `x`, `y`],
  [`z`, `y`, `x`],
] as const
const multiSourceOrderedScenarioArbitrary: fc.Arbitrary<MultiSourceOrderedScenario> =
  fc
    .record({
      ranks: fc.tuple(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
      ),
      joinKeys: fc.tuple(
        multiSourceJoinKeyArbitrary,
        multiSourceJoinKeyArbitrary,
        multiSourceJoinKeyArbitrary,
        multiSourceJoinKeyArbitrary,
      ),
      secondaryMatchCounts: fc.tuple(
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
        fc.integer({ min: 0, max: 2 }),
      ),
      secondaryJoinKeyOrder: fc.constantFrom(...secondaryJoinKeyOrders),
      reverseSecondaryMatches: fc.boolean(),
      offset: fc.integer({ min: 0, max: 2 }),
      limit: fc.integer({ min: 0, max: 2 }),
      direction: fc.constantFrom(`asc` as const, `desc` as const),
      primaryAutoIndex: fc.constantFrom(`eager` as const, `off` as const),
      secondaryPublication: fc.constantFrom(
        `preloaded` as const,
        `preloaded-delayed-receipt` as const,
        `after-primary-continuation` as const,
        `after-primary-exhaustion` as const,
      ),
      secondaryPageSize: fc.constantFrom(1 as const, 2 as const),
      secondaryCommitOrder: fc.constantFrom(
        `insertion` as const,
        `reverse` as const,
      ),
    })
    .map(
      ({
        ranks,
        joinKeys,
        secondaryMatchCounts,
        secondaryJoinKeyOrder,
        reverseSecondaryMatches,
        ...scenario
      }) => ({
        ...scenario,
        primaryRows: [`a`, `b`, `c`, `d`].map((id, index) => ({
          id,
          rank: ranks[index]!,
          joinKey: joinKeys[index]!,
        })),
        secondaryRows: secondaryJoinKeyOrder.flatMap((joinKey) => {
          const count = secondaryMatchCounts[[`x`, `y`, `z`].indexOf(joinKey)]!
          const rows = Array.from({ length: count }, (_, matchIndex) => ({
            id: `${joinKey}-${matchIndex}`,
            joinKey,
          }))
          return reverseSecondaryMatches ? rows.reverse() : rows
        }),
      }),
    )

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    multiSourceOrderedScenarioArbitrary,
    ({
      primaryRows,
      secondaryRows,
      offset,
      limit,
      direction,
      primaryAutoIndex,
      secondaryPublication,
      secondaryPageSize,
      secondaryCommitOrder,
    }) => [
      `direction=${direction}`,
      `primary-auto-index=${primaryAutoIndex}`,
      `offset=${offset}`,
      `limit=${limit}`,
      `secondary=${secondaryPublication}`,
      `secondary-page-size=${secondaryPageSize}`,
      `secondary-commit-order=${secondaryCommitOrder}`,
      `secondary-insertion-order=${secondaryRows
        .map(({ id }) => id)
        .join(`,`)}`,
      `exhaustion=${
        primaryRows.reduce(
          (count, { joinKey }) =>
            count +
            secondaryRows.filter((row) => row.joinKey === joinKey).length,
          0,
        ) <
        offset + limit
      }`,
      `leading-exclusion=${!secondaryRows.some(
        ({ joinKey }) =>
          joinKey ===
          orderedPrimaryRows({
            primaryRows,
            secondaryRows,
            offset,
            limit,
            direction,
            primaryAutoIndex,
            secondaryPublication,
            secondaryPageSize,
            secondaryCommitOrder,
          })[0]!.joinKey,
      )}`,
      `multiplicity=${new Set(secondaryRows.map(({ joinKey }) => joinKey)).size < secondaryRows.length}`,
      `tied=${new Set(primaryRows.map(({ rank }) => rank)).size < primaryRows.length}`,
    ],
    oracleRandomParameters(1_000, fullFlowReplaySeed),
  )
}

function orderedPrimaryRows(
  scenario: MultiSourceOrderedScenario,
): Array<MultiSourceOrderedScenario[`primaryRows`][number]> {
  return [...scenario.primaryRows].sort((left, right) => {
    const rankOrder =
      scenario.direction === `asc`
        ? left.rank - right.rank
        : right.rank - left.rank
    return rankOrder || left.id.localeCompare(right.id)
  })
}

function hasPreloadedSecondary(scenario: MultiSourceOrderedScenario): boolean {
  return (
    scenario.secondaryPublication === `preloaded` ||
    scenario.secondaryPublication === `preloaded-delayed-receipt`
  )
}

function collectStringLiterals(
  expression: Func | PropRef | Value,
): Array<string> {
  if (expression instanceof Func) {
    return expression.args.flatMap((argument) =>
      collectStringLiterals(argument),
    )
  }
  if (!(expression instanceof Value)) return []
  if (typeof expression.value === `string`) return [expression.value]
  if (!Array.isArray(expression.value)) return []
  return expression.value.filter(
    (value): value is string => typeof value === `string`,
  )
}

let multiSourceOrderedHarnessId = 0

async function runMultiSourceOrderedScenario(
  scenario: MultiSourceOrderedScenario,
): Promise<void> {
  type PrimaryRow = MultiSourceOrderedScenario[`primaryRows`][number]
  type SecondaryRow = { id: string; joinKey: string }

  const primaryOrder = orderedPrimaryRows(scenario)
  const projection = projectMultiSourceOrderedWindow({
    primaryOrder: primaryOrder.map(({ id, joinKey }) => ({
      key: id,
      joinKey,
    })),
    secondaryRows: scenario.secondaryRows.map(({ id, joinKey }) => ({
      key: id,
      joinKey,
    })),
    offset: scenario.offset,
    limit: scenario.limit,
  })
  const primaryCalls: Array<LoadSubsetOptions> = []
  const primaryCallProgress: Array<{
    demandKey: string
    establishedPrimaryCount: number
    establishedSecondaryCount: number
  }> = []
  const primaryReceipts: Array<ReadonlyArray<string>> = []
  const primaryOrderedVisitedKeys: Array<string> = []
  const secondaryCalls: Array<LoadSubsetOptions> = []
  const secondaryReceipts: Array<ReadonlyArray<string>> = []
  const secondaryLoadCommitSizes: Array<number> = []
  const delayedSecondaryReceiptWaiters: Array<{
    index: number
    gate: ReturnType<typeof createDeferred<void>>
  }> = []
  const delayedSecondaryReceiptCompletionOrder: Array<number> = []
  let releaseDelayedSecondaryReceipts = false
  const secondaryPublicationGate = createDeferred<void>()
  const establishedPrimaryKeys = new Set<string>()
  const committedPrimaryKeys = new Set<string>()
  const primaryKeysEstablishedByLoads = new Set<string>()
  const establishedSecondaryKeys = new Set<string>()
  let primaryOrderedCallCount = 0
  let primaryOrderedCallCountAtSecondaryRelease: number | undefined
  let primaryKeysAtSecondaryRelease: ReadonlyArray<string> | undefined
  let primaryCommittedKeysAtSecondaryRelease: ReadonlyArray<string> | undefined
  let primaryKeysBeforeSecondaryPublication: ReadonlyArray<string> | undefined
  let primaryBegin!: () => void
  let primaryWrite!: (message: { type: `insert`; value: PrimaryRow }) => void
  let primaryCommit!: () => true | Promise<void>

  const applyPrimaryRows = async (
    rows: ReadonlyArray<PrimaryRow>,
  ): Promise<Array<string>> => {
    const freshRows = rows.filter(({ id }) => !establishedPrimaryKeys.has(id))
    if (freshRows.length === 0) return []
    primaryBegin()
    for (const row of freshRows) {
      establishedPrimaryKeys.add(row.id)
      primaryKeysEstablishedByLoads.add(row.id)
      primaryWrite({ type: `insert`, value: row })
    }
    const applied = primaryCommit()
    if (applied !== true) await applied
    for (const row of freshRows) committedPrimaryKeys.add(row.id)
    return freshRows.map(({ id }) => id)
  }

  const releaseSecondaryPublication = (): void => {
    primaryOrderedCallCountAtSecondaryRelease ??= primaryOrderedCallCount
    primaryKeysAtSecondaryRelease ??= [...new Set(primaryOrderedVisitedKeys)]
    primaryCommittedKeysAtSecondaryRelease ??= [...committedPrimaryKeys]
    secondaryPublicationGate.resolve()
  }
  if (scenario.limit === 0) secondaryPublicationGate.resolve()

  const recordPrimaryCall = (options: LoadSubsetOptions): void => {
    primaryCalls.push(options)
    primaryCallProgress.push({
      demandKey: getLoadSubsetDemandKey(options) ?? `unfiltered`,
      establishedPrimaryCount: establishedPrimaryKeys.size,
      establishedSecondaryCount: establishedSecondaryKeys.size,
    })
  }

  const primary = createCollection<PrimaryRow>({
    id: `multi-source-ordered-primary-${multiSourceOrderedHarnessId}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: scenario.primaryAutoIndex,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        primaryBegin = params.begin
        primaryWrite = params.write
        primaryCommit = params.commit
        params.markReady()
        return {
          loadSubset: async (options) => {
            recordPrimaryCall(options)
            if (!options.orderBy) {
              const rows = primaryOrder.filter(
                (row) =>
                  options.where === undefined ||
                  evaluateReferenceExpression(options.where, row),
              )
              const appliedRowKeys = await applyPrimaryRows(rows)
              primaryReceipts.push(appliedRowKeys)
              return {
                hasMore: false,
                appliedRowKeys,
              }
            }

            primaryOrderedCallCount++
            if (options.limit === undefined) {
              primaryOrderedVisitedKeys.push(
                ...primaryOrder.map(({ id }) => id),
              )
              const appliedRowKeys = await applyPrimaryRows(primaryOrder)
              if (
                scenario.secondaryPublication ===
                  `after-primary-continuation` ||
                scenario.secondaryPublication === `after-primary-exhaustion`
              ) {
                releaseSecondaryPublication()
              }
              primaryReceipts.push(appliedRowKeys)
              return {
                hasMore: false,
                appliedRowKeys,
              }
            }
            const lastKey = options.cursor?.lastKey
            const previousIndex =
              lastKey === undefined
                ? -1
                : primaryOrder.findIndex(({ id }) => id === lastKey)
            if (lastKey !== undefined && previousIndex < 0) {
              throw new Error(`Unknown primary cursor ${String(lastKey)}`)
            }
            const row = primaryOrder[previousIndex + 1]
            let appliedRowKeys: Array<string> = []
            if (row) {
              primaryOrderedVisitedKeys.push(row.id)
              appliedRowKeys = await applyPrimaryRows([row])
            }
            const hasMore = previousIndex + 1 < primaryOrder.length - 1
            if (
              scenario.secondaryPublication === `after-primary-continuation` &&
              primaryOrderedCallCount >= 2
            ) {
              releaseSecondaryPublication()
            }
            if (
              scenario.secondaryPublication === `after-primary-exhaustion` &&
              !hasMore
            ) {
              releaseSecondaryPublication()
            }
            primaryReceipts.push(appliedRowKeys)
            return {
              hasMore,
              appliedRowKeys,
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })

  let secondaryBegin!: () => void
  let secondaryWrite!: (message: {
    type: `insert`
    value: SecondaryRow
  }) => void
  let secondaryCommit!: () => true | Promise<void>
  const secondaryRows = scenario.secondaryRows
  const applySecondaryRows = async (
    rows: ReadonlyArray<SecondaryRow>,
  ): Promise<Array<string>> => {
    const freshRows = rows.filter(({ id }) => !establishedSecondaryKeys.has(id))
    if (freshRows.length === 0) return []
    secondaryLoadCommitSizes.push(freshRows.length)
    secondaryBegin()
    for (const row of freshRows) {
      establishedSecondaryKeys.add(row.id)
      secondaryWrite({ type: `insert`, value: row })
    }
    const applied = secondaryCommit()
    if (applied !== true) await applied
    return freshRows.map(({ id }) => id)
  }
  const secondary = createCollection<SecondaryRow>({
    id: `multi-source-ordered-secondary-${multiSourceOrderedHarnessId}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: hasPreloadedSecondary(scenario),
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        secondaryBegin = params.begin
        secondaryWrite = params.write
        secondaryCommit = params.commit
        if (hasPreloadedSecondary(scenario) && secondaryRows.length > 0) {
          secondaryBegin()
          for (const row of secondaryRows) {
            establishedSecondaryKeys.add(row.id)
            secondaryWrite({ type: `insert`, value: row })
          }
          const applied = secondaryCommit()
          if (applied !== true) {
            throw new Error(`Expected synchronous initial secondary rows`)
          }
        }
        params.markReady()
        return {
          loadSubset: async (options) => {
            secondaryCalls.push(options)
            if (!hasPreloadedSecondary(scenario)) {
              await secondaryPublicationGate.promise
              primaryKeysBeforeSecondaryPublication ??= [
                ...new Set(primaryOrderedVisitedKeys),
              ]
            }
            if (
              scenario.secondaryPublication === `preloaded-delayed-receipt` &&
              !releaseDelayedSecondaryReceipts
            ) {
              const waiter = {
                index: delayedSecondaryReceiptWaiters.length,
                gate: createDeferred<void>(),
              }
              delayedSecondaryReceiptWaiters.push(waiter)
              await waiter.gate.promise
              delayedSecondaryReceiptCompletionOrder.push(waiter.index)
            }
            const matchingRows = secondaryRows.filter(
              (row) =>
                options.where === undefined ||
                evaluateReferenceExpression(options.where, row),
            )
            const rowsInCommitOrder =
              scenario.secondaryCommitOrder === `reverse`
                ? [...matchingRows].reverse()
                : matchingRows
            const appliedRowKeys: Array<string> = []
            for (
              let index = 0;
              index < rowsInCommitOrder.length;
              index += scenario.secondaryPageSize
            ) {
              appliedRowKeys.push(
                ...(await applySecondaryRows(
                  rowsInCommitOrder.slice(
                    index,
                    index + scenario.secondaryPageSize,
                  ),
                )),
              )
            }
            secondaryReceipts.push(appliedRowKeys)
            return {
              hasMore: false,
              appliedRowKeys,
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `multi-source-ordered-live-${multiSourceOrderedHarnessId++}`,
    query: (q) =>
      q
        .from({ primaryRow: primary })
        .innerJoin(
          { secondaryRow: secondary },
          ({ primaryRow, secondaryRow }) =>
            eq(primaryRow.joinKey, secondaryRow.joinKey),
        )
        .orderBy(({ primaryRow }) => primaryRow.rank, scenario.direction)
        .offset(scenario.offset)
        .limit(scenario.limit),
    startSync: true,
  })

  try {
    const preload = live.preload()
    let preloadSettled = false
    void preload.then(
      () => {
        preloadSettled = true
      },
      () => {
        preloadSettled = true
      },
    )
    if (scenario.secondaryPublication === `preloaded-delayed-receipt`) {
      await flushPromises()
      if (scenario.secondaryRows.length > 0 && scenario.limit > 0) {
        expect(delayedSecondaryReceiptWaiters.length).toBeGreaterThan(0)
        expect(preloadSettled).toBe(false)
        expect(live.isReady()).toBe(false)
      }
      releaseDelayedSecondaryReceipts = true
      for (const waiter of [...delayedSecondaryReceiptWaiters].reverse()) {
        waiter.gate.resolve()
        await flushPromises()
      }
    }
    await preload
    await flushPromises()
    expect(preloadSettled).toBe(true)

    expect(
      live.toArray.map(
        ({ primaryRow, secondaryRow }) => `${primaryRow.id}:${secondaryRow.id}`,
      ),
    ).toEqual(projection.visiblePairKeys)

    const initialPrimaryCallCount = primaryCalls.length
    if (scenario.limit === 0) {
      expect(
        primaryCalls
          .slice(0, initialPrimaryCallCount)
          .filter(({ orderBy }) => orderBy !== undefined),
      ).toEqual([])
    }

    const refinedOffset = scenario.offset === 0 ? 1 : 0
    const refinedLimit = scenario.limit === 0 ? 1 : scenario.limit + 1
    const refinedProjection = projectMultiSourceOrderedWindow({
      primaryOrder: primaryOrder.map(({ id, joinKey }) => ({
        key: id,
        joinKey,
      })),
      secondaryRows: scenario.secondaryRows.map(({ id, joinKey }) => ({
        key: id,
        joinKey,
      })),
      offset: refinedOffset,
      limit: refinedLimit,
    })
    await live.utils.setWindow({
      offset: refinedOffset,
      limit: refinedLimit,
    })
    await flushPromises()
    expect(
      live.toArray.map(
        ({ primaryRow, secondaryRow }) => `${primaryRow.id}:${secondaryRow.id}`,
      ),
    ).toEqual(refinedProjection.visiblePairKeys)
    if (scenario.limit === 0) {
      const refinementCalls = primaryCalls
        .slice(initialPrimaryCallCount)
        .filter(({ orderBy }) => orderBy !== undefined)
      expect(refinementCalls.length).toBeGreaterThan(0)
      if (scenario.primaryAutoIndex === `off`) {
        expect(refinementCalls).toHaveLength(1)
        expect(refinementCalls[0]?.limit).toBeUndefined()
      }
    }

    const primaryCallsBeforeZeroShrink = primaryCalls.length
    await live.utils.setWindow({ offset: 2, limit: 0 })
    await flushPromises()
    expect(live.toArray).toEqual([])
    expect(
      primaryCalls
        .slice(primaryCallsBeforeZeroShrink)
        .filter(({ orderBy }) => orderBy !== undefined),
    ).toEqual([])

    if (scenario.limit > 0) {
      expect(primaryCalls.some(({ orderBy }) => orderBy !== undefined)).toBe(
        true,
      )
      expect(secondaryCalls.length).toBeGreaterThan(0)
    }

    expect(primaryCallProgress).toHaveLength(primaryCalls.length)
    const previousProgressByDemand = new Map<
      string,
      (typeof primaryCallProgress)[number]
    >()
    for (const progress of primaryCallProgress) {
      const previous = previousProgressByDemand.get(progress.demandKey)
      if (previous) {
        expect(
          progress.establishedPrimaryCount > previous.establishedPrimaryCount ||
            progress.establishedSecondaryCount >
              previous.establishedSecondaryCount,
        ).toBe(true)
      }
      previousProgressByDemand.set(progress.demandKey, progress)
    }
    const claimedPrimaryKeys = primaryReceipts.flat()
    expect(new Set(claimedPrimaryKeys).size).toBe(claimedPrimaryKeys.length)
    expect([...claimedPrimaryKeys].sort()).toEqual(
      [...primaryKeysEstablishedByLoads].sort(),
    )
    expect(
      claimedPrimaryKeys.every((key) =>
        scenario.primaryRows.some(({ id }) => id === key),
      ),
    ).toBe(true)

    const claimedSecondaryKeys = secondaryReceipts.flat()
    expect(new Set(claimedSecondaryKeys).size).toBe(claimedSecondaryKeys.length)
    const expectedClaimedSecondaryKeys = hasPreloadedSecondary(scenario)
      ? []
      : scenario.secondaryRows
          .filter((row) =>
            secondaryCalls.some(
              ({ where }) =>
                where === undefined || evaluateReferenceExpression(where, row),
            ),
          )
          .map(({ id }) => id)
          .sort()
    expect([...claimedSecondaryKeys].sort()).toEqual(
      expectedClaimedSecondaryKeys,
    )
    expect(
      secondaryLoadCommitSizes.every(
        (commitSize) => commitSize <= scenario.secondaryPageSize,
      ),
    ).toBe(true)

    const primaryJoinKeys = new Set(
      scenario.primaryRows.map(({ joinKey }) => joinKey),
    )
    const joinCalls = secondaryCalls.filter(({ where }) => where !== undefined)
    if (
      hasPreloadedSecondary(scenario) &&
      scenario.secondaryRows.length > 0 &&
      scenario.limit > 0
    ) {
      expect(joinCalls.length).toBeGreaterThan(0)
    }
    if (scenario.secondaryPublication === `preloaded-delayed-receipt`) {
      expect(delayedSecondaryReceiptCompletionOrder).toEqual(
        delayedSecondaryReceiptWaiters.map(({ index }) => index).reverse(),
      )
    }
    if (joinCalls.length > 0) {
      const requestedJoinKeys = new Set(
        joinCalls.flatMap(({ where }) =>
          [...primaryJoinKeys].filter((joinKey) =>
            evaluateReferenceExpression(where!, {
              id: `probe-${joinKey}`,
              joinKey,
            }),
          ),
        ),
      )
      const literalJoinKeys = joinCalls.flatMap(({ where }) =>
        collectStringLiterals(where!),
      )
      expect(
        literalJoinKeys.every((joinKey) => primaryJoinKeys.has(joinKey)),
      ).toBe(true)
      for (const joinKey of projection.demandedJoinKeys) {
        expect(requestedJoinKeys.has(joinKey)).toBe(true)
      }
      expect(
        [...requestedJoinKeys].every((joinKey) => primaryJoinKeys.has(joinKey)),
      ).toBe(true)
    }

    if (scenario.secondaryPublication === `after-primary-continuation`) {
      if (scenario.limit > 0) {
        if (scenario.primaryAutoIndex === `eager`) {
          expect(primaryOrderedCallCountAtSecondaryRelease).toBe(2)
          expect(primaryCommittedKeysAtSecondaryRelease).toEqual(
            expect.arrayContaining(primaryOrderedVisitedKeys.slice(0, 2)),
          )
          expect(primaryKeysBeforeSecondaryPublication?.length).toBe(2)
        } else {
          expect(primaryOrderedCallCountAtSecondaryRelease).toBe(1)
          expect(primaryCommittedKeysAtSecondaryRelease).toEqual(
            expect.arrayContaining(primaryOrder.map(({ id }) => id)),
          )
          expect(primaryKeysBeforeSecondaryPublication).toEqual(
            primaryOrder.map(({ id }) => id),
          )
        }
      }
    }
    if (scenario.secondaryPublication === `after-primary-exhaustion`) {
      if (scenario.limit > 0) {
        expect(primaryKeysAtSecondaryRelease).toEqual(
          primaryOrder.map(({ id }) => id),
        )
        expect(primaryKeysBeforeSecondaryPublication).toEqual(
          primaryOrder.map(({ id }) => id),
        )
      }
    }
  } finally {
    for (const waiter of delayedSecondaryReceiptWaiters) waiter.gate.resolve()
    await Promise.all([live.cleanup(), primary.cleanup(), secondary.cleanup()])
  }
}

const orderedPrimaryFixture = [
  { id: `a`, rank: 1, joinKey: `a` },
  { id: `b`, rank: 2, joinKey: `b` },
  { id: `c`, rank: 3, joinKey: `c` },
  { id: `d`, rank: 4, joinKey: `d` },
]

it.each([
  {
    name: `preloaded rejection continuation`,
    secondaryRows: [
      { id: `c-0`, joinKey: `c` },
      { id: `d-0`, joinKey: `d` },
    ],
    offset: 0,
    limit: 2,
    secondaryPublication: `preloaded` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `insertion` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `late secondary after continuation`,
    secondaryRows: [
      { id: `b-0`, joinKey: `b` },
      { id: `a-0`, joinKey: `a` },
    ],
    offset: 0,
    limit: 2,
    secondaryPublication: `after-primary-continuation` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `reverse` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `delayed filtered secondary receipt`,
    secondaryRows: [
      { id: `c-0`, joinKey: `c` },
      { id: `d-0`, joinKey: `d` },
    ],
    offset: 0,
    limit: 2,
    secondaryPublication: `preloaded-delayed-receipt` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `reverse` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `late secondary after primary exhaustion`,
    secondaryRows: [{ id: `d-0`, joinKey: `d` }],
    offset: 0,
    limit: 2,
    secondaryPublication: `after-primary-exhaustion` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `insertion` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `joined multiplicity before offset`,
    secondaryRows: [
      { id: `a-1`, joinKey: `a` },
      { id: `a-0`, joinKey: `a` },
    ],
    offset: 1,
    limit: 1,
    secondaryPublication: `preloaded` as const,
    secondaryPageSize: 2 as const,
    secondaryCommitOrder: `insertion` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `indexed zero-limit window`,
    secondaryRows: [{ id: `a-0`, joinKey: `a` }],
    offset: 2,
    limit: 0,
    secondaryPublication: `preloaded` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `insertion` as const,
    primaryAutoIndex: `eager` as const,
  },
  {
    name: `unindexed zero-limit window`,
    secondaryRows: [{ id: `a-0`, joinKey: `a` }],
    offset: 2,
    limit: 0,
    secondaryPublication: `preloaded` as const,
    secondaryPageSize: 1 as const,
    secondaryCommitOrder: `insertion` as const,
    primaryAutoIndex: `off` as const,
  },
] satisfies ReadonlyArray<
  Pick<
    MultiSourceOrderedScenario,
    | `secondaryRows`
    | `offset`
    | `limit`
    | `secondaryPublication`
    | `secondaryPageSize`
    | `secondaryCommitOrder`
    | `primaryAutoIndex`
  > & { name: string }
>)(`$name`, async ({ name: _name, ...scenario }) => {
  await runMultiSourceOrderedScenario({
    ...scenario,
    primaryRows: orderedPrimaryFixture,
    direction: `asc`,
  })
})

it.each([`sync throw`, `async reject`] as const)(
  `retries unindexed transport after a %s during zero-to-positive refinement`,
  async (failureMode) => {
    type Row = { id: string; rank: number }
    let attempts = 0
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => true | Promise<void>
    const source = createCollection<Row>({
      id: `unindexed-zero-refinement-retry`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `off`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          params.markReady()
          return {
            loadSubset: () => {
              attempts++
              if (attempts === 1) {
                const error = new Error(`fallback failed`)
                if (failureMode === `sync throw`) throw error
                return Promise.reject(error)
              }
              begin()
              write({ type: `insert`, value: { id: `a`, rank: 1 } })
              const applied = commit()
              const outcome = { hasMore: false, appliedRowKeys: [`a`] }
              return applied === true
                ? Promise.resolve(outcome)
                : applied.then(() => outcome)
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `unindexed-zero-refinement-retry-live`,
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(0),
      startSync: true,
    })

    try {
      await live.preload()
      expect(attempts).toBe(0)

      if (failureMode === `sync throw`) {
        expect(() => live.utils.setWindow({ offset: 0, limit: 1 })).toThrow(
          `fallback failed`,
        )
      } else {
        await expect(
          live.utils.setWindow({ offset: 0, limit: 1 }),
        ).rejects.toThrow(`fallback failed`)
      }
      await flushPromises()
      await live.utils.setWindow({ offset: 0, limit: 1 })
      await flushPromises()

      expect(attempts).toBe(2)
      expect(live.toArray.map(({ id }) => id)).toEqual([`a`])
    } finally {
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  },
)

it(`publishes once after a loader fills an indexed window across graph turns`, async () => {
  type Row = { id: string; rank: number }
  type ObservedChange = {
    type: `insert` | `update` | `delete`
    key: string
    value: Row
  }
  const remoteRows: ReadonlyArray<Row> = [
    { id: `a`, rank: 1 },
    { id: `b`, rank: 2 },
  ]
  const batches: Array<ReadonlyArray<ObservedChange>> = []
  const callbackReads: Array<ReadonlyArray<Row>> = []
  let loads = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `indexed-loader-quiescent-publication`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: () => {
            const row = remoteRows[loads++]
            if (!row) return true
            begin()
            write({ type: `insert`, value: row })
            const applied = commit()
            if (applied !== true) {
              throw new Error(`Expected synchronous source application`)
            }
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `indexed-loader-quiescent-publication-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(0),
    startSync: true,
  })
  const readRows = () => live.toArray.map(({ id, rank }) => ({ id, rank }))
  let subscription: ReturnType<typeof live.subscribeChanges> | undefined

  try {
    await live.preload()
    subscription = live.subscribeChanges(
      (changes) => {
        batches.push(
          changes
            .map<ObservedChange>(({ type, key, value }) => ({
              type,
              key: String(key),
              value: { id: value.id, rank: value.rank },
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        )
        callbackReads.push(readRows())
      },
      { includeInitialState: false },
    )
    await live.utils.setWindow({ offset: 0, limit: 2 })
    await flushPromises()

    expect(loads).toBe(2)
    expect(readRows()).toEqual([
      { id: `a`, rank: 1 },
      { id: `b`, rank: 2 },
    ])
    expect(batches).toEqual([
      [
        { type: `insert`, key: `a`, value: { id: `a`, rank: 1 } },
        { type: `insert`, key: `b`, value: { id: `b`, rank: 2 } },
      ],
    ])
    expect(callbackReads).toEqual([
      [
        { id: `a`, rank: 1 },
        { id: `b`, rank: 2 },
      ],
    ])
  } finally {
    subscription?.unsubscribe()
    await Promise.all([live.cleanup(), source.cleanup()])
  }
})

it(`fences an unindexed fallback settlement from a cleaned query session`, async () => {
  type Row = { id: string; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<string>
  }
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `unindexed-fallback-session-fence`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: () => {
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `unindexed-fallback-session-fence-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(0),
    startSync: true,
  })
  let failedWindow: true | Promise<void> | undefined
  let firstWindow: true | Promise<void> | undefined
  let secondWindow: true | Promise<void> | undefined
  let repeatedWindow: true | Promise<void> | undefined

  try {
    await live.preload()
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(false)

    const visibleFailure = new Error(`visible fallback failed`)
    failedWindow = live.utils.setWindow({ offset: 0, limit: 1 })
    expect(pending).toHaveLength(1)
    expect(live.isLoadingSubset).toBe(true)
    pending[0]!.reject(visibleFailure)
    await expect(Promise.resolve(failedWindow)).rejects.toBe(visibleFailure)
    await flushPromises()
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(false)
    expect(live.utils.lastSubsetError).toBe(visibleFailure)

    firstWindow = live.utils.setWindow({ offset: 0, limit: 1 })
    void Promise.resolve(firstWindow).catch(() => {})
    expect(pending).toHaveLength(2)
    expect(live.isLoadingSubset).toBe(true)

    await live.cleanup()
    await live.preload()
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(false)
    expect(live.utils.lastSubsetError).toBeUndefined()
    secondWindow = live.utils.setWindow({ offset: 0, limit: 1 })
    expect(pending).toHaveLength(3)
    expect(live.isLoadingSubset).toBe(true)

    pending[1]!.reject(new Error(`stale fallback failed`))
    await flushPromises()
    expect(live.utils.lastSubsetError).toBeUndefined()
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(true)
    repeatedWindow = live.utils.setWindow({ offset: 0, limit: 2 })
    void Promise.resolve(repeatedWindow).catch(() => {})
    expect(pending).toHaveLength(3)

    begin()
    write({ type: `insert`, value: { id: `a`, rank: 1 } })
    const applied = commit()
    if (applied !== true) await applied
    pending[2]!.resolve({ hasMore: false, appliedRowKeys: [`a`] })
    await Promise.all([secondWindow, repeatedWindow])
    await flushPromises()

    expect(pending).toHaveLength(3)
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(false)
    expect(live.utils.lastSubsetError).toBeUndefined()
    expect(live.toArray.map(({ id }) => id)).toEqual([`a`])
  } finally {
    for (const request of pending) {
      request.reject(new Error(`test cleanup`))
    }
    await Promise.all([
      Promise.resolve(failedWindow).catch(() => undefined),
      Promise.resolve(firstWindow).catch(() => undefined),
      Promise.resolve(secondWindow).catch(() => undefined),
      Promise.resolve(repeatedWindow).catch(() => undefined),
      live.cleanup(),
      source.cleanup(),
    ])
  }
})

it(`keeps an initial unindexed load scoped to its query session`, async () => {
  type Row = { id: string; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<string>
  }
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `unindexed-initial-session-fence`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: () => {
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `unindexed-initial-session-fence-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    startSync: true,
  })
  let firstPreload: Promise<void> | undefined
  let secondPreload: Promise<void> | undefined

  try {
    firstPreload = live.preload()
    void firstPreload.catch(() => {})
    expect(pending).toHaveLength(1)
    expect(live.status).toBe(`loading`)
    expect(live.isLoadingSubset).toBe(true)

    await live.cleanup()
    secondPreload = live.preload()
    expect(pending).toHaveLength(2)
    expect(live.status).toBe(`loading`)
    expect(live.isLoadingSubset).toBe(true)
    expect(live.utils.lastSubsetError).toBeUndefined()

    pending[0]!.reject(new Error(`stale initial fallback failed`))
    await flushPromises()
    expect(live.status).toBe(`loading`)
    expect(live.isLoadingSubset).toBe(true)
    expect(live.utils.lastSubsetError).toBeUndefined()

    begin()
    write({ type: `insert`, value: { id: `a`, rank: 1 } })
    const applied = commit()
    if (applied !== true) await applied
    pending[1]!.resolve({ hasMore: false, appliedRowKeys: [`a`] })
    await secondPreload
    await flushPromises()

    expect(pending).toHaveLength(2)
    expect(live.status).toBe(`ready`)
    expect(live.isLoadingSubset).toBe(false)
    expect(live.utils.lastSubsetError).toBeUndefined()
    expect(live.toArray.map(({ id }) => id)).toEqual([`a`])
  } finally {
    for (const request of pending) {
      request.reject(new Error(`test cleanup`))
    }
    await Promise.all([
      firstPreload?.catch(() => undefined),
      secondPreload?.catch(() => undefined),
      live.cleanup(),
      source.cleanup(),
    ])
  }
})

it(`replays one unindexed fallback and publishes one replacement after truncate`, async () => {
  type Row = { id: string; rank: number }
  type ObservedChange = {
    type: `insert` | `update` | `delete`
    key: string
    value: Row
  }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<string>
  }
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const batches: Array<ReadonlyArray<ObservedChange>> = []
  const callbackReads: Array<ReadonlyArray<Row>> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<Row>({
    id: `unindexed-fallback-truncate-replay`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: () => {
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `unindexed-fallback-truncate-replay-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    startSync: true,
  })
  const readRows = () => live.toArray.map(({ id, rank }) => ({ id, rank }))
  const subscription = live.subscribeChanges(
    (changes) => {
      batches.push(
        changes
          .map<ObservedChange>(({ type, key, value }) => ({
            type,
            key: String(key),
            value: { id: value.id, rank: value.rank },
          }))
          .sort((left, right) => left.key.localeCompare(right.key)),
      )
      callbackReads.push(readRows())
    },
    { includeInitialState: false },
  )
  const preload = live.preload()

  try {
    expect(pending).toHaveLength(1)
    begin()
    write({ type: `insert`, value: { id: `a`, rank: 1 } })
    const initialApplied = commit()
    if (initialApplied !== true) await initialApplied
    pending[0]!.resolve({ hasMore: false, appliedRowKeys: [`a`] })
    await preload
    await flushPromises()
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])

    batches.length = 0
    callbackReads.length = 0
    begin()
    truncate()
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)
    const replacement = commit()
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)
    await flushPromises()
    expect(pending).toHaveLength(2)
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)

    begin()
    write({ type: `insert`, value: { id: `b`, rank: 2 } })
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)
    const replacementApplied = commit()
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)
    if (replacementApplied !== true) await replacementApplied
    expect(readRows()).toEqual([{ id: `a`, rank: 1 }])
    expect(batches).toHaveLength(0)
    expect(callbackReads).toHaveLength(0)
    pending[1]!.resolve({ hasMore: false, appliedRowKeys: [`b`] })
    if (replacement !== true) await replacement
    await flushPromises()

    expect(pending).toHaveLength(2)
    expect(readRows()).toEqual([{ id: `b`, rank: 2 }])
    expect(batches).toEqual([
      [
        { type: `delete`, key: `a`, value: { id: `a`, rank: 1 } },
        { type: `insert`, key: `b`, value: { id: `b`, rank: 2 } },
      ],
    ])
    expect(callbackReads).toEqual([[{ id: `b`, rank: 2 }]])
  } finally {
    for (const request of pending) {
      request.reject(new Error(`test cleanup`))
    }
    subscription.unsubscribe()
    await Promise.all([
      preload.catch(() => undefined),
      live.cleanup(),
      source.cleanup(),
    ])
  }
})

type UnindexedReplayRow = { id: string; rank: number }
type UnindexedReplayResult = {
  hasMore: boolean
  appliedRowKeys: ReadonlyArray<string>
}
type UnindexedReplayObservedChange = {
  type: `insert` | `update` | `delete`
  key: string
  value: UnindexedReplayRow
}

function createUnindexedReplayHarness(id: string) {
  const pending: Array<{
    options: LoadSubsetOptions
    request?: ReturnType<typeof createDeferred<UnindexedReplayResult>>
  }> = []
  const loadResults: Array<true | Promise<UnindexedReplayResult>> = []
  const unloads: Array<LoadSubsetOptions> = []
  const synchronousLoads = new Map<number, ReadonlyArray<UnindexedReplayRow>>()
  const batches: Array<ReadonlyArray<UnindexedReplayObservedChange>> = []
  const callbackReads: Array<ReadonlyArray<UnindexedReplayRow>> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: UnindexedReplayRow }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<UnindexedReplayRow>({
    id: `${id}-source`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `off`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            const loadIndex = pending.length
            const synchronousRows = synchronousLoads.get(loadIndex)
            if (synchronousRows) {
              pending.push({ options })
              begin()
              for (const row of synchronousRows) {
                write({ type: `insert`, value: row })
              }
              commit()
              const result = true as const
              loadResults.push(result)
              return result
            }
            const request = createDeferred<UnindexedReplayResult>()
            pending.push({ options, request })
            const result = request.promise
            loadResults.push(result)
            return result
          },
          unloadSubset: (options) => {
            unloads.push(options)
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `${id}-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    startSync: true,
  })
  const readRows = () =>
    live.toArray.map(({ id: rowId, rank }) => ({ id: rowId, rank }))
  let observer: ReturnType<typeof live.subscribeChanges> | undefined
  const startObserving = () => {
    observer = live.subscribeChanges(
      (changes) => {
        batches.push(
          changes
            .map<UnindexedReplayObservedChange>(({ type, key, value }) => ({
              type,
              key: String(key),
              value: { id: value.id, rank: value.rank },
            }))
            .sort((left, right) => left.key.localeCompare(right.key)),
        )
        callbackReads.push(readRows())
      },
      { includeInitialState: false },
    )
  }
  const stopObserving = () => {
    observer?.unsubscribe()
    observer = undefined
  }
  const clearObservations = () => {
    batches.length = 0
    callbackReads.length = 0
  }
  const applyRows = async (rows: ReadonlyArray<UnindexedReplayRow>) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const receipt = commit()
    if (receipt !== true) await receipt
  }
  const startTruncate = () => {
    begin()
    truncate()
    return commit()
  }
  const cleanup = async () => {
    for (const { request } of pending) {
      request?.reject(new Error(`test cleanup`))
    }
    stopObserving()
    await Promise.all([live.cleanup(), source.cleanup()])
  }

  startObserving()
  return {
    source,
    live,
    pending,
    loadResults,
    unloads,
    synchronousLoads,
    batches,
    callbackReads,
    readRows,
    startObserving,
    stopObserving,
    clearObservations,
    applyRows,
    startTruncate,
    cleanup,
  }
}

function expectUnindexedFullSnapshotRequest(options: LoadSubsetOptions): void {
  expect(Object.keys(options).sort()).toEqual([
    `cursor`,
    `limit`,
    `orderBy`,
    `signal`,
    `subscription`,
    `where`,
  ])
  expect(options.where).toBeUndefined()
  expect(options.limit).toBeUndefined()
  expect(options.offset).toBeUndefined()
  expect(options.cursor).toBeUndefined()
  expect(options.orderBy).toHaveLength(1)
  const ordering = options.orderBy![0]!
  expect(Object.keys(ordering).sort()).toEqual([`compareOptions`, `expression`])
  expect(Object.keys(ordering.expression).sort()).toEqual([`path`, `type`])
  expect(ordering.expression).toEqual({ type: `ref`, path: [`rank`] })
  expect(ordering.compareOptions).toStrictEqual({
    direction: `asc`,
    nulls: `first`,
    stringSort: `locale`,
  })
  expect(options.signal).toBeInstanceOf(AbortSignal)
  expect(options.subscription).toBeDefined()
}

function acquisitionIndices(
  acquisitions: ReadonlyArray<{ options: LoadSubsetOptions }>,
  releases: ReadonlyArray<LoadSubsetOptions>,
): ReadonlyArray<number> {
  return releases.map((options) =>
    acquisitions.findIndex((acquisition) => acquisition.options === options),
  )
}

it.each([`async`, `sync`] as const)(
  `retries one unindexed fallback after a rejected truncate replay with %s success`,
  async (successMode) => {
    const harness = createUnindexedReplayHarness(
      `unindexed-rejected-truncate-retry-${successMode}`,
    )
    const preload = harness.live.preload()
    let cleaned = false

    try {
      expect(harness.pending).toHaveLength(1)
      await harness.applyRows([{ id: `a`, rank: 1 }])
      harness.pending[0]!.request!.resolve({
        hasMore: false,
        appliedRowKeys: [`a`],
      })
      await preload
      await flushPromises()
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([{ id: `a`, rank: 1 }])

      harness.clearObservations()
      const replayFailure = new Error(`truncate replay failed`)
      const failedReplacement = harness.startTruncate()
      await flushPromises()
      expect(harness.pending).toHaveLength(2)
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(true)
      harness.pending[1]!.request!.reject(replayFailure)
      await Promise.resolve(failedReplacement).catch(() => undefined)
      await flushPromises()

      expect(harness.pending).toHaveLength(2)
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBe(replayFailure)
      expect(harness.readRows()).toEqual([{ id: `a`, rank: 1 }])
      expect(harness.batches).toEqual([])
      expect(harness.callbackReads).toEqual([])

      if (successMode === `sync`) {
        harness.synchronousLoads.set(2, [{ id: `b`, rank: 2 }])
      }
      const successfulReplacement = harness.startTruncate()
      await flushPromises()
      expect(harness.pending).toHaveLength(3)
      expect(harness.live.isLoadingSubset).toBe(successMode === `async`)
      expect(harness.live.utils.lastSubsetError).toBe(replayFailure)
      if (successMode === `async`) {
        expect(harness.readRows()).toEqual([{ id: `a`, rank: 1 }])
        expect(harness.batches).toEqual([])
        await harness.applyRows([{ id: `b`, rank: 2 }])
        harness.pending[2]!.request!.resolve({
          hasMore: false,
          appliedRowKeys: [`b`],
        })
      } else {
        expect(harness.readRows()).toEqual([{ id: `b`, rank: 2 }])
        expect(harness.batches).toEqual([
          [
            { type: `delete`, key: `a`, value: { id: `a`, rank: 1 } },
            { type: `insert`, key: `b`, value: { id: `b`, rank: 2 } },
          ],
        ])
      }
      if (successfulReplacement !== true) await successfulReplacement
      await flushPromises()

      expect(harness.pending).toHaveLength(3)
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBe(replayFailure)
      expect(harness.readRows()).toEqual([{ id: `b`, rank: 2 }])
      expect(harness.batches).toEqual([
        [
          { type: `delete`, key: `a`, value: { id: `a`, rank: 1 } },
          { type: `insert`, key: `b`, value: { id: `b`, rank: 2 } },
        ],
      ])
      expect(harness.callbackReads).toEqual([[{ id: `b`, rank: 2 }]])

      for (const { options } of harness.pending) {
        expectUnindexedFullSnapshotRequest(options)
      }
      expect(
        harness.loadResults.map((result) =>
          result === true ? `sync` : `async`,
        ),
      ).toEqual([`async`, `async`, successMode === `sync` ? `sync` : `async`])
      const signals = harness.pending.map(({ options }) => options.signal!)
      expect(new Set(signals)).toHaveLength(3)
      expect(signals.map(({ aborted }) => aborted)).toEqual([true, true, false])
      expect(
        new Set(harness.pending.map(({ options }) => options.subscription)),
      ).toHaveLength(1)
      expect(harness.unloads).toHaveLength(2)
      expect(acquisitionIndices(harness.pending, harness.unloads)).toEqual([
        1, 0,
      ])

      await harness.cleanup()
      cleaned = true
      expect(harness.live.status).toBe(`cleaned-up`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBe(replayFailure)
      expect(harness.readRows()).toEqual([])
      expect(signals.map(({ aborted }) => aborted)).toEqual([true, true, true])
      expect(harness.unloads).toHaveLength(3)
      expect(acquisitionIndices(harness.pending, harness.unloads)).toEqual([
        1, 0, 2,
      ])
    } finally {
      await Promise.all([
        preload.catch(() => undefined),
        cleaned ? Promise.resolve() : harness.cleanup(),
      ])
    }
  },
)

it.each([`resolve`, `reject`] as const)(
  `fences a %s settlement from a truncate replay cleaned before completion`,
  async (lateSettlement) => {
    const harness = createUnindexedReplayHarness(
      `unindexed-pending-replay-cleanup-${lateSettlement}`,
    )
    const firstPreload = harness.live.preload()
    let restartPreload: Promise<void> | undefined
    let replacement: true | Promise<void> | undefined
    let cleaned = false

    try {
      expect(harness.pending).toHaveLength(1)
      await harness.applyRows([{ id: `a`, rank: 1 }])
      harness.pending[0]!.request!.resolve({
        hasMore: false,
        appliedRowKeys: [`a`],
      })
      await firstPreload
      await flushPromises()
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([{ id: `a`, rank: 1 }])

      harness.clearObservations()
      replacement = harness.startTruncate()
      void Promise.resolve(replacement).catch(() => {})
      await flushPromises()
      expect(harness.pending).toHaveLength(2)
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(true)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([{ id: `a`, rank: 1 }])
      expect(harness.batches).toEqual([])
      expect(harness.callbackReads).toEqual([])

      const firstSessionSubscription = harness.pending[0]!.options.subscription
      harness.stopObserving()
      await harness.live.cleanup()
      expect(harness.live.status).toBe(`cleaned-up`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([])
      expect(harness.batches).toEqual([])
      expect(harness.callbackReads).toEqual([])
      expect(harness.unloads).toHaveLength(2)
      expect(acquisitionIndices(harness.pending, harness.unloads)).toEqual([
        1, 0,
      ])

      restartPreload = harness.live.preload()
      harness.startObserving()
      await flushPromises()
      expect(harness.pending).toHaveLength(3)
      expect(harness.live.status).toBe(`loading`)
      expect(harness.live.isLoadingSubset).toBe(true)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([])

      const staleError = new Error(`stale replay failed`)
      if (lateSettlement === `resolve`) {
        harness.pending[1]!.request!.resolve({
          hasMore: false,
          appliedRowKeys: [],
        })
      } else {
        harness.pending[1]!.request!.reject(staleError)
      }
      await Promise.resolve(replacement).catch(() => undefined)
      await flushPromises()
      expect(harness.pending).toHaveLength(3)
      expect(harness.live.status).toBe(`loading`)
      expect(harness.live.isLoadingSubset).toBe(true)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([])
      expect(harness.batches).toEqual([])
      expect(harness.callbackReads).toEqual([])

      await harness.applyRows([{ id: `c`, rank: 3 }])
      expect(harness.readRows()).toEqual([{ id: `c`, rank: 3 }])
      expect(harness.batches).toEqual([
        [{ type: `insert`, key: `c`, value: { id: `c`, rank: 3 } }],
      ])
      expect(harness.callbackReads).toEqual([[{ id: `c`, rank: 3 }]])
      const appliedStateRevision = harness.live._stateRevision
      const appliedLayoutRevision = harness.live._layoutRevision
      harness.pending[2]!.request!.resolve({
        hasMore: false,
        appliedRowKeys: [`c`],
      })
      await restartPreload
      await flushPromises()

      expect(harness.pending).toHaveLength(3)
      expect(harness.live.status).toBe(`ready`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([{ id: `c`, rank: 3 }])
      expect(harness.batches).toEqual([
        [{ type: `insert`, key: `c`, value: { id: `c`, rank: 3 } }],
        [],
      ])
      expect(harness.callbackReads).toEqual([
        [{ id: `c`, rank: 3 }],
        [{ id: `c`, rank: 3 }],
      ])
      expect(harness.live._stateRevision).toBe(appliedStateRevision)
      expect(harness.live._layoutRevision).toBe(appliedLayoutRevision)

      for (const { options } of harness.pending) {
        expectUnindexedFullSnapshotRequest(options)
      }
      const signals = harness.pending.map(({ options }) => options.signal!)
      expect(new Set(signals)).toHaveLength(3)
      expect(signals.map(({ aborted }) => aborted)).toEqual([true, true, false])
      expect(harness.pending[1]!.options.subscription).toBe(
        firstSessionSubscription,
      )
      expect(harness.pending[2]!.options.subscription).not.toBe(
        firstSessionSubscription,
      )
      expect(harness.loadResults.every((result) => result !== true)).toBe(true)

      await harness.cleanup()
      cleaned = true
      expect(harness.live.status).toBe(`cleaned-up`)
      expect(harness.live.isLoadingSubset).toBe(false)
      expect(harness.live.utils.lastSubsetError).toBeUndefined()
      expect(harness.readRows()).toEqual([])
      expect(signals.map(({ aborted }) => aborted)).toEqual([true, true, true])
      expect(harness.unloads).toHaveLength(3)
      expect(acquisitionIndices(harness.pending, harness.unloads)).toEqual([
        1, 0, 2,
      ])
    } finally {
      await Promise.all([
        firstPreload.catch(() => undefined),
        restartPreload?.catch(() => undefined),
        cleaned ? Promise.resolve() : harness.cleanup(),
      ])
    }
  },
)

it.each([`eager`, `off`] as const)(
  `keeps an Effect zero-limit join free of ordered transport work with autoIndex %s`,
  async (autoIndex) => {
    type PrimaryRow = { id: string; rank: number; joinKey: string }
    type SecondaryRow = { id: string; joinKey: string }
    const primaryLoads: Array<LoadSubsetOptions> = []
    const primary = createCollection<PrimaryRow>({
      id: `multi-source-zero-limit-effect-primary-${autoIndex}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              primaryLoads.push(options)
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const secondary = createCollection<SecondaryRow>({
      id: `multi-source-zero-limit-effect-secondary-${autoIndex}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ markReady }) => {
          markReady()
          return {
            loadSubset: () => true,
            unloadSubset: () => {},
          }
        },
      },
    })
    const effect = createEffect({
      query: (q) =>
        q
          .from({ primaryRow: primary })
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .offset(2)
          .limit(0),
      onBatch: () => {},
    })

    try {
      await flushPromises()
      expect(primaryLoads).toEqual([])
    } finally {
      await effect.dispose()
      await Promise.all([primary.cleanup(), secondary.cleanup()])
    }
  },
)

it(`settles concurrent secondary loads out of order across paged commits`, async () => {
  type PrimaryRow = { id: string; rank: number; joinKey: string }
  type SecondaryRow = { id: string; joinKey: string }
  type PendingSecondaryLoad = {
    requestIndex: number
    options: LoadSubsetOptions
    gate: ReturnType<typeof createDeferred<void>>
    joinKeys: ReadonlyArray<string>
  }

  const primaryOptions = mockSyncCollectionOptions<PrimaryRow>({
    id: `multi-source-filtered-primary`,
    initialData: [
      { id: `a`, rank: 1, joinKey: `a` },
      { id: `b`, rank: 2, joinKey: `b` },
    ],
    getKey: (row) => row.id,
    syncMode: `eager`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
  })
  const primary = createCollection(primaryOptions)
  const secondaryRows = [
    { id: `a-1`, joinKey: `a` },
    { id: `a-0`, joinKey: `a` },
    { id: `b-1`, joinKey: `b` },
    { id: `b-0`, joinKey: `b` },
    { id: `c-0`, joinKey: `c` },
  ]
  const pendingSecondaryLoads: Array<PendingSecondaryLoad> = []
  const secondaryCompletionOrder: Array<number> = []
  const secondaryReceipts: Array<{
    requestIndex: number
    appliedRowKeys: ReadonlyArray<string>
  }> = []
  const secondaryLoadCommitSizes: Array<number> = []
  let secondaryBegin!: () => void
  let secondaryWrite!: (message: {
    type: `insert`
    value: SecondaryRow
  }) => void
  let secondaryCommit!: () => true | Promise<void>
  const establishedSecondaryKeys = new Set<string>()
  const secondary = createCollection<SecondaryRow>({
    id: `multi-source-filtered-secondary`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        secondaryBegin = params.begin
        secondaryWrite = params.write
        secondaryCommit = params.commit
        secondaryBegin()
        secondaryWrite({
          type: `insert`,
          value: { id: `unrelated`, joinKey: `unrelated` },
        })
        establishedSecondaryKeys.add(`unrelated`)
        const seeded = secondaryCommit()
        if (seeded !== true) {
          throw new Error(`Expected synchronous secondary seed`)
        }
        params.markReady()
        return {
          loadSubset: async (options) => {
            const matchingRows = secondaryRows.filter(
              (row) =>
                options.where === undefined ||
                evaluateReferenceExpression(options.where, row),
            )
            const joinKeys = [
              ...new Set(matchingRows.map(({ joinKey }) => joinKey)),
            ]
            const pending = {
              requestIndex: pendingSecondaryLoads.length,
              options,
              gate: createDeferred<void>(),
              joinKeys,
            }
            pendingSecondaryLoads.push(pending)
            await pending.gate.promise

            const appliedRowKeys: Array<string> = []
            for (const row of [...matchingRows].reverse()) {
              if (establishedSecondaryKeys.has(row.id)) continue
              establishedSecondaryKeys.add(row.id)
              secondaryLoadCommitSizes.push(1)
              secondaryBegin()
              secondaryWrite({ type: `insert`, value: row })
              const applied = secondaryCommit()
              if (applied !== true) await applied
              appliedRowKeys.push(row.id)
            }
            secondaryCompletionOrder.push(pending.requestIndex)
            secondaryReceipts.push({
              requestIndex: pending.requestIndex,
              appliedRowKeys,
            })
            return { hasMore: false, appliedRowKeys }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const createFilteredLive = (id: string, primaryId: string) =>
    createLiveQueryCollection({
      id,
      query: (q) =>
        q
          .from({ primaryRow: primary })
          .where(({ primaryRow }) => eq(primaryRow.id, primaryId))
          .innerJoin(
            { secondaryRow: secondary },
            ({ primaryRow, secondaryRow }) =>
              eq(primaryRow.joinKey, secondaryRow.joinKey),
          )
          .orderBy(({ primaryRow }) => primaryRow.rank)
          .limit(2),
      startSync: true,
    })
  const liveA = createFilteredLive(`multi-source-filtered-live-a`, `a`)
  const liveB = createFilteredLive(`multi-source-filtered-live-b`, `b`)

  try {
    const preload = Promise.all([liveA.preload(), liveB.preload()])
    await flushPromises()
    expect(pendingSecondaryLoads).toHaveLength(2)
    expect(pendingSecondaryLoads.every(({ options }) => !options.where)).toBe(
      true,
    )
    expect(pendingSecondaryLoads.map(({ joinKeys }) => joinKeys)).toEqual([
      [`a`, `b`, `c`],
      [`a`, `b`, `c`],
    ])

    pendingSecondaryLoads[1]!.gate.resolve()
    await flushPromises()
    pendingSecondaryLoads[0]!.gate.resolve()
    await preload
    await flushPromises()

    expect(secondaryCompletionOrder).toEqual([1, 0])
    expect(secondaryLoadCommitSizes).toEqual([1, 1, 1, 1, 1])
    expect(secondaryReceipts.map(({ requestIndex }) => requestIndex)).toEqual([
      1, 0,
    ])
    const claimedSecondaryKeys = secondaryReceipts.flatMap(
      ({ appliedRowKeys }) => appliedRowKeys,
    )
    expect(new Set(claimedSecondaryKeys).size).toBe(claimedSecondaryKeys.length)
    expect(new Set(claimedSecondaryKeys)).toEqual(
      new Set(secondaryRows.map(({ id }) => id)),
    )
    expect(secondaryReceipts[0]?.appliedRowKeys).toEqual(
      [...secondaryRows].reverse().map(({ id }) => id),
    )
    expect(secondaryReceipts[1]?.appliedRowKeys).toEqual([])
    expect(
      liveA.toArray.map(
        ({ primaryRow, secondaryRow }) => `${primaryRow.id}:${secondaryRow.id}`,
      ),
    ).toEqual([`a:a-0`, `a:a-1`])
    expect(
      liveB.toArray.map(
        ({ primaryRow, secondaryRow }) => `${primaryRow.id}:${secondaryRow.id}`,
      ),
    ).toEqual([`b:b-0`, `b:b-1`])
  } finally {
    for (const pending of pendingSecondaryLoads) pending.gate.resolve()
    await Promise.all([
      liveA.cleanup(),
      liveB.cleanup(),
      primary.cleanup(),
      secondary.cleanup(),
    ])
  }
})

it(`projects the minimal primary prefix needed by a joined window`, () => {
  const projection = projectMultiSourceOrderedWindow({
    primaryOrder: [
      { key: `a`, joinKey: `x` },
      { key: `b`, joinKey: `y` },
      { key: `c`, joinKey: `z` },
      { key: `d`, joinKey: `x` },
    ],
    secondaryRows: [
      { key: `x-0`, joinKey: `x` },
      { key: `z-0`, joinKey: `z` },
    ],
    offset: 0,
    limit: 2,
  })

  expect(projection).toEqual({
    visiblePairKeys: [`a:x-0`, `c:z-0`],
    scannedPrimaryKeys: [`a`, `b`, `c`],
    primaryCursorKeys: [undefined, `a`, `b`],
    demandedJoinKeys: [`x`, `y`, `z`],
    rowsNeeded: 0,
    sourceExhausted: false,
  })
})

it(`erases join-key spelling and ignores unreachable secondary rows`, () => {
  const original = projectMultiSourceOrderedWindow({
    primaryOrder: [
      { key: `a`, joinKey: `x` },
      { key: `b`, joinKey: `y` },
      { key: `c`, joinKey: `x` },
    ],
    secondaryRows: [
      { key: `match-0`, joinKey: `x` },
      { key: `unreachable`, joinKey: `unused` },
    ],
    offset: 0,
    limit: 2,
  })
  const renamed = projectMultiSourceOrderedWindow({
    primaryOrder: [
      { key: `a`, joinKey: `renamed-x` },
      { key: `b`, joinKey: `renamed-y` },
      { key: `c`, joinKey: `renamed-x` },
    ],
    secondaryRows: [{ key: `match-0`, joinKey: `renamed-x` }],
    offset: 0,
    limit: 2,
  })

  expect({
    visiblePairKeys: original.visiblePairKeys,
    scannedPrimaryKeys: original.scannedPrimaryKeys,
    primaryCursorKeys: original.primaryCursorKeys,
    rowsNeeded: original.rowsNeeded,
    sourceExhausted: original.sourceExhausted,
  }).toEqual({
    visiblePairKeys: renamed.visiblePairKeys,
    scannedPrimaryKeys: renamed.scannedPrimaryKeys,
    primaryCursorKeys: renamed.primaryCursorKeys,
    rowsNeeded: renamed.rowsNeeded,
    sourceExhausted: renamed.sourceExhausted,
  })
})

it(`exhausts the bounded multi-source ordered-window model`, () => {
  const rows = [
    { key: `a`, joinKey: `x` },
    { key: `b`, joinKey: `y` },
    { key: `c`, joinKey: `z` },
  ]
  const joinKeys = [`x`, `y`, `z`] as const

  for (const xCount of [0, 1, 2]) {
    for (const yCount of [0, 1, 2]) {
      for (const zCount of [0, 1, 2]) {
        const counts = [xCount, yCount, zCount]
        const secondaryRows = joinKeys.flatMap((joinKey, index) =>
          Array.from({ length: counts[index]! }, (_, matchIndex) => ({
            key: `${joinKey}-${matchIndex}`,
            joinKey,
          })),
        )
        for (const offset of [0, 1, 2]) {
          for (const limit of [0, 1, 2]) {
            const projection = projectMultiSourceOrderedWindow({
              primaryOrder: rows,
              secondaryRows,
              offset,
              limit,
            })
            const direct = rows
              .flatMap((row) =>
                secondaryRows
                  .filter(({ joinKey }) => joinKey === row.joinKey)
                  .map((secondaryRow) => `${row.key}:${secondaryRow.key}`),
              )
              .slice(offset, offset + limit)

            expect(projection.visiblePairKeys).toEqual(direct)
            expect(projection.rowsNeeded).toBe(
              Math.max(0, limit - direct.length),
            )
            if (limit === 0) {
              expect(projection.scannedPrimaryKeys).toEqual([])
              continue
            }
            if (projection.scannedPrimaryKeys.length < rows.length) {
              const shorterPrefix = rows.slice(
                0,
                projection.scannedPrimaryKeys.length - 1,
              )
              const shorterPairCount = shorterPrefix.reduce(
                (count, row) =>
                  count +
                  secondaryRows.filter(({ joinKey }) => joinKey === row.joinKey)
                    .length,
                0,
              )
              expect(shorterPairCount).toBeLessThan(offset + limit)
            } else {
              expect(projection.sourceExhausted).toBe(true)
            }
          }
        }
      }
    }
  }
})

fcTest.prop([multiSourceOrderedScenarioArbitrary], {
  numRuns: 12 * fullFlowMultiplier,
  seed: 17802,
})(
  `fills joined ordered windows for a fixed seed`,
  runMultiSourceOrderedScenario,
)

fcTest.prop(
  [multiSourceOrderedScenarioArbitrary],
  oracleRandomParameters(12 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `fills joined ordered windows for a random or replayed seed`,
  runMultiSourceOrderedScenario,
)

type TruncateCoverageScenario = {
  oldRequest: `none` | `settles-late`
  freshResult: `authoritative` | `unknown` | `reject`
  settlementOrder: `old-first` | `fresh-first`
}

const truncateCoverageScenarioArbitrary: fc.Arbitrary<TruncateCoverageScenario> =
  fc.record({
    oldRequest: fc.constantFrom(`none` as const, `settles-late` as const),
    freshResult: fc.constantFrom(
      `authoritative` as const,
      `unknown` as const,
      `reject` as const,
    ),
    settlementOrder: fc.constantFrom(
      `old-first` as const,
      `fresh-first` as const,
    ),
  })

const exhaustiveTruncateCoverageScenarios: Array<TruncateCoverageScenario> = [
  `none` as const,
  `settles-late` as const,
].flatMap((oldRequest) =>
  ([`authoritative`, `unknown`, `reject`] as const).flatMap((freshResult) =>
    ([`old-first`, `fresh-first`] as const).map((settlementOrder) => ({
      oldRequest,
      freshResult,
      settlementOrder,
    })),
  ),
)

let truncateCoverageHarnessId = 0

async function runTruncateCoverageScenario(
  scenario: TruncateCoverageScenario,
): Promise<void> {
  type Row = { id: string; value: number }
  type AdapterResult = {
    hasMore: boolean | undefined
    appliedRowKeys: ReadonlyArray<string>
  }
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const pending = new Map<
    LoadSubsetOptions,
    ReturnType<typeof createDeferred<AdapterResult>>
  >()
  const unloadSubset = vi.fn()
  const source = createCollection<Row>({
    id: `truncate-coverage-oracle-${truncateCoverageHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            const request = createDeferred<AdapterResult>()
            pending.set(options, request)
            return request.promise
          },
          unloadSubset,
        }
      },
    },
  })
  const initialOptions = { limit: 1 }
  const oldOptions = { limit: 2 }
  const freshOptions = { limit: 3 }
  const histories: Array<LoadSubsetFullFlowEvent> = []
  const activeOptions: Array<LoadSubsetOptions> = []

  const request = (ownerId: string, options: LoadSubsetOptions) => {
    histories.push({
      type: `requestDemand`,
      ownerId,
      sessionId: `session`,
      demandId: `prefix-${options.limit}`,
      attemptId: `${ownerId}-attempt`,
      alreadyAborted: false,
    })
    activeOptions.push(options)
    const result = source._sync.loadSubset(options)
    if (result === true) throw new Error(`Expected a controlled async request`)
    return result
  }

  const apply = async (
    ownerId: string,
    options: LoadSubsetOptions,
    rows: ReadonlyArray<Row>,
    hasMore: boolean | undefined,
  ) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const applied = commit()
    if (applied !== true) await applied
    pending.get(options)!.resolve({
      hasMore,
      appliedRowKeys: rows.map(({ id }) => id),
    })
    histories.push({
      type:
        hasMore === undefined ? `applyUnprovenRows` : `applyAuthoritativeRows`,
      ownerId,
      demandId: `prefix-${options.limit}`,
      attemptId: `${ownerId}-attempt`,
      rowKeys: rows.map(({ id }) => id),
    })
  }

  const reject = (ownerId: string, options: LoadSubsetOptions) => {
    pending.get(options)!.reject(new Error(`fresh replay failed`))
    histories.push({
      type: `rejectDemand`,
      ownerId,
      demandId: `prefix-${options.limit}`,
      attemptId: `${ownerId}-attempt`,
    })
  }

  const expectModel = () => {
    const actualReusable = activeOptions
      .filter(
        (options) => source._sync.getLoadSubsetOutcome(options) !== undefined,
      )
      .map((options) => `prefix-${options.limit}`)
      .sort()
    expect(actualReusable).toEqual(projectReusableDemands(histories))
    expect(Array.from(source.keys()).sort()).toEqual(
      projectRetainedRowKeys(histories),
    )
  }

  try {
    const initialLoad = request(`initial`, initialOptions)
    await apply(`initial`, initialOptions, [{ id: `initial`, value: 1 }], false)
    await initialLoad
    expectModel()

    const oldLoad =
      scenario.oldRequest === `settles-late`
        ? request(`old`, oldOptions)
        : undefined

    begin()
    truncate()
    const truncated = commit()
    if (truncated !== true) await truncated
    histories.push({ type: `truncateSource`, sessionId: `session` })
    expectModel()

    const freshLoad = request(`fresh`, freshOptions)
    const settleOld = async () => {
      if (!oldLoad) return
      await apply(`old`, oldOptions, [{ id: `old`, value: 2 }], false)
      await oldLoad
      expectModel()
    }
    const settleFresh = async () => {
      if (scenario.freshResult === `reject`) {
        reject(`fresh`, freshOptions)
        await expect(freshLoad).rejects.toThrow(`fresh replay failed`)
      } else {
        await apply(
          `fresh`,
          freshOptions,
          [{ id: `fresh`, value: 3 }],
          scenario.freshResult === `authoritative` ? false : undefined,
        )
        await freshLoad
      }
      expectModel()
    }

    if (scenario.settlementOrder === `fresh-first`) {
      await settleFresh()
      await settleOld()
    } else {
      await settleOld()
      await settleFresh()
    }

    for (const options of activeOptions) {
      source._sync.unloadSubset(options)
      histories.push({
        type: `releaseDemand`,
        ownerId:
          options === initialOptions
            ? `initial`
            : options === oldOptions
              ? `old`
              : `fresh`,
        demandId: `prefix-${options.limit}`,
        attemptId: `${
          options === initialOptions
            ? `initial`
            : options === oldOptions
              ? `old`
              : `fresh`
        }-attempt`,
        rowKeys:
          options === initialOptions
            ? [`initial`]
            : options === oldOptions
              ? [`old`]
              : scenario.freshResult === `reject`
                ? []
                : [`fresh`],
        finalRowOwner: true,
        invalidatesAdapterEvidence: true,
      })
    }
    expect(unloadSubset.mock.calls.map(([options]) => options)).toEqual(
      activeOptions,
    )
    expectModel()
  } finally {
    for (const pendingRequest of pending.values()) {
      pendingRequest.reject(new Error(`test cleanup`))
    }
    await source.cleanup()
  }
}

it.each([
  { oldOutcome: `authoritative`, freshSettlesFirst: false },
  { oldOutcome: `unproven`, freshSettlesFirst: false },
  { oldOutcome: `rejected`, freshSettlesFirst: false },
  { oldOutcome: `evidence-free`, freshSettlesFirst: false },
  { oldOutcome: `released`, freshSettlesFirst: false },
  { oldOutcome: `released`, freshSettlesFirst: true },
] as const)(
  `keeps fresh exact-demand work shared after a pre-truncate $oldOutcome request (freshSettlesFirst=$freshSettlesFirst)`,
  async ({ oldOutcome, freshSettlesFirst }) => {
    type Row = { id: string; value: number }
    type AdapterResult =
      | {
          hasMore: boolean | undefined
          appliedRowKeys: ReadonlyArray<string>
        }
      | undefined
    let begin!: () => void
    let write!: (message: { type: `insert`; value: Row }) => void
    let commit!: () => true | Promise<void>
    let truncate!: () => void
    const pending: Array<ReturnType<typeof createDeferred<AdapterResult>>> = []
    const deduplicated = new DeduplicatedLoadSubset({
      loadSubset: () => {
        const request = createDeferred<AdapterResult>()
        pending.push(request)
        return request.promise
      },
    })
    const source = createCollection<Row>({
      id: `same-demand-truncate-${oldOutcome}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: (params) => {
          begin = params.begin
          write = params.write
          commit = params.commit
          truncate = params.truncate
          params.markReady()
          return {
            loadSubset: deduplicated.loadSubset,
            unloadSubset: deduplicated.unloadSubset,
          }
        },
      },
    })
    const oldOptions = { limit: 2 }
    const freshOptions = { limit: 2 }
    const peerOptions = { limit: 2 }
    const applyRows = async (rows: ReadonlyArray<Row>) => {
      begin()
      rows.forEach((row) => write({ type: `insert`, value: row }))
      const applied = commit()
      if (applied !== true) await applied
    }

    try {
      const oldLoad = source._sync.loadSubset(oldOptions)
      if (oldLoad === true) throw new Error(`Expected an async old request`)
      expect(pending).toHaveLength(1)

      begin()
      truncate()
      const truncated = commit()
      if (truncated !== true) await truncated
      deduplicated.reset()

      const freshLoad = source._sync.loadSubset(freshOptions)
      if (freshLoad === true) throw new Error(`Expected an async fresh request`)
      expect(pending).toHaveLength(2)

      if (freshSettlesFirst) {
        await applyRows([{ id: `fresh-row`, value: 2 }])
        pending[1]!.resolve({
          hasMore: false,
          appliedRowKeys: [`fresh-row`],
        })
        await freshLoad

        source._sync.unloadSubset(oldOptions)
        expect(source._sync.loadSubset(peerOptions)).toBe(true)
        expect(pending).toHaveLength(2)
        expect(source._sync.getLoadSubsetOutcome(peerOptions)).toBeDefined()

        pending[0]!.resolve(undefined)
        await oldLoad
        return
      }

      if (oldOutcome === `released`) {
        source._sync.unloadSubset(oldOptions)
      } else if (oldOutcome === `rejected`) {
        const rejection = expect(oldLoad).rejects.toThrow(`old request failed`)
        pending[0]!.reject(new Error(`old request failed`))
        await rejection
      } else if (oldOutcome === `evidence-free`) {
        pending[0]!.resolve(undefined)
        await oldLoad
      } else {
        await applyRows([{ id: `old-row`, value: 1 }])
        pending[0]!.resolve({
          hasMore: oldOutcome === `authoritative` ? false : undefined,
          appliedRowKeys: [`old-row`],
        })
        await oldLoad
      }

      expect(source._sync.getLoadSubsetOutcome(freshOptions)).toBeUndefined()
      const peerLoad = source._sync.loadSubset(peerOptions)
      if (peerLoad === true) throw new Error(`Expected a shared peer request`)
      expect(pending).toHaveLength(2)

      await applyRows([{ id: `fresh-row`, value: 2 }])
      pending[1]!.resolve({
        hasMore: false,
        appliedRowKeys: [`fresh-row`],
      })
      await Promise.all([freshLoad, peerLoad])
      expect(source._sync.getLoadSubsetOutcome(peerOptions)).toBeDefined()
      if (oldOutcome === `released`) {
        pending[0]!.resolve(undefined)
        await oldLoad
      }
    } finally {
      for (const request of pending) {
        request.reject(new Error(`test cleanup`))
      }
      await source.cleanup()
    }
  },
)

it(`does not release physical work when an already-aborted demand skips adapter start`, async () => {
  const ownerId = `aborted-owner`
  const requestEvent: LoadSubsetFullFlowEvent = {
    type: `requestDemand`,
    ownerId,
    sessionId: `session-1`,
    demandId: `all-rows`,
    attemptId: `aborted-attempt`,
    alreadyAborted: true,
  }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    requestEvent,
    {
      type: `releaseDemand`,
      ownerId,
      demandId: `all-rows`,
      attemptId: `aborted-attempt`,
      rowKeys: [],
      finalRowOwner: false,
      invalidatesAdapterEvidence: false,
    },
  ]
  const adapterEvents: Array<AdapterLifecycleEvent> = []
  const collection = createCollection<{ id: string }>({
    id: `full-flow-aborted-before-start`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: (options) => {
            adapterEvents.push({ type: `start`, options })
            return true
          },
          unloadSubset: (options) => {
            adapterEvents.push({ type: `release`, options })
          },
        }
      },
    },
  })
  const subscription = collection.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const request = new AbortController()
  request.abort()

  try {
    subscription.requestSnapshot({
      signal: request.signal,
      optimizedOnly: false,
    })
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle([requestEvent]).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )

    subscription.unsubscribe()

    // A skipped adapter call creates no physical resource to release.
    expect(eventTypes(adapterEvents)).toEqual(
      projectAdapterLifecycle(history).map(({ type }) =>
        type === `invoke` ? `start` : `release`,
      ),
    )
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it.each([127, 128, 129])(
  `freezes a %i-byte equality constant across local filtering and adapter acquisition`,
  async (byteLength) => {
    type Row = { id: `original` | `changed`; token: Uint8Array }
    const originalToken = new Uint8Array(byteLength).fill(1)
    const changedToken = new Uint8Array(byteLength).fill(2)
    const callerToken = new Uint8Array(originalToken)
    Object.defineProperty(callerToken, `slice`, {
      value: () => callerToken,
    })
    const rows: ReadonlyArray<Row> = [
      { id: `original`, token: originalToken },
      { id: `changed`, token: changedToken },
    ]
    let acquired: LoadSubsetOptions | undefined
    const collection = createCollection<Row>({
      id: `frozen-binary-equality-${byteLength}`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          rows.forEach((value) => write({ type: `insert`, value }))
          commit()
          markReady()
          return {
            loadSubset: (options) => {
              acquired = options
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const visible = new Set<Row[`id`]>()
    const where = new Func<boolean>(`eq`, [
      new PropRef([`token`]),
      new Value(callerToken),
    ])
    const subscription = collection.subscribeChanges(
      (changes) => {
        for (const change of changes) {
          if (change.type === `delete`) visible.delete(change.key as Row[`id`])
          else visible.add(change.key as Row[`id`])
        }
      },
      { whereExpression: where },
    )

    try {
      callerToken.fill(2)
      subscription.requestSnapshot({ optimizedOnly: false })

      expect([...visible]).toEqual([`original`])
      const acquiredValue = (
        (acquired?.where as Func | undefined)?.args[1] as
          | Value<Uint8Array>
          | undefined
      )?.value
      expect(acquiredValue).toEqual(originalToken)
      expect(acquiredValue).not.toBe(callerToken)
    } finally {
      subscription.unsubscribe()
      await collection.cleanup()
    }
  },
)

it(`rejects binary values without intrinsic typed-array slots before adapter acquisition`, async () => {
  const bytes = new Proxy(new Uint8Array([2]), {
    get: (target, key) =>
      key === Symbol.iterator
        ? function* () {
            yield 1
          }
        : Reflect.get(target, key, target),
  })
  let adapterCalls = 0
  const collection = createCollection<{ id: string; token: Uint8Array }>({
    id: `reject-binary-proxy`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            adapterCalls += 1
            return true
          },
        }
      },
    },
  })

  try {
    expect(() =>
      collection.subscribeChanges(() => {}, {
        whereExpression: new Func(`eq`, [
          new PropRef([`token`]),
          new Value(bytes),
        ]),
      }),
    ).toThrow(/Cannot snapshot binary equality value/)
    expect(adapterCalls).toBe(0)
    expect(collection.subscriberCount).toBe(0)
  } finally {
    await collection.cleanup()
  }
})

it(`freezes cross-realm binary equality across filtering and acquisition`, async () => {
  type Row = { id: `original` | `changed`; token: Uint8Array }
  const rows: ReadonlyArray<Row> = [
    { id: `original`, token: new Uint8Array([1]) },
    { id: `changed`, token: new Uint8Array([2]) },
  ]
  const callerToken = createCrossRealmUint8Array([1])
  let acquired: LoadSubsetOptions | undefined
  const collection = createCollection<Row>({
    id: `frozen-cross-realm-binary-equality`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        rows.forEach((value) => write({ type: `insert`, value }))
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            acquired = options
            return true
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const visible = new Set<Row[`id`]>()
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key as Row[`id`])
        else visible.add(change.key as Row[`id`])
      }
    },
    {
      whereExpression: new Func(`eq`, [
        new PropRef([`token`]),
        new Value(callerToken),
      ]),
    },
  )

  try {
    callerToken[0] = 2
    subscription.requestSnapshot({ optimizedOnly: false })

    expect([...visible]).toEqual([`original`])
    const acquiredValue = (
      (acquired?.where as Func | undefined)?.args[1] as
        | Value<Uint8Array>
        | undefined
    )?.value
    expect(acquiredValue).toEqual(new Uint8Array([1]))
    expect(acquiredValue).not.toBe(callerToken)
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`keeps binary equality distinct from a sentinel-looking string`, async () => {
  type Row = { id: `binary` | `string`; token: Uint8Array | string }
  const binary = new Uint8Array([1, 2, 3])
  const sentinel = normalizeValue(binary) as string
  const collection = createCollection<Row>({
    id: `binary-string-normalization-domains`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { id: `binary`, token: binary } })
        write({ type: `insert`, value: { id: `string`, token: sentinel } })
        commit()
        markReady()
        return { loadSubset: () => true }
      },
    },
  })
  const visible = new Set<Row[`id`]>()
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key as Row[`id`])
        else visible.add(change.key as Row[`id`])
      }
    },
    {
      whereExpression: new Func(`eq`, [
        new PropRef([`token`]),
        new Value(binary),
      ]),
    },
  )

  try {
    subscription.requestSnapshot({ optimizedOnly: false })
    expect([...visible]).toEqual([`binary`])
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`freezes computed membership candidates across local filtering and adapter acquisition`, async () => {
  type Row = { id: `original` | `changed`; token: Uint8Array }
  const candidates = [new Uint8Array([1])]
  let acquired: LoadSubsetOptions | undefined
  const collection = createCollection<Row>({
    id: `frozen-computed-membership-candidates`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: { id: `original`, token: new Uint8Array([1]) },
        })
        write({
          type: `insert`,
          value: { id: `changed`, token: new Uint8Array([2]) },
        })
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            acquired = options
            return true
          },
        }
      },
    },
  })
  const visible = new Set<Row[`id`]>()
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key as Row[`id`])
        else visible.add(change.key as Row[`id`])
      }
    },
    {
      whereExpression: new Func(`in`, [
        new PropRef([`token`]),
        new Func(`coalesce`, [new Value(candidates)]),
      ]),
    },
  )

  try {
    candidates[0]![0] = 2
    subscription.requestSnapshot({ optimizedOnly: false })

    expect([...visible]).toEqual([`original`])
    const acquiredCandidates = (
      ((acquired?.where as Func).args[1] as Func).args[0] as Value<
        Array<Uint8Array>
      >
    ).value
    expect(acquiredCandidates).toEqual([new Uint8Array([1])])
    expect(acquiredCandidates).not.toBe(candidates)
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`rejects custom membership observation before adapter acquisition`, async () => {
  const candidates = [new Uint8Array([2])]
  Object.defineProperty(candidates, Symbol.iterator, {
    value: function* () {
      yield new Uint8Array([1])
    },
  })
  let adapterCalls = 0
  const collection = createCollection<{ id: string; token: Uint8Array }>({
    id: `reject-custom-membership-observation`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            adapterCalls += 1
            return true
          },
        }
      },
    },
  })
  try {
    expect(() =>
      collection.subscribeChanges(() => {}, {
        whereExpression: new Func(`in`, [
          new PropRef([`token`]),
          new Func(`coalesce`, [new Value(candidates)]),
        ]),
      }),
    ).toThrow(/Cannot snapshot membership candidates/)
    expect(adapterCalls).toBe(0)
    expect(collection.subscriberCount).toBe(0)
  } finally {
    await collection.cleanup()
  }
})

it(`uses intrinsic Date state for local filtering and adapter acquisition`, async () => {
  type Row = { id: `instance-hook` | `intrinsic`; date: Date }
  const callerDate = new Date(2)
  Object.defineProperty(callerDate, `getTime`, { value: () => 1 })
  let acquired: LoadSubsetOptions | undefined
  const collection = createCollection<Row>({
    id: `intrinsic-date-equality`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: { id: `instance-hook`, date: new Date(1) },
        })
        write({
          type: `insert`,
          value: { id: `intrinsic`, date: new Date(2) },
        })
        commit()
        markReady()
        return {
          loadSubset: (options) => {
            acquired = options
            return true
          },
        }
      },
    },
  })
  const visible = new Set<Row[`id`]>()
  const subscription = collection.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) visible.delete(change.key as Row[`id`])
        else visible.add(change.key as Row[`id`])
      }
    },
    {
      whereExpression: new Func(`eq`, [
        new PropRef([`date`]),
        new Value(callerDate),
      ]),
    },
  )

  try {
    subscription.requestSnapshot({ optimizedOnly: false })

    expect([...visible]).toEqual([`intrinsic`])
    const acquiredDate = ((acquired?.where as Func).args[1] as Value<Date>)
      .value
    expect(acquiredDate.getTime()).toBe(2)
  } finally {
    subscription.unsubscribe()
    await collection.cleanup()
  }
})

it(`rejects constructor-shaped Temporal lookalikes before adapter acquisition`, async () => {
  class TemporalLookalike {
    static from(): TemporalLookalike {
      return new TemporalLookalike()
    }
    get [Symbol.toStringTag](): string {
      return `Temporal.PlainDate`
    }
    toString(): string {
      return `2024-01-15`
    }
  }
  let adapterCalls = 0
  const collection = createCollection<{ id: string; date: TemporalLookalike }>({
    id: `reject-constructor-shaped-temporal`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            adapterCalls += 1
            return true
          },
        }
      },
    },
  })

  try {
    expect(() =>
      collection.subscribeChanges(() => {}, {
        whereExpression: new Func(`eq`, [
          new PropRef([`date`]),
          new Value(new TemporalLookalike()),
        ]),
      }),
    ).toThrow(/Cannot snapshot Temporal.PlainDate equality value/)
    expect(adapterCalls).toBe(0)
    expect(collection.subscriberCount).toBe(0)
  } finally {
    await collection.cleanup()
  }
})

it(`rejects unsupported relational coercion before adapter entry`, async () => {
  let adapterCalls = 0
  const collection = createCollection<{ id: string; value: number }>({
    id: `unsupported-relational-coercion`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    sync: {
      sync: ({ markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            adapterCalls += 1
            return true
          },
        }
      },
    },
  })
  const coercion = { [Symbol.toPrimitive]: () => 1 }

  try {
    expect(() =>
      collection.subscribeChanges(() => {}, {
        whereExpression: new Func(`gt`, [
          new PropRef([`value`]),
          new Value(coercion),
        ]),
      }),
    ).toThrow(/Cannot snapshot structural expression value/)
    expect(adapterCalls).toBe(0)
    expect(collection.subscriberCount).toBe(0)
  } finally {
    await collection.cleanup()
  }
})

it(`reloads authoritative rows after final-owner cleanup invalidates retained adapter coverage`, async () => {
  type Row = { id: string; value: number }
  const row: Row = { id: `row`, value: 1 }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner-1`,
      sessionId: `session-1`,
      demandId: `all-rows`,
      attemptId: `attempt-1`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      attemptId: `attempt-1`,
      rowKeys: [row.id],
    },
    {
      type: `releaseDemand`,
      ownerId: `owner-1`,
      demandId: `all-rows`,
      attemptId: `attempt-1`,
      rowKeys: [row.id],
      finalRowOwner: true,
      invalidatesAdapterEvidence: true,
    },
    {
      type: `restartSession`,
      previousSessionId: `session-1`,
      nextSessionId: `session-2`,
    },
    {
      type: `requestDemand`,
      ownerId: `owner-2`,
      sessionId: `session-2`,
      demandId: `all-rows`,
      attemptId: `attempt-2`,
      alreadyAborted: false,
    },
    {
      type: `applyAuthoritativeRows`,
      ownerId: `owner-2`,
      demandId: `all-rows`,
      attemptId: `attempt-2`,
      rowKeys: [row.id],
    },
  ]
  let transportLoads = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>

  const deduplicated = new DeduplicatedLoadSubset({
    loadSubset: async () => {
      transportLoads++
      begin()
      write({ type: `insert`, value: row })
      const applied = commit()
      if (applied !== true) await applied
      return { hasMore: false, appliedRowKeys: [row.id] }
    },
  })
  const source = createCollection<Row>({
    id: `full-flow-dedupe-remount-source`,
    getKey: (value) => value.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: deduplicated.loadSubset,
          unloadSubset: deduplicated.unloadSubset,
        }
      },
    },
  })
  const createLive = (id: string) =>
    createLiveQueryCollection({
      id,
      query: (q) => q.from({ row: source }),
      startSync: true,
    })
  const first = createLive(`full-flow-dedupe-remount-first`)
  let second: ReturnType<typeof createLive> | undefined

  try {
    await first.preload()
    expect(visibleRows(first.values())).toEqual([row])
    expect(transportLoads).toBe(1)

    await first.cleanup()
    expect(Array.from(source.values())).toEqual([])

    second = createLive(`full-flow-dedupe-remount-second`)
    await second.preload()

    // The adapter must either replay retained evidence or fetch it again.
    expect(transportLoads).toBe(projectTransportLoads(history))
    expect(visibleRows(second.values()).map(({ id }) => id)).toEqual(
      projectRetainedRowKeys(history),
    )
  } finally {
    await Promise.all([
      first.cleanup(),
      second?.cleanup() ?? Promise.resolve(),
      source.cleanup(),
    ])
  }
})
it(`does not let an ordered continuation from a cleaned session start new work after restart`, async () => {
  type Row = { id: number; rank: number }
  const history: ReadonlyArray<LoadSubsetFullFlowEvent> = [
    {
      type: `requestDemand`,
      ownerId: `owner-1`,
      sessionId: `session-1`,
      demandId: `top-1`,
      attemptId: `attempt-1`,
      alreadyAborted: false,
    },
    {
      type: `scheduleContinuation`,
      taskId: `load-1-settlement`,
      sessionId: `session-1`,
      windowRevision: 0,
    },
    { type: `cleanupSession`, sessionId: `session-1` },
    {
      type: `restartSession`,
      previousSessionId: `session-1`,
      nextSessionId: `session-2`,
    },
    {
      type: `requestDemand`,
      ownerId: `owner-2`,
      sessionId: `session-2`,
      demandId: `top-1`,
      attemptId: `attempt-2`,
      alreadyAborted: false,
    },
    { type: `runContinuation`, taskId: `load-1-settlement` },
  ]
  const pending: Array<ReturnType<typeof createDeferred<void>>> = []
  const source = createCollection<Row>({
    id: `full-flow-stale-ordered-continuation-source`,
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
            const deferred = createDeferred<void>()
            pending.push(deferred)
            return deferred.promise.then(() => ({
              hasMore: false,
              appliedRowKeys: [],
            }))
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-stale-ordered-continuation-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    startSync: true,
  })
  const firstPreload = live.preload().catch(() => undefined)
  let secondPreload: Promise<unknown> | undefined

  try {
    expect(pending).toHaveLength(1)
    await live.cleanup()

    secondPreload = live.preload()
    expect(pending).toHaveLength(2)

    const requestsBeforeStaleSettlement = pending.length
    pending[0]!.resolve()
    await flushPromises()

    expect(pending).toHaveLength(
      requestsBeforeStaleSettlement +
        projectAuthorizedContinuationStarts(history),
    )
  } finally {
    for (const request of pending) request.resolve()
    await flushPromises()
    await Promise.all([
      firstPreload,
      secondPreload?.catch(() => undefined) ?? Promise.resolve(),
      live.cleanup(),
      source.cleanup(),
    ])
  }
})

it.each([`sync`, `async`] as const)(
  `keeps an outcome-free %s completion local to its exact ordered window`,
  async (settlement) => {
    type Row = { id: number; rank: number }
    const remoteRows: ReadonlyArray<Row> = [
      { id: 1, rank: 1 },
      { id: 2, rank: 2 },
      { id: 3, rank: 3 },
    ]
    const loadedKeys = new Set<number>()
    const demands: Array<LoadSubsetOptions> = []
    const source = createCollection<Row>({
      id: `full-flow-outcome-free-${settlement}-source`,
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      startSync: true,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          const applyRequestedPrefix = (options: LoadSubsetOptions) => {
            demands.push(options)
            const requestedPrefix = options.limit ?? remoteRows.length
            begin()
            for (const row of remoteRows.slice(0, requestedPrefix)) {
              if (loadedKeys.has(row.id)) continue
              write({ type: `insert`, value: row })
              loadedKeys.add(row.id)
            }
            commit()
          }
          return {
            loadSubset: (options) => {
              if (settlement === `sync`) {
                applyRequestedPrefix(options)
                return true
              }
              return Promise.resolve().then(() => {
                applyRequestedPrefix(options)
              })
            },
            unloadSubset: () => {},
          }
        },
      },
    })
    const live = createLiveQueryCollection({
      id: `full-flow-outcome-free-${settlement}-live`,
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      startSync: true,
    })

    try {
      await live.preload()
      expect(live.toArray.map(({ id }) => id)).toEqual([1])
      expect(demands).toHaveLength(1)
      expect(demands[0]?.cursor).toBeUndefined()

      await live.utils.setWindow({ offset: 0, limit: 2 })

      expect(live.toArray.map(({ id }) => id)).toEqual([1, 2])
      expect(demands).toHaveLength(2)
      expect(demands[1]).toMatchObject({ limit: 2, offset: 0 })
      expect(demands[1]?.cursor).toBeUndefined()
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  },
)

it.each([
  {
    name: `continues past an excluded source row`,
    middleEligible: false,
    expectedCalls: 3,
    expectedCursorKeys: [undefined, 1, 3],
    expectedIds: [1, 2],
  },
  {
    name: `keeps the same source progress when that row is eligible`,
    middleEligible: true,
    expectedCalls: 3,
    expectedCursorKeys: [undefined, 1, undefined],
    expectedIds: [1, 3],
  },
] as const)(`$name after a short non-exhausted page`, async (scenario) => {
  type Row = { id: number; rank: number; eligible: boolean }
  const remoteRows: ReadonlyArray<Row> = [
    { id: 1, rank: 1, eligible: true },
    { id: 3, rank: 1, eligible: scenario.middleEligible },
    { id: 2, rank: 2, eligible: true },
  ]
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-short-continuation-source`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const rows =
              calls.length === 1
                ? [remoteRows[0]!]
                : calls.length === 2
                  ? [remoteRows[1]!]
                  : [remoteRows[2]!]
            begin()
            for (const row of rows) write({ type: `insert`, value: row })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: calls.length < 3,
              appliedRowKeys: rows.map(({ id }) => id),
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-short-continuation-live`,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.eligible, true))
        .orderBy(({ row }) => row.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(scenario.expectedCalls)
    expect(calls.map(({ cursor }) => cursor?.lastKey)).toEqual(
      scenario.expectedCursorKeys,
    )
    expect(live.toArray.map(({ id }) => id)).toEqual(scenario.expectedIds)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

type OrderedConsumer = `live-collection` | `effect`

type OrderedConsumerParityScenario = {
  middleCount: 0 | 1 | 2 | 3
  middleEligible: boolean
  tied: boolean
}

type OrderedConsumerParityObservation = {
  cursorKeys: Array<string | number | undefined>
  limits: Array<number | undefined>
  visibleIds: Array<number>
  ready: boolean
}

const orderedConsumerParityScenarioArbitrary: fc.Arbitrary<OrderedConsumerParityScenario> =
  fc.record({
    middleCount: fc.constantFrom(
      0 as const,
      1 as const,
      2 as const,
      3 as const,
    ),
    middleEligible: fc.boolean(),
    tied: fc.boolean(),
  })

const exhaustiveOrderedConsumerParityScenarios: ReadonlyArray<OrderedConsumerParityScenario> =
  ([0, 1, 2, 3] as const).flatMap((middleCount) =>
    [false, true].flatMap((middleEligible) =>
      [false, true].map((tied) => ({
        middleCount,
        middleEligible,
        tied,
      })),
    ),
  )

let orderedConsumerParityHarnessId = 0

async function runTiedContinuationConsumer(
  consumer: OrderedConsumer,
  scenario: OrderedConsumerParityScenario,
): Promise<OrderedConsumerParityObservation> {
  type Row = { id: number; rank: number; eligible: boolean }
  const firstRow: Row = { id: 1, rank: 1, eligible: true }
  const middleRows: ReadonlyArray<Row> = Array.from(
    { length: scenario.middleCount },
    (_, index) => ({
      id: index + 3,
      rank: scenario.tied ? 1 : index + 2,
      eligible: scenario.middleEligible,
    }),
  )
  const finalRow: Row = {
    id: 2,
    rank: scenario.tied ? 2 : scenario.middleCount + 2,
    eligible: true,
  }
  const pageRows = [firstRow, ...middleRows, finalRow]
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<{
    request: ReturnType<
      typeof createDeferred<{
        hasMore: boolean
        appliedRowKeys: ReadonlyArray<number>
      }>
    >
    result: {
      hasMore: boolean
      appliedRowKeys: ReadonlyArray<number>
    }
    rowToApply?: Row
  }> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-parity-${consumer}-${orderedConsumerParityHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        begin()
        for (const row of middleRows) {
          write({ type: `insert`, value: row })
        }
        commit()
        params.markReady()
        return {
          loadSubset: (options) => {
            const pageIndex = calls.length
            calls.push(options)
            const row = pageRows[pageIndex]
            if (pageIndex === 0) {
              if (!row) throw new Error(`Ordered consumer exceeded its pages`)
              begin()
              write({ type: `insert`, value: row })
              commit()
            }
            const request = createDeferred<{
              hasMore: boolean
              appliedRowKeys: ReadonlyArray<number>
            }>()
            pending.push({
              request,
              result: {
                hasMore: pageIndex < pageRows.length - 1,
                appliedRowKeys: row ? [row.id] : [],
              },
              rowToApply: pageIndex === pageRows.length - 1 ? row : undefined,
            })
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const query = (q: InitialQueryBuilder) =>
    q
      .from({ row: source })
      .where(({ row }) => eq(row.eligible, true))
      .orderBy(({ row }) => row.rank)
      .limit(2)

  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let preloadPromise: Promise<unknown> | undefined
  let preloadSettled = consumer === `effect`
  let effect: ReturnType<typeof createEffect> | undefined
  if (consumer === `live-collection`) {
    live = createLiveQueryCollection({
      id: `full-flow-effect-parity-live`,
      query,
      startSync: true,
    })
    preloadPromise = live.preload()
    void preloadPromise.then(
      () => {
        preloadSettled = true
      },
      () => {},
    )
  } else {
    effect = createEffect<Row, number>({
      query,
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.key)
          else visible.set(event.key, event.value)
        }
      },
    })
  }

  try {
    await flushPromises()
    let settled = 0
    while (settled < pending.length) {
      if (settled > pageRows.length) {
        throw new Error(`Ordered consumer did not reach a fixed point`)
      }
      const page = pending[settled]!
      settled++
      if (page.rowToApply) {
        begin()
        write({ type: `insert`, value: page.rowToApply })
        const applied = commit()
        if (applied !== true) await applied
      }
      page.request.resolve(page.result)
      await flushPromises()
    }
    if (preloadPromise && preloadSettled) await preloadPromise
    return {
      cursorKeys: calls.map(({ cursor }) => cursor?.lastKey),
      limits: calls.map(({ limit }) => limit),
      visibleIds: live
        ? live.toArray.map(({ id }) => id)
        : [...visible.keys()].sort((a, b) => a - b),
      ready: preloadSettled,
    }
  } finally {
    if (live) await live.cleanup()
    if (effect) await effect.dispose()
    await source.cleanup()
  }
}

function projectOrderedConsumerParity(
  scenario: OrderedConsumerParityScenario,
): Pick<
  OrderedConsumerParityObservation,
  `cursorKeys` | `visibleIds` | `ready`
> {
  if (scenario.middleEligible && scenario.middleCount > 0) {
    return {
      cursorKeys: [undefined, 1],
      visibleIds: [1, 3],
      ready: true,
    }
  }

  return {
    cursorKeys: [
      undefined,
      1,
      ...Array.from({ length: scenario.middleCount }, (_, index) => index + 3),
    ],
    visibleIds: [1, 2],
    ready: true,
  }
}

async function assertOrderedConsumerParity(
  scenario: OrderedConsumerParityScenario,
): Promise<void> {
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])
  const expected = projectOrderedConsumerParity(scenario)

  expect({
    cursorKeys: live.cursorKeys,
    visibleIds: live.visibleIds,
    ready: live.ready,
  }).toEqual(expected)
  expect(effect).toEqual(live)
}

it(`keeps ordered continuation progress equal across collection consumers`, async () => {
  const scenario: OrderedConsumerParityScenario = {
    middleCount: 2,
    middleEligible: false,
    tied: true,
  }
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])

  expect(live.cursorKeys).toEqual([undefined, 1, 3, 4])
  expect(live.visibleIds).toEqual([1, 2])
  expect(effect).toEqual(live)
})

it(`keeps consumer parity when only the middle rows become eligible`, async () => {
  const scenario: OrderedConsumerParityScenario = {
    middleCount: 2,
    middleEligible: true,
    tied: true,
  }
  const [live, effect] = await Promise.all([
    runTiedContinuationConsumer(`live-collection`, scenario),
    runTiedContinuationConsumer(`effect`, scenario),
  ])

  expect(live.cursorKeys).toEqual([undefined, 1])
  expect(live.visibleIds).toEqual([1, 3])
  expect(effect).toEqual(live)
})

it(`exhausts bounded ordered continuation histories across collection consumers`, async () => {
  for (const scenario of exhaustiveOrderedConsumerParityScenarios) {
    await assertOrderedConsumerParity(scenario)
  }
})

fcTest.prop([orderedConsumerParityScenarioArbitrary], {
  numRuns: 12 * fullFlowMultiplier,
  seed: 17785,
})(
  `keeps ordered collection consumers equal for a fixed seed`,
  assertOrderedConsumerParity,
)

fcTest.prop(
  [orderedConsumerParityScenarioArbitrary],
  oracleRandomParameters(12 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered collection consumers equal for a random or replayed seed`,
  assertOrderedConsumerParity,
)

it(`retries an evidence-free Effect continuation after prefix refinement`, async () => {
  type Row = { id: number; rank: number; label: string }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const firstRow: Row = {
    id: 1,
    rank: 1,
    label: `before`,
  }
  const updatedFirstRow: Row = { ...firstRow, label: `after` }
  const secondRow: Row = {
    id: 2,
    rank: 2,
    label: `second`,
  }
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (
    message:
      | { type: `insert`; value: Row }
      | { type: `update`; value: Row; previousValue: Row },
  ) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-prefix-refinement`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: (options) => {
            calls.push(options)
            if (calls.length === 1) {
              begin()
              write({ type: `insert`, value: firstRow })
              commit()
            }
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    onBatch: (events) => {
      for (const event of events) {
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    expect(pending).toHaveLength(1)
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [firstRow.id] })
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [firstRow.id] })
    await flushPromises()
    expect(pending).toHaveLength(3)
    pending[2]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toHaveLength(3)

    begin()
    write({
      type: `update`,
      value: updatedFirstRow,
      previousValue: firstRow,
    })
    const updated = commit()
    if (updated !== true) await updated
    await flushPromises()

    expect(calls).toHaveLength(4)
    begin()
    write({ type: `insert`, value: secondRow })
    const applied = commit()
    if (applied !== true) await applied
    pending[3]!.resolve({ hasMore: false, appliedRowKeys: [secondRow.id] })
    await flushPromises()

    expect([...visible.values()].map(({ id }) => id)).toEqual([1, 2])
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`retries an evidence-free ordered Effect after truncate`, async () => {
  type Row = { id: number; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const finalRow: Row = { id: 2, rank: 2 }
  const calls: Array<LoadSubsetOptions> = []
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<Row>({
    id: `full-flow-effect-truncate-reset`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            calls.push(options)
            const request = createDeferred<Result>()
            pending.push(request)
            return request.promise
          },
          unloadSubset: () => {},
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
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    expect(pending).toHaveLength(1)
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(2)
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toHaveLength(2)

    begin()
    truncate()
    const replacement = commit()
    await flushPromises()
    // Both retained logical demands replay, but Effect must not add a third
    // transport until those replacement acquisitions have settled.
    expect(pending).toHaveLength(4)

    pending[2]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(4)
    pending[3]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(pending).toHaveLength(5)

    begin()
    write({ type: `insert`, value: finalRow })
    const applied = commit()
    if (applied !== true) await applied
    pending[4]!.resolve({ hasMore: false, appliedRowKeys: [finalRow.id] })
    if (replacement !== true) await replacement
    await flushPromises()

    expect([...visible.keys()]).toEqual([finalRow.id])
    expect(calls).toHaveLength(5)
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`rechecks an ordered Effect after synchronous truncate replay`, async () => {
  type Row = { id: number; rank: number }
  type Result = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }
  const finalRow: Row = { id: 2, rank: 2 }
  const pending: Array<ReturnType<typeof createDeferred<Result>>> = []
  const visible = new Map<number, Row>()
  let calls = 0
  let replaying = false
  let replayCalls = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  const source = createCollection<Row>({
    id: `full-flow-effect-sync-truncate-reset`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: () => {
            calls++
            if (!replaying) {
              const request = createDeferred<Result>()
              pending.push(request)
              return request.promise
            }

            replayCalls++
            if (replayCalls === 3) {
              begin()
              write({ type: `insert`, value: finalRow })
              commit()
            }
            return true
          },
          unloadSubset: () => {},
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
        if (event.type === `exit`) visible.delete(event.key)
        else visible.set(event.key, event.value)
      }
    },
  })

  try {
    await flushPromises()
    pending[0]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    pending[1]!.resolve({ hasMore: true, appliedRowKeys: [] })
    await flushPromises()
    expect(calls).toBe(2)

    replaying = true
    begin()
    truncate()
    const replacement = commit()
    await flushPromises()
    if (replacement !== true) await replacement

    expect(replayCalls).toBe(3)
    expect(calls).toBe(5)
    expect([...visible.keys()]).toEqual([finalRow.id])
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`replaces an ordered Effect only after a rejected continuation disposes it`, async () => {
  type Row = { id: number; rank: number }
  const firstRow: Row = { id: 1, rank: 1 }
  const replacementRow: Row = { id: 2, rank: 2 }
  const failure = new Error(`ordered continuation failed`)
  let calls = 0
  let begin!: () => void
  let write!: (
    message: { type: `insert`; value: Row } | { type: `delete`; value: Row },
  ) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-rejection-reset`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: () => {
            calls++
            if (calls === 2) return Promise.reject(failure)
            const row = calls === 1 ? firstRow : replacementRow
            begin()
            write({ type: `insert`, value: row })
            commit()
            return Promise.resolve()
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const errors: Array<Error> = []
  const first = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(1),
    onBatch: () => {},
    onSourceError: (error) => errors.push(error),
  })
  let second: ReturnType<typeof createEffect<Row, number>> | undefined

  try {
    await flushPromises()
    expect(calls).toBe(1)

    begin()
    write({ type: `delete`, value: firstRow })
    const removed = commit()
    if (removed !== true) await removed
    await flushPromises()

    expect(calls).toBe(2)
    expect(errors).toEqual([failure])
    expect(first.disposed).toBe(true)

    const visible = new Map<number, Row>()
    second = createEffect<Row, number>({
      query: (q) =>
        q
          .from({ row: source })
          .orderBy(({ row }) => row.rank)
          .limit(1),
      onBatch: (events) => {
        for (const event of events) {
          if (event.type === `exit`) visible.delete(event.key)
          else visible.set(event.key, event.value)
        }
      },
    })
    await flushPromises()

    expect(calls).toBe(3)
    expect(second.disposed).toBe(false)
    expect([...visible.keys()]).toEqual([replacementRow.id])
  } finally {
    await first.dispose()
    if (second) await second.dispose()
    await source.cleanup()
  }
})

it(`does not continue an ordered Effect after teardown`, async () => {
  type Row = { id: number; rank: number }
  const row: Row = { id: 1, rank: 1 }
  const pending = createDeferred<{
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<number>
  }>()
  let calls = 0
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-effect-teardown-fence`,
    getKey: (value) => value.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: () => {
            calls++
            begin()
            write({ type: `insert`, value: row })
            commit()
            return pending.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const effect = createEffect<Row, number>({
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row: value }) => value.rank)
        .limit(2),
    onBatch: () => {},
  })

  try {
    await flushPromises()
    expect(calls).toBe(1)
    await effect.dispose()

    pending.resolve({ hasMore: true, appliedRowKeys: [row.id] })
    await flushPromises()

    expect(calls).toBe(1)
  } finally {
    await effect.dispose()
    await source.cleanup()
  }
})

it(`continues across every excluded source row beyond the visible target`, async () => {
  type Row = { id: number; rank: number; eligible: boolean }
  const remoteRows: ReadonlyArray<Row> = [
    { id: 1, rank: 1, eligible: true },
    { id: 2, rank: 2, eligible: false },
    { id: 3, rank: 3, eligible: false },
    { id: 4, rank: 4, eligible: true },
  ]
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-excluded-progress-source`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const lastKey = options.cursor?.lastKey
            const rowIndex =
              lastKey === undefined
                ? 0
                : remoteRows.findIndex(({ id }) => id === lastKey) + 1
            const row = remoteRows[rowIndex]
            if (!row) throw new Error(`Expected another remote row`)
            begin()
            write({ type: `insert`, value: row })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: rowIndex < remoteRows.length - 1,
              appliedRowKeys: [row.id],
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-excluded-progress-live`,
    query: (q) =>
      q
        .from({ row: source })
        .where(({ row }) => eq(row.eligible, true))
        .orderBy(({ row }) => row.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(4)
    expect(calls.map(({ cursor }) => cursor?.lastKey)).toEqual([
      undefined,
      1,
      2,
      3,
    ])
    expect(live.toArray.map(({ id }) => id)).toEqual([1, 4])
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

it(`does not repeat an evidence-free ordered continuation`, async () => {
  type Row = { id: number; rank: number }
  const row: Row = { id: 1, rank: 1 }
  const calls: Array<LoadSubsetOptions> = []
  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  const source = createCollection<Row>({
    id: `full-flow-no-progress-source`,
    getKey: (value) => value.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        params.markReady()
        return {
          loadSubset: async (options) => {
            calls.push(options)
            await Promise.resolve()
            const rows = calls.length === 1 ? [row] : []
            begin()
            for (const value of rows) write({ type: `insert`, value })
            const applied = commit()
            if (applied !== true) await applied
            return {
              hasMore: true,
              appliedRowKeys: rows.map(({ id }) => id),
            }
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    id: `full-flow-no-progress-live`,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row: value }) => value.rank)
        .limit(2),
    startSync: true,
  })

  try {
    await live.preload()
    await flushPromises()

    expect(calls).toHaveLength(2)
    expect(live.toArray.map(({ id }) => id)).toEqual([1])
    expect(live.utils.lastSubsetError).toMatchObject({
      message: expect.stringContaining(`made no ordered progress`),
    })
    const [subscription] = Object.values(
      live.utils[LIVE_QUERY_INTERNAL].getBuilder().subscriptions,
    )
    expect(subscription?.hasOrderedCoverageForActiveWindow).toBe(false)
    expect(subscription?.orderedRowsNeeded).toBe(1)

    await live.utils.setWindow({ offset: 0, limit: 3 })
    await flushPromises()

    expect(calls).toHaveLength(3)
    expect(calls[2]?.cursor?.lastKey).toBe(1)
    expect(subscription?.hasOrderedCoverageForActiveWindow).toBe(false)
    expect(subscription?.orderedRowsNeeded).toBe(2)
  } finally {
    await live.cleanup()
    await source.cleanup()
  }
})

type OrderedContinuationEvidenceScenario = {
  targetSize: number
  eligibleKeys: ReadonlyArray<string>
  pages: ReadonlyArray<{
    requestedPrefix: number
    appliedKeys: ReadonlyArray<string>
    extent: `continues` | `exhausted`
  }>
}

const orderedEvidenceKeyArbitrary = fc.constantFrom(`a`, `b`, `c`, `d`)
const orderedContinuationEvidenceScenarioArbitrary: fc.Arbitrary<OrderedContinuationEvidenceScenario> =
  fc.record({
    targetSize: fc.integer({ min: 1, max: 4 }),
    eligibleKeys: fc.uniqueArray(orderedEvidenceKeyArbitrary, {
      minLength: 0,
      maxLength: 4,
    }),
    pages: fc.array(
      fc.record({
        requestedPrefix: fc.integer({ min: 1, max: 4 }),
        appliedKeys: fc.uniqueArray(orderedEvidenceKeyArbitrary, {
          minLength: 0,
          maxLength: 4,
        }),
        extent: fc.constantFrom(`continues` as const, `exhausted` as const),
      }),
      { minLength: 1, maxLength: 4 },
    ),
  })

if (process.env.TANSTACK_DB_ORACLE_STATISTICS === `1`) {
  fc.statistics(
    orderedContinuationEvidenceScenarioArbitrary,
    ({ eligibleKeys, pages }) => [
      `empty-continuation=${pages.some(
        (page) => page.extent === `continues` && page.appliedKeys.length === 0,
      )}`,
      `short-continuation=${pages.some(
        (page) =>
          page.extent === `continues` &&
          page.appliedKeys.length < page.requestedPrefix,
      )}`,
      `excluded-applied-row=${pages.some((page) =>
        page.appliedKeys.some((key) => !eligibleKeys.includes(key)),
      )}`,
      `exhaustion=${pages.some((page) => page.extent === `exhausted`)}`,
    ],
    oracleRandomParameters(1_000, fullFlowReplaySeed),
  )
}

let orderedEvidenceHarnessId = 0

type OrderedEvidenceRow = {
  id: string
  rank: number
  eligible: boolean
}

function assertOrderedContinuationEvidence(
  window: WindowState<WritableDeep<OrderedEvidenceRow>, string | number>,
  scenario: OrderedContinuationEvidenceScenario,
  sourceOrder: ReadonlyArray<string> = [`a`, `b`, `c`, `d`],
): void {
  const eligibleKeys = new Set(scenario.eligibleKeys)
  const [initial, ...continuations] = scenario.pages
  if (!initial) throw new Error(`Expected an initial evidence page`)
  window.recordInitialCoverage(
    initial.appliedKeys,
    initial.extent === `exhausted`,
  )
  if (initial.extent !== `exhausted`) {
    for (const page of continuations) {
      window.recordContinuationCoverage(
        page.appliedKeys,
        page.extent === `exhausted`,
        page.requestedPrefix,
        window.coverageRevision,
      )
      if (page.extent === `exhausted`) break
    }
  }

  const expected = projectOrderedContinuationEvidence({
    sourceOrder,
    eligibleKeys,
    targetSize: scenario.targetSize,
    pages: scenario.pages,
  })
  const actualKeys = window
    .reconcile(new Map())
    .filter((change) => change.type === `insert`)
    .map(({ key }) => key)

  expect(actualKeys).toEqual(expected.visibleKeys)
  expect(window.requestBoundary()?.key).toBe(expected.boundaryKey)
  expect(window.coveredPrefixSize).toBe(expected.coveredPrefixSize)
  expect(window.coversActiveWindow).toBe(expected.coversTarget)
  expect(window.rowsNeeded()).toBe(expected.rowsNeeded)
}

async function runOrderedContinuationEvidenceScenario(
  scenario: OrderedContinuationEvidenceScenario,
): Promise<void> {
  const sourceOrder = [`a`, `b`, `c`, `d`]
  const eligibleKeys = new Set(scenario.eligibleKeys)
  const rows: Array<OrderedEvidenceRow> = sourceOrder.map((id, index) => ({
    id,
    rank: index + 1,
    eligible: eligibleKeys.has(id),
  }))
  const source = createCollection(
    mockSyncCollectionOptions<OrderedEvidenceRow>({
      id: `ordered-evidence-oracle-${orderedEvidenceHarnessId++}`,
      initialData: rows,
      getKey: (row) => row.id,
    }),
  )
  await source.preload()
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: { direction: `asc` as const, nulls: `first` as const },
    },
  ]
  const where = new Func(`eq`, [new PropRef([`eligible`]), new Value(true)])
  const window = new WindowState(source, orderBy, where, scenario.targetSize)

  try {
    assertOrderedContinuationEvidence(window, scenario)
  } finally {
    await source.cleanup()
  }
}

it(`exhausts the bounded ordered-evidence model`, async () => {
  const boundedKeys = [`a`, `b`] as const
  const keySets: Array<Array<(typeof boundedKeys)[number]>> = [[]]
  for (const key of boundedKeys) {
    keySets.push(...keySets.map((keys) => [...keys, key]))
  }
  const pages = [1, 2].flatMap((requestedPrefix) =>
    keySets.flatMap((appliedKeys) =>
      ([`continues`, `exhausted`] as const).map((extent) => ({
        requestedPrefix,
        appliedKeys,
        extent,
      })),
    ),
  )
  const histories = [
    ...pages.map((page) => [page]),
    ...pages.flatMap((first) => pages.map((second) => [first, second])),
  ]
  const sourceOrder = [...boundedKeys]
  let checked = 0

  for (const eligible of keySets) {
    const eligibleKeys = new Set<string>(eligible)
    const rows: Array<OrderedEvidenceRow> = sourceOrder.map((id, index) => ({
      id,
      rank: index + 1,
      eligible: eligibleKeys.has(id),
    }))
    const source = createCollection(
      mockSyncCollectionOptions<OrderedEvidenceRow>({
        id: `ordered-evidence-exhaustive-${orderedEvidenceHarnessId++}`,
        initialData: rows,
        getKey: (row) => row.id,
      }),
    )
    await source.preload()
    const orderBy = [
      {
        expression: new PropRef([`rank`]),
        compareOptions: { direction: `asc` as const, nulls: `first` as const },
      },
    ]
    const where = new Func(`eq`, [new PropRef([`eligible`]), new Value(true)])

    try {
      for (const targetSize of [1, 2]) {
        for (const evidencePages of histories) {
          const scenario: OrderedContinuationEvidenceScenario = {
            targetSize,
            eligibleKeys: eligible,
            pages: evidencePages,
          }
          assertOrderedContinuationEvidence(
            new WindowState(source, orderBy, where, targetSize),
            scenario,
            sourceOrder,
          )
          checked++
        }
      }
    } finally {
      await source.cleanup()
    }
  }

  expect(checked).toBe(2_176)
})

type AutomaticOrderedProgressState = {
  demandedPrefix: number
  refillLimit: number
  boundary?: { rank: number; key: string }
}

function assertAutomaticOrderedProgress(
  states: ReadonlyArray<AutomaticOrderedProgressState>,
): void {
  const orderByInfo = {
    orderBy: [
      {
        expression: new PropRef([`rank`]),
        compareOptions: {
          direction: `asc` as const,
          nulls: `first` as const,
        },
      },
    ],
    offset: 0,
    valueExtractorForRawRow: (row: Record<string, unknown>) => row.rank,
  }
  let lastLoadRequestKey: string | undefined
  let lastAcceptedIdentity: string | undefined

  for (const state of states) {
    const identity = JSON.stringify({
      demandedPrefix: state.demandedPrefix,
      rank: state.boundary?.rank ?? null,
      key: state.boundary?.key ?? null,
    })
    const request = computeOrderedLoadCursor(
      orderByInfo,
      state.boundary,
      lastLoadRequestKey,
      `row`,
      state.refillLimit,
      state.demandedPrefix,
      state.boundary?.key,
    )
    const shouldStart = identity !== lastAcceptedIdentity

    expect(request !== undefined).toBe(shouldStart)
    if (request) {
      lastLoadRequestKey = request.loadRequestKey
      lastAcceptedIdentity = identity
    }
  }
}

const automaticOrderedProgressStateArbitrary: fc.Arbitrary<AutomaticOrderedProgressState> =
  fc.record({
    demandedPrefix: fc.integer({ min: 1, max: 4 }),
    refillLimit: fc.integer({ min: 1, max: 4 }),
    boundary: fc.option(
      fc.record({
        rank: fc.integer({ min: -1, max: 2 }),
        key: fc.constantFrom(`a`, `b`, `c`),
      }),
      { nil: undefined },
    ),
  })

it(`exhausts the bounded automatic-progress transition law`, () => {
  const boundaries: ReadonlyArray<AutomaticOrderedProgressState[`boundary`]> = [
    undefined,
    { rank: 0, key: `a` },
    { rank: 0, key: `b` },
    { rank: 1, key: `a` },
  ]
  const states = [1, 2].flatMap((demandedPrefix) =>
    [1, 2].flatMap((refillLimit) =>
      boundaries.map((boundary) => ({
        demandedPrefix,
        refillLimit,
        boundary,
      })),
    ),
  )
  let checked = 0

  for (const first of states) {
    for (const second of states) {
      assertAutomaticOrderedProgress([first, second])
      checked++
    }
  }

  expect(checked).toBe(256)
})

fcTest.prop(
  [
    fc.array(automaticOrderedProgressStateArbitrary, {
      minLength: 1,
      maxLength: 8,
    }),
  ],
  {
    numRuns: 128 * fullFlowMultiplier,
    seed: 17784,
  },
)(
  `starts automatic continuation only for new semantic progress with a fixed seed`,
  assertAutomaticOrderedProgress,
)

fcTest.prop(
  [
    fc.array(automaticOrderedProgressStateArbitrary, {
      minLength: 1,
      maxLength: 8,
    }),
  ],
  oracleRandomParameters(128 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `starts automatic continuation only for new semantic progress with a random or replayed seed`,
  assertAutomaticOrderedProgress,
)

fcTest.prop([orderedContinuationEvidenceScenarioArbitrary], {
  numRuns: 64 * fullFlowMultiplier,
  seed: 17783,
})(
  `derives ordered progress from applied eligible evidence for a fixed seed`,
  runOrderedContinuationEvidenceScenario,
)

fcTest.prop(
  [orderedContinuationEvidenceScenarioArbitrary],
  oracleRandomParameters(64 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `derives ordered progress from applied eligible evidence for a random or replayed seed`,
  runOrderedContinuationEvidenceScenario,
)

type OrderedBoundaryProvenanceScenario = {
  direction: `asc` | `desc`
  offset: 0 | 1
  tied: boolean
  addedRowPlacement: `before` | `after`
  replayFailure: `throw` | `reject`
}

const orderedBoundaryProvenanceArbitrary: fc.Arbitrary<OrderedBoundaryProvenanceScenario> =
  fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    offset: fc.constantFrom(0 as const, 1 as const),
    tied: fc.boolean(),
    addedRowPlacement: fc.constantFrom(`before` as const, `after` as const),
    replayFailure: fc.constantFrom(`throw` as const, `reject` as const),
  })

const exhaustiveOrderedBoundaryProvenanceScenarios: ReadonlyArray<OrderedBoundaryProvenanceScenario> =
  ([`asc`, `desc`] as const).flatMap((direction) =>
    ([0, 1] as const).flatMap((offset) =>
      [false, true].flatMap((tied) =>
        ([`before`, `after`] as const).flatMap((addedRowPlacement) =>
          ([`throw`, `reject`] as const).map((replayFailure) => ({
            direction,
            offset,
            tied,
            addedRowPlacement,
            replayFailure,
          })),
        ),
      ),
    ),
  )

let orderedBoundaryHarnessId = 0

async function runOrderedBoundaryProvenanceScenario(
  scenario: OrderedBoundaryProvenanceScenario,
): Promise<void> {
  type Row = {
    id: `a` | `b` | `c` | `z`
    rank: number
    route: `ordered` | `unrelated`
  }
  const orderedRows: ReadonlyArray<Row> = [
    { id: `a`, rank: scenario.tied ? 5 : 1, route: `ordered` },
    { id: `b`, rank: scenario.tied ? 5 : 2, route: `ordered` },
    { id: `c`, rank: scenario.tied ? 5 : 3, route: `ordered` },
  ]
  const addedRow: Row = {
    id: `z`,
    rank:
      scenario.addedRowPlacement === `before`
        ? scenario.direction === `asc`
          ? 0
          : 6
        : scenario.direction === `asc`
          ? scenario.tied
            ? 5
            : 99
          : scenario.tied
            ? 5
            : -99,
    route: `unrelated`,
  }
  const orderedForDirection = [...orderedRows].sort((left, right) => {
    const valueOrder =
      scenario.direction === `asc`
        ? left.rank - right.rank
        : right.rank - left.rank
    return valueOrder || left.id.localeCompare(right.id)
  })
  const rowsAfterAdditionalDemand = [...orderedRows, addedRow].sort(
    (left, right) => {
      const valueOrder =
        scenario.direction === `asc`
          ? left.rank - right.rank
          : right.rank - left.rank
      return valueOrder || left.id.localeCompare(right.id)
    },
  )
  const prefixSize = scenario.offset + 1
  const expectedOrderedPrefix = (
    scenario.addedRowPlacement === `before`
      ? rowsAfterAdditionalDemand
      : orderedForDirection
  ).slice(0, prefixSize)
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial-publication`,
      demandId: `ordered-window`,
      rows: orderedForDirection.slice(0, prefixSize).map((row) => ({
        key: row.id,
        orderValue: row.rank,
      })),
    },
    { type: `commitPublication`, publicationId: `initial-publication` },
    // A later row before the prefix changes the ordered publication. A row
    // after it remains only unordered-retention data and cannot move its
    // continuation boundary.
    ...(scenario.addedRowPlacement === `before`
      ? ([
          {
            type: `stagePublicationRows`,
            publicationId: `additional-publication`,
            demandId: `ordered-window`,
            rows: expectedOrderedPrefix.map((row) => ({
              key: row.id,
              orderValue: row.rank,
            })),
          },
        ] satisfies Array<LoadSubsetFullFlowEvent>)
      : []),
    {
      type: `stagePublicationRows`,
      publicationId: `additional-publication`,
      demandId: `unordered-retention`,
      rows: [{ key: addedRow.id, orderValue: addedRow.rank }],
    },
    { type: `commitPublication`, publicationId: `additional-publication` },
    { type: `truncateSource`, sessionId: `session` },
    {
      type: `stagePublicationRows`,
      publicationId: `failed-replacement`,
      demandId: `ordered-window`,
      rows: [
        {
          key: expectedOrderedPrefix.at(-1)!.id,
          orderValue:
            expectedOrderedPrefix.at(-1)!.rank +
            (scenario.direction === `asc` ? 100 : -100),
        },
      ],
    },
    {
      type: `rejectDemand`,
      ownerId: `ordered-owner`,
      demandId: `ordered-window`,
      attemptId: `ordered-attempt`,
    },
  ]
  const expectedBoundary = projectOrderedPublicationBoundary(history, {
    demandId: `ordered-window`,
    direction: scenario.direction,
    prefixSize,
  })
  if (!expectedBoundary) throw new Error(`Expected an ordered boundary`)
  const partialReplayRow: Row = {
    id: expectedBoundary.key as Row[`id`],
    rank:
      expectedBoundary.orderValue + (scenario.direction === `asc` ? 100 : -100),
    route: expectedBoundary.key === addedRow.id ? `unrelated` : `ordered`,
  }

  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  let phase: `initial` | `replay` | `probe` = `initial`
  const loadOptions: Array<LoadSubsetOptions> = []
  const visible = new Map<Row[`id`], Row>()
  const applyRows = async (rows: ReadonlyArray<Row>) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const receipt = commit()
    if (receipt !== true) await receipt
  }
  const source = createCollection<Row>({
    id: `ordered-boundary-provenance-${orderedBoundaryHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            loadOptions.push(options)
            if (phase === `initial`) {
              const rows = options.orderBy ? orderedRows : [addedRow]
              return applyRows(rows).then(() => ({
                hasMore: false,
                appliedRowKeys: rows.map(({ id }) => id),
              }))
            }
            if (phase === `replay` && options.orderBy) {
              if (scenario.replayFailure === `throw`) {
                begin()
                write({ type: `insert`, value: partialReplayRow })
                const receipt = commit()
                if (receipt !== true) void receipt.catch(() => {})
                throw new Error(`ordered replay failed`)
              }
              return applyRows([partialReplayRow]).then(() =>
                Promise.reject(new Error(`ordered replay failed`)),
              )
            }
            return Promise.resolve({
              hasMore: false,
              appliedRowKeys: [],
            })
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const index = source.createIndex((row) => row.rank, {
    indexType: BTreeIndex,
  })
  const orderedIndex =
    scenario.direction === `asc` ? index : new ReverseIndex(index)
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: {
        direction: scenario.direction,
        nulls: `first` as const,
      },
    },
  ]
  const unrelatedWhere = new Func(`eq`, [
    new PropRef([`route`]),
    new Value(`unrelated`),
  ])
  const subscription = source.subscribeChanges((changes) => {
    for (const change of changes) {
      if (change.type === `delete`) visible.delete(change.key as Row[`id`])
      else visible.set(change.key as Row[`id`], change.value)
    }
  })
  subscription.setOrderByIndex(orderedIndex)

  try {
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      offset: scenario.offset,
    })
    await flushPromises()
    subscription.requestSnapshot({
      where: unrelatedWhere,
      optimizedOnly: false,
    })
    await flushPromises()

    expect([...visible.keys()].sort()).toEqual(
      [
        ...new Set([
          ...rowsAfterAdditionalDemand.slice(0, prefixSize).map(({ id }) => id),
          addedRow.id,
        ]),
      ].sort(),
    )
    expect((subscription.orderedBoundaryRow as Row | undefined)?.id).toBe(
      expectedBoundary.key,
    )
    expect((subscription.orderedBoundaryRow as Row | undefined)?.rank).toBe(
      expectedBoundary.orderValue,
    )

    phase = `replay`
    begin()
    truncate()
    const receipt = commit()
    if (receipt !== true) await receipt
    await flushPromises()

    phase = `probe`
    const beforeProbe = loadOptions.length
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      offset: scenario.offset,
    })
    await flushPromises()

    expect(loadOptions).toHaveLength(beforeProbe + 1)
    const cursor = loadOptions.at(-1)?.cursor
    expect(cursor?.lastKey).toBe(expectedBoundary.key)
    expect(cursor?.whereCurrent).toBeDefined()
    expect(cursor?.whereFrom).toBeDefined()
    expect(
      evaluateReferenceExpression(cursor!.whereCurrent, {
        rank: expectedBoundary.orderValue,
      }),
    ).toBe(true)
    expect(
      evaluateReferenceExpression(cursor!.whereCurrent, {
        rank: expectedBoundary.orderValue + 1,
      }),
    ).toBe(false)
    expect(
      evaluateReferenceExpression(cursor!.whereFrom, {
        rank:
          expectedBoundary.orderValue + (scenario.direction === `asc` ? 1 : -1),
      }),
    ).toBe(true)
  } finally {
    subscription.unsubscribe()
    await source.cleanup()
  }
}

it(`keeps failed-replay cursors scoped to the last complete ordered publication`, async () => {
  for (const scenario of exhaustiveOrderedBoundaryProvenanceScenarios) {
    await runOrderedBoundaryProvenanceScenario(scenario)
  }
})

fcTest.prop([orderedBoundaryProvenanceArbitrary], {
  numRuns: 32 * fullFlowMultiplier,
  seed: 1778,
})(
  `keeps ordered boundary provenance for a fixed seed`,
  runOrderedBoundaryProvenanceScenario,
)

fcTest.prop(
  [orderedBoundaryProvenanceArbitrary],
  oracleRandomParameters(32 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered boundary provenance for a random or replayed seed`,
  runOrderedBoundaryProvenanceScenario,
)

type AtomicOrderedReplayScenario = {
  direction: `asc` | `desc`
  initialPublication?: `empty` | `nonempty`
  callerContinuation?: `none` | `min-values` | `offset` | `both`
  resizeOrder: `grow-shrink` | `shrink-grow`
  overlap: boolean
  currentOutcome: `resolve` | `reject`
  currentExtent: `exhausted` | `continues`
  emptyContinuingReplay?: boolean
  settleCurrentFirst: boolean
  sourceDelta: boolean
  otherDemand: `none` | `active` | `released`
  otherOutcome?: `resolve` | `reject`
  demandSettlementOrder?: `ordered-first` | `other-first`
  releaseAfterOrdered?: boolean
  terminal?: `settle` | `unsubscribe`
}

const atomicOrderedReplayArbitrary: fc.Arbitrary<AtomicOrderedReplayScenario> =
  fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    initialPublication: fc.constantFrom(`empty` as const, `nonempty` as const),
    callerContinuation: fc.constantFrom(
      `none` as const,
      `min-values` as const,
      `offset` as const,
      `both` as const,
    ),
    resizeOrder: fc.constantFrom(
      `grow-shrink` as const,
      `shrink-grow` as const,
    ),
    overlap: fc.boolean(),
    currentOutcome: fc.constantFrom(`resolve` as const, `reject` as const),
    currentExtent: fc.constantFrom(`exhausted` as const, `continues` as const),
    emptyContinuingReplay: fc.boolean(),
    settleCurrentFirst: fc.boolean(),
    sourceDelta: fc.boolean(),
    otherDemand: fc.constantFrom(
      `none` as const,
      `active` as const,
      `released` as const,
    ),
  })

const exhaustiveAtomicOrderedReplayScenarios: ReadonlyArray<AtomicOrderedReplayScenario> =
  ([`empty`, `nonempty`] as const).flatMap((initialPublication) =>
    ([`asc`, `desc`] as const).flatMap((direction) =>
      ([`grow-shrink`, `shrink-grow`] as const).flatMap((resizeOrder) =>
        [false, true].flatMap((overlap) =>
          ([`resolve`, `reject`] as const).flatMap((currentOutcome) =>
            ([`exhausted`, `continues`] as const).flatMap((currentExtent) =>
              [false, true].flatMap((settleCurrentFirst) =>
                [false, true].flatMap((sourceDelta) =>
                  ([`none`, `active`, `released`] as const).map(
                    (otherDemand) => ({
                      direction,
                      initialPublication,
                      resizeOrder,
                      overlap,
                      currentOutcome,
                      currentExtent,
                      settleCurrentFirst,
                      sourceDelta,
                      otherDemand,
                    }),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )

let atomicReplayHarnessId = 0

async function runAtomicOrderedReplayScenario(
  scenario: AtomicOrderedReplayScenario,
): Promise<void> {
  type Row = {
    id:
      | `old-a`
      | `old-b`
      | `new-a`
      | `new-b`
      | `delta`
      | `tail`
      | `obsolete`
      | `partial`
      | `old-other`
      | `new-other`
    rank: number
    route: `ordered` | `other`
  }
  type Outcome = {
    hasMore: boolean
    appliedRowKeys: ReadonlyArray<Row[`id`]>
  }
  type PendingReplay = {
    options: LoadSubsetOptions
    deferred: ReturnType<typeof createDeferred<Outcome>>
  }
  type PendingAttempt = {
    publicationId: string
    acquisitions: ReadonlyArray<PendingReplay>
    ordered: PendingReplay
  }

  const initialRows: ReadonlyArray<Row> =
    scenario.initialPublication === `empty`
      ? []
      : [
          { id: `old-a`, rank: 1, route: `ordered` },
          { id: `old-b`, rank: 2, route: `ordered` },
        ]
  const replacementRows: ReadonlyArray<Row> = [
    { id: `new-a`, rank: 1, route: `ordered` },
    { id: `new-b`, rank: 2, route: `ordered` },
  ]
  const sourceDelta: Row = {
    id: `delta`,
    rank: scenario.direction === `asc` ? 0 : 3,
    route: `ordered`,
  }
  const continuationRow: Row = {
    id: `tail`,
    rank: scenario.direction === `asc` ? 3 : 0,
    route: `ordered`,
  }
  const obsoleteRow: Row = {
    id: `obsolete`,
    rank: scenario.direction === `asc` ? -1 : 4,
    route: `ordered`,
  }
  const partialRow: Row = {
    id: `partial`,
    rank: scenario.direction === `asc` ? -2 : 5,
    route: `ordered`,
  }
  const initialOtherRow: Row = {
    id: `old-other`,
    rank: scenario.direction === `asc` ? 100 : -100,
    route: `other`,
  }
  const initialOtherRows =
    scenario.initialPublication === `empty` ? [] : [initialOtherRow]
  const replacementOtherRow: Row = {
    id: `new-other`,
    rank: scenario.direction === `asc` ? 101 : -101,
    route: `other`,
  }
  const orderRows = (rows: ReadonlyArray<Row>) =>
    [...rows].sort((left, right) => {
      const valueOrder =
        scenario.direction === `asc`
          ? left.rank - right.rank
          : right.rank - left.rank
      return valueOrder || left.id.localeCompare(right.id)
    })
  const toModelRows = (rows: ReadonlyArray<Row>) =>
    rows.map(({ id: key, rank: orderValue }) => ({ key, orderValue }))

  let begin!: () => void
  let write!: (message: { type: `insert`; value: Row }) => void
  let commit!: () => true | Promise<void>
  let truncate!: () => void
  let initialOrderedLoad = true
  let initialOtherLoad = true
  let replacementSequence = 0
  let unsubscribed = false
  const pending: Array<PendingReplay> = []
  const history: Array<LoadSubsetFullFlowEvent> = [
    {
      type: `stagePublicationRows`,
      publicationId: `initial`,
      demandId: `ordered`,
      rows: toModelRows(initialRows),
    },
    { type: `commitPublication`, publicationId: `initial` },
  ]

  const applyRows = async (rows: ReadonlyArray<Row>) => {
    begin()
    for (const row of rows) write({ type: `insert`, value: row })
    const receipt = commit()
    if (receipt !== true) await receipt
  }

  const collection = createCollection<Row>({
    id: `atomic-ordered-replay-${atomicReplayHarnessId++}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    sync: {
      sync: (params) => {
        begin = params.begin
        write = params.write
        commit = params.commit
        truncate = params.truncate
        params.markReady()
        return {
          loadSubset: (options) => {
            if (initialOrderedLoad && options.orderBy) {
              initialOrderedLoad = false
              return applyRows(initialRows).then(() => ({
                hasMore: false,
                appliedRowKeys: initialRows.map(({ id }) => id),
              }))
            }
            if (initialOtherLoad && !options.orderBy) {
              initialOtherLoad = false
              return applyRows(initialOtherRows).then(() => ({
                hasMore: false,
                appliedRowKeys: initialOtherRows.map(({ id }) => id),
              }))
            }
            const deferred = createDeferred<Outcome>()
            pending.push({ options, deferred })
            return deferred.promise
          },
          unloadSubset: () => {},
        }
      },
    },
  })
  const index = collection.createIndex((row) => row.rank, {
    indexType: BTreeIndex,
  })
  const orderedIndex =
    scenario.direction === `asc` ? index : new ReverseIndex(index)
  const orderBy = [
    {
      expression: new PropRef([`rank`]),
      compareOptions: {
        direction: scenario.direction,
        nulls: `first` as const,
      },
    },
  ]
  const callerContinuation = scenario.callerContinuation ?? `min-values`
  const callerContinuationOptions = {
    ...(callerContinuation === `min-values` || callerContinuation === `both`
      ? { minValues: [scenario.direction === `asc` ? 0 : 3] }
      : {}),
    ...(callerContinuation === `offset` || callerContinuation === `both`
      ? { offset: 1 }
      : {}),
  }
  const initialWindowSize =
    callerContinuation === `offset` || callerContinuation === `both` ? 2 : 1
  const otherWhere = new Func(`eq`, [
    new PropRef([`route`]),
    new Value(`other`),
  ])
  const visible = new Map<Row[`id`], Row>()
  const publications: Array<
    ReadonlyArray<{ key: string; orderValue: number }>
  > = []
  const subscription = collection.subscribeChanges((changes) => {
    // The projection models semantic publications. requestSnapshot may invoke
    // the callback with an empty transport batch, which cannot change readers.
    if (changes.length === 0) return
    for (const change of changes) {
      const key = change.key as Row[`id`]
      if (change.type === `delete`) visible.delete(key)
      else visible.set(key, change.value)
    }
    publications.push(toModelRows(orderRows([...visible.values()])))
  })
  subscription.setOrderByIndex(orderedIndex)

  const expectedPublicationProjection = () =>
    projectAtomicOrderedPublicationState(history, {
      demandId: `ordered`,
      direction: scenario.direction,
      initialWindowSize,
    })
  const expectedPublications = () =>
    projectAtomicOrderedPublications(history, {
      demandId: `ordered`,
      direction: scenario.direction,
      initialWindowSize,
    })
  const expectPublicationHistory = () => {
    const projection = expectedPublicationProjection()
    const expected = projection.publications
    expect(publications).toEqual(expected)
    if (unsubscribed) return

    // Normal progress may move past the visible prefix. During replacement or
    // after replay failure, however, continuation state belongs to the exact
    // retained publication. Assert its optional boundary, including the empty
    // publication's meaningful `undefined` value.
    if (projection.retainsPreviousPublication) {
      expect(subscription.orderedBoundaryKey).toBe(
        projection.currentPublication?.orderedBoundary?.key,
      )
    }
  }
  const beginReplacement = async () => {
    const pendingStart = pending.length
    begin()
    truncate()
    const receipt = commit()
    if (receipt !== true) await receipt
    await flushPromises()
    const acquisitions = pending.slice(pendingStart)
    const ordered = acquisitions.find(({ options }) => options.orderBy)
    if (!ordered) throw new Error(`Expected an ordered replacement acquisition`)
    expect(ordered.options.offset).toBe(0)
    expect(ordered.options.cursor).toBeUndefined()
    const publicationId = `replacement-${replacementSequence++}`
    history.push({
      type: `beginReplacement`,
      publicationId,
      demandIds: acquisitions.map((acquisition) =>
        acquisition === ordered ? `ordered` : `other`,
      ),
    })
    expectPublicationHistory()
    return { publicationId, acquisitions, ordered } satisfies PendingAttempt
  }
  const settle = async (
    replay: PendingAttempt,
    outcome: `success` | `failure` | `abort`,
    rows: ReadonlyArray<Row>,
    extent: `exhausted` | `continues` = `exhausted`,
    otherOutcome: `success` | `failure` = outcome === `success`
      ? `success`
      : `failure`,
    demandOrder: `ordered-first` | `other-first` = `ordered-first`,
    releaseOtherAfterOrdered = false,
    appliedOrderedRowKeys: ReadonlyArray<Row[`id`]> = replacementRows.map(
      ({ id }) => id,
    ),
    stageEmptyRows = false,
  ) => {
    if (rows.length > 0) await applyRows(rows)
    if (rows.length > 0 || stageEmptyRows) {
      history.push({
        type: `stagePublicationRows`,
        publicationId: replay.publicationId,
        demandId: `ordered`,
        rows: toModelRows(rows),
      })
      expectPublicationHistory()
    }
    const acquisitions = [...replay.acquisitions].sort((left, right) => {
      const leftOrdered = left === replay.ordered
      const rightOrdered = right === replay.ordered
      if (leftOrdered === rightOrdered) return 0
      const orderedFirst = demandOrder === `ordered-first`
      return leftOrdered === orderedFirst ? -1 : 1
    })
    for (const acquisition of acquisitions) {
      const isOrdered = acquisition === replay.ordered
      const demandId = isOrdered ? `ordered` : `other`
      const desiredOutcome = isOrdered ? outcome : otherOutcome
      const aborted = acquisition.options.signal?.aborted ?? false
      const settledOutcome = aborted ? `abort` : desiredOutcome
      if (settledOutcome === `success`) {
        acquisition.deferred.resolve({
          hasMore: isOrdered ? extent === `continues` : false,
          appliedRowKeys: isOrdered
            ? appliedOrderedRowKeys
            : [replacementOtherRow.id],
        })
      } else {
        const error = new Error(
          settledOutcome === `abort`
            ? `obsolete replay aborted`
            : `replay failed`,
        )
        if (settledOutcome === `abort`) error.name = `AbortError`
        acquisition.deferred.reject(error)
      }
      history.push(
        settledOutcome === `success`
          ? {
              type: `settleReplacement`,
              publicationId: replay.publicationId,
              demandId,
              outcome: settledOutcome,
              extent: isOrdered ? extent : `exhausted`,
            }
          : {
              type: `settleReplacement`,
              publicationId: replay.publicationId,
              demandId,
              outcome: settledOutcome,
            },
      )
      await flushPromises()
      expectPublicationHistory()

      if (isOrdered && releaseOtherAfterOrdered) {
        subscription.releaseSnapshot(otherWhere)
        const released = replay.acquisitions.find(
          (candidate) => candidate !== replay.ordered,
        )
        expect(released?.options.signal?.aborted).toBe(true)
        history.push({
          type: `releaseDemand`,
          ownerId: `other-owner`,
          demandId: `other`,
          attemptId: `other-attempt`,
          rowKeys: [replacementOtherRow.id],
          finalRowOwner: true,
          invalidatesAdapterEvidence: true,
        })
        expectPublicationHistory()
      }
    }
  }

  try {
    subscription.requestLimitedSnapshot({
      orderBy,
      limit: 1,
      ...callerContinuationOptions,
    })
    await flushPromises()
    expectPublicationHistory()

    if (scenario.otherDemand !== `none`) {
      history.push({
        type: `requestDemand`,
        ownerId: `other-owner`,
        sessionId: `atomic-session`,
        demandId: `other`,
        attemptId: `other-attempt`,
        alreadyAborted: false,
      })
      subscription.requestSnapshot({ where: otherWhere })
      await flushPromises()
      history.push(
        {
          type: `stagePublicationRows`,
          publicationId: `initial`,
          demandId: `other`,
          rows: toModelRows(initialOtherRows),
        },
        { type: `commitPublication`, publicationId: `initial` },
      )
      expectPublicationHistory()
    }

    const firstReplay = await beginReplacement()
    if (scenario.overlap) {
      await applyRows([obsoleteRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: firstReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([obsoleteRow]),
      })
      expectPublicationHistory()
    }
    const currentReplay = scenario.overlap
      ? await beginReplacement()
      : firstReplay
    if (scenario.overlap) {
      expect(
        firstReplay.acquisitions.every(
          ({ options }) => options.signal?.aborted,
        ),
      ).toBe(true)
    }

    const resizeSizes =
      scenario.resizeOrder === `grow-shrink`
        ? ([2, 0] as const)
        : ([0, 2] as const)
    for (const size of resizeSizes) {
      history.push({ type: `resizeOrderedWindow`, size })
      subscription.ensureOrderedWindowSize(size)
      expectPublicationHistory()
    }

    if (scenario.otherDemand !== `none`) {
      await applyRows([replacementOtherRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `other`,
        rows: toModelRows([replacementOtherRow]),
      })
      expectPublicationHistory()
      if (scenario.otherDemand === `released`) {
        subscription.releaseSnapshot(otherWhere)
        history.push({
          type: `releaseDemand`,
          ownerId: `other-owner`,
          demandId: `other`,
          attemptId: `other-attempt`,
          rowKeys: [replacementOtherRow.id],
          finalRowOwner: true,
          invalidatesAdapterEvidence: true,
        })
        expectPublicationHistory()
      }
    }

    if (scenario.sourceDelta) {
      await applyRows([sourceDelta])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([sourceDelta]),
      })
      expectPublicationHistory()
    }

    if (scenario.terminal === `unsubscribe`) {
      await applyRows([partialRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([partialRow]),
      })
      expectPublicationHistory()
      subscription.unsubscribe()
      unsubscribed = true
      history.push({ type: `cleanupSession`, sessionId: `atomic-session` })
      expectPublicationHistory()
      expect(
        currentReplay.acquisitions.every(
          ({ options }) => options.signal?.aborted,
        ),
      ).toBe(true)
      await applyRows([continuationRow])
      history.push({
        type: `stagePublicationRows`,
        publicationId: currentReplay.publicationId,
        demandId: `ordered`,
        rows: toModelRows([partialRow, continuationRow]),
      })
      expectPublicationHistory()
      await settle(currentReplay, `abort`, [])
      if (scenario.overlap) await settle(firstReplay, `abort`, [])
      expectPublicationHistory()
      return
    }

    const hasEmptyContinuingReplay =
      scenario.emptyContinuingReplay === true &&
      scenario.currentOutcome === `resolve` &&
      scenario.currentExtent === `continues` &&
      scenario.sourceDelta === false &&
      scenario.otherDemand === `none`
    const finalRows = hasEmptyContinuingReplay
      ? []
      : [...replacementRows, ...(scenario.sourceDelta ? [sourceDelta] : [])]
    const partialFailureRows: ReadonlyArray<Row> = [
      {
        id: `new-a`,
        rank: scenario.direction === `asc` ? 99 : -99,
        route: `ordered`,
      },
    ]
    const settleCurrent = () =>
      settle(
        currentReplay,
        scenario.currentOutcome === `resolve` ? `success` : `failure`,
        scenario.currentOutcome === `resolve` ? finalRows : partialFailureRows,
        scenario.currentExtent,
        scenario.otherOutcome === `resolve`
          ? `success`
          : scenario.otherOutcome === `reject`
            ? `failure`
            : scenario.currentOutcome === `resolve`
              ? `success`
              : `failure`,
        scenario.demandSettlementOrder,
        scenario.releaseAfterOrdered,
        hasEmptyContinuingReplay ? [] : replacementRows.map(({ id }) => id),
        hasEmptyContinuingReplay,
      )
    const settleObsolete = () => settle(firstReplay, `abort`, [])

    if (!scenario.overlap) {
      await settleCurrent()
    } else if (scenario.settleCurrentFirst) {
      await settleCurrent()
      await settleObsolete()
    } else {
      await settleObsolete()
      await settleCurrent()
    }

    if (
      scenario.currentOutcome === `resolve` &&
      scenario.currentExtent === `continues`
    ) {
      if (!hasEmptyContinuingReplay) {
        await applyRows([continuationRow])
        history.push({
          type: `stagePublicationRows`,
          publicationId: currentReplay.publicationId,
          demandId: `ordered`,
          rows: toModelRows([...finalRows, continuationRow]),
        })
        expectPublicationHistory()
      }
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 2,
        trackLoadSubsetPromise: false,
        ...callerContinuationOptions,
      })
      await flushPromises()
      const continuation = pending.at(-1)
      if (!continuation || continuation === currentReplay.ordered) {
        throw new Error(`Expected an ordered continuation acquisition`)
      }
      if (hasEmptyContinuingReplay) {
        expect(continuation.options.offset).toBe(0)
        expect(continuation.options.cursor).toBeUndefined()
        expect(subscription.orderedRetainedWindowSize).toBe(2)
        expectPublicationHistory()
        return
      }
      const expectedPrivateBoundary = orderRows(finalRows).slice(0, 2).at(-1)!
      // Applied-but-unrefined rows establish a private cursor, not an admitted
      // local prefix, so offset remains zero until refinement settles.
      expect(continuation.options.offset).toBe(0)
      expect(continuation.options.cursor?.lastKey).toBe(
        expectedPrivateBoundary.id,
      )
      expect(continuation.options.cursor?.whereCurrent).toBeDefined()
      expect(continuation.options.cursor?.whereFrom).toBeDefined()
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereCurrent, {
          rank: expectedPrivateBoundary.rank,
        }),
      ).toBe(true)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereCurrent, {
          rank: scenario.direction === `asc` ? 0 : 3,
        }),
      ).toBe(false)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank:
            expectedPrivateBoundary.rank +
            (scenario.direction === `asc` ? 1 : -1),
        }),
      ).toBe(true)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank: expectedPrivateBoundary.rank,
        }),
      ).toBe(false)
      expect(
        evaluateReferenceExpression(continuation.options.cursor!.whereFrom, {
          rank: scenario.direction === `asc` ? 0 : 3,
        }),
      ).toBe(false)
      continuation.deferred.resolve({
        hasMore: true,
        appliedRowKeys: [continuationRow.id],
      })
      history.push({
        type: `establishReplacementCoverage`,
        publicationId: currentReplay.publicationId,
      })
      await flushPromises()
      expectPublicationHistory()
    }

    const finalProjection = expectedPublicationProjection()
    if (finalProjection.retainsPreviousPublication) {
      const pendingStart = pending.length
      subscription.requestLimitedSnapshot({
        orderBy,
        limit: 1,
        ...callerContinuationOptions,
        trackLoadSubsetPromise: false,
      })
      await flushPromises()
      const restoration = pending[pendingStart]
      if (!restoration) {
        throw new Error(`Expected a retained-publication restoration request`)
      }
      expect(restoration.options.offset).toBe(
        finalProjection.currentPublication?.orderedPrefixSize ?? 0,
      )
      expect(subscription.orderedRetainedWindowSize).toBe(
        Math.max(
          2,
          (finalProjection.currentPublication?.orderedPrefixSize ?? 0) + 1,
        ),
      )
      const expectedBoundary =
        finalProjection.currentPublication?.orderedBoundary
      if (expectedBoundary === undefined) {
        expect(restoration.options.cursor).toBeUndefined()
      } else {
        expect(restoration.options.cursor).toBeDefined()
        expect(restoration.options.cursor?.lastKey).toBe(expectedBoundary.key)
        expect(
          evaluateReferenceExpression(
            restoration.options.cursor!.whereCurrent,
            { rank: expectedBoundary.orderValue },
          ),
        ).toBe(true)
        expect(
          evaluateReferenceExpression(
            restoration.options.cursor!.whereCurrent,
            { rank: scenario.direction === `asc` ? 0 : 3 },
          ),
        ).toBe(false)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank:
              expectedBoundary.orderValue +
              (scenario.direction === `asc` ? 1 : -1),
          }),
        ).toBe(true)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank: expectedBoundary.orderValue,
          }),
        ).toBe(false)
        expect(
          evaluateReferenceExpression(restoration.options.cursor!.whereFrom, {
            rank: scenario.direction === `asc` ? 0 : 3,
          }),
        ).toBe(false)
      }
    }

    const expectedKeys = expectedPublications().map((rows) =>
      rows.map(({ key }) => key),
    )
    expect(publications.map((rows) => rows.map(({ key }) => key))).toEqual(
      expectedKeys,
    )
    expect(publications).toHaveLength(expectedPublications().length)
  } finally {
    for (const replay of pending)
      replay.deferred.resolve({
        hasMore: false,
        appliedRowKeys: [],
      })
    await flushPromises()
    if (!unsubscribed) subscription.unsubscribe()
    await collection.cleanup()
  }
}

const mixedDemandSettlementScenarios: ReadonlyArray<AtomicOrderedReplayScenario> =
  ([`asc`, `desc`] as const).flatMap((direction) => [
    ...([`ordered-first`, `other-first`] as const).flatMap(
      (demandSettlementOrder) => [
        {
          direction,
          resizeOrder: `grow-shrink` as const,
          overlap: false,
          currentOutcome: `resolve` as const,
          currentExtent: `exhausted` as const,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `active` as const,
          otherOutcome: `reject` as const,
          demandSettlementOrder,
        },
        {
          direction,
          resizeOrder: `grow-shrink` as const,
          overlap: false,
          currentOutcome: `reject` as const,
          currentExtent: `exhausted` as const,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `active` as const,
          otherOutcome: `resolve` as const,
          demandSettlementOrder,
        },
      ],
    ),
    {
      direction,
      resizeOrder: `grow-shrink` as const,
      overlap: false,
      currentOutcome: `resolve` as const,
      currentExtent: `exhausted` as const,
      settleCurrentFirst: false,
      sourceDelta: false,
      otherDemand: `active` as const,
      otherOutcome: `reject` as const,
      demandSettlementOrder: `ordered-first` as const,
      releaseAfterOrdered: true,
    },
  ])

it(`does not reuse caller or public continuation state when an active replacement has no progress`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const callerContinuation of [
      `none`,
      `min-values`,
      `offset`,
      `both`,
    ] as const) {
      await runAtomicOrderedReplayScenario({
        direction,
        initialPublication: `nonempty`,
        callerContinuation,
        resizeOrder: `grow-shrink`,
        overlap: false,
        currentOutcome: `resolve`,
        currentExtent: `continues`,
        emptyContinuingReplay: true,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
      })
    }
  }
})

it(`uses only private boundary semantics when an active replacement has progress`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const callerContinuation of [`min-values`, `both`] as const) {
      await runAtomicOrderedReplayScenario({
        direction,
        initialPublication: `nonempty`,
        callerContinuation,
        resizeOrder: `shrink-grow`,
        overlap: false,
        currentOutcome: `resolve`,
        currentExtent: `continues`,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
      })
    }
  }
})

it(`restores failed replay continuation only from the last complete publication`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const initialPublication of [`empty`, `nonempty`] as const) {
      for (const callerContinuation of [
        `none`,
        `min-values`,
        `offset`,
        `both`,
      ] as const) {
        await runAtomicOrderedReplayScenario({
          direction,
          initialPublication,
          callerContinuation,
          resizeOrder: `grow-shrink`,
          overlap: false,
          currentOutcome: `reject`,
          currentExtent: `continues`,
          settleCurrentFirst: false,
          sourceDelta: false,
          otherDemand: `none`,
        })
      }
    }
  }
})

it(`keeps mixed demand settlements inside one replacement epoch`, async () => {
  for (const scenario of mixedDemandSettlementScenarios) {
    await runAtomicOrderedReplayScenario(scenario)
  }
})

it(`discards pending replacement epochs on teardown`, async () => {
  for (const direction of [`asc`, `desc`] as const) {
    for (const overlap of [false, true]) {
      await runAtomicOrderedReplayScenario({
        direction,
        resizeOrder: `grow-shrink`,
        overlap,
        currentOutcome: `resolve`,
        currentExtent: `exhausted`,
        settleCurrentFirst: false,
        sourceDelta: false,
        otherDemand: `none`,
        terminal: `unsubscribe`,
      })
    }
  }
})

it(`keeps ordered replacement publication atomic across every bounded history`, async () => {
  for (const scenario of exhaustiveAtomicOrderedReplayScenarios) {
    await runAtomicOrderedReplayScenario(scenario)
  }
}, 30_000)

fcTest.prop([atomicOrderedReplayArbitrary], {
  numRuns: 32 * fullFlowMultiplier,
  seed: 17781,
})(
  `keeps ordered replacement publication atomic for a fixed seed`,
  runAtomicOrderedReplayScenario,
)

fcTest.prop(
  [atomicOrderedReplayArbitrary],
  oracleRandomParameters(32 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `keeps ordered replacement publication atomic for a random or replayed seed`,
  runAtomicOrderedReplayScenario,
)

it(`matches the truncate evidence model across every bounded settlement history`, async () => {
  for (const scenario of exhaustiveTruncateCoverageScenarios) {
    await runTruncateCoverageScenario(scenario)
  }
})

fcTest.prop([truncateCoverageScenarioArbitrary], {
  numRuns: 12 * fullFlowMultiplier,
  seed: 1774,
})(`fences pre-truncate evidence for a fixed seed`, runTruncateCoverageScenario)

fcTest.prop(
  [truncateCoverageScenarioArbitrary],
  oracleRandomParameters(12 * fullFlowMultiplier, fullFlowReplaySeed),
)(
  `fences pre-truncate evidence for a random or replayed seed`,
  runTruncateCoverageScenario,
)
