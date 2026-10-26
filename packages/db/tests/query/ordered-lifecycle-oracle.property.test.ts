import { isDeepStrictEqual } from 'node:util'
import { describe, expect, it } from 'vitest'
import { fc, test as fcTest } from '@fast-check/vitest'
import {
  createLiveQueryCollection,
  eq,
  isUndefined,
  not,
  toArray,
} from '../../src/query/index.js'
import { createCollection } from '../../src/collection/index.js'
import { createDeferred } from '../../src/deferred.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { evaluateReferenceExpression } from '../reference-expression-oracle.js'
import { captureMicrotaskErrors, flushPromises } from '../utils.js'
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
 * includes every request needed for the first window: an ordinary ordered
 * request, a requiresFullSource plan's first full-source request, and a
 * full-source fallback when the ordered boundary cannot be expressed. Promise
 * settlement remains asynchronous. The cut proves neither source exhaustion
 * nor broader source coverage. It does not govern explicit window moves, work
 * after initial publication, repair, replay, or framework render timing.
 *
 * Ordered acquisition has six independent control dimensions: acquisition
 * path, delivery time, window change, provider-response outcome, sync run, and
 * initial-versus-replay barrier. Their 192-cell product is small enough to
 * enumerate. A constrained initial-success grammar separately crosses
 * synchronous versus Promise settlement with indexed versus prefix loading.
 * One composed fixed regression injects sibling-source input during a
 * synchronous ordered continuation. It requires graph processing before the
 * loader decides whether another acquisition is needed.
 * A separate joined history checks public rows and change events when a
 * null-boundary full-source fallback starts after first publication. It
 * crosses two marker actions with literal, Promise, and held-receipt responses;
 * the held receipt also runs after child demand settles. A held provider
 * Promise after applied writes crosses a second marker change. A neighboring
 * history writes another eligible root after its gate opens and before the
 * returned provider Promise settles.
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

  // The synchronous cut covers the initial load. For a query that must read
  // its whole source first (here a function filter), the initial load is its
  // first full-source request. When the source answers with literal `true`,
  // the query is ready with its rows at creation. Full-source work after that
  // initial window and a full-source repair remain outside this guarantee.
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

/**
 * ## Initial locale-string fallback
 *
 * The architecture's initial synchronous cut covers the whole first-window
 * request chain. An ordered prefix ending at a locale string cannot express
 * its boundary as a cursor, so a full-source acquisition completes that same
 * initial chain. Distinct ISO dates select row 2. Equal dates select row 1 by
 * the public-key tie-breaker, even when the provider's first page contains
 * only row 2. The independent reference predicts `ready` with that singleton
 * when both acquisitions return literal `true`, and `loading` with no rows
 * when the fallback returns a Promise. Neither result claims source exhaustion
 * from the ordered prefix alone.
 *
 * The finite grammar crosses indexed and unindexed ordered requests, distinct
 * and tied rows, and synchronous and Promise full-source fallbacks. The
 * controlled on-demand adapter delivers only row 2 for the ordered request,
 * then row 1 for the unfiltered full-source request. It honors request
 * predicates so a tie request cannot masquerade as that fallback. The real
 * live-query Collection is observed at fallback entry, immediately after
 * preload starts its sync run, and after preload settles.
 * An offset of zero identifies the indexed first page; no offset identifies
 * the unindexed prefix, so the two index cells cannot collapse to one path.
 * The request trace must reach both acquisitions by the immediate checkpoint;
 * a deferred acquisition or a test that checks before preload cannot pass.
 * A subscriber registered by the controlled provider before its first row
 * write observes the same preload history. It must receive one nonempty insert
 * of the model's final singleton, after the fallback result settles, and read
 * that complete window in its callback. Empty readiness callbacks are not row
 * publications.
 * This owner does not establish React's render timing or adapter-specific
 * cache behavior.
 */
type InitialFallbackRow = { id: number; at: string }
type InitialFallbackOrder = `distinct` | `tied`
type InitialFallbackPublication = {
  changes: Array<{
    type: `insert` | `update` | `delete`
    key: string | number
    value: InitialFallbackRow
  }>
  rows: Array<InitialFallbackRow>
  afterFallbackResult: boolean
}

function initialFallbackRows(
  order: InitialFallbackOrder,
): ReadonlyArray<InitialFallbackRow> {
  return [
    { id: 1, at: order === `tied` ? `2026-10-02` : `2026-10-01` },
    { id: 2, at: `2026-10-02` },
  ]
}

function expectedInitialFallback(
  settlement: InitialSettlementShape,
  order: InitialFallbackOrder,
): InitialSettlementObservation {
  return settlement === `synchronous`
    ? { rows: [order === `tied` ? 1 : 2], status: `ready` }
    : { rows: [], status: `loading` }
}

async function observeInitialFallback(
  autoIndex: `eager` | `off`,
  settlement: InitialSettlementShape,
  order: InitialFallbackOrder,
  recordEvents = false,
) {
  const requests: Array<LoadSubsetOptions> = []
  const delivered = new Set<number>()
  const rows = initialFallbackRows(order)
  const publications: Array<InitialFallbackPublication> = []
  const commitReturnedImmediately: Array<boolean> = []
  let fallbackResultSettled = false
  let atFallbackEntry: InitialSettlementObservation | undefined
  const source = createCollection<InitialFallbackRow, number>({
    id: `initial-locale-fallback-${autoIndex}-${settlement}-${order}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex,
    defaultIndexType: autoIndex === `eager` ? BTreeIndex : undefined,
    defaultStringCollation: { stringSort: `locale` },
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: (options) => {
            requests.push(options)
            if (!options.orderBy) atFallbackEntry = observeCurrent()
            const matching = options.where
              ? rows.filter(
                  (row) =>
                    evaluateReferenceExpression(options.where!, row) === true,
                )
              : rows
            const served = options.orderBy ? matching.slice(1) : matching
            const fresh = served.filter(({ id }) => !delivered.has(id))
            if (fresh.length > 0) {
              if (recordEvents && !observer)
                observer = live.subscribeChanges(
                  (changes) => {
                    if (changes.length === 0) return
                    publications.push({
                      changes: changes.map((change) => ({
                        type: change.type,
                        key: change.key,
                        value: {
                          id: change.value.id,
                          at: change.value.at,
                        },
                      })),
                      rows: live.toArray.map(({ id, at }) => ({ id, at })),
                      afterFallbackResult: fallbackResultSettled,
                    })
                  },
                  { includeInitialState: false },
                )
              begin()
              for (const row of fresh) {
                delivered.add(row.id)
                write({ type: `insert`, value: row })
              }
              // Assertions here would be caught as provider failures. Compare
              // the receipt at the oracle checkpoint instead.
              commitReturnedImmediately.push(commit() === true)
            }
            const result =
              options.orderBy || settlement === `synchronous`
                ? true
                : Promise.resolve()
            if (recordEvents && !options.orderBy) {
              if (result === true) fallbackResultSettled = true
              else void result.then(() => (fallbackResultSettled = true))
            }
            return result
          },
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: false,
    query: (q) =>
      q
        .from({ row: source })
        .orderBy(({ row }) => row.at, `desc`)
        .findOne(),
  })
  function observeCurrent(): InitialSettlementObservation {
    return {
      rows: live.toArray.map(({ id }) => id),
      status: live.status,
    }
  }
  let observer: ReturnType<typeof live.subscribeChanges> | undefined
  let observation:
    | {
        immediate: InitialSettlementObservation
        settled: InitialSettlementObservation
        atFallbackEntry: InitialSettlementObservation | undefined
        requestsAtCut: Array<LoadSubsetOptions>
        publicationsAtCut: Array<InitialFallbackPublication>
        publications: Array<InitialFallbackPublication>
        commitReturnedImmediately: Array<boolean>
      }
    | undefined
  let primaryFailure: CapturedOracleFailure | undefined
  try {
    const preload = live.preload()
    const immediate = observeCurrent()
    const requestsAtCut = [...requests]
    const publicationsAtCut = [...publications]
    await preload
    observation = {
      immediate,
      settled: observeCurrent(),
      atFallbackEntry,
      requestsAtCut,
      publicationsAtCut,
      publications: [...publications],
      commitReturnedImmediately: [...commitReturnedImmediately],
    }
  } catch (error) {
    primaryFailure = { error }
  }
  await finishOracleCleanup(
    primaryFailure,
    [
      () => observer?.unsubscribe(),
      () => live.cleanup(),
      () => source.cleanup(),
    ],
    `Initial locale fallback oracle cleanup failed`,
  )
  return observation!
}

describe(`initial locale-string fallback oracle`, () => {
  const cells = ([`eager`, `off`] as const).flatMap((autoIndex) =>
    ([`synchronous`, `promise`] as const).flatMap((settlement) =>
      ([`distinct`, `tied`] as const).map((order) => ({
        autoIndex,
        settlement,
        order,
      })),
    ),
  )

  it(`enumerates every index, settlement, and row-order cell exactly once`, () => {
    expect(cells).toHaveLength(8)
    expect(new Set(cells.map((cell) => JSON.stringify(cell))).size).toBe(8)
  })

  it.each(cells)(
    `publishes the $autoIndex $order locale-string singleton at the $settlement checkpoint`,
    async ({ autoIndex, settlement, order }) => {
      const observed = await observeInitialFallback(
        autoIndex,
        settlement,
        order,
      )
      expect(observed.commitReturnedImmediately).toEqual([true, true])
      expect(observed.requestsAtCut).toHaveLength(2)
      expect(observed.requestsAtCut[0]).toMatchObject({ limit: 1 })
      expect(observed.requestsAtCut[0]?.orderBy).toHaveLength(1)
      expect(observed.requestsAtCut[0]?.offset).toBe(
        autoIndex === `eager` ? 0 : undefined,
      )
      expect(observed.requestsAtCut[1]?.orderBy).toBeUndefined()
      expect(observed.requestsAtCut[1]?.limit).toBeUndefined()
      expect(observed.requestsAtCut[1]?.where).toBeUndefined()
      expect(observed.requestsAtCut[1]?.cursor).toBeUndefined()
      expect(observed.requestsAtCut[1]?.offset).toBeUndefined()
      expect(observed.atFallbackEntry).toEqual({ rows: [], status: `loading` })
      expect(observed.immediate).toEqual(
        expectedInitialFallback(settlement, order),
      )
      expect(observed.settled).toEqual({
        rows: [order === `tied` ? 1 : 2],
        status: `ready`,
      })
    },
  )

  it.each(cells)(
    `emits one completed $autoIndex $order initial window change with $settlement fallback`,
    async ({ autoIndex, order, settlement }) => {
      const observed = await observeInitialFallback(
        autoIndex,
        settlement,
        order,
        true,
      )
      expect(observed.commitReturnedImmediately).toEqual([true, true])
      const id = order === `tied` ? 1 : 2
      expect(observed.requestsAtCut).toHaveLength(2)
      expect(observed.atFallbackEntry).toEqual({ rows: [], status: `loading` })
      expect(observed.immediate).toEqual(
        expectedInitialFallback(settlement, order),
      )
      if (settlement === `promise`)
        expect(observed.publicationsAtCut).toEqual([])
      expect(observed.settled).toEqual({ rows: [id], status: `ready` })
      const winner = { id, at: `2026-10-02` }
      expect(observed.publications).toEqual([
        {
          changes: [{ type: `insert`, key: id, value: winner }],
          rows: [winner],
          afterFallbackResult: true,
        },
      ])
    },
  )
})

/**
 * ## Full-source fallback after the first window publishes
 *
 * Publication and Collection readiness are separate facts. An indexed root
 * can publish its first joined window while an on-demand child keeps the
 * live-query Collection `loading`. Removing that window row's join match
 * needs another ordered page. Here the page ends at null, which cannot form a
 * continuation cursor, so the loader requests the full source. The contract
 * owes a coherent result and change events after that request's rows apply;
 * it does not give the later request an initial synchronous timing cut.
 *
 * The finite history grammar removes the first marker or retargets it to an
 * absent root, crossed with a literal-true response, a Promise response after
 * applied writes, or a response held on the establishing applied receipt. The
 * held receipt also runs after the child demand settles, so the live-query
 * Collection's public loading flag isolates the root fallback. In the held
 * Promise history, the provider applies root 3, then marker 2 retargets from
 * root 3 to root 2 before the provider settles. In the late-write history,
 * marker 2 instead targets root 4, which the provider writes after the held
 * gate opens. The independent model joins marker IDs to the finite root rows,
 * sorts eligible roots with null last, and takes one winner. The provider
 * honors predicates, cursor, order, offset, and limit: its first page delivers
 * root 1, its next page delivers ineligible root 2 at a null boundary, and the
 * unfiltered fallback delivers eligible root 3. The held-receipt case parks
 * root 3's sync transaction behind an unrelated optimistic update, then
 * releases that update so the accepted root write becomes visible. The driver
 * records requests, public snapshots, and callback-visible rows. The
 * comparison requires the published first window while status is still
 * `loading`, reaches the later fallback, and checks every public event against
 * its callback snapshot and the model's final delta. It permits coherent
 * intermediate publications and assigns no synchronous cut to later work. The
 * Promise overlap checks the public window before and after its second marker
 * action, then checks every callback and the final model result after provider
 * settlement. The late-write history also checks the adapter's acquisition
 * lease: the cursor page remains owned while the full-source provider Promise
 * is pending, and retires after successful settlement. A separate
 * cleanup-failure pair requires that retiring the first acquisition still
 * leaves the successful replacement and reports the adapter error.
 */
type LaterFallbackMutation = `delete-marker` | `retarget-marker`
type LaterFallbackResponse =
  | `literal-true`
  | `promise`
  | `held-receipt`
  | `held-promise`
  | `held-promise-late-write`
type LaterFallbackChildDemand = `pending` | `settled`
type LaterFallbackRoot = { id: number; at: number | null; note: string }
type LaterFallbackMarker = { id: number; rootId: number }
type LaterFallbackChild = { id: number; rootId: number }
type LaterFallbackRow = { id: number; children: Array<number> }
type LaterFallbackResult = { key: number; row: LaterFallbackRow }
type LaterFallbackChange = {
  type: `insert` | `update` | `delete`
  key: string | number
  value: LaterFallbackRow
}
type LaterFallbackPublication = {
  changes: Array<LaterFallbackChange>
  rows: Array<LaterFallbackRow>
}
type LaterFallbackObservation = {
  response: LaterFallbackResponse
  childDemand: LaterFallbackChildDemand
  releaseError: boolean
  releaseFailures: number
  initial: { rows: Array<LaterFallbackRow>; status: string }
  initialChildLoads: number
  initialChildPending: boolean
  readyChildCut:
    | {
        rows: Array<LaterFallbackRow>
        status: string
        rootLoading: boolean
        liveLoading: boolean
      }
    | undefined
  beforeMutation: Array<LoadSubsetOptions>
  afterMutation: Array<{ options: LoadSubsetOptions; served: Array<number> }>
  fallbackEntry: { rows: Array<LaterFallbackRow>; status: string } | undefined
  heldCut:
    | {
        rows: Array<LaterFallbackRow>
        status: string
        sourceHasRoot3: boolean
        blockerStarted: boolean
        blockerPending: boolean
        receiptPending: boolean
        rootLoading: boolean
        liveLoading: boolean
      }
    | undefined
  heldPromiseCut:
    | {
        sourceHasRoot3: boolean
        sourceHasRoot4: boolean
        providerPending: boolean
        rootLoading: boolean
        cursorPageReleased: boolean
        rowsBeforeOverlap: Array<LaterFallbackRow>
        rowsAfterOverlap: Array<LaterFallbackRow>
        publicationsBeforeOverlap: number
        overlapCommitImmediate: boolean
      }
    | undefined
  final: {
    rows: Array<LaterFallbackRow>
    status: string
    rootLoading: boolean
    liveLoading: boolean
  }
  publications: Array<LaterFallbackPublication>
  commitReceipts: Array<{
    served: Array<number>
    fullSource: boolean
    immediate: boolean
  }>
  markerCommitImmediate: boolean
  cursorPageReleasedAfterSettlement: boolean
}

const laterFallbackRoots: ReadonlyArray<LaterFallbackRoot> = [
  { id: 1, at: 1, note: `base` },
  { id: 2, at: null, note: `base` },
  { id: 3, at: null, note: `base` },
]
const laterFallbackLateRoot: LaterFallbackRoot = {
  id: 4,
  at: null,
  note: `late`,
}
const laterFallbackInitialMarkers: ReadonlyArray<LaterFallbackMarker> = [
  { id: 1, rootId: 1 },
  { id: 2, rootId: 3 },
]

// This finite recomputation knows no acquisition kind or loader state. A
// missing child response gives each visible parent an empty child array.
function expectedLaterFallbackWindow(
  markers: ReadonlyArray<LaterFallbackMarker>,
  roots: ReadonlyArray<LaterFallbackRoot> = laterFallbackRoots,
): Array<LaterFallbackResult> {
  return roots
    .flatMap((root) =>
      markers
        .filter((marker) => marker.rootId === root.id)
        .map((marker) => ({ root, marker })),
    )
    .sort(
      (left, right) =>
        (left.root.at === null ? 1 : 0) - (right.root.at === null ? 1 : 0) ||
        (left.root.at ?? 0) - (right.root.at ?? 0) ||
        left.root.id - right.root.id,
    )
    .slice(0, 1)
    .map(({ root }) => ({
      // The fixture gives the live-query Collection this public key rule.
      // Its two histories have at most one joined result per root.
      key: root.id,
      row: { id: root.id, children: [] },
    }))
}

function laterFallbackMarkersAfter(
  mutation: LaterFallbackMutation,
): Array<LaterFallbackMarker> {
  return mutation === `delete-marker`
    ? [{ id: 2, rootId: 3 }]
    : [
        { id: 1, rootId: 99 },
        { id: 2, rootId: 3 },
      ]
}

function laterFallbackMarkersAfterOverlap(
  mutation: LaterFallbackMutation,
  response: LaterFallbackResponse = `held-promise`,
): Array<LaterFallbackMarker> {
  return laterFallbackMarkersAfter(mutation).map((marker) =>
    marker.id === 2
      ? { id: 2, rootId: response === `held-promise-late-write` ? 4 : 2 }
      : marker,
  )
}

async function observeLaterFallback(
  mutation: LaterFallbackMutation,
  response: LaterFallbackResponse,
  childDemand: LaterFallbackChildDemand,
  assertObservation: (observed: LaterFallbackObservation) => void,
  releaseError = false,
): Promise<void> {
  type RootSync = Parameters<SyncConfig<LaterFallbackRoot, number>[`sync`]>[0]
  type MarkerSync = Parameters<
    SyncConfig<LaterFallbackMarker, number>[`sync`]
  >[0]
  const childGate = createDeferred<void>()
  const blockerGate = createDeferred<void>()
  const providerGate = createDeferred<void>()
  const fallbackEntered = createDeferred<void>()
  const finalPublication = createDeferred<void>()
  const loadSettled = createDeferred<void>()
  const delivered = new Set<number>()
  const unloaded = new Set<LoadSubsetOptions>()
  const lateWrite = response === `held-promise-late-write`
  const sourceRows = lateWrite
    ? [...laterFallbackRoots, laterFallbackLateRoot]
    : laterFallbackRoots
  const requests: Array<{ options: LoadSubsetOptions; served: Array<number> }> =
    []
  const publications: Array<LaterFallbackPublication> = []
  const commitReceipts: LaterFallbackObservation[`commitReceipts`] = []
  const releaseFailure = new Error(`first ordered acquisition release failed`)
  let releaseFailures = 0
  let childLoads = 0
  let markerSync!: MarkerSync
  let markerCommitImmediate = false
  let blockerStarted = false
  let blockerPersistence: Promise<unknown> | undefined
  let receiptPending = false
  let fallbackEntry:
    { rows: Array<LaterFallbackRow>; status: string } | undefined
  let observer: ReturnType<typeof live.subscribeChanges> | undefined
  let unsubscribeRootLoading: (() => void) | undefined
  let unsubscribeLiveLoading: (() => void) | undefined
  const rootCollection = createCollection<LaterFallbackRoot, number>({
    id: `later-null-fallback-root-${mutation}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    onUpdate: () => {
      blockerStarted = true
      return blockerGate.promise
    },
    sync: {
      sync: (sync: RootSync) => {
        sync.markReady()
        return {
          loadSubset: (options) => {
            if (requests.length >= 12)
              throw new Error(`later null fallback exceeded request bound`)
            let page = sourceRows.filter(
              (row) =>
                (!options.where ||
                  evaluateReferenceExpression(options.where, row) === true) &&
                (!options.cursor ||
                  evaluateReferenceExpression(options.cursor.whereFrom, row) ===
                    true),
            )
            if (options.orderBy) {
              page = [...page].sort((left, right) => {
                for (const term of options.orderBy!) {
                  const compared = compareNullable(
                    evaluateReferenceExpression(term.expression, left),
                    evaluateReferenceExpression(term.expression, right),
                    term.compareOptions,
                  )
                  if (compared) return compared
                }
                return left.id - right.id
              })
              if (!options.cursor) page = page.slice(options.offset ?? 0)
              if (options.limit !== undefined)
                page = page.slice(0, options.limit)
            }
            requests.push({ options, served: page.map(({ id }) => id) })
            const isFullSource =
              !options.orderBy &&
              !options.where &&
              !options.cursor &&
              options.limit === undefined &&
              options.offset === undefined
            if (isFullSource && !fallbackEntry) {
              fallbackEntry = {
                rows: live.toArray.map(({ id, children }) => ({
                  id,
                  children: children.map(({ id: childId }) => childId),
                })),
                status: live.status,
              }
            }
            const fresh = page.filter(
              ({ id }) =>
                !delivered.has(id) && (!lateWrite || !isFullSource || id !== 4),
            )
            if (fresh.length > 0) {
              sync.begin()
              for (const row of fresh) {
                delivered.add(row.id)
                sync.write({ type: `insert`, value: row })
              }
              const receipt = sync.commit()
              commitReceipts.push({
                served: fresh.map(({ id }) => id),
                fullSource: isFullSource,
                immediate: receipt === true,
              })
              if (isFullSource && response === `held-receipt`) {
                receiptPending = receipt !== true
                if (receipt !== true)
                  void receipt.then(
                    () => (receiptPending = false),
                    () => (receiptPending = false),
                  )
                fallbackEntered.resolve()
                return receipt
              }
              if (
                response === `held-receipt` &&
                options.orderBy &&
                options.cursor &&
                page.some(({ id }) => id === 2)
              ) {
                // The page's own receipt applied. Only the later full-source
                // transaction waits behind this unrelated optimistic update.
                blockerPersistence = rootCollection.update(1, (draft) => {
                  draft.note = `pending`
                }).isPersisted.promise
                void blockerPersistence.catch(() => {})
              }
            }
            if (isFullSource) {
              fallbackEntered.resolve()
              if (response === `promise`) return Promise.resolve()
              if (response === `held-promise`) return providerGate.promise
              if (lateWrite)
                return providerGate.promise.then(() => {
                  sync.begin()
                  delivered.add(4)
                  sync.write({ type: `insert`, value: laterFallbackLateRoot })
                  const receipt = sync.commit()
                  commitReceipts.push({
                    served: [4],
                    fullSource: true,
                    immediate: receipt === true,
                  })
                  return receipt === true ? undefined : receipt
                })
            }
            return true
          },
          unloadSubset: (options) => {
            unloaded.add(options)
            if (releaseError && options === requests[0]?.options) {
              releaseFailures++
              throw releaseFailure
            }
          },
        }
      },
    },
  })
  const markerCollection = createCollection<LaterFallbackMarker, number>({
    id: `later-null-fallback-markers-${mutation}`,
    getKey: ({ id }) => id,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: (sync: MarkerSync) => {
        markerSync = sync
        sync.begin()
        for (const marker of laterFallbackInitialMarkers)
          sync.write({ type: `insert`, value: marker })
        markerCommitImmediate = sync.commit() === true
        sync.markReady()
      },
    },
  })
  const childCollection = createCollection<LaterFallbackChild, number>({
    id: `later-null-fallback-child-${mutation}`,
    getKey: ({ id }) => id,
    syncMode: `on-demand`,
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
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: false,
    getKey: ({ id }) => id,
    query: (q) =>
      q
        .from({ root: rootCollection })
        .leftJoin({ marker: markerCollection }, ({ root, marker }) =>
          eq(root.id, marker.rootId),
        )
        .where(({ marker }) => not(isUndefined(marker.id)))
        .orderBy(({ root }) => root.at, {
          direction: `asc`,
          nulls: `last`,
        })
        .limit(1)
        .select(({ root }) => ({
          id: root.id,
          children: toArray(
            q
              .from({ child: childCollection })
              .where(({ child }) => eq(child.rootId, root.id)),
          ),
        })),
  })
  const publicRows = (): Array<LaterFallbackRow> =>
    live.toArray.map(({ id, children }) => ({
      id,
      children: children.map(({ id: childId }) => childId),
    }))
  let afterFinalPublication = false
  const maybeResolveLoadSettled = () => {
    if (
      afterFinalPublication &&
      !rootCollection.isLoadingSubset &&
      (childDemand === `pending` || !live.isLoadingSubset)
    )
      loadSettled.resolve()
  }
  let primaryFailure: CapturedOracleFailure | undefined
  let heldCut: LaterFallbackObservation[`heldCut`]
  let heldPromiseCut: LaterFallbackObservation[`heldPromiseCut`]
  let readyChildCut: LaterFallbackObservation[`readyChildCut`]
  try {
    const preload = live.preload()
    void preload.catch(() => {})
    await flushPromises()
    const initial = { rows: publicRows(), status: live.status }
    const initialChildLoads = childLoads
    const initialChildPending = childGate.isPending()
    if (childDemand === `settled`) {
      childGate.resolve()
      await preload
      await flushPromises()
      readyChildCut = {
        rows: publicRows(),
        status: live.status,
        rootLoading: rootCollection.isLoadingSubset,
        liveLoading: live.isLoadingSubset,
      }
    }
    const beforeMutation = requests.map(({ options }) => options)
    unsubscribeRootLoading = rootCollection.on(
      `loadingSubset:change`,
      maybeResolveLoadSettled,
    )
    unsubscribeLiveLoading = live.on(
      `loadingSubset:change`,
      maybeResolveLoadSettled,
    )
    observer = live.subscribeChanges(
      (changes) => {
        if (changes.length === 0) return
        const rows = publicRows()
        publications.push({
          changes: changes.map((change) => ({
            type: change.type,
            key: change.key,
            value: {
              id: change.value.id,
              children: change.value.children.map(({ id }) => id),
            },
          })),
          rows,
        })
        const finalId = lateWrite ? 4 : response === `held-promise` ? 2 : 3
        if (rows.length === 1 && rows[0]?.id === finalId)
          finalPublication.resolve()
      },
      { includeInitialState: false },
    )
    markerSync.begin()
    if (mutation === `delete-marker`)
      markerSync.write({ type: `delete`, key: 1 })
    else
      markerSync.write({
        type: `update`,
        value: { id: 1, rootId: 99 },
      })
    expect(markerSync.commit()).toBe(true)
    if (response === `held-receipt`) {
      const entryLimit = setTimeout(() => fallbackEntered.resolve(), 1500)
      try {
        await fallbackEntered.promise
      } finally {
        clearTimeout(entryLimit)
      }
      await flushPromises()
      heldCut = {
        rows: publicRows(),
        status: live.status,
        sourceHasRoot3: rootCollection.get(3) !== undefined,
        blockerStarted,
        blockerPending: blockerGate.isPending(),
        receiptPending,
        rootLoading: rootCollection.isLoadingSubset,
        liveLoading: live.isLoadingSubset,
      }
      blockerGate.resolve()
    }
    if (response === `held-promise` || lateWrite) {
      const entryLimit = setTimeout(() => fallbackEntered.resolve(), 1500)
      try {
        await fallbackEntered.promise
      } finally {
        clearTimeout(entryLimit)
      }
      await flushPromises()
      const rowsBeforeOverlap = publicRows()
      const publicationsBeforeOverlap = publications.length
      const sourceHasRoot3 = rootCollection.get(3) !== undefined
      const rootLoading = rootCollection.isLoadingSubset
      markerSync.begin()
      markerSync.write({
        type: `update`,
        value: { id: 2, rootId: lateWrite ? 4 : 2 },
      })
      const overlapCommitImmediate = markerSync.commit() === true
      await flushPromises()
      heldPromiseCut = {
        sourceHasRoot3,
        sourceHasRoot4: rootCollection.get(4) !== undefined,
        providerPending: providerGate.isPending(),
        rootLoading,
        cursorPageReleased: requests.some(
          ({ options }) =>
            options.orderBy && options.cursor && unloaded.has(options),
        ),
        rowsBeforeOverlap,
        rowsAfterOverlap: publicRows(),
        publicationsBeforeOverlap,
        overlapCommitImmediate,
      }
      providerGate.resolve()
    }
    // The later full-source cut has no synchronous scheduling promise. Wait
    // for its public change. The timer bounds a missing-event failure; the
    // final model check diagnoses it.
    const waitLimit = setTimeout(() => finalPublication.resolve(), 1500)
    try {
      await finalPublication.promise
    } finally {
      clearTimeout(waitLimit)
    }
    // Row publication can precede provider settlement. Observe the public
    // loading-end event instead of assuming one graph turn is enough.
    afterFinalPublication = true
    maybeResolveLoadSettled()
    const settlementLimit = setTimeout(() => loadSettled.resolve(), 1500)
    try {
      await loadSettled.promise
    } finally {
      clearTimeout(settlementLimit)
    }
    await flushPromises()
    const observation: LaterFallbackObservation = {
      response,
      childDemand,
      releaseError,
      releaseFailures,
      initial,
      initialChildLoads,
      initialChildPending,
      readyChildCut,
      beforeMutation,
      afterMutation: requests.slice(beforeMutation.length),
      fallbackEntry,
      heldCut,
      heldPromiseCut,
      final: {
        rows: publicRows(),
        status: live.status,
        rootLoading: rootCollection.isLoadingSubset,
        liveLoading: live.isLoadingSubset,
      },
      publications: [...publications],
      commitReceipts: [...commitReceipts],
      markerCommitImmediate,
      cursorPageReleasedAfterSettlement: requests.some(
        ({ options }) =>
          options.orderBy && options.cursor && unloaded.has(options),
      ),
    }
    assertObservation(observation)
  } catch (error) {
    primaryFailure = { error }
  }
  blockerGate.resolve()
  providerGate.resolve()
  childGate.resolve()
  // A persistence failure is a distinct cleanup diagnostic if the public
  // comparison already failed. Bound the wait so cleanup still reports it.
  const awaitBlockerPersistence = async () => {
    if (!blockerPersistence) return
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        blockerPersistence,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () =>
              reject(new Error(`Later null fallback blocker did not settle`)),
            1500,
          )
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }
  await finishOracleCleanup(
    primaryFailure,
    [
      awaitBlockerPersistence,
      () => observer?.unsubscribe(),
      () => unsubscribeRootLoading?.(),
      () => unsubscribeLiveLoading?.(),
      () => live.cleanup(),
      () => markerCollection.cleanup(),
      () => childCollection.cleanup(),
      () => rootCollection.cleanup(),
    ],
    `Later null fallback oracle cleanup failed`,
  )
}

function assertLaterFallbackObservation(
  mutation: LaterFallbackMutation,
  observed: LaterFallbackObservation,
): void {
  const lateWrite = observed.response === `held-promise-late-write`
  const heldPromise = observed.response === `held-promise` || lateWrite
  const initial = expectedLaterFallbackWindow(laterFallbackInitialMarkers)
  const afterFirst = expectedLaterFallbackWindow(
    laterFallbackMarkersAfter(mutation),
  )
  const final = expectedLaterFallbackWindow(
    heldPromise
      ? laterFallbackMarkersAfterOverlap(mutation, observed.response)
      : laterFallbackMarkersAfter(mutation),
    lateWrite
      ? [...laterFallbackRoots, laterFallbackLateRoot]
      : laterFallbackRoots,
  )
  expect(observed.releaseFailures).toBe(observed.releaseError ? 1 : 0)
  expect(observed.markerCommitImmediate).toBe(true)
  const expectedReceipts = [
    { served: [1], fullSource: false, immediate: true },
    { served: [2], fullSource: false, immediate: true },
    {
      served: [3],
      fullSource: true,
      immediate: observed.response !== `held-receipt`,
    },
  ]
  if (lateWrite)
    expectedReceipts.push({ served: [4], fullSource: true, immediate: true })
  expect(observed.commitReceipts).toEqual(expectedReceipts)
  expect(observed.initial).toEqual({
    rows: initial.map(({ row }) => row),
    status: `loading`,
  })
  expect(observed.initialChildLoads).toBeGreaterThan(0)
  expect(observed.initialChildPending).toBe(true)
  if (observed.childDemand === `settled`) {
    expect(observed.readyChildCut).toEqual({
      rows: initial.map(({ row }) => row),
      status: `ready`,
      rootLoading: false,
      liveLoading: false,
    })
  } else expect(observed.readyChildCut).toBeUndefined()
  expect(observed.beforeMutation[0]?.orderBy).toHaveLength(1)
  expect(observed.beforeMutation[0]?.limit).toBe(1)
  expect(observed.beforeMutation[0]?.offset).toBe(0)
  expect(observed.beforeMutation[0]?.cursor).toBeUndefined()
  expect(
    observed.beforeMutation.some(
      (request) =>
        !request.orderBy &&
        !request.where &&
        !request.cursor &&
        request.limit === undefined,
    ),
  ).toBe(false)
  expect(
    observed.beforeMutation[0]?.orderBy?.[0]?.compareOptions,
  ).toMatchObject({ direction: `asc`, nulls: `last` })
  const orderedPageIndex = observed.afterMutation.findIndex(
    ({ options }) => options.orderBy && options.cursor,
  )
  expect(orderedPageIndex).toBeGreaterThanOrEqual(0)
  expect(observed.afterMutation[orderedPageIndex]?.served).toEqual([2])
  expect(
    observed.afterMutation[orderedPageIndex]?.options.orderBy?.[0]
      ?.compareOptions,
  ).toMatchObject({ direction: `asc`, nulls: `last` })
  const fullSource = observed.afterMutation.filter(
    ({ options }) =>
      !options.orderBy &&
      !options.where &&
      !options.cursor &&
      options.limit === undefined &&
      options.offset === undefined,
  )
  if (heldPromise) expect(fullSource.length).toBeGreaterThanOrEqual(1)
  else expect(fullSource).toHaveLength(1)
  expect(fullSource[0]?.served).toEqual(lateWrite ? [1, 2, 3, 4] : [1, 2, 3])
  expect(observed.afterMutation.indexOf(fullSource[0]!)).toBeGreaterThan(
    orderedPageIndex,
  )
  // The old window can remain until the later load settles, or a coherent
  // empty window can publish when its marker disappears. Neither is an
  // initial-load timing promise; callback replay checks either publication.
  const allowedIntermediateRows = [initial.map(({ row }) => row), []]
  expect(allowedIntermediateRows).toContainEqual(observed.fallbackEntry?.rows)
  expect([`loading`, `ready`]).toContain(observed.fallbackEntry?.status)
  if (observed.response === `held-receipt`) {
    expect(allowedIntermediateRows).toContainEqual(observed.heldCut?.rows)
    expect(observed.heldCut).toMatchObject({
      sourceHasRoot3: false,
      blockerStarted: true,
      blockerPending: true,
      receiptPending: true,
      rootLoading: true,
      liveLoading: true,
    })
    expect([`loading`, `ready`]).toContain(observed.heldCut?.status)
  } else expect(observed.heldCut).toBeUndefined()
  if (heldPromise) {
    expect(observed.heldPromiseCut).toMatchObject({
      sourceHasRoot3: true,
      sourceHasRoot4: false,
      providerPending: true,
      rootLoading: true,
      overlapCommitImmediate: true,
    })
    if (lateWrite) {
      expect(observed.heldPromiseCut?.cursorPageReleased).toBe(false)
      expect(observed.cursorPageReleasedAfterSettlement).toBe(true)
    }
    const beforeOverlap = observed.heldPromiseCut?.rowsBeforeOverlap
    const afterOverlap = observed.heldPromiseCut?.rowsAfterOverlap
    expect([
      initial.map(({ row }) => row),
      [],
      afterFirst.map(({ row }) => row),
    ]).toContainEqual(beforeOverlap)
    const allowedAfterOverlap = [initial.map(({ row }) => row), []]
    if (!lateWrite) allowedAfterOverlap.push(final.map(({ row }) => row))
    if (beforeOverlap?.[0]?.id === afterFirst[0]?.row.id)
      allowedAfterOverlap.push(afterFirst.map(({ row }) => row))
    expect(allowedAfterOverlap).toContainEqual(afterOverlap)
  } else expect(observed.heldPromiseCut).toBeUndefined()
  expect(observed.final.rows).toEqual(final.map(({ row }) => row))
  expect(observed.final.rootLoading).toBe(false)
  if (observed.childDemand === `settled`)
    expect(observed.final.liveLoading).toBe(false)
  // A throwing release is an adapter bug that fails no load, so it leaves
  // the status to the load results.
  expect([`loading`, `ready`]).toContain(observed.final.status)
  // Changes may be split across publications. At each callback, applying
  // its changes to the prior public snapshot must match the rows a reader
  // sees there; the flattened delta must match the finite join model.
  const visible = new Map<string | number, LaterFallbackRow>(
    initial.map(({ key, row }) => [key, row]),
  )
  const changes = observed.publications.flatMap(({ changes: batch, rows }) => {
    for (const change of batch) {
      if (change.type === `delete`) visible.delete(change.key)
      else visible.set(change.key, change.value)
    }
    expect(rows.length).toBeLessThanOrEqual(1)
    expect(rows).toEqual([...visible.values()])
    return batch
  })
  const expectedChanges: Array<LaterFallbackChange> = [
    { type: `delete`, key: initial[0]!.key, value: initial[0]!.row },
    { type: `insert`, key: final[0]!.key, value: final[0]!.row },
  ]
  if (heldPromise) {
    const firstReplacement = afterFirst[0]!
    const earlyChanges = observed.publications
      .slice(0, observed.heldPromiseCut?.publicationsBeforeOverlap)
      .flatMap(({ changes: batch }) => batch)
    const firstReplacementPublished =
      observed.heldPromiseCut?.rowsBeforeOverlap[0]?.id ===
      firstReplacement.row.id
    const firstInsert: LaterFallbackChange = {
      type: `insert`,
      key: firstReplacement.key,
      value: firstReplacement.row,
    }
    expect(
      earlyChanges.filter(({ key }) => key === firstReplacement.key),
    ).toEqual(firstReplacementPublished ? [firstInsert] : [])
    if (firstReplacementPublished) {
      expectedChanges.push(firstInsert, {
        type: `delete`,
        key: firstReplacement.key,
        value: firstReplacement.row,
      })
    }
  }
  const byKey = (left: LaterFallbackChange, right: LaterFallbackChange) =>
    Number(left.key) - Number(right.key)
  expect([...changes].sort(byKey)).toEqual(expectedChanges.sort(byKey))
  expect([...visible.values()]).toEqual(final.map(({ row }) => row))
}

describe(`post-publication null fallback oracle`, () => {
  const cases: Array<{
    mutation: LaterFallbackMutation
    response: LaterFallbackResponse
    childDemand: LaterFallbackChildDemand
  }> = ([`delete-marker`, `retarget-marker`] as const).flatMap((mutation) => [
    { mutation, response: `literal-true`, childDemand: `pending` },
    { mutation, response: `promise`, childDemand: `pending` },
    { mutation, response: `held-receipt`, childDemand: `pending` },
    { mutation, response: `held-receipt`, childDemand: `settled` },
    { mutation, response: `held-promise`, childDemand: `pending` },
    { mutation, response: `held-promise`, childDemand: `settled` },
    { mutation, response: `held-promise-late-write`, childDemand: `pending` },
    { mutation, response: `held-promise-late-write`, childDemand: `settled` },
  ])
  it.each(cases)(
    `keeps the public window and change events coherent after $mutation with $response and $childDemand child demand`,
    async ({ mutation, response, childDemand }) => {
      await observeLaterFallback(mutation, response, childDemand, (observed) =>
        assertLaterFallbackObservation(mutation, observed),
      )
    },
  )

  it(`rejects a stale window event after an overlapping held provider result`, async () => {
    await observeLaterFallback(
      `delete-marker`,
      `held-promise`,
      `settled`,
      (observed) => {
        assertLaterFallbackObservation(`delete-marker`, observed)
        const final = expectedLaterFallbackWindow(
          laterFallbackMarkersAfterOverlap(`delete-marker`),
        )[0]!
        const stale = expectedLaterFallbackWindow(
          laterFallbackMarkersAfter(`delete-marker`),
        )[0]!
        // This wrong result leaves the final rows correct, but publishes the
        // obsolete winner and then retracts it after the overlap.
        const wrong: LaterFallbackObservation = {
          ...observed,
          publications: [
            ...observed.publications,
            {
              changes: [
                { type: `delete`, key: final.key, value: final.row },
                { type: `insert`, key: stale.key, value: stale.row },
              ],
              rows: [stale.row],
            },
            {
              changes: [
                { type: `delete`, key: stale.key, value: stale.row },
                { type: `insert`, key: final.key, value: final.row },
              ],
              rows: [final.row],
            },
          ],
        }
        expect(() =>
          assertLaterFallbackObservation(`delete-marker`, wrong),
        ).toThrow()
      },
    )
  })

  it.each([`delete-marker`, `retarget-marker`] as const)(
    `reports the first lease's cleanup failure after the %s fallback publishes its replacement`,
    async (mutation) => {
      // The subscription reports the throwing release uncaught, once: it is
      // an adapter bug, not a load result.
      const uncaught = captureMicrotaskErrors()
      try {
        await observeLaterFallback(
          mutation,
          `literal-true`,
          `pending`,
          (observed) => assertLaterFallbackObservation(mutation, observed),
          true,
        )
        await flushPromises()
      } finally {
        uncaught.restore()
      }
      expect(uncaught.errors.map(String)).toEqual([
        `Error: first ordered acquisition release failed`,
      ])
    },
  )
})

describe(`warm ordered readiness oracle`, () => {
  // The four remote rows have the ascending order [3, 4, 1, 2], with null
  // last. When preload starts the live-query sync run, a warm literal-true
  // response to each acquisition owes that complete window and `ready` before
  // the call returns. A constructor-started sync run resumes deferred
  // on-demand acquisition asynchronously, so it owes the same window after
  // settlement. The zero-limit neighbor needs no acquisition.
  it.each([
    { limit: 0, startsAtConstruction: false, expectedRequests: [] },
    {
      limit: 50,
      startsAtConstruction: false,
      expectedRequests: [
        { ordered: true, filtered: false, limit: 50 },
        { ordered: false, filtered: false, limit: undefined },
      ],
    },
    {
      limit: 50,
      startsAtConstruction: true,
      expectedRequests: [
        { ordered: true, filtered: false, limit: 50 },
        { ordered: false, filtered: false, limit: undefined },
      ],
    },
  ])(
    `settles a retained $limit-row window after an async cold prime (constructor start: $startsAtConstruction)`,
    async ({ limit, startsAtConstruction, expectedRequests }) => {
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
      const query = (queryLimit: number, startSync = true) =>
        createLiveQueryCollection({
          query: (q) =>
            q
              .from({ row: source })
              .orderBy(({ row }) => row.createdAt, {
                direction: `asc`,
                nulls: `last`,
              })
              .limit(queryLimit),
          startSync,
        })
      const coldQuery = query(50)
      let warmQuery: ReturnType<typeof query> | undefined
      let observation:
        | {
            requestsAtCut: Array<{
              ordered: boolean
              filtered: boolean
              limit: number | undefined
            }>
            requestsAfterSettlement: Array<{
              ordered: boolean
              filtered: boolean
              limit: number | undefined
            }>
            immediate: InitialSettlementObservation
            settled: InitialSettlementObservation
            isLoadingSubset: boolean
          }
        | undefined
      let primaryFailure: CapturedOracleFailure | undefined
      try {
        await coldQuery.preload()
        cold = false
        warmQuery = query(limit, startsAtConstruction)
        // Preload starts a new sync run when startSync is false. When the
        // constructor started it, preload resumes deferred on-demand work
        // through the asynchronous subscription restart path. Both receive
        // the same warm rows, but only the first owes the synchronous cut.
        const requestsBeforePreload = [...warmRequests]
        const preload = warmQuery.preload()
        const requestsAtCut = [...warmRequests]
        const immediate = {
          status: warmQuery.status,
          rows: warmQuery.toArray.map(({ id }) => id),
        }
        await preload
        observation = {
          requestsAtCut,
          requestsAfterSettlement: [...warmRequests],
          immediate,
          settled: {
            status: warmQuery.status,
            rows: warmQuery.toArray.map(({ id }) => id),
          },
          isLoadingSubset: warmQuery.isLoadingSubset,
        }
        expect(requestsBeforePreload).toEqual([])
      } catch (error) {
        primaryFailure = { error }
      }
      await finishOracleCleanup(
        primaryFailure,
        [
          () => warmQuery?.cleanup(),
          () => coldQuery.cleanup(),
          () => source.cleanup(),
        ],
        `Warm ordered readiness oracle cleanup failed`,
      )
      expect(observation!.requestsAtCut).toEqual(
        startsAtConstruction ? expectedRequests.slice(0, 1) : expectedRequests,
      )
      expect(observation!.requestsAfterSettlement).toEqual(expectedRequests)
      expect(observation!.immediate).toEqual({
        status: startsAtConstruction ? `loading` : `ready`,
        rows: startsAtConstruction || limit === 0 ? [] : [3, 4, 1, 2],
      })
      expect(observation!.settled).toEqual({
        status: `ready`,
        rows: limit === 0 ? [] : [3, 4, 1, 2],
      })
      expect(observation!.isLoadingSubset).toBe(false)
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
 * A fallback remains in the initial chain when its leading boundary cannot
 * be expressed as a cursor. The warm readiness oracle above checks a null
 * boundary after an ordered request. It observes the request trace and public
 * status immediately after preload starts the sync run, rather than before
 * acquisition. The locale-string cells check the same law for `findOne()`.
 * A Promise result for the fallback keeps the window unpublished at that cut.
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
