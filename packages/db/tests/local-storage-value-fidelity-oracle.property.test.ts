/**
 * A LocalStorage Collection that uses the default JSON parser accepts a row
 * only if a fresh restore can return it. The LocalStorage guide promises that
 * a peer or freshly restored Collection sees the stored JSON form of an
 * accepted row. JSON omits functions, symbols, enumerable symbol keys, and
 * an array's non-element properties; writes `NaN`, infinities (also boxed),
 * and `undefined` or missing array entries as `null`; and writes Map, Set,
 * WeakMap, Promise, RegExp, and binary values as plain objects. JSON applies
 * `toJSON` first, so these checks apply to its result. A write that would
 * lose part of a row must not report success while peers and later sessions
 * see a different row. Such an insert or update rejects with
 * `SerializationError`. Nothing is written, the optimistic row rolls back,
 * and an automatic mutation's application handler never runs.
 *
 * The documented normalizations remain accepted: a value with `toJSON` (such
 * as `Date`, or a function that has one) is stored as that method's result,
 * and an object property whose value or `toJSON` result is `undefined` is
 * stored as an absent property. `-0` is stored as `0`, a boxed finite number
 * as its number, and a non-enumerable symbol key is not stored.
 *
 * Limits: this owner covers only the default JSON parser. A custom parser owns
 * its own value domain. Class instances are outside the generated domain:
 * they are accepted, and a restore returns their own enumerable data without
 * their prototype, as the guide states. Cross-realm natives, getters, and
 * non-enumerable string properties are not generated. Updates do not carry
 * shapes that the draft copy changes (see `insertOnly`). Mutation order,
 * peers, and Storage failures belong to the order and peer owners.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index'
import { SerializationError } from '../src/errors'
import { localStorageCollectionOptions } from '../src/local-storage'
import { createTransaction } from '../src/transactions'
import {
  oraclePropertyOptions,
  oracleReplayRequested,
  oracleReplayTest,
  oracleRuns,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import {
  observeHistoryPromise,
  withHistoryCleanup,
} from './optimistic-history-oracle'

const property = `local-storage.value-fidelity`

// ---------------------------------------------------------------------------
// Model. Each generated value carries the JSON form a restore must return, or
// LOST when JSON cannot return it. The expectation comes from how the value
// was built, not from inspecting it, so the model shares no classifier with
// production. A container is lost if any child is lost. OMIT marks an object
// property that the stored form leaves out.
// ---------------------------------------------------------------------------

const LOST = Symbol(`lost`)
const OMIT = Symbol(`omit`)

type Described = { label: string; authored: unknown; restored: unknown }

function faithful(label: string, authored: unknown, restored = authored) {
  return { label, authored, restored } satisfies Described
}

function lost(label: string, authored: unknown): Described {
  return { label, authored, restored: LOST }
}

// An update assigns its payload through a draft, and the draft copy changes
// these shapes before storage sees them: it drops an array's extra properties
// and symbol keys, and makes a hidden symbol key enumerable. The proxy oracles
// own that copy, so only insert entries carry these payloads.
const insertOnly = new WeakSet<object>()

function onlyInserted(described: Described): Described {
  insertOnly.add(described.authored as object)
  return described
}

function containsInsertOnly(value: unknown): boolean {
  if (typeof value !== `object` || value === null) return false
  return insertOnly.has(value) || Object.values(value).some(containsInsertOnly)
}

function isLegal({ entry, payload }: History): boolean {
  return entry.endsWith(`insert`) || !containsInsertOnly(payload.authored)
}

const lostLeaves: Array<() => Described> = [
  () => lost(`function`, () => `hi`),
  () => lost(`symbol`, Symbol(`s`)),
  () => lost(`NaN`, Number.NaN),
  () => lost(`Infinity`, Number.POSITIVE_INFINITY),
  () => lost(`-Infinity`, Number.NEGATIVE_INFINITY),
  () => lost(`Map`, new Map([[`k`, 1]])),
  () => lost(`empty Set`, new Set()),
  () => lost(`RegExp`, /x/g),
  () => lost(`Uint8Array`, new Uint8Array([1, 2])),
  () => lost(`symbol key`, { [Symbol(`s`)]: 1 }),
  () => lost(`WeakMap`, new WeakMap()),
  () => lost(`SharedArrayBuffer`, new SharedArrayBuffer(2)),
  () => lost(`Promise`, Promise.resolve(1)),
  // JSON unwraps a boxed number and then writes a non-finite value as `null`.
  () => lost(`boxed NaN`, new Number(Number.NaN)),
  // JSON writes an array's elements only: a hole becomes `null`, and extra
  // string or symbol properties disappear.
  () => lost(`array hole`, new Array(1)),
  () => onlyInserted(lost(`array property`, Object.assign([1], { extra: 2 }))),
  () =>
    onlyInserted(
      lost(`array symbol key`, Object.assign([1], { [Symbol(`s`)]: 1 })),
    ),
]

const faithfulLeaf: fc.Arbitrary<Described> = fc.oneof(
  fc.string({ maxLength: 4 }).map((s) => faithful(`string`, s)),
  fc.boolean().map((b) => faithful(`boolean`, b)),
  fc.constant(faithful(`null`, null)),
  // `-0 + 0` is `0`: JSON writes negative zero as `0`.
  fc
    .double({ noNaN: true, noDefaultInfinity: true })
    .map((n) => faithful(`number`, n, n + 0)),
  fc
    .integer({ min: 0, max: 4_102_444_800_000 })
    .map((t) => faithful(`Date`, new Date(t), new Date(t).toISOString())),
  // A plain object whose own `toJSON` is a function stores that result. The
  // function here is the serialization hook, not lost row data.
  fc
    .string({ maxLength: 4 })
    .map((s) => faithful(`toJSON object`, { toJSON: () => s }, s)),
  // JSON calls `toJSON` on a function too, so such a function is not lost.
  fc.string({ maxLength: 4 }).map((s) =>
    faithful(
      `toJSON function`,
      Object.assign(() => 1, { toJSON: () => s }),
      s,
    ),
  ),
  fc.integer().map((n) => faithful(`boxed number`, new Number(n), n)),
  // A non-enumerable key is not row data, whether it is a string or a symbol.
  fc
    .integer()
    .map((n) =>
      onlyInserted(
        faithful(
          `hidden symbol key`,
          Object.defineProperty({ a: n }, Symbol(`s`), { value: 1 }),
          { a: n },
        ),
      ),
    ),
)

const lostLeaf: fc.Arbitrary<Described> = fc
  .integer({ min: 0, max: lostLeaves.length - 1 })
  .map((index) => lostLeaves[index]!())

function restoredArray(children: Array<Described>): unknown {
  return children.some((c) => c.restored === LOST)
    ? LOST
    : children.map((c) => c.restored)
}

function restoredObject(entries: Array<[string, Described]>): unknown {
  if (entries.some(([, c]) => c.restored === LOST)) return LOST
  return Object.fromEntries(
    entries
      .filter(([, c]) => c.restored !== OMIT)
      .map(([key, c]) => [key, c.restored]),
  )
}

const { value: valueArbitrary } = fc.letrec<{
  value: Described
  element: Described
  member: Described
}>((tie) => ({
  value: fc.oneof(
    { maxDepth: 3, depthIdentifier: `value` },
    faithfulLeaf,
    lostLeaf,
    fc.array(tie(`element`), { maxLength: 3 }).map((children) => ({
      label: `[${children.map((c) => c.label).join(`, `)}]`,
      authored: children.map((c) => c.authored),
      restored: restoredArray(children),
    })),
    fc
      .uniqueArray(fc.tuple(fc.constantFrom(`a`, `b`, `c`), tie(`member`)), {
        maxLength: 3,
        selector: ([key]) => key,
      })
      .map((entries) => ({
        label: `{${entries.map(([k, c]) => `${k}: ${c.label}`).join(`, `)}}`,
        authored: Object.fromEntries(entries.map(([k, c]) => [k, c.authored])),
        restored: restoredObject(entries),
      })),
  ),
  // JSON writes an `undefined` array entry as `null`, so it is lost data.
  element: fc.oneof(
    { depthIdentifier: `value` },
    tie(`value`),
    fc.constant(lost(`undefined entry`, undefined)),
    fc.constant(lost(`toJSON undefined entry`, { toJSON: () => undefined })),
  ),
  // An `undefined` property is stored as absent; reading it gives `undefined`.
  member: fc.oneof(
    { depthIdentifier: `value` },
    tie(`value`),
    fc.constant<Described>({
      label: `undefined`,
      authored: undefined,
      restored: OMIT,
    }),
    // A property whose `toJSON` returns `undefined` is also stored as absent.
    fc.constant<Described>({
      label: `toJSON undefined`,
      authored: { toJSON: () => undefined },
      restored: OMIT,
    }),
  ),
}))

// ---------------------------------------------------------------------------
// History grammar. One write carries the generated payload in row `row`.
// `insert` and `update` are automatic mutations, with or without an
// application handler; `manual insert` and `manual update` reach storage
// through `acceptMutations` inside a manual transaction's mutationFn. Storage
// always holds an unrelated row `other`, and an update starts from a stored
// `row`, so
// a rejected write has a durable predecessor that must survive unchanged.
// ---------------------------------------------------------------------------

type Entry = `insert` | `update` | `manual insert` | `manual update`
type History = { entry: Entry; handler: boolean; payload: Described }

const historyArbitrary: fc.Arbitrary<History> = fc
  .record({
    entry: fc.constantFrom<Entry>(
      `insert`,
      `update`,
      `manual insert`,
      `manual update`,
    ),
    handler: fc.boolean(),
    payload: valueArbitrary,
  })
  .filter(isLegal)

type Row = { id: string; payload: unknown }
const storageKey = `rows`

function makeStorage(entry: Entry) {
  const values = new Map<string, string>()
  const seed: Array<Row> = [{ id: `other`, payload: `kept` }]
  if (entry.endsWith(`update`)) seed.push({ id: `row`, payload: `seed` })
  values.set(
    storageKey,
    JSON.stringify(
      Object.fromEntries(
        seed.map((row) => [`s:${row.id}`, { versionKey: row.id, data: row }]),
      ),
    ),
  )
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

type Storage = ReturnType<typeof makeStorage>

function open(storage: Storage, onWrite?: () => void) {
  return createCollection(
    localStorageCollectionOptions<Row>({
      storageKey,
      storage,
      storageEventApi: { addEventListener() {}, removeEventListener() {} },
      getKey: (row) => row.id,
      ...(onWrite && {
        onInsert: () => Promise.resolve(onWrite()),
        onUpdate: () => Promise.resolve(onWrite()),
      }),
    }),
  )
}

// ---------------------------------------------------------------------------
// Production driver and refinement check. The checkpoint is the settlement of
// the write's `when('settled')` promise. A faithful payload must fulfil it; the
// writer keeps its authored value (the guide lets the writer hold it until
// restore); durable storage and a fresh Collection hold the model's restored
// form. A lost payload must reject with `SerializationError`; the writer's
// row returns to its predecessor; durable storage is byte-for-byte unchanged;
// and no automatic handler ran.
// ---------------------------------------------------------------------------

async function runHistory({ entry, handler, payload }: History) {
  const storage = makeStorage(entry)
  const before = storage.getItem(storageKey)
  let handlerCalls = 0
  const collection = open(
    storage,
    handler ? () => void handlerCalls++ : undefined,
  )
  let reopened: ReturnType<typeof open> | undefined
  await withHistoryCleanup(
    async () => {
      await collection.preload()
      const previous = collection.get(`row`)
      const row = { id: `row`, payload: payload.authored }
      let receipt: Promise<unknown>
      if (entry === `insert`) receipt = collection.insert(row).when(`settled`)
      else if (entry === `update`)
        receipt = collection
          .update(`row`, (draft) => {
            draft.payload = payload.authored
          })
          .when(`settled`)
      else {
        const tx = createTransaction({
          mutationFn: ({ transaction }) =>
            collection.utils.acceptMutations(transaction),
        })
        tx.mutate(() => {
          if (entry === `manual insert`) collection.insert(row)
          else
            collection.update(`row`, (draft) => {
              draft.payload = payload.authored
            })
        })
        receipt = tx.when(`settled`)
      }
      const outcome = observeHistoryPromise(receipt)
      await outcome.settled
      const settled = outcome.read()
      const label = `${entry} ${payload.label}`

      if (payload.restored === LOST) {
        expect(settled.status, label).toBe(`rejected`)
        if (settled.status === `rejected`)
          expect(settled.reason, label).toBeInstanceOf(SerializationError)
        expect(collection.get(`row`), `${label}: writer`).toEqual(previous)
        expect(storage.getItem(storageKey), `${label}: durable`).toBe(before)
        expect(handlerCalls, `${label}: handler`).toBe(0)
        return
      }

      expect(settled.status, label).toBe(`fulfilled`)
      expect(collection.get(`row`)?.payload, `${label}: writer`).toEqual(
        payload.authored,
      )
      const durable = JSON.parse(storage.getItem(storageKey)!) as Record<
        string,
        { data: Row }
      >
      expect(durable[`s:row`]?.data.payload, `${label}: durable`).toStrictEqual(
        payload.restored,
      )
      expect(durable[`s:other`]?.data.payload, `${label}: peer row`).toBe(
        `kept`,
      )
      reopened = open(storage)
      await reopened.preload()
      expect(reopened.get(`row`)?.payload, `${label}: restore`).toStrictEqual(
        payload.restored,
      )
    },
    () => [
      () => collection.cleanup(),
      ...(reopened ? [() => reopened!.cleanup()] : []),
    ],
  )
}

declareOracle({
  check: [runHistory],
  model: [restoredArray, restoredObject],
})

describe(`LocalStorage value fidelity oracle`, () => {
  if (!oracleReplayRequested()) {
    // Pinned witnesses. The first is the reported case: a function property in
    // an inserted row. The others place each lost kind under an array or an
    // object, and check each documented normalization on every entry path.
    const pinned: Array<Described> = [
      ...lostLeaves.map((make) => make()),
      lost(`nested function`, { a: { b: () => 1 } }),
      lost(`function in array`, [1, () => 1]),
      lost(`undefined entry`, [1, undefined]),
      faithful(`Date`, new Date(0), new Date(0).toISOString()),
      faithful(`toJSON object`, { toJSON: () => `x` }, `x`),
      faithful(`undefined property`, { a: undefined, b: 1 }, { b: 1 }),
      faithful(`negative zero`, -0, 0),
      faithful(`empty containers`, { a: [], b: {} }),
      faithful(
        `toJSON function`,
        Object.assign(() => 1, { toJSON: () => `x` }),
        `x`,
      ),
      faithful(`boxed number`, new Number(2), 2),
      faithful(
        `toJSON undefined property`,
        { a: { toJSON: () => undefined }, b: 1 },
        { b: 1 },
      ),
      lost(`toJSON undefined entry`, [{ toJSON: () => undefined }]),
      onlyInserted(
        faithful(
          `hidden symbol key`,
          Object.defineProperty({ a: 1 }, Symbol(`s`), { value: 1 }),
          { a: 1 },
        ),
      ),
    ]
    const entries = [
      `insert`,
      `update`,
      `manual insert`,
      `manual update`,
    ] as const
    for (const entry of entries) {
      for (const handler of [true, false]) {
        for (const payload of pinned) {
          if (!isLegal({ entry, handler, payload })) continue
          it(`${entry} ${handler ? `with` : `without`} a handler of ${payload.label} ${payload.restored === LOST ? `rejects` : `persists its JSON form`}`, () =>
            runHistory({ entry, handler, payload }))
        }
      }
      // Storage must hold the JSON the check accepted. This `toJSON` returns
      // the full value once and then a function, which JSON would drop, so a
      // second serialization before the write would store a different row.
      it(`${entry} stores the JSON that its check accepted`, () => {
        let calls = 0
        const payload = {
          toJSON: () => (calls++ === 0 ? `checked` : () => `later`),
        }
        return runHistory({
          entry,
          handler: true,
          payload: faithful(`toJSON that changes`, payload, `checked`),
        })
      })
    }

    fcTest.prop([historyArbitrary], {
      seed: 20_261_021,
      numRuns: oracleRuns(300),
    })(`matches the JSON value model (fixed)`, runHistory)
  }
  // A path replay of this property runs its one recorded history here.
  oracleReplayTest(fcTest, property).prop(
    [historyArbitrary],
    oraclePropertyOptions(300, property),
  )(`matches the JSON value model (random)`, runHistory)
})
