import { types as nativeTypes } from 'node:util'
import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect } from 'vitest'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleAssertion } from '../../db/tests/oracle-assertion-adapter'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import { readOfflineOracleConfig } from './oracle-config'
import type { OfflineTransaction } from '../src/types'

/**
 * # Does an offline transaction survive durable serialization exactly?
 *
 * Contract and source: SerializedOfflineTransaction and the offline persistence
 * contract preserve mutation meaning across process boundaries. Encoding v3
 * supports JSON trees, Date, and the eight restorable Temporal scalar types.
 * Opt-in v4 records delegate mutation payloads to their identified codec.
 * Default v3 metadata and mutation behavior stays unchanged.
 * Marker-shaped user objects remain data. Unversioned and v2 records retain
 * their prior meanings. Unsupported or malformed encodings fail visibly.
 *
 * Model: each generated Pair derives runtime and wire values from one semantic
 * leaf. It never walks production output or imports serializer helpers. Mutation
 * values deliberately retain the package's structural encoding rules. Focused
 * single-case witnesses for metadata toJSON, boxed scalars, cycles, Temporal
 * markers, and malformed wire are unit tests in transaction-serializer.test.ts.
 *
 * History grammar: insert, update, and delete edits span two collection registry
 * keys. Trees contain bounded arrays, objects, hostile keys, Date values, and
 * date-like strings. Separate histories cover unversioned, v2, and v3 records,
 * metadata replacements, Temporal constructors, and corrupted wire markers.
 *
 * Production driver and refinement check: real Collections create mutations.
 * TransactionSerializer writes the record. New Collection identities then read
 * it through the same registry keys. Each checkpoint compares the wire tree,
 * decoded transaction fields, registry binding, order, errors, and retained
 * storage after a failed read.
 * The application-restart model recreates the serializer and Collections over
 * retained wire records. It simulates process recreation without starting another
 * process or restarting an existing Collection's sync run. Seed/path replay is
 * oracle replay of a recorded failure.
 *
 * Reach and controls: fixed histories force every edit kind and hostile marker.
 * Fixed and random campaigns support seed/path replay. Encoder and decoder faults
 * inject Date/string confusion, wrong registry, omitted changes, and unknown
 * versions. Malformed generated markers are rejected before durable data can
 * be replaced; the single-case Temporal failure paths are unit tests.
 *
 * Limits for default v3: undefined, non-finite numbers, arbitrary native
 * objects, and cross-realm boxed values are outside that domain's evidence. Cycles must fail
 * visibly while repeated non-cyclic references retain their values. This
 * oracle does not claim byte stability for object key order beyond JSON's
 * established rules. Temporal witnesses install controlled constructors;
 * they do not establish behavior with a native or polyfill Temporal runtime.
 * Retained-storage checks use FakeStorageAdapter, not browser storage.
 */

type Value =
  | null
  | boolean
  | number
  | string
  | Date
  | Array<Value>
  | { [key: string]: Value }
type Pair = { runtime: Value; wire: Value }
type Row = { id: string; revision: number; payload: Value }
type Edit = {
  kind: `insert` | `update` | `delete`
  slot: number
  before: Pair
  after: Pair
}
type Fault =
  | `none`
  | `date-as-string`
  | `string-as-date`
  | `wrong-registry`
  | `omit-changes`
  | `unknown-encoding`

const serializerLaw = {
  authority: `SerializedOfflineTransaction and the offline persistence contract`,
  limits: `The existing bounded value grammar, controlled Temporal constructors and FakeStorageAdapter; no native storage or cross-realm promise.`,
}
// A recipe transports the existing independently authored runtime/wire Pair.
// Tags distinguish Date, bigint, binary and own undefined without changing any
// object key or using the production serializer to build the expected value.
type HistoryValue =
  | { type: `date`; value: number }
  | { type: `bigint`; value: string }
  | { type: `number`; value: string }
  | { type: `undefined` }
  | { type: `bytes`; value: Array<number> }
  | { type: `array`; value: Array<HistoryValue> }
  | { type: `object`; value: Array<[string, HistoryValue]> }
  | { type: `scalar`; value: null | boolean | number | string }
function encodeHistory(value: unknown): HistoryValue {
  if (value instanceof Date) return { type: `date`, value: value.getTime() }
  if (typeof value === `bigint`) return { type: `bigint`, value: String(value) }
  if (value === undefined) return { type: `undefined` }
  if (
    typeof value === `number` &&
    (!Number.isFinite(value) || Object.is(value, -0))
  )
    return {
      type: `number`,
      value: Object.is(value, -0) ? `-0` : String(value),
    }
  if (nativeTypes.isArrayBuffer(value))
    return { type: `bytes`, value: [...new Uint8Array(value)] }
  if (Array.isArray(value))
    return { type: `array`, value: value.map(encodeHistory) }
  if (value !== null && typeof value === `object`)
    return {
      type: `object`,
      value: Object.entries(value).map(([key, field]) => [
        key,
        encodeHistory(field),
      ]),
    }
  return { type: `scalar`, value: value as null | boolean | number | string }
}
function decodeHistory<T>(history: HistoryValue): T {
  const read = (value: HistoryValue): unknown => {
    switch (value.type) {
      case `date`:
        return new Date(value.value)
      case `bigint`:
        return BigInt(value.value)
      case `undefined`:
        return undefined
      case `number`:
        return value.value === `-0` ? -0 : Number(value.value)
      case `bytes`:
        return Uint8Array.from(value.value).buffer
      case `array`:
        return value.value.map(read)
      case `object`:
        return Object.fromEntries(
          value.value.map(([key, field]) => [key, read(field)]),
        )
      case `scalar`:
        return value.value
    }
  }
  return read(history) as T
}

// Construct both representations from semantic leaves, not production output.
const datePair = (time: number): Pair => ({
  runtime: new Date(time),
  wire: { __type: `Date`, value: new Date(time).toISOString() },
})
const scalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .filter((value) => !Object.is(value, -0)),
  fc.string({ maxLength: 30 }),
)
const leaf: fc.Arbitrary<Pair> = fc.oneof(
  scalar.map(
    (value) => ({ runtime: value, wire: value }),
    (pair) => (pair as Pair).runtime as null | boolean | number | string,
  ),
  fc
    .integer({ min: -2000000000000, max: 2000000000000 })
    .map(datePair, (pair) => ((pair as Pair).runtime as Date).getTime()),
  fc.integer({ min: -2000000000000, max: 2000000000000 }).map(
    (time) => {
      const value = new Date(time).toISOString()
      return { runtime: value, wire: value }
    },
    (pair) => Date.parse((pair as Pair).runtime as string),
  ),
)
function tree(depth: number): fc.Arbitrary<Pair> {
  if (depth === 0) return leaf
  const child = tree(depth - 1)
  return fc.oneof(
    leaf,
    fc.tuple(fc.constantFrom(`Date`, `Object`), child).map(
      ([tag, value]) => ({
        runtime: { __type: tag, value: value.runtime },
        wire: { __type: `Object`, value: { __type: tag, value: value.wire } },
      }),
      (input) => {
        const pair = input as Pair
        const runtime = pair.runtime as {
          __type: `Date` | `Object`
          value: Value
        }
        const wire = pair.wire as { value: { value: Value } }
        return [
          runtime.__type,
          { runtime: runtime.value, wire: wire.value.value },
        ] as const
      },
    ),
    fc.array(child, { maxLength: 3 }).map(
      (items) => ({
        runtime: items.map((item) => item.runtime),
        wire: items.map((item) => item.wire),
      }),
      (input) => {
        const pair = input as Pair
        return (pair.runtime as Array<Value>).map((runtime, index) => ({
          runtime,
          wire: (pair.wire as Array<Value>)[index]!,
        }))
      },
    ),
    fc
      .dictionary(
        fc.oneof(
          fc.constantFrom(
            `__proto__`,
            `constructor`,
            `toString`,
            `left`,
            `date`,
            `__type`,
          ),
          fc.string({ maxLength: 12 }),
        ),
        child,
        { maxKeys: 3 },
      )
      .map(
        (fields) => ({
          runtime: Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, value.runtime]),
          ),
          wire: objectWire(
            Object.fromEntries(
              Object.entries(fields).map(([key, value]) => [key, value.wire]),
            ),
          ),
        }),
        (input) => {
          const pair = input as Pair
          const runtime = pair.runtime as Record<string, Value>
          const wire = (
            Object.hasOwn(runtime, `__type`)
              ? (pair.wire as { value: Value }).value
              : pair.wire
          ) as Record<string, Value>
          return Object.fromEntries(
            Object.entries(runtime).map(([key, value]) => [
              key,
              { runtime: value, wire: wire[key]! },
            ]),
          )
        },
      ),
  )
}

function objectWire(fields: { [key: string]: Value }): Value {
  return Object.hasOwn(fields, `__type`)
    ? { __type: `Object`, value: fields }
    : fields
}

// Model law: v3 wire values escape marker-shaped objects exactly once. The
// expected tree is built from semantic Pairs, independently of production.
async function checkRoundtrip(
  edits: Array<Edit>,
  time: number,
  fault: Fault = `none`,
  boundary: `encoder` | `decoder` = `encoder`,
  legacy = false,
  versionTwo = false,
  injectCleanupFailure = false,
) {
  const row = (index: number, revision: number, payload: Value): Row => ({
    id: `row:${index}`,
    revision,
    payload,
  })
  const writers = [0, 1].map((slot) =>
    createCollection<Row>({
      id: `writer:${slot}`,
      getKey: (item) => item.id,
      startSync: true,
      sync: {
        sync: ({ begin, write, commit, markReady }) => {
          begin()
          edits.forEach((edit, index) => {
            if (edit.slot === slot && edit.kind !== `insert`)
              write({
                type: `insert`,
                value: row(index, 0, edit.before.runtime),
              })
          })
          commit()
          markReady()
        },
      },
    }),
  )
  // Application restart uses fresh Collection objects and IDs, but the same
  // registry keys.
  const readers = [0, 1].map((slot) =>
    createCollection<Row>({
      id: `reader:${slot}`,
      getKey: (item) => item.id,
      sync: { sync: ({ markReady }) => markReady() },
    }),
  )
  const registry = (collections: typeof writers) =>
    Object.fromEntries(
      collections.map((collection, slot) => [`slot:${slot}`, collection]),
    )
  const serializer = new TransactionSerializer(registry(writers))
  const transaction = createTransaction({
    autoCommit: false,
    mutationFn: async () => {},
  })
  const rollback = transaction.when(`settled`).catch(() => undefined)
  let hasPrimaryFailure = false
  let primaryFailure: unknown
  try {
    transaction.mutate(() => {
      edits.forEach((edit, index) => {
        const collection = writers[edit.slot]!
        if (edit.kind === `insert`)
          collection.insert(row(index, 1, edit.after.runtime))
        else if (edit.kind === `delete`) collection.delete(`row:${index}`)
        else
          collection.update(`row:${index}`, (draft) => {
            draft.revision = 1 // Even equal payloads produce a real mutation.
            draft.payload = edit.after.runtime
          })
      })
    })
    oracleAssertion(`mutation wire and restored meaning`, () =>
      expect(transaction.mutations).toHaveLength(edits.length),
    )
    const envelope = {
      id: `offline`,
      mutationFnName: `persist`,
      keys: transaction.mutations.map((mutation) => mutation.globalKey),
      idempotencyKey: `once`,
      retryCount: 2,
      nextAttemptAt: 123,
      version: 1 as const,
      metadata: { note: `2024-01-01T00:00:00.000Z` },
      lastError: { name: `Error`, message: `retry`, stack: `original stack` },
    }
    const offline: OfflineTransaction = {
      ...envelope,
      createdAt: new Date(time),
      mutations: transaction.mutations,
    }
    const data = (edit: Edit, index: number, form: keyof Pair) => {
      const original =
        edit.kind === `insert` ? {} : row(index, 0, edit.before[form])
      const modified =
        edit.kind === `delete` ? original : row(index, 1, edit.after[form])
      // Update tracking may omit an unchanged payload. Read the field presence
      // from the input mutation; the serializer's law is preserving its data,
      // not independently specifying the core mutation-composition contract.
      const changes =
        edit.kind !== `update`
          ? modified
          : {
              revision: 1,
              ...(`payload` in transaction.mutations[index]!.changes
                ? { payload: edit.after[form] }
                : {}),
            }
      return { original, modified, changes }
    }
    const expectedWire = {
      ...envelope,
      valueEncoding: 3,
      createdAt: new Date(time).toISOString(),
      mutations: edits.map((edit, index) => ({
        globalKey: transaction.mutations[index]!.globalKey,
        type: edit.kind,
        collectionId: `slot:${edit.slot}`,
        ...data(edit, index, `wire`),
      })),
    }
    const corrupt = (input: string) => {
      let encoded = input
      if (fault === `date-as-string`)
        encoded = encoded.replace(
          // Mutate the semantic payload, not a Date-shaped user object inside
          // an Object escape: the latter would test malformed wire instead.
          /("payload":)\{"__type":"Date","value":"([^"]+)"\}/g,
          `$1"$2"`,
        )
      if (fault === `string-as-date`)
        encoded = encoded.replace(
          `"payload":"2024-01-01T00:00:00.000Z"`,
          `"payload":{"__type":"Date","value":"2024-01-01T00:00:00.000Z"}`,
        )
      if (fault === `wrong-registry`)
        encoded = encoded.replace(
          `"collectionId":"slot:0"`,
          `"collectionId":"writer:0"`,
        )
      if (fault === `omit-changes`)
        encoded = encoded.replaceAll(`"changes":`, `"lostChanges":`)
      if (fault === `unknown-encoding`)
        encoded = encoded.replace(`"valueEncoding":3`, `"valueEncoding":5`)
      return encoded
    }
    const serialized = serializer.serialize(offline)
    const encoded = boundary === `encoder` ? corrupt(serialized) : serialized
    oracleAssertion(`mutation wire and restored meaning`, () =>
      expect(JSON.parse(encoded), `mutation wire checkpoint`).toEqual(
        expectedWire,
      ),
    )
    const fresh = new TransactionSerializer(registry(readers))
    // Also decode independently constructed wire data, so two matching wrong
    // halves cannot establish the format's compatibility by roundtrip alone.
    // Decoder calibration starts with authored wire, not a faulty encoder.
    // A Date/string swap is valid wire: the semantic oracle must reject its
    // changed meaning; the decoder itself need not throw.
    const wires =
      boundary === `decoder`
        ? [corrupt(JSON.stringify(expectedWire))]
        : [encoded, JSON.stringify(expectedWire)]
    if (legacy) {
      const { valueEncoding: _encoding, ...oldWire } = expectedWire
      wires.push(JSON.stringify(oldWire))
    }
    if (versionTwo)
      wires.push(JSON.stringify({ ...expectedWire, valueEncoding: 2 }))
    for (const wire of wires) {
      const decoded = fresh.deserialize(wire)
      const { mutations, ...rest } = decoded
      oracleAssertion(`mutation wire and restored meaning`, () =>
        expect(rest).toEqual({ ...envelope, createdAt: new Date(time) }),
      )
      oracleAssertion(`mutation wire and restored meaning`, () =>
        expect(mutations).toHaveLength(edits.length),
      )
      edits.forEach((edit, index) => {
        const mutation = mutations[index]!
        oracleAssertion(`mutation wire and restored meaning`, () =>
          expect(mutation.collection).toBe(readers[edit.slot]),
        )
        oracleAssertion(`mutation wire and restored meaning`, () =>
          expect(mutation.key).toBe(`row:${index}`),
        )
        oracleAssertion(`mutation wire and restored meaning`, () =>
          expect(mutation.globalKey).toBe(
            transaction.mutations[index]!.globalKey,
          ),
        )
        oracleAssertion(`mutation wire and restored meaning`, () =>
          expect(mutation.type).toBe(edit.kind),
        )
        oracleAssertion(`mutation wire and restored meaning`, () =>
          expect({
            original: mutation.original,
            modified: mutation.modified,
            changes: mutation.changes,
          }).toEqual(data(edit, index, `runtime`)),
        )
      })
    }
  } catch (error) {
    hasPrimaryFailure = true
    primaryFailure = error
  }
  let cleanupFailure: unknown
  try {
    await cleanupOfflineOracle(
      [
        () => {
          transaction.rollback()
        },
        () => rollback,
        ...[...writers, ...readers].map(
          (collection) => () => collection.cleanup(),
        ),
        ...(injectCleanupFailure
          ? [
              () => {
                throw new Error(`injected serializer cleanup failure`)
              },
            ]
          : []),
      ],
      false,
    )
  } catch (error) {
    cleanupFailure = error
  }
  if (hasPrimaryFailure) {
    if (cleanupFailure !== undefined)
      throw new AggregateError(
        cleanupFailure instanceof AggregateError
          ? cleanupFailure.errors
          : [cleanupFailure],
        `Serializer oracle failed and cleanup also failed`,
        { cause: primaryFailure },
      )
    throw primaryFailure
  }
  if (cleanupFailure !== undefined) throw cleanupFailure
}

// The check runs one history through production and compares every checkpoint
// with the semantic model above. Generated properties, fixed histories, and the
// fault calibrations all reach it.
// What this oracle owns: the gap report judges these entries, and their
// reference trees within the package, by this file's tests.
declareOracle({
  owns: [
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
    `src/outbox/OutboxManager.ts#OutboxManager.add`,
    `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
    `src/outbox/OutboxManager.ts#OutboxManager.get`,
  ],
  check: [checkRoundtrip],
})

const twin: Pair = {
  runtime: `2024-01-01T00:00:00.000Z`,
  wire: `2024-01-01T00:00:00.000Z`,
}

const fixedHistory: Array<Edit> = [
  { kind: `insert`, slot: 1, before: twin, after: { runtime: 0.5, wire: 0.5 } },
  { kind: `insert`, slot: 0, before: twin, after: datePair(1704067200000) },
  { kind: `update`, slot: 1, before: datePair(0), after: twin },
  { kind: `delete`, slot: 0, before: datePair(1), after: twin },
  ...([`insert`, `update`, `delete`] as const).map((kind): Edit => {
    const runtime = { __type: `Date`, value: `2024-01-01T00:00:00.000Z` }
    const pair = { runtime, wire: objectWire(runtime) }
    return { kind, slot: 0, before: pair, after: pair }
  }),
  ...([`insert`, `update`, `delete`] as const).map((kind): Edit => {
    const runtime = Object.fromEntries([[`__proto__`, { nested: 1 }]])
    const wire = Object.fromEntries([[`__proto__`, { nested: 1 }]])
    return {
      kind,
      slot: 0,
      before: { runtime, wire },
      after: { runtime, wire },
    }
  }),
]
// Grammar controls: the fixed history is a legal ten-edit reconstruction of
// every edit kind, both registry slots, Date/string twins, marker escapes, and
// an own __proto__ key. Dropping one of those axes loses a distinct wire or
// application-restart observation. Generated trees add empty and nested arrays
// and objects with depth two and at most three children or keys. Current records
// admit zero edits, while compatibility records start at one. Cycles and malformed
// markers are outside this valid-tree grammar and have rejection witnesses
// above. The generated edit bound includes the complete fixed history. A
// never-escape rule fails its marker-shaped user object; an always-escape rule
// fails its ordinary object with an own __proto__ key at the wire checkpoint.
// This package's test root is separate from core's named fixed-history portfolio.
// Keep a local replay entry point rather than importing files outside rootDir.
// Each random campaign is its own replay property, because a recorded path
// belongs to one generator. Its fixed campaign and its random campaign share one
// generator, budget, and assertion set.
const MUTATION_WIRE_PROPERTY = `offline.serializer.mutation-wire`
const DATE_MARKER_PROPERTY = `offline.serializer.date-marker`
const VERSION_TWO_PROPERTY = `offline.serializer.version-two`
const mutationWireOracle = readOfflineOracleConfig({
  property: MUTATION_WIRE_PROPERTY,
  defaultRuns: 100,
})
const mutationEdits = fc.array(
  fc.record({
    kind: fc.constantFrom<Edit[`kind`]>(`insert`, `update`, `delete`),
    slot: fc.integer({ min: 0, max: 1 }),
    before: tree(2),
    after: tree(2),
  }),
  { maxLength: fixedHistory.length },
)
const mutationTime = fc.integer({
  min: -2000000000000,
  max: 2000000000000,
})
const mutationMeaningProperty = (fault: Fault = `none`) =>
  fc.asyncProperty(mutationEdits, mutationTime, (edits, time) =>
    checkRoundtrip(edits, time, fault),
  )

export {
  checkRoundtrip,
  datePair,
  objectWire,
  twin,
  fixedHistory,
  mutationEdits,
  mutationTime,
  mutationMeaningProperty,
  mutationWireOracle,
  serializerLaw,
  encodeHistory,
  decodeHistory,
  leaf,
  tree,
  MUTATION_WIRE_PROPERTY,
  DATE_MARKER_PROPERTY,
  VERSION_TWO_PROPERTY,
}
export type { Row, Pair, Edit, HistoryValue }
