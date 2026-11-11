import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient } from '../src/client.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { Query, createLiveQueryCollection } from '../src/query/index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { oracleRoute } from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { oracleProperty } from './oracle-property.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import { finishHistory } from './observer-history-cleanup.js'
import {
  checkSparseArray,
  makeSparseArray,
  sparseArrayCarriers,
  sparseArrayCase,
  sparseArrayValues,
} from './sparse-array-value-oracle.js'
import type { Verdict } from './oracle-property.js'
import type {
  SparseArrayCarrier,
  SparseArrayCase,
  SparseArrayForm,
} from './sparse-array-value-oracle.js'
import type { HealthNode, SyncConfig } from '../src/types.js'
import type { LiveQuerySnapshot } from '../src/live-query-observer.js'

/**
 * # Is a retained live-query snapshot point-in-time?
 *
 * `getSnapshot()` returns one object per revision. A consumer may keep that
 * object and read `data` or `state` for the first time much later, after the
 * Collection changed and after newer snapshots were built. The contract: the
 * first read, in either order, shows the rows that were visible when the
 * snapshot was built. `data` lists the same rows as `state.values()`, in the
 * same order. Every later read returns the same `data` and `state` objects as
 * the first, and reading another snapshot never changes a map that an earlier
 * read returned. A single-result query keeps only the first such row: `state`
 * holds that row, and `data` is that row or `undefined`.
 *
 * Without a DbClient, server and ordinary getters expose the same revision.
 * Reading either getter must retain that revision's cached object identity.
 * A completed client query also shares readiness on both views. Reading its
 * server view must not invalidate the ordinary getter's cached object. The
 * SSR-specific transport policy has its own descriptor receiving owner.
 *
 * The model is a sorted map from key to version. Each history step changes the
 * model and the source Collection the same way, and a `capture` step records
 * the model's rows next to the unread production snapshot. At the end, the
 * driver reads every retained snapshot in a generated order, choosing whether
 * `data` or `state` is read first, and compares both with the recorded rows.
 *
 * ## Contract and ownership table

| Contract | History/domain | Production path | Observation and checkpoint | Owner and limits |
| --- | --- | --- | --- | --- |
| point-in-time first read | insert, update, delete, capture; keys a..d, versions 0..9 | observer getSnapshot -> rebuild | retained snapshot `data`/`state`, first read after all later writes | this generated oracle |
| data/state agreement | the same histories | the same | `data` order equals `state.values()` order at the end | this generated oracle |
| stable identity | the same histories | the same | a second read of `data` and `state` returns the first read's objects | this generated oracle |
| single result | the same histories over `findOne()` | isSingleResultCollection branch | `data` equals the first recorded row or `undefined` | this generated oracle |
| attached and detached reads | a subscriber is present or absent | publication cache vs refreshDetachedState | the same observations | this generated oracle; listener delivery belongs to `live-query-observer-history-oracle.property.test.ts` |
| health freshness across attach cuts | report, healthy, write, subscribe, unsubscribe, read; one ready source | detached refreshDetachedState, attach, publishedHealth | `health`, `isSyncError`, and tree identity of each snapshot, at every `read` | this generated oracle (second block below); status scheduling and hydration have other owners |

 * The source is a local-only Collection behind an `orderBy` live query, so
 * visible order is key order. This first driver checks prepared client seeds
 * only for getter identity. The capture-path driver below adds provisional
 * seed handoff. Persisted status and framework wiring have other owners.
 * The calibration test feeds the checker a snapshot
 * whose `data` and `state` read the live Collection on first access, the design
 * #1542 proposed, and requires the checker to reject it.
 */

// Each mature helper retains its independent model and authored comparisons.
// Registration transports that judgment without converting setup, production,
// or cleanup errors. Reach is collected per history and the native campaign
// checks each constructed history against the states it promises to enter.
type SnapshotReach<TState extends string> = { reach: (state: TState) => void }
function snapshotReach<TState extends string>(states: ReadonlyArray<TState>) {
  const declared = new Set(states)
  const entered = new Set<TState>()
  return {
    entered,
    reach(state: TState): void {
      if (!declared.has(state))
        throw new Error(`undeclared snapshot reach state ${state}`)
      entered.add(state)
    },
  }
}
async function recordSnapshotJudgment<TState extends string>(
  law: string,
  plan: object,
  observe: (checkpoint: string, value: unknown) => void,
  states: ReadonlyArray<TState>,
  judge: (reach: SnapshotReach<TState>) => Promise<void>,
): Promise<void> {
  const reach = snapshotReach(states)
  await recordAssertionJudgment(law, plan, observe, () => judge(reach))
  for (const state of reach.entered) observe(`reach`, state)
}

type Row = { id: string; version: number }
type Shape = `ordered` | `single`
type Command =
  | { type: `upsert`; id: string; version: number }
  | { type: `delete`; id: string }
  | { type: `capture` }
type Read = { snapshot: number; dataFirst: boolean }
// This projection observes row containers, whether a driver uses a source
// Collection directly or query rows that also carry virtual metadata.
type Snapshot = Pick<LiveQuerySnapshot<Row, string | number>, `data` | `state`>
type Captured = {
  snapshot: Snapshot
  rows: Array<Row>
}

const PROPERTY = `live-query-observer.retained-snapshot`
const key = fc.constantFrom(`a`, `b`, `c`, `d`)
const command: fc.Arbitrary<Command> = fc.oneof(
  fc.record({
    type: fc.constant(`upsert` as const),
    id: key,
    version: fc.integer({ min: 0, max: 9 }),
  }),
  fc.record({ type: fc.constant(`delete` as const), id: key }),
  fc.record({ type: fc.constant(`capture` as const) }),
)

function modelRows(model: Map<string, number>): Array<Row> {
  return [...model]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([id, version]) => ({ id, version }))
}

function plain(row: unknown): Row {
  const { id, version } = row as Row
  return { id, version }
}

let sequence = 0
function setup(shape: Shape) {
  const source = createCollection(
    localOnlyCollectionOptions<Row, string>({
      id: `retained-snapshot-source-${sequence++}`,
      getKey: (row) => row.id,
    }),
  )
  const ordered = new Query().from({ row: source }).orderBy(({ row }) => row.id)
  const builder = shape === `single` ? ordered.findOne() : ordered
  const query = createLiveQueryCollection({ startSync: true, query: builder })
  const observer = createLiveQueryObserver(query)
  return { source, query, observer, builder }
}

/** Apply a history, retaining every captured snapshot unread. */
function run(
  shape: Shape,
  attached: boolean,
  commands: ReadonlyArray<Command>,
): {
  captured: Array<Captured>
  observer: ReturnType<typeof setup>[`observer`]
  query: ReturnType<typeof setup>[`query`]
  builder: ReturnType<typeof setup>[`builder`]
  cleanup: () => Promise<void>
  source: ReturnType<typeof setup>[`source`]
} {
  const { source, query, observer, builder } = setup(shape)
  const unsubscribe = attached ? observer.subscribe(() => {}) : undefined
  const model = new Map<string, number>()
  const captured: Array<Captured> = [
    { snapshot: observer.getSnapshot(), rows: [] },
  ]
  for (const step of commands) {
    if (step.type === `capture`) {
      captured.push({
        snapshot: observer.getSnapshot(),
        rows: modelRows(model),
      })
    } else if (step.type === `delete`) {
      if (!model.has(step.id)) continue
      model.delete(step.id)
      source.delete(step.id)
    } else if (model.has(step.id)) {
      model.set(step.id, step.version)
      source.update(step.id, (draft) => {
        draft.version = step.version
      })
    } else {
      model.set(step.id, step.version)
      source.insert({ id: step.id, version: step.version })
    }
  }
  captured.push({ snapshot: observer.getSnapshot(), rows: modelRows(model) })
  return {
    captured,
    observer,
    query,
    builder,
    source,
    cleanup: async () => {
      unsubscribe?.()
      observer.dispose()
      await query.cleanup()
      await source.cleanup()
    },
  }
}

/** The refinement check for one retained snapshot's first read. */
function checkRead(
  shape: Shape,
  entry: Captured,
  dataFirst: boolean,
  label: string,
): Pick<Snapshot, `data` | `state`> {
  let read: Pick<Snapshot, `data` | `state`>
  if (dataFirst) {
    const data = entry.snapshot.data
    read = { data, state: entry.snapshot.state }
  } else {
    const state = entry.snapshot.state
    read = { state, data: entry.snapshot.data }
  }
  // A single-result query keeps only its first row.
  const rows = shape === `single` ? entry.rows.slice(0, 1) : entry.rows
  const stateRows = [...(read.state?.values() ?? [])].map(plain)
  oracleAssertion(`checkRead:207`, () =>
    expect(stateRows, `${label}: state rows`).toEqual(rows),
  )
  oracleAssertion(`checkRead:208`, () =>
    expect([...(read.state?.keys() ?? [])], `${label}: state keys`).toEqual(
      rows.map((row) => row.id),
    ),
  )
  if (shape === `single`) {
    oracleAssertion(`checkRead:212`, () =>
      expect(
        read.data === undefined ? undefined : plain(read.data),
        `${label}: single data`,
      ).toEqual(rows[0]),
    )
  } else {
    const data = read.data as ReadonlyArray<Row>
    oracleAssertion(`checkRead:218`, () =>
      expect(data.map(plain), `${label}: data rows`).toEqual(rows),
    )
    // Both views expose the captured row values in the same order.
    oracleAssertion(`checkRead:220`, () =>
      expect(data, `${label}: data agrees with state`).toEqual([
        ...(read.state?.values() ?? []),
      ]),
    )
  }
  // A snapshot is one value: later reads return the same objects.
  oracleAssertion(`checkRead:225`, () =>
    expect(entry.snapshot.state, `${label}: state identity`).toBe(read.state),
  )
  oracleAssertion(`checkRead:226`, () =>
    expect(entry.snapshot.data, `${label}: data identity`).toBe(read.data),
  )
  return read
}

async function checkHistory(
  shape: Shape,
  attached: boolean,
  commands: ReadonlyArray<Command>,
  reads: ReadonlyArray<Read>,
  reach?: SnapshotReach<`server-getter` | `client-getter`>,
): Promise<void> {
  const { captured, observer, query, builder, cleanup } = run(
    shape,
    attached,
    commands,
  )
  const client = new DbClient()
  let clientObserver: typeof observer | undefined
  try {
    // No write occurs between the final capture and either getter. The model's
    // revision is unchanged, so both public getter paths retain its identity.
    const current = captured.at(-1)!.snapshot
    reach?.reach(`server-getter`)
    oracleAssertion(`checkHistory:251`, () =>
      expect(
        observer.getServerSnapshot(),
        `server getter preserves an unchanged revision`,
      ).toBe(current),
    )
    oracleAssertion(`checkHistory:255`, () =>
      expect(
        observer.getSnapshot(),
        `ordinary getter preserves the same revision`,
      ).toBe(current),
    )
    await client.preloadLiveQuery({ query: builder })
    clientObserver = createLiveQueryObserver(query, {
      client,
      queryHash: getLiveQueryHash({ query: builder }),
    })
    const preparedObserver = clientObserver
    const clientSnapshot = preparedObserver.getSnapshot()
    reach?.reach(`client-getter`)
    oracleAssertion(`checkHistory:266`, () =>
      expect(
        preparedObserver.getServerSnapshot(),
        `a prepared client server read keeps the shared revision`,
      ).toBe(clientSnapshot),
    )
    oracleAssertion(`checkHistory:270`, () =>
      expect(
        preparedObserver.getSnapshot(),
        `a server read cannot invalidate the ordinary snapshot cache`,
      ).toBe(clientSnapshot),
    )
    const order =
      reads.length > 0
        ? reads
        : captured.map((_, i) => ({ snapshot: i, dataFirst: true }))
    const seen = new Map<number, Pick<Snapshot, `data` | `state`>>()
    for (const { snapshot, dataFirst } of order) {
      const index = snapshot % captured.length
      if (seen.has(index)) continue
      seen.set(
        index,
        checkRead(shape, captured[index]!, dataFirst, `snapshot ${index}`),
      )
    }
    // Reading a later snapshot must not change a map an earlier read
    // returned, and snapshots with different rows have different maps.
    const keep = shape === `single` ? 1 : Infinity
    for (const [index, { data, state }] of seen) {
      // Every later read of a snapshot returns the objects its first read did.
      oracleAssertion(`checkHistory:292`, () =>
        expect(
          captured[index]!.snapshot.state,
          `snapshot ${index}: state identity after other reads`,
        ).toBe(state),
      )
      oracleAssertion(`checkHistory:296`, () =>
        expect(
          captured[index]!.snapshot.data,
          `snapshot ${index}: data identity after other reads`,
        ).toBe(data),
      )
      const rows = captured[index]!.rows.slice(0, keep)
      oracleAssertion(`checkHistory:301`, () =>
        expect(
          [...(state?.values() ?? [])].map(plain),
          `snapshot ${index}: saved state rows`,
        ).toEqual(rows),
      )
      for (const [other, { state: otherState }] of seen) {
        const otherRows = captured[other]!.rows.slice(0, keep)
        if (JSON.stringify(otherRows) !== JSON.stringify(rows))
          oracleAssertion(`checkHistory:308`, () =>
            expect(otherState, `snapshots ${index} and ${other}`).not.toBe(
              state,
            ),
          )
      }
    }
  } finally {
    clientObserver?.dispose()
    await client.cleanup()
    await cleanup()
  }
}

// What this oracle owns: the gap report judges every function in
// src/live-query-observer.ts by this file's snapshot histories, which read
// retained getSnapshot() objects and the health tree of the observer.
declareOracle({
  owns: [`src/live-query-observer.ts`],
  check: [checkRead, checkHistory, checkHealthHistory],
  model: [modelRows],
})

const history = fc.array(command, { minLength: 1, maxLength: 24 })
const reads = fc.array(
  fc.record({ snapshot: fc.nat({ max: 30 }), dataFirst: fc.boolean() }),
  { maxLength: 30 },
)

describe(`retained live-query snapshots are point-in-time`, () => {
  // The tuple preserves the old two-arbitrary input. Every generated input
  // still runs all four shape/attachment cells at the original per-cell budget.
  const retainedStates = [
    `server-getter-ordered-attached`,
    `client-getter-ordered-attached`,
    `server-getter-ordered-detached`,
    `client-getter-ordered-detached`,
    `server-getter-single-attached`,
    `client-getter-single-attached`,
    `server-getter-single-detached`,
    `client-getter-single-detached`,
  ] as const
  oracleProperty<[Array<Command>, Array<Read>], Verdict>({
    id: PROPERTY,
    law: {
      statement: `First and later reads of a retained snapshot preserve capture-time rows and container identity across both shapes and attachment cuts.`,
      authority: `The point-in-time snapshot contract and ownership table above.`,
      limits: `Keys a..d, versions 0..9, local-only source and prepared client getter identity; transport and framework scheduling have separate owners.`,
    },
    histories: {
      arbitrary: fc.tuple(history, reads),
      runs: 40,
      fixedSeeds: [2043],
      states: retainedStates,
      constructed: [
        {
          name: `both getters in every shape and attachment cell`,
          enters: retainedStates,
          build: (generated) => generated,
        },
      ],
    },
    model: recordedAssertionJudgment,
    driver: (input, observe) =>
      recordSnapshotJudgment(
        `retained snapshot rows and identity`,
        input,
        observe,
        retainedStates,
        async (reach) => {
          const results = await Promise.allSettled(
            ([`ordered`, `single`] as const).flatMap((shape) =>
              [true, false].map((attached) =>
                checkHistory(shape, attached, input[0], input[1], {
                  reach: (state) =>
                    reach.reach(
                      `${state}-${shape}-${attached ? `attached` : `detached`}`,
                    ),
                }),
              ),
            ),
          )
          const errors = results.flatMap((result) =>
            result.status === `rejected` ? [result.reason] : [],
          )
          if (errors.length)
            throw new AggregateError(
              errors,
              `retained snapshot receiving cells`,
              {
                cause: errors[0],
              },
            )
        },
      ),
    check: forwardAssertionJudgment,
  })

  it(`reads a snapshot after several newer snapshots were built`, async () => {
    oracleRoute(`fixed history`)
    const commands: Array<Command> = [
      { type: `upsert`, id: `a`, version: 1 },
      { type: `upsert`, id: `b`, version: 1 },
      { type: `capture` },
      { type: `upsert`, id: `a`, version: 2 },
      { type: `capture` },
      { type: `delete`, id: `b` },
      { type: `capture` },
      { type: `upsert`, id: `c`, version: 3 },
      { type: `capture` },
    ]
    for (const shape of [`ordered`, `single`] as const) {
      for (const dataFirst of [true, false]) {
        await checkHistory(shape, true, commands, [
          { snapshot: 1, dataFirst },
          { snapshot: 0, dataFirst: !dataFirst },
        ])
      }
    }
  })

  it(`rejects a snapshot that reads the live Collection on first access`, async () => {
    oracleRoute(`calibration`)
    // Calibration: the #1542 design. Its getters read the live query when
    // first accessed instead of the rows captured at snapshot time.
    const { observer, query, source } = setup(`ordered`)
    try {
      source.insert({ id: `a`, version: 1 })
      const captured = observer.getSnapshot()
      const hostile = Object.create(captured, {
        data: { get: () => [...query.values()] },
        state: { get: () => new Map(query.entries()) },
      }) as Snapshot
      source.update(`a`, (draft) => {
        draft.version = 2
      })
      expect(() =>
        checkRead(
          `ordered`,
          { snapshot: hostile, rows: [{ id: `a`, version: 1 }] },
          true,
          `hostile`,
        ),
      ).toThrow(/data rows|state rows/)
    } finally {
      observer.dispose()
      await query.cleanup()
      await source.cleanup()
    }
  })
})

/**
 * # Does a snapshot show the health tree that is current when it is built?
 *
 * Law (ARCHITECTURE.md law 17; glossary "health tree" and "sync error";
 * `LiveQuerySnapshot.health` and `isSyncError` in `live-query-observer.ts`):
 * a snapshot that `getSnapshot()` returns carries the query's current health
 * tree, and `isSyncError` is `status === 'ready'` and that tree has a problem.
 * Every change to the tree is announced by `health:change`, so a reader never
 * has to poll: whether a subscriber is present (attached) or not (detached),
 * and across the attach cut a framework crosses between its render-time read
 * and its commit, the next snapshot shows the change. A tree keeps its object
 * identity until its content changes, so two snapshots with no tree change
 * between them carry the same tree.
 *
 * A health-only change moves no row and no status. It is the case where an
 * observer that tracks only row revisions and status cannot see that its
 * cached snapshot is stale.
 *
 * The model is the source's failure reason as its frame (maintainer
 * decision): the list of failures reported since the slot was last clear,
 * oldest first, with a serial number for the list. A `report` adds a failure
 * with a fresh message and a new serial; the node's `failureReason` shows
 * the newest, and its `errors` lists them all. `healthy` empties the list,
 * and a `healthy` with nothing to clear changes nothing, keeping the
 * serial. `write` changes a row and never the
 * tree. `subscribe` and `unsubscribe` move the observer across the attach cut
 * and change nothing in the model. At each `read` the driver compares the
 * snapshot's source node `failureReason` (its message, its listed failures'
 * messages in order, and each listed cause by identity), the root
 * `hasErrors`, and `isSyncError` with the model, and requires the same tree
 * object as the previous read when the serial did not change and a
 * different one when the list differs from the previous read's, also when
 * only a failure that is not the newest differs. A round trip between reads, such
 * as `report` then `healthy`, ends at the content the previous read saw; the
 * glossary requires identity to be stable while content is unchanged and
 * does not require a new object for equal content, so either identity is
 * legal there and the model checks only the content. The source is a ready controlled Collection under a direct live query.
 * Limits: one source, `failureReason` only (`fail()` ends the sync run's
 * reports and is checked by `source-health-oracle.test.ts`), no hydration
 * seed, no framework.
 */
type HealthCommand =
  | { type: `report` }
  | { type: `healthy` }
  | { type: `write`; version: number }
  | { type: `subscribe` }
  | { type: `unsubscribe` }
  | { type: `read` }

type HealthReach =
  | `detached-read-after-health-change`
  | `attached-read-after-health-change`
  | `read-across-attach-after-health-change`
  | `unchanged-tree-read`
  | `read-with-several-failures`

const healthCommand: fc.Arbitrary<HealthCommand> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ type: fc.constant(`report` as const) }) },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant(`healthy` as const) }),
  },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      version: fc.integer({ min: 0, max: 9 }),
    }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant(`subscribe` as const) }),
  },
  {
    weight: 2,
    arbitrary: fc.record({ type: fc.constant(`unsubscribe` as const) }),
  },
  { weight: 4, arbitrary: fc.record({ type: fc.constant(`read` as const) }) },
)

type SyncControls = {
  begin: () => void
  write: (message: { type: `update`; value: Row }) => void
  commit: () => void
  reportError: (error: unknown) => void
  reportHealthy: () => void
}

function setupHealth() {
  let controls: SyncControls | undefined
  const source = createCollection<Row, string>({
    id: `snapshot-health-source-${sequence++}`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: (params: any) => {
        controls = params
        params.begin()
        params.write({ type: `insert`, value: { id: `a`, version: 0 } })
        params.commit()
        params.markReady()
      },
    },
  })
  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) => q.from({ row: source }),
  })
  const observer = createLiveQueryObserver(query)
  return { source, query, observer, controls: () => controls! }
}

/** Run one history; compare every `read` with the model. */
async function checkHealthHistory(
  commands: ReadonlyArray<HealthCommand>,
  reach?: SnapshotReach<HealthReach>,
): Promise<void> {
  const { source, query, observer, controls } = setupHealth()
  await query.preload()
  let unsubscribe: (() => void) | undefined
  // The model: the failure reason's frame, oldest first, and the serial of
  // the list.
  let failures: Array<Error> = []
  let serial = 0
  let reports = 0
  // What the last read saw, for the identity law and the reach states.
  let last:
    | { serial: number; messages: string; tree: HealthNode | undefined }
    | undefined
  let attachedSinceRead = false
  try {
    for (const [index, step] of commands.entries()) {
      if (step.type === `report`) {
        const failure = new Error(`problem ${reports++}`)
        controls().reportError(failure)
        failures = [...failures, failure]
        serial++
      } else if (step.type === `healthy`) {
        controls().reportHealthy()
        if (failures.length > 0) {
          failures = []
          serial++
        }
      } else if (step.type === `write`) {
        const c = controls()
        c.begin()
        c.write({ type: `update`, value: { id: `a`, version: step.version } })
        c.commit()
      } else if (step.type === `subscribe`) {
        if (unsubscribe) continue
        unsubscribe = observer.subscribe(() => {})
        attachedSinceRead = true
      } else if (step.type === `unsubscribe`) {
        if (!unsubscribe) continue
        unsubscribe()
        unsubscribe = undefined
      } else {
        const snapshot = observer.getSnapshot()
        const label = `step ${index}`
        const changed = last !== undefined && last.serial !== serial
        if (changed) {
          reach?.reach(
            unsubscribe
              ? `attached-read-after-health-change`
              : `detached-read-after-health-change`,
          )
          if (unsubscribe && attachedSinceRead)
            reach?.reach(`read-across-attach-after-health-change`)
        } else if (last !== undefined) reach?.reach(`unchanged-tree-read`)

        const node = snapshot.health?.sources[0]
        const problem = failures.length > 0
        if (failures.length > 1) reach?.reach(`read-with-several-failures`)
        oracleAssertion(`checkHealthHistory:590`, () =>
          expect(snapshot.status, `${label}: status`).toBe(`ready`),
        )
        oracleAssertion(`checkHealthHistory:591`, () =>
          expect(
            {
              message: node?.failureReason?.message ?? null,
              errors:
                node?.failureReason?.errors.map((failure) => failure.message) ??
                [],
            },
            `${label}: failureReason`,
          ).toEqual({
            message: failures.at(-1)?.message ?? null,
            errors: failures.map((failure) => failure.message),
          }),
        )
        oracleAssertion(`checkHealthHistory:603`, () =>
          expect(
            node?.failureReason?.errors.every(
              (failure, at) => failure.cause === failures[at],
            ) ?? true,
            `${label}: each listed failure is the reported value`,
          ).toBe(true),
        )
        oracleAssertion(`checkHealthHistory:609`, () =>
          expect(snapshot.health?.hasErrors, `${label}: hasErrors`).toBe(
            problem,
          ),
        )
        oracleAssertion(`checkHealthHistory:610`, () =>
          expect(snapshot.isSyncError, `${label}: isSyncError`).toBe(problem),
        )
        const messages = JSON.stringify(failures.map((f) => f.message))
        const previousRead = last
        if (previousRead !== undefined) {
          if (previousRead.serial === serial)
            oracleAssertion(`checkHealthHistory:614`, () =>
              expect(snapshot.health, `${label}: unchanged tree identity`).toBe(
                previousRead.tree,
              ),
            )
          else if (previousRead.messages !== messages)
            oracleAssertion(`checkHealthHistory:618`, () =>
              expect(
                snapshot.health,
                `${label}: changed tree identity`,
              ).not.toBe(previousRead.tree),
            )
        }
        last = { serial, messages, tree: snapshot.health }
        attachedSinceRead = false
      }
    }
  } finally {
    unsubscribe?.()
    observer.dispose()
    await query.cleanup()
    await source.cleanup()
  }
}

describe(`a snapshot shows the current health tree`, () => {
  const healthStates: ReadonlyArray<HealthReach> = [
    `detached-read-after-health-change`,
    `attached-read-after-health-change`,
    `read-across-attach-after-health-change`,
    `unchanged-tree-read`,
    `read-with-several-failures`,
  ]
  oracleProperty<Array<HealthCommand>, Verdict>({
    id: `live-query-observer.snapshot-health`,
    law: {
      statement: `Every read shows the current failure frame and sync-error flag, retaining tree identity while its content is unchanged.`,
      authority: `ARCHITECTURE.md law 17 and the glossary health-tree and sync-error contracts, as specified above.`,
      limits: `One ready controlled source, failureReason only, no hydration seed or framework.`,
    },
    histories: {
      arbitrary: fc.array(healthCommand, { minLength: 1, maxLength: 24 }),
      runs: 80,
      fixedSeeds: [695],
      states: healthStates,
      // Five separately checked constructions preserve the old minimum of
      // five reached histories per state, now in each campaign independently.
      constructed: Array.from({ length: 5 }, (_, index) => ({
        name: `health frame across attachment ${index}`,
        enters: healthStates,
        build: (generated: Array<HealthCommand>) => [
          { type: `read` as const },
          { type: `report` as const },
          { type: `read` as const },
          { type: `report` as const },
          { type: `subscribe` as const },
          { type: `read` as const },
          { type: `read` as const },
          ...generated.slice(0, 17),
        ],
      })),
    },
    model: recordedAssertionJudgment,
    driver: (commands, observe) =>
      recordSnapshotJudgment(
        `snapshot health frame`,
        commands,
        observe,
        healthStates,
        (reach) => checkHealthHistory(commands, reach),
      ),
    check: forwardAssertionJudgment,
  })

  it(`shows a health-only change made between a detached read and attach`, async () => {
    oracleRoute(`fixed history`)
    // Replay of the reported trace: a framework renders (detached read), a
    // source reports a problem before commit, the framework commits
    // (attach), then reads again.
    await checkHealthHistory([
      { type: `read` },
      { type: `report` },
      { type: `subscribe` },
      { type: `read` },
    ])
  })
})

/**
 * Within one row revision, metadata changes replace the full snapshot but
 * retain its row containers. Cleanup/reset can discard that revision.
 * Authority: maintainer decision 2026-11-01, preserving point-in-time rows while
 * preventing status/health changes from invalidating row-only consumers.
 * A value write must still create fresh containers, even with the same keys.
 * An action that changes no public fact also retains full-snapshot identity.
 *
 * This extends the retained-snapshot owner with a direct Collection boundary:
 * Every history first marks the source ready without writing rows; its suffix
 * may then report health legally. Subscribe/unsubscribe actions cross the
 * attach cut without ending the sync run. Repeated subscription actions are
 * idempotent in this single-subscriber driver. The independent model is
 * modelRows' key/version map; only `write` changes it. `refresh` supplies an
 * equal source write that can re-enrich wrappers without changing rows.
 * At every action the
 * driver compares row values and container identities, then checks all retained
 * snapshots again to reject a mutable shared Map. The failure list changes
 * only on reports and clears; readiness cannot count as health-only reach.
 * Attached/detached transitions and both
 * observer modes cross distinct cache paths. Empty and nonempty rows test lazy
 * Map materialization. The capture-path driver below adds query shapes and
 * hydration handoff; this lane claims no provider or framework scheduling.
 */
const containerHistory = fc.record({
  mode: fc.constantFrom(`granular` as const, `wholesale` as const),
  attached: fc.boolean(),
  count: fc.integer({ min: 0, max: 3 }),
  dataFirst: fc.boolean(),
  commands: fc.array(
    fc.constantFrom(
      `report`,
      `healthy`,
      `ready`,
      `write`,
      `refresh`,
      `subscribe`,
      `unsubscribe`,
    ),
    { minLength: 1, maxLength: 12 },
  ),
})
type ContainerHistory =
  typeof containerHistory extends fc.Arbitrary<infer T> ? T : never
type ContainerReach =
  | `attached`
  | `detached`
  | `granular`
  | `wholesale`
  | `empty`
  | `health-only`
  | `status-only`
  | `value-only`
  | `attach-granular`
  | `attach-wholesale`
  | `detach-granular`
  | `detach-wholesale`
  | `reattach-granular`
  | `reattach-wholesale`
  | `noop-granular`
  | `noop-wholesale`
  | `equal-revision-reenrichment`

async function checkContainerHistory(
  scenario: ContainerHistory,
  reach: SnapshotReach<ContainerReach>,
): Promise<void> {
  const model = new Map<string, number>(
    Array.from(
      { length: scenario.count },
      (_, index) => [String.fromCharCode(97 + index), 0] as const,
    ),
  )
  let controls: Parameters<SyncConfig<Row, string>[`sync`]>[0] | undefined
  const source = createCollection<Row, string>({
    getKey: (row) => row.id,
    gcTime: 0,
    startSync: true,
    sync: {
      sync: (params) => {
        controls = params
        params.begin()
        for (const row of modelRows(model))
          params.write({ type: `insert`, value: row })
        params.commit()
      },
    },
  })
  const observer = createLiveQueryObserver(source, { mode: scenario.mode })
  let stop = scenario.attached ? observer.subscribe(() => {}) : undefined
  let hasAttached = scenario.attached
  let failures: Array<Error> = []
  let expectedHealthOnly = 0
  let observedHealthOnly = 0
  const retained: Array<Captured> = []
  reach.reach(scenario.attached ? `attached` : `detached`)
  reach.reach(scenario.mode)
  if (model.size === 0) reach.reach(`empty`)
  let failure: { error: unknown } | undefined
  try {
    let before = observer.getSnapshot()
    let beforeRead = checkRead(
      `ordered`,
      { snapshot: before, rows: modelRows(model) },
      scenario.dataFirst,
      `initial`,
    )
    retained.push({ snapshot: before, rows: modelRows(model) })
    for (const [index, step] of [
      `ready` as const,
      ...scenario.commands,
    ].entries()) {
      const input = controls!
      const hadRow = model.has(`a`)
      const wasAttached = stop !== undefined
      if (step === `write`) {
        const version = (model.get(`a`) ?? -1) + 1
        input.begin()
        input.write({
          type: model.has(`a`) ? `update` : `insert`,
          value: { id: `a`, version },
        })
        input.commit()
        model.set(`a`, version)
      } else if (step === `refresh`) {
        // An equal source write can discard its virtual-property wrapper
        // without publishing a row revision. It changes no modeled fact.
        if (hadRow) {
          const revision = source._stateRevision
          const previous = source.get(`a`)
          input.begin()
          input.write({
            type: `update`,
            value: { id: `a`, version: model.get(`a`)! },
          })
          input.commit()
          if (
            source._stateRevision === revision &&
            source.get(`a`) !== previous
          )
            reach.reach(`equal-revision-reenrichment`)
        }
      } else if (step === `report`) {
        const error = new Error(`problem ${index}`)
        failures.push(error)
        input.reportError(error)
        expectedHealthOnly++
      } else if (step === `healthy`) {
        if (failures.length > 0) expectedHealthOnly++
        failures = []
        input.reportHealthy()
      } else if (step === `subscribe`) {
        stop ??= observer.subscribe(() => {})
      } else if (step === `unsubscribe`) {
        stop?.()
        stop = undefined
      } else input.markReady()
      const after = observer.getSnapshot()
      const read = checkRead(
        `ordered`,
        { snapshot: after, rows: modelRows(model) },
        scenario.dataFirst,
        `step ${index}`,
      )
      // The direct source is ready after the legal prefix. Attachment never
      // changes its status or failure frame; each read must show fresh metadata.
      oracleAssertion(`checkContainerHistory:845`, () =>
        expect(after.status, `step ${index}: status`).toBe(`ready`),
      )
      oracleAssertion(`checkContainerHistory:846`, () =>
        expect(after.isSyncError, `step ${index}: sync error`).toBe(
          failures.length > 0,
        ),
      )
      oracleAssertion(`checkContainerHistory:849`, () =>
        expect(after.health?.hasErrors, `step ${index}: health`).toBe(
          failures.length > 0,
        ),
      )
      oracleAssertion(`checkContainerHistory:852`, () =>
        expect(
          after.health?.failureReason?.errors.map((error) => error.cause) ?? [],
          `step ${index}: reported failures`,
        ).toEqual(failures),
      )
      reach.reach(stop ? `attached` : `detached`)
      if (step === `write`) {
        oracleAssertion(`checkContainerHistory:858`, () =>
          expect(read.data, `value writes replace data`).not.toBe(
            beforeRead.data,
          ),
        )
        oracleAssertion(`checkContainerHistory:859`, () =>
          expect(read.state, `value writes replace state`).not.toBe(
            beforeRead.state,
          ),
        )
        if (beforeRead.state?.has(`a`)) reach.reach(`value-only`)
      } else {
        oracleAssertion(`checkContainerHistory:864`, () =>
          expect(read.data, `metadata keeps data`).toBe(beforeRead.data),
        )
        oracleAssertion(`checkContainerHistory:865`, () =>
          expect(read.state, `metadata keeps state`).toBe(beforeRead.state),
        )
        if (after.status !== before.status) reach.reach(`status-only`)
        if (after.status === before.status && after.health !== before.health) {
          reach.reach(`health-only`)
          observedHealthOnly++
        }
        if (after.status !== before.status || after.health !== before.health)
          oracleAssertion(`checkContainerHistory:872`, () =>
            expect(after).not.toBe(before),
          )
        else {
          // Ownership and repeated metadata actions change no public fact.
          // The full-snapshot contract therefore preserves identity too.
          oracleAssertion(`checkContainerHistory:876`, () =>
            expect(after, `no-op keeps snapshot`).toBe(before),
          )
          reach.reach(`noop-${scenario.mode}`)
        }
      }
      if (step !== `write` || hadRow)
        oracleAssertion(`checkContainerHistory:881`, () =>
          expect(after.layoutRevision, `unchanged ordered keys`).toBe(
            before.layoutRevision,
          ),
        )
      else
        oracleAssertion(`checkContainerHistory:885`, () =>
          expect(
            after.layoutRevision,
            `new key changes layout`,
          ).toBeGreaterThan(before.layoutRevision),
        )
      if (model.size > 0 && !wasAttached && stop) {
        reach.reach(`attach-${scenario.mode}`)
        if (hasAttached) reach.reach(`reattach-${scenario.mode}`)
        hasAttached = true
      }
      if (model.size > 0 && wasAttached && !stop)
        reach.reach(`detach-${scenario.mode}`)
      retained.push({ snapshot: after, rows: modelRows(model) })
      before = after
      beforeRead = read
    }
    for (const [index, captured] of retained.entries())
      checkRead(`ordered`, captured, !scenario.dataFirst, `retained ${index}`)
    // Calibrate reach through the same model and driver, including histories
    // containing only readiness: loading -> ready is never health-only.
    oracleAssertion(`checkContainerHistory:903`, () =>
      expect(
        observedHealthOnly,
        `health-only transitions exclude readiness`,
      ).toBe(expectedHealthOnly),
    )
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [() => stop?.(), () => observer.dispose(), () => source.cleanup()],
    failure,
  )
}

declareOracle({ check: [checkContainerHistory], grammar: [containerHistory] })

describe(`metadata snapshots share immutable row containers`, () => {
  const examples: Array<[ContainerHistory]> = (
    [`granular`, `wholesale`] as const
  ).flatMap((mode) =>
    [false, true].flatMap((attached) =>
      [0, 1, 3].flatMap((count) => [
        [
          {
            mode,
            attached,
            count,
            dataFirst: count % 2 === 0,
            commands: [
              `unsubscribe`,
              `refresh`,
              `subscribe`,
              `unsubscribe`,
              `subscribe`,
              `report`,
              `ready`,
              `write`,
              `healthy`,
              `write`,
            ],
          },
        ] as [ContainerHistory],
        [
          {
            mode,
            attached,
            count,
            dataFirst: count % 2 === 0,
            commands: [`ready`],
          },
        ] as [ContainerHistory],
      ]),
    ),
  )
  const containerStates: ReadonlyArray<ContainerReach> = [
    `attached`,
    `detached`,
    `granular`,
    `wholesale`,
    `empty`,
    `health-only`,
    `status-only`,
    `value-only`,
    `attach-granular`,
    `attach-wholesale`,
    `detach-granular`,
    `detach-wholesale`,
    `reattach-granular`,
    `reattach-wholesale`,
    `noop-granular`,
    `noop-wholesale`,
    `equal-revision-reenrichment`,
  ]
  oracleProperty<ContainerHistory, Verdict>({
    id: `live-query-observer.row-container-sharing`,
    law: {
      statement: `Metadata-only changes retain row containers; value changes replace them, and a no-op retains the whole snapshot.`,
      authority: `Maintainer decision 2026-11-01 and the independent key/version model above.`,
      limits: `Direct controlled Collection, both observer modes and attachment cuts, zero to three initial rows; query shapes and hydration belong to the next driver.`,
    },
    histories: {
      arbitrary: containerHistory,
      runs: 40,
      fixedSeeds: [1101],
      states: containerStates,
      fixed: examples.map(([fixedHistory], index) => ({
        name: `row containers ${index}`,
        history: fixedHistory,
      })),
      constructed: [
        ...([`granular`, `wholesale`] as const).map((mode) => ({
          name: `${mode} metadata, ownership, and value revisions`,
          enters: [
            `attached`,
            `detached`,
            mode,
            `health-only`,
            `status-only`,
            `value-only`,
            `attach-${mode}`,
            `detach-${mode}`,
            `reattach-${mode}`,
            `noop-${mode}`,
            `equal-revision-reenrichment`,
          ],
          build: (generated: ContainerHistory): ContainerHistory => ({
            ...generated,
            mode,
            attached: true,
            count: 1,
            commands: [
              `unsubscribe`,
              `refresh`,
              `subscribe`,
              `unsubscribe`,
              `subscribe`,
              `report`,
              `ready`,
              `write`,
              `healthy`,
              `write`,
              ...generated.commands.slice(0, 2),
            ],
          }),
        })),
        {
          name: `empty row containers`,
          enters: [`empty`],
          build: (generated) => ({ ...generated, count: 0 }),
        },
      ],
    },
    model: recordedAssertionJudgment,
    driver: (scenario, observe) =>
      recordSnapshotJudgment(
        `row-container sharing`,
        scenario,
        observe,
        containerStates,
        (reach) => checkContainerHistory(scenario, reach),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * The same snapshot laws also cross query projection, findOne, initial
 * attachment, and hydration. This driver adds those receiving paths to checkRead;
 * it does not give them a second expected answer. Source rank is deliberately
 * absent from the selected Row, so moving it can change only ordered keys.
 *
 * The independent model keeps version and rank separately. Its sorted rows
 * predict the selected view. Equal writes and ownership actions change neither.
 * A hydration seed is an earlier capture with version -1; the ready live view
 * replaces it and must leave that retained seed unchanged. Checks occur after
 * the query's queued publication, not at an intermediate source callback.
 * A discarded delivery deferral keeps committed state (Collection's
 * _deferPublication contract). A detached read inside it and a later write
 * must remain distinct captures even when no read observes the close.
 * The discard actions cross this schedule with value and layout changes.
 * Reattachment after discard is the neighboring delivery path.
 */
const capturePathHistory = fc.record({
  shape: fc.constantFrom(`ordered` as const, `single` as const),
  mode: fc.constantFrom(`granular` as const, `wholesale` as const),
  attached: fc.boolean(),
  hydrated: fc.boolean(),
  count: fc.integer({ min: 2, max: 3 }),
  deferralDepth: fc.integer({ min: 1, max: 2 }),
  dataFirst: fc.boolean(),
  commands: fc.array(
    fc.constantFrom(
      `move`,
      `write`,
      `refresh`,
      `report`,
      `healthy`,
      `subscribe`,
      `unsubscribe`,
      `ready`,
      `discard-write`,
      `discard-move`,
    ),
    { minLength: 1, maxLength: 12 },
  ),
})
type CapturePathHistory =
  typeof capturePathHistory extends fc.Arbitrary<infer T> ? T : never
type CapturePathReach =
  | `nested-discard`
  | `ordered-granular`
  | `ordered-wholesale`
  | `single-granular`
  | `single-wholesale`
  | `initial-attached-granular`
  | `initial-attached-wholesale`
  | `initial-detached-granular`
  | `initial-detached-wholesale`
  | `hydrated-ordered`
  | `hydrated-single`
  | `layout-only-granular-attached`
  | `layout-only-granular-detached`
  | `layout-only-wholesale-attached`
  | `layout-only-wholesale-detached`
  | `metadata-ordered-granular`
  | `metadata-ordered-wholesale`
  | `metadata-single-granular`
  | `metadata-single-wholesale`
  | `discarded-write-granular-attached`
  | `discarded-write-granular-detached`
  | `discarded-write-wholesale-attached`
  | `discarded-write-wholesale-detached`
  | `discarded-move-granular-attached`
  | `discarded-move-granular-detached`
  | `discarded-move-wholesale-attached`
  | `discarded-move-wholesale-detached`

async function checkCapturePathHistory(
  scenario: CapturePathHistory,
  reach: SnapshotReach<CapturePathReach>,
): Promise<void> {
  type SourceRow = Row & { rank: number }
  const versions = new Map<string, number>()
  const ranks = new Map<string, number>()
  for (let index = 0; index < scenario.count; index++) {
    const id = String.fromCharCode(97 + index)
    versions.set(id, 0)
    ranks.set(id, index)
  }
  const expectedRows = () =>
    modelRows(versions).sort(
      (left, right) => ranks.get(left.id)! - ranks.get(right.id)!,
    )
  let controls: Parameters<SyncConfig<SourceRow, string>[`sync`]>[0] | undefined
  const source = createCollection<SourceRow, string>({
    getKey: (row) => row.id,
    gcTime: Infinity,
    startSync: true,
    sync: {
      sync: (input) => {
        controls = input
        input.begin()
        for (const row of expectedRows())
          input.write({
            type: `insert`,
            value: { ...row, rank: ranks.get(row.id)! },
          })
        input.commit()
        if (!scenario.hydrated) input.markReady()
      },
    },
  })
  source.createIndex((row) => row.rank, { indexType: BTreeIndex })
  const ordered = new Query()
    .from({ row: source })
    .orderBy(({ row }) => row.rank)
    .select(({ row }) => ({ id: row.id, version: row.version }))
  const query = createLiveQueryCollection({
    query: scenario.shape === `single` ? ordered.findOne() : ordered,
    getKey: (row) => row.id,
    gcTime: Infinity,
    startSync: true,
  })
  const client = scenario.hydrated ? new DbClient() : undefined
  const queryHash = `capture-path-${sequence++}`
  const seedRows = expectedRows()
    .slice(0, scenario.shape === `single` ? 1 : undefined)
    .map((row) => ({ ...row, version: -1 }))
  client?.hydrate({
    collections: [],
    liveQueries: [
      {
        queryHash,
        dehydratedAt: 1,
        snapshot: { rows: seedRows.map((value) => ({ key: value.id, value })) },
      },
    ],
  })
  if (!scenario.hydrated) await query.preload()
  const observer = createLiveQueryObserver(query, {
    mode: scenario.mode,
    client,
    queryHash,
  })
  let stop: (() => void) | undefined
  const retained: Array<Captured> = []
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  let failure: { error: unknown } | undefined
  try {
    if (scenario.hydrated) {
      const seed = observer.getSnapshot()
      checkRead(
        scenario.shape,
        { snapshot: seed, rows: seedRows },
        scenario.dataFirst,
        `seed`,
      )
      retained.push({ snapshot: seed, rows: seedRows })
      stop = observer.subscribe(() => {})
      controls!.markReady()
      await query.preload()
      await settle()
      reach.reach(`hydrated-${scenario.shape}`)
    } else if (scenario.attached) stop = observer.subscribe(() => {})
    if (!scenario.attached) {
      stop?.()
      stop = undefined
    }
    reach.reach(`${scenario.shape}-${scenario.mode}`)
    reach.reach(
      `initial-${scenario.attached ? `attached` : `detached`}-${scenario.mode}`,
    )
    let before = observer.getSnapshot()
    let hasErrors = false
    let beforeRows = expectedRows()
    let beforeRead = checkRead(
      scenario.shape,
      { snapshot: before, rows: beforeRows },
      scenario.dataFirst,
      `initial live`,
    )
    retained.push({ snapshot: before, rows: beforeRows })
    const change = (kind: `move` | `write` | `refresh`) => {
      if (kind === `move`) ranks.set(`a`, ranks.get(`a`)! < 50 ? 100 : -1)
      if (kind === `write`) versions.set(`a`, versions.get(`a`)! + 1)
      controls!.begin()
      controls!.write({
        type: `update`,
        value: { id: `a`, version: versions.get(`a`)!, rank: ranks.get(`a`)! },
      })
      controls!.commit()
    }
    for (const [index, step] of scenario.commands.entries()) {
      const revision = query._stateRevision
      if (step === `discard-write` || step === `discard-move`) {
        stop?.()
        stop = undefined
        const deferrals = Array.from({ length: scenario.deferralDepth }, () =>
          query._deferPublication(),
        )
        const kind = step === `discard-write` ? `write` : `move`
        try {
          change(kind)
          await settle()
          before = observer.getSnapshot()
          beforeRows = expectedRows()
          beforeRead = checkRead(
            scenario.shape,
            { snapshot: before, rows: beforeRows },
            scenario.dataFirst,
            `inside deferral ${index}`,
          )
          retained.push({ snapshot: before, rows: beforeRows })
        } finally {
          for (const deferral of deferrals.reverse()) deferral.discard()
          if (deferrals.length > 1) reach.reach(`nested-discard`)
        }
        // No read sees the close before the next write. A snapshot cache
        // cannot rely on observing every intermediate Collection transition.
        if (scenario.attached) stop = observer.subscribe(() => {})
        change(kind)
        reach.reach(
          `discarded-${kind}-${scenario.mode}-${stop ? `attached` : `detached`}`,
        )
      } else if (step === `move` || step === `write` || step === `refresh`) {
        change(step)
      } else if (step === `report`) {
        hasErrors = true
        controls!.reportError(new Error(`path ${index}`))
      } else if (step === `healthy`) {
        hasErrors = false
        controls!.reportHealthy()
      } else if (step === `subscribe`) stop ??= observer.subscribe(() => {})
      else if (step === `unsubscribe`) {
        stop?.()
        stop = undefined
      } else controls!.markReady()
      await settle()
      const after = observer.getSnapshot()
      oracleAssertion(`checkCapturePathHistory:1247`, () =>
        expect(after.status, `query is ready`).toBe(`ready`),
      )
      oracleAssertion(`checkCapturePathHistory:1248`, () =>
        expect(after.isSyncError, `query health follows reports`).toBe(
          hasErrors,
        ),
      )
      oracleAssertion(`checkCapturePathHistory:1249`, () =>
        expect(after.health?.hasErrors, `query health tree is fresh`).toBe(
          hasErrors,
        ),
      )
      const rows = expectedRows()
      const visible = (values: Array<Row>) =>
        scenario.shape === `single` ? values.slice(0, 1) : values
      const oldRows = visible(beforeRows)
      const newRows = visible(rows)
      const rowChanged = JSON.stringify(oldRows) !== JSON.stringify(newRows)
      const keysChanged =
        oldRows.length !== newRows.length ||
        oldRows.some((row, at) => row.id !== newRows[at]!.id)
      const read = checkRead(
        scenario.shape,
        { snapshot: after, rows },
        scenario.dataFirst,
        `path step ${index}`,
      )
      if (rowChanged) {
        oracleAssertion(`checkCapturePathHistory:1268`, () =>
          expect(read.state, `changed query rows replace state`).not.toBe(
            beforeRead.state,
          ),
        )
        oracleAssertion(`checkCapturePathHistory:1271`, () =>
          expect(read.data, `changed query rows replace data`).not.toBe(
            beforeRead.data,
          ),
        )
      } else {
        oracleAssertion(`checkCapturePathHistory:1275`, () =>
          expect(read.state, `unchanged query rows keep state`).toBe(
            beforeRead.state,
          ),
        )
        oracleAssertion(`checkCapturePathHistory:1278`, () =>
          expect(read.data, `unchanged query rows keep data`).toBe(
            beforeRead.data,
          ),
        )
        if (after.health === before.health)
          oracleAssertion(`checkCapturePathHistory:1282`, () =>
            expect(after, `query no-op keeps snapshot`).toBe(before),
          )
        else {
          oracleAssertion(`checkCapturePathHistory:1284`, () =>
            expect(after, `query metadata replaces snapshot`).not.toBe(before),
          )
          reach.reach(`metadata-${scenario.shape}-${scenario.mode}`)
        }
      }
      if (keysChanged) {
        oracleAssertion(`checkCapturePathHistory:1289`, () =>
          expect(after.layoutRevision, `query layout advances`).toBeGreaterThan(
            before.layoutRevision,
          ),
        )
        if (query._stateRevision === revision)
          reach.reach(
            `layout-only-${scenario.mode}-${stop ? `attached` : `detached`}`,
          )
      } else
        oracleAssertion(`checkCapturePathHistory:1297`, () =>
          expect(after.layoutRevision, `query layout stays`).toBe(
            before.layoutRevision,
          ),
        )
      retained.push({ snapshot: after, rows })
      before = after
      beforeRows = rows
      beforeRead = read
    }
    for (const [index, captured] of retained.entries())
      checkRead(
        scenario.shape,
        captured,
        !scenario.dataFirst,
        `retained path ${index}`,
      )
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [
      () => stop?.(),
      () => observer.dispose(),
      () => query.cleanup(),
      () => source.cleanup(),
      () => client?.cleanup(),
    ],
    failure,
  )
}

declareOracle({
  check: [checkCapturePathHistory],
  grammar: [capturePathHistory],
})

describe(`snapshot capture paths preserve row and layout laws`, () => {
  // These replay the same driver/check before the broad campaign so a value
  // failure cannot hide the distinct layout premise during RED verification.
  for (const action of [`discard-write`, `discard-move`] as const)
    it(`reads committed rows after ${action}`, async () => {
      oracleRoute(`fixed history`)
      const reach = snapshotReach<CapturePathReach>([
        `ordered-granular`,
        `initial-detached-granular`,
        `discarded-write-granular-detached`,
        `discarded-move-granular-detached`,
        `layout-only-granular-detached`,
      ])
      await checkCapturePathHistory(
        {
          shape: `ordered`,
          mode: `granular`,
          attached: false,
          hydrated: false,
          count: 2,
          deferralDepth: 1,
          dataFirst: false,
          commands: [action],
        },
        reach,
      )
    })
  const examples: Array<[CapturePathHistory]> = (
    [`ordered`, `single`] as const
  ).flatMap((shape) =>
    ([`granular`, `wholesale`] as const).flatMap((mode) =>
      [false, true].flatMap((attached) =>
        [false, true].map(
          (hydrated) =>
            [
              {
                shape,
                mode,
                attached,
                hydrated,
                count: 2,
                deferralDepth: hydrated ? 2 : 1,
                dataFirst: false,
                commands: [
                  `unsubscribe`,
                  `move`,
                  `subscribe`,
                  `move`,
                  `write`,
                  `refresh`,
                  `report`,
                  `healthy`,
                  `unsubscribe`,
                  `subscribe`,
                  `ready`,
                  `discard-write`,
                  `discard-move`,
                ],
              },
            ] as [CapturePathHistory],
        ),
      ),
    ),
  )
  const captureStates: ReadonlyArray<CapturePathReach> = [
    `nested-discard`,
    `ordered-granular`,
    `ordered-wholesale`,
    `single-granular`,
    `single-wholesale`,
    `initial-attached-granular`,
    `initial-attached-wholesale`,
    `initial-detached-granular`,
    `initial-detached-wholesale`,
    `hydrated-ordered`,
    `hydrated-single`,
    `layout-only-granular-attached`,
    `layout-only-granular-detached`,
    `layout-only-wholesale-attached`,
    `layout-only-wholesale-detached`,
    `metadata-ordered-granular`,
    `metadata-ordered-wholesale`,
    `metadata-single-granular`,
    `metadata-single-wholesale`,
    `discarded-write-granular-attached`,
    `discarded-write-granular-detached`,
    `discarded-write-wholesale-attached`,
    `discarded-write-wholesale-detached`,
    `discarded-move-granular-attached`,
    `discarded-move-granular-detached`,
    `discarded-move-wholesale-attached`,
    `discarded-move-wholesale-detached`,
  ]
  // These original 13-command regressions deliberately remain direct replays:
  // the generated language still has its original maximum of 12 commands.
  it.each(examples)(
    `replays the retained capture-path history %#`,
    async (scenario) => {
      oracleRoute(`fixed history`)
      await checkCapturePathHistory(scenario, snapshotReach(captureStates))
    },
  )
  oracleProperty<CapturePathHistory, Verdict>({
    id: `live-query-observer.capture-paths`,
    law: {
      statement: `Retained snapshots preserve committed row values and layout through projection, findOne, hydration, and discarded publication deferrals.`,
      authority: `The retained-snapshot contract and Collection deferred-publication contract described above.`,
      limits: `Two or three controlled rows, one or two nested deferrals, the existing 12-command generated language; no provider or framework scheduling claim.`,
    },
    histories: {
      arbitrary: capturePathHistory,
      runs: 40,
      fixedSeeds: [2346],
      states: captureStates,
      constructed: ([`ordered`, `single`] as const).flatMap((shape) =>
        ([`granular`, `wholesale`] as const).flatMap((mode) =>
          [false, true].map((attached) => ({
            name: `${shape} ${mode} initially ${attached ? `attached` : `detached`}`,
            enters: [
              `nested-discard`,
              `${shape}-${mode}`,
              `initial-${attached ? `attached` : `detached`}-${mode}`,
              `hydrated-${shape}`,
              `metadata-${shape}-${mode}`,
              `discarded-write-${mode}-${attached ? `attached` : `detached`}`,
              `discarded-move-${mode}-${attached ? `attached` : `detached`}`,
              ...(shape === `ordered`
                ? [
                    `layout-only-${mode}-attached`,
                    `layout-only-${mode}-detached`,
                  ]
                : []),
            ],
            build: (generated: CapturePathHistory): CapturePathHistory => ({
              ...generated,
              shape,
              mode,
              attached,
              hydrated: true,
              deferralDepth: 2,
              commands: [
                `unsubscribe`,
                `move`,
                `subscribe`,
                `move`,
                `report`,
                `healthy`,
                `discard-write`,
                `discard-move`,
                ...generated.commands.slice(0, 4),
              ],
            }),
          })),
        ),
      ),
    },
    model: recordedAssertionJudgment,
    driver: (scenario, observe) =>
      recordSnapshotJudgment(
        `snapshot capture paths`,
        scenario,
        observe,
        captureStates,
        (reach) => checkCapturePathHistory(scenario, reach),
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * A public row's nested record prototype is observable shape. Maintainer
 * decision 2026-11-03: replacing a plain record with a class instance (or the
 * reverse) publishes an update even when enumerable fields match. Draft
 * snapshots keep their separate class/plain reconstruction equivalence.
 *
 * The model is a shape name and one number; neither comes from production's
 * equality function. Fresh values of the same shape and number are no-ops.
 * Records, array elements, Map values and Set members carry the nested value.
 * Direct Collections and projected live queries receive the same authored
 * changes. At each applied checkpoint, both snapshot views and a granular
 * consumer must agree with the model, and all earlier snapshots stay intact.
 * No same-object promise joins a raw granular change to an older equal capture.
 * This bounded grammar covers keyed record prototypes, not exotic built-in
 * subclasses, descriptors, or arbitrary reference-sensitive query expressions.
 */
class ShapePayload {
  constructor(public value: number) {}
}
const payloadKinds = [`plain`, `class`, `null`] as const
const payloadCarriers = [`record`, `array`, `map`, `set`] as const
type PayloadKind = (typeof payloadKinds)[number]
type PayloadCarrier = (typeof payloadCarriers)[number]
type PayloadSpec = { kind: PayloadKind; value: number }
const payloadSpec = fc.record({
  kind: fc.constantFrom(...payloadKinds),
  value: fc.integer({ min: 0, max: 2 }),
})
const payloadHistory = fc.record({
  mode: fc.constantFrom(`granular` as const, `wholesale` as const),
  attached: fc.boolean(),
  carrier: fc.constantFrom(...payloadCarriers),
  initial: payloadSpec,
  commands: fc.array(
    fc.oneof(
      payloadSpec,
      fc.constantFrom(
        `refresh` as const,
        `subscribe` as const,
        `unsubscribe` as const,
        `report` as const,
        `healthy` as const,
      ),
    ),
    { minLength: 1, maxLength: 12 },
  ),
})
type PayloadHistory =
  typeof payloadHistory extends fc.Arbitrary<infer T> ? T : never
type PayloadReach =
  | `source-granular`
  | `source-wholesale`
  | `query-granular`
  | `query-wholesale`
  | `plain-class`
  | `class-plain`
  | `plain-null`
  | `same-shape-copy`
  | PayloadCarrier
function makePayload(spec: PayloadSpec, carrier: PayloadCarrier): object {
  const leaf =
    spec.kind === `class`
      ? new ShapePayload(spec.value)
      : spec.kind === `null`
        ? Object.assign(Object.create(null) as object, { value: spec.value })
        : { value: spec.value }
  if (carrier === `array`) return [leaf]
  if (carrier === `map`) return new Map([[`leaf`, leaf]])
  if (carrier === `set`) return new Set([leaf])
  return { leaf }
}
function payloadObservation(
  payload: object,
  carrier: PayloadCarrier,
): PayloadSpec {
  const leaf: { value: number } =
    carrier === `array`
      ? (payload as Array<{ value: number }>)[0]!
      : carrier === `map`
        ? (payload as Map<string, { value: number }>).get(`leaf`)!
        : carrier === `set`
          ? (payload as Set<{ value: number }>).values().next().value!
          : (payload as { leaf: { value: number } }).leaf
  const prototype: unknown = Object.getPrototypeOf(leaf)
  oracleAssertion(`payloadObservation:1544`, () =>
    expect(
      [Object.prototype, ShapePayload.prototype, null],
      `authored prototype`,
    ).toContain(prototype),
  )
  return {
    kind:
      prototype === ShapePayload.prototype
        ? `class`
        : prototype === null
          ? `null`
          : `plain`,
    value: leaf.value,
  }
}
async function checkPayloadHistory(
  scenario: PayloadHistory & { query: boolean },
  reach: SnapshotReach<PayloadReach>,
): Promise<void> {
  type PayloadRow = Row & { payload: object }
  let model = scenario.initial
  let controls!: Parameters<SyncConfig<PayloadRow, string>[`sync`]>[0]
  const source = createCollection<PayloadRow, string>({
    getKey: (row) => row.id,
    startSync: true,
    gcTime: Infinity,
    sync: {
      sync(input) {
        controls = input
        input.begin()
        input.write({
          type: `insert`,
          value: {
            id: `a`,
            version: 0,
            payload: makePayload(model, scenario.carrier),
          },
        })
        input.commit()
        input.markReady()
      },
    },
  })
  const query = scenario.query
    ? createLiveQueryCollection({
        query: new Query().from({ row: source }).select(({ row }) => ({
          id: row.id,
          version: row.version,
          payload: row.payload,
        })),
        getKey: (row) => row.id,
        gcTime: Infinity,
        startSync: true,
      })
    : undefined
  if (query) await query.preload()
  const observer = query
    ? createLiveQueryObserver(query, { mode: scenario.mode })
    : createLiveQueryObserver(source, { mode: scenario.mode })
  const granular = new Map<string | number, PayloadRow>()
  const subscribe = () =>
    observer.subscribe((changes) => {
      for (const change of changes ?? []) {
        if (change.type === `delete`) granular.delete(change.key)
        else granular.set(change.key, change.value)
      }
    })
  let stop = scenario.attached ? subscribe() : undefined
  type PayloadSnapshot = Pick<
    LiveQuerySnapshot<PayloadRow, string | number>,
    `state` | `data`
  >
  const retained: Array<{ snapshot: PayloadSnapshot; spec: PayloadSpec }> = []
  const check = (
    snapshot: PayloadSnapshot,
    spec: PayloadSpec,
    label: string,
  ) => {
    checkRead(
      `ordered`,
      { snapshot, rows: [{ id: `a`, version: 0 }] },
      false,
      label,
    )
    const data = snapshot.data as ReadonlyArray<PayloadRow>
    oracleAssertion(`checkPayloadHistory:1628`, () =>
      expect(
        payloadObservation(data[0]!.payload, scenario.carrier),
        `${label}: data shape and value`,
      ).toEqual(spec),
    )
    oracleAssertion(`checkPayloadHistory:1632`, () =>
      expect(
        payloadObservation(snapshot.state!.get(`a`)!.payload, scenario.carrier),
        `${label}: state shape and value`,
      ).toEqual(spec),
    )
  }
  let failure: { error: unknown } | undefined
  try {
    reach.reach(`${scenario.query ? `query` : `source`}-${scenario.mode}`)
    reach.reach(scenario.carrier)
    let before = observer.getSnapshot()
    retained.push({ snapshot: before, spec: model })
    for (const [index, step] of scenario.commands.entries()) {
      const next = typeof step === `object` ? step : model
      const changed = next.kind !== model.kind || next.value !== model.value
      if (typeof step === `object` || step === `refresh`) {
        if (next.value === model.value) {
          if (model.kind === `plain` && next.kind === `class`)
            reach.reach(`plain-class`)
          if (model.kind === `class` && next.kind === `plain`)
            reach.reach(`class-plain`)
          if (model.kind === `plain` && next.kind === `null`)
            reach.reach(`plain-null`)
          if (!changed) reach.reach(`same-shape-copy`)
        }
        controls.begin()
        controls.write({
          type: `update`,
          value: {
            id: `a`,
            version: 0,
            payload: makePayload(next, scenario.carrier),
          },
        })
        controls.commit()
        model = next
      } else if (step === `subscribe`) stop ??= subscribe()
      else if (step === `unsubscribe`) {
        stop?.()
        stop = undefined
        granular.clear()
      } else if (step === `report`)
        controls.reportError(new Error(`payload ${index}`))
      else controls.reportHealthy()
      if (query) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const after = observer.getSnapshot()
      check(
        after,
        model,
        `${scenario.query ? `query` : `source`} payload ${index}`,
      )
      if (changed) {
        oracleAssertion(`checkPayloadHistory:1683`, () =>
          expect(after.data, `shape/value changes replace data`).not.toBe(
            before.data,
          ),
        )
        oracleAssertion(`checkPayloadHistory:1686`, () =>
          expect(after.state, `shape/value changes replace state`).not.toBe(
            before.state,
          ),
        )
      } else {
        oracleAssertion(`checkPayloadHistory:1690`, () =>
          expect(after.data, `same rows keep data`).toBe(before.data),
        )
        oracleAssertion(`checkPayloadHistory:1691`, () =>
          expect(after.state, `same rows keep state`).toBe(before.state),
        )
      }
      if (stop && scenario.mode === `granular`) {
        oracleAssertion(`checkPayloadHistory:1694`, () =>
          expect([...granular.keys()], `granular membership`).toEqual([`a`]),
        )
        oracleAssertion(`checkPayloadHistory:1695`, () =>
          expect(
            payloadObservation(granular.get(`a`)!.payload, scenario.carrier),
            `granular agrees with snapshot shape and value`,
          ).toEqual(model),
        )
      }
      retained.push({ snapshot: after, spec: model })
      before = after
    }
    for (const [index, entry] of retained.entries())
      check(entry.snapshot, entry.spec, `retained payload ${index}`)
  } catch (error) {
    failure = { error }
  }
  await finishHistory(
    [
      () => stop?.(),
      () => observer.dispose(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ],
    failure,
  )
}
declareOracle({ check: [checkPayloadHistory], grammar: [payloadHistory] })
describe(`publications preserve nested record shape`, () => {
  const examples: Array<[PayloadHistory]> = (
    [`granular`, `wholesale`] as const
  ).flatMap((mode) =>
    [false, true].flatMap((attached) =>
      payloadCarriers.map((carrier): [PayloadHistory] => [
        {
          mode,
          attached,
          carrier,
          initial: { kind: `plain`, value: 0 },
          commands: [
            { kind: `class`, value: 0 },
            `refresh`,
            `report`,
            { kind: `plain`, value: 0 },
            { kind: `null`, value: 0 },
            `subscribe`,
            { kind: `class`, value: 0 },
            `unsubscribe`,
            { kind: `plain`, value: 0 },
            `healthy`,
          ],
        },
      ]),
    ),
  )
  const payloadStates: ReadonlyArray<PayloadReach> = [
    `source-granular`,
    `source-wholesale`,
    `query-granular`,
    `query-wholesale`,
    `plain-class`,
    `class-plain`,
    `plain-null`,
    `same-shape-copy`,
    ...payloadCarriers,
  ]
  oracleProperty<PayloadHistory, Verdict>({
    id: `live-query-observer.record-shape`,
    law: {
      statement: `Publications preserve nested record prototype and value, replacing containers only when that modeled value changes.`,
      authority: `Maintainer decision 2026-11-03 and the shape-name/value model above.`,
      limits: `Plain, class, and null-prototype records through the four existing carriers, direct/projected Collections and both modes; no exotic subclasses or descriptors.`,
    },
    histories: {
      arbitrary: payloadHistory,
      runs: 40,
      fixedSeeds: [234602],
      states: payloadStates,
      fixed: examples.map(([fixedHistory], index) => ({
        name: `record shape ${index}`,
        history: fixedHistory,
      })),
      constructed: ([`granular`, `wholesale`] as const).flatMap((mode) =>
        payloadCarriers.map((carrier) => ({
          name: `${mode} ${carrier} shape transitions`,
          enters: [
            `source-${mode}`,
            `query-${mode}`,
            carrier,
            `plain-class`,
            `class-plain`,
            `plain-null`,
            `same-shape-copy`,
          ],
          build: (generated: PayloadHistory): PayloadHistory => ({
            ...generated,
            mode,
            carrier,
            initial: { kind: `plain`, value: generated.initial.value },
            commands: [
              { kind: `class`, value: generated.initial.value },
              `refresh`,
              { kind: `plain`, value: generated.initial.value },
              { kind: `null`, value: generated.initial.value },
              ...generated.commands.slice(0, 8),
            ],
          }),
        })),
      ),
    },
    model: recordedAssertionJudgment,
    driver: (scenario, observe) =>
      recordSnapshotJudgment(
        `nested record shape`,
        scenario,
        observe,
        payloadStates,
        async (reach) => {
          // Both receiving paths run before reporting a mismatch, so an early
          // direct-Collection failure cannot hide the query's pre-edit result.
          const results = await Promise.allSettled(
            [false, true].map((query) =>
              checkPayloadHistory({ ...scenario, query }, reach),
            ),
          )
          const errors = results.flatMap((result) =>
            result.status === `rejected` ? [result.reason] : [],
          )
          if (errors.length)
            throw new AggregateError(
              errors,
              `source and query shape comparisons: ${errors.map(String).join(`; `)}`,
              { cause: errors[0] },
            )
        },
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * A defined array position must reach every row consumer after its sync write
 * applies. Change-event equality treats a hole as undefined, so that neighbor
 * keeps row containers stable; it cannot suppress a hole-to-number change.
 * The utility owner's shared grammar supplies values and its positional model.
 * Real Collection events, direct/projected observers, both modes, and retained
 * snapshots receive the same law. Each generated case executes every receiving
 * path, rather than relying on a random choice to reach one. Provider delivery
 * and framework scheduling remain outside this core publication boundary.
 */
const sparseReceivingStates = [
  `source-granular-attached`,
  `source-granular-detached`,
  `source-wholesale-attached`,
  `source-wholesale-detached`,
  `query-granular-attached`,
  `query-granular-detached`,
  `query-wholesale-attached`,
  `query-wholesale-detached`,
  `hole-undefined`,
  `hole-defined`,
  `defined-hole`,
  ...sparseArrayCarriers,
] as const
async function checkSparsePublication(
  spec: SparseArrayCase,
  carrier: SparseArrayCarrier,
  mode: `granular` | `wholesale`,
  projected: boolean,
  attached: boolean,
  reach: SnapshotReach<(typeof sparseReceivingStates)[number]>,
): Promise<void> {
  type SparseRow = { id: string; payload: object }
  let sync!: Parameters<SyncConfig<SparseRow, string>[`sync`]>[0]
  const row = (form: SparseArrayForm): SparseRow => ({
    id: `a`,
    payload: makeSparseArray(spec, form, carrier),
  })
  const source = createCollection<SparseRow, string>({
    getKey: (value) => value.id,
    startSync: true,
    gcTime: Infinity,
    sync: {
      sync(input) {
        sync = input
        input.begin()
        input.write({ type: `insert`, value: row(`hole`) })
        input.commit()
        input.markReady()
      },
    },
  })
  const query = projected
    ? createLiveQueryCollection({
        query: new Query().from({ row: source }).select(({ row: value }) => ({
          id: value.id,
          payload: value.payload,
        })),
        getKey: (value) => value.id,
        startSync: true,
        gcTime: Infinity,
      })
    : undefined
  const observer = query
    ? createLiveQueryObserver(query, { mode })
    : createLiveQueryObserver(source, { mode })
  const mirror = new Map(source.entries())
  const subscription = source.subscribeChanges(
    (changes) => {
      for (const change of changes) {
        if (change.type === `delete`) mirror.delete(change.key)
        else mirror.set(change.key, change.value)
      }
    },
    { includeInitialState: false },
  )
  const stop = attached ? observer.subscribe(() => {}) : undefined
  type SparseSnapshot = Pick<
    LiveQuerySnapshot<SparseRow, string | number>,
    `data` | `state`
  >
  const rows = (snapshot: SparseSnapshot): ReadonlyArray<SparseRow> => {
    if (!Array.isArray(snapshot.data))
      throw new Error(`ordered sparse snapshot must contain an array`)
    return snapshot.data
  }
  const retained: Array<{
    snapshot: SparseSnapshot
    values: Array<number | undefined>
  }> = []
  let failure: { error: unknown } | undefined
  try {
    if (query) await query.preload()
    reach.reach(
      `${projected ? `query` : `source`}-${mode}-${attached ? `attached` : `detached`}`,
    )
    reach.reach(carrier)
    let previous = observer.getSnapshot()
    retained.push({
      snapshot: previous,
      values: sparseArrayValues(spec, `hole`),
    })
    const forms = [`undefined`, `defined`, `hole`, `defined`] as const
    for (const [index, form] of forms.entries()) {
      const expected = sparseArrayValues(spec, form)
      sync.begin()
      sync.write({ type: `update`, value: row(form) })
      sync.commit()
      if (query) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      const snapshot = observer.getSnapshot()
      // Check independently received values before proceeding to the next write.
      oracleAssertion(`checkSparsePublication:1916`, () =>
        expect([...source.keys()], `source membership`).toEqual([`a`]),
      )
      oracleAssertion(`checkSparsePublication:1917`, () =>
        expect([...mirror.keys()], `change-message membership`).toEqual([`a`]),
      )
      oracleAssertion(`checkSparsePublication:1918`, () =>
        expect(
          rows(snapshot).map((value) => value.id),
          `snapshot membership`,
        ).toEqual([`a`]),
      )
      oracleAssertion(`checkSparsePublication:1922`, () =>
        expect(
          [...snapshot.state!.keys()],
          `snapshot state membership`,
        ).toEqual([`a`]),
      )
      const observations = [
        source.get(`a`)!.payload,
        mirror.get(`a`)!.payload,
        rows(snapshot)[0]!.payload,
        snapshot.state!.get(`a`)!.payload,
      ]
      const errors: Array<unknown> = []
      for (const actual of observations) {
        try {
          oracleAssertion(`sparse publication positions`, () =>
            checkSparseArray(actual, expected, carrier),
          )
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length)
        throw new AggregateError(
          errors,
          `sparse publication ${index}: ${errors.map(String).join(`; `)}`,
          { cause: errors[0] },
        )
      if (index === 0) {
        oracleAssertion(`checkSparsePublication:1946`, () =>
          expect(snapshot.data, `equivalent array values keep data`).toBe(
            previous.data,
          ),
        )
        oracleAssertion(`checkSparsePublication:1949`, () =>
          expect(snapshot.state, `equivalent array values keep state`).toBe(
            previous.state,
          ),
        )
        reach.reach(`hole-undefined`)
      } else {
        oracleAssertion(`checkSparsePublication:1954`, () =>
          expect(snapshot.data, `changed array value replaces data`).not.toBe(
            previous.data,
          ),
        )
        reach.reach(form === `hole` ? `defined-hole` : `hole-defined`)
      }
      retained.push({ snapshot, values: expected })
      previous = snapshot
    }
    for (const { snapshot, values } of retained) {
      oracleAssertion(`retained sparse data`, () =>
        checkSparseArray(rows(snapshot)[0]!.payload, values, carrier),
      )
      oracleAssertion(`retained sparse state`, () =>
        checkSparseArray(snapshot.state!.get(`a`)!.payload, values, carrier),
      )
    }
  } catch (error) {
    failure = {
      error: new Error(
        `${projected ? `query` : `source`}/${mode}/${attached ? `attached` : `detached`}/${carrier}: ${String(error)}`,
        { cause: error },
      ),
    }
  }
  await finishHistory(
    [
      () => stop?.(),
      () => subscription.unsubscribe(),
      () => observer.dispose(),
      () => query?.cleanup(),
      () => source.cleanup(),
    ],
    failure,
  )
}
declareOracle({ check: [checkSparsePublication] })
describe(`array value publication`, () => {
  oracleProperty<SparseArrayCase, Verdict>({
    id: `live-query-observer.sparse-array`,
    law: {
      statement: `Hole/undefined neighbors retain row containers, while defined positional changes publish to every source and observer receiver without changing retained snapshots.`,
      authority: `The shared sparse-array value law and positional model in sparse-array-value-oracle.ts.`,
      limits: `The existing one-to-five-position grammar, three carriers, both modes and direct/projected attached/detached receivers; no provider or framework scheduling claim.`,
    },
    histories: {
      arbitrary: sparseArrayCase,
      runs: 20,
      fixedSeeds: [234603],
      states: sparseReceivingStates,
      constructed: [
        {
          name: `array value transitions in every receiving path`,
          enters: sparseReceivingStates,
          build: (generated) => generated,
        },
      ],
    },
    model: recordedAssertionJudgment,
    driver: (spec, observe) =>
      recordSnapshotJudgment(
        `sparse-array publication`,
        spec,
        observe,
        sparseReceivingStates,
        async (reach) => {
          const results = await Promise.allSettled(
            sparseArrayCarriers.flatMap((carrier) =>
              ([`granular`, `wholesale`] as const).flatMap((mode) =>
                [false, true].flatMap((projected) =>
                  [false, true].map((attached) =>
                    checkSparsePublication(
                      spec,
                      carrier,
                      mode,
                      projected,
                      attached,
                      reach,
                    ),
                  ),
                ),
              ),
            ),
          )
          const errors = results.flatMap((result) =>
            result.status === `rejected` ? [result.reason] : [],
          )
          if (errors.length)
            throw new AggregateError(
              errors,
              `sparse receiving paths: ${errors.map(String).join(`; `)}`,
              { cause: errors[0] },
            )
        },
      ),
    check: forwardAssertionJudgment,
  })
})
