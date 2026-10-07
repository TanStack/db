import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
} from '../../src/query/index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { flushPromises } from '../utils.js'
import {
  oracleRandomParameters,
  readOracleRunConfig,
} from '../oracle-config.js'
import type { Collection } from '../../src/collection/index.js'
import type { LoadSubsetOptions, SyncConfig } from '../../src/types.js'

/**
 * # Which ordered request histories are distinct?
 *
 * The live-query architecture owns applied settlement, ordered continuation,
 * and atomic window publication. This refinement covers one narrower initial
 * query-readiness cut: an initial ordered load whose adapter returns literal
 * `true`, after synchronously applying every establishing receipt, installs its
 * completed window before the initiating call stack returns. The initial load
 * is an ordinary ordered request or, for a requiresFullSource plan, its first
 * full-source request. Promise settlement remains asynchronous. This does not
 * make a successful request prove source exhaustion or broader coverage, and it
 * does not change explicit window, later full-source fallback, repair, replay,
 * or framework render-time contracts.
 *
 * Ordered acquisition has six independent control dimensions: acquisition
 * path, delivery time, window change, provider-response outcome, sync run, and
 * initial-versus-replay barrier. Their 192-cell product is small enough to
 * enumerate. A constrained initial-success grammar separately crosses
 * synchronous versus Promise settlement with indexed versus prefix loading.
 * One composed fixed regression injects sibling-source input during a
 * synchronous ordered continuation. It requires graph processing before the
 * loader decides whether another acquisition is needed.
 * A second product adds nullable multi-term ordering, including null placement
 * for both terms. A four-cell overlay varies both directions independently
 * without multiplying that lifecycle product. The initial-settlement cells are
 * a bounded deterministic grammar; they do not extend the generated-history
 * campaign.
 *
 * For each cell, a plain finite source supplies the reference order and window.
 * The driver records physical acquisitions, application, readiness, errors,
 * cleanup, same-call-stack snapshot installation, and final rows from a real
 * live query.
 * Reach assertions prove every declared cell performs work and reaches
 * terminal cleanup. Deliberate secondary-order, null-placement, and
 * Promise-wrapped synchronous-result faults calibrate the checks.
 * `expectedInitialSettlementObservation` is the independent finite reference,
 * `observeInitialSettlement` is the production driver, and
 * `assertInitialSettlementObservation` is the refinement check.
 *
 * `AcquisitionPath` is a model projection over production request kinds. A
 * `page` is an indexed ordered request. A `prefix` is an unindexed ordered
 * request. `boundary` and `full-source` retain the production names.
 *
 * Grammar controls: the 192-cell product reconstructs each path with an
 * applied-before-response and a deferred-write witness, a retained and a
 * restarted sync run, and an initial and a truncate-replay barrier. Removing
 * path loses a distinct provider request; removing delivery loses the held
 * applied-receipt cut; removing window loses the pending move; removing outcome
 * loses success, ordinary rejection, or AbortError identity; removing sync run
 * loses obsolete settlement; removing barrier loses replay publication. The
 * nonnullable rank offset [-1000, 1000] and positive step [1, 10] vary numeric
 * values without changing those request shapes. Removing either value axis
 * loses translated or scaled domains. The nullable matrix uses
 * offset [-20, 20], step [1, 5], both null placements, and independent
 * directions; removing a null or direction axis loses a distinct tie order.
 * Zero step and unbounded values are outside these finite
 * grammars. A null-first prefix already retired cannot be the target of a
 * later replay repair, so that nearby invalid scenario is excluded.
 *
 * Known omissions: multiple pending joined plans during a window move and a
 * public-query failed-retry overlap remain with the ordered-acquisition owner
 * in the coverage map. These fixtures use a controlled finite source; they do
 * not establish a real provider's ordering or cancellation behavior.
 */

type Row = {
  id: number
  rank: number | null
  secondary: number | null
  version: number
}
type OrderTerm = { direction: `asc` | `desc`; nulls: `first` | `last` }
type AcquisitionPath = `page` | `prefix` | `boundary` | `full-source`
type InitialSettlementShape = `synchronous` | `promise`
// The controlled providerResponse gate models a provider response, not the
// loadSubset result. Both delivery schedules await establishing applied receipts
// before acquisition fulfillment; only their order around this response differs.
type Scenario = {
  acquisitionPath: AcquisitionPath
  delivery: `before-provider-response` | `after-provider-response`
  window: `keep` | `widen`
  outcome: `resolve` | `reject` | `abort-error`
  syncRun: `retain` | `restart`
  barrier: `initial` | `replay`
  rankOffset?: number
  rankStep?: number
  nullable?: { primary: OrderTerm; secondary: OrderTerm }
  repair?: boolean
}

type CapturedOracleFailure = { error: unknown }

async function finishOracleCleanup(
  primaryFailure: CapturedOracleFailure | undefined,
  cleanups: ReadonlyArray<() => unknown | Promise<unknown>>,
  message: string,
): Promise<void> {
  const results = await Promise.allSettled(
    cleanups.map((cleanup) => Promise.resolve().then(cleanup)),
  )
  const cleanupFailures = results.flatMap((result) =>
    result.status === `rejected` ? [result.reason] : [],
  )
  if (!primaryFailure) {
    if (cleanupFailures.length === 0) return
    throw new AggregateError(cleanupFailures, message, {
      cause: cleanupFailures[0],
    })
  }
  if (cleanupFailures.length === 0) throw primaryFailure.error
  throw new AggregateError(
    [primaryFailure.error, ...cleanupFailures],
    message,
    {
      cause: primaryFailure.error,
    },
  )
}

function compareNullable(
  left: unknown,
  right: unknown,
  term: OrderTerm,
): number {
  if (left === right) return 0
  if (left === null) return term.nulls === `first` ? -1 : 1
  if (right === null) return term.nulls === `first` ? 1 : -1
  if (typeof left !== `number` || typeof right !== `number`)
    throw new Error(`numeric/null palette only`)
  return (left < right ? -1 : 1) * (term.direction === `asc` ? 1 : -1)
}

// This fixed nine-row palette is a second formulation of the nullable order.
// Primary groups are null, -2, +2; each group has secondary null, +2, -2.
// The table states the expected group order without calling compareNullable.
// Each unique ID occurs once. This checks the full ID order; the warm zero-window
// witness and lifecycle result checks own emptiness and row payloads.
function expectedNullablePaletteIds(
  primary: OrderTerm,
  secondary: OrderTerm,
): Array<number> {
  const primaryGroups = {
    'first/asc': [0, 1, 2],
    'first/desc': [0, 2, 1],
    'last/asc': [1, 2, 0],
    'last/desc': [2, 1, 0],
  } as const
  const secondaryPositions = {
    'first/asc': [0, 2, 1],
    'first/desc': [0, 1, 2],
    'last/asc': [2, 1, 0],
    'last/desc': [1, 2, 0],
  } as const
  return primaryGroups[`${primary.nulls}/${primary.direction}`].flatMap(
    (group) =>
      secondaryPositions[`${secondary.nulls}/${secondary.direction}`].map(
        (position) => 3 * group + position + 1,
      ),
  )
}

const acquisitionPaths: ReadonlyArray<AcquisitionPath> = [
  `page`,
  `prefix`,
  `boundary`,
  `full-source`,
]

async function observeHistory(
  scenario: Scenario,
  fault?: `secondary-order` | `null-placement`,
) {
  const mismatches: Array<{ law: string; actual: unknown; expected: unknown }> =
    []
  const check = (law: string, actual: unknown, expected: unknown) => {
    if (!isDeepStrictEqual(actual, expected))
      mismatches.push({ law, actual, expected })
  }
  type Sync = Parameters<SyncConfig<Row, number>[`sync`]>[0]
  const finiteValue = (value: number | null) =>
    value === null
      ? null
      : (scenario.rankOffset ?? 0) + (scenario.rankStep ?? 1) * value
  const truth: Array<Row> = (
    scenario.nullable ? [1, 2, 3, 4, 5, 6, 7, 8, 9] : [1, 2, 3, 4, 5]
  ).map((id) => ({
    id,
    version: 1,
    secondary: scenario.nullable
      ? finiteValue([null, 2, -2][(id - 1) % 3]!)
      : 0,
    rank: scenario.nullable
      ? finiteValue([null, -2, 2][Math.floor((id - 1) / 3)]!)
      : (scenario.rankOffset ?? 0) +
        (scenario.rankStep ?? 1) *
          (scenario.acquisitionPath === `boundary` && id === 2 ? 1 : id),
  }))
  const primary =
    scenario.nullable?.primary ??
    ({ direction: `asc`, nulls: `first` } as const)
  const secondary =
    scenario.nullable?.secondary ??
    ({ direction: `asc`, nulls: `first` } as const)
  const referenceWindow = (limit: number) =>
    [...truth]
      .sort(
        (a, b) =>
          compareNullable(a.rank, b.rank, primary) ||
          (scenario.nullable
            ? compareNullable(a.secondary, b.secondary, secondary)
            : 0) ||
          a.id - b.id,
      )
      .slice(0, limit)
  const providerResponse = createDeferred<void>()
  const failure =
    scenario.outcome === `abort-error`
      ? Object.assign(new Error(`target canceled`), { name: `AbortError` })
      : new Error(`target rejected`)
  const requests: Array<{
    options: LoadSubsetOptions
    syncRunGeneration: number
    ids: Array<number>
    indexed: boolean
    applied: boolean
  }> = []
  const released: Array<LoadSubsetOptions> = []
  const sourceCleanups: Array<number> = []
  const publications: Array<Array<Row>> = []
  const deliveredRows = new Map<string | number, Row>()
  let syncRunGeneration = 0
  let activeSync!: Sync
  let activeInstalled!: Set<number>
  let targetOutcome: string | undefined
  let target: (typeof requests)[number] | undefined
  let targetWrites = 0
  let appliedBeforeResponse = false
  let replayStarted = false
  let repaired = false
  let allowTarget = scenario.barrier === `initial`
  const source = createCollection<Row, number>({
    id: `ordered-history-source-${JSON.stringify(scenario)}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex: scenario.acquisitionPath === `prefix` ? `off` : `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (sync: Sync) => {
        activeSync = sync
        const requestSyncRunGeneration = ++syncRunGeneration
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
            if (options.orderBy)
              rows.sort((a, b) => {
                for (const term of options.orderBy!) {
                  const compared = compareNullable(
                    evaluateReferenceExpression(term.expression, a),
                    evaluateReferenceExpression(term.expression, b),
                    term.compareOptions,
                  )
                  if (compared) return compared
                }
                return a.id - b.id
              })
            const offset = options.cursor ? 0 : (options.offset ?? 0)
            rows = rows.slice(
              offset,
              options.limit === undefined ? undefined : offset + options.limit,
            )
            const request = {
              options,
              syncRunGeneration: requestSyncRunGeneration,
              ids: rows.map(({ id }) => id),
              indexed: source.indexes.size > 0,
              applied: false,
            }
            requests.push(request)
            const matchesRoute =
              scenario.acquisitionPath === `boundary`
                ? options.orderBy === undefined && options.where !== undefined
                : scenario.acquisitionPath === `full-source`
                  ? options.limit === undefined && options.where === undefined
                  : options.orderBy !== undefined && options.limit !== undefined
            const gated = allowTarget && !target && matchesRoute
            if (gated) target = request
            const apply = async () => {
              if (
                options.signal?.aborted ||
                requestSyncRunGeneration !== syncRunGeneration
              )
                return
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
              if (gated && scenario.delivery === `before-provider-response`)
                await apply()
              if (gated)
                await providerResponse.promise.then(
                  () => {
                    targetOutcome = `resolve`
                  },
                  (error: unknown) => {
                    targetOutcome =
                      error === failure ? scenario.outcome : `unexpected`
                    throw error
                  },
                )
              if (!gated || scenario.delivery === `after-provider-response`)
                await apply()
            })()
          },
          unloadSubset: (options) => {
            released.push(options)
          },
          cleanup: () => {
            sourceCleanups.push(requestSyncRunGeneration)
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection((q) => {
    const from = q.from({ row: source })
    const ordered = (
      scenario.acquisitionPath === `full-source` && !scenario.nullable
        ? from.distinct()
        : from
    ).orderBy(
      ({ row }) => row.rank,
      fault === `null-placement`
        ? { ...primary, nulls: primary.nulls === `first` ? `last` : `first` }
        : primary,
    )
    const query = scenario.nullable
      ? ordered.orderBy(
          ({ row }) => row.secondary,
          fault === `secondary-order`
            ? {
                ...secondary,
                direction: secondary.direction === `asc` ? `desc` : `asc`,
              }
            : secondary,
        )
      : ordered
    return query.limit(1).select(({ row }) => ({
      id: row.id,
      rank: row.rank,
      secondary: row.secondary,
      version: row.version,
    }))
  })
  const read = () =>
    live.toArray.map(({ id, rank, secondary: secondaryValue, version }) => ({
      id,
      rank,
      secondary: secondaryValue,
      version,
    }))
  const subscription = live.subscribeChanges(
    (batch) => {
      // subscribeChanges also sends an empty initial-snapshot completion callback.
      // Count row publications only when there are row deltas.
      if (batch.length === 0) return
      for (const change of batch) {
        const value = {
          id: change.value.id,
          rank: change.value.rank,
          secondary: change.value.secondary,
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
                secondary: change.previousValue.secondary,
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
  let primaryFailure: CapturedOracleFailure | undefined
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
    expect(target!.syncRunGeneration).toBe(1)
    expect(target!.ids.length).toBeGreaterThan(0)
    await flushPromises()
    if (scenario.barrier === `initial`)
      expect(preload.state.settled).toBe(false)
    expect(read()).toEqual(baseline)
    check(`pending-window`, live.utils.getWindow(), { offset: 0, limit: 1 })
    expect(publications).toEqual([])
    expect(target!.applied).toBe(
      scenario.delivery === `before-provider-response`,
    )
    appliedBeforeResponse = target!.applied
    if (scenario.delivery === `before-provider-response`) {
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
    if (scenario.syncRun === `restart`) {
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
      expect(syncRunGeneration).toBe(2)
      check(`restarted-window`, read(), referenceWindow(1))
      check(`restarted-window-options`, live.utils.getWindow(), {
        offset: 0,
        limit: 1,
      })
    }
    const prior = read()
    const priorStatus = live.status
    const priorError = live.utils.lastSubsetError
    const callbacksBeforeResponse = publications.length
    if (scenario.outcome === `resolve`) providerResponse.resolve()
    else providerResponse.reject(failure)
    for (let turn = 0; turn < 8; turn++) await flushPromises()
    expect(targetOutcome).toBe(scenario.outcome)
    // Deferred application follows provider-response fulfillment in the current
    // sync run. A failed or obsolete response must not apply rows.
    expect(target!.applied).toBe(
      scenario.delivery === `before-provider-response` ||
        (scenario.outcome === `resolve` && scenario.syncRun === `retain`),
    )
    if (scenario.syncRun === `restart`) {
      check(`obsolete-status`, live.status, priorStatus)
      check(`obsolete-error`, live.utils.lastSubsetError === priorError, true)
      check(`obsolete-rows`, read(), prior)
      check(
        `obsolete-publication`,
        publications.length,
        callbacksBeforeResponse,
      )
      const first = referenceWindow(1)[0]!
      const firstIndex = truth.findIndex((row) => row.id === first.id)
      truth[firstIndex] = scenario.nullable
        ? { ...first, version: first.version + 1 }
        : { ...first, rank: first.rank! - 1 }
      activeSync.begin()
      activeSync.write({ type: `update`, value: truth[firstIndex] })
      activeSync.commit()
      for (let turn = 0; turn < 4; turn++) await flushPromises()
      check(`restart-reactivity`, read(), referenceWindow(1))
      check(
        `restart-callback`,
        publications.length,
        callbacksBeforeResponse + 1,
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
      if (scenario.repair) {
        const beforeRetry = requests.length
        // A failed source replacement is not an ordered-request failure.
        // Window work cannot reopen it even when the source itself is ready.
        await expect(
          live.utils.setWindow({ offset: 0, limit: 3 }),
        ).rejects.toBe(failure)
        expect(requests).toHaveLength(beforeRetry)
        expect(read()).toEqual(baseline)
        expect(live.utils.getWindow()).toEqual({ offset: 0, limit: 1 })
        expect(live.utils.lastSubsetError).toBe(failure)
        expect(source.status).toBe(`ready`)
        activeInstalled.clear()
        activeSync.begin()
        activeSync.truncate()
        const repairReceipt = activeSync.commit()
        if (repairReceipt !== true) await repairReceipt
        for (let turn = 0; turn < 8; turn++) await flushPromises()
        await live.utils.setWindow({ offset: 0, limit: 3 })
        const retry = requests.slice(beforeRetry)
        check(
          `repair-authoritative-request`,
          retry.some(
            ({ options }) =>
              options.limit === undefined &&
              options.cursor === undefined &&
              options.where === undefined,
          ),
          true,
        )
        check(`repair-window`, read(), referenceWindow(3))
        check(`repair-window-options`, live.utils.getWindow(), {
          offset: 0,
          limit: 3,
        })
        repaired = true
      }
    }
  } catch (error) {
    primaryFailure = { error }
  }
  if (mismatches.length > 0) {
    let mismatchError: unknown
    try {
      expect(mismatches).toEqual([])
    } catch (error) {
      mismatchError = error
    }
    primaryFailure = {
      error: primaryFailure
        ? new AggregateError(
            [mismatchError, primaryFailure.error],
            `Ordered lifecycle mismatch preceded a driver failure`,
            { cause: mismatchError },
          )
        : mismatchError,
    }
  }
  allowTarget = false
  await finishOracleCleanup(
    primaryFailure,
    [
      () => providerResponse.resolve(),
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => source.cleanup(),
      () => preload.done,
      ...(move ? [() => move.done] : []),
    ],
    `Ordered lifecycle oracle cleanup failed`,
  )
  expect(new Set(released).size).toBe(released.length)
  for (const { options } of requests)
    expect(released.filter((release) => release === options)).toHaveLength(1)
  expect(sourceCleanups).toEqual(scenario.syncRun === `restart` ? [1, 2] : [1])
  expect(requests.every(({ options }) => options.signal?.aborted)).toBe(true)
  const acquisitionPath =
    target!.options.orderBy !== undefined
      ? target!.indexed
        ? `page`
        : `prefix`
      : target!.options.where !== undefined
        ? `boundary`
        : `full-source`
  return {
    acquisitionPath,
    authority:
      target!.options.limit === undefined && target!.options.where === undefined
        ? `full`
        : `finite`,
    syncRunGeneration,
    repaired,
    orderedRequests: requests.filter(
      ({ options }) => options.orderBy !== undefined,
    ).length,
    tieRequests: requests.filter(
      ({ options, ids }) =>
        options.orderBy === undefined &&
        options.where !== undefined &&
        ids.length > 1,
    ).length,
    fullSourceRequests: requests.filter(
      ({ options }) =>
        options.limit === undefined && options.where === undefined,
    ).length,
    coordinates: [
      acquisitionPath,
      appliedBeforeResponse
        ? `before-provider-response`
        : `after-provider-response`,
      move ? `widen` : `keep`,
      targetOutcome,
      syncRunGeneration === 2 ? `restart` : `retain`,
      replayStarted ? `replay` : `initial`,
    ],
    mismatches,
  }
}

async function assertHistory(
  scenario: Scenario,
  fault?: `secondary-order` | `null-placement`,
) {
  const result = await observeHistory(scenario, fault)
  expect(result.acquisitionPath).toBe(scenario.acquisitionPath)
  expect(result.authority).toBe(
    scenario.acquisitionPath === `full-source` ? `full` : `finite`,
  )
  expect(result.syncRunGeneration).toBe(scenario.syncRun === `restart` ? 2 : 1)
  expect(result.mismatches).toEqual([])
  return result
}

type InitialSettlementObservation = {
  rows: Array<number>
  status: string
}

type InitialAcquisitionPath = `page` | `prefix`

function expectedInitialSettlementObservation(
  settlement: InitialSettlementShape,
): InitialSettlementObservation {
  return settlement === `synchronous`
    ? { rows: [1, 2], status: `ready` }
    : { rows: [], status: `loading` }
}

function assertInitialSettlementObservation(
  observed: InitialSettlementObservation,
  settlement: InitialSettlementShape,
): void {
  const expected = expectedInitialSettlementObservation(settlement)
  if (!isDeepStrictEqual(observed, expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, received ${JSON.stringify(observed)}`,
    )
  }
}

function observeInitialAcquisitionPath(
  requests: ReadonlyArray<LoadSubsetOptions>,
): InitialAcquisitionPath {
  const initial = requests[0]
  if (initial?.orderBy?.length !== 1 || initial.limit !== 2) {
    throw new Error(`Expected one ordered initial request with limit 2`)
  }
  if (initial.offset === 0) return `page`
  if (initial.offset === undefined) return `prefix`
  throw new Error(`Unexpected initial ordered offset: ${initial.offset}`)
}

function assertInitialBoundaryContinuation(
  requests: ReadonlyArray<LoadSubsetOptions>,
): void {
  const continuation = requests[1]
  if (
    requests.length !== 2 ||
    continuation?.where === undefined ||
    continuation.orderBy !== undefined ||
    continuation.limit !== undefined ||
    continuation.cursor !== undefined ||
    continuation.offset !== undefined
  ) {
    throw new Error(`Expected one predicate-only boundary continuation`)
  }
}

async function observeInitialSettlement(
  settlement: InitialSettlementShape,
  autoIndex: `eager` | `off`,
) {
  type InitialRow = { id: number; rank: number }
  const rows: Array<InitialRow> = [
    { id: 1, rank: 1 },
    { id: 2, rank: 2 },
  ]
  const delivered = new Set<number>()
  const requests: Array<LoadSubsetOptions> = []
  const releases: Array<LoadSubsetOptions> = []
  let sync!: Parameters<SyncConfig<InitialRow, number>[`sync`]>[0]
  const source = createCollection<InitialRow, number>({
    id: `ordered-initial-settlement-${settlement}-${autoIndex}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex,
    defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            requests.push(options)
            const fresh = rows.filter(({ id }) => !delivered.has(id))
            if (fresh.length > 0) {
              sync.begin()
              for (const value of fresh) {
                delivered.add(value.id)
                sync.write({ type: `insert`, value })
              }
              expect(sync.commit()).toBe(true)
            }
            return settlement === `synchronous` ? true : Promise.resolve()
          },
          unloadSubset: (options) => releases.push(options),
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: false,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.rank)
        .limit(2),
  })
  const subscription = live.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const observeCurrent = (): InitialSettlementObservation => ({
    rows: live.toArray.map(({ id }) => id),
    status: live.status,
  })

  let observation:
    | {
        immediate: InitialSettlementObservation
        settled: InitialSettlementObservation
        requests: Array<LoadSubsetOptions>
        releases: Array<LoadSubsetOptions>
      }
    | undefined
  let primaryFailure: CapturedOracleFailure | undefined
  try {
    const preload = live.preload()
    const immediate = observeCurrent()
    assertInitialSettlementObservation(immediate, settlement)
    await preload
    const settled = observeCurrent()
    expect(settled).toEqual({ rows: [1, 2], status: `ready` })
    expect(observeInitialAcquisitionPath(requests)).toBe(
      autoIndex === `eager` ? `page` : `prefix`,
    )
    assertInitialBoundaryContinuation(requests)
    observation = { immediate, settled, requests, releases }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => source.cleanup(),
    ],
    `Initial-settlement oracle cleanup failed`,
  )
  return observation!
}

describe(`oracle harness failure fidelity`, () => {
  it(`preserves the primary mismatch and every cleanup diagnostic`, async () => {
    const primary = new Error(`primary mismatch`)
    const firstCleanup = new Error(`first cleanup failed`)
    const secondCleanup = new Error(`second cleanup failed`)
    const attempted: Array<string> = []
    let observed: unknown

    try {
      await finishOracleCleanup(
        { error: primary },
        [
          () => {
            attempted.push(`first`)
            throw firstCleanup
          },
          () => {
            attempted.push(`second`)
            throw secondCleanup
          },
        ],
        `Hostile cleanup control`,
      )
    } catch (error) {
      observed = error
    }

    expect(attempted).toEqual([`first`, `second`])
    expect(observed).toBeInstanceOf(AggregateError)
    expect((observed as AggregateError).cause).toBe(primary)
    expect((observed as AggregateError).errors).toEqual([
      primary,
      firstCleanup,
      secondCleanup,
    ])
  })
})

describe(`synchronous initial settlement refinement`, () => {
  const cells = ([`eager`, `off`] as const).flatMap((autoIndex) =>
    ([`synchronous`, `promise`] as const).map((settlement) => ({
      autoIndex,
      settlement,
    })),
  )

  it(`enumerates every initial path and settlement cell exactly once`, () => {
    expect(cells).toHaveLength(4)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(4)
  })

  it.each(cells)(
    `publishes the complete initial window at the $settlement checkpoint with $autoIndex indexing`,
    async ({ settlement, autoIndex }) => {
      const observed = await observeInitialSettlement(settlement, autoIndex)
      assertInitialSettlementObservation(observed.immediate, settlement)
      expect(observed.settled).toEqual({
        rows: [1, 2],
        status: `ready`,
      })
      expect(observeInitialAcquisitionPath(observed.requests)).toBe(
        autoIndex === `eager` ? `page` : `prefix`,
      )
      assertInitialBoundaryContinuation(observed.requests)
      expect(observed.releases).toHaveLength(observed.requests.length)
      observed.requests.forEach((request, index) => {
        expect(observed.releases[index]).toBe(request)
      })
    },
  )

  // The synchronous cut covers ordinary ordered requests only. A query that
  // must read its whole source first (here a function filter) keeps its
  // asynchronous initial settlement, even over an eager source whose rows
  // are already installed. The eager prefix-repair cut must not widen it.
  // #2055 pinned main's asynchronous timing here while its repair change stayed
  // narrow. The initial full-source load now shares the initial synchronous
  // cut, so the same query is ready at creation.
  it(`publishes an eager full-source ordered window at creation`, async () => {
    const source = createCollection<{ id: number; rank: number }, number>({
      id: `full-source-initial-${Math.random()}`,
      getKey: (row) => row.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let id = 0; id < 5; id++) {
            write({ type: `insert`, value: { id, rank: id } })
          }
          commit()
          markReady()
        },
      },
    })
    source.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: source })
          .fn.where(({ row }) => row.rank >= 0)
          .orderBy(({ row }) => row.rank, `desc`)
          .limit(2),
    })
    try {
      expect({
        status: query.status,
        rows: query.toArray.map((row) => row.id),
      }).toEqual({ status: `ready`, rows: [4, 3] })
    } finally {
      await query.cleanup()
      await source.cleanup()
    }
  })

  // The initial full-source cut and #2055's joined-filter rule meet here. A
  // function filter makes the plan read its whole source, so its synchronous
  // initial load installs every source row. #2055's hazard needs a bounded read
  // that left an eligible row out; after a full read the window can always
  // reach the next eligible row, even when a distant row entered through a live
  // update first. This pins that the synchronous initial load keeps that
  // property through later changes.
  it(`keeps the first eligible joined rows after a synchronous full-source load`, async () => {
    type Row = { id: number; rank: number; label: string }
    let source: Parameters<SyncConfig<Row, number>[`sync`]>[0] | undefined
    const writeRow = (
      message: { type: `update`; value: Row } | { type: `delete`; key: number },
    ) => {
      source!.begin()
      source!.write(message)
      source!.commit()
    }
    const rows = createCollection<Row, number>({
      id: `full-source-joined-rows-${Math.random()}`,
      getKey: (row) => row.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: (params) => {
          source = params
          params.begin()
          for (let id = 1; id <= 10; id++) {
            params.write({
              type: `insert`,
              value: { id, rank: id, label: `a` },
            })
          }
          params.commit()
          params.markReady()
        },
      },
    })
    rows.createIndex((row) => row.rank, { indexType: BTreeIndex })
    const markers = createCollection<{ id: number; rowId: number }, number>({
      id: `full-source-joined-markers-${Math.random()}`,
      getKey: (marker) => marker.id,
      syncMode: `eager`,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (let id = 2; id <= 10; id += 2) {
            write({ type: `insert`, value: { id, rowId: id } })
          }
          commit()
          markReady()
        },
      },
    })
    const query = createLiveQueryCollection({
      startSync: true,
      query: (q) =>
        q
          .from({ row: rows })
          .leftJoin({ marker: markers }, ({ row, marker }) =>
            eq(row.id, marker.rowId),
          )
          .where(({ marker }) => not(isUndefined(marker.rowId)))
          .fn.where(({ row }) => row.rank > 0)
          .orderBy(({ row }) => row.rank)
          .limit(1),
    })
    const ids = () => query.toArray.map((result) => result.row.id)
    try {
      expect({ status: query.status, ids: ids() }).toEqual({
        status: `ready`,
        ids: [2],
      })
      // A label-only update brings the distant row 10 into the graph.
      writeRow({ type: `update`, value: { id: 10, rank: 10, label: `b` } })
      await flushPromises()
      expect(ids()).toEqual([2])
      // Deleting the visible row must expose the next eligible row, 4.
      writeRow({ type: `delete`, key: 2 })
      await flushPromises()
      expect(ids()).toEqual([4])
    } finally {
      await query.cleanup()
      await markers.cleanup()
      await rows.cleanup()
    }
  })

  it(`rejects the old Promise-wrapped observation at the synchronous checkpoint`, () => {
    expect(() =>
      assertInitialSettlementObservation(
        expectedInitialSettlementObservation(`promise`),
        `synchronous`,
      ),
    ).toThrow()
  })

  it(`processes sibling source input before draining an ordered continuation`, async () => {
    type LeftRow = { id: number; group: string; rank: number }
    type RightRow = { id: number; group: string }

    let rightSync!: Parameters<SyncConfig<RightRow, number>[`sync`]>[0]
    const right = createCollection<RightRow, number>({
      id: `ordered-initial-cross-source-right`,
      getKey: ({ id }) => id,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: (operations) => {
          rightSync = operations
          operations.markReady()
        },
      },
    })

    const requests: Array<LoadSubsetOptions> = []
    let wroteSiblingInput = false
    const left = createCollection<LeftRow, number>({
      id: `ordered-initial-cross-source-left`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      autoIndex: `eager`,
      defaultIndexType: BTreeIndex,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              requests.push(options)
              if (requests.length === 1) {
                begin()
                write({
                  type: `insert`,
                  value: { id: 1, group: `shared`, rank: 1 },
                })
                expect(commit()).toBe(true)
              } else if (!wroteSiblingInput) {
                wroteSiblingInput = true
                rightSync.begin()
                rightSync.write({
                  type: `insert`,
                  value: { id: 10, group: `shared` },
                })
                rightSync.write({
                  type: `insert`,
                  value: { id: 11, group: `shared` },
                })
                expect(rightSync.commit()).toBe(true)
              }
              return true
            },
            unloadSubset: () => {},
          }
        },
      },
    })

    const live = createLiveQueryCollection({
      id: `ordered-initial-cross-source-live`,
      startSync: false,
      query: (q) =>
        q
          .from({ left })
          .leftJoin({ right }, ({ left: leftRow, right: rightRow }) =>
            eq(leftRow.group, rightRow.group),
          )
          .orderBy(({ left: leftRow }) => leftRow.rank)
          .limit(2)
          .select(({ left: leftRow, right: rightRow }) => ({
            id: leftRow.id,
            rightId: rightRow.id,
          })),
    })
    const readyRows: Array<Array<number | undefined>> = []
    const unsubscribeStatus = live.on(`status:ready`, () => {
      readyRows.push(live.toArray.map(({ rightId }) => rightId))
    })

    try {
      const preload = live.preload()
      const immediate = {
        rows: live.toArray.map(({ rightId }) => rightId),
        status: live.status,
      }
      await preload

      expect(wroteSiblingInput).toBe(true)
      expect(
        requests.map(({ orderBy, limit, offset, where, cursor }) => ({
          orderTerms: orderBy?.length ?? 0,
          limit,
          offset,
          hasWhere: where !== undefined,
          hasCursor: cursor !== undefined,
        })),
      ).toEqual([
        {
          orderTerms: 1,
          limit: 2,
          offset: 0,
          hasWhere: false,
          hasCursor: false,
        },
        {
          orderTerms: 0,
          limit: undefined,
          offset: undefined,
          hasWhere: true,
          hasCursor: false,
        },
      ])
      expect(readyRows).toEqual([[10, 11]])
      expect(immediate).toEqual({ rows: [10, 11], status: `ready` })
      expect({
        rows: live.toArray.map(({ rightId }) => rightId),
        status: live.status,
      }).toEqual({ rows: [10, 11], status: `ready` })
    } finally {
      unsubscribeStatus()
      await Promise.all([live.cleanup(), left.cleanup(), right.cleanup()])
    }
  })
})

describe(`ordered lifecycle product`, () => {
  const observed = new Set<string>()
  const cells: Array<Scenario> = acquisitionPaths.flatMap((acquisitionPath) =>
    ([`before-provider-response`, `after-provider-response`] as const).flatMap(
      (delivery) =>
        ([`keep`, `widen`] as const).flatMap((window) =>
          ([`resolve`, `reject`, `abort-error`] as const).flatMap((outcome) =>
            ([`retain`, `restart`] as const).flatMap((syncRun) =>
              ([`initial`, `replay`] as const).map((barrier) => ({
                acquisitionPath,
                delivery,
                window,
                outcome,
                syncRun,
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
    `$acquisitionPath / $delivery / $window / $outcome / $syncRun / $barrier`,
    async (scenario) => {
      const result = await assertHistory(scenario)
      observed.add(JSON.stringify(result.coordinates))
    },
  )
  it(`reaches all 192 histories through physical work and terminal cleanup`, () => {
    expect(observed.size).toBe(192)
  })
  const arbitrary = fc.record({
    acquisitionPath: fc.constantFrom(...acquisitionPaths),
    delivery: fc.constantFrom(
      `before-provider-response` as const,
      `after-provider-response` as const,
    ),
    window: fc.constantFrom(`keep` as const, `widen` as const),
    outcome: fc.constantFrom(
      `resolve` as const,
      `reject` as const,
      `abort-error` as const,
    ),
    syncRun: fc.constantFrom(`retain` as const, `restart` as const),
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

describe(`warm ordered readiness oracle`, () => {
  it.each([
    { limit: 0, expectedRequests: [] },
    {
      limit: 50,
      expectedRequests: [
        { ordered: true, filtered: false, limit: 50 },
        { ordered: false, filtered: false, limit: undefined },
      ],
    },
  ])(
    `settles a retained $limit-row window after an async cold prime`,
    async ({ limit, expectedRequests }) => {
      type DatedRow = { id: number; createdAt: Date | null }
      const remote: Array<DatedRow> = [
        { id: 1, createdAt: new Date(`2026-01-03T00:00:00.000Z`) },
        { id: 2, createdAt: null },
        { id: 3, createdAt: new Date(`2026-01-01T00:00:00.000Z`) },
        { id: 4, createdAt: new Date(`2026-01-02T00:00:00.000Z`) },
      ]
      const installed = new Set<number>()
      const warmRequests: Array<{
        ordered: boolean
        filtered: boolean
        limit: number | undefined
      }> = []
      let cold = true
      const source = createCollection<DatedRow, number>({
        id: `warm-ordered-readiness-${limit}`,
        getKey: ({ id }) => id,
        syncMode: `on-demand`,
        autoIndex: `eager`,
        defaultIndexType: BTreeIndex,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            markReady()
            return {
              loadSubset: (options) => {
                if (!cold) {
                  warmRequests.push({
                    ordered: options.orderBy !== undefined,
                    filtered: options.where !== undefined,
                    limit: options.limit,
                  })
                }
                const missing = remote.filter(({ id }) => !installed.has(id))
                if (missing.length > 0) {
                  begin()
                  for (const row of missing) {
                    installed.add(row.id)
                    write({ type: `insert`, value: row })
                  }
                  commit()
                }
                return cold ? Promise.resolve() : true
              },
            }
          },
        },
      })
      const query = (queryLimit: number) =>
        createLiveQueryCollection({
          query: (q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.createdAt, {
                direction: `asc`,
                nulls: `last`,
              })
              .limit(queryLimit),
          startSync: true,
        })
      const coldQuery = query(50)
      try {
        await coldQuery.preload()
        cold = false

        const warmQuery = query(limit)
        try {
          if (limit > 0) {
            // The null cursor requires a full-source fallback, outside the
            // ordinary ordered chain's synchronous-readiness promise.
            expect(warmQuery.status).toBe(`loading`)
            await warmQuery.preload()
          }
          expect(warmQuery.status).toBe(`ready`)
          expect(warmQuery.isLoadingSubset).toBe(false)
          expect(warmQuery.toArray.map(({ id }) => id)).toEqual(
            limit === 0 ? [] : [3, 4, 1, 2],
          )
          expect(warmRequests).toEqual(expectedRequests)
        } finally {
          await warmQuery.cleanup()
        }
      } finally {
        await coldQuery.cleanup()
        await source.cleanup()
      }
    },
  )

  it(`makes a retained nonzero-offset prefix and boundary synchronously ready`, async () => {
    type WarmRow = { id: number; rank: number; tie: number }
    const remote: Array<WarmRow> = [
      { id: 1, rank: 1, tie: 1 },
      { id: 2, rank: 2, tie: 1 },
      { id: 3, rank: 3, tie: 1 },
      { id: 4, rank: 4, tie: 1 },
    ]
    const installed = new Set<number>()
    const warmRequests: Array<{
      ordered: boolean
      filtered: boolean
      limit: number | undefined
    }> = []
    let cold = true
    const source = createCollection<WarmRow, number>({
      id: `warm-offset-prefix-readiness`,
      getKey: ({ id }) => id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          markReady()
          return {
            loadSubset: (options) => {
              if (!cold) {
                warmRequests.push({
                  ordered: options.orderBy !== undefined,
                  filtered: options.where !== undefined,
                  limit: options.limit,
                })
              }
              const missing = remote.filter(({ id }) => !installed.has(id))
              if (missing.length > 0) {
                begin()
                for (const row of missing) {
                  installed.add(row.id)
                  write({ type: `insert`, value: row })
                }
                commit()
              }
              return cold ? Promise.resolve() : true
            },
          }
        },
      },
    })
    const query = () =>
      createLiveQueryCollection({
        query: (q) =>
          q
            .from({ row: source })
            .orderBy(({ row }) => row.rank, `asc`)
            .orderBy(({ row }) => row.tie, `asc`)
            .offset(1)
            .limit(2),
      })
    const owner = query()
    try {
      await owner.preload()
      cold = false
      const sibling = query()
      try {
        // Construction starts no provider work. The sibling's first preload
        // starts its sync run, and both warm acquisitions return true, so it
        // is ready before preload returns: the synchronous observation cut.
        expect(warmRequests).toEqual([])
        void sibling.preload()
        expect(sibling.status).toBe(`ready`)
        expect(sibling.toArray.map(({ id }) => id)).toEqual([2, 3])
        expect(warmRequests).toEqual([
          { ordered: true, filtered: false, limit: 3 },
          { ordered: false, filtered: true, limit: undefined },
        ])
      } finally {
        await sibling.cleanup()
      }
    } finally {
      await owner.cleanup()
      await source.cleanup()
    }
  })
})

describe(`nullable multi-term lifecycle product`, () => {
  it(`anchors the nullable reference and controlled provider to an independent order palette`, () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: index + 1,
      primary: [null, -2, 2][Math.floor(index / 3)]!,
      secondary: [null, 2, -2][index % 3]!,
    }))
    for (const primaryNulls of [`first`, `last`] as const)
      for (const primaryDirection of [`asc`, `desc`] as const)
        for (const secondaryNulls of [`first`, `last`] as const)
          for (const secondaryDirection of [`asc`, `desc`] as const) {
            const primary = {
              nulls: primaryNulls,
              direction: primaryDirection,
            }
            const secondary = {
              nulls: secondaryNulls,
              direction: secondaryDirection,
            }
            const actual = [...rows]
              .sort(
                (a, b) =>
                  compareNullable(a.primary, b.primary, primary) ||
                  compareNullable(a.secondary, b.secondary, secondary) ||
                  a.id - b.id,
              )
              .map(({ id }) => id)
            expect(actual).toEqual(
              expectedNullablePaletteIds(primary, secondary),
            )
          }
  })
  const cells: Array<Scenario> = ([`first`, `last`] as const)
    .flatMap((primaryNulls) =>
      ([`first`, `last`] as const).flatMap((secondaryNulls) =>
        ([`prefix`, `boundary`] as const).flatMap((acquisitionPath) =>
          ([`resolve`, `repair`, `restart`] as const).map(
            (mode) =>
              ({
                nullable: {
                  primary: { direction: `asc`, nulls: primaryNulls },
                  secondary: { direction: `desc`, nulls: secondaryNulls },
                },
                acquisitionPath:
                  acquisitionPath === `boundary` && primaryNulls === `first`
                    ? `full-source`
                    : acquisitionPath,
                delivery: `before-provider-response`,
                window: `widen`,
                outcome: mode === `repair` ? `reject` : `resolve`,
                syncRun: mode === `restart` ? `restart` : `retain`,
                barrier: mode === `repair` ? `replay` : `initial`,
                repair: mode === `repair`,
              }) as const,
          ),
        ),
      ),
    )
    // Null-leading completion acquires full source and retires its prefix.
    // Replay can hold that full demand, but cannot target the retired prefix.
    .filter(
      (scenario) =>
        !(
          scenario.nullable.primary.nulls === `first` &&
          scenario.acquisitionPath === `prefix` &&
          scenario.repair
        ),
    )
  const directionCells = ([`asc`, `desc`] as const).flatMap(
    (primaryDirection) =>
      ([`asc`, `desc`] as const).map((secondaryDirection) => ({
        primaryDirection,
        secondaryDirection,
      })),
  )
  it(`enumerates every nullable lifecycle and direction-overlay cell exactly once`, () => {
    expect(cells).toHaveLength(22)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(22)
    expect(
      cells.some(
        (scenario) =>
          scenario.nullable?.primary.nulls === `first` &&
          scenario.acquisitionPath === `prefix` &&
          scenario.repair,
      ),
    ).toBe(false)
    expect(directionCells).toHaveLength(4)
    expect(
      new Set(directionCells.map((cell) => JSON.stringify(cell))).size,
    ).toBe(4)
  })
  it.each(cells)(
    `observes nullable tie and lifecycle coordinates: %j`,
    async (scenario) => {
      const result = await assertHistory(scenario)
      expect(result.orderedRequests).toBeGreaterThan(0)
      expect(
        scenario.nullable!.primary.nulls === `first`
          ? result.fullSourceRequests
          : result.tieRequests,
      ).toBeGreaterThan(0)
      expect(result.repaired).toBe(scenario.repair)
    },
  )
  it.each(directionCells)(
    `keeps primary $primaryDirection and secondary $secondaryDirection direction independent`,
    async ({ primaryDirection, secondaryDirection }) => {
      const representative = cells[0]!
      await assertHistory({
        ...representative,
        nullable: {
          primary: {
            ...representative.nullable!.primary,
            direction: primaryDirection,
          },
          secondary: {
            ...representative.nullable!.secondary,
            direction: secondaryDirection,
          },
        },
      })
    },
  )
  it.each([`secondary-order`, `null-placement`] as const)(
    `rejects a wrong %s through live loader output`,
    async (fault) => {
      const scenario = cells[0]!
      await assertHistory(scenario)
      await expect(assertHistory(scenario, fault)).rejects.toMatchObject({
        name: `AssertionError`,
      })
    },
  )
  const arbitrary = fc
    .record({
      scenario: fc.constantFrom(...cells),
      primaryDirection: fc.constantFrom(`asc` as const, `desc` as const),
      secondaryDirection: fc.constantFrom(`asc` as const, `desc` as const),
      rankOffset: fc.integer({ min: -20, max: 20 }),
      rankStep: fc.integer({ min: 1, max: 5 }),
    })
    .map(
      ({
        scenario,
        primaryDirection,
        secondaryDirection,
        rankOffset,
        rankStep,
      }): Scenario => ({
        ...scenario,
        rankOffset,
        rankStep,
        nullable: {
          primary: {
            ...scenario.nullable!.primary,
            direction: primaryDirection,
          },
          secondary: {
            ...scenario.nullable!.secondary,
            direction: secondaryDirection,
          },
        },
      }),
    )
  it(`generates the nullable value and lifecycle dimensions`, () => {
    const sample = fc.sample(arbitrary, { seed: 93472, numRuns: 100 })
    expect(new Set(sample.map((scenario) => scenario.acquisitionPath))).toEqual(
      new Set([`prefix`, `boundary`, `full-source`]),
    )
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.primary.nulls)),
    ).toEqual(new Set([`first`, `last`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.secondary.nulls)),
    ).toEqual(new Set([`first`, `last`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.primary.direction)),
    ).toEqual(new Set([`asc`, `desc`]))
    expect(
      new Set(sample.map((scenario) => scenario.nullable!.secondary.direction)),
    ).toEqual(new Set([`asc`, `desc`]))
    expect(
      new Set(
        sample.map(
          (scenario) =>
            `${scenario.nullable!.primary.direction}/${scenario.nullable!.secondary.direction}`,
        ),
      ),
    ).toEqual(new Set([`asc/asc`, `asc/desc`, `desc/asc`, `desc/desc`]))
    expect(sample.some((scenario) => scenario.repair)).toBe(true)
    expect(sample.some((scenario) => scenario.syncRun === `restart`)).toBe(true)
  })
  const { multiplier, ...replay } = readOracleRunConfig()
  const assertNullableHistory = async (scenario: Scenario) => {
    const result = await assertHistory(scenario)
    expect(result.orderedRequests).toBeGreaterThan(0)
    expect(result.repaired).toBe(scenario.repair)
    expect(
      scenario.nullable!.primary.nulls === `first`
        ? result.fullSourceRequests
        : result.tieRequests,
    ).toBeGreaterThan(0)
  }
  const nullableRunBudget = 20 * multiplier
  const nullableTimeout = Math.max(10000, multiplier * 1500)
  fcTest.prop([arbitrary], { numRuns: nullableRunBudget, seed: 93472 })(
    `matches nullable multi-term lifecycle histories for a fixed seed`,
    assertNullableHistory,
    nullableTimeout,
  )
  fcTest.prop(
    [arbitrary],
    oracleRandomParameters(
      nullableRunBudget,
      replay,
      `ordered-work.nullable-lifecycle`,
    ),
  )(
    `matches nullable multi-term lifecycle histories for a random or replayed seed`,
    assertNullableHistory,
    nullableTimeout,
  )
})

/**
 * ## Initial full-source loads share the synchronous readiness cut
 *
 * A plan whose window cannot come from a provider prefix (an inner join, a
 * functional predicate, `distinct`, or a custom string comparator) loads its
 * ordered source with one filtered full-source request and orders locally.
 * That request is still the query's initial load. When it returns literal
 * `true` after its establishing receipts apply, the live query is ready with
 * its complete window before the initiating call returns, exactly as for the
 * ordinary ordered request above. A Promise result stays asynchronous.
 *
 * The model is the same two-valued reference as the ordinary cut: synchronous
 * settlement predicts ready with ids [1, 2] at the immediate checkpoint, and
 * Promise settlement predicts loading with no rows. The rows come from a
 * three-row source ordered by rank, so the expectation does not read the
 * production comparator. The driver also records the provider request, which
 * must be the predicate-only full-source shape, so a plan that silently took
 * the ordered path cannot pass.
 *
 * A later full-source fallback is also outside this cut. The warm readiness
 * oracle below pins one: an ordinary ordered chain whose null boundary cannot be
 * expressed as a cursor falls back to a full-source request after its first
 * request settles, and stays `loading` until that fallback settles. It rejects a
 * gate keyed on the request kind rather than the initial load.
 *
 * Replay is outside this cut. After the initial window settles, a truncate
 * replays the same full-source request. Even when its provider answers with
 * literal `true`, the prior window stays published at the call that started
 * the replay and the replacement publishes a task later. This neighbouring case
 * distinguishes a purpose-based gate (initial load versus later authoritative
 * work) from a kind-based one that would make every full-source request
 * synchronous. A requiresFullSource plan holds every source row locally, so an
 * ordinary visible delete recomputes its window without any repair request.
 */

type FullSourceFeature =
  `inner-join` | `fn-where` | `distinct` | `custom-collation`
type FullSourceRow = { id: number; rank: number; label: string; tag: string }

const fullSourceRows: ReadonlyArray<FullSourceRow> = [
  { id: 1, rank: 1, label: `a`, tag: `x` },
  { id: 2, rank: 2, label: `b`, tag: `x` },
  { id: 3, rank: 3, label: `c`, tag: `x` },
]
const fullSourceFeatures: ReadonlyArray<FullSourceFeature> = [
  `inner-join`,
  `fn-where`,
  `distinct`,
  `custom-collation`,
]
const labelRank = new Map([
  [`a`, 1],
  [`b`, 2],
  [`c`, 3],
])

function createFullSourceQuery(
  feature: FullSourceFeature,
  source: Collection<FullSourceRow, number>,
  tags: Collection<{ tag: string }, string>,
) {
  return createLiveQueryCollection({
    startSync: false,
    query: (q) => {
      const base = q.from({ row: source })
      switch (feature) {
        case `inner-join`:
          return base
            .innerJoin({ tag: tags }, ({ row, tag }) => eq(row.tag, tag.tag))
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
        case `fn-where`:
          return base.fn
            .where(({ row }) => row.id > 0)
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
        case `distinct`:
          return base
            .orderBy(({ row }) => row.rank)
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
            .distinct()
        case `custom-collation`:
          return base
            .orderBy(({ row }) => row.label, {
              direction: `asc`,
              stringSort: `custom`,
              compare: (a, b) => labelRank.get(a)! - labelRank.get(b)!,
            })
            .limit(2)
            .select(({ row }) => ({ id: row.id }))
      }
    },
  })
}

function assertFullSourceRequest(request: LoadSubsetOptions | undefined): void {
  if (
    request === undefined ||
    request.orderBy !== undefined ||
    request.limit !== undefined ||
    request.cursor !== undefined ||
    request.offset !== undefined
  ) {
    throw new Error(
      `Expected one predicate-only full-source request, received ${JSON.stringify(request)}`,
    )
  }
}

async function observeFullSourceSettlement(
  feature: FullSourceFeature,
  settlement: InitialSettlementShape,
) {
  const delivered = new Set<number>()
  const requests: Array<LoadSubsetOptions> = []
  let sync!: Parameters<SyncConfig<FullSourceRow, number>[`sync`]>[0]
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-${feature}-${settlement}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: (options) => {
            requests.push(options)
            const fresh = fullSourceRows.filter(({ id }) => !delivered.has(id))
            if (fresh.length > 0) {
              sync.begin()
              for (const value of fresh) {
                delivered.add(value.id)
                sync.write({ type: `insert`, value })
              }
              expect(sync.commit()).toBe(true)
            }
            return settlement === `synchronous` ? true : Promise.resolve()
          },
        }
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-tags-${feature}-${settlement}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  const subscription = live.subscribeChanges(() => {}, {
    includeInitialState: false,
  })
  const observeCurrent = (): InitialSettlementObservation => ({
    rows: live.toArray.map(({ id }) => id),
    status: live.status,
  })
  let observation:
    | {
        immediate: InitialSettlementObservation
        settled: InitialSettlementObservation
        requests: Array<LoadSubsetOptions>
      }
    | undefined
  let primaryFailure: CapturedOracleFailure | undefined
  try {
    const preload = live.preload()
    const immediate = observeCurrent()
    await preload
    observation = { immediate, settled: observeCurrent(), requests }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [
      () => subscription.unsubscribe(),
      () => live.cleanup(),
      () => tags.cleanup(),
      () => source.cleanup(),
    ],
    `Full-source settlement oracle cleanup failed`,
  )
  return observation!
}

async function observeFullSourceReplay(feature: FullSourceFeature) {
  let served: ReadonlyArray<FullSourceRow> = fullSourceRows
  let sync!: Parameters<SyncConfig<FullSourceRow, number>[`sync`]>[0]
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-replay-${feature}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    sync: {
      sync: (operations) => {
        sync = operations
        operations.markReady()
        return {
          loadSubset: () => {
            const missing = served.filter(({ id }) => !source.has(id))
            if (missing.length > 0) {
              sync.begin()
              for (const value of missing) sync.write({ type: `insert`, value })
              expect(sync.commit()).toBe(true)
            }
            return true
          },
        }
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-replay-tags-${feature}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  let primaryFailure: CapturedOracleFailure | undefined
  let observation:
    { immediate: Array<number>; settled: Array<number> } | undefined
  try {
    await live.preload()
    // The source drops row 1 and replays its replacement through a truncate.
    served = fullSourceRows.slice(1)
    sync.begin()
    sync.truncate()
    sync.commit()
    const immediate = live.toArray.map(({ id }) => id)
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    observation = { immediate, settled: live.toArray.map(({ id }) => id) }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [() => live.cleanup(), () => tags.cleanup(), () => source.cleanup()],
    `Full-source replay oracle cleanup failed`,
  )
  return observation!
}

async function observeEagerFullSourceSettlement(feature: FullSourceFeature) {
  const source = createCollection<FullSourceRow, number>({
    id: `ordered-full-source-eager-${feature}`,
    getKey: ({ id }) => id,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        for (const value of fullSourceRows) write({ type: `insert`, value })
        commit()
        markReady()
      },
    },
  })
  const tags = createCollection<{ tag: string }, string>({
    id: `ordered-full-source-eager-tags-${feature}`,
    getKey: ({ tag }) => tag,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: { tag: `x` } })
        commit()
        markReady()
      },
    },
  })
  const live = createFullSourceQuery(feature, source, tags)
  let primaryFailure: CapturedOracleFailure | undefined
  let immediate: InitialSettlementObservation | undefined
  try {
    const preload = live.preload()
    immediate = {
      rows: live.toArray.map(({ id }) => id),
      status: live.status,
    }
    await preload
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [() => live.cleanup(), () => tags.cleanup(), () => source.cleanup()],
    `Eager full-source settlement oracle cleanup failed`,
  )
  return immediate!
}

describe(`synchronous initial full-source settlement refinement`, () => {
  const cells = fullSourceFeatures.flatMap((feature) =>
    ([`synchronous`, `promise`] as const).map((settlement) => ({
      feature,
      settlement,
    })),
  )

  it(`enumerates every full-source feature and settlement cell exactly once`, () => {
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(8)
  })

  it.each(cells)(
    `publishes the complete initial $feature window at the $settlement checkpoint`,
    async ({ feature, settlement }) => {
      const observed = await observeFullSourceSettlement(feature, settlement)
      assertFullSourceRequest(observed.requests[0])
      assertInitialSettlementObservation(observed.immediate, settlement)
      expect(observed.settled).toEqual({ rows: [1, 2], status: `ready` })
    },
  )

  it.each(fullSourceFeatures)(
    `publishes the complete initial %s window over an eager source at the synchronous checkpoint`,
    async (feature) => {
      // An eager source answers every local snapshot synchronously.
      assertInitialSettlementObservation(
        await observeEagerFullSourceSettlement(feature),
        `synchronous`,
      )
    },
  )

  it.each(fullSourceFeatures)(
    `keeps the %s full-source truncate replay behind its publication barrier`,
    async (feature) => {
      const observed = await observeFullSourceReplay(feature)
      // Replay is excluded from the synchronous cut: the prior window stays
      // published at the call that started the replay, even though the
      // provider answers it with literal `true`.
      expect(observed.immediate).toEqual([1, 2])
      expect(observed.settled).toEqual([2, 3])
    },
  )
})
