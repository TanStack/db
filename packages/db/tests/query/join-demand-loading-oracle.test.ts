import { fc } from '@fast-check/vitest'
import { expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import { declareOracle } from '../oracle-declaration.js'
import { createOracleReach } from '../oracle-reach.js'
import {
  oracleFixedSeed,
  oracleRandomParameters,
  oracleReplayTest,
  oracleRoute,
  oracleRouteOf,
  readOracleRunConfig,
} from '../oracle-config.js'
import { flushPromises } from '../utils.js'
import { finishCleanup } from './load-subset-source-readiness-support.js'

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

function checkLoading(
  current: ReadonlySet<number>,
  settled: ReadonlySet<number>,
  actual: { loading: boolean; ready: boolean },
): void {
  expect(actual.loading).toBe(expectedLoading(current, settled))
  expect(actual.ready).toBe(true)
}

declareOracle({
  owns: ['src/query/live/collection-config-builder.ts#beginDemand'],
  model: [expectedLoading],
  grammar: [scenarios],
  check: [checkLoading],
})

async function runHistory(
  scenario: Scenario,
  reach: ReturnType<typeof createOracleReach>,
): Promise<void> {
  reach.beginHistory()
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
    checkLoading(current, settled, {
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
      reach.reach(
        scenario.width === 1 ? 'one pending join' : 'two pending joins',
      )
      if (generation) reach.reach('replacement while pending')
      await observe()
    }
    if (scenario.retire) {
      current.clear()
      setRoot(undefined)
      await observe()
      reach.reach('retired pending demand')
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
        reach.reach(
          scenario.reject
            ? 'current failure'
            : scenario.rows
              ? 'current rows'
              : 'current empty result',
        )
      else reach.reach('obsolete settlement')
      if (expectedLoading(current, settled))
        reach.reach('settlement with another pending join')
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

const { multiplier, ...replay } = readOracleRunConfig()
for (const campaign of ['fixed', 'random'] as const) {
  const register =
    campaign === 'fixed'
      ? oracleReplayTest(it)
      : oracleReplayTest(it, 'query.join-demand-loading')
  register(`reports current joined demand loading (${campaign})`, async () => {
    const reach = createOracleReach('join-demand-loading', [
      'one pending join',
      'two pending joins',
      'replacement while pending',
      'retired pending demand',
      'current failure',
      'current rows',
      'current empty result',
      'obsolete settlement',
      'settlement with another pending join',
    ])
    const parameters =
      campaign === 'fixed'
        ? oracleFixedSeed(291107, { numRuns: 100 * multiplier })
        : oracleRandomParameters(
            100 * multiplier,
            replay,
            'query.join-demand-loading',
          )
    oracleRoute(oracleRouteOf(parameters))
    await fc.assert(
      fc.asyncProperty(scenarios, (scenario) => runHistory(scenario, reach)),
      parameters,
    )
    reach.assertReached()
    console.info(
      `join-demand-loading ${campaign}`,
      Object.fromEntries(reach.counts()),
    )
  })
}
