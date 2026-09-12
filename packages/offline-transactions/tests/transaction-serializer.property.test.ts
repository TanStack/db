import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it } from 'vitest'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import type { OfflineTransaction } from '../src/types'

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

// Construct both representations from semantic leaves, not by walking a
// production value with a copy of serializeValue. This is JSON trees + Date,
// not arbitrary JS: cycles, undefined, non-finite numbers, native objects and
// user objects using the reserved __type Date marker are outside this format.
const datePair = (time: number): Pair => ({
  runtime: new Date(time),
  wire: { __type: `Date`, value: new Date(time).toISOString() },
})
const scalar = fc.oneof(
  fc.constant(null),
  fc.boolean(),
  fc.integer(),
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
    fc.array(child, { maxLength: 3 }).map((items) => ({
      runtime: items.map((item) => item.runtime),
      wire: items.map((item) => item.wire),
    })),
    fc
      .dictionary(
        fc.constantFrom(`left`, `right`, `nested`, `date`, `text`),
        child,
        { maxKeys: 3 },
      )
      .map((fields) => ({
        runtime: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, value.runtime]),
        ),
        wire: Object.fromEntries(
          Object.entries(fields).map(([key, value]) => [key, value.wire]),
        ),
      })),
  )
}

async function checkRoundtrip(
  edits: Array<Edit>,
  time: number,
  fault: Fault = `none`,
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
      createdAt: new Date(time).toISOString(),
      mutations: edits.map((edit, index) => ({
        globalKey: transaction.mutations[index]!.globalKey,
        type: edit.kind,
        collectionId: `slot:${edit.slot}`,
        ...data(edit, index, `wire`),
      })),
    }
    let encoded = serializer.serialize(offline)
    if (fault === `date-as-string`)
      encoded = encoded.replace(
        /\{"__type":"Date","value":"([^"]+)"\}/g,
        `"$1"`,
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
    expect(JSON.parse(encoded)).toEqual(expectedWire)
    const fresh = new TransactionSerializer(registry(readers))
    // Also decode independently constructed wire data, so two matching wrong
    // halves cannot establish the format's compatibility by roundtrip alone.
    for (const wire of [encoded, JSON.stringify(expectedWire)]) {
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
  } finally {
    transaction.rollback()
    await rollback
    await Promise.all(
      [...writers, ...readers].map((collection) => collection.cleanup()),
    )
  }
}

const twin: Pair = {
  runtime: `2024-01-01T00:00:00.000Z`,
  wire: `2024-01-01T00:00:00.000Z`,
}
const pinned: Array<Edit> = [
  { kind: `insert`, slot: 0, before: twin, after: datePair(1704067200000) },
  { kind: `update`, slot: 1, before: datePair(0), after: twin },
  { kind: `delete`, slot: 0, before: datePair(1), after: twin },
]
// This package's test root is separate from core's named replay portfolio.
// Keep a local replay entry point rather than importing files outside rootDir.
const numRuns = Number(process.env.OFFLINE_ORACLE_RUNS ?? 100)
if (!Number.isSafeInteger(numRuns) || numRuns < 1)
  throw new Error(`Invalid OFFLINE_ORACLE_RUNS`)
const seedText = process.env.OFFLINE_ORACLE_SEED
const replaySeed = seedText === undefined ? undefined : Number(seedText)
if (
  seedText !== undefined &&
  (seedText.trim() === `` || !Number.isSafeInteger(replaySeed))
)
  throw new Error(`Invalid OFFLINE_ORACLE_SEED`)
const replayPath = process.env.OFFLINE_ORACLE_PATH
if (
  replayPath !== undefined &&
  (replaySeed === undefined || !/^\d+(?::\d+)*$/.test(replayPath))
)
  throw new Error(`OFFLINE_ORACLE_PATH requires a seed and numeric shrink path`)
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

it.each([
  `date-as-string`,
  `string-as-date`,
  `wrong-registry`,
  `omit-changes`,
] as const)(`rejects the %s serializer`, async (fault) => {
  await expect(checkRoundtrip(pinned, 0, fault)).rejects.toThrow()
})
