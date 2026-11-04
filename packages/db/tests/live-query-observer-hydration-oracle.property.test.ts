import fc from 'fast-check'
import { DbClient } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { oracleProperty, pass, violation } from './oracle-property.js'
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
| failure shown under a seed | seed of 0..3 rows; live writes; `fail()`, `crash()`, cleanup, restart, `markReady()`, attach, in any legal order | DbClient hydrate -> getSnapshot status mapping; status listener -> notify | snapshot `status` and flags after each step and a macrotask | this generated oracle |
| failure ends the seed | the same, with cleanup after the failure | notify/attach -> seed handoff | `cleaned-up` and live rows after cleanup | this generated oracle |
| cleanup keeps the seed | cleanup and restart while the seed is active | notify early return under the seed | `ready` and seed rows | this generated oracle; recorded decision, not a law-16 claim |
| announced changes | every step while attached | emit -> flushPublications | last-read snapshot and granular rebuilt rows equal the current snapshot | this generated oracle |
| handoff timing, on-demand subsets, streamed errors, consumption | | | | focused `live-query-observer.test.ts` hydration tests |

 * Keys are `a`..`c`, versions 0..3, histories of 1..10 steps, both modes.
 * Constructed histories start a generated history with the steps that enter each declared
 * state, so every grammar reaches every state. Rows are
 * compared as sets by key: this oracle makes no order claim. The source is a
 * plain controlled Collection, not a live-query Collection, so source health
 * propagation through a query graph belongs to `source-health-oracle.test.ts`.
 */

type Row = { id: string; version: number }
type Mode = `granular` | `wholesale`
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
  seed: Array<[Key, number]>
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
  seed: fc.uniqueArray(fc.tuple(key, version), {
    selector: ([id]) => id,
    maxLength: 3,
  }),
  events: fc.array(event, { minLength: 1, maxLength: MAX_EVENTS }),
})

/** Starts a generated history with `prefix`, keeping it inside the grammar. */
const startWith =
  (...prefix: Array<Event[`type`]>) =>
  (generated: History): History => ({
    ...generated,
    events: [
      ...prefix.map((type) => ({ type }) as Event),
      ...generated.events,
    ].slice(0, MAX_EVENTS),
  })

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
  { seed }: History,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
): { owed: Map<string, Expectation>; reached: Set<ReachState> } {
  const model: Model = {
    seed: sortedRows(seed.map(([id, value]) => [id, { id, version: value }])),
    ended: false,
    endedByFailure: false,
    attached: false,
  }
  const owed = new Map<string, Expectation>()
  const reached = new Set<ReachState>()
  for (const { checkpoint, value } of trace) {
    const record = value as StepRecord
    if (`skipped` in record) continue
    const { action, before, during, after, live } = record.input
    if (action === `cleanup` && model.endedByFailure && failures.has(before))
      reached.add(`cleanup-after-failure-ended-seed`)
    if (action === `restart` && seedActive(model))
      reached.add(`restart-under-seed`)
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
  { mode, seed, events }: History,
  observe: (checkpoint: string, value: StepRecord) => void,
): Promise<void> {
  const id = `observer-hydration-${sequence++}`
  const queryHash = `${id}-query`
  let ops: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const source = createCollection<Row, string>({
    id,
    getKey: (row) => row.id,
    startSync: false,
    sync: {
      sync: (params) => {
        ops = params
      },
    },
  })
  const client = new DbClient()
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
  const observer = createLiveQueryObserver<Row, string>(source, {
    client,
    queryHash,
    mode,
  })

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
        ops!.begin()
        ops!.write(
          next.version === null
            ? { type: `delete`, key: next.key }
            : {
                type: present ? `update` : `insert`,
                value: { id: next.key, version: next.version },
              },
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
const replays: ReadonlyArray<[string, Array<Event[`type`]>]> = [
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
]

oracleProperty({
  id: `live-query-observer.hydration-terminal`,
  law: {
    statement: `While a hydration seed is active, the observer shows a Collection error or crashed status, attached or detached; an attached observer that sees a failure ends the seed, so a later cleanup shows the live Collection; cleanup and restart alone keep the seed as ready; and every change visible to an attached observer is announced.`,
    authority: `packages/db/src/query/live/ARCHITECTURE.md law 16; glossary "crash" and "cleanup"; the coverage-map decision that cleanup under a seed keeps the seed`,
    limits: `A plain controlled Collection, not a live-query Collection; keys a..c, versions 0..3, up to ${MAX_EVENTS} steps; rows compared as sets; handoff timing, on-demand subsets, streamed errors, and consumption belong to the focused tests in live-query-observer.test.ts.`,
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
        build: startWith(`attach`, `crash`, `cleanup`),
      },
      {
        name: `first-load failure while attached, then cleanup`,
        enters: [
          `error-under-seed:attached`,
          `cleanup-after-failure-ended-seed`,
        ],
        build: startWith(`attach`, `fail`, `cleanup`),
      },
      {
        name: `crash before attach`,
        enters: [`crashed-under-seed:detached`, `attach-to-failure-under-seed`],
        build: startWith(`crash`, `attach`, `cleanup`),
      },
      {
        name: `first-load failure before attach`,
        enters: [`error-under-seed:detached`, `attach-to-failure-under-seed`],
        build: startWith(`fail`, `attach`),
      },
      {
        name: `cleanup and restart while attached`,
        enters: [`cleaned-up-under-seed:attached`, `restart-under-seed`],
        build: startWith(`attach`, `cleanup`, `restart`),
      },
      {
        name: `cleanup before attach`,
        enters: [`cleaned-up-under-seed:detached`],
        build: startWith(`cleanup`, `attach`, `ready`),
      },
      {
        name: `readiness while detached`,
        enters: [`ready-under-seed:detached`],
        build: startWith(`ready`),
      },
      {
        name: `readiness while attached`,
        enters: [`ready-under-seed:attached`],
        build: startWith(`attach`, `ready`),
      },
    ],
    fixed: [`granular`, `wholesale`].flatMap((mode) =>
      replays.map(([name, events]) => ({
        name: `${mode} observer ${name}`,
        history: {
          mode: mode as Mode,
          seed: [[`a`, 1]] as Array<[Key, number]>,
          events: events.map((type) => ({ type }) as Event),
        },
      })),
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
