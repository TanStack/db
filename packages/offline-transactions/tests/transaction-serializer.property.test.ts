import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import { readOfflineOracleConfig } from './oracle-config'
import type { OfflineTransaction } from '../src/types'

/**
 * # Does an offline transaction survive durable serialization exactly?
 *
 * The wire format supports JSON trees plus Date values. User keys that resemble
 * codec markers remain data. Insert, update, and delete mutations retain their
 * original, modified, changes, collection registry, timestamps, and order across
 * restart. Unknown encodings fail rather than creating a zombie transaction.
 *
 * The generator builds semantic runtime and wire pairs from leaves; it never
 * walks a production value with a copy of the serializer. A restarted set of
 * Collections with different object identities decodes the record and replays
 * it. Encoder and decoder fault modes prove Date/string confusion, wrong
 * registry, omitted changes, and unknown versions are observed.
 *
 * Cycles, undefined, non-finite numbers, and arbitrary native objects are
 * outside this declared durable format.
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
  scalar.map((value) => ({ runtime: value, wire: value })),
  fc.integer({ min: -2000000000000, max: 2000000000000 }).map(datePair),
  fc.integer({ min: -2000000000000, max: 2000000000000 }).map((time) => {
    const value = new Date(time).toISOString()
    return { runtime: value, wire: value }
  }),
)
function tree(depth: number): fc.Arbitrary<Pair> {
  if (depth === 0) return leaf
  const child = tree(depth - 1)
  return fc.oneof(
    leaf,
    fc.tuple(fc.constantFrom(`Date`, `Object`), child).map(([tag, value]) => ({
      runtime: { __type: tag, value: value.runtime },
      wire: { __type: `Object`, value: { __type: tag, value: value.wire } },
    })),
    fc.array(child, { maxLength: 3 }).map((items) => ({
      runtime: items.map((item) => item.runtime),
      wire: items.map((item) => item.wire),
    })),
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
      .map((fields) => ({
        runtime: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, value.runtime]),
        ),
        wire: objectWire(
          Object.fromEntries(
            Object.entries(fields).map(([key, value]) => [key, value.wire]),
          ),
        ),
      })),
  )
}

function objectWire(fields: { [key: string]: Value }): Value {
  return Object.hasOwn(fields, `__type`)
    ? { __type: `Object`, value: fields }
    : fields
}

async function checkRoundtrip(
  edits: Array<Edit>,
  time: number,
  fault: Fault = `none`,
  boundary: `encoder` | `decoder` = `encoder`,
  legacy = false,
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
  // A restart has different object and collection IDs, but the same registry keys.
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
  const rollback = transaction.isPersisted.promise.catch(() => undefined)
  let hasPrimaryFailure = false
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
    expect(transaction.mutations).toHaveLength(edits.length)
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
      valueEncoding: 2,
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
        encoded = encoded.replace(`"valueEncoding":2`, `"valueEncoding":3`)
      return encoded
    }
    const serialized = serializer.serialize(offline)
    const encoded = boundary === `encoder` ? corrupt(serialized) : serialized
    expect(JSON.parse(encoded)).toEqual(expectedWire)
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
    for (const wire of wires) {
      const decoded = fresh.deserialize(wire)
      const { mutations, ...rest } = decoded
      expect(rest).toEqual({ ...envelope, createdAt: new Date(time) })
      expect(mutations).toHaveLength(edits.length)
      edits.forEach((edit, index) => {
        const mutation = mutations[index]!
        expect(mutation.collection).toBe(readers[edit.slot])
        expect(mutation.key).toBe(`row:${index}`)
        expect(mutation.globalKey).toBe(transaction.mutations[index]!.globalKey)
        expect(mutation.type).toBe(edit.kind)
        expect({
          original: mutation.original,
          modified: mutation.modified,
          changes: mutation.changes,
        }).toEqual(data(edit, index, `runtime`))
      })
    }
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      [
        () => {
          transaction.rollback()
        },
        () => rollback,
        ...[...writers, ...readers].map(
          (collection) => () => collection.cleanup(),
        ),
      ],
      hasPrimaryFailure,
    )
  }
}

const twin: Pair = {
  runtime: `2024-01-01T00:00:00.000Z`,
  wire: `2024-01-01T00:00:00.000Z`,
}

// Roundtrips generate valid envelopes. Corrupted wire must be rejected before
// it can replace any mutation field with an invented empty object.
it.each([`modified`, `original`, `changes`] as const)(
  `rejects malformed escaped objects anywhere in %s`,
  async (field) => {
    const collection = createCollection<Row>({
      getKey: (row) => row.id,
      sync: { sync: ({ markReady }) => markReady() },
    })
    const serializer = new TransactionSerializer({ rows: collection })
    try {
      fc.assert(
        fc.property(
          fc.constantFrom(undefined, null, 1, `text`, false, []),
          fc.array(fc.boolean(), { maxLength: 4 }),
          (invalid, containers) => {
            let payload: unknown =
              invalid === undefined
                ? { __type: `Object` }
                : { __type: `Object`, value: invalid }
            for (const array of containers)
              payload = array ? [payload] : { child: payload }
            const mutation = {
              globalKey: `rows:one`,
              type: `update`,
              collectionId: `rows`,
              modified: { id: `one`, revision: 1, payload: null as unknown },
              original: { id: `one`, revision: 0, payload: null as unknown },
              changes: { payload: null as unknown },
            }
            mutation[field].payload = payload
            expect(() =>
              serializer.deserialize(
                JSON.stringify({
                  id: `bad`,
                  createdAt: new Date(0).toISOString(),
                  valueEncoding: 2,
                  mutations: [mutation],
                }),
              ),
            ).toThrow(`Corrupted Object marker`)
          },
        ),
        {
          seed: 20260914,
          numRuns: 100,
          examples: [undefined, null, 1, `text`, false, []].map(
            (value): [typeof value, Array<boolean>] => [value, []],
          ),
        },
      )
    } finally {
      await collection.cleanup()
    }
  },
)
const pinned: Array<Edit> = [
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
// This package's test root is separate from core's named replay portfolio.
// Keep a local replay entry point rather than importing files outside rootDir.
const {
  runs: numRuns,
  seed: replaySeed,
  path: replayPath,
} = readOfflineOracleConfig({
  prefix: `OFFLINE_ORACLE`,
  defaultRuns: 100,
})
it.each([20260914, undefined])(
  `preserves mutation wire meaning across restart (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            kind: fc.constantFrom<Edit[`kind`]>(`insert`, `update`, `delete`),
            slot: fc.integer({ min: 0, max: 1 }),
            before: tree(2),
            after: tree(2),
          }),
          { maxLength: 6 },
        ),
        fc.integer({ min: -2000000000000, max: 2000000000000 }),
        (edits, time) => checkRoundtrip(edits, time),
      ),
      {
        numRuns,
        seed: seed ?? replaySeed,
        ...(seed === undefined && replayPath !== undefined
          ? { path: replayPath }
          : {}),
        examples: [[pinned, 1704067200000]],
      },
    )
  },
)

it.each([20260915, undefined])(
  `reads unversioned Date-marker records across restart (seed %s)`,
  async (seed) => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            kind: fc.constantFrom<Edit[`kind`]>(`insert`, `update`, `delete`),
            slot: fc.integer({ min: 0, max: 1 }),
            before: leaf,
            after: leaf,
          }),
          { minLength: 1, maxLength: 6 },
        ),
        async (edits) => {
          // Old records had no object escape. Use only unambiguous legacy trees,
          // but cross nested arrays, ordinary objects, Dates and date-like strings.
          const nest = (pair: Pair): Pair => ({
            runtime: { nested: [pair.runtime] },
            wire: { nested: [pair.wire] },
          })
          await checkRoundtrip(
            edits.map((edit) => ({
              ...edit,
              before: nest(edit.before),
              after: nest(edit.after),
            })),
            0,
            `none`,
            `encoder`,
            true,
          )
        },
      ),
      {
        seed: seed ?? replaySeed,
        numRuns,
        ...(seed === undefined && replayPath !== undefined
          ? { path: replayPath }
          : {}),
        examples: [
          [[{ kind: `update`, slot: 0, before: datePair(0), after: twin }]],
        ],
      },
    )
  },
)

it.each(
  (
    [
      `date-as-string`,
      `string-as-date`,
      `wrong-registry`,
      `omit-changes`,
      `unknown-encoding`,
    ] as const
  ).flatMap((fault) =>
    ([`encoder`, `decoder`] as const).map((boundary) => ({
      fault,
      boundary,
    })),
  ),
)(
  `rejects the $fault $boundary mutant at its own boundary`,
  async ({ fault, boundary }) => {
    const decode = vi.spyOn(TransactionSerializer.prototype, `deserialize`)
    try {
      const expectedFailure =
        boundary === `encoder` ||
        (fault !== `wrong-registry` && fault !== `unknown-encoding`)
          ? { name: `AssertionError` }
          : {
              message:
                fault === `wrong-registry`
                  ? `Collection with id writer:0 not found`
                  : `Unsupported transaction value encoding: 3`,
            }
      await expect(
        checkRoundtrip(pinned, 0, fault, boundary),
      ).rejects.toMatchObject(expectedFailure)
      expect(decode).toHaveBeenCalledTimes(boundary === `encoder` ? 0 : 1)
    } finally {
      decode.mockRestore()
    }
  },
)
