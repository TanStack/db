import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createEffect } from '../../src/query/effect.js'
import { createLiveQueryCollection } from '../../src/query/live-query-collection.js'
import { eq } from '../../src/query/builder/functions.js'
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
  tied: boolean
  direction: `asc` | `desc`
}

type RequestObservation = {
  kind: `page` | `boundary`
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
  tied: fc.boolean(),
  direction: fc.constantFrom(`asc` as const, `desc` as const),
})

const exhaustiveScenarios: ReadonlyArray<Scenario> = ([0, 1, 2, 3] as const)
  .flatMap((middleCount) =>
    [false, true].flatMap((middleEligible) =>
      [false, true].flatMap((tied) =>
        ([`asc`, `desc`] as const).map((direction) => ({
          middleCount,
          middleEligible,
          tied,
          direction,
        })),
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
      eligible: true,
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
  const effectPages = effect.requests.filter(({ kind }) => kind === `page`)
  const collectionPages = collection.requests.filter(
    ({ kind }) => kind === `page`,
  )
  expect(effectPages.map(({ limit }) => limit)).toEqual(
    collectionPages.map(({ limit }) => limit),
  )
  expect(
    effect.requests.filter(({ kind }) => kind === `boundary`).length,
  ).toBeLessThanOrEqual(effectPages.length)
  expect(
    collection.requests.filter(({ kind }) => kind === `boundary`).length,
  ).toBeLessThanOrEqual(collectionPages.length)
}

describe(`ordered source work oracle`, () => {
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
          return { loadSubset: () => void loads++ }
        },
      },
    })
    const live = createLiveQueryCollection((q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank).limit(0),
    )

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

  it(`keeps live collections and Effects equal across the exhaustive small domain`, async () => {
    for (const scenario of exhaustiveScenarios) {
      await assertConsumerParity(scenario)
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
