import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient } from '../src/client.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { Query, createLiveQueryCollection } from '../src/query/index.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { createOracleReach } from './oracle-reach.js'
import type { HealthNode } from '../src/types.js'

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
 * visible order is key order. Prepared client seeds are checked only for getter
 * identity. Hydration replacement, persisted status, and framework
 * wiring have other owners. The calibration test feeds the checker a snapshot
 * whose `data` and `state` read the live Collection on first access, the design
 * #1542 proposed, and requires the checker to reject it.
 */

type Row = { id: string; version: number }
type Shape = `ordered` | `single`
type Command =
  | { type: `upsert`; id: string; version: number }
  | { type: `delete`; id: string }
  | { type: `capture` }
type Read = { snapshot: number; dataFirst: boolean }
type Snapshot = ReturnType<ReturnType<typeof setup>[`observer`][`getSnapshot`]>
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
  fc.constant({ type: `capture` as const }),
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
  expect(stateRows, `${label}: state rows`).toEqual(rows)
  expect([...(read.state?.keys() ?? [])], `${label}: state keys`).toEqual(
    rows.map((row) => row.id),
  )
  if (shape === `single`) {
    expect(
      read.data === undefined ? undefined : plain(read.data),
      `${label}: single data`,
    ).toEqual(rows[0])
  } else {
    const data = read.data as ReadonlyArray<Row>
    expect(data.map(plain), `${label}: data rows`).toEqual(rows)
    // Agreement is identity-level: both views list the same row objects.
    expect(data, `${label}: data agrees with state`).toEqual([
      ...(read.state?.values() ?? []),
    ])
  }
  // A snapshot is one value: later reads return the same objects.
  expect(entry.snapshot.state, `${label}: state identity`).toBe(read.state)
  expect(entry.snapshot.data, `${label}: data identity`).toBe(read.data)
  return read
}

async function checkHistory(
  shape: Shape,
  attached: boolean,
  commands: ReadonlyArray<Command>,
  reads: ReadonlyArray<Read>,
  reach?: ReturnType<
    typeof createOracleReach<`server-getter` | `client-getter`>
  >,
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
    expect(
      observer.getServerSnapshot(),
      `server getter preserves an unchanged revision`,
    ).toBe(current)
    expect(
      observer.getSnapshot(),
      `ordinary getter preserves the same revision`,
    ).toBe(current)
    await client.preloadLiveQuery({ query: builder })
    clientObserver = createLiveQueryObserver(query, {
      client,
      queryHash: getLiveQueryHash({ query: builder }),
    })
    const clientSnapshot = clientObserver.getSnapshot()
    reach?.reach(`client-getter`)
    expect(
      clientObserver.getServerSnapshot(),
      `a prepared client server read keeps the shared revision`,
    ).toBe(clientSnapshot)
    expect(
      clientObserver.getSnapshot(),
      `a server read cannot invalidate the ordinary snapshot cache`,
    ).toBe(clientSnapshot)
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
      expect(
        captured[index]!.snapshot.state,
        `snapshot ${index}: state identity after other reads`,
      ).toBe(state)
      expect(
        captured[index]!.snapshot.data,
        `snapshot ${index}: data identity after other reads`,
      ).toBe(data)
      const rows = captured[index]!.rows.slice(0, keep)
      expect(
        [...(state?.values() ?? [])].map(plain),
        `snapshot ${index}: saved state rows`,
      ).toEqual(rows)
      for (const [other, { state: otherState }] of seen) {
        const otherRows = captured[other]!.rows.slice(0, keep)
        if (JSON.stringify(otherRows) !== JSON.stringify(rows))
          expect(otherState, `snapshots ${index} and ${other}`).not.toBe(state)
      }
    }
  } finally {
    clientObserver?.dispose()
    await client.cleanup()
    await cleanup()
  }
}

declareOracle({
  check: [checkRead, checkHistory, checkHealthHistory],
  model: [modelRows],
})

const history = fc.array(command, { minLength: 1, maxLength: 24 })
const reads = fc.array(
  fc.record({ snapshot: fc.nat({ max: 30 }), dataFirst: fc.boolean() }),
  { maxLength: 30 },
)

describe(`retained live-query snapshots are point-in-time`, () => {
  it.each(
    (
      [
        [`ordered`, true],
        [`ordered`, false],
        [`single`, true],
        [`single`, false],
      ] as const
    ).flatMap(([shape, attached]) =>
      ([`fixed`, `random`] as const).map(
        (campaign) => [shape, attached, campaign] as const,
      ),
    ),
  )(
    `first reads match the capture-time rows (%s, attached=%s, %s)`,
    async (shape, attached, campaign) => {
      const reach = createOracleReach(
        `snapshot-${shape}-${attached}-${campaign}`,
        [`server-getter`, `client-getter`],
      )
      const property = fc.asyncProperty(history, reads, (commands, order) => {
        reach.beginHistory()
        return checkHistory(shape, attached, commands, order, reach)
      })
      await fc.assert(
        property,
        campaign === `fixed`
          ? { numRuns: oracleRuns(40), seed: 2043 }
          : oraclePropertyOptions(40, PROPERTY),
      )
      reach.assertReached()
      console.info(
        `snapshot-getter ${shape} ${attached} ${campaign}`,
        Object.fromEntries(reach.counts()),
      )
    },
  )

  it(`reads a snapshot after several newer snapshots were built`, async () => {
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
  { weight: 3, arbitrary: fc.constant({ type: `report` as const }) },
  { weight: 2, arbitrary: fc.constant({ type: `healthy` as const }) },
  {
    weight: 1,
    arbitrary: fc.record({
      type: fc.constant(`write` as const),
      version: fc.integer({ min: 0, max: 9 }),
    }),
  },
  { weight: 2, arbitrary: fc.constant({ type: `subscribe` as const }) },
  { weight: 2, arbitrary: fc.constant({ type: `unsubscribe` as const }) },
  { weight: 4, arbitrary: fc.constant({ type: `read` as const }) },
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
  reach?: ReturnType<typeof createOracleReach<HealthReach>>,
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
        expect(snapshot.status, `${label}: status`).toBe(`ready`)
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
        })
        expect(
          node?.failureReason?.errors.every(
            (failure, at) => failure.cause === failures[at],
          ) ?? true,
          `${label}: each listed failure is the reported value`,
        ).toBe(true)
        expect(snapshot.health?.hasErrors, `${label}: hasErrors`).toBe(problem)
        expect(snapshot.isSyncError, `${label}: isSyncError`).toBe(problem)
        const messages = JSON.stringify(failures.map((f) => f.message))
        if (last !== undefined) {
          if (last.serial === serial)
            expect(snapshot.health, `${label}: unchanged tree identity`).toBe(
              last.tree,
            )
          else if (last.messages !== messages)
            expect(snapshot.health, `${label}: changed tree identity`).not.toBe(
              last.tree,
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
  it(`every read matches the model across attach cuts`, async () => {
    const reach = createOracleReach<HealthReach>(
      `live-query-observer.snapshot-health`,
      [
        `detached-read-after-health-change`,
        `attached-read-after-health-change`,
        `read-across-attach-after-health-change`,
        `unchanged-tree-read`,
        `read-with-several-failures`,
      ],
      { minimum: 5 },
    )
    const property = fc.asyncProperty(
      fc.array(healthCommand, { minLength: 1, maxLength: 24 }),
      async (commands) => {
        reach.beginHistory()
        await checkHealthHistory(commands, reach)
      },
    )
    // Fixed campaign: a repeatable baseline. Seed 695 is arbitrary.
    await fc.assert(property, { numRuns: oracleRuns(80), seed: 695 })
    await fc.assert(property, oraclePropertyOptions(80))
    reach.assertReached()
  })

  it(`shows a health-only change made between a detached read and attach`, async () => {
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
