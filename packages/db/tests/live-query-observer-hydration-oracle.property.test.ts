import { fc } from '@fast-check/vitest'
import { afterAll, describe, expect, it } from 'vitest'
import { DbClient } from '../src/client.js'
import { createCollection } from '../src/collection/index.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { createOracleReach } from './oracle-reach.js'
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
 * the driver reads its public status and rows and does not model the
 * Collection lifecycle. Rows under a failure status are not claimed, because
 * that status says the data cannot be shown; law 4 still checks them.
 *
 * ## Contract and ownership table

| Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
| --- | --- | --- | --- | --- |
| failure shown under a seed | seed of 0..3 rows; live writes; `fail()`, `crash()`, cleanup, restart, `markReady()`, attach, in any legal order | DbClient hydrate -> getSnapshot status mapping; status listener -> notify | snapshot `status` and flags after each step and a macrotask | this generated oracle |
| failure ends the seed | the same, with cleanup after the failure | notify/attach -> seed handoff | `cleaned-up` and live rows after cleanup | this generated oracle |
| cleanup keeps the seed | cleanup and restart while the seed is active | notify early return under the seed | `ready` and seed rows | this generated oracle; recorded decision, not a law-16 claim |
| announced changes | every step while attached | emit -> flushPublications | last-read snapshot and granular rebuilt rows equal the current snapshot | this generated oracle |
| handoff timing, on-demand subsets, streamed errors, consumption | | | | focused `live-query-observer.test.ts` hydration tests |

 * Keys are `a`..`c`, versions 0..3, histories of 1..10 generated steps after
 * an optional fixed three-step prefix, both modes. Rows are
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

const key = fc.constantFrom<Key>(`a`, `b`, `c`)
const version = fc.integer({ min: 0, max: 3 })
const event: fc.Arbitrary<Event> = fc.oneof(
  {
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      key,
      version: fc.option(version, { freq: 3 }),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ type: `ready` as const }), weight: 1 },
  { arbitrary: fc.constant({ type: `fail` as const }), weight: 1 },
  { arbitrary: fc.constant({ type: `crash` as const }), weight: 1 },
  { arbitrary: fc.constant({ type: `cleanup` as const }), weight: 1 },
  { arbitrary: fc.constant({ type: `restart` as const }), weight: 1 },
  { arbitrary: fc.constant({ type: `attach` as const }), weight: 2 },
)
const history: fc.Arbitrary<History> = fc.record({
  mode: fc.constantFrom<Mode>(`granular`, `wholesale`),
  seed: fc.uniqueArray(fc.tuple(key, version), {
    selector: ([id]) => id,
    maxLength: 3,
  }),
  events: fc.array(event, { minLength: 1, maxLength: 10 }),
})

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

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

function seedActive(model: Model): boolean {
  return !model.ended
}

/**
 * Advance the model across one step. `statuses` are the Collection statuses
 * before and after the step. An attached observer ends the seed when it sees
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
 * Runs one history. Steps that are illegal in the Collection's current
 * status, such as `markReady()` outside `loading`, are skipped, so every
 * executed step is a legal source history.
 */
async function runHistory(
  { mode, seed, events }: History,
  reach?: ReturnType<typeof createOracleReach<ReachState>>,
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

  const model: Model = {
    seed: sortedRows(
      seed.map(([rowKey, rowVersion]) => [
        rowKey,
        { id: rowKey, version: rowVersion },
      ]),
    ),
    ended: false,
    endedByFailure: false,
    attached: false,
  }
  const rebuilt = new Map<string, Row>()
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

  const check = (step: number) => {
    const context = JSON.stringify({ mode, seed, events, step })
    const snapshot = observer.getSnapshot()
    const view = read()
    const expected = expectedView(
      model,
      source.status,
      sortedRows(source.entries()),
    )
    expect(view.status, context).toBe(expected.status)
    expect(
      {
        isReady: snapshot.isReady,
        isLoadingError: snapshot.isLoadingError,
        isCrashed: snapshot.isCrashed,
        isCleanedUp: snapshot.isCleanedUp,
      },
      context,
    ).toEqual({
      isReady: expected.status === `ready`,
      isLoadingError: expected.status === `error`,
      isCrashed: expected.status === `crashed`,
      isCleanedUp: expected.status === `cleaned-up`,
    })
    if (expected.rows) expect(view.rows, context).toEqual(expected.rows)
    if (model.attached) {
      expect(lastRead, `${context} (unannounced change)`).toEqual(view)
      if (mode === `granular`) {
        expect(sortedRows(rebuilt), `${context} (granular rows)`).toEqual(
          view.rows,
        )
      }
    }
  }

  const note = (state: ReachState) => reach?.reach(state)
  const noteStatusUnderSeed = (before: string, after: string) => {
    if (!seedActive(model) || before === after) return
    if (
      after === `ready` ||
      after === `error` ||
      after === `crashed` ||
      after === `cleaned-up`
    ) {
      note(`${after}-under-seed:${model.attached ? `attached` : `detached`}`)
    }
  }

  let failure: { error: unknown } | undefined
  try {
    check(-1)
    for (const [step, next] of events.entries()) {
      const before = source.status
      if (next.type === `write`) {
        if (before !== `loading` && before !== `ready`) continue
        const present = source.has(next.key)
        if (next.version === null && !present) continue
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
        if (before !== `loading`) continue
        ops!.markReady()
      } else if (next.type === `fail`) {
        if (before !== `loading`) continue
        ops!.fail(new Error(`first load failed`))
      } else if (next.type === `crash`) {
        if (before !== `loading` && before !== `ready` && before !== `error`) {
          continue
        }
        source._lifecycle.crash(new Error(`local storage closed`))
      } else if (next.type === `cleanup`) {
        if (before === `cleaned-up`) continue
        if (model.endedByFailure && failures.has(before)) {
          note(`cleanup-after-failure-ended-seed`)
        }
        await source.cleanup()
      } else if (next.type === `restart`) {
        if (before !== `cleaned-up`) continue
        if (seedActive(model)) note(`restart-under-seed`)
        source.startSyncImmediate()
      } else {
        if (model.attached) continue
        if (seedActive(model) && failures.has(before)) {
          note(`attach-to-failure-under-seed`)
        }
        model.attached = true
        observer.subscribe(listener)
        // The consistency read useSyncExternalStore does after subscribing.
        lastRead = read()
      }
      noteStatusUnderSeed(before, source.status)
      advance(model, [before, source.status])
      await settle()
      advance(model, [source.status])
      check(step)
    }
  } catch (error) {
    failure = { error }
  }
  observer.dispose()
  await source.cleanup()
  if (failure) throw failure.error
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

/**
 * Fixed prefixes put each declared state within reach of every run budget;
 * the generated suffix explores what follows.
 */
const prefixes: ReadonlyArray<Array<Event>> = [
  [{ type: `attach` }, { type: `crash` }, { type: `cleanup` }],
  [{ type: `attach` }, { type: `fail` }, { type: `cleanup` }],
  [{ type: `crash` }, { type: `attach` }, { type: `cleanup` }],
  [{ type: `attach` }, { type: `cleanup` }, { type: `restart` }],
  [{ type: `cleanup` }, { type: `attach` }, { type: `ready` }],
]
const prefixedHistory: fc.Arbitrary<History> = fc
  .tuple(history, fc.option(fc.constantFrom(...prefixes), { freq: 2 }))
  .map(([generated, prefix]) => ({
    ...generated,
    events: [...(prefix ?? []), ...generated.events],
  }))

describe(`LiveQueryObserver hydration seed under terminal statuses`, () => {
  const reach = createOracleReach<ReachState>(
    `live-query-observer.hydration-terminal`,
    reachStates,
  )
  let historiesRan = false
  afterAll(() => {
    if (historiesRan) reach.assertReached()
  })

  it.each([20260, -88123])(
    `generated histories refine the hydration model with fixed seed=%s`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(prefixedHistory, async (generated) => {
          historiesRan = true
          reach.beginHistory()
          await runHistory(generated, reach)
        }),
        { numRuns: oracleRuns(100), seed },
      )
    },
    60_000,
  )

  it(`generated histories refine the hydration model with a random or replayed seed`, async () => {
    await fc.assert(
      fc.asyncProperty(prefixedHistory, async (generated) => {
        historiesRan = true
        reach.beginHistory()
        await runHistory(generated, reach)
      }),
      oraclePropertyOptions(100),
    )
  }, 60_000)

  // Replays of the reported trace and its neighbors, in both modes. Each one
  // failed before the fix (see the coverage map entry for this owner).
  const replays: ReadonlyArray<[string, Array<Event>]> = [
    [
      `shows and announces a crash under an active seed`,
      [{ type: `attach` }, { type: `crash` }, { type: `cleanup` }],
    ],
    [
      `shows cleanup after a first-load failure instead of the stale error`,
      [{ type: `attach` }, { type: `fail` }, { type: `cleanup` }],
    ],
    [
      `shows a crash that happened before it attached`,
      [{ type: `crash` }, { type: `attach` }, { type: `cleanup` }],
    ],
  ]
  for (const mode of [`granular`, `wholesale`] as const) {
    it.each(replays)(`${mode} observer %s`, async (_name, events) => {
      await runHistory({ mode, seed: [[`a`, 1]], events })
    })
  }
})
