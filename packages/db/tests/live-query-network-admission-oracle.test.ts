/**
 * # When may a live query start network?
 *
 * A live query reads local memory. It never starts network on its own.
 * Network comes from a source Collection that syncs because of its own
 * `startSync: true`, because a public subscriber attached, or because
 * `preload()` asked for it. A live query's internal subscription to its
 * sources does not count until the live query itself is admitted: it has an
 * admitted subscriber or a `preload()` in its current sync run. The rule is
 * transitive. A live query over a live query admits its inner query only when
 * it is admitted itself.
 *
 * Before admission a live query may start its local pipeline (render or
 * `startSync`) and read rows its sources already hold. It must not start an
 * idle source's sync run or make an acquisition attempt on an on-demand
 * source. After admission the network work it held proceeds. Cleanup ends the
 * sync run, so a restarted live query is unadmitted again.
 *
 * Limits: sources load synchronously, so every checkpoint is settled. The
 * grammar crosses four source states with one or two live-query levels. It
 * does not generate concurrent consumers, failure, or truncate; the
 * subscription lifecycle oracle owns those for an admitted subscription.
 */
import { describe, expect, it } from 'vitest'
import { BTreeIndex, createCollection, createLiveQueryCollection } from '../src'
import type { Collection } from '../src'

type Row = { id: string; rank: number }
const ROWS: Array<Row> = [
  { id: `a`, rank: 1 },
  { id: `b`, rank: 2 },
  { id: `c`, rank: 3 },
]
const ALL_IDS = ROWS.map((row) => row.id)

/**
 * ## Source states
 *
 * `eager-running` and `on-demand-running` already synced on their own, by
 * `startSync: true`, before any live query exists. `eager-idle` and
 * `on-demand-idle` have not started. An eager source writes every row when its
 * sync run starts. An on-demand source writes rows only when a subset is
 * acquired. Each fixture counts sync-run starts and acquisition attempts:
 * those are its network.
 */
type SourceState =
  | `eager-idle`
  | `eager-running`
  | `on-demand-idle`
  | `on-demand-running`

const SOURCE_STATES: Array<SourceState> = [
  `eager-idle`,
  `eager-running`,
  `on-demand-idle`,
  `on-demand-running`,
]

/**
 * ## History grammar
 *
 * Commands act on the outermost live query, which is the only public
 * Collection in the history. `start` starts its local pipeline, as a framework
 * render or `startSync: true` does. `subscribe` and `preload` are the two
 * admissions. `cleanup` ends its sync run. Each history is a legal sequence; a
 * history never subscribes twice or unsubscribes without a subscription.
 */
type Command =
  | `start`
  | `read`
  | `subscribe`
  | `unsubscribe`
  | `preload`
  | `cleanup`

const HISTORIES: Record<string, Array<Command>> = {
  'start and read without a consumer': [`start`, `read`],
  'subscribe after start': [`start`, `read`, `subscribe`],
  'preload after start': [`start`, `preload`],
  'subscribe without a prior start': [`subscribe`],
  'cleanup before admission, then subscribe': [
    `start`,
    `read`,
    `cleanup`,
    `start`,
    `subscribe`,
  ],
  'restart after an admitted run': [
    `start`,
    `subscribe`,
    `unsubscribe`,
    `cleanup`,
    `start`,
    `read`,
  ],
}

/**
 * ## Reference model
 *
 * The model tracks only what the law names: whether the outer live query is
 * admitted in its current sync run, whether its local pipeline runs, and
 * whether the source already holds rows. It never reads production state.
 *
 * - While unadmitted after a command, the source's starts and acquisitions do
 *   not change.
 * - The first admission of an idle source starts its sync run once. Admission
 *   over an on-demand source acquires at least one subset.
 * - Rows visible through a running pipeline are the source rows it already
 *   holds: every row once the source holds them, and none otherwise.
 */
type ModelState = {
  admitted: boolean
  pipelineRunning: boolean
  sourceHoldsRows: boolean
  sourceStarted: boolean
}

type Expected = {
  admitted: boolean
  startsAdded: number | `none`
  acquisitionsAdded: `none` | `some`
  ids: Array<string> | `unread`
}

function initialModel(state: SourceState): ModelState {
  return {
    admitted: false,
    pipelineRunning: false,
    sourceHoldsRows: state === `eager-running`,
    sourceStarted: state.endsWith(`running`),
  }
}

function applyModel(
  state: SourceState,
  model: ModelState,
  command: Command,
): { next: ModelState; expected: Expected } {
  const onDemand = state.startsWith(`on-demand`)
  const next = { ...model }
  switch (command) {
    case `start`:
    case `read`:
      next.pipelineRunning = true
      break
    case `subscribe`:
    case `preload`:
      next.pipelineRunning = true
      next.admitted = true
      break
    case `unsubscribe`:
      // Admission belongs to the sync run, not to one subscription.
      break
    case `cleanup`:
      next.admitted = false
      next.pipelineRunning = false
      break
  }
  const admittedNow = next.admitted && !model.admitted
  let startsAdded: Expected[`startsAdded`] = `none`
  if (admittedNow && !next.sourceStarted) {
    startsAdded = 1
    next.sourceStarted = true
  }
  let acquisitionsAdded: Expected[`acquisitionsAdded`] = `none`
  if (admittedNow && onDemand) acquisitionsAdded = `some`
  if (admittedNow) next.sourceHoldsRows = true
  return {
    next,
    expected: {
      admitted: next.admitted,
      startsAdded,
      acquisitionsAdded,
      ids:
        command === `read` || next.admitted
          ? next.pipelineRunning && next.sourceHoldsRows
            ? ALL_IDS
            : []
          : `unread`,
    },
  }
}

/**
 * ## Production driver
 *
 * Real Collections only. The source counts its own network; the driver reads
 * the outer live query's rows through `toArray`, which is a local read.
 */
let sequence = 0

function makeSource(state: SourceState) {
  const counts = { starts: 0, acquisitions: 0 }
  const onDemand = state.startsWith(`on-demand`)
  const written = new Set<string>()
  const collection = createCollection<Row>({
    id: `network-admission-${sequence++}`,
    getKey: (row) => row.id,
    syncMode: onDemand ? `on-demand` : `eager`,
    startSync: state.endsWith(`running`),
    autoIndex: `eager`,
    defaultIndexType: BTreeIndex,
    gcTime: 0,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        counts.starts++
        const writeAll = () => {
          begin()
          for (const row of ROWS) {
            if (written.has(row.id)) continue
            written.add(row.id)
            write({ type: `insert`, value: row })
          }
          commit()
        }
        if (!onDemand) writeAll()
        markReady()
        if (!onDemand) return
        return {
          loadSubset: () => {
            counts.acquisitions++
            writeAll()
            return true
          },
        }
      },
    },
  })
  if (state === `on-demand-running`) {
    // The on-demand source runs, but holds no rows until a subset loads.
    expect(collection.status).toBe(`ready`)
  }
  return { collection, counts }
}

function makeLiveQuery(
  source: Collection<Row, string | number, any>,
  depth: 1 | 2,
) {
  const inner = createLiveQueryCollection({
    query: (q) =>
      q.from({ row: source }).orderBy(({ row }) => row.rank, `asc`),
    gcTime: 0,
  })
  if (depth === 1) return { outer: inner, collections: [inner] }
  const outer = createLiveQueryCollection({
    query: (q) =>
      q.from({ row: inner }).orderBy(({ row }) => row.rank, `asc`),
    gcTime: 0,
  })
  return { outer, collections: [outer, inner] }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 4; turn++) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * ## Refinement check
 *
 * After every command the driver settles, then compares the source's added
 * network and the outer query's visible rows with the model. A failure names
 * the source state, depth, history, and step.
 */
describe(`live-query network admission`, () => {
  for (const state of SOURCE_STATES) {
    for (const depth of [1, 2] as const) {
      for (const [name, commands] of Object.entries(HISTORIES)) {
        it(`${state}, depth ${depth}: ${name}`, async () => {
          const { collection: source, counts } = makeSource(state)
          const { outer, collections } = makeLiveQuery(source, depth)
          let model = initialModel(state)
          let subscription: { unsubscribe: () => void } | undefined
          try {
            for (const [step, command] of commands.entries()) {
              const before = { ...counts }
              switch (command) {
                case `start`:
                  outer.startSyncImmediate()
                  break
                case `read`:
                  break
                case `subscribe`:
                  subscription = outer.subscribeChanges(() => {}, {
                    includeInitialState: true,
                  })
                  break
                case `unsubscribe`:
                  subscription?.unsubscribe()
                  subscription = undefined
                  break
                case `preload`:
                  await outer.preload()
                  break
                case `cleanup`:
                  subscription?.unsubscribe()
                  subscription = undefined
                  await outer.cleanup()
                  break
              }
              await settle()
              const result = applyModel(state, model, command)
              model = result.next
              const { expected } = result
              const where = `${command} at step ${step}`

              const startsAdded = counts.starts - before.starts
              expect(startsAdded, `${where}: sync-run starts`).toBe(
                expected.startsAdded === `none` ? 0 : expected.startsAdded,
              )
              const acquisitionsAdded = counts.acquisitions - before.acquisitions
              if (expected.acquisitionsAdded === `none`) {
                expect(acquisitionsAdded, `${where}: acquisitions`).toBe(0)
              } else {
                expect(
                  acquisitionsAdded,
                  `${where}: acquisitions`,
                ).toBeGreaterThan(0)
              }
              if (expected.ids !== `unread`) {
                expect(
                  outer.toArray.map((row) => row.id),
                  `${where}: rows`,
                ).toEqual(expected.ids)
              }
            }
          } finally {
            subscription?.unsubscribe()
            for (const collection of collections) await collection.cleanup()
            await source.cleanup()
          }
        })
      }
    }
  }
})
