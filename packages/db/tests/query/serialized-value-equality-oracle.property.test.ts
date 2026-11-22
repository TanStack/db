/**
 * # Do value classes with `toJSON()` compare by value in queries?
 *
 * Law and source: a class instance that defines `toJSON()` and is not one of
 * the built-in value types (Date, Temporal, binary data) is a value. Query
 * equality compares two such instances by their serialized value, so `eq`,
 * exact index lookups, live-query `where` clauses and join conditions match a
 * distinct instance that serializes to the same value. A plain value equal to
 * that serialization stays unequal, and query identity and
 * `getStableValueHash` follow the same relation. Authority: issue #2459 and
 * the "Value classes" section of `docs/guides/live-queries.md`.
 *
 * A Map, Set or ArrayBuffer is a built-in value even when a subclass defines
 * `toJSON()`: it keeps its built-in rule, comparing by reference, so it never
 * equals a value class that serializes alike. Authority: the same section's
 * built-in rule, which names these types.
 *
 * Why an example can miss the failure: a probe that is the stored instance
 * matches under reference equality too, an index can agree with a scan until
 * the instance that represents a group of equal values leaves it, and a join
 * can match through one side's index while the other side compares
 * references.
 *
 * Model: `modelEq` compares record references by their table and ID fields.
 * It never calls `toJSON()` and imports no query normalization. A text value
 * spelled like a record reference is a different kind, and null is UNKNOWN.
 * A built-in carrier (a Map, Set or ArrayBuffer subclass whose `toJSON()`
 * spells a record reference) compares by reference, and every materialized
 * value is a fresh instance, so it equals nothing.
 *
 * History grammar: up to four source rows and three join rows hold a record
 * reference, its text look-alike, a built-in carrier look-alike, or null, over
 * two tables and two IDs. The
 * source has no index, a BasicIndex, or a BTreeIndex. Up to three synced
 * updates follow; a weighted one replaces a row's reference with a distinct
 * equal instance, so an index must keep a group when its first instance
 * leaves. Every row, update and probe builds a fresh instance, so no match
 * can come from reference identity.
 *
 * Production driver: `currentStateAsChanges({ where })` before and after the
 * index is created (an index spy confirms the indexed route), a live-query
 * Collection filtered by `eq` against the probe, and an inner join of the
 * source with the join rows on their references, read after the initial load
 * and after every update. Query identity, demand keys and
 * `getStableValueHash` are read for two distinct equal probes.
 *
 * Refinement check: every read returns exactly the model's keys or pairs, and
 * the identities of equal probes are equal, while a record probe's identity
 * differs from its text look-alike's. A built-in carrier spelled like the
 * probe never matches it, in a scan, an index, a filter or a join, and sorts
 * as its own run.
 *
 * Known omissions: ordering by a value class, `inArray`, on-demand and
 * persisted sources, exact-output (`select`) identity, which keeps reference
 * semantics, and classes whose `toJSON()` throws or returns a non-JSON value.
 */
import { fc } from '@fast-check/vitest'
import { describe, expect, vi } from 'vitest'
import { createCollection } from '../../src/collection/index.js'
import { BasicIndex } from '../../src/indexes/basic-index.js'
import { BTreeIndex } from '../../src/indexes/btree-index.js'
import { Query, getQueryIR } from '../../src/query/builder/index.js'
import { createLiveQueryCollection, eq } from '../../src/query/index.js'
import {
  getLoadSubsetDemandKey,
  getQueryIdentity,
  getStableValueHash,
} from '../../src/query/ir-stable-identity.js'
import { Func, PropRef, Value } from '../../src/query/ir.js'
import { DEFAULT_COMPARE_OPTIONS } from '../../src/utils.js'
import { oracleProperty } from '../oracle-config.js'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../oracle-assertion-adapter.js'
import { mockSyncCollectionOptions, withOracleCleanup } from '../utils.js'

const property = `serialized-value.query-equality`

const reachStates = [
  // A row matched a probe that is a distinct, equal instance.
  `distinct-instance-matched`,
  // An update replaced a matching reference with a distinct equal instance
  // while an index held it.
  `indexed-equal-replacement`,
  // A join matched references held by two Collections.
  `join-matched`,
  // An ordered read held two distinct, equal record references.
  `ordered-equal-run`,
  // A source row held a built-in carrier spelled like a record probe.
  `builtin-lookalike-held`,
] as const
type ReachState = (typeof reachStates)[number]

type Table = `user` | `org`
type RefSpec =
  | { kind: `record`; table: Table; id: `a` | `b` }
  | { kind: `text`; table: Table; id: `a` | `b` }
  | { kind: `builtin`; carrier: Carrier; table: Table; id: `a` | `b` }
  | { kind: `null` }
type Carrier = `Map` | `Set` | `ArrayBuffer`
type IndexMode = `none` | `basic` | `btree`
type History = {
  rows: Array<RefSpec>
  joinRows: Array<RefSpec>
  index: IndexMode
  // `sameValue` replaces the row's current value with a distinct, equal
  // instance; otherwise the row takes `value`. `row` wraps to the rows.
  updates: Array<{ row: number; value: RefSpec; sameValue: boolean }>
  probe: Extract<RefSpec, { kind: `record` | `text` }>
}

/** A record reference shaped like the `surrealdb` SDK's `RecordId`. */
class RecordRef {
  readonly table: string
  readonly id: string
  constructor(table: string, id: string) {
    this.table = table
    this.id = id
  }
  toString(): string {
    return `${this.table}:${this.id}`
  }
  toJSON(): string {
    return this.toString()
  }
  equals(other: unknown): boolean {
    return (
      other instanceof RecordRef &&
      other.table === this.table &&
      other.id === this.id
    )
  }
}

// Built-in carriers: subclasses of Map, Set and ArrayBuffer whose toJSON()
// spells a record reference, as RecordRef's does.
class RecordMap extends Map<never, never> {
  readonly ref: string
  constructor(ref: string) {
    super()
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}
class RecordSet extends Set<never> {
  readonly ref: string
  constructor(ref: string) {
    super()
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}
class RecordBuffer extends ArrayBuffer {
  readonly ref: string
  constructor(ref: string) {
    super(0)
    this.ref = ref
  }
  toJSON(): string {
    return this.ref
  }
}

type Row = { id: string; ref: object | string | null }

// ---------------------------------------------------------------------------
// Model
// ---------------------------------------------------------------------------

// `eq` keeps a pair only when TRUE: null is UNKNOWN, a record reference
// equals a record reference with the same table and ID, a text value equals
// the same text, and the two kinds never equal each other. A built-in carrier
// compares by reference and every value here is a fresh instance, so it
// equals nothing.
function modelEq(left: RefSpec, right: RefSpec): boolean {
  if (left.kind === `null` || right.kind === `null`) return false
  if (left.kind === `builtin` || right.kind === `builtin`) return false
  return (
    left.kind === right.kind &&
    left.table === right.table &&
    left.id === right.id
  )
}

function modelKeys(rows: ReadonlyMap<string, RefSpec>, probe: RefSpec) {
  return [...rows]
    .filter(([, value]) => modelEq(value, probe))
    .map(([key]) => key)
    .sort()
}

// Sorting keeps equal values together: each sort class occupies one run. A
// built-in carrier equals only itself, so it is its own class.
function sortClass(spec: RefSpec, key: string): string {
  if (spec.kind === `null`) return `null`
  if (spec.kind === `builtin`) return `builtin:${key}`
  return `${spec.kind}:${spec.table}:${spec.id}`
}

function expectContiguousRuns(
  keys: ReadonlyArray<string>,
  rows: ReadonlyMap<string, RefSpec>,
  label: string,
): void {
  expect([...keys].sort(), `${label}: keys`).toEqual([...rows.keys()].sort())
  const closed = new Set<string>()
  let current: string | undefined
  for (const key of keys) {
    const next = sortClass(rows.get(key)!, key)
    if (next === current) continue
    expect(closed.has(next), `${label}: ${next} split by ${current}`).toBe(
      false,
    )
    if (current !== undefined) closed.add(current)
    current = next
  }
}

function modelPairs(
  rows: ReadonlyMap<string, RefSpec>,
  joinRows: ReadonlyMap<string, RefSpec>,
) {
  const pairs: Array<string> = []
  for (const [left, value] of rows)
    for (const [right, joinValue] of joinRows)
      if (modelEq(value, joinValue)) pairs.push(`${left}|${right}`)
  return pairs.sort()
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

const tableArbitrary = fc.constantFrom<Table>(`user`, `org`)
const idArbitrary = fc.constantFrom<`a` | `b`>(`a`, `b`)
const probeArbitrary = fc.oneof(
  {
    weight: 3,
    arbitrary: fc.record({
      kind: fc.constant(`record` as const),
      table: tableArbitrary,
      id: idArbitrary,
    }),
  },
  fc.record({
    kind: fc.constant(`text` as const),
    table: tableArbitrary,
    id: idArbitrary,
  }),
)
const carrierArbitrary = fc.constantFrom<Carrier>(`Map`, `Set`, `ArrayBuffer`)
const builtinArbitrary = fc.record({
  kind: fc.constant(`builtin` as const),
  carrier: carrierArbitrary,
  table: tableArbitrary,
  id: idArbitrary,
})
const refArbitrary: fc.Arbitrary<RefSpec> = fc.oneof(
  { weight: 6, arbitrary: probeArbitrary },
  { weight: 2, arbitrary: builtinArbitrary },
  fc.record({ kind: fc.constant(`null` as const) }),
)
const historyArbitrary: fc.Arbitrary<History> = fc.record({
  rows: fc.array(refArbitrary, { minLength: 1, maxLength: 4 }),
  joinRows: fc.array(refArbitrary, { maxLength: 3 }),
  index: fc.constantFrom<IndexMode>(`none`, `basic`, `btree`),
  updates: fc.array(
    fc.record({
      row: fc.nat({ max: 3 }),
      value: refArbitrary,
      sameValue: fc.boolean(),
    }),
    { maxLength: 3 },
  ),
  probe: probeArbitrary,
})

// ---------------------------------------------------------------------------
// Production driver
// ---------------------------------------------------------------------------

// Every call builds a fresh instance, so equal references are never the same
// object.
function materialize(spec: RefSpec): object | string | null {
  switch (spec.kind) {
    case `record`:
      return new RecordRef(spec.table, spec.id)
    case `text`:
      return `${spec.table}:${spec.id}`
    case `builtin`: {
      const ref = `${spec.table}:${spec.id}`
      return spec.carrier === `Map`
        ? new RecordMap(ref)
        : spec.carrier === `Set`
          ? new RecordSet(ref)
          : new RecordBuffer(ref)
    }
    case `null`:
      return null
  }
}

function rowKey(index: number) {
  return `r${index}`
}

function joinKey(index: number) {
  return `j${index}`
}

let collectionId = 0

async function runHistory(
  history: History,
  reach: (state: ReachState) => void,
): Promise<void> {
  // Later resources read earlier ones, so they are cleaned up first.
  const cleanups: Array<() => unknown> = []
  const cleanup = (step: () => unknown) => cleanups.unshift(step)
  await withOracleCleanup(async () => {
    const run = collectionId++
    const indexType =
      history.index === `basic`
        ? BasicIndex
        : history.index === `btree`
          ? BTreeIndex
          : undefined
    const model = new Map(
      history.rows.map((spec, index) => [rowKey(index), spec] as const),
    )
    const joinModel = new Map(
      history.joinRows.map((spec, index) => [joinKey(index), spec] as const),
    )
    const source = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `serialized-value-source-${run}`,
        getKey: (row) => row.id,
        initialData: history.rows.map((spec, index) => ({
          id: rowKey(index),
          ref: materialize(spec),
        })),
        autoIndex: `off`,
        ...(indexType === undefined ? {} : { defaultIndexType: indexType }),
      }),
    )
    cleanup(() => source.cleanup())
    const joined = createCollection(
      mockSyncCollectionOptions<Row>({
        id: `serialized-value-join-${run}`,
        getKey: (row) => row.id,
        initialData: history.joinRows.map((spec, index) => ({
          id: joinKey(index),
          ref: materialize(spec),
        })),
        autoIndex: `off`,
      }),
    )
    cleanup(() => joined.cleanup())
    await source.stateWhenReady()
    await joined.stateWhenReady()

    const where = new Func<boolean>(`eq`, [
      new PropRef([`ref`]),
      new Value(materialize(history.probe)),
    ])
    const scanKeys = () =>
      source
        .currentStateAsChanges({ where })!
        .map((change) => String(change.key))
        .sort()

    expect(scanKeys(), `initial scan`).toEqual(modelKeys(model, history.probe))

    const index =
      indexType === undefined ? undefined : source.createIndex((row) => row.ref)
    const lookup = index === undefined ? undefined : vi.spyOn(index, `lookup`)

    const filtered = createLiveQueryCollection({
      id: `serialized-value-filter-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .where(({ item }) => eq(item.ref, materialize(history.probe))),
    })
    cleanup(() => filtered.cleanup())
    const pairs = createLiveQueryCollection({
      id: `serialized-value-pairs-${run}`,
      query: (q) =>
        q
          .from({ item: source })
          .join(
            { other: joined },
            ({ item, other }) => eq(item.ref, other.ref),
            `inner`,
          )
          .select(({ item, other }) => ({
            item: item.id,
            other: other.id,
          })),
    })
    cleanup(() => pairs.cleanup())
    await filtered.preload()
    await pairs.preload()

    const orderedKeys = () =>
      source
        .currentStateAsChanges({
          orderBy: [
            {
              expression: new PropRef([`ref`]),
              compareOptions: DEFAULT_COMPARE_OPTIONS,
            },
          ],
        })!
        .map((change) => String(change.key))

    const check = (checkpoint: string) => {
      const expectedKeys = modelKeys(model, history.probe)
      const expectedPairs = modelPairs(model, joinModel)
      expect(scanKeys(), `${checkpoint}: scan`).toEqual(expectedKeys)
      expectContiguousRuns(orderedKeys(), model, `${checkpoint}: ordered`)
      const recordClasses = [...model.values()]
        .filter((spec) => spec.kind === `record`)
        .map((spec) => sortClass(spec, ``))
      if (new Set(recordClasses).size < recordClasses.length)
        reach(`ordered-equal-run`)
      const probe = history.probe
      if (
        probe.kind === `record` &&
        [...model.values()].some(
          (spec) =>
            spec.kind === `builtin` &&
            spec.table === probe.table &&
            spec.id === probe.id,
        )
      )
        reach(`builtin-lookalike-held`)
      if (lookup !== undefined) {
        lookup.mockClear()
        expect(scanKeys(), `${checkpoint}: indexed scan`).toEqual(expectedKeys)
        expect(lookup, `${checkpoint}: index route`).toHaveBeenCalled()
      }
      expect(
        filtered.toArray.map((row) => row.id).sort(),
        `${checkpoint}: live-query where`,
      ).toEqual(expectedKeys)
      expect(
        pairs.toArray.map((row) => `${row.item}|${row.other}`).sort(),
        `${checkpoint}: join`,
      ).toEqual(expectedPairs)
      if (history.probe.kind === `record` && expectedKeys.length > 0)
        reach(`distinct-instance-matched`)
      if (
        expectedPairs.some((pair) => {
          const [left] = pair.split(`|`)
          return model.get(left!)!.kind === `record`
        })
      )
        reach(`join-matched`)
    }

    check(`initial load`)

    for (const [step, update] of history.updates.entries()) {
      const key = rowKey(update.row % history.rows.length)
      const previous = model.get(key)!
      const value = update.sameValue ? previous : update.value
      if (
        index !== undefined &&
        update.sameValue &&
        modelEq(previous, history.probe)
      )
        reach(`indexed-equal-replacement`)
      model.set(key, value)
      source.utils.begin()
      source.utils.write({
        type: `update`,
        value: { id: key, ref: materialize(value) },
      })
      source.utils.commit()
      check(`update ${step}`)
    }

    // Identity: two distinct, equal probes are one query and one demand,
    // and hash alike; a record probe differs from its text look-alike.
    const queryFor = (value: unknown) =>
      getQueryIR(
        new Query()
          .from({ item: source })
          .where(({ item }) => eq(item.ref, value as never)),
      )
    const demandFor = (value: unknown) =>
      getLoadSubsetDemandKey({
        where: new Func<boolean>(`eq`, [
          new PropRef([`ref`]),
          new Value(value),
        ]),
      })
    const first = materialize(history.probe)
    const second = materialize(history.probe)
    expect(
      getQueryIdentity(queryFor(first)),
      `equal probes: query identity`,
    ).toBe(getQueryIdentity(queryFor(second)))
    expect(demandFor(first), `equal probes: demand key`).toBe(demandFor(second))
    expect(getStableValueHash(first), `equal probes: value hash`).toBe(
      getStableValueHash(second),
    )
    if (history.probe.kind === `record`) {
      const text = materialize({ ...history.probe, kind: `text` })
      expect(
        getQueryIdentity(queryFor(first)),
        `record and text: query identity`,
      ).not.toBe(getQueryIdentity(queryFor(text)))
      expect(getStableValueHash(first), `record and text: value hash`).not.toBe(
        getStableValueHash(text),
      )
    }
  }, cleanups)
}

describe(`value classes compare by their serialized value`, () => {
  oracleProperty({
    id: property,
    law: {
      statement: `Query equality, exact index lookup, live-query filters and joins match distinct class instances whose toJSON() values are equal, never a plain value equal to that serialization; query identity and getStableValueHash follow the same relation. A Map, Set or ArrayBuffer subclass with toJSON() keeps its built-in rule and never equals a value class.`,
      authority: `Issue #2459 and the "Value classes" section of docs/guides/live-queries.md.`,
      limits: `One toJSON() class over two tables and two IDs, its text look-alike, empty Map, Set and ArrayBuffer subclass look-alikes (never probes), and null; up to four source rows, three join rows and three synced updates; no ordering, inArray, on-demand or persisted sources, or exact-output identity.`,
    },
    owns: [
      'src/utils/comparison.ts#normalizeValue',
      'src/utils/comparison.ts#serializedClassValue',
      'src/query/ir-stable-identity.ts#getStableValueHash',
      'src/indexes/basic-index.ts#BasicIndex.lookup',
      'src/indexes/btree-index.ts#BTreeIndex.lookup',
    ],
    histories: {
      arbitrary: historyArbitrary,
      runs: 60,
      fixedSeeds: [2459],
      states: reachStates,
      constructed: [
        {
          name: `an indexed group keeps an equal reference after its first instance is replaced`,
          enters: [
            `distinct-instance-matched`,
            `indexed-equal-replacement`,
            `join-matched`,
            `ordered-equal-run`,
          ],
          build: (generated): History => {
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            return {
              ...generated,
              rows: [probe, probe, ...generated.rows.slice(2)],
              joinRows: [probe, ...generated.joinRows.slice(1)],
              index: generated.index === `basic` ? `basic` : `btree`,
              updates: [
                { row: 0, value: probe, sameValue: true },
                ...generated.updates.slice(0, 2),
              ],
              probe,
            }
          },
        },
        {
          name: `a built-in carrier spelled like the record probe sits among equal records`,
          enters: [
            `builtin-lookalike-held`,
            `distinct-instance-matched`,
            `join-matched`,
            `ordered-equal-run`,
          ],
          build: (generated): History => {
            const probe = {
              kind: `record` as const,
              table: generated.probe.table,
              id: generated.probe.id,
            }
            const carriers: ReadonlyArray<Carrier> = [
              `Map`,
              `Set`,
              `ArrayBuffer`,
            ]
            const lookalike = {
              kind: `builtin` as const,
              carrier: carriers[generated.rows.length % carriers.length]!,
              table: probe.table,
              id: probe.id,
            }
            return {
              ...generated,
              rows: [probe, lookalike, probe, ...generated.rows.slice(3)],
              joinRows: [lookalike, probe, ...generated.joinRows.slice(2)],
              probe,
            }
          },
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan: { history: History }, observe) =>
      recordAssertionJudgment(property, plan, observe, () =>
        runHistory(plan.history, (state) => observe(`reach`, state)),
      ),
    check: forwardAssertionJudgment,
  })
})
