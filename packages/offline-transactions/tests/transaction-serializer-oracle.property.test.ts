import { types as nativeTypes } from 'node:util'
import { createCollection, createTransaction } from '@tanstack/db'
import fc from 'fast-check'
import { describe, expect, vi } from 'vitest'
import { OutboxManager } from '../src/outbox/OutboxManager'
import { TransactionSerializer } from '../src/outbox/TransactionSerializer'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
  rejectAt,
} from '../../db/tests/oracle-assertion-adapter'
import { cleanupOfflineOracle } from './oracle-lifecycle'
import { FakeStorageAdapter } from './harness'
import {
  DATE_MARKER_PROPERTY,
  MUTATION_WIRE_PROPERTY,
  VERSION_TWO_PROPERTY,
  checkRoundtrip,
  datePair,
  decodeHistory,
  encodeHistory,
  fixedHistory,
  leaf,
  mutationEdits,
  mutationTime,
  objectWire,
  serializerLaw,
  tree,
  twin,
} from './transaction-serializer-oracle'
import type { OfflineTransaction } from '../src/types'

import type {
  Edit,
  HistoryValue,
  Pair,
  Row,
} from './transaction-serializer-oracle'
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

// A marker-shaped user object is data, not a Temporal marker: the current
// wire escapes it once, and the restored operand is the same object.
const markerShapedRuntime = {
  __type: `Temporal`,
  type: `Temporal.PlainDate`,
  value: `2026-09-16`,
}

// Roundtrips generate valid envelopes. Corrupted wire must be rejected before
// it can replace any mutation field with an invented empty object.
const malformedLeaves = [undefined, null, 1, `text`, false, []]
describe.each([`modified`, `original`, `changes`] as const)(
  `malformed escaped objects in %s`,
  (field) => {
    oracleProperty({
      id: `offline.serializer.malformed-object`,
      owns: [
        `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
        `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
        `src/outbox/OutboxManager.ts#OutboxManager.add`,
        `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
        `src/outbox/OutboxManager.ts#OutboxManager.get`,
      ],
      law: {
        ...serializerLaw,
        statement: `Malformed escaped Object markers reject before replacing any mutation field.`,
      },
      histories: {
        arbitrary: fc
          .tuple(
            fc.constantFrom(...malformedLeaves),
            fc.array(fc.boolean(), { maxLength: 4 }),
          )
          .map(encodeHistory, (history) => {
            const [value, containers] = decodeHistory<
              [(typeof malformedLeaves)[number], Array<boolean>]
            >(history as HistoryValue)
            return [
              Array.isArray(value) ? malformedLeaves[5] : value,
              containers,
            ]
          }),
        runs: 100,
        fixedSeeds: [20260914],
        fixed: [undefined, null, 1, `text`, false, []].map((value, index) => ({
          name: `malformed leaf ${index}`,
          history: encodeHistory([value, []]),
        })),
      },
      resolve: (history) => ({
        input: decodeHistory<[unknown, Array<boolean>]>(history),
      }),
      model: recordedAssertionJudgment,
      driver: (plan, observe) =>
        recordAssertionJudgment(
          `malformed escaped object`,
          plan,
          observe,
          async () => {
            const [invalid, containers] = plan.input
            const collection = createCollection<Row>({
              getKey: (row) => row.id,
              sync: { sync: ({ markReady }) => markReady() },
            })
            const serializer = new TransactionSerializer({ rows: collection })
            try {
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
              oracleAssertion(`malformed escaped object`, () =>
                expect(() =>
                  serializer.deserialize(
                    JSON.stringify({
                      id: `bad`,
                      createdAt: new Date(0).toISOString(),
                      valueEncoding: 3,
                      mutations: [mutation],
                    }),
                  ),
                ).toThrow(`Corrupted Object marker`),
              )
            } finally {
              await collection.cleanup()
            }
          },
        ),
      check: forwardAssertionJudgment,
    })
  },
)
// Each encoder and decoder fault, crossed with the boundary it is injected at.
const mutationWireFaults = (
  [
    `date-as-string`,
    `string-as-date`,
    `wrong-registry`,
    `omit-changes`,
    `unknown-encoding`,
  ] as const
).flatMap((fault) =>
  ([`encoder`, `decoder`] as const).map((boundary) => ({ fault, boundary })),
)
/** A mutation wire history's edits and the clock time it runs at. */
type MutationWirePlan = { edits: Array<Edit>; time: number }
/** Whether a calibration's old Vitest matchers accept a rejection. */
function matches(assertions: () => void): boolean {
  try {
    assertions()
    return true
  } catch {
    return false
  }
}
const asError = (failure: unknown): Error =>
  failure instanceof Error ? failure : new Error(String(failure))
/** A rejection that the old matchers did not accept stays a driver error: a
 * new, unmarked error, so no comparison checkpoint inside it counts. */
const unaccepted = (mutant: string, failure: unknown): Error =>
  new Error(
    `${mutant} failed in a way that its calibration does not accept: ${String(failure)}`,
  )

// The check runs one history through production and compares every checkpoint
// with the semantic model in transaction-serializer-oracle.ts. Generated
// properties, fixed histories, and the fault calibrations all reach it. What
// this oracle owns: the gap report judges these entries, and their reference
// trees within the package, by this file's tests.
oracleProperty({
  id: MUTATION_WIRE_PROPERTY,
  owns: [
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
    `src/outbox/OutboxManager.ts#OutboxManager.add`,
    `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
    `src/outbox/OutboxManager.ts#OutboxManager.get`,
  ],
  law: {
    ...serializerLaw,
    statement: `Mutation wire and restored operands preserve their authored meaning across application recreation.`,
  },
  histories: {
    arbitrary: fc
      .tuple(mutationEdits, mutationTime)
      .map(encodeHistory, (history) =>
        decodeHistory<[Array<Edit>, number]>(history as HistoryValue),
      ),
    runs: 100,
    fixedSeeds: [20260914],
    fixed: [
      // The fault calibrations below run on the first named history whose
      // clean trace passes, so this one comes first: it is the authored
      // history at time zero that each fault calibration corrupts.
      {
        name: `all edit kinds at time zero`,
        history: encodeHistory([fixedHistory, 0]),
      },
      {
        name: `all edit kinds and hostile marker values`,
        history: encodeHistory([fixedHistory, 1704067200000]),
      },
      {
        name: `preserves marker-shaped user data through current wire encoding`,
        history: encodeHistory([
          [
            {
              kind: `insert`,
              slot: 0,
              before: twin,
              after: {
                runtime: markerShapedRuntime,
                wire: objectWire(markerShapedRuntime),
              },
            },
          ],
          0,
        ]),
      },
    ],
  },
  resolve: (history) => {
    const [edits, time] = decodeHistory<[Array<Edit>, number]>(history)
    return { edits, time }
  },
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`mutation wire meaning`, plan, observe, () =>
      checkRoundtrip(plan.edits, plan.time),
    ),
  check: forwardAssertionJudgment,
  calibrations: mutationWireFaults.map(({ fault, boundary }) => ({
    name: `rejects the ${fault} ${boundary} mutant at its own boundary`,
    law: `mutation wire meaning`,
    driver: (plan: MutationWirePlan, observe) =>
      recordAssertionJudgment(
        `mutation wire meaning`,
        plan,
        observe,
        async () => {
          const decode = vi.spyOn(
            TransactionSerializer.prototype,
            `deserialize`,
          )
          try {
            const expectedFailure =
              boundary === `encoder` ||
              (fault !== `wrong-registry` && fault !== `unknown-encoding`)
                ? { name: `AssertionError` }
                : {
                    message:
                      fault === `wrong-registry`
                        ? `Collection with id writer:0 not found`
                        : `Unsupported transaction value encoding: 5`,
                  }
            const failure = await checkRoundtrip(
              plan.edits,
              plan.time,
              fault,
              boundary,
            ).then(
              () => undefined,
              (error: unknown) => error ?? new Error(String(error)),
            )
            if (failure === undefined) return
            // Exactly the old matchers: only this rejection, at this boundary,
            // counts as the check rejecting the mutant.
            if (
              matches(() => {
                expect(failure).toMatchObject(expectedFailure)
                expect(decode).toHaveBeenCalledTimes(
                  boundary === `encoder` ? 0 : 1,
                )
              })
            )
              rejectAt(`${fault} ${boundary} mutant`, asError(failure))
            throw unaccepted(`the ${fault} ${boundary} mutant`, failure)
          } finally {
            decode.mockRestore()
          }
        },
      ),
  })),
})

// The cleanup-failure calibration corrupts exactly the first authored edit at
// time zero, so that history runs as its own enumerated case through the same
// driver and comparison as the generated campaign above.
const cleanupCalibrationHistories = [
  {
    name: `the first authored edit at time zero`,
    history: encodeHistory([[fixedHistory[0]!], 0]),
  },
]
oracleProperty({
  id: `offline.serializer.mutation-wire-cleanup`,
  law: {
    ...serializerLaw,
    statement: `Mutation wire and restored operands preserve their authored meaning across application recreation, and a comparison failure survives a cleanup failure.`,
    limits: `The first authored edit at time zero, which the cleanup-failure calibration corrupts; it runs through the same driver and comparison as offline.serializer.mutation-wire.`,
  },
  owns: [
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
    `src/outbox/OutboxManager.ts#OutboxManager.add`,
    `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
    `src/outbox/OutboxManager.ts#OutboxManager.get`,
  ],
  histories: cleanupCalibrationHistories,
  label: ({ name }) => name,
  resolve: ({ history }) => {
    const [edits, time] = decodeHistory<[Array<Edit>, number]>(history)
    return { edits, time }
  },
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`mutation wire meaning`, plan, observe, () =>
      checkRoundtrip(plan.edits, plan.time),
    ),
  check: forwardAssertionJudgment,
  calibrations: [
    {
      name: `retains the wire mismatch when cleanup also fails`,
      law: `mutation wire meaning`,
      driver: (plan: MutationWirePlan, observe) =>
        recordAssertionJudgment(
          `mutation wire meaning`,
          plan,
          observe,
          async () => {
            const failure = await checkRoundtrip(
              plan.edits,
              plan.time,
              `omit-changes`,
              `encoder`,
              false,
              false,
              true,
            ).then(
              () => undefined,
              (error: unknown) => error ?? new Error(String(error)),
            )
            if (failure === undefined) return
            // Exactly the old matchers: the aggregate keeps the wire mismatch
            // as its cause and the cleanup failure as its only error.
            if (
              matches(() => {
                expect(failure).toBeInstanceOf(AggregateError)
                const aggregate = failure as AggregateError
                expect(aggregate.cause).toMatchObject({
                  name: `AssertionError`,
                })
                expect(String(aggregate.cause)).toContain(
                  `mutation wire checkpoint`,
                )
                expect(aggregate.errors).toEqual([
                  new Error(`injected serializer cleanup failure`),
                ])
              })
            )
              rejectAt(`mutation wire cleanup failure`, asError(failure))
            throw unaccepted(`the cleanup-failure mutant`, failure)
          },
        ),
    },
  ],
})

const legacyEdits = fc.array(
  fc.record({
    kind: fc.constantFrom<Edit[`kind`]>(`insert`, `update`, `delete`),
    slot: fc.integer({ min: 0, max: 1 }),
    before: leaf,
    after: leaf,
  }),
  { minLength: 1, maxLength: fixedHistory.length },
)
const versionTwoEdits = fc.array(
  fc.record({
    kind: fc.constantFrom<Edit[`kind`]>(`insert`, `update`, `delete`),
    slot: fc.integer({ min: 0, max: 1 }),
    before: tree(2),
    after: tree(2),
  }),
  { minLength: 1, maxLength: fixedHistory.length },
)

describe.each([
  {
    id: DATE_MARKER_PROPERTY,
    seed: 20260915,
    legacy: true,
    arbitrary: legacyEdits,
    fixed: [
      { kind: `update`, slot: 0, before: datePair(0), after: twin },
    ] as Array<Edit>,
  },
  {
    id: VERSION_TWO_PROPERTY,
    seed: 20260916,
    legacy: false,
    arbitrary: versionTwoEdits,
    fixed: fixedHistory,
  },
])(`compatible wire $id`, ({ id, seed, legacy, arbitrary, fixed }) => {
  oracleProperty({
    id,
    owns: [
      `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
      `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
      `src/outbox/OutboxManager.ts#OutboxManager.add`,
      `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
      `src/outbox/OutboxManager.ts#OutboxManager.get`,
    ],
    law: {
      ...serializerLaw,
      statement: `Compatible unversioned and version-two wire preserves authored mutation meaning.`,
    },
    histories: {
      arbitrary: arbitrary.map(encodeHistory, (history) =>
        decodeHistory<Array<Edit>>(history as HistoryValue),
      ),
      runs: 100,
      fixedSeeds: [seed],
      fixed: [
        { name: `authored compatible values`, history: encodeHistory(fixed) },
      ],
    },
    resolve: (history) => ({ edits: decodeHistory<Array<Edit>>(history) }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `compatible mutation wire`,
        plan,
        observe,
        async () => {
          // The unversioned domain keeps the original unambiguous nesting rule.
          const nest = (pair: Pair): Pair => ({
            runtime: { nested: [pair.runtime] },
            wire: { nested: [pair.wire] },
          })
          const edits = legacy
            ? plan.edits.map((edit) => ({
                ...edit,
                before: nest(edit.before),
                after: nest(edit.after),
              }))
            : plan.edits
          await checkRoundtrip(edits, 0, `none`, `encoder`, legacy, !legacy)
        },
      ),
    check: forwardAssertionJudgment,
  })
})

/**
 * Opt-in mutation codecs own their mutation-value domain independently of the
 * default JSON/Date/Temporal encoding above. The wire records the codec ID and
 * a new version so a reader cannot mistake opaque data for ordinary rows.
 * Missing, mismatched, or failing codecs reject reads without changing storage.
 *
 * The supplied fixture codec uses Node's V8 structured serialization. Expected
 * runtime values come directly from independently generated before/after native
 * leaves, not production dispatch or codec output. Real Collection operations
 * construct legal insert/update/delete operands, including equal-payload updates
 * and removed fields. Declared reach checks these distinctions and each native
 * scalar class per fixed/random campaign. Histories also cross fresh readers and
 * unsupported reader configurations. Existing v3 histories remain unchanged.
 * The Convex receiving witness supplies its real public value codec and tests
 * disk/process replay against the actual backend.
 */
type CodecHistory = {
  kind: `insert` | `update` | `delete`
  beforeValues: Array<number | bigint | ArrayBuffer>
  afterValues: Array<number | bigint | ArrayBuffer>
  samePayload: boolean
  removeField: boolean
}
async function checkCodec(
  { kind, beforeValues, afterValues, samePayload, removeField }: CodecHistory,
  enter: (state: string) => void,
): Promise<void> {
  const { serialize, deserialize } = await import('node:v8')
  const codec = {
    id: `v8-test/1`,
    encode: (value: unknown) => serialize(value).toString(`base64`),
    decode: (value: unknown) =>
      deserialize(Buffer.from(value as string, `base64`)) as unknown,
  }
  // An explicit type/field projection preserves own undefined fields and bytes
  // without depending on V8's object prototypes or serializer wire tags. Node's
  // native ArrayBuffer brand check also recognizes V8's restored realm.
  const projectValue = (value: unknown): unknown => {
    if (nativeTypes.isArrayBuffer(value))
      return [`bytes`, [...new Uint8Array(value)]]
    if (Array.isArray(value)) return [`array`, value.map(projectValue)]
    if (value !== null && typeof value === `object`)
      return [
        `object`,
        Object.entries(value)
          .map(([key, field]) => [key, projectValue(field)])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ]
    if (typeof value === `number`)
      return [`number`, Object.is(value, -0) ? `-0` : String(value)]
    return [typeof value, String(value)]
  }
  type CodecRow = {
    id: string
    revision: number
    values: Array<unknown>
    removable?: unknown
  }
  const original: CodecRow = {
    id: `one`,
    revision: 0,
    values: beforeValues,
    removable: beforeValues[0],
  }
  const modified: CodecRow = {
    id: `one`,
    revision: 1,
    values: samePayload ? beforeValues : afterValues,
    ...(removeField ? {} : { removable: beforeValues[0] }),
  }
  const writer = createCollection<CodecRow>({
    id: `codec-writer`,
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        if (kind !== `insert`) write({ type: `insert`, value: original })
        commit()
        markReady()
      },
    },
  })
  const reader = createCollection<CodecRow>({
    id: `codec-reader`,
    getKey: (row) => row.id,
    sync: { sync: ({ markReady }) => markReady() },
  })
  const local = createTransaction({
    autoCommit: false,
    mutationFn: async () => {},
  })
  const rollback = local.when('settled').catch(() => undefined)
  const storage = new FakeStorageAdapter()
  let hasPrimaryFailure = false
  try {
    // Core constructs legal CRUD operands. Different authored trees
    // prevent one operand from masquerading as another; revision also
    // keeps equal-payload updates observable. The serializer owns
    // preservation, while core owns changes composition.
    local.mutate(() => {
      if (kind === `insert`) writer.insert(modified)
      else if (kind === `delete`) writer.delete(`one`)
      else
        writer.update(`one`, (draft) => {
          draft.revision = modified.revision
          draft.values = modified.values
          if (removeField) delete draft.removable
        })
    })
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(local.mutations).toHaveLength(1),
    )
    const mutation = local.mutations[0]!
    const expectedOriginal = kind === `insert` ? {} : original
    // Snapshot before the writer: its input aliases the seeded row.
    // In-place corruption must not rewrite the expected original too.
    const expectedOriginalObservation = projectValue(expectedOriginal)
    // Core owns its full-row and removed-field representation; this
    // owner preserves that complete supplied operand at the codec cut.
    const expectedModified = projectValue(mutation.modified)
    const expectedChanges = projectValue(mutation.changes)
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(mutation.original).toEqual(expectedOriginal),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(mutation.modified.revision).toBe(kind === `delete` ? 0 : 1),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(projectValue(mutation.modified.values)).toEqual(
        projectValue(kind === `delete` ? original.values : modified.values),
      ),
    )
    enter(kind)
    if (kind !== `delete`) enter(`different-operands`)
    if (kind === `update` && samePayload) enter(`equal-payload-update`)
    if (
      kind === `update` &&
      JSON.stringify(projectValue(beforeValues)) !==
        JSON.stringify(projectValue(modified.values))
    )
      enter(`changed-payload-update`)
    if (kind === `update` && removeField) {
      oracleAssertion(`codec mutation operands and durable storage`, () =>
        expect(Object.hasOwn(mutation.changes, `removable`)).toBe(true),
      )
      oracleAssertion(`codec mutation operands and durable storage`, () =>
        expect(mutation.changes.removable).toBeUndefined(),
      )
      enter(`removed-field-update`)
    }
    const recordNative = (value: unknown): void => {
      if (typeof value === `bigint`) enter(`int64`)
      else if (
        typeof value === `number` &&
        (!Number.isFinite(value) || Object.is(value, -0))
      )
        enter(`special-float`)
      else if (nativeTypes.isArrayBuffer(value)) enter(`binary`)
      else if (value !== null && typeof value === `object`)
        Object.values(value).forEach(recordNative)
    }
    recordNative(mutation.original)
    recordNative(mutation.modified)
    recordNative(mutation.changes)
    const transaction: OfflineTransaction = {
      id: `codec-transaction`,
      mutationFnName: `save`,
      keys: [mutation.globalKey],
      idempotencyKey: `stable`,
      createdAt: new Date(0),
      retryCount: 0,
      nextAttemptAt: 0,
      version: 1,
      metadata: { when: new Date(0) },
      mutations: local.mutations,
    }
    await new OutboxManager(storage, { rows: writer }, codec).add(transaction)
    const before = storage.snapshot()
    const restored = await new OutboxManager(
      storage,
      { rows: reader },
      codec,
    ).get(`codec-transaction`)
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(
        projectValue(restored?.mutations[0]?.modified),
        `modified operand`,
      ).toEqual(expectedModified),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(
        projectValue(restored?.mutations[0]?.original),
        `original operand`,
      ).toEqual(expectedOriginalObservation),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(
        projectValue(restored?.mutations[0]?.changes),
        `changes operand`,
      ).toEqual(expectedChanges),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(restored?.mutations[0]?.collection).toBe(reader),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(restored?.metadata).toEqual({ when: new Date(0) }),
    )
    const invalidEncoder = {
      ...codec,
      encode: () => null,
    } as unknown as typeof codec
    await oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(
        new OutboxManager(storage, { rows: writer }, invalidEncoder).add(
          transaction,
        ),
      ).rejects.toThrow(`codec`),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(storage.snapshot()).toEqual(before),
    )
    const wire = JSON.parse(Object.values(before)[0]!)
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(wire.valueEncoding).toBe(4),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(wire.mutationEncoding).toBe(codec.id),
    )
    for (const unsupported of [
      undefined,
      { ...codec, id: `other` },
      {
        ...codec,
        decode: () => {
          throw new Error(`broken codec`)
        },
      },
    ]) {
      const outbox = new OutboxManager(storage, { rows: reader }, unsupported)
      await oracleAssertion(`codec mutation operands and durable storage`, () =>
        expect(outbox.get(`codec-transaction`)).rejects.toThrow(`codec`),
      )
      await oracleAssertion(`codec mutation operands and durable storage`, () =>
        expect(outbox.getAll()).rejects.toThrow(`codec`),
      )
      oracleAssertion(`codec mutation operands and durable storage`, () =>
        expect(storage.snapshot()).toEqual(before),
      )
    }
    const plain = { id: `one`, revision: 0, values: [] }
    const legacy = {
      ...transaction,
      id: `legacy-transaction`,
      mutations: [
        {
          ...transaction.mutations[0]!,
          modified: plain,
          original: plain,
          changes: { values: [] },
        },
      ],
    }
    await new OutboxManager(storage, { rows: writer }).add(legacy)
    const mixed = await new OutboxManager(
      storage,
      { rows: reader },
      codec,
    ).getAll()
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(mixed).toHaveLength(2),
    )
    oracleAssertion(`codec mutation operands and durable storage`, () =>
      expect(
        mixed.find((entry) => entry.id === legacy.id)?.mutations[0]?.modified,
      ).toEqual(plain),
    )
  } catch (error) {
    hasPrimaryFailure = true
    throw error
  } finally {
    await cleanupOfflineOracle(
      [
        () => {
          local.rollback()
        },
        () => rollback,
        () => writer.cleanup(),
        () => reader.cleanup(),
      ],
      hasPrimaryFailure,
    )
  }
}

const codecNative = fc.oneof(
  fc.bigInt({ min: -(2n ** 63n), max: 2n ** 63n - 1n }),
  fc.constantFrom(NaN, Infinity, -Infinity, -0),
  fc.uint8Array({ maxLength: 12 }).map(
    (bytes) => bytes.buffer,
    (buffer) => new Uint8Array(buffer as ArrayBuffer),
  ),
)
const codecValues = fc.array(codecNative, { minLength: 1, maxLength: 5 })
const codecHistory = fc
  .record({
    kind: fc.constantFrom(
      `insert` as const,
      `update` as const,
      `delete` as const,
    ),
    beforeValues: codecValues,
    afterValues: codecValues,
    samePayload: fc.boolean(),
    removeField: fc.boolean(),
  })
  .map(encodeHistory, (history) =>
    decodeHistory<CodecHistory>(history as HistoryValue),
  )
const codecStates = [
  `insert`,
  `update`,
  `delete`,
  `different-operands`,
  `equal-payload-update`,
  `changed-payload-update`,
  `removed-field-update`,
  `int64`,
  `special-float`,
  `binary`,
]
// Native required states retain the campaign's existing ten reach obligations.
// Each construction stays inside the original one-to-five native-leaf grammar.
const codecConstructions = [
  {
    kind: `insert` as const,
    samePayload: false,
    removeField: false,
    enters: [
      `insert`,
      `different-operands`,
      `int64`,
      `special-float`,
      `binary`,
    ],
  },
  {
    kind: `update` as const,
    samePayload: true,
    removeField: true,
    enters: [
      `update`,
      `different-operands`,
      `equal-payload-update`,
      `removed-field-update`,
      `int64`,
      `special-float`,
      `binary`,
    ],
  },
  {
    kind: `update` as const,
    samePayload: false,
    removeField: false,
    enters: [
      `update`,
      `different-operands`,
      `changed-payload-update`,
      `int64`,
      `special-float`,
      `binary`,
    ],
  },
  {
    kind: `delete` as const,
    samePayload: false,
    removeField: false,
    enters: [`delete`, `int64`, `special-float`, `binary`],
  },
]
oracleProperty({
  id: `offline.serializer.mutation-codec`,
  owns: [
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.serialize`,
    `src/outbox/TransactionSerializer.ts#TransactionSerializer.deserialize`,
    `src/outbox/OutboxManager.ts#OutboxManager.add`,
    `src/outbox/OutboxManager.ts#OutboxManager.getAll`,
    `src/outbox/OutboxManager.ts#OutboxManager.get`,
  ],
  law: {
    ...serializerLaw,
    statement: `Opt-in codecs preserve complete supplied operands and unreadable records leave durable work unchanged.`,
  },
  histories: {
    arbitrary: codecHistory,
    runs: 60,
    fixedSeeds: [20261022],
    states: codecStates,
    constructed: codecConstructions.map((construction, index) => ({
      name: `existing native operand state ${index}`,
      enters: construction.enters,
      build: (history: HistoryValue) => {
        const input = decodeHistory<CodecHistory>(history)
        return encodeHistory({
          ...input,
          kind: construction.kind,
          samePayload: construction.samePayload,
          removeField: construction.removeField,
          beforeValues: [
            1n,
            -0,
            new Uint8Array([1, 2]).buffer,
            ...input.beforeValues.slice(0, 2),
          ],
          afterValues: [
            2n,
            Infinity,
            new Uint8Array([3]).buffer,
            ...input.afterValues.slice(0, 2),
          ],
        })
      },
    })),
  },
  resolve: (history) => decodeHistory<CodecHistory>(history),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`codec mutation meaning`, plan, observe, () =>
      checkCodec(plan, (state) => observe(`reach`, state)),
    ),
  check: forwardAssertionJudgment,
})
