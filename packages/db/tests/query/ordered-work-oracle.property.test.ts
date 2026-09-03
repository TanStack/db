import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { getLoadSubsetDemandKey } from '../../src/query/ir-stable-identity.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq, gte } from '../../src/query/builder/functions.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import type { SyncConfig } from '../../src/types.js'

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

const exhaustiveScenarios: ReadonlyArray<Scenario> = ([0, 1, 2, 3] as const)
  .flatMap((middleCount) =>
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

  const visibleRows = () =>
    (live ? [...live.values()] : [...effectRows.values()])
      .map(({ id, rank, eligible, label }) => ({ id, rank, eligible, label }))
      .sort(compareRows(scenario.direction))

  try {
    if (kind === `collection`) {
      live = createLiveQueryCollection((q) =>
        q
          .from({ row: source })
          .leftJoin({ marker: markerSource }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ row, marker }) => eq(row.id, marker!.rowId))
          .orderBy(({ row }) => row.rank, scenario.direction)
          .limit(2)
          .select(({ row }) => ({
            id: row.id,
            rank: row.rank,
            eligible: row.eligible,
            label: row.label,
          })),
      )
      live.subscribeChanges(() => {
        publications.push(visibleRows())
      })
      await live.preload()
    } else {
      effect = createEffect<Row, number>({
        query: (q) =>
          q
            .from({ row: source })
            .leftJoin({ marker: markerSource }, ({ row, marker }) =>
              eq(row.id, marker.rowId),
            )
            .where(({ row, marker }) => eq(row.id, marker!.rowId))
            .orderBy(({ row }) => row.rank, scenario.direction)
            .limit(2)
            .select(({ row }) => ({
              id: row.id,
              rank: row.rank,
              eligible: row.eligible,
              label: row.label,
            })),
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
    const expected = truth.filter(({ eligible }) => eligible).slice(0, 2)
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
    expect(publications.at(-1) ?? []).toEqual(rows)
    expect(publications.length).toBeLessThanOrEqual(requests.length + 1)
    expect(requests.length).toBeLessThanOrEqual(truth.length * 3 + 2)
    expect(
      requests.every(
        (request) =>
          request.kind === `boundary` || request.limit !== undefined,
      ),
    ).toBe(true)

    return {
      rows,
      requests,
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
  expect(semanticRequests(effect.requests)).toEqual(
    semanticRequests(collection.requests),
  )
}

describe(`ordered source work oracle`, () => {
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
          return { loadSubset: () => void orderLoads++ }
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
          return { loadSubset: () => void chargeLoads++ }
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

  it(`does no source work for a zero-sized window`, async () => {
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
    const live = createLiveQueryCollection({
      id: `ordered-atomic-indexed-window-live`,
      query: (q) =>
        q.from({ row: source }).orderBy(({ row }) => row.rank).limit(0),
      startSync: true,
    })

    try {
      await live.preload()
      expect(loads).toBe(0)
    } finally {
      await live.cleanup()
      await source.cleanup()
    }
  })

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
      q.from({ row: source }).orderBy(({ row }) => row.rank).limit(2),
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

  it(`publishes one complete batch after an indexed loader fills a window`, async () => {
    const remoteRows: ReadonlyArray<Row> = [
      { id: 1, rank: 1, eligible: true, label: `one` },
      { id: 2, rank: 2, eligible: true, label: `two` },
    ]
    const batches: Array<Array<number>> = []
    const callbackReads: Array<Array<number>> = []
    let loads = 0
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
            loadSubset: () => {
              const row = remoteRows[loads++]
              if (!row) return
              sync.begin()
              sync.write({ type: `insert`, value: row })
              const receipt = sync.commit()
              if (receipt !== true) {
                throw new Error(`Expected synchronous source application`)
              }
            },
          }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank).limit(0),
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

      // Two page turns produce rows; one final tie-boundary request proves
      // there is no unseen row at rank 2.
      expect(loads).toBe(3)
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

  it(`settles an underfilled source without repeating one continuation forever`, async () => {
    const scenario: Scenario = {
      middleCount: 3,
      middleEligible: false,
      lastEligible: false,
      tied: false,
      direction: `asc`,
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
      expect(
        observation.requests.length,
        JSON.stringify(observation.requests),
      ).toBeLessThanOrEqual(8)
      expect(
        observation.requests.filter(({ kind }) => kind === `page`).length,
      ).toBeLessThanOrEqual(rowsForScenario(scenario).length)
      expect(new Set(observation.requests.map(({ key }) => key)).size).toBe(
        observation.requests.length,
      )
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
