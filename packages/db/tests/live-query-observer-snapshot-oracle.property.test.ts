import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient } from '../src/client.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { Query, createLiveQueryCollection } from '../src/query/index.js'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { createOracleReach } from './oracle-reach.js'
import { finishHistory } from './observer-history-cleanup.js'
import {
  checkSparseArray,
  makeSparseArray,
  sparseArrayCarriers,
  sparseArrayCase,
  sparseArrayValues,
} from './sparse-array-value-oracle.js'
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
    // Both views expose the captured row values in the same order.
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
  reach: ReturnType<typeof createOracleReach<ContainerReach>>,
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
      expect(after.status, `step ${index}: status`).toBe(`ready`)
      expect(after.isSyncError, `step ${index}: sync error`).toBe(
        failures.length > 0,
      )
      expect(after.health?.hasErrors, `step ${index}: health`).toBe(
        failures.length > 0,
      )
      expect(
        after.health?.failureReason?.errors.map((error) => error.cause) ?? [],
        `step ${index}: reported failures`,
      ).toEqual(failures)
      reach.reach(stop ? `attached` : `detached`)
      if (step === `write`) {
        expect(read.data, `value writes replace data`).not.toBe(beforeRead.data)
        expect(read.state, `value writes replace state`).not.toBe(
          beforeRead.state,
        )
        if (beforeRead.state?.has(`a`)) reach.reach(`value-only`)
      } else {
        expect(read.data, `metadata keeps data`).toBe(beforeRead.data)
        expect(read.state, `metadata keeps state`).toBe(beforeRead.state)
        if (after.status !== before.status) reach.reach(`status-only`)
        if (after.status === before.status && after.health !== before.health) {
          reach.reach(`health-only`)
          observedHealthOnly++
        }
        if (after.status !== before.status || after.health !== before.health)
          expect(after).not.toBe(before)
        else {
          // Ownership and repeated metadata actions change no public fact.
          // The full-snapshot contract therefore preserves identity too.
          expect(after, `no-op keeps snapshot`).toBe(before)
          reach.reach(`noop-${scenario.mode}`)
        }
      }
      if (step !== `write` || hadRow)
        expect(after.layoutRevision, `unchanged ordered keys`).toBe(
          before.layoutRevision,
        )
      else
        expect(after.layoutRevision, `new key changes layout`).toBeGreaterThan(
          before.layoutRevision,
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
    expect(
      observedHealthOnly,
      `health-only transitions exclude readiness`,
    ).toBe(expectedHealthOnly)
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
  for (const campaign of [`fixed`, `random`] as const) {
    oracleReplayTest(
      it,
      ...(campaign === `fixed`
        ? []
        : [`live-query-observer.row-container-sharing`]),
    )(`reuses rows across metadata changes (${campaign})`, async () => {
      const reach = createOracleReach<ContainerReach>(
        `live-query-observer.row-container-sharing`,
        [
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
        ],
        { fixedHistories: examples.length },
      )
      // fast-check 3 emits examples before generated histories. A failed
      // campaign throws before aggregate reach; path replay disables it.
      let histories = 0
      await fc.assert(
        fc.asyncProperty(containerHistory, async (scenario) => {
          reach.beginHistory({ fixed: histories++ < examples.length })
          await checkContainerHistory(scenario, reach)
        }),
        {
          ...oraclePropertyOptions(
            40,
            `live-query-observer.row-container-sharing`,
            { examples },
          ),
          ...(campaign === `fixed` ? { seed: 1101 } : {}),
        },
      )
      reach.assertReached()
      process.stdout.write(
        `observer row-container sharing ${campaign}: ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
    })
  }
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
  reach: ReturnType<typeof createOracleReach<CapturePathReach>>,
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
      expect(after.status, `query is ready`).toBe(`ready`)
      expect(after.isSyncError, `query health follows reports`).toBe(hasErrors)
      expect(after.health?.hasErrors, `query health tree is fresh`).toBe(
        hasErrors,
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
        expect(read.state, `changed query rows replace state`).not.toBe(
          beforeRead.state,
        )
        expect(read.data, `changed query rows replace data`).not.toBe(
          beforeRead.data,
        )
      } else {
        expect(read.state, `unchanged query rows keep state`).toBe(
          beforeRead.state,
        )
        expect(read.data, `unchanged query rows keep data`).toBe(
          beforeRead.data,
        )
        if (after.health === before.health)
          expect(after, `query no-op keeps snapshot`).toBe(before)
        else {
          expect(after, `query metadata replaces snapshot`).not.toBe(before)
          reach.reach(`metadata-${scenario.shape}-${scenario.mode}`)
        }
      }
      if (keysChanged) {
        expect(after.layoutRevision, `query layout advances`).toBeGreaterThan(
          before.layoutRevision,
        )
        if (query._stateRevision === revision)
          reach.reach(
            `layout-only-${scenario.mode}-${stop ? `attached` : `detached`}`,
          )
      } else
        expect(after.layoutRevision, `query layout stays`).toBe(
          before.layoutRevision,
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
      const reach = createOracleReach<CapturePathReach>(
        `capture-discard-replay`,
        [
          `ordered-granular`,
          `initial-detached-granular`,
          `discarded-write-granular-detached`,
          `discarded-move-granular-detached`,
          `layout-only-granular-detached`,
        ],
      )
      reach.beginHistory()
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
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(
      it,
      ...(campaign === `fixed` ? [] : [`live-query-observer.capture-paths`]),
    )(`checks query capture boundaries (${campaign})`, async () => {
      const reach = createOracleReach<CapturePathReach>(
        `live-query-observer.capture-paths`,
        [
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
        ],
        { fixedHistories: examples.length },
      )
      let histories = 0
      await fc.assert(
        fc.asyncProperty(capturePathHistory, async (scenario) => {
          reach.beginHistory({ fixed: histories++ < examples.length })
          await checkCapturePathHistory(scenario, reach)
        }),
        {
          ...oraclePropertyOptions(40, `live-query-observer.capture-paths`, {
            examples,
          }),
          ...(campaign === `fixed` ? { seed: 2346 } : {}),
        },
      )
      reach.assertReached()
      process.stdout.write(
        `observer capture paths ${campaign}: ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
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
  expect(
    [Object.prototype, ShapePayload.prototype, null],
    `authored prototype`,
  ).toContain(prototype)
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
  reach: ReturnType<typeof createOracleReach<PayloadReach>>,
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
    expect(
      payloadObservation(data[0]!.payload, scenario.carrier),
      `${label}: data shape and value`,
    ).toEqual(spec)
    expect(
      payloadObservation(snapshot.state!.get(`a`)!.payload, scenario.carrier),
      `${label}: state shape and value`,
    ).toEqual(spec)
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
        expect(after.data, `shape/value changes replace data`).not.toBe(
          before.data,
        )
        expect(after.state, `shape/value changes replace state`).not.toBe(
          before.state,
        )
      } else {
        expect(after.data, `same rows keep data`).toBe(before.data)
        expect(after.state, `same rows keep state`).toBe(before.state)
      }
      if (stop && scenario.mode === `granular`) {
        expect([...granular.keys()], `granular membership`).toEqual([`a`])
        expect(
          payloadObservation(granular.get(`a`)!.payload, scenario.carrier),
          `granular agrees with snapshot shape and value`,
        ).toEqual(model)
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
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(
      it,
      ...(campaign === `fixed` ? [] : [`live-query-observer.record-shape`]),
    )(`compares authored shape at every read (${campaign})`, async () => {
      const reach = createOracleReach<PayloadReach>(
        `live-query-observer.record-shape`,
        [
          `source-granular`,
          `source-wholesale`,
          `query-granular`,
          `query-wholesale`,
          `plain-class`,
          `class-plain`,
          `plain-null`,
          `same-shape-copy`,
          ...payloadCarriers,
        ],
        { fixedHistories: examples.length },
      )
      let histories = 0
      await fc.assert(
        fc.asyncProperty(payloadHistory, async (scenario) => {
          reach.beginHistory({ fixed: histories++ < examples.length })
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
        }),
        {
          ...oraclePropertyOptions(40, `live-query-observer.record-shape`, {
            examples,
          }),
          ...(campaign === `fixed` ? { seed: 234602 } : {}),
        },
      )
      reach.assertReached()
      process.stdout.write(
        `observer record shape ${campaign}: ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
      )
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
  reach: ReturnType<
    typeof createOracleReach<(typeof sparseReceivingStates)[number]>
  >,
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
  const observer = createLiveQueryObserver(query ?? source, { mode })
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
  const retained: Array<{
    snapshot: LiveQuerySnapshot<SparseRow, string | number>
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
      expect([...source.keys()], `source membership`).toEqual([`a`])
      expect([...mirror.keys()], `change-message membership`).toEqual([`a`])
      expect(
        snapshot.data!.map((value) => value.id),
        `snapshot membership`,
      ).toEqual([`a`])
      expect([...snapshot.state!.keys()], `snapshot state membership`).toEqual([
        `a`,
      ])
      const observations = [
        source.get(`a`)!.payload,
        mirror.get(`a`)!.payload,
        snapshot.data![0]!.payload,
        snapshot.state!.get(`a`)!.payload,
      ]
      const errors: Array<unknown> = []
      for (const actual of observations) {
        try {
          checkSparseArray(actual, expected, carrier)
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
        expect(snapshot.data, `equivalent array values keep data`).toBe(
          previous.data,
        )
        expect(snapshot.state, `equivalent array values keep state`).toBe(
          previous.state,
        )
        reach.reach(`hole-undefined`)
      } else {
        expect(snapshot.data, `changed array value replaces data`).not.toBe(
          previous.data,
        )
        reach.reach(form === `hole` ? `defined-hole` : `hole-defined`)
      }
      retained.push({ snapshot, values: expected })
      previous = snapshot
    }
    for (const { snapshot, values } of retained) {
      checkSparseArray(snapshot.data![0]!.payload, values, carrier)
      checkSparseArray(snapshot.state!.get(`a`)!.payload, values, carrier)
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
  for (const campaign of [`fixed`, `random`] as const)
    oracleReplayTest(
      it,
      ...(campaign === `fixed` ? [] : [`live-query-observer.sparse-array`]),
    )(
      `publishes changed array positions to every receiver (${campaign})`,
      async () => {
        const reach = createOracleReach(
          `live-query-observer.sparse-array`,
          sparseReceivingStates,
        )
        await fc.assert(
          fc.asyncProperty(sparseArrayCase, async (spec) => {
            reach.beginHistory()
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
          }),
          {
            ...oraclePropertyOptions(20, `live-query-observer.sparse-array`),
            ...(campaign === `fixed` ? { seed: 234603 } : {}),
          },
        )
        reach.assertReached()
        process.stdout.write(
          `observer sparse array ${campaign}: ${JSON.stringify(Object.fromEntries(reach.counts()))}\n`,
        )
      },
    )
})
