import { fc } from '@fast-check/vitest'
import { BTreeIndex } from '../src/indexes/btree-index.js'
import { ReverseIndex } from '../src/indexes/reverse-index.js'
import { PropRef } from '../src/query/ir.js'
import { differs, oracleProperty, pass, violation } from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import type {
  ConstructedHistory,
  Observation,
  Verdict,
} from './oracle-config.js'

/**
 * # Does a reversed index read in its query's order, in bounded work?
 *
 * A query whose direction is opposite to an index's reads that index through
 * `ReverseIndex`. The index and the query share their null placement, so
 * reversing the index alone would move nullish values to the wrong end. The
 * reader puts them back (`findIndexForField`).
 *
 * Two laws hold for every read:
 *
 * - **Order:** `takeFromStart(n)` returns the first `n` accepted keys in the
 *   query's order, and `take(n, from)` returns the first `n` accepted keys
 *   whose value comes strictly after `from` in that order. The null and
 *   `undefined` values form one group at the query's null end. A cursor at
 *   `null` is past that group. Inside a group of equal values, the reader
 *   returns nullish keys in ascending key order and non-null keys in
 *   descending key order (the reversed index walk). Callers that need a
 *   different tie order resolve ties with their own boundary request.
 * - **Work:** a read calls the filter on non-null keys only up to its `n`-th
 *   accepted key in that order. It may call the filter once on each nullish
 *   key, because the reader gathers the whole nullish group on each read.
 *   Large nullish groups are rare in ordered windows, so the reader keeps
 *   that cost for simpler code; it is not bounded by `n`.
 *
 * The model is a plain array of `[key, value]` pairs, sorted here by the order
 * above. It shares no code with the index. The grammar crosses the index's
 * direction and null placement, values `null`, `undefined` and 0..4, read
 * sizes 0..6, cursors at every value and at `null`, and a filter that rejects
 * a generated key subset. A fixed witness checks the work law at 5,000
 * nullish keys.
 *
 * Two further laws bound what the reader may assume:
 *
 * - **Legacy reversal:** `new ReverseIndex(index)` without a null placement
 *   is the reader `@tanstack/db` exported before query-aware placement. It
 *   reads the original index's reversed walk unchanged, so its nullish group
 *   sits wherever plain reversal puts it, for BTree and Basic indexes and for
 *   either null placement of the original. The fixed keys below are the
 *   results of the earlier release.
 * - **Capability:** ordered-query admission requires only range operations
 *   (`supports('gt')`). The reader may use the `equalityLookup` every index
 *   implements, but not an `eq` lookup the index does not advertise. A public
 *   witness orders a collection through an index that advertises only range
 *   operations.
 */

type Value = number | null | undefined
type Entry = [key: number, value: Value]
type Options = { direction: `asc` | `desc`; nulls: `first` | `last` }

function makeReader(entries: ReadonlyArray<Entry>, options: Options) {
  const index = new BTreeIndex<number>(1, new PropRef([`value`]), undefined, {
    compareOptions: { ...options, stringSort: `locale` },
  })
  for (const [key, value] of entries) index.add(key, { value })
  // The query runs opposite to the index and shares its null placement.
  return new ReverseIndex(index, options.nulls === `first`)
}

/** The query's order: reversed direction, same null end. */
function modelOrder(
  entries: ReadonlyArray<Entry>,
  options: Options,
): Array<Entry> {
  const queryDirection = options.direction === `asc` ? -1 : 1
  const nullish = entries
    .filter(([, value]) => value == null)
    .sort(([left], [right]) => left - right)
  const values = entries
    .filter(([, value]) => value != null)
    .sort(
      ([leftKey, left], [rightKey, right]) =>
        queryDirection * ((left as number) - (right as number)) ||
        rightKey - leftKey,
    )
  return options.nulls === `first`
    ? [...nullish, ...values]
    : [...values, ...nullish]
}

function after(order: Array<Entry>, from: Value, options: Options) {
  const queryDirection = options.direction === `asc` ? -1 : 1
  if (from == null) {
    return options.nulls === `first`
      ? order.filter(([, value]) => value != null)
      : []
  }
  return order.filter(([, value]) =>
    value == null
      ? options.nulls === `last`
      : queryDirection * (value - from) > 0,
  )
}

/** Expected keys and the most non-null filter calls the work law allows. */
function expectedRead(stream: Array<Entry>, n: number, rejected: Set<number>) {
  const keys: Array<number> = []
  let calls = 0
  for (const [key, value] of stream) {
    if (keys.length >= n) break
    if (value != null) calls++
    if (!rejected.has(key)) keys.push(key)
  }
  return { keys, calls }
}

type ReadCase = {
  options: Options
  entries: Array<Entry>
  n: number
  cursor: { from: Value } | undefined
  rejected: Array<number>
}

// Construction requirements are test-only provenance, not index state.
const constructionRequirements = new WeakMap<ReadCase, ReadonlyArray<string>>()

// The pinned framework checks only seeded construction identities. Associate
// every generated and shrunk output with its obligation as well. Fresh objects
// keep builders distinct without changing the legal read grammar.
function requireConstructionReach(
  constructions: ReadonlyArray<ConstructedHistory<ReadCase>>,
): ReadonlyArray<ConstructedHistory<ReadCase>> {
  return constructions.map((construction) => ({
    ...construction,
    build: (history: ReadCase) => {
      const built = { ...construction.build(history) }
      constructionRequirements.set(built, [...construction.enters])
      return built
    },
  }))
}

// The model predicts the query stream and bounds only the work the contract
// promises. The shared check also enforces each construction's entry claims
// against the driver's observations, including fresh generated constructions.
function modelRead(history: ReadCase) {
  const { options, entries, n, cursor, rejected } = history
  const order = modelOrder(entries, options)
  const stream = cursor ? after(order, cursor.from, options) : order
  return {
    ...expectedRead(stream, n, new Set(rejected)),
    requiredStates: constructionRequirements.get(history) ?? [],
  }
}

type ReadObservation = {
  keys: Array<number>
  calls: number
  mostNullishCalls: number
}

// Read through the actual public index reader. Count calls before applying the
// filter, so rejection cannot hide extra work. The read-return cut owns both
// the keys and callback counts.
function driveRead(
  { options, entries, n, cursor, rejected }: ReadCase,
  observe: (checkpoint: string, value: unknown) => void,
): void {
  const reader = makeReader(entries, options)
  const rejectedKeys = new Set(rejected)
  const nullishKeys = new Set(
    entries.filter(([, value]) => value == null).map(([key]) => key),
  )
  let calls = 0
  let rejectedCalls = 0
  const nullishCalls = new Map<number, number>()
  const filter = (key: number) => {
    if (nullishKeys.has(key)) {
      nullishCalls.set(key, (nullishCalls.get(key) ?? 0) + 1)
    } else {
      calls++
    }
    if (rejectedKeys.has(key)) rejectedCalls++
    return !rejectedKeys.has(key)
  }
  const keys = cursor
    ? reader.take(n, cursor.from, filter)
    : reader.takeFromStart(n, filter)
  observe(`read returned`, {
    keys,
    calls,
    mostNullishCalls: Math.max(0, ...nullishCalls.values()),
  } satisfies ReadObservation)
  observe(`reach`, `${options.direction} index, nulls ${options.nulls}`)
  observe(`reach`, cursor ? `cursor read` : `start read`)
  if (cursor && cursor.from == null) {
    observe(`reach`, `nullish cursor`)
    if (options.nulls === `first` && n > 0)
      observe(`reach`, `nullish cursor before values`)
  }
  if (cursor && cursor.from != null) observe(`reach`, `numeric cursor`)
  if (n === 0) observe(`reach`, `zero read`)
  if (rejectedCalls > 0) observe(`reach`, `filter rejection`)
  if (
    entries.some(([, value]) => value == null) &&
    entries.some(([, value]) => value != null)
  )
    observe(`reach`, `mixed value groups`)
}

// The same named judgment serves generated histories and the large fixed
// replays. Preserve each upper bound separately from exact row order.
function checkRead(
  _history: ReadCase,
  trace: ReadonlyArray<Observation>,
  expected: ReturnType<typeof modelRead>,
): Verdict {
  for (const { checkpoint, value } of trace) {
    if (checkpoint !== `read returned`) continue
    const actual = value as ReadObservation
    const result =
      differs(checkpoint, `order`, actual.keys, expected.keys) ??
      differs(
        checkpoint,
        `non-null work`,
        actual.calls <= expected.calls,
        true,
        `${actual.calls} non-null filter calls exceed ${expected.calls}`,
      ) ??
      differs(
        checkpoint,
        `nullish work`,
        actual.mostNullishCalls <= 1,
        true,
        `${actual.mostNullishCalls} filter calls on one nullish key exceed 1`,
      ) ??
      pass
    if (result.kind === `violation`) return result
    const reached = new Set(
      trace
        .filter((entry) => entry.checkpoint === `reach`)
        .map((entry) => entry.value),
    )
    const missing = expected.requiredStates.filter(
      (state) => !reached.has(state),
    )
    // This completion check must not outrank a driver failure after its read.
    // An unrecorded checkpoint preserves that failure as the primary error.
    return missing.length === 0
      ? pass
      : violation(
          `constructed states`,
          `constructed history did not enter ${missing.join(`, `)}`,
          `constructed reach`,
        )
  }
  return violation(`read returned`, `the reader did not return`, `order`)
}

const value: fc.Arbitrary<Value> = fc.oneof(
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: fc.constant(undefined) },
  { weight: 4, arbitrary: fc.integer({ min: 0, max: 4 }) },
)

const readCase: fc.Arbitrary<ReadCase> = fc.record({
  options: fc.record({
    direction: fc.constantFrom(`asc` as const, `desc` as const),
    nulls: fc.constantFrom(`first` as const, `last` as const),
  }),
  // Key uniqueness expresses the same language without a dependent chain.
  // Its membership check can then validate and shrink constructed histories.
  entries: fc.uniqueArray(fc.tuple(fc.integer({ min: 0, max: 15 }), value), {
    maxLength: 12,
    selector: ([key]) => key,
  }),
  n: fc.integer({ min: 0, max: 6 }),
  cursor: fc.option(fc.record({ from: value }), { nil: undefined }),
  rejected: fc.uniqueArray(fc.integer({ min: 0, max: 15 }), { maxLength: 6 }),
})

// What this oracle owns: the gap report judges every function in
// reverse-index.ts by this file's tests.
declareOracle({
  owns: [`src/indexes/reverse-index.ts`],
  check: [checkRead],
  model: [modelOrder, after, expectedRead, modelRead],
  grammar: [readCase],
})

// The four large regressions have a separate finite grammar. They retain the
// same model, driver, and named judgments, and supply no generated reach.
oracleProperty({
  id: `reverse-index.large-reads`,
  law: {
    statement: `A reversed index preserves exact query order and bounded non-null filter work when a read crosses a large nullish group.`,
    authority: `The IndexReader.take/takeFromStart and query-aware null-placement contract stated above.`,
    limits: `Four finite histories: ascending physical index, both null placements, 10,000 rows with 5,000 nullish keys, n=50, from the start or cursor 5001.`,
    owner: `Ordered acquisition`,
  },
  histories: ([`first`, `last`] as const).flatMap((nulls) =>
    [undefined, { from: 5001 }].map((cursor): ReadCase => ({
      options: { direction: `asc`, nulls },
      entries: Array.from({ length: 10_000 }, (_, key) => [
        key,
        key % 2 === 0 ? null : key,
      ]),
      n: 50,
      cursor,
      rejected: [],
    })),
  ),
  label: ({ options, cursor }) =>
    `50 keys among 5,000 nullish keys, nulls ${options.nulls}, ${cursor ? `cursor` : `start`}`,
  model: modelRead,
  driver: driveRead,
  check: checkRead,
})

// Randomized constructions force each query direction/null placement, both
// entry points, both cursor kinds, an empty requested prefix, and a rejected
// key. All builders stay inside the original 12-row grammar; fixed large
// regressions do not satisfy these states.
function mixedGroups(history: ReadCase): ReadCase {
  const first = history.rejected[0] ?? history.n
  const second = (first + 1) % 16
  return {
    ...history,
    entries: [
      [first, null],
      [second, history.n % 5],
      ...history.entries
        .filter(([key]) => key !== first && key !== second)
        .slice(0, 10),
    ],
  }
}

oracleProperty({
  id: `reverse-index.reads`,
  law: {
    statement: `A reversed index returns the query's ordered prefix or strict cursor suffix and bounds filter calls to the accepted non-null prefix plus one call per nullish key.`,
    authority: `IndexReader.take/takeFromStart and findIndexForField's query-aware null placement; the ordered-acquisition coverage owner.`,
    limits: `Generated keys 0..15, values null/undefined/0..4, 0..12 rows, n=0..6; large fixed replays use a separate bounded domain. The query-aware reader, not legacy reversal or a custom index's capability admission.`,
    owner: `Ordered acquisition`,
  },
  histories: {
    arbitrary: readCase,
    runs: 200,
    fixedSeeds: [2045],
    states: [
      `asc index, nulls first`,
      `asc index, nulls last`,
      `desc index, nulls first`,
      `desc index, nulls last`,
      `start read`,
      `cursor read`,
      `nullish cursor`,
      `nullish cursor before values`,
      `numeric cursor`,
      `zero read`,
      `filter rejection`,
      `mixed value groups`,
    ],
    constructed: requireConstructionReach([
      {
        name: `nullish cursor continues into values`,
        enters: [
          `cursor read`,
          `nullish cursor`,
          `nullish cursor before values`,
        ],
        build: (history): ReadCase => ({
          ...mixedGroups(history),
          options: { ...history.options, nulls: `first` },
          cursor: { from: null },
          n: Math.max(1, history.n),
        }),
      },
      ...([`asc`, `desc`] as const).flatMap((direction) =>
        ([`first`, `last`] as const).map((nulls) => ({
          name: `${direction} index with nulls ${nulls}`,
          enters: [
            `${direction} index, nulls ${nulls}`,
            `start read`,
            `mixed value groups`,
          ],
          build: (history: ReadCase): ReadCase => ({
            ...mixedGroups(history),
            options: { direction, nulls },
            cursor: undefined,
            n: Math.max(1, history.n),
          }),
        })),
      ),
      {
        name: `nullish cursor`,
        enters: [`cursor read`, `nullish cursor`],
        build: (history) => ({ ...history, cursor: { from: null } }),
      },
      {
        name: `numeric cursor`,
        enters: [`cursor read`, `numeric cursor`],
        build: (history) => ({ ...history, cursor: { from: history.n % 5 } }),
      },
      {
        name: `zero read`,
        enters: [`zero read`],
        build: (history) => ({ ...history, n: 0 }),
      },
      {
        name: `filter rejection`,
        enters: [`start read`, `filter rejection`, `mixed value groups`],
        build: (history) => {
          const mixed = mixedGroups(history)
          return {
            ...mixed,
            cursor: undefined,
            n: Math.max(1, mixed.n),
            rejected: mixed.entries.map(([key]) => key).slice(0, 6),
            entries: mixed.entries.slice(0, 6),
          }
        },
      },
    ]),
  },
  model: modelRead,
  driver: driveRead,
  check: checkRead,
  calibrations: [
    {
      name: `omits a constructed state's observation`,
      law: `constructed reach`,
      corrupt: (trace, history) => {
        const state = modelRead(history).requiredStates[0]
        return state === undefined
          ? undefined
          : trace.filter(
              (entry) => entry.checkpoint !== `reach` || entry.value !== state,
            )
      },
    },
    {
      name: `returns an unaccepted key`,
      law: `order`,
      corrupt: (trace) =>
        trace.map((entry) => {
          if (entry.checkpoint !== `read returned`) return entry
          const actual = entry.value as ReadObservation
          return { ...entry, value: { ...actual, keys: [...actual.keys, -1] } }
        }),
    },
    {
      name: `too many non-null filter calls`,
      law: `non-null work`,
      corrupt: (trace, history) =>
        trace.map((entry) =>
          entry.checkpoint === `read returned`
            ? {
                ...entry,
                value: {
                  ...(entry.value as ReadObservation),
                  calls: modelRead(history).calls + 1,
                },
              }
            : entry,
        ),
    },
    {
      name: `repeats a nullish filter call`,
      law: `nullish work`,
      corrupt: (trace) =>
        trace.some(
          ({ checkpoint, value: observation }) =>
            checkpoint === `read returned` &&
            (observation as ReadObservation).mostNullishCalls > 0,
        )
          ? trace.map((entry) =>
              entry.checkpoint === `read returned`
                ? {
                    ...entry,
                    value: {
                      ...(entry.value as ReadObservation),
                      mostNullishCalls: 2,
                    },
                  }
                : entry,
            )
          : undefined,
    },
  ],
})
