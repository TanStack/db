import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { createLiveQueryCollection } from '../../src/query/index.js'
import { evaluateReferenceExpression } from '../reference-expression.js'
import { flushPromises } from '../utils.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

type Row = { id: number; rank: number; version: number }
type Route = `page` | `prefix` | `boundary` | `full-source`
type Scenario = {
  route: Route
  delivery: `before-settlement` | `after-success`
  window: `keep` | `widen`
  outcome: `resolve` | `reject` | `abort-error`
  session: `retain` | `restart`
  barrier: `initial` | `replay`
  rankOffset?: number
  rankStep?: number
}

const routes: ReadonlyArray<Route> = [
  `page`,
  `prefix`,
  `boundary`,
  `full-source`,
]

async function observeHistory(scenario: Scenario) {
  const mismatches: Array<{ law: string; actual: unknown; expected: unknown }> =
    []
  const check = (law: string, actual: unknown, expected: unknown) => {
    if (!isDeepStrictEqual(actual, expected))
      mismatches.push({ law, actual, expected })
  }
  type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const truth: Array<Row> = [1, 2, 3, 4, 5].map((id) => ({
    id,
    version: 1,
    rank:
      (scenario.rankOffset ?? 0) +
      (scenario.rankStep ?? 1) *
        (scenario.route === `boundary` && id === 2 ? 1 : id),
  }))
  const referenceWindow = (limit: number) => truth.slice(0, limit)
  const gate = createDeferred<void>()
  const failure =
    scenario.outcome === `abort-error`
      ? Object.assign(new Error(`target canceled`), { name: `AbortError` })
      : new Error(`target rejected`)
  const requests: Array<{
    options: LoadSubsetOptions
    session: number
    ids: Array<number>
    indexed: boolean
    applied: boolean
  }> = []
  const released: Array<LoadSubsetOptions> = []
  const sourceCleanups: Array<number> = []
  const publications: Array<Array<Row>> = []
  const deliveredRows = new Map<string | number, Row>()
  let generation = 0
  let activeSync!: Sync
  let activeInstalled!: Set<number>
  let targetOutcome: string | undefined
  let target: (typeof requests)[number] | undefined
  let targetWrites = 0
  let appliedBeforeSettlement = false
  let replayStarted = false
  let allowTarget = scenario.barrier === `initial`
  const source = createCollection<Row, number>({
    id: `ordered-history-source-${JSON.stringify(scenario)}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex: scenario.route === `prefix` ? `off` : `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (sync: Sync) => {
        activeSync = sync
        const session = ++generation
        const installed = new Set<number>()
        activeInstalled = installed
        sync.markReady()
        return {
          loadSubset: (options) => {
            if (requests.length >= 30)
              throw new Error(`ordered history exceeded source work bound`)
            let rows = truth.filter(
              (row) =>
                !options.where ||
                evaluateReferenceExpression(options.where, row) === true,
            )
            if (options.cursor)
              rows = rows.filter(
                (row) =>
                  evaluateReferenceExpression(
                    options.cursor!.whereFrom,
                    row,
                  ) === true,
              )
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            rows = rows.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            const request = {
              options,
              session,
              ids: rows.map(({ id }) => id),
              indexed: source.indexes.size > 0,
              applied: false,
            }
            requests.push(request)
            const matchesRoute =
              scenario.route === `boundary`
                ? options.orderBy === undefined && options.where !== undefined
                : scenario.route === `full-source`
                  ? options.limit === undefined && options.where === undefined
                  : options.orderBy !== undefined && options.limit !== undefined
            const gated = allowTarget && !target && matchesRoute
            if (gated) target = request
            const apply = async () => {
              if (options.signal?.aborted || session !== generation) return
              request.applied = true
              const fresh = rows.filter(({ id }) => !installed.has(id))
              if (fresh.length === 0) return
              sync.begin()
              for (const value of fresh) {
                installed.add(value.id)
                sync.write({ type: `insert`, value })
                if (gated) targetWrites++
              }
              const receipt = sync.commit()
              if (receipt !== true) await receipt
            }
            return (async () => {
              if (gated && scenario.delivery === `before-settlement`)
                await apply()
              if (gated)
                await gate.promise.then(
                  () => {
                    targetOutcome = `resolve`
                  },
                  (error: unknown) => {
                    targetOutcome =
                      error === failure ? scenario.outcome : `unexpected`
                    throw error
                  },
                )
              if (!gated || scenario.delivery === `after-success`) await apply()
            })()
          },
          unloadSubset: (options) => {
            released.push(options)
          },
          cleanup: () => {
            sourceCleanups.push(session)
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) => {
    const from = q.from({ row: source })
    return (scenario.route === `full-source` ? from.distinct() : from)
      .orderBy(({ row }) => row.rank)
      .limit(1)
      .select(({ row }) => ({
        id: row.id,
        rank: row.rank,
        version: row.version,
      }))
  })
  const read = () =>
    live.toArray.map(({ id, rank, version }) => ({ id, rank, version }))
  const subscription = live.subscribeChanges(
    (batch) => {
      // subscribeChanges also sends an empty initial-snapshot completion callback.
      // Count row publications only when there are row deltas.
      if (batch.length === 0) return
      for (const change of batch) {
        const value = {
          id: change.value.id,
          rank: change.value.rank,
          version: change.value.version,
        }
        if (change.type === `delete`) {
          check(`delete-payload`, value, deliveredRows.get(change.key))
          deliveredRows.delete(change.key)
        } else {
          if (change.type === `update`)
            check(
              `update-previous`,
              change.previousValue && {
                id: change.previousValue.id,
                rank: change.previousValue.rank,
                version: change.previousValue.version,
              },
              deliveredRows.get(change.key),
            )
          else check(`insert-new-key`, deliveredRows.has(change.key), false)
          deliveredRows.set(change.key, value)
        }
      }
      const byId = (rows: Array<Row>) =>
        rows.slice().sort((a, b) => a.id - b.id)
      check(`message-snapshot`, byId([...deliveredRows.values()]), byId(read()))
      publications.push(read())
    },
    { includeInitialState: false },
  )
  const observe = (promise: Promise<unknown> | true) => {
    const state: { settled: boolean; error?: unknown } = { settled: false }
    const done = Promise.resolve(promise).then(
      () => {
        state.settled = true
      },
      (error: unknown) => {
        state.settled = true
        state.error = error
      },
    )
    return { state, done }
  }
  const preload = observe(live.preload())
  let move: ReturnType<typeof observe> | undefined
  let baseline: Array<Row> = []
  try {
    if (scenario.barrier === `replay`) {
      await preload.done
      expect(preload.state).toEqual({ settled: true })
      expect(read()).toEqual(referenceWindow(1))
      baseline = read()
      publications.length = 0
      allowTarget = true
      for (let index = 0; index < truth.length; index++)
        truth[index] = { ...truth[index]!, version: 2 }
      activeInstalled.clear()
      activeSync.begin()
      activeSync.truncate()
      activeSync.commit()
      replayStarted = true
    }
    for (let turn = 0; turn < 8 && !target; turn++) await flushPromises()
    expect(
      target,
      JSON.stringify({
        scenario,
        requests: requests.map(({ ids, options }) => ({
          ids,
          limit: options.limit,
          ordered: options.orderBy !== undefined,
          filtered: options.where !== undefined,
        })),
      }),
    ).toBeDefined()
    expect(target!.session).toBe(1)
    expect(target!.ids.length).toBeGreaterThan(0)
    await flushPromises()
    if (scenario.barrier === `initial`)
      expect(preload.state.settled).toBe(false)
    expect(read()).toEqual(baseline)
    check(`pending-window`, live.utils.getWindow(), { offset: 0, limit: 1 })
    expect(publications).toEqual([])
    expect(target!.applied).toBe(scenario.delivery === `before-settlement`)
    appliedBeforeSettlement = target!.applied
    if (scenario.delivery === `before-settlement`) {
      // A replay peer may have installed the same rows already. The provider
      // still completed this read; its whole selected subset must be present.
      expect(target!.ids.every((id) => source.has(id))).toBe(true)
    } else expect(targetWrites).toBe(0)
    if (scenario.window === `widen`) {
      move = observe(live.utils.setWindow({ offset: 0, limit: 3 }))
      await flushPromises()
      expect(move.state.settled).toBe(false)
      check(`pending-move-window`, live.utils.getWindow(), {
        offset: 0,
        limit: 1,
      })
      expect(publications).toEqual([])
    }
    if (scenario.session === `restart`) {
      allowTarget = false
      await live.cleanup()
      await source.cleanup()
      expect(target!.options.signal?.aborted).toBe(true)
      expect(sourceCleanups).toEqual([1])
      await preload.done
      if (scenario.barrier === `initial`)
        check(
          `cleanup-preload`,
          preload.state.error instanceof Error
            ? preload.state.error.name
            : `resolved`,
          `AbortError`,
        )
      if (move) {
        await move.done
        check(
          `cleanup-window`,
          move.state.error instanceof Error
            ? move.state.error.name
            : `resolved`,
          `AbortError`,
        )
      }
      await live.preload()
      expect(generation).toBe(2)
      check(`restarted-window`, read(), referenceWindow(1))
      check(`restarted-window-options`, live.utils.getWindow(), {
        offset: 0,
        limit: 1,
      })
    }
    const prior = read()
    const priorStatus = live.status
    const priorError = live.utils.lastSubsetError
    const callbacksBeforeSettlement = publications.length
    if (scenario.outcome === `resolve`) gate.resolve()
    else gate.reject(failure)
    for (let turn = 0; turn < 8; turn++) await flushPromises()
    expect(targetOutcome).toBe(scenario.outcome)
    // Deferred application happens only after a live attempt succeeds. Failure
    // and old-session success must not apply its rows through this provider.
    expect(target!.applied).toBe(
      scenario.delivery === `before-settlement` ||
        (scenario.outcome === `resolve` && scenario.session === `retain`),
    )
    if (scenario.session === `restart`) {
      check(`obsolete-status`, live.status, priorStatus)
      check(`obsolete-error`, live.utils.lastSubsetError === priorError, true)
      check(`obsolete-rows`, read(), prior)
      check(
        `obsolete-publication`,
        publications.length,
        callbacksBeforeSettlement,
      )
      truth[0] = { ...truth[0]!, rank: truth[0]!.rank - 1 }
      activeSync.begin()
      activeSync.write({ type: `update`, value: truth[0] })
      activeSync.commit()
      for (let turn = 0; turn < 4; turn++) await flushPromises()
      check(`restart-reactivity`, read(), referenceWindow(1))
      check(
        `restart-callback`,
        publications.length,
        callbacksBeforeSettlement + 1,
      )
    } else if (scenario.outcome === `resolve`) {
      check(`success-preload`, preload.state, { settled: true })
      check(`success-window-options`, live.utils.getWindow(), {
        offset: 0,
        limit: scenario.window === `widen` ? 3 : 1,
      })
      if (move) check(`success-window`, move.state, { settled: true })
      check(
        `success-rows`,
        read(),
        referenceWindow(scenario.window === `widen` ? 3 : 1),
      )
      const finalWindow = referenceWindow(scenario.window === `widen` ? 3 : 1)
      // A move queued behind replay may follow publication of the complete old
      // window, or coalesce with it. Neither path may expose a partial window.
      const legalPublications = [[finalWindow]]
      if (scenario.barrier === `replay` && scenario.window === `widen`) {
        legalPublications.push([referenceWindow(1), finalWindow])
      }
      check(
        `success-publication`,
        legalPublications.some((trace) =>
          isDeepStrictEqual(publications, trace),
        )
          ? `valid`
          : publications,
        `valid`,
      )
    } else {
      if (scenario.barrier === `initial`)
        check(
          `failure-preload`,
          {
            settled: preload.state.settled,
            error:
              preload.state.error === failure
                ? `target`
                : preload.state.error === undefined
                  ? `none`
                  : `other`,
          },
          { settled: true, error: `target` },
        )
      else check(`replay-error`, live.utils.lastSubsetError === failure, true)
      if (move)
        check(
          `failure-window`,
          {
            settled: move.state.settled,
            error:
              move.state.error === failure
                ? `target`
                : move.state.error === undefined
                  ? `none`
                  : `other`,
          },
          { settled: true, error: `target` },
        )
      check(`failure-rows`, read(), baseline)
      check(`failed-window-options`, live.utils.getWindow(), {
        offset: 0,
        limit: 1,
      })
      check(`failure-publication`, publications, [])
    }
  } finally {
    allowTarget = false
    gate.resolve()
    subscription.unsubscribe()
    await live.cleanup()
    await source.cleanup()
    await preload.done
    if (move) await move.done
  }
  expect(new Set(released).size).toBe(released.length)
  for (const { options } of requests)
    expect(released.filter((release) => release === options)).toHaveLength(1)
  expect(sourceCleanups).toEqual(scenario.session === `restart` ? [1, 2] : [1])
  expect(requests.every(({ options }) => options.signal?.aborted)).toBe(true)
  const route =
    target!.options.orderBy !== undefined
      ? target!.indexed
        ? `page`
        : `prefix`
      : target!.options.where !== undefined
        ? `boundary`
        : `full-source`
  return {
    route,
    authority:
      target!.options.limit === undefined && target!.options.where === undefined
        ? `full`
        : `finite`,
    generation,
    coordinates: [
      route,
      appliedBeforeSettlement ? `before-settlement` : `after-success`,
      move ? `widen` : `keep`,
      targetOutcome,
      generation === 2 ? `restart` : `retain`,
      replayStarted ? `replay` : `initial`,
    ],
    mismatches,
  }
}

async function assertHistory(scenario: Scenario) {
  const result = await observeHistory(scenario)
  expect(result.route).toBe(scenario.route)
  expect(result.authority).toBe(
    scenario.route === `full-source` ? `full` : `finite`,
  )
  expect(result.generation).toBe(scenario.session === `restart` ? 2 : 1)
  const original = {
    id: 1,
    rank: (scenario.rankOffset ?? 0) + (scenario.rankStep ?? 1),
    version: 1,
  }
  const replacement = { ...original, version: 2 }
  const updated = { ...replacement, rank: replacement.rank - 1 }
  // Exact known-red observations; all other checkpoints must satisfy the law.
  const known =
    scenario.session === `retain` &&
    scenario.barrier === `initial` &&
    scenario.route === `boundary` &&
    scenario.outcome !== `resolve`
      ? [
          {
            law: `failure-preload`,
            actual: { settled: true, error: `none` },
            expected: { settled: true, error: `target` },
          },
        ]
      : scenario.session === `restart` &&
          scenario.barrier === `replay` &&
          scenario.route === `full-source`
        ? [
            {
              law: `message-snapshot`,
              actual: [original, replacement],
              expected: [replacement],
            },
            {
              law: `message-snapshot`,
              actual: [original, updated],
              expected: [updated],
            },
          ]
        : []
  expect(result.mismatches).toEqual(known)
  return result
}

describe(`ordered lifecycle product`, () => {
  const observed = new Set<string>()
  const cells: Array<Scenario> = routes.flatMap((route) =>
    ([`before-settlement`, `after-success`] as const).flatMap((delivery) =>
      ([`keep`, `widen`] as const).flatMap((window) =>
        ([`resolve`, `reject`, `abort-error`] as const).flatMap((outcome) =>
          ([`retain`, `restart`] as const).flatMap((session) =>
            ([`initial`, `replay`] as const).map((barrier) => ({
              route,
              delivery,
              window,
              outcome,
              session,
              barrier,
            })),
          ),
        ),
      ),
    ),
  )
  it(`keeps all 192 declared histories distinct`, () => {
    expect(cells).toHaveLength(192)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(192)
  })
  it.each(cells)(
    `$route / $delivery / $window / $outcome / $session / $barrier`,
    async (scenario) => {
      const result = await assertHistory(scenario)
      observed.add(JSON.stringify(result.coordinates))
    },
  )
  it(`reaches all 192 histories through physical work and terminal cleanup`, () => {
    expect(observed.size).toBe(192)
  })
  const arbitrary = fc.record({
    route: fc.constantFrom(...routes),
    delivery: fc.constantFrom(
      `before-settlement` as const,
      `after-success` as const,
    ),
    window: fc.constantFrom(`keep` as const, `widen` as const),
    outcome: fc.constantFrom(
      `resolve` as const,
      `reject` as const,
      `abort-error` as const,
    ),
    session: fc.constantFrom(`retain` as const, `restart` as const),
    barrier: fc.constantFrom(`initial` as const, `replay` as const),
    rankOffset: fc.integer({ min: -1000, max: 1000 }),
    rankStep: fc.integer({ min: 1, max: 10 }),
  })
  const { multiplier, ...replay } = readOracleRunConfig()
  fcTest.prop([arbitrary], { numRuns: 20 * multiplier, seed: 93471 })(
    `matches the ordered lifecycle for a fixed seed`,
    async (scenario) => {
      await assertHistory(scenario)
    },
    Math.max(10000, multiplier * 1500),
  )
  fcTest.prop(
    [arbitrary],
    oracleRandomParameters(20 * multiplier, replay, `ordered-work.lifecycle`),
  )(
    `matches the ordered lifecycle for a random or replayed seed`,
    async (scenario) => {
      await assertHistory(scenario)
    },
    Math.max(10000, multiplier * 1500),
  )
})
