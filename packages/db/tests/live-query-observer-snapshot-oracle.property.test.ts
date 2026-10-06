import { fc } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { localOnlyCollectionOptions } from '../src/local-only.js'
import { createLiveQueryObserver } from '../src/live-query-observer.js'
import { createLiveQueryCollection } from '../src/query/index.js'
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
 * visible order is key order. Hydration seeds, persisted status, and framework
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
  const query = createLiveQueryCollection({
    startSync: true,
    query: (q) => {
      const ordered = q.from({ row: source }).orderBy(({ row }) => row.id)
      return shape === `single` ? ordered.findOne() : ordered
    },
  })
  const observer = createLiveQueryObserver(query)
  return { source, query, observer }
}

/** Apply a history, retaining every captured snapshot unread. */
function run(
  shape: Shape,
  attached: boolean,
  commands: ReadonlyArray<Command>,
): {
  captured: Array<Captured>
  cleanup: () => Promise<void>
  source: ReturnType<typeof setup>[`source`]
} {
  const { source, query, observer } = setup(shape)
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
): Snapshot[`state`] {
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
  return read.state
}

async function checkHistory(
  shape: Shape,
  attached: boolean,
  commands: ReadonlyArray<Command>,
  reads: ReadonlyArray<Read>,
): Promise<void> {
  const { captured, cleanup } = run(shape, attached, commands)
  try {
    const order =
      reads.length > 0
        ? reads
        : captured.map((_, i) => ({ snapshot: i, dataFirst: true }))
    const seen = new Map<number, Snapshot[`state`]>()
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
    for (const [index, state] of seen) {
      // Every later read of a snapshot returns the map its first read did.
      expect(
        captured[index]!.snapshot.state,
        `snapshot ${index}: state identity after other reads`,
      ).toBe(state)
      const rows = captured[index]!.rows.slice(0, keep)
      expect(
        [...(state?.values() ?? [])].map(plain),
        `snapshot ${index}: saved state rows`,
      ).toEqual(rows)
      for (const [other, otherState] of seen) {
        const otherRows = captured[other]!.rows.slice(0, keep)
        if (JSON.stringify(otherRows) !== JSON.stringify(rows))
          expect(otherState, `snapshots ${index} and ${other}`).not.toBe(state)
      }
    }
  } finally {
    await cleanup()
  }
}

const history = fc.array(command, { minLength: 1, maxLength: 24 })
const reads = fc.array(
  fc.record({ snapshot: fc.nat({ max: 30 }), dataFirst: fc.boolean() }),
  { maxLength: 30 },
)

describe(`retained live-query snapshots are point-in-time`, () => {
  it.each([
    [`ordered`, true],
    [`ordered`, false],
    [`single`, true],
    [`single`, false],
  ] as const)(
    `first reads match the capture-time rows (%s, attached=%s)`,
    async (shape, attached) => {
      const property = fc.asyncProperty(history, reads, (commands, order) =>
        checkHistory(shape, attached, commands, order),
      )
      // Fixed campaign: a repeatable baseline. Seed 2043 is arbitrary.
      await fc.assert(property, { numRuns: oracleRuns(40), seed: 2043 })
      // Random campaign, or a replay of a reported seed and path.
      await fc.assert(property, oraclePropertyOptions(40, PROPERTY))
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
