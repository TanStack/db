import { fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { differs, oracleProperty } from '../oracle-config.js'
import { flushPromises } from '../utils.js'
import { finishCleanup } from './load-subset-source-readiness-support.js'
import type { Observation, Verdict } from '../oracle-config.js'

/**
 * A ready live-query Collection reports loading while current joined demand
 * is pending. Settlement or retirement ends that demand's contribution; an
 * obsolete settlement cannot hide another current load. Authority: Collection
 * isLoadingSubset's public contract and ARCHITECTURE's source cancellation and
 * status laws. Readiness stays ready after its initial empty result.
 *
 * The grammar crosses one/two sibling joins, replacement, retirement, delivery
 * with/without rows, success/failure, and settlement order. Every acquisition
 * is held until an explicit action. We observe the public flag after graph and
 * promise callbacks drain, without waiting for the held acquisitions. This is
 * a controlled core boundary, not a claim about provider or framework timing,
 * nested includes, ordered windows, replay, or callback-time reentrancy.
 */
type Scenario = {
  width: 1 | 2
  replace: boolean
  retire: boolean
  reverse: boolean
  rows: boolean
  reject: boolean
}

const scenarios = fc.record({
  width: fc.constantFrom(1 as const, 2 as const),
  replace: fc.boolean(),
  retire: fc.boolean(),
  reverse: fc.boolean(),
  rows: fc.boolean(),
  reject: fc.boolean(),
})

// Current demand and transport settlement are independent: retiring a demand
// ends its loading contribution even when its old transport remains held.
function expectedLoading(
  current: ReadonlySet<number>,
  settled: ReadonlySet<number>,
): boolean {
  return [...current].some((key) => !settled.has(key))
}

function loadingHistory(
  scenario: Scenario,
): Array<{ loading: boolean; ready: boolean }> {
  const statuses = [{ loading: false, ready: true }]
  const requested: Array<number> = []
  const settled = new Set<number>()
  let current = new Set<number>()
  for (
    let generation = 0;
    generation <= Number(scenario.replace);
    generation++
  ) {
    current = new Set(
      Array.from({ length: scenario.width }, (_, i) => generation * 2 + i + 1),
    )
    requested.push(...current)
    statuses.push({ loading: expectedLoading(current, settled), ready: true })
  }
  if (scenario.retire) {
    current.clear()
    statuses.push({ loading: false, ready: true })
  }
  for (const key of scenario.reverse ? requested.reverse() : requested) {
    settled.add(key)
    statuses.push({ loading: expectedLoading(current, settled), ready: true })
  }
  return statuses
}

function checkLoading(
  _scenario: Scenario,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof loadingHistory>,
): Verdict {
  const actual = trace.filter((entry) => entry.checkpoint === 'status')
  for (const [i, entry] of actual.entries()) {
    const mismatch = differs(
      `status ${i}`,
      'current demand loading',
      entry.value,
      expected[i],
    )
    if (mismatch) return mismatch
  }
  return (
    differs(
      'completion',
      'complete history',
      actual.length,
      expected.length,
    ) ?? { kind: 'pass' }
  )
}

async function runHistory(
  scenario: Scenario,
  record: (checkpoint: string, value: unknown) => void,
): Promise<void> {
  type Root = { id: number; left: number; right: number | null }
  type Child = { id: number }
  type Request = {
    key: number
    gate: ReturnType<typeof createDeferred<void>>
    deliver: () => void
  }
  const requests: Array<Request> = []
  let setRoot!: (row: Root | undefined) => void
  const roots = createCollection<Root>({
    getKey: (row) => row.id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        let previous: Root | undefined
        setRoot = (row) => {
          begin()
          if (row) write({ type: previous ? 'update' : 'insert', value: row })
          else if (previous) write({ type: 'delete', value: previous })
          commit()
          previous = row
        }
        markReady()
      },
    },
  })
  const child = (side: number) => {
    let acquisition = 0
    return createCollection<Child>({
      getKey: (row) => row.id,
      syncMode: 'on-demand',
      autoIndex: 'eager',
      defaultIndexType: BasicIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              const key = side + acquisition++ * 2
              const gate = createDeferred<void>()
              requests.push({
                key,
                gate,
                deliver: () => {
                  if (options.signal?.aborted) return
                  begin()
                  write({ type: 'insert', value: { id: key } })
                  commit()
                },
              })
              return gate.promise
            },
          }
        },
      },
    })
  }
  const left = child(1)
  const right = child(2)
  const query = createLiveQueryCollection({
    query: (q) =>
      q
        .from({ root: roots })
        .leftJoin({ left }, ({ root, left: row }) => eq(root.left, row.id))
        .leftJoin({ right }, ({ root, right: row }) => eq(root.right, row.id))
        .select(({ root }) => ({ id: root.id })),
  })
  const subscription = query.subscribeChanges(() => {})
  const settled = new Set<number>()
  let current = new Set<number>()
  let primaryFailure: { error: unknown } | undefined
  const observe = async () => {
    await flushPromises()
    record('status', {
      loading: query.isLoadingSubset,
      ready: query.isReady(),
    })
  }
  try {
    await query.preload()
    await observe()
    for (
      let generation = 0;
      generation <= Number(scenario.replace);
      generation++
    ) {
      const first = generation * 2 + 1
      current = new Set(
        Array.from({ length: scenario.width }, (_, i) => first + i),
      )
      setRoot({
        id: 1,
        left: first,
        right: scenario.width === 2 ? first + 1 : null,
      })
      await flushPromises()
      expect(requests.map((request) => request.key).sort()).toEqual(
        Array.from({ length: generation + 1 }, (_, g) =>
          Array.from({ length: scenario.width }, (_value, i) => g * 2 + i + 1),
        )
          .flat()
          .sort(),
      )
      record(
        'reach',
        scenario.width === 1 ? 'one pending join' : 'two pending joins',
      )
      if (generation) record('reach', 'replacement while pending')
      await observe()
    }
    if (scenario.retire) {
      current.clear()
      setRoot(undefined)
      await observe()
      record('reach', 'retired pending demand')
    }
    const order = scenario.reverse ? [...requests].reverse() : requests
    for (const request of order) {
      const wasCurrent = current.has(request.key)
      if (scenario.reject) request.gate.reject(new Error('held source failed'))
      else {
        if (scenario.rows) request.deliver()
        request.gate.resolve()
      }
      settled.add(request.key)
      await observe()
      if (wasCurrent)
        record(
          'reach',
          scenario.reject
            ? 'current failure'
            : scenario.rows
              ? 'current rows'
              : 'current empty result',
        )
      else record('reach', 'obsolete settlement')
      if (expectedLoading(current, settled))
        record('reach', 'settlement with another pending join')
    }
  } catch (error) {
    primaryFailure = { error }
    throw error
  } finally {
    subscription.unsubscribe()
    for (const request of requests) request.gate.resolve()
    await finishCleanup(primaryFailure, [
      [{ name: 'query', run: () => query.cleanup() }],
      [roots, left, right].map((collection) => ({
        name: collection.id,
        run: () => collection.cleanup(),
      })),
    ])
  }
}

const states = [
  'one pending join',
  'two pending joins',
  'replacement while pending',
  'retired pending demand',
  'current failure',
  'current rows',
  'current empty result',
  'obsolete settlement',
  'settlement with another pending join',
]
const constructions: Array<Partial<Scenario>> = [
  { width: 1 },
  { width: 2 },
  { replace: true },
  { retire: true },
  { retire: false, reject: true },
  { retire: false, reject: false, rows: true },
  { retire: false, reject: false, rows: false },
  { retire: true },
  { width: 2, retire: false },
]

oracleProperty({
  id: 'query.join-demand-loading',
  owns: [
    'src/query/live/collection-config-builder.ts#CollectionConfigBuilder.beginDemand',
  ],
  law: {
    statement:
      'A ready live-query Collection reports loading while current joined demand is pending; settlement or retirement removes only that demand contribution and readiness remains ready.',
    authority:
      'Collection.isLoadingSubset public contract and live-query ARCHITECTURE source cancellation and status laws.',
    limits:
      'Controlled core callbacks after draining graph and promise work; one/two sibling joins. No provider/framework timing, nested includes, ordered windows, replay, or callback-time reentrancy claim.',
  },
  histories: {
    arbitrary: scenarios,
    runs: 100,
    fixedSeeds: [291107],
    states,
    constructed: states.map((state, i) => ({
      name: state,
      enters: [state],
      build: (generated: Scenario) => ({ ...generated, ...constructions[i] }),
    })),
    fixed: [
      {
        name: 'ready empty query acquires its first joined demand',
        history: {
          width: 1,
          replace: false,
          retire: false,
          reverse: false,
          rows: false,
          reject: false,
        },
        enters: ['one pending join', 'current empty result'],
      },
    ],
  },
  model: loadingHistory,
  driver: runHistory,
  check: checkLoading,
})
