/**
 * # Does every joined pair keep its own result row?
 *
 * Law and source: the live-query guide defines joins like SQL joins that
 * combine matching rows into single result rows, and gives a join result a
 * composite key of the parent keys (`docs/guides/live-queries.md`, "Joins" and
 * the `getKey` option). A joined live-query Collection therefore publishes one
 * row for each matching pair of source rows, plus one row for each unmatched
 * row a left or full join keeps, and two distinct pairs never share a key. The
 * guide does not fix the key's format. The compiler used to join the two source
 * keys with a comma, so keys that contain delimiters, or a number and a string
 * that print alike, could collide and drop or reject a valid row.
 *
 * Model: `expectedPairs` recomputes the pair set with nested loops over plain
 * arrays. It does not import the compiler or its key encoding.
 *
 * History grammar: left and right rows draw keys from a domain of plain,
 * comma-bearing, bracket-bearing, and quoted strings, numbers alongside the
 * strings that print the same, and both infinities. Rows join on a small group value. Each
 * history uses an inner, left, or full join, then applies up to three synced
 * group changes to either side.
 *
 * Production driver: two `mockSyncCollectionOptions` Collections and a public
 * `createLiveQueryCollection` join that selects both keys.
 *
 * Refinement check: after preload and after each synced change, the published
 * rows equal the model's pair multiset, and the result key count equals the
 * row count.
 *
 * Calibration: the fixed pair (`a,b`, `c`) versus (`a`, `b,c`) and the pair
 * (1, `c`) versus (`1`, `c`) collided under the comma encoding; restoring it
 * fails both pinned histories and both campaigns. Plain `JSON.stringify`
 * printed `Infinity` and `-Infinity` as `null`; restoring it fails the pinned
 * infinity history and both campaigns.
 *
 * Known omissions: `NaN` source keys, joins over subqueries, more than two
 * sources, custom `getKey`, and optimistic mutations are outside this owner.
 * The mock sync source is a controlled provider; this oracle claims only the
 * compiler's keying of the rows it supplies, not any real adapter's behavior.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import {
  oraclePropertyOptions,
  oracleRuns,
  readOracleRunConfig,
} from '../oracle-config.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

const property = `join-result-key.pairs`
const requestedReplayProperty = readOracleRunConfig().replayProperty

type Key = string | number
type Row = { id: Key; g: number }
type JoinType = `inner` | `left` | `full`
type Change = { side: `left` | `right`; index: number; g: number }
type History = {
  join: JoinType
  left: Array<Row>
  right: Array<Row>
  changes: Array<Change>
}

// Keys that a delimiter-joined encoding cannot tell apart, plus infinite
// numbers, which JSON prints as `null`, the missing-side marker. `NaN` keys
// fail before key encoding matters and are outside this owner.
const keyDomain: ReadonlyArray<Key> = [
  `a`,
  `b`,
  `c`,
  `a,b`,
  `b,c`,
  `[a`,
  `b]`,
  `"a"`,
  1,
  `1`,
  2,
  `2`,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
]

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

type Pair = { l: Key | undefined; r: Key | undefined }

// Nested-loop join over the current rows.
function expectedPairs(
  join: JoinType,
  left: ReadonlyArray<Row>,
  right: ReadonlyArray<Row>,
): Array<string> {
  const pairs: Array<Pair> = []
  const matchedRight = new Set<Row>()
  for (const l of left) {
    const matches = right.filter((r) => r.g === l.g)
    for (const r of matches) {
      pairs.push({ l: l.id, r: r.id })
      matchedRight.add(r)
    }
    if (matches.length === 0 && join !== `inner`) {
      pairs.push({ l: l.id, r: undefined })
    }
  }
  if (join === `full`) {
    for (const r of right) {
      if (!matchedRight.has(r)) pairs.push({ l: undefined, r: r.id })
    }
  }
  return pairs.map(describePair).sort()
}

function describePair({ l, r }: Pair): string {
  const side = (key: Key | undefined) =>
    key === undefined ? `-` : `${typeof key}:${String(key)}`
  return `${side(l)} | ${side(r)}`
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const rowsArbitrary = fc.uniqueArray(
  fc.record({
    id: fc.constantFrom(...keyDomain),
    g: fc.integer({ min: 0, max: 2 }),
  }),
  { selector: (row) => `${typeof row.id}:${String(row.id)}`, maxLength: 5 },
)

const historyArbitrary: fc.Arbitrary<History> = fc.record({
  join: fc.constantFrom<JoinType>(`inner`, `left`, `full`),
  left: rowsArbitrary,
  right: rowsArbitrary,
  changes: fc.array(
    fc.record({
      side: fc.constantFrom<Change[`side`]>(`left`, `right`),
      index: fc.nat({ max: 4 }),
      g: fc.integer({ min: 0, max: 2 }),
    }),
    { maxLength: 3 },
  ),
})

// Under the comma encoding, (`a,b`, `c`) and (`a`, `b,c`) share `[a,b,c]`,
// and (1, `c`) and (`1`, `c`) share `[1,c]`. Under plain JSON, (`a`, Infinity)
// and (`a`, -Infinity) share `["a",null]`, and so do the unmatched right rows
// once `a` moves away.
const pinnedHistories: ReadonlyArray<History> = [
  {
    join: `inner`,
    left: [
      { id: `a,b`, g: 1 },
      { id: `a`, g: 1 },
    ],
    right: [
      { id: `c`, g: 1 },
      { id: `b,c`, g: 1 },
    ],
    changes: [{ side: `right`, index: 0, g: 2 }],
  },
  {
    join: `left`,
    left: [
      { id: 1, g: 1 },
      { id: `1`, g: 1 },
    ],
    right: [{ id: `c`, g: 1 }],
    changes: [{ side: `right`, index: 0, g: 0 }],
  },
  {
    join: `full`,
    left: [{ id: `a`, g: 1 }],
    right: [
      { id: Number.POSITIVE_INFINITY, g: 1 },
      { id: Number.NEGATIVE_INFINITY, g: 1 },
    ],
    changes: [{ side: `left`, index: 0, g: 0 }],
  },
]

// ---------------------------------------------------------------------------
// Production driver and refinement check
// ---------------------------------------------------------------------------

let collectionSerial = 0

async function runHistory(history: History): Promise<void> {
  const serial = collectionSerial++
  const leftRows = history.left.map((row) => ({ ...row }))
  const rightRows = history.right.map((row) => ({ ...row }))
  const left = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `join-key-left-${serial}`,
      getKey: (row) => row.id,
      initialData: leftRows.map((row) => ({ ...row })),
    }),
  )
  const right = createCollection(
    mockSyncCollectionOptions<Row>({
      id: `join-key-right-${serial}`,
      getKey: (row) => row.id,
      initialData: rightRows.map((row) => ({ ...row })),
    }),
  )
  const live = createLiveQueryCollection((q) =>
    q
      .from({ l: left })
      .join({ r: right }, ({ l, r }) => eq(l.g, r.g), history.join)
      .select(({ l, r }) => ({ l: l.id, r: r.id })),
  )
  const check = (checkpoint: string) => {
    const published = live.toArray
      .map((row) => describePair({ l: row.l, r: row.r }))
      .sort()
    expect(published, checkpoint).toEqual(
      expectedPairs(history.join, leftRows, rightRows),
    )
    expect(live.size, `${checkpoint} key count`).toBe(published.length)
  }
  await withOracleCleanup(async () => {
    await live.preload()
    check(`after preload`)
    for (const [step, change] of history.changes.entries()) {
      const rows = change.side === `left` ? leftRows : rightRows
      const collection = change.side === `left` ? left : right
      const target = rows[change.index % Math.max(rows.length, 1)]
      if (!target || target.g === change.g) continue
      collection.utils.begin()
      collection.utils.write({
        type: `update`,
        value: { id: target.id, g: change.g },
      })
      collection.utils.commit()
      target.g = change.g
      check(`after change ${step}`)
    }
  }, [
    () => live.cleanup(),
    () => Promise.all([left.cleanup(), right.cleanup()]),
  ])
}

describe(`joined result key oracle`, () => {
  if (requestedReplayProperty === undefined) {
    for (const history of pinnedHistories) {
      it(`keeps every ${history.join} join pair for ${history.left
        .map((row) => JSON.stringify(row.id))
        .join(` `)}`, () => runHistory(history))
    }

    fcTest.prop([historyArbitrary], {
      seed: 44_501_962,
      numRuns: oracleRuns(80),
    })(`publishes one row per joined pair (fixed)`, runHistory)

    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `publishes one row per joined pair (random)`,
      runHistory,
    )
  } else if (requestedReplayProperty === property) {
    fcTest.prop([historyArbitrary], oraclePropertyOptions(80, property))(
      `publishes one row per joined pair (replay)`,
      runHistory,
    )
  } else {
    it.skip(`runs only when its replay property is selected`, () => {})
  }
})
