import { fc } from '@fast-check/vitest'
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { DbClient, collectionOptions } from '../src/client.js'
import { getLiveQueryHash } from '../src/live-query-options.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { Query, createLiveQueryCollection } from '../src/query/index.js'
import { createOracleReach } from './oracle-reach.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'

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

// Work probe: an unchanged prepared server revision needs one admission walk,
// and checking row presence must not materialize its lazy keyed view.
it(`reuses server admission without building the lazy state Map`, async () => {
  const client = new DbClient()
  const source = client.collection(
    collectionOptions(`server-work`, () =>
      localOnlyCollectionOptions<Row, string>({
        id: `server-work`,
        getKey: (row) => row.id,
        initialData: [{ id: `a`, version: 1 }],
      }),
    ),
  )
  await source.preload()
  const query = new Query().from({ row: source }).orderBy(({ row }) => row.id)
  const collection = createLiveQueryCollection({ query })
  await collection.preload()
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: getLiveQueryHash({ query }),
  })
  const walk = vi.spyOn(client, `_hasSsrCollectionSnapshot`)
  const snapshot = observer.getSnapshot()
  const state = vi.spyOn(snapshot, `state`, `get`)
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    const first = observer.getServerSnapshot()
    for (let i = 0; i < 10; i++)
      expect(observer.getServerSnapshot()).toBe(first)
    expect(
      walk.mock.calls.length,
      `admit an unchanged revision once`,
    ).toBeLessThanOrEqual(1)
    expect(
      state,
      `row-presence check keeps keyed materialization lazy`,
    ).not.toHaveBeenCalled()
  } finally {
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// Capturing a loading SSR view must not answer a later explicit data preload.
// The real source controls readiness; server capture owns only the initial view.
it(`keeps explicit preload pending after a loading server capture`, async () => {
  let ready = () => {}
  const client = new DbClient()
  const descriptor = collectionOptions(`capture-preload`, () => ({
    id: `capture-preload`,
    getKey: (row: Row) => row.id,
    sync: {
      sync: ({ markReady }) => {
        ready = markReady
      },
    },
  }))
  const source = client.collection(descriptor)
  const query = new Query().from({ row: source })
  const collection = createLiveQueryCollection({ query })
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: getLiveQueryHash({ query }),
  })
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    expect(observer.getServerSnapshot().isReady).toBe(false)
    let settled = false
    const preload = client.preloadLiveQuery({ query }).then(() => {
      settled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(settled, `an initial view is not completed data demand`).toBe(false)
    ready()
    await preload
    expect(settled).toBe(true)
  } finally {
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// A pending stream owns one result promise. Capturing its initial loading view
// must not replace that promise when another preload requests the same data.
it(`retains a pending stream after capturing its loading view`, async () => {
  let ready = () => {}
  const client = new DbClient()
  const descriptor = collectionOptions(`pending-capture`, () => ({
    id: `pending-capture`,
    getKey: (row: Row) => row.id,
    sync: {
      sync: ({ markReady }) => {
        ready = markReady
      },
    },
  }))
  const query = new Query().from({ row: descriptor })
  const hash = getLiveQueryHash({ query })
  const preload = client.preloadLiveQuery({ query })
  const original = client.dehydrate({ shouldDehydrateLiveQuery: () => true })
    .liveQueries![0]!.promise
  const source = client.collection(descriptor)
  const collection = createLiveQueryCollection({
    query: new Query().from({ row: source }),
  })
  const observer = createLiveQueryObserver(collection, {
    client,
    queryHash: hash,
  })
  const browserWindow = globalThis.window
  vi.stubGlobal(`window`, undefined)
  try {
    expect(observer.getServerSnapshot().isReady).toBe(false)
    const peer = client.preloadLiveQuery({ query })
    expect(
      client.dehydrate({ shouldDehydrateLiveQuery: () => true })
        .liveQueries![0]!.promise,
      `initial capture cannot replace the established stream`,
    ).toBe(original)
    ready()
    await Promise.all([preload, peer])
  } finally {
    ready()
    vi.stubGlobal(`window`, browserWindow)
    observer.dispose()
    await collection.cleanup()
    await client.cleanup()
  }
})

// Non-streaming transport remains JSON-compatible. Capturing an initial view
// does not opt its route into promise streaming; opted-in streaming still keeps
// the pending result promise beside the initial snapshot.
it.each([false, true])(
  `captures a pending initial view with streaming=%s`,
  async (streaming) => {
    const client = new DbClient()
    client._setSsrStreamingEnabled(streaming)
    const descriptor = collectionOptions(`pending-json`, () => ({
      id: `pending-json`,
      getKey: (row: Row) => row.id,
      sync: { sync: () => {} },
    }))
    const query = new Query().from({ row: descriptor })
    void client.preloadLiveQuery({ query }).catch(() => {})
    const source = client.collection(descriptor)
    const collection = createLiveQueryCollection({
      query: new Query().from({ row: source }),
    })
    const observer = createLiveQueryObserver(collection, {
      client,
      queryHash: getLiveQueryHash({ query }),
    })
    const browserWindow = globalThis.window
    vi.stubGlobal(`window`, undefined)
    try {
      observer.getServerSnapshot()
      const transported = client.dehydrate().liveQueries![0]!
      expect(transported.snapshot?.status).toBe(`loading`)
      expect(
        transported.promise instanceof Promise,
        `only requested streaming carries a promise`,
      ).toBe(streaming)
    } finally {
      vi.stubGlobal(`window`, browserWindow)
      observer.dispose()
      await collection.cleanup()
      await client.cleanup()
    }
  },
)
