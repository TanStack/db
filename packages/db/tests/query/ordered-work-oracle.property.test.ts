import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import type { InitialQueryBuilder } from '../../src/query/builder/index.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gte } from '../../src/query/builder/functions.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = {
  id: number
  rank: number
  eligible: boolean
  label: string
}

type Marker = { id: number; rowId: number }

type Scenario = {
  middleCount: 0 | 1 | 2 | 3
  middleEligible: boolean
  lastEligible: boolean
  tied: boolean
  direction: `asc` | `desc`
}

type RequestObservation = {
  kind: `page` | `boundary`
  key: string | undefined
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

let harnessId = 0

async function observeConsumer(
  kind: `collection` | `effect`,
  scenario: Scenario,
): Promise<ConsumerObservation> {
  type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const truth = rowsForScenario(scenario).sort(compareRows(scenario.direction))
  const sourceSize = truth.length
  const eligibleTruth = truth.filter(({ eligible }) => eligible)
  const rowToDelete =
    eligibleTruth.length >= 3 &&
    eligibleTruth[0]!.rank !== eligibleTruth[1]!.rank
      ? eligibleTruth[0]
      : undefined
  const delivered = new Set<number>()
  const requests: Array<RequestObservation> = []
  const errors: Array<string> = []
  const effectRows = new Map<number, Row>()
  let sync!: Sync

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
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: async (options) => {
            const isPage = options.orderBy !== undefined
            requests.push({
              kind: isPage ? `page` : `boundary`,
              key: getLoadSubsetDemandKey(options),
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

            if (!isPage) {
              await apply(matching.filter((row) => !delivered.has(row.id)))
              return
            }

            const start =
              options.cursor?.lastKey === undefined
                ? (options.offset ?? 0)
                : matching.findIndex(
                    ({ id }) => id === options.cursor?.lastKey,
                  ) + 1
            const page = matching
              .slice(start)
              .filter((candidate) => !delivered.has(candidate.id))
              .slice(0, options.limit)
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
    syncMode: `eager`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const marker of markers) {
          write({ type: `insert`, value: marker })
        }
        commit()
        markReady()
      },
    },
  })

  let live: ReturnType<typeof createLiveQueryCollection> | undefined
  let effect: ReturnType<typeof createEffect> | undefined
  const publications: Array<Array<Row>> = []
  const query = (q: InitialQueryBuilder) => {
    const ordered = q
      .from({ row: source })
      .leftJoin({ marker: markerSource }, ({ row, marker }) =>
        eq(row.id, marker.rowId),
      )
      .where(({ row, marker }) => eq(row.id, marker!.rowId))
      .orderBy(({ row }) => row.rank, scenario.direction)
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

  try {
    if (kind === `collection`) {
      live = createLiveQueryCollection(query)
      live.subscribeChanges(() => {
        publications.push(visibleRows())
      })
      await live.preload()
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

    for (let turn = 0; turn < truth.length * 3 + 6; turn++) {
      await flushPromises()
    }

    const rows = visibleRows()
    const expected = eligibleTruth.slice(0, 2)
    expect(rows, JSON.stringify({ kind, scenario, requests })).toEqual(expected)
    for (const publication of publications) {
      expect(publication).toEqual(expected.slice(0, publication.length))
    }
    const semanticPublications = publications.filter(
      (publication, index) =>
        index === 0 ||
        JSON.stringify(publication) !== JSON.stringify(publications[index - 1]),
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
    if (rowToDelete) {
      truth.splice(truth.indexOf(rowToDelete), 1)
      delivered.delete(rowToDelete.id)
      sync.begin({ immediate: true })
      sync.write({ type: `delete`, value: { ...rowToDelete } })
      const receipt = sync.commit()
      if (receipt !== true) await receipt
      for (let turn = 0; turn < sourceSize * 3 + 6; turn++) {
        await flushPromises()
      }
      finalRows = visibleRows()
      expect(finalRows, JSON.stringify({ kind, scenario, requests })).toEqual(
        truth.filter(({ eligible }) => eligible).slice(0, 2),
      )
    }
    expect(publications.at(-1) ?? []).toEqual(finalRows)
    expect(publications.length).toBeLessThanOrEqual(requests.length + 1)
    expect(requests.length).toBeLessThanOrEqual(sourceSize * 3 + 2)
    expect(
      requests.every(
        (request) => request.kind === `boundary` || request.limit !== undefined,
      ),
    ).toBe(true)

    return {
      rows: finalRows,
      requests,
      compareRequestTrace: rowToDelete === undefined,
      publications,
      errors,
      live: live ? live.status === `ready` : effect?.disposed === false,
    }
  } finally {
    if (effect) await effect.dispose()
    if (live) await live.cleanup()
    await markerSource.cleanup()
    await source.cleanup()
  }
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

  try {
    if (live) await live.preload()
    else await vi.waitFor(() => expect(visibleIds()).toEqual([1, 2]))
    expect(visibleIds()).toEqual([1, 2])

    const first = { ...source.get(1)!, label: `z` }
    sync.begin({ immediate: true })
    sync.write({ type: `update`, value: { ...first } })
    const receipt = sync.commit()
    if (receipt !== true) await receipt
    await vi.waitFor(() => expect(visibleIds()).toEqual([2, 3]))

    expect(requests.length).toBeLessThanOrEqual(6)
    return { rows: visibleIds(), requests }
  } finally {
    if (effect) await effect.dispose()
    if (live) await live.cleanup()
    await source.cleanup()
  }
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
        return {
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

  try {
    if (live) {
      live.subscribeChanges(() => publications.push(visibleIds()))
      await live.preload()
    } else {
      await vi.waitFor(() => expect(visibleIds()).toEqual([1]))
    }
    const requestsBeforeMutation = requests
    const moved = { ...truth.get(1)!, rank: 10 }
    if (mutation === `delete`) truth.delete(1)
    else truth.set(1, moved)
    sync.begin({ immediate: true })
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
    return { rows: visibleIds(), requests, publications }
  } finally {
    if (effect) await effect.dispose()
    if (live) await live.cleanup()
    await source.cleanup()
  }
}

describe(`ordered source work oracle`, () => {
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

  it(`does not refetch when a visible row changes outside the ordering key`, async () => {
    let sync!: Parameters<SyncConfig<Row, number>[`sync`]>[0]
    let loads = 0
    const rows = rowsForScenario({
      middleCount: 1,
      middleEligible: true,
      lastEligible: true,
      tied: false,
      direction: `asc`,
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
    const live = createLiveQueryCollection((q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
    )

    try {
      await live.preload()
      await flushPromises()
      const loadCount = loads
      const row = source.get(1)!
      sync.begin({ immediate: true })
      sync.write({ type: `update`, value: { ...row, label: `changed` } })
      sync.commit()
      await flushPromises()

      expect(loads).toBe(loadCount)
      expect(live.get(1)?.label).toBe(`changed`)
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  })

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
          childId: child?.id,
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
      primarySync.begin({ immediate: true })
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

    try {
      await live.preload()
      await live.utils.setWindow({ offset: 0, limit: 2 })
      await flushPromises()

      // Each page turn is followed by a tie-boundary request. The source
      // returns one row at a time while honoring both predicates.
      expect(loads).toBe(4)
      expect(readIds()).toEqual([1, 2])
      expect(batches).toEqual([[1, 2]])
      expect(callbackReads).toEqual([[1, 2]])
    } finally {
      subscription.unsubscribe()
      await Promise.all([live.cleanup(), source.cleanup()])
    }
  })

  it(`keeps live collections and Effects equal across the exhaustive small domain`, async () => {
    for (const scenario of exhaustiveScenarios) {
      await assertConsumerParity(scenario)
    }
  })

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
          observation.requests.filter(({ kind }) => kind === `page`).length,
        ).toBeLessThanOrEqual(sourceSize)
        expect(
          observation.requests.filter(({ kind }) => kind === `boundary`).length,
        ).toBeLessThanOrEqual(sourceSize)
        expect(
          new Set(observation.requests.map(({ key }) => key)).size,
          JSON.stringify(observation.requests),
        ).toBe(observation.requests.length)
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
