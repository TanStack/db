import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { expect, it, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import {
  MissingTemporalConstructorError,
  TransactionSerializer,
} from '../src/outbox/TransactionSerializer'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import { FakeStorageAdapter } from './harness'
import type { OfflineTransaction } from '../src/types'
import type { PendingMutation } from '@tanstack/db'

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

// Construct both representations from semantic leaves, not by walking a
// production value with a copy of serializeValue. This is JSON trees + Date,
// not arbitrary JS: cycles, undefined, non-finite numbers and other native
// objects are outside this format. User keys, including codec markers, are data.
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
  versionTwo = false,
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
        encoded = encoded.replace(`"valueEncoding":3`, `"valueEncoding":4`)
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
    if (versionTwo)
      wires.push(JSON.stringify({ ...expectedWire, valueEncoding: 2 }))
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

const temporalCases = [
  [`Duration`, `PT1H30M`],
  [`Instant`, `2026-09-16T12:34:56Z`],
  [`PlainDate`, `2026-09-16`],
  [`PlainDateTime`, `2026-09-16T12:34:56`],
  [`PlainMonthDay`, `09-16`],
  [`PlainTime`, `12:34:56`],
  [`PlainYearMonth`, `2026-09`],
  [`ZonedDateTime`, `2026-09-16T12:34:56-06:00[America/Denver]`],
] as const

type TemporalName = (typeof temporalCases)[number][0]

class TemporalStub {
  readonly #name: TemporalName
  readonly #value: string

  constructor(name: TemporalName, value: string) {
    this.#name = name
    this.#value = value
  }

  get [Symbol.toStringTag](): `Temporal.${TemporalName}` {
    return `Temporal.${this.#name}`
  }

  toString(): string {
    return this.#value
  }
}

it(`rejects native scalars before storage when global restoration is unavailable`, async () => {
  const temporalGlobal = globalThis as { Temporal?: Record<string, unknown> }
  const previousTemporal = temporalGlobal.Temporal
  temporalGlobal.Temporal = {}
  const storage = new FakeStorageAdapter()
  const outbox = new OutboxManager(storage, {})
  const transaction: OfflineTransaction = {
    id: `unrestorable-native-scalar`,
    mutationFnName: `persist`,
    mutations: [],
    keys: [],
    idempotencyKey: `once`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata: {
      due: new TemporalStub(`PlainDate`, `2026-09-16`),
    },
    version: 1,
  }

  try {
    await expect(outbox.add(transaction)).rejects.toThrow(
      MissingTemporalConstructorError,
    )
    expect(storage.snapshot()).toEqual({})
  } finally {
    if (previousTemporal === undefined) delete temporalGlobal.Temporal
    else temporalGlobal.Temporal = previousTemporal
  }
})

it(`preserves native scalar identity across storage restart`, async () => {
  type NativeRow = {
    id: string
    values: Record<TemporalName, TemporalStub>
  }
  const writer = createCollection<NativeRow>({
    id: `native-scalar-writer`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const reader = createCollection<NativeRow>({
    id: `native-scalar-reader`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const previousTemporal = (
    globalThis as { Temporal?: Record<string, unknown> }
  ).Temporal
  ;(globalThis as { Temporal?: Record<string, unknown> }).Temporal =
    Object.fromEntries(
      temporalCases.map(([name]) => [
        name,
        { from: (value: string) => new TemporalStub(name, value) },
      ]),
    )

  const values = Object.fromEntries(
    temporalCases.map(([name, value]) => [name, new TemporalStub(name, value)]),
  ) as NativeRow[`values`]
  const mutation = {
    globalKey: `native-scalar-writer:one`,
    type: `update`,
    modified: { id: `one`, values },
    original: { id: `one`, values },
    changes: { values },
    collection: writer,
  } as unknown as PendingMutation
  const transaction: OfflineTransaction = {
    id: `native-scalars`,
    mutationFnName: `persist`,
    mutations: [mutation],
    keys: [mutation.globalKey],
    idempotencyKey: `once`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata: { nested: { values } },
    version: 1,
  }

  try {
    const encoded = new TransactionSerializer({ rows: writer }).serialize(
      transaction,
    )
    const wire = JSON.parse(encoded)
    expect(wire.valueEncoding).toBe(3)
    const encodedLocations = [
      wire.mutations[0].modified.values,
      wire.mutations[0].original.values,
      wire.mutations[0].changes.values,
      wire.metadata.nested.values,
    ] as Array<Record<TemporalName, unknown>>
    for (const location of encodedLocations)
      for (const [name, value] of temporalCases)
        expect(location[name]).toEqual({
          __type: `Temporal`,
          type: `Temporal.${name}`,
          value,
        })

    const restarted = new TransactionSerializer({ rows: reader })
    const decoded = restarted.deserialize(encoded)
    const decodedMutation = decoded.mutations[0]!
    const restored = [
      (decodedMutation.modified as NativeRow).values,
      (decodedMutation.original as NativeRow).values,
      (decodedMutation.changes as { values: NativeRow[`values`] }).values,
      (
        decoded.metadata as {
          nested: { values: NativeRow[`values`] }
        }
      ).nested.values,
    ] as Array<Record<TemporalName, unknown>>

    for (const location of restored) {
      for (const [name, value] of temporalCases) {
        expect(location[name]).toBeInstanceOf(TemporalStub)
        expect(Object.prototype.toString.call(location[name])).toBe(
          `[object Temporal.${name}]`,
        )
        expect(String(location[name])).toBe(value)
      }
    }
  } finally {
    if (previousTemporal === undefined)
      delete (globalThis as { Temporal?: Record<string, unknown> }).Temporal
    else
      (globalThis as { Temporal?: Record<string, unknown> }).Temporal =
        previousTemporal
    await writer.cleanup()
    await reader.cleanup()
  }
})

it(`preserves marker-shaped user data through current wire encoding`, async () => {
  const runtime = {
    __type: `Temporal`,
    type: `Temporal.PlainDate`,
    value: `2026-09-16`,
  }
  await checkRoundtrip(
    [
      {
        kind: `insert`,
        slot: 0,
        before: twin,
        after: { runtime, wire: objectWire(runtime) },
      },
    ],
    0,
  )
})

it(`preserves prior wire meanings when reading native scalar markers`, async () => {
  const collection = createCollection<{
    id: string
    due: unknown
    createdAt: unknown
  }>({
    id: `native-scalar-compatibility`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const serializer = new TransactionSerializer({ rows: collection })
  const temporalData = {
    __type: `Temporal`,
    type: `Temporal.PlainDate`,
    value: `2026-09-16`,
  }
  const dateMarker = {
    __type: `Date`,
    value: `2026-09-16T12:34:56.000Z`,
  }
  const baseWire = {
    id: `compatibility`,
    mutationFnName: `persist`,
    mutations: [
      {
        globalKey: `rows:one`,
        type: `insert`,
        modified: { id: `one`, due: temporalData, createdAt: dateMarker },
        original: {},
        changes: {},
        collectionId: `rows`,
      },
    ],
    keys: [`rows:one`],
    idempotencyKey: `once`,
    createdAt: new Date(0).toISOString(),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata: { due: temporalData, createdAt: dateMarker },
    version: 1,
  }

  try {
    const unversioned = serializer.deserialize(JSON.stringify(baseWire))
    expect(unversioned.mutations[0]!.modified).toEqual({
      id: `one`,
      due: temporalData,
      createdAt: new Date(dateMarker.value),
    })
    expect(unversioned.metadata).toEqual(baseWire.metadata)

    const versionTwo = serializer.deserialize(
      JSON.stringify({
        ...baseWire,
        valueEncoding: 2,
        mutations: [
          {
            ...baseWire.mutations[0],
            modified: {
              id: `one`,
              due: { __type: `Object`, value: temporalData },
              createdAt: dateMarker,
            },
          },
        ],
      }),
    )
    expect(versionTwo.mutations[0]!.modified).toEqual({
      id: `one`,
      due: temporalData,
      createdAt: new Date(dateMarker.value),
    })
    expect(versionTwo.metadata).toEqual(baseWire.metadata)
  } finally {
    await collection.cleanup()
  }
})

it(`fails visibly when a stored native scalar cannot be restored`, async () => {
  const collection = createCollection<{ id: string; due: unknown }>({
    id: `native-scalar-missing-runtime`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const marker = {
    __type: `Temporal`,
    type: `Temporal.PlainDate`,
    value: `2026-09-16`,
  }
  const wire = JSON.stringify({
    valueEncoding: 3,
    id: `missing-runtime`,
    mutationFnName: `persist`,
    mutations: [
      {
        globalKey: `rows:one`,
        type: `insert`,
        modified: { id: `one`, due: marker },
        original: {},
        changes: {},
        collectionId: `rows`,
      },
    ],
    keys: [`rows:one`],
    idempotencyKey: `once`,
    createdAt: new Date(0).toISOString(),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata: { due: marker },
    version: 1,
  })
  const temporalGlobal = globalThis as { Temporal?: Record<string, unknown> }
  const previousTemporal = temporalGlobal.Temporal
  temporalGlobal.Temporal = {}
  const storage = new FakeStorageAdapter()
  await storage.set(`tx:missing-runtime`, wire)
  const outbox = new OutboxManager(storage, { rows: collection })

  try {
    expect(() =>
      new TransactionSerializer({ rows: collection }).deserialize(wire),
    ).toThrow(MissingTemporalConstructorError)
    await expect(outbox.get(`missing-runtime`)).rejects.toThrow(
      MissingTemporalConstructorError,
    )
    await expect(outbox.getAll()).rejects.toThrow(
      MissingTemporalConstructorError,
    )
    expect(storage.snapshot()).toHaveProperty(`tx:missing-runtime`, wire)
  } finally {
    if (previousTemporal === undefined) delete temporalGlobal.Temporal
    else temporalGlobal.Temporal = previousTemporal
    await collection.cleanup()
  }
})

it(`rejects malformed native scalar markers and constructor failures`, async () => {
  const collection = createCollection<{ id: string; due: unknown }>({
    id: `native-scalar-invalid`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const serializer = new TransactionSerializer({ rows: collection })
  const wire = (marker: unknown) =>
    JSON.stringify({
      valueEncoding: 3,
      id: `invalid-native-scalar`,
      mutationFnName: `persist`,
      mutations: [
        {
          globalKey: `rows:one`,
          type: `insert`,
          modified: { id: `one`, due: marker },
          original: {},
          changes: {},
          collectionId: `rows`,
        },
      ],
      keys: [`rows:one`],
      idempotencyKey: `once`,
      createdAt: new Date(0).toISOString(),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
    })

  try {
    expect(() =>
      serializer.deserialize(
        wire({
          __type: `Temporal`,
          type: `Temporal.Calendar`,
          value: `iso8601`,
        }),
      ),
    ).toThrow(`Corrupted Temporal marker: invalid type field`)
    expect(() =>
      serializer.deserialize(
        wire({ __type: `Temporal`, type: `Temporal.PlainDate` }),
      ),
    ).toThrow(`Corrupted Temporal marker: missing value field`)

    const temporalGlobal = globalThis as {
      Temporal?: Record<string, unknown>
    }
    const previousTemporal = temporalGlobal.Temporal
    const constructorFailure = new Error(`constructor rejected value`)
    temporalGlobal.Temporal = {
      PlainDate: {
        from: () => {
          throw constructorFailure
        },
      },
    }
    try {
      expect(() =>
        serializer.deserialize(
          wire({
            __type: `Temporal`,
            type: `Temporal.PlainDate`,
            value: `not-a-date`,
          }),
        ),
      ).toThrow(constructorFailure)
    } finally {
      if (previousTemporal === undefined) delete temporalGlobal.Temporal
      else temporalGlobal.Temporal = previousTemporal
    }
  } finally {
    await collection.cleanup()
  }
})

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
                  valueEncoding: 3,
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

it.each([20260916, undefined])(
  `reads version-two escaped values across restart (seed %s)`,
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
          { minLength: 1, maxLength: 6 },
        ),
        async (edits) =>
          checkRoundtrip(edits, 0, `none`, `encoder`, false, true),
      ),
      {
        seed: seed ?? replaySeed,
        numRuns,
        ...(seed === undefined && replayPath !== undefined
          ? { path: replayPath }
          : {}),
        examples: [[pinned]],
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
                  : `Unsupported transaction value encoding: 4`,
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
