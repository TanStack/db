// Focused serializer witnesses: metadata toJSON and boxed-scalar rules,
// cycles, Temporal markers, legacy phases, and malformed wire. The serializer
// law that these examples instantiate is owned by
// transaction-serializer-oracle.property.test.ts.
import { createCollection } from '@tanstack/db'
import { expect, it } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import {
  MissingTemporalConstructorError,
  TransactionSerializer,
} from '../src/outbox/TransactionSerializer'
import { FakeStorageAdapter } from './harness'
import type { OfflineTransaction } from '../src/types'
import type { PendingMutation } from '@tanstack/db'

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

function temporalStubConstructor(name: TemporalName) {
  return class extends TemporalStub {
    constructor(value: string) {
      super(name, value)
    }

    static from(value: string): TemporalStub {
      return new TemporalStub(name, value)
    }
  }
}

function metadataTransaction(
  metadata: Record<string, unknown>,
): OfflineTransaction {
  return {
    id: `metadata-json`,
    mutationFnName: `persist`,
    mutations: [],
    keys: [],
    idempotencyKey: `once`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata,
    version: 1,
  }
}

it(`rejects cyclic metadata with a bounded JSON-style error`, () => {
  const metadata: Record<string, unknown> = {}
  metadata.self = metadata

  expect(() =>
    new TransactionSerializer({}).serialize(metadataTransaction(metadata)),
  ).toThrowError(new TypeError(`Converting circular structure to JSON`))
})

it(`rejects cyclic mutation values with a bounded JSON-style error`, () => {
  const collection = { id: `cycle-writer` } as any
  const modified: Record<string, unknown> = { id: `one` }
  modified.self = modified
  const transaction: OfflineTransaction = {
    ...metadataTransaction({}),
    mutations: [
      {
        globalKey: `cycle-writer:one`,
        type: `insert`,
        modified,
        original: {},
        changes: modified,
        collection,
      } as PendingMutation,
    ],
    keys: [`cycle-writer:one`],
  }

  expect(() =>
    new TransactionSerializer({ rows: collection }).serialize(transaction),
  ).toThrowError(new TypeError(`Converting circular structure to JSON`))
})

it(`preserves repeated references that do not form a cycle`, () => {
  const shared = { nested: [`value`] }
  const transaction = metadataTransaction({ left: shared, right: shared })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({
    left: { nested: [`value`] },
    right: { nested: [`value`] },
  })
})

it(`preserves spoofed Temporal tags as data while restoring branded values`, async () => {
  class PlainDateStub {
    readonly #value: string

    constructor(value: string) {
      this.#value = value
    }

    static from(value: string): PlainDateStub {
      return new PlainDateStub(value)
    }

    get [Symbol.toStringTag](): `Temporal.PlainDate` {
      return `Temporal.PlainDate`
    }

    toString(): string {
      return this.#value
    }
  }

  const temporalGlobal = globalThis as { Temporal?: Record<string, unknown> }
  const previousTemporal = temporalGlobal.Temporal
  temporalGlobal.Temporal = { PlainDate: PlainDateStub }
  const storage = new FakeStorageAdapter()
  const outbox = new OutboxManager(storage, {})
  const transaction = metadataTransaction({
    spoofed: {
      keep: `user data`,
      [Symbol.toStringTag]: `Temporal.PlainDate`,
      toString: () => `not-a-date`,
    },
    genuine: new PlainDateStub(`2026-09-22`),
  })

  try {
    await outbox.add(transaction)
    const restored = await outbox.get(transaction.id)

    expect(restored?.metadata).toMatchObject({
      spoofed: { keep: `user data` },
      genuine: expect.any(PlainDateStub),
    })
    expect(String((restored?.metadata as any).genuine)).toBe(`2026-09-22`)
  } finally {
    if (previousTemporal === undefined) delete temporalGlobal.Temporal
    else temporalGlobal.Temporal = previousTemporal
  }
})

it(`preserves plain user data with a Temporal tag when Temporal is unavailable`, () => {
  const temporalGlobal = globalThis as { Temporal?: Record<string, unknown> }
  const previousTemporal = temporalGlobal.Temporal
  delete temporalGlobal.Temporal
  const transaction = metadataTransaction({
    spoofed: {
      keep: `user data`,
      [Symbol.toStringTag]: `Temporal.Instant`,
    },
  })

  try {
    const wire = JSON.parse(
      new TransactionSerializer({}).serialize(transaction),
    )

    expect(wire.metadata).toEqual({ spoofed: { keep: `user data` } })
  } finally {
    if (previousTemporal === undefined) delete temporalGlobal.Temporal
    else temporalGlobal.Temporal = previousTemporal
  }
})

it(`does not invoke a mutation value's plain Symbol.toStringTag getter`, () => {
  let reads = 0
  const value = { keep: `user data` }
  Object.defineProperty(value, Symbol.toStringTag, {
    get() {
      reads++
      throw new Error(`do not inspect user getters`)
    },
  })
  const collection = { id: `tag-getter-writer` } as any
  const modified = { id: `one`, value }
  const transaction: OfflineTransaction = {
    ...metadataTransaction({}),
    mutations: [
      {
        globalKey: `tag-getter-writer:one`,
        type: `insert`,
        modified,
        original: {},
        changes: modified,
        collection,
      } as unknown as PendingMutation,
    ],
    keys: [`tag-getter-writer:one`],
  }

  const wire = JSON.parse(
    new TransactionSerializer({ rows: collection }).serialize(transaction),
  )

  expect({ reads, modified: wire.mutations[0].modified }).toEqual({
    reads: 0,
    modified: { id: `one`, value: { keep: `user data` } },
  })
})

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

it(`uses one validated Temporal tag when writing a marker`, () => {
  const temporalGlobal = globalThis as { Temporal?: Record<string, unknown> }
  const previousTemporal = temporalGlobal.Temporal
  let reads = 0
  class PlainDateStub {
    readonly #value: string

    constructor(value: string) {
      this.#value = value
    }

    static from(value: string): PlainDateStub {
      return new PlainDateStub(value)
    }

    get [Symbol.toStringTag]() {
      reads++
      return reads === 1 ? `Temporal.PlainDate` : `Temporal.Invalid`
    }

    toString(): string {
      return this.#value
    }
  }
  temporalGlobal.Temporal = { PlainDate: PlainDateStub }
  const value = new PlainDateStub(`2026-09-16`)

  try {
    const wire = JSON.parse(
      new TransactionSerializer({}).serialize(metadataTransaction({ value })),
    )
    expect(wire.metadata.value).toEqual({
      __type: `Temporal`,
      type: `Temporal.PlainDate`,
      value: `2026-09-16`,
    })
    expect(reads).toBe(1)
  } finally {
    if (previousTemporal === undefined) delete temporalGlobal.Temporal
    else temporalGlobal.Temporal = previousTemporal
  }
})

it(`preserves metadata toJSON values without changing mutation value semantics`, () => {
  class JsonValue {
    toJSON(key: string) {
      return `from-toJSON:${key}`
    }
  }
  const collection = {
    id: `metadata-json-writer`,
    getKeyFromItem: (value: { id: string }) => value.id,
  } as any
  const serializer = new TransactionSerializer({ rows: collection })
  const url = new URL(`https://example.com/path`)
  const jsonValue = new JsonValue()
  const metadata = {
    url,
    jsonValue,
    nested: [jsonValue],
    boxed: [Object(7), Object(`value`), Object(false)],
  }
  Object.defineProperty(metadata, `toJSON`, {
    value: (key: string) => ({ ...metadata, metadataKey: key }),
  })
  const transaction: OfflineTransaction = {
    id: `metadata-json`,
    mutationFnName: `persist`,
    mutations: [
      {
        globalKey: `metadata-json-writer:one`,
        type: `insert`,
        modified: { id: `one`, url, jsonValue },
        original: {},
        changes: {},
        collection,
      } as unknown as PendingMutation,
    ],
    keys: [`metadata-json-writer:one`],
    idempotencyKey: `once`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    metadata,
    version: 1,
  }

  const encoded = serializer.serialize(transaction)
  const wire = JSON.parse(encoded)
  expect(wire.metadata).toEqual({
    url: `https://example.com/path`,
    jsonValue: `from-toJSON:jsonValue`,
    nested: [`from-toJSON:0`],
    boxed: [7, `value`, false],
    metadataKey: `metadata`,
  })
  expect(wire.mutations[0].modified).toEqual({
    id: `one`,
    url: {},
    jsonValue: {},
  })

  const decoded = serializer.deserialize(encoded)
  expect(decoded.metadata).toEqual(wire.metadata)
  expect(decoded.mutations[0]!.modified).toEqual(wire.mutations[0].modified)
})

it(`does not invoke toJSON again on its immediate replacement`, () => {
  const nested = {
    toJSON(key: string) {
      return `nested:${key}`
    },
  }
  const replacement = {
    nested,
    toJSON() {
      return `incorrect second invocation`
    },
  }
  const transaction = metadataTransaction({
    value: {
      toJSON(key: string) {
        return key === `value` ? replacement : `incorrect key:${key}`
      },
    },
  })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({ value: { nested: `nested:nested` } })
})

it(`rejects a toJSON replacement that references its receiver`, () => {
  const source = {
    toJSON() {
      return { back: source }
    },
  }

  expect(() =>
    new TransactionSerializer({}).serialize(
      metadataTransaction({ value: source }),
    ),
  ).toThrowError(new TypeError(`Converting circular structure to JSON`))
})

it(`treats immediate native-scalar replacements as ordinary JSON values`, () => {
  const temporalReplacement = {
    [Symbol.toStringTag]: `Temporal.PlainDate`,
    toString() {
      return `2026-09-16`
    },
  }
  const transaction = metadataTransaction({
    date: { toJSON: () => new Date(0) },
    temporal: { toJSON: () => temporalReplacement },
  })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({ date: {}, temporal: {} })
})

it(`preserves JSON array length and indexed-property semantics in metadata`, () => {
  const values = Array(3) as Array<string | undefined>
  Object.defineProperty(values, 0, { enumerable: false, value: `hidden` })
  values[1] = `visible`
  const shrinking = Array(3) as Array<string | undefined>
  Object.defineProperty(shrinking, 0, {
    enumerable: true,
    get() {
      shrinking.length = 1
      return `first`
    },
  })
  const transaction = metadataTransaction({ values, shrinking })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({
    values: [`hidden`, `visible`, null],
    shrinking: [`first`, null, null],
  })
})

it(`retains JSON's error for boxed BigInt metadata`, () => {
  const transaction = metadataTransaction({ value: Object(1n) })

  expect(() => new TransactionSerializer({}).serialize(transaction)).toThrow(
    TypeError,
  )
})

it(`does not recurse through fresh toJSON replacement objects`, () => {
  const freshReplacement = (): Record<string, unknown> => ({
    toJSON: freshReplacement,
  })
  const transaction = metadataTransaction({
    value: { toJSON: freshReplacement },
  })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({ value: {} })
})

it(`reads metadata toJSON once with its object as the receiver`, () => {
  let reads = 0
  let selfCalls = 0
  const value = {
    marker: `receiver`,
    get toJSON() {
      reads++
      if (reads > 1) throw new Error(`toJSON read more than once`)
      return function (this: { marker: string }, key: string) {
        return `${this.marker}:${key}`
      }
    },
  }
  const self = {
    keep: `value`,
    toJSON() {
      selfCalls++
      return this
    },
  }
  const transaction = metadataTransaction({ value, self })

  const wire = JSON.parse(new TransactionSerializer({}).serialize(transaction))

  expect(wire.metadata).toEqual({
    value: `receiver:value`,
    self: { keep: `value` },
  })
  expect(reads).toBe(1)
  expect(selfCalls).toBe(1)
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
      temporalCases.map(([name]) => [name, temporalStubConstructor(name)]),
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

it(`keeps legacy pending-work records phase-free across serialization`, () => {
  const serializer = new TransactionSerializer({})
  const legacyWire = {
    id: `legacy-pending`,
    mutationFnName: `persist`,
    mutations: [],
    keys: [],
    idempotencyKey: `legacy-key`,
    createdAt: new Date(0).toISOString(),
    retryCount: 0,
    nextAttemptAt: 0,
    version: 1,
  }

  const decoded = serializer.deserialize(JSON.stringify(legacyWire))
  expect(decoded.outboxPhase).toBeUndefined()
  const rewritten = JSON.parse(serializer.serialize(decoded)) as Record<
    string,
    unknown
  >
  expect(rewritten).not.toHaveProperty(`outboxPhase`)
  expect(rewritten).toMatchObject(legacyWire)
  expect(rewritten).toHaveProperty(`valueEncoding`, 3)
})

it(`round-trips a mutationFn-fulfilled deletion-pending record`, () => {
  const serializer = new TransactionSerializer({})
  const transaction: OfflineTransaction = {
    id: `deletion-pending`,
    mutationFnName: `persist`,
    mutations: [],
    keys: [],
    idempotencyKey: `stable-key`,
    createdAt: new Date(0),
    retryCount: 0,
    nextAttemptAt: 0,
    outboxPhase: `deletion-pending`,
    version: 1,
  }

  const encoded = serializer.serialize(transaction)
  expect(JSON.parse(encoded)).toMatchObject({
    id: transaction.id,
    idempotencyKey: `stable-key`,
    outboxPhase: `deletion-pending`,
    valueEncoding: 3,
    version: 1,
  })
  expect(serializer.deserialize(encoded)).toEqual(transaction)
})

it.each([null, false, 0, {}, `provider-pending`, `unknown`])(
  `rejects malformed or unknown outbox phase %j`,
  (outboxPhase) => {
    const serializer = new TransactionSerializer({})
    const wire = {
      id: `invalid-phase`,
      mutationFnName: `persist`,
      mutations: [],
      keys: [],
      idempotencyKey: `stable-key`,
      createdAt: new Date(0).toISOString(),
      retryCount: 0,
      nextAttemptAt: 0,
      outboxPhase,
      version: 1,
    }
    expect(() => serializer.deserialize(JSON.stringify(wire))).toThrow(
      /Unsupported transaction outbox phase/,
    )
    expect(() =>
      serializer.serialize({
        ...wire,
        createdAt: new Date(0),
      } as unknown as OfflineTransaction),
    ).toThrow(/Unsupported transaction outbox phase/)
  },
)

it(`fails visibly with the retained native scalar transaction id`, async () => {
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
      /transaction missing-runtime/,
    )
    await expect(outbox.getAll()).rejects.toThrow(/transaction missing-runtime/)
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
