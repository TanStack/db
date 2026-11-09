import { expect, it } from 'vitest'
import fc from 'fast-check'
import { DbClient } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRoute,
  oracleRuns,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { oracleProperty, pass, violation } from './oracle-property.js'
import { createOracleReach } from './oracle-reach.js'
import { ScenarioLifetime } from './conformance/scenario-lifetime.js'
import {
  atOracleCheckpoint,
  createOracleFailureFidelity,
} from './oracle-failure-fidelity.js'
import type {
  ChangeMessage,
  CollectionStatus,
  SyncConfig,
} from '../src/types.js'

/**
 * # What does a hydrated observer show when its Collection fails or ends?
 *
 * A DbClient can hold a server result for a query identity: the hydration
 * seed. While the seed is active, the observer shows it as a `ready` result,
 * because it stands in for the live query's initial result, which the
 * Collection has not produced yet. Initial-query readiness hands the seed off
 * to the live rows (focused tests `shows a hydrated result...` and
 * `delivers an atomic hydrated-to-live diff...` in `live-query-observer.test.ts`).
 *
 * This oracle owns the other ways the seed's sync run can end, and the laws
 * come from `packages/db/src/query/live/ARCHITECTURE.md`, law 16, and the
 * glossary entries "crash" and "cleanup":
 *
 * 1. **A failure is never hidden.** A query takes its sources' worst status
 *    until initial-query readiness (`crashed` over `error` over `loading`),
 *    and after it only `crashed` propagates, because a query cannot keep
 *    serving rows from a Collection that cannot serve reads. So while the
 *    Collection's status is `error` or `crashed`, the snapshot shows that
 *    status, with or without a seed, attached or detached.
 * 2. **A failure ends the seed.** `error` is final for its sync run, and
 *    nothing recovers a crash in place. Either way this sync run will never
 *    produce the initial result that the seed stands in for. Once an attached
 *    observer has seen the failure, it behaves like an observer without a
 *    seed: when cleanup leaves the failure, the snapshot shows the live
 *    Collection (`cleaned-up`, no rows), not the stale failure and not the
 *    server rows as `ready`. A detached read must not consume a shared server
 *    result (focused test `does not consume a shared hydration result during
 *    an abandoned render read`), so a detached observer only shows the
 *    failure; it ends the seed when it attaches.
 * 3. **Cleanup alone does not end the seed.** `cleaned-up` is not a failure,
 *    and a cleaned-up Collection restarts on demand. While the seed is active,
 *    cleanup and a restart are part of "not produced yet": the snapshot keeps
 *    showing the seed as `ready`, and the next sync run's readiness hands off.
 *    Once the seed has ended, the observer shows the live Collection through
 *    cleanup and restart too: `cleaned-up` with no rows (cleanup discards all
 *    of the Collection's state, glossary "crash"), then each row the new sync
 *    run writes. That includes a row equal to one shown before cleanup: the
 *    observer let that row go at cleanup, so a Collection subscription that
 *    reconciles later writes against the rows it published before cleanup
 *    must not count it as already shown ([#2334](https://github.com/TanStack/db/issues/2334)).
 *    This claim adds no rule of its own. Its authority is law 2 (an observer
 *    whose seed ended behaves like one without a seed, which shows the live
 *    Collection) and the glossary: "cleanup" ends the sync run and leaves the
 *    Collection available for restart, and "crash" says that cleanup discards
 *    all of the Collection's state, so a later start is a fresh start. A row
 *    the new sync run writes is a row the live Collection holds, whether or
 *    not an equal row was shown before. ARCHITECTURE "Cleanup, restart, and
 *    detached waiters" documents the mechanism that keeps it: the observer's
 *    Collection subscription retains no rows across cleanup.
 * 4. **Every visible change is announced.** Wholesale consumers re-read
 *    `getSnapshot()` only when notified (`useSyncExternalStore` does one
 *    consistency read right after subscribing). So, while attached, the
 *    snapshot a listener last read equals the current snapshot at every
 *    checkpoint, and a granular listener's rows rebuilt from delivered changes
 *    equal the snapshot's rows. A synthetic notification (`undefined`) has no
 *    changes, so a granular consumer rebuilds from the snapshot then.
 *
 * The model is the seed, whether an attached observer has ended it, and
 * whether the observer is attached. The Collection is the observer's input:
 * the driver records its public status and rows as the step's input, and the
 * model reads only those, so it does not model the Collection lifecycle. The
 * observer's snapshot and announcements are the step's output, which only the
 * check reads. Rows under a failure status are not claimed, because that
 * status says the data cannot be shown; law 4 still checks them.
 *
 * ## Contract and ownership table

| Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
| --- | --- | --- | --- | --- |
| failure shown under a seed | seed of 0..3 rows, or none; live writes; `fail()`, `crash()`, cleanup, restart, `markReady()`, attach, in any legal order | DbClient hydrate -> getSnapshot status mapping; status listener -> notify | snapshot `status` and flags after each step and a macrotask | this generated oracle |
| failure ends the seed | the same, with cleanup after the failure | notify/attach -> seed handoff | `cleaned-up` and live rows after cleanup | this generated oracle |
| cleanup keeps the seed | cleanup and restart while the seed is active | notify early return under the seed | `ready` and seed rows | this generated oracle; recorded decision, not a law-16 claim |
| restart after the seed ended | cleanup and restart after readiness or a failure ended the seed; the new sync run rewrites a row equal to one shown before cleanup | notify `cleaned-up` reset -> Collection subscription reconciliation | live rows after each later step | this generated oracle |
| announced changes | every step while attached | emit -> flushPublications | last-read snapshot and granular rebuilt rows equal the current snapshot | this generated oracle |
| already-ready subset handoff | held subset at attach, then settlement without row/status change; both modes | seeded observer -> subset settlement | seed while held, live snapshot and announced granular/wholesale rows after settlement | generated ready-subset lane below; Svelte page receiver |
| other handoff timing, streamed errors, consumption | | | | focused `live-query-observer.test.ts` hydration tests |

 * Keys are `a`..`c`, versions 0..3, histories of 1..10 steps, both modes,
 * and an eager or an on-demand source. Every sync write also lands in the
 * provider's rows, which survive cleanup, and the on-demand source's loader
 * writes all of them again whenever a subscription loads a subset. So an
 * on-demand restart reacquires the subscription's demand and re-delivers rows
 * the observer showed before cleanup, which the restart claim of law 3 must
 * survive. A fifth of the histories hydrate no seed and build the observer
 * without a DbClient. Law 2 says an observer whose seed ended behaves like
 * that one, so it is the reference case, and it is the only observer whose
 * granular subscription asks the source for its initial rows: the subset
 * demand that an on-demand restart reacquires.
 * Constructed histories start a generated history with the steps that enter each declared
 * state, so every grammar reaches every state. Rows are
 * compared as sets by key: this oracle makes no order claim. The source is a
 * plain controlled Collection, not a live-query Collection, so source health
 * propagation through a query graph belongs to `source-health-oracle.test.ts`.
 */

type Row = { id: string; version: number }
type Mode = `granular` | `wholesale`
type SyncMode = `eager` | `on-demand`
type Key = `a` | `b` | `c`
type Event =
  | { type: `write`; key: Key; version: number | null }
  | { type: `ready` }
  | { type: `fail` }
  | { type: `crash` }
  | { type: `cleanup` }
  | { type: `restart` }
  | { type: `attach` }
type History = {
  mode: Mode
  syncMode: SyncMode
  /** The hydrated server rows, or `null` for an observer with no DbClient. */
  seed: Array<[Key, number]> | null
  events: Array<Event>
}
type VisibleRow = [string, number]
type View = { status: CollectionStatus | `disabled`; rows: Array<VisibleRow> }

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

const MAX_EVENTS = 10
const key = fc.constantFrom<Key>(`a`, `b`, `c`)
const version = fc.integer({ min: 0, max: 3 })
// A record of constants, not `fc.constant(object)`, so that a fixed or constructed history
// built from a literal is a member of the language (fast-check compares a
// constant by identity).
const step = <Type extends Event[`type`]>(type: Type) =>
  fc.record({ type: fc.constant(type) })
const event: fc.Arbitrary<Event> = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      key,
      version: fc.option(version, { freq: 3 }),
    }),
    weight: 2,
  },
  { arbitrary: step(`ready`), weight: 1 },
  { arbitrary: step(`fail`), weight: 1 },
  { arbitrary: step(`crash`), weight: 1 },
  { arbitrary: step(`cleanup`), weight: 1 },
  { arbitrary: step(`restart`), weight: 1 },
  { arbitrary: step(`attach`), weight: 2 },
)
const history: fc.Arbitrary<History> = fc.record({
  mode: fc.constantFrom<Mode>(`granular`, `wholesale`),
  syncMode: fc.constantFrom<SyncMode>(`eager`, `on-demand`),
  seed: fc.option(
    fc.uniqueArray(fc.tuple(key, version), {
      selector: ([id]) => id,
      maxLength: 3,
    }),
    { nil: null, freq: 4 },
  ),
  events: fc.array(event, { minLength: 1, maxLength: MAX_EVENTS }),
})

/** A step written as its type alone, or as a whole event (a write). */
type StepSpec = Event[`type`] | Event
const toEvent = (spec: StepSpec): Event =>
  typeof spec === `string` ? ({ type: spec } as Event) : spec

/** Starts a generated history with `prefix`, keeping it inside the grammar. */
const startWith =
  (...prefix: Array<StepSpec>) =>
  (generated: History): History => ({
    ...generated,
    events: [...prefix.map(toEvent), ...generated.events].slice(0, MAX_EVENTS),
  })

/** `startWith` for a state under the seed: an unseeded history gets an empty seed. */
const startSeededWith =
  (...prefix: Array<StepSpec>) =>
  (generated: History): History =>
    startWith(...prefix)({ ...generated, seed: generated.seed ?? [] })

/**
 * Starts a generated history by ending the seed with `end`, writing a row,
 * cleaning up, restarting, and writing the same row again. The row is the
 * generated history's first upsert, so the repeated key and version vary.
 * `plan` fixes the dimensions a declared state needs.
 */
const rewriteAfterRestart =
  (end: `ready` | `fail`, plan: Partial<History> = {}) =>
  (generated: History): History => {
    const row = generated.events.find(
      (next) => next.type === `write` && next.version !== null,
    ) ?? { type: `write`, key: `a`, version: 0 }
    const prefix: Array<StepSpec> =
      end === `ready`
        ? [`attach`, `ready`, row, `cleanup`, `restart`, row]
        : [`attach`, row, `fail`, `cleanup`, `restart`, row]
    return startWith(...prefix)({ ...generated, ...plan })
  }

// ---------------------------------------------------------------------------
// Trace
// ---------------------------------------------------------------------------
//
// One record per checkpoint: `start`, then one per step. A skipped step (one
// that is illegal in the Collection's current status) records only that it
// was skipped. An executed step records its input, the Collection's status
// before the step, right after it, and after a macrotask, and its rows then;
// and its output, what the observer showed and announced.

type StepInput = {
  action: Event[`type`] | `start`
  before: CollectionStatus
  during: CollectionStatus
  after: CollectionStatus
  live: Array<VisibleRow>
}
type StepOutput = {
  view: View
  flags: Record<
    `isReady` | `isLoadingError` | `isCrashed` | `isCleanedUp`,
    boolean
  >
  /** The snapshot a listener last read; undefined before attach. */
  lastRead: View | undefined
  /** A granular listener's rows rebuilt from delivered changes. */
  rebuilt: Array<VisibleRow> | undefined
}
type StepRecord = { skipped: true } | { input: StepInput; output: StepOutput }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

const reachStates = [
  `ready-under-seed:attached`,
  `error-under-seed:attached`,
  `crashed-under-seed:attached`,
  `cleaned-up-under-seed:attached`,
  `ready-under-seed:detached`,
  `error-under-seed:detached`,
  `crashed-under-seed:detached`,
  `cleaned-up-under-seed:detached`,
  `attach-to-failure-under-seed`,
  `cleanup-after-failure-ended-seed`,
  `restart-under-seed`,
  `restart-rewrites-row-from-before-cleanup`,
  `restart-reacquires-row-from-before-cleanup`,
] as const
type ReachState = (typeof reachStates)[number]

/**
 * `ended` records law 2: an attached observer saw a status that ends the
 * seed, either initial-query readiness (the handoff) or a failure.
 */
type Model = {
  seed: Array<VisibleRow>
  ended: boolean
  endedByFailure: boolean
  attached: boolean
}

const failures: ReadonlySet<string> = new Set([`error`, `crashed`])
const shownUnderSeed: ReadonlySet<string> = new Set([
  `ready`,
  `error`,
  `crashed`,
  `cleaned-up`,
])

function seedActive(model: Model): boolean {
  return !model.ended
}

/**
 * Advance the model across one step. `statuses` are the Collection statuses
 * the observer could see. An attached observer ends the seed when it sees
 * readiness or a failure (laws 1 and 2); cleanup and restart do not (law 3).
 */
function advance(model: Model, statuses: ReadonlyArray<string>): void {
  if (!model.attached || model.ended) return
  const ending = statuses.find(
    (status) => status === `ready` || failures.has(status),
  )
  if (ending === undefined) return
  model.ended = true
  model.endedByFailure = failures.has(ending)
}

/** The view the model allows. `rows: undefined` means rows are not claimed. */
function expectedView(
  model: Model,
  liveStatus: CollectionStatus,
  liveRows: Array<VisibleRow>,
): { status: CollectionStatus; rows: Array<VisibleRow> | undefined } {
  if (failures.has(liveStatus)) return { status: liveStatus, rows: undefined }
  if (seedActive(model)) return { status: `ready`, rows: model.seed }
  return { status: liveStatus, rows: liveRows }
}

type Expectation = ReturnType<typeof expectedView> & { attached: boolean }

/**
 * Folds the trace's inputs through the model: the view owed at each
 * checkpoint, and the declared states the history entered, which are model
 * states (whether the seed is active), so the model names them.
 */
function hydrationModel(
  { seed, mode, syncMode }: History,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
): { owed: Map<string, Expectation>; reached: Set<ReachState> } {
  const model: Model = {
    seed: sortedRows(
      (seed ?? []).map(([id, value]) => [id, { id, version: value }]),
    ),
    // An observer without a seed is the one that law 2's ended seed
    // behaves like.
    ended: seed === null,
    endedByFailure: false,
    attached: false,
  }
  const owed = new Map<string, Expectation>()
  const reached = new Set<ReachState>()
  // The rows the Collection held right before the latest cleanup, and
  // whether a sync run has restarted since. A step of the new run that
  // brings one of those rows back is where law 3's restart claim matters
  // after the seed ended. On an on-demand source, an unseeded granular
  // observer's own subset demand brings it back when the restart reacquires
  // that demand. Rows are compared by value as JSON.
  // The two restart states owe nothing new: `expectedView` already owes the
  // live rows once the seed ended (law 2), and the glossary's "cleanup" and
  // "crash" make the restarted run a fresh start. The states only mark the
  // histories where that law meets a row equal to one from before cleanup.
  let previousLive: Array<VisibleRow> = []
  let heldBeforeCleanup = new Set<string>()
  let restarted = false
  for (const { checkpoint, value } of trace) {
    const record = value as StepRecord
    if (`skipped` in record) continue
    const { action, before, during, after, live } = record.input
    if (action === `cleanup` && model.endedByFailure && failures.has(before))
      reached.add(`cleanup-after-failure-ended-seed`)
    if (action === `restart` && seedActive(model))
      reached.add(`restart-under-seed`)
    if (action === `cleanup`) {
      heldBeforeCleanup = new Set(
        previousLive.map((row) => JSON.stringify(row)),
      )
      restarted = false
    }
    if (action === `restart`) restarted = true
    if (
      (action === `write` || action === `restart`) &&
      restarted &&
      model.attached &&
      !seedActive(model) &&
      live.some((row) => heldBeforeCleanup.has(JSON.stringify(row)))
    ) {
      reached.add(`restart-rewrites-row-from-before-cleanup`)
      if (seed === null && mode === `granular` && syncMode === `on-demand`)
        reached.add(`restart-reacquires-row-from-before-cleanup`)
    }
    previousLive = live
    if (action === `attach`) {
      if (seedActive(model) && failures.has(before))
        reached.add(`attach-to-failure-under-seed`)
      model.attached = true
    }
    if (seedActive(model) && before !== during && shownUnderSeed.has(during))
      reached.add(
        `${during}-under-seed:${model.attached ? `attached` : `detached`}` as ReachState,
      )
    advance(model, [before, during])
    advance(model, [after])
    owed.set(checkpoint, {
      ...expectedView(model, after, live),
      attached: model.attached,
    })
  }
  return { owed, reached }
}

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

function sortedRows(entries: Iterable<[string, Row]>): Array<VisibleRow> {
  return Array.from(entries, ([id, row]): VisibleRow => [id, row.version]).sort(
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  )
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

let sequence = 0

/**
 * Runs one history and records each checkpoint. Steps that are illegal in
 * the Collection's current status, such as `markReady()` outside `loading`,
 * are skipped, so every executed step is a legal source history. Attach
 * subscribes once and does the consistency read `useSyncExternalStore` does.
 */
async function driveHistory(
  { mode, syncMode, seed, events }: History,
  observe: (checkpoint: string, value: StepRecord) => void,
): Promise<void> {
  const id = `observer-hydration-${sequence++}`
  const queryHash = `${id}-query`
  let ops: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const provider = new Map<string, Row>()
  const source = createCollection<Row, string>({
    id,
    getKey: (row) => row.id,
    startSync: false,
    syncMode,
    sync: {
      sync: (params) => {
        ops = params
        if (syncMode === `eager`) return
        // A subset load re-delivers every provider row and settles at once.
        return {
          loadSubset: () => {
            params.begin()
            for (const value of provider.values())
              params.write({
                type: source.has(value.id) ? `update` : `insert`,
                value,
              })
            params.commit()
            return true
          },
        }
      },
    },
  })
  const client = new DbClient()
  if (seed)
    client.hydrate({
      collections: [],
      liveQueries: [
        {
          queryHash,
          dehydratedAt: 1,
          snapshot: {
            rows: seed.map(([rowKey, rowVersion]) => ({
              key: rowKey,
              value: { id: rowKey, version: rowVersion },
            })),
          },
        },
      ],
    })
  source.startSyncImmediate()
  const observer = createLiveQueryObserver<Row, string>(
    source,
    seed ? { client, queryHash, mode } : { mode },
  )

  const rebuilt = new Map<string, Row>()
  let attached = false
  let lastRead: View | undefined
  const read = (): View => {
    const snapshot = observer.getSnapshot()
    return {
      status: snapshot.status,
      rows: sortedRows(snapshot.state ?? []),
    }
  }
  // A granular consumer applies delivered changes. A synthetic notification
  // (`undefined`) carries no changes, so it rebuilds from the snapshot, as
  // the Vue adapter does.
  const listener = (changes: Array<ChangeMessage<Row, string>> | undefined) => {
    if (changes === undefined) {
      rebuilt.clear()
      for (const [rowKey, row] of observer.getSnapshot().state ?? []) {
        rebuilt.set(rowKey, row)
      }
    }
    for (const change of changes ?? []) {
      if (change.type === `delete`) rebuilt.delete(change.key)
      else rebuilt.set(change.key, change.value)
    }
    lastRead = read()
  }
  const record = (
    checkpoint: string,
    input: Omit<StepInput, `after` | `live`>,
  ) => {
    const snapshot = observer.getSnapshot()
    observe(checkpoint, {
      input: {
        ...input,
        after: source.status,
        live: sortedRows(source.entries()),
      },
      output: {
        view: read(),
        flags: {
          isReady: snapshot.isReady,
          isLoadingError: snapshot.isLoadingError,
          isCrashed: snapshot.isCrashed,
          isCleanedUp: snapshot.isCleanedUp,
        },
        lastRead,
        rebuilt:
          attached && mode === `granular` ? sortedRows(rebuilt) : undefined,
      },
    })
  }

  let failure: { error: unknown } | undefined
  try {
    record(`start`, {
      action: `start`,
      before: source.status,
      during: source.status,
    })
    for (const [index, next] of events.entries()) {
      const checkpoint = `step ${index} (${next.type})`
      const before = source.status
      const skip = () => observe(checkpoint, { skipped: true })
      if (next.type === `write`) {
        if (before !== `loading` && before !== `ready`) {
          skip()
          continue
        }
        const present = source.has(next.key)
        if (next.version === null && !present) {
          skip()
          continue
        }
        const value = { id: next.key, version: next.version ?? 0 }
        if (next.version === null) provider.delete(next.key)
        else provider.set(next.key, value)
        ops!.begin()
        ops!.write(
          next.version === null
            ? { type: `delete`, key: next.key }
            : { type: present ? `update` : `insert`, value },
        )
        ops!.commit()
      } else if (next.type === `ready`) {
        if (before !== `loading`) {
          skip()
          continue
        }
        ops!.markReady()
      } else if (next.type === `fail`) {
        if (before !== `loading`) {
          skip()
          continue
        }
        ops!.fail(new Error(`first load failed`))
      } else if (next.type === `crash`) {
        if (before !== `loading` && before !== `ready` && before !== `error`) {
          skip()
          continue
        }
        source._lifecycle.crash(new Error(`local storage closed`))
      } else if (next.type === `cleanup`) {
        if (before === `cleaned-up`) {
          skip()
          continue
        }
        await source.cleanup()
      } else if (next.type === `restart`) {
        if (before !== `cleaned-up`) {
          skip()
          continue
        }
        source.startSyncImmediate()
      } else {
        if (attached) {
          skip()
          continue
        }
        attached = true
        observer.subscribe(listener)
        // The consistency read useSyncExternalStore does after subscribing.
        lastRead = read()
      }
      const during = source.status
      await settle()
      record(checkpoint, { action: next.type, before, during })
    }
  } catch (error) {
    failure = { error }
  }
  observer.dispose()
  await source.cleanup()
  if (failure) throw failure.error
}

// ---------------------------------------------------------------------------
// Check
// ---------------------------------------------------------------------------
//
// At every executed checkpoint the snapshot's status and flags are the owed
// status, and its rows are the owed rows when the model claims them (law
// `view`: laws 1-3). While attached, the snapshot a listener last read and a
// granular listener's rebuilt rows equal the current snapshot (law
// `announcement`: law 4). The trace must cover the start and every step; that
// is judged last, so a driver error cannot hide an earlier violation.

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function checkHistory(
  { events }: History,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
  { owed }: ReturnType<typeof hydrationModel>,
) {
  for (const { checkpoint, value } of trace) {
    const record = value as StepRecord
    if (`skipped` in record) continue
    const { view, flags, lastRead, rebuilt } = record.output
    const expected = owed.get(checkpoint)!
    if (view.status !== expected.status)
      return violation(
        checkpoint,
        `status ${view.status}, owed ${expected.status}`,
        `view`,
        { actual: view.status, expected: expected.status },
      )
    const owedFlags = {
      isReady: expected.status === `ready`,
      isLoadingError: expected.status === `error`,
      isCrashed: expected.status === `crashed`,
      isCleanedUp: expected.status === `cleaned-up`,
    }
    if (!same(flags, owedFlags))
      return violation(
        checkpoint,
        `flags ${JSON.stringify(flags)}, owed ${JSON.stringify(owedFlags)}`,
        `view`,
        { actual: flags, expected: owedFlags },
      )
    if (expected.rows !== undefined && !same(view.rows, expected.rows))
      return violation(
        checkpoint,
        `rows ${JSON.stringify(view.rows)}, owed ${JSON.stringify(expected.rows)}`,
        `view`,
        { actual: view.rows, expected: expected.rows },
      )
    if (!expected.attached) continue
    if (!same(lastRead, view))
      return violation(
        checkpoint,
        `a listener last read ${JSON.stringify(lastRead)}; the snapshot is ${JSON.stringify(view)} (unannounced change)`,
        `announcement`,
        { actual: lastRead, expected: view },
      )
    if (rebuilt !== undefined && !same(rebuilt, view.rows))
      return violation(
        checkpoint,
        `granular rows ${JSON.stringify(rebuilt)}; the snapshot has ${JSON.stringify(view.rows)}`,
        `announcement`,
        { actual: rebuilt, expected: view.rows },
      )
  }
  // Completeness last: a history whose driver threw keeps the violation
  // found at a recorded checkpoint.
  if (trace.length !== events.length + 1)
    return violation(
      `trace`,
      `the driver recorded ${trace.length} checkpoints for ${events.length} steps`,
      `trace`,
    )
  return pass
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

// Replays of the reported trace and its neighbors, in both modes. Each one
// failed before the fix (see the coverage map entry for this owner).
const rowA: Event = { type: `write`, key: `a`, version: 1 }
const replays: ReadonlyArray<
  [name: string, events: Array<StepSpec>, unseeded?: `also unseeded`]
> = [
  [
    `shows and announces a crash under an active seed`,
    [`attach`, `crash`, `cleanup`],
  ],
  [
    `shows cleanup after a first-load failure instead of the stale error`,
    [`attach`, `fail`, `cleanup`],
  ],
  [
    `shows a crash that happened before it attached`,
    [`crash`, `attach`, `cleanup`],
  ],
  // #2334 and the random campaign's seed 1779366423: the restarted sync run
  // writes the row the observer showed before cleanup. The trailing `ready`
  // judges the same rows again at a ready checkpoint.
  [
    `shows a row the restarted sync run rewrites after readiness ended the seed`,
    [`attach`, `ready`, rowA, `cleanup`, `restart`, rowA, `ready`],
    `also unseeded`,
  ],
  [
    `shows a row the restarted sync run rewrites after a failure ended the seed`,
    [`attach`, rowA, `fail`, `cleanup`, `restart`, rowA, `ready`],
    `also unseeded`,
  ],
]

// What this oracle owns: the gap report judges every function in
// src/live-query-observer.ts and DbClient.hydrate by this file's generated
// hydration-terminal histories, which end a seed's sync run in every way. It
// also judges CollectionSubscription.handleCollectionCleanup, where the
// observer's `discardsRowsOnCleanup` drops the rows it showed before cleanup
// (law 3's restart claim, #2334). The two kinds of entry differ. A whole-file
// entry owns the functions defined in that file and nothing it refers to in
// another file, so `src/live-query-observer.ts` alone never reached the
// subscription. A `#function` entry owns that function's text, every function
// defined inside it, and its static reference tree within the package: each
// package function, method, or class its text refers to, then what those refer
// to in turn, stopping at the package boundary (owners.mjs in @tanstack/oracles,
// maintainer decisions 2026-11-05 and 2026-11-08). So this entry owns, through
// that walk, the functions it reaches, including
// CollectionSubscription.discardTruncateReplay,
// CollectionSubscription.setReadyIfIdle, and cancelAcquisition. No Collection
// subscription owner subscribes with the option.

declareOracle({
  owns: [
    `src/live-query-observer.ts`,
    `src/client.ts#DbClient.hydrate`,
    `src/collection/subscription.ts#CollectionSubscription.handleCollectionCleanup`,
  ],
})

oracleProperty({
  id: `live-query-observer.hydration-terminal`,
  law: {
    statement: `While a hydration seed is active, the observer shows a Collection error or crashed status, attached or detached; an attached observer that sees a failure ends the seed, so a later cleanup shows the live Collection; cleanup and restart alone keep the seed as ready; after the seed ends, cleanup and restart show the live Collection, including a row the new sync run writes again; and every change visible to an attached observer is announced.`,
    authority: `packages/db/src/query/live/ARCHITECTURE.md law 16; glossary "crash" and "cleanup"; the coverage-map decision that cleanup under a seed keeps the seed`,
    limits: `A plain controlled Collection, not a live-query Collection; keys a..c, versions 0..3, up to ${MAX_EVENTS} steps; rows compared as sets; handoff timing, on-demand predicates and pending subset loads, streamed errors, and consumption belong to the focused tests in live-query-observer.test.ts.`,
    owner: `Observer hydration under terminal statuses`,
  },
  histories: {
    arbitrary: history,
    states: reachStates,
    runs: 100,
    fixedSeeds: [20260, -88123],
    constructed: [
      {
        name: `crash while attached, then cleanup`,
        enters: [
          `crashed-under-seed:attached`,
          `cleanup-after-failure-ended-seed`,
        ],
        build: startSeededWith(`attach`, `crash`, `cleanup`),
      },
      {
        name: `first-load failure while attached, then cleanup`,
        enters: [
          `error-under-seed:attached`,
          `cleanup-after-failure-ended-seed`,
        ],
        build: startSeededWith(`attach`, `fail`, `cleanup`),
      },
      {
        name: `crash before attach`,
        enters: [`crashed-under-seed:detached`, `attach-to-failure-under-seed`],
        build: startSeededWith(`crash`, `attach`, `cleanup`),
      },
      {
        name: `first-load failure before attach`,
        enters: [`error-under-seed:detached`, `attach-to-failure-under-seed`],
        build: startSeededWith(`fail`, `attach`),
      },
      {
        name: `cleanup and restart while attached`,
        enters: [`cleaned-up-under-seed:attached`, `restart-under-seed`],
        build: startSeededWith(`attach`, `cleanup`, `restart`),
      },
      {
        name: `cleanup before attach`,
        enters: [`cleaned-up-under-seed:detached`],
        build: startSeededWith(`cleanup`, `attach`, `ready`),
      },
      {
        name: `readiness while detached`,
        enters: [`ready-under-seed:detached`],
        build: startSeededWith(`ready`),
      },
      {
        name: `readiness while attached`,
        enters: [`ready-under-seed:attached`],
        build: startSeededWith(`attach`, `ready`),
      },
      {
        name: `rewrite a row after readiness, cleanup, and restart`,
        enters: [`restart-rewrites-row-from-before-cleanup`],
        build: rewriteAfterRestart(`ready`),
      },
      {
        name: `rewrite a row after a failure, cleanup, and restart`,
        enters: [`restart-rewrites-row-from-before-cleanup`],
        build: rewriteAfterRestart(`fail`),
      },
      {
        name: `reacquire an unseeded granular observer's demand on restart`,
        enters: [
          `restart-rewrites-row-from-before-cleanup`,
          `restart-reacquires-row-from-before-cleanup`,
        ],
        build: rewriteAfterRestart(`ready`, {
          seed: null,
          mode: `granular`,
          syncMode: `on-demand`,
        }),
      },
    ],
    fixed: ([`granular`, `wholesale`] as const).flatMap((mode) =>
      ([`eager`, `on-demand`] as const).flatMap((syncMode) =>
        replays.flatMap(([name, events, unseeded]) =>
          [[[`a`, 1]] as Array<[Key, number]>, null]
            .filter((seed) => seed !== null || unseeded !== undefined)
            .map((seed) => ({
              name: `${mode} observer of an ${syncMode} source${seed ? `` : ` without a seed`} ${name}`,
              history: { mode, syncMode, seed, events: events.map(toEvent) },
            })),
        ),
      ),
    ),
  },
  // Wrong answers the check must reject: a failure shown as `ready` under
  // the seed (law 1), and a change the listener never heard about (law 4).
  calibrations: [
    {
      name: `failure shown as ready`,
      law: `view`,
      corrupt: (trace) => {
        const at = trace.findIndex(({ value }) => {
          const record = value as StepRecord
          return !(`skipped` in record) && failures.has(record.input.after)
        })
        if (at < 0) return undefined
        return trace.map((entry, index) => {
          if (index !== at) return entry
          const record = entry.value as Extract<StepRecord, { input: unknown }>
          return {
            ...entry,
            value: {
              ...record,
              output: {
                ...record.output,
                view: { ...record.output.view, status: `ready` },
              },
            },
          }
        })
      },
    },
    {
      name: `unannounced change`,
      law: `announcement`,
      corrupt: (trace) => {
        const at = trace.findIndex(({ value }) => {
          const record = value as StepRecord
          return (
            !(`skipped` in record) &&
            record.output.lastRead !== undefined &&
            record.output.view.rows.length > 0
          )
        })
        if (at < 0) return undefined
        return trace.map((entry, index) => {
          if (index !== at) return entry
          const record = entry.value as Extract<StepRecord, { input: unknown }>
          return {
            ...entry,
            value: {
              ...record,
              output: {
                ...record.output,
                lastRead: { ...record.output.lastRead!, rows: [] },
              },
            },
          }
        })
      },
    },
  ],
  model: hydrationModel,
  reached: (_history, _trace, expected) => expected.reached,
  driver: driveHistory,
  check: checkHistory,
})

/**
 * Readiness also includes the end of pending subset work on an already ready
 * Collection. A retained page can stay ready throughout that work (#2345).
 * The existing terminal-status grammar cannot generate this boundary. The
 * hydration handoff law above and the SSR guide require the seed until local
 * work settles, then live rows, with an announcement for both consumer modes.
 *
 * This lane uses a plain on-demand Collection as the observer's input. An
 * external subscription establishes held subset work before observer attach.
 * Resolving its controlled load changes no row or Collection status. The
 * shared expectedView model predicts seed -> live from that explicit event;
 * production's subset/status classifiers never choose the expected phase.
 * The real Svelte transported-page receiver supplies this same premise through
 * retained live-query Collections and native rune scheduling.
 */
const subsetHandoffArbitrary = fc.record({
  count: fc.integer({ min: 1, max: 3 }),
  liveCount: fc.integer({ min: 0, max: 3 }),
  version: fc.integer({ min: 0, max: 3 }),
})
type SubsetHandoff = { count: number; liveCount: number; version: number }
async function checkSubsetHandoff(
  input: SubsetHandoff,
  mode: Mode,
  reach: ReturnType<typeof createOracleReach<string>>,
) {
  const lifetime = new ScenarioLifetime()
  const client = new DbClient()
  let observer:
    ReturnType<typeof createLiveQueryObserver<Row, string>> | undefined
  let unsubscribe: (() => void) | undefined
  lifetime.defer(() => {
    observer?.dispose()
    unsubscribe?.()
  })
  lifetime.defer(() => client.cleanup())
  await lifetime.run(async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const local = Array.from({ length: input.liveCount }, (_, i) => ({
      id: String(i),
      version: input.version + 1,
    }))
    const source = createCollection<Row, string>({
      getKey: (row) => row.id,
      syncMode: `on-demand`,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          for (const value of local) write({ type: `insert`, value })
          commit()
          markReady()
          return { loadSubset: () => pending }
        },
      },
    })
    lifetime.defer(() => source.cleanup())
    const demand = source.subscribeChanges(() => {}, {
      includeInitialState: true,
    })
    unsubscribe = () => demand.unsubscribe()
    expect(source.status, `local status is already ready`).toBe(`ready`)
    expect(source.isLoadingSubset, `external demand is held`).toBe(true)
    const model: Model = {
      seed: Array.from({ length: input.count }, (_, i) => [
        String(i),
        input.version,
      ]),
      ended: false,
      endedByFailure: false,
      attached: true,
    }
    const queryHash = `held-ready-subset`
    client.hydrate({
      collections: [],
      liveQueries: [
        {
          queryHash,
          dehydratedAt: 1,
          snapshot: {
            rows: model.seed.map(([rowKey, rowVersion]) => ({
              key: rowKey,
              value: { id: rowKey, version: rowVersion },
            })),
          },
        },
      ],
    })
    observer = createLiveQueryObserver(source, { client, queryHash, mode })
    const read = (): View => {
      const snapshot = observer!.getSnapshot()
      return { status: snapshot.status, rows: sortedRows(snapshot.state ?? []) }
    }
    const rebuilt = new Map<string, Row>()
    let lastRead: View | undefined
    observer.subscribe((changes) => {
      if (!changes) {
        rebuilt.clear()
        for (const [rowKey, row] of observer!.getSnapshot().state ?? [])
          rebuilt.set(rowKey, row)
      }
      for (const change of changes ?? []) {
        if (change.type === `delete`) rebuilt.delete(change.key)
        else rebuilt.set(change.key, change.value)
      }
      lastRead = read()
    })
    lastRead = read() // the host's post-subscription consistency read
    const compare = (cut: string) =>
      atOracleCheckpoint(`seeded subset handoff`, cut, () => {
        const expected = expectedView(
          model,
          `ready`,
          local.map((row) => [row.id, row.version]),
        )
        expect(read()).toEqual(expected)
        expect(lastRead, `handoff is announced`).toEqual(expected)
        if (mode === `granular`)
          expect(sortedRows(rebuilt), `granular rows follow handoff`).toEqual(
            expected.rows,
          )
      })
    await settle() // the initial scheduled handoff must leave held work alone
    compare(`ready Collection with held subset`)
    reach.reach(`ready while subset held`)
    release()
    await settle()
    expect(source.isLoadingSubset, `the held work settled`).toBe(false)
    expect(source.status, `settlement changes no Collection status`).toBe(
      `ready`,
    )
    model.ended = true
    compare(`subset settled without rows or status changing`)
    reach.reach(`subset-only handoff`)
  })
}
for (const mode of [`granular`, `wholesale`] as const)
  for (const campaign of [`fixed`, `fresh`] as const) {
    const property = `live-query-observer.hydration-subset-handoff`
    const test =
      campaign === `fixed`
        ? oracleReplayTest(it)
        : oracleReplayTest(it, property)
    test(`${mode} seeded ready-subset handoff (${campaign})`, async () => {
      oracleRoute(campaign === `fixed` ? `fixed seed` : `random seed`)
      const reach = createOracleReach<string>(
        `${property}/${mode}/${campaign}`,
        [`ready while subset held`, `subset-only handoff`],
      )
      const fidelity = createOracleFailureFidelity<SubsetHandoff>()
      try {
        await fidelity.assert(() =>
          fc.assert(
            fc.asyncProperty(subsetHandoffArbitrary, async (input) => {
              reach.beginHistory()
              await fidelity.run(input, () =>
                checkSubsetHandoff(input, mode, reach),
              )
            }),
            campaign === `fixed`
              ? { numRuns: oracleRuns(8), seed: 2345 }
              : oraclePropertyOptions(8, property),
          ),
        )
        reach.assertReached()
      } finally {
        console.info(
          `subset handoff reach ${mode}/${campaign}`,
          Object.fromEntries(reach.counts()),
        )
      }
    })
  }
declareOracle({
  owns: [`src/live-query-observer.ts`, `src/client.ts#DbClient.hydrate`],
  grammar: [subsetHandoffArbitrary],
  check: [checkSubsetHandoff],
})
