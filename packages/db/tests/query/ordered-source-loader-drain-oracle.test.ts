/**
 * # A staged refill waits for joined work without spinning
 *
 * ## Contract
 *
 * `query/live/ARCHITECTURE.md`, "Ordered requests, continuation, and
 * recovery": a synchronous request stages its continuation and resumes it once
 * the request returns. Joined demand blocks a refill until that demand settles.
 * Together they promise that a tie request answered synchronously while joined
 * work is pending returns to its caller, issues no refill, and leaves exactly
 * one refill for the graph pass that follows the joined settlement.
 *
 * The same section has core wait for lazy join demand and any joined subset
 * load before the next root page, and says a joined load can settle without
 * delivering a row, so its settlement reruns the graph itself. The refill
 * resumes on that settlement whether or not it delivers a row: the window then
 * publishes the first eligible rows and becomes ready.
 *
 * ## Limits
 *
 * This oracle covers the four cells of `drainCases` on a real loader with a
 * fake subscription: whether joined work is pending when the tie answers, and
 * whether the tie's answer wrote input the graph has not processed. Provider
 * failures, truncates and window moves belong to the request-authority oracle.
 * The joined-settlement property crosses a lazy or eager joined source with a
 * settlement that delivers no row or one, on real Collections with one fixed
 * row set and a window wider than it.
 *
 * ## Model
 *
 * `expectedRequests` counts requests from the two axes alone. The first page
 * and its tie always run. The refill runs at the tie's return only when nothing
 * holds it: no joined work, and no written input awaiting a graph pass.
 * Otherwise it runs at the pass after joined work settles. It runs once.
 * `expectedSettledWindow` filters the installed rows by the joined rows the
 * settlement delivered, orders them by rank and takes the limit.
 *
 * ## Production path and observation
 *
 * The driver runs `OrderedSourceLoader` and observes the ordered requests that
 * reach the subscription at two checkpoints. A spin issues no request, so the
 * joined-work callback carries a read budget: exceeding it ends the loop and
 * fails the `drain terminates` comparison instead of hanging the runner. The
 * joined-settlement driver runs a live query whose first page settles while
 * the joined source's load is pending, then settles that load and observes
 * the live query's status and rows.
 *
 * Each property declares the paths its cells must execute as enumerated
 * states, and each driver reports the path it observed: the chain's length
 * answered inside `start`, which observation held the refill (a joined-work
 * read answering pending, or a tie that advanced the graph input), and a
 * refill held while the joined load was pending and issued after it settled,
 * with the rows that settlement delivered. A history that misses its cell's
 * state fails its own check, and the reach test fails when no history enters
 * a declared state.
 */
import { describe, expect } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import {
  add,
  createLiveQueryCollection,
  eq,
  isUndefined,
} from '../../src/query/index.js'
import { OrderedSourceLoader } from '../../src/query/live/ordered-source-loader.js'
import { oracleProperty, violation } from '../oracle-config.js'
import {
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { flushPromises } from '../utils.js'
import {
  createDeferred,
  createOrderByInfo,
} from './ordered-source-loader-support.js'
import type { CollectionSubscription } from '../../src/collection/subscription.js'
import type { Observation, Verdict } from '../oracle-config.js'
import type { RequestOptions } from './ordered-source-loader-support.js'

const drainCases = [false, true].flatMap((joinedPending) =>
  [false, true].map((tieWritesInput) => ({ joinedPending, tieWritesInput })),
)
type DrainCase = (typeof drainCases)[number]

// More reads than any terminating drain makes for one settlement.
const joinedReadBudget = 1000

function expectedRequests({ joinedPending, tieWritesInput }: DrainCase) {
  return {
    atTieReturn:
      joinedPending || tieWritesInput
        ? [`page`, `tie`]
        : [`page`, `tie`, `page`],
    afterJoinedSettles: [`page`, `tie`, `page`],
  }
}

// The paths the drain cells must execute. A refill is held when the tie's
// return issues none and the pass after the joined settlement issues it; what
// held it is what the run observed: a joined-work read that answered pending,
// or a tie answer that advanced the graph input revision.
const drainStates = [
  `refill at the tie's return`,
  `refill held by pending joined work with no new input`,
  `refill held by new input`,
] as const
type DrainState = (typeof drainStates)[number]

function requiredDrainState({
  joinedPending,
  tieWritesInput,
}: DrainCase): DrainState {
  if (tieWritesInput) return `refill held by new input`
  return joinedPending
    ? `refill held by pending joined work with no new input`
    : `refill at the tie's return`
}

function observedDrainState(run: {
  refillsAtTieReturn: number
  refillsAfterSettlement: number
  pendingJoinedReads: number
  inputAdvanced: boolean
}): DrainState | undefined {
  if (run.refillsAtTieReturn === 1) return `refill at the tie's return`
  if (run.refillsAtTieReturn !== 0 || run.refillsAfterSettlement !== 1)
    return undefined
  if (run.inputAdvanced) return `refill held by new input`
  if (run.pendingJoinedReads > 0)
    return `refill held by pending joined work with no new input`
  return undefined
}

async function runDrainCell(
  cell: DrainCase,
  reached: (state: DrainState) => void,
): Promise<void> {
  const expected = expectedRequests(cell)
  const requests: Array<`page` | `tie`> = []
  const firstPage = createDeferred()
  let graphInputRevision = 0
  let joinedPending = false
  let joinedReads = 0
  let pendingJoinedReads = 0
  let tieReturned = false
  let refillsAtTieReturn = 0
  let inputAdvanced = false
  const subscription = {
    setOrderByIndex: () => {},
    readOrderedSnapshot: () => [{ value: { rank: 1 } }],
    requestLimitedSnapshot: (options: RequestOptions) => {
      requests.push(`page`)
      const result =
        requests.length === 1 ? firstPage.promise : new Promise<void>(() => {})
      options.onLoadSubsetResult?.(result, options, () => {})
    },
    requestSnapshot: (options: RequestOptions) => {
      requests.push(`tie`)
      if (cell.tieWritesInput) graphInputRevision++
      options.onLoadSubsetResult?.(true, options, () => {})
    },
  }
  const loader = new OrderedSourceLoader(
    createOrderByInfo({ joinedFilterSourceIds: [`joined`] }),
    subscription as unknown as CollectionSubscription,
    `row`,
    () => {},
    () => false,
    () => graphInputRevision,
    () => {
      if (++joinedReads > joinedReadBudget) {
        throw new Error(`joined-work read budget exceeded`)
      }
      if (joinedPending && !tieReturned) pendingJoinedReads++
      return joinedPending
    },
  )
  const refills = () => requests.filter((r, i) => r === `page` && i > 0).length
  try {
    loader.start()
    joinedPending = cell.joinedPending
    firstPage.resolve()
    await flushPromises().catch(() => {})
    tieReturned = true
    refillsAtTieReturn = refills()
    inputAdvanced = graphInputRevision > 0
    expect(joinedReads, `drain terminates`).toBeLessThanOrEqual(
      joinedReadBudget,
    )
    expect(requests, `requests at the tie's return`).toEqual(
      expected.atTieReturn,
    )

    joinedPending = false
    loader.loadMore()
    await flushPromises()
    const state = observedDrainState({
      refillsAtTieReturn,
      refillsAfterSettlement: refills() - refillsAtTieReturn,
      pendingJoinedReads,
      inputAdvanced,
    })
    if (state) reached(state)
    expect(requests, `requests after joined work settles`).toEqual(
      expected.afterJoinedSettles,
    )
  } finally {
    loader.dispose()
  }
}

// A provider that answers every page and tie from installed rows keeps the
// drain issuing work from inside its own settlement. The drain owns that chain
// as a loop, so its length cannot grow the call stack. The model is the count:
// each of the chain's pages is issued once, and the request past the chain
// stays in flight.
const chainCases = [{ pages: 1 }, { pages: 20_000 }]

// The chain lengths that must run inside one `start` call. The long chain is
// longer than any call stack a recursive drain could hold.
const longChain = 10_000
const chainStates = [`one synchronous page`, `long synchronous chain`] as const
type ChainState = (typeof chainStates)[number]

function requiredChainState({ pages }: (typeof chainCases)[number]) {
  return pages > longChain ? `long synchronous chain` : `one synchronous page`
}

function runSynchronousChain(
  { pages }: (typeof chainCases)[number],
  reached: (state: ChainState) => void,
): void {
  let pageRequests = 0
  let rank = 0
  let inStart = false
  let answeredInStart = 0
  const subscription = {
    setOrderByIndex: () => {},
    readOrderedSnapshot: () => [{ value: { rank } }],
    requestLimitedSnapshot: (options: RequestOptions) => {
      pageRequests++
      rank++
      const result = pageRequests > pages ? new Promise<void>(() => {}) : true
      if (inStart && result === true) answeredInStart++
      options.onLoadSubsetResult?.(result, options, () => {})
    },
    requestSnapshot: (options: RequestOptions) => {
      options.onLoadSubsetResult?.(true, options, () => {})
    },
  }
  const loader = new OrderedSourceLoader(
    createOrderByInfo(),
    subscription as unknown as CollectionSubscription,
    `row`,
    () => {},
    () => false,
    () => 0,
  )
  try {
    expect(() => {
      inStart = true
      try {
        loader.start()
      } finally {
        inStart = false
      }
    }, `chain returns`).not.toThrow()
    if (answeredInStart === 1) reached(`one synchronous page`)
    if (answeredInStart > longChain) reached(`long synchronous chain`)
    expect(pageRequests, `pages issued`).toBe(pages + 1)
  } finally {
    loader.dispose()
  }
}

// A joined source is lazy when the join reads its key as a plain field, and
// eager when the key is computed. Either way, its settlement resumes the
// refill that its pending load staged, even when it delivers no row.
const settlementCases = ([`lazy`, `eager`] as const).flatMap((joined) =>
  [[], [1]].map((markedRows) => ({ joined, markedRows })),
)
type SettlementCase = (typeof settlementCases)[number]

const settlementRows = [
  { id: 1, rank: 1 },
  { id: 2, rank: 2 },
]
const settlementLimit = 3

// The paths the settlement cells must execute: the first page settles, the
// refill stays held while the joined load is pending, and the settlement,
// with the rows it actually delivered, resumes it.
const settlementStates = [`lazy`, `eager`].flatMap((joined) =>
  [`no row`, `a row`].map(
    (rows) => `held ${joined} refill resumed by a settlement with ${rows}`,
  ),
)

function settlementState(joined: string, deliveredRows: number) {
  return `held ${joined} refill resumed by a settlement with ${deliveredRows === 0 ? `no row` : `a row`}`
}

function expectedSettledWindow({ markedRows }: SettlementCase) {
  return {
    status: `ready`,
    ids: settlementRows
      .filter((row) => !markedRows.includes(row.id))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, settlementLimit)
      .map((row) => row.id),
  }
}

async function runSettlementCell(
  cell: SettlementCase,
  reached: (state: string) => void,
): Promise<void> {
  type Row = (typeof settlementRows)[number]
  type Marker = { id: number; rowId: number }
  const firstPage = createDeferred()
  const joinedLoads: Array<() => void> = []
  let pages = 0
  const rows = createCollection<Row, number>({
    id: `joined-settlement-rows-${Math.random()}`,
    getKey: (row) => row.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () => {
            if (++pages > 1) return true
            return firstPage.promise.then(() => {
              begin()
              for (const value of settlementRows) {
                write({ type: `insert`, value })
              }
              commit()
            })
          },
        }
      },
    },
  })
  const markers = createCollection<Marker, number>({
    id: `joined-settlement-markers-${Math.random()}`,
    getKey: (marker) => marker.id,
    syncMode: `on-demand`,
    startSync: true,
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        markReady()
        return {
          loadSubset: () =>
            new Promise<void>((resolve) => {
              joinedLoads.push(() => {
                begin()
                for (const rowId of cell.markedRows) {
                  write({ type: `insert`, value: { id: rowId, rowId } })
                }
                commit()
                resolve()
              })
            }),
        }
      },
    },
  })
  const live = createLiveQueryCollection({
    startSync: true,
    query: (q) =>
      q
        .from({ row: rows })
        .leftJoin({ marker: markers }, ({ row, marker }) =>
          eq(
            row.id,
            cell.joined === `lazy` ? marker.rowId : add(marker.rowId, 0),
          ),
        )
        .where(({ marker }) => isUndefined(marker.id))
        .orderBy(({ row }) => row.rank)
        .limit(settlementLimit),
  })
  try {
    const preload = live.preload()
    await flushPromises()
    firstPage.resolve()
    await flushPromises()
    const heldPages = pages
    const held = joinedLoads.length > 0 && live.status !== `ready`
    while (joinedLoads.length > 0) {
      joinedLoads.shift()!()
      await flushPromises()
    }
    if (held && pages > heldPages)
      reached(settlementState(cell.joined, markers.size))
    expect(
      { status: live.status, ids: live.toArray.map(({ row }) => row.id) },
      `window after the joined settlement`,
    ).toEqual(expectedSettledWindow(cell))
    await preload
  } finally {
    await Promise.all([live.cleanup(), markers.cleanup(), rows.cleanup()])
  }
}

// A history must enter the state its cell names, after its comparisons pass,
// so lost premise coverage fails its own history and not only the reach test.
function requireReach(
  judgment: Verdict,
  trace: ReadonlyArray<Observation>,
  state: string,
  law: string,
): Verdict {
  if (judgment.kind === `violation`) return judgment
  return trace.some(
    ({ checkpoint, value }) => checkpoint === `reach` && value === state,
  )
    ? judgment
    : violation(`reach`, `history did not enter ${state}`, law)
}

// One control per state: the history that must enter it, with its reach
// removed from the trace, fails under the reach law.
function missingStateControls<TCell>(
  cells: ReadonlyArray<TCell>,
  required: (cell: TCell) => string,
  label: (cell: TCell) => string,
  states: ReadonlyArray<string>,
  law: string,
) {
  return states.map((state) => ({
    name: `rejects a history missing ${state}`,
    law,
    difference: state,
    history: { enumerated: label(cells.find((c) => required(c) === state)!) },
    corrupt: (trace: ReadonlyArray<Observation>) =>
      trace.filter(({ checkpoint }) => checkpoint !== `reach`),
  }))
}

const chainLabel = ({ pages }: (typeof chainCases)[number]) =>
  `drains ${pages} synchronous pages`
const drainLabel = ({ joinedPending, tieWritesInput }: DrainCase) =>
  `drains a synchronous tie with joined ${joinedPending ? `pending` : `idle`} and ${tieWritesInput ? `new` : `no new`} input`
const settlementLabel = ({ joined, markedRows }: SettlementCase) =>
  `publishes after a ${joined} joined settlement with ${markedRows.length} rows`
const requiredSettlementState = ({ joined, markedRows }: SettlementCase) =>
  settlementState(joined, markedRows.length)

describe(`OrderedSourceLoader joined drain`, () => {
  oracleProperty({
    id: `ordered-source-loader.synchronous-chain`,
    law: {
      statement: `A chain of synchronously answered pages and ties drains in a loop: each page is issued once and the chain's length does not grow the call stack.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Two chain lengths on a fake subscription with no joined work.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: { enumerated: chainCases, states: chainStates },
    label: chainLabel,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`synchronous chain`, plan, observe, () =>
        runSynchronousChain(plan.cell, (state) => observe(`reach`, state)),
      ),
    check: (plan, trace, judgment) =>
      requireReach(
        judgment,
        trace,
        requiredChainState(plan.cell),
        `synchronous chain reach`,
      ),
    calibrations: missingStateControls(
      chainCases,
      requiredChainState,
      chainLabel,
      chainStates,
      `synchronous chain reach`,
    ),
  })

  oracleProperty({
    id: `ordered-source-loader.joined-drain`,
    law: {
      statement: `A tie answered synchronously while joined work is pending returns, issues no refill, and leaves one refill for the pass after the joined work settles.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `The four cells of drainCases on a fake subscription; failures, truncates and window moves belong to the request-authority oracle.`,
    },
    owns: ['src/query/live/ordered-source-loader.ts'],
    histories: { enumerated: drainCases, states: drainStates },
    label: drainLabel,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`joined drain requests`, plan, observe, () =>
        runDrainCell(plan.cell, (state) => observe(`reach`, state)),
      ),
    check: (plan, trace, judgment) =>
      requireReach(
        judgment,
        trace,
        requiredDrainState(plan.cell),
        `joined drain reach`,
      ),
    calibrations: missingStateControls(
      drainCases,
      requiredDrainState,
      drainLabel,
      drainStates,
      `joined drain reach`,
    ),
  })

  oracleProperty({
    id: `ordered-source-loader.joined-settlement`,
    law: {
      statement: `A joined source's settled load resumes the refill its pending load staged, even when it delivers no row: the window then publishes the first eligible rows and is ready.`,
      authority: `query/live/ARCHITECTURE.md: Ordered requests, continuation, and recovery.`,
      limits: `Lazy and eager joined sources settling with no row or one, on one fixed row set; failures, truncates and window moves belong to the request-authority oracle.`,
    },
    owns: [
      'src/query/live/collection-subscriber.ts',
      'src/query/live/ordered-source-loader.ts',
    ],
    histories: { enumerated: settlementCases, states: settlementStates },
    label: settlementLabel,
    resolve: (cell) => ({ cell }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`joined settlement window`, plan, observe, () =>
        runSettlementCell(plan.cell, (state) => observe(`reach`, state)),
      ),
    check: (plan, trace, judgment) =>
      requireReach(
        judgment,
        trace,
        requiredSettlementState(plan.cell),
        `joined settlement reach`,
      ),
    calibrations: missingStateControls(
      settlementCases,
      requiredSettlementState,
      settlementLabel,
      settlementStates,
      `joined settlement reach`,
    ),
  })
})
