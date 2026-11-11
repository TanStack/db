/**
 * # What crosses the draft-to-stored-row boundary by value?
 *
 * Plain objects, arrays, Maps, Sets, Dates, regular expressions, typed arrays,
 * and their cycles become detached snapshots. Later caller mutation must not
 * rewrite the stored row. Arbitrary class instances are the explicit exception:
 * they retain reference identity because their hidden state cannot be cloned
 * faithfully. Dangerous data keys remain own data properties and may not alter
 * prototypes.
 *
 * The model uses native construction, `structuredClone` where its domain
 * applies, explicit cycle-shape checks, and fresh Collection reads. Generated
 * sparse arrays and adversarial keys cover shapes that JSON equality erases.
 * Alias and back-reference tests observe both identity and stored values, so a
 * flattened or accidentally shared result cannot pass.
 * Native Set and Map iteration order is part of the detached snapshot: a
 * reorder with identical members or entries is still a draft change.
 */
import { describe, expect, vi } from 'vitest'
import fc from 'fast-check'
import { withChangeTracking } from '../src/proxy.js'
import { oracleProperty } from './oracle-config.js'
import {
  cycleContainer,
  cycleKinds,
  expectCycleSnapshot,
  expectDetachedBinaryClone,
  expectDetachedPayloadJson,
  expectOwnDataProperty,
  storedDataRow,
  storedRow,
} from './proxy-detachment-fixture.js'
import {
  forwardAssertionJudgment,
  oracleAssertion,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from './oracle-assertion-adapter.js'
import type { CycleKind, CycleRow } from './proxy-detachment-fixture.js'

function runOrdinaryFieldCopies(count: number): void {
  const row = Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`field${i}`, i]),
  )
  const define = vi.spyOn(Object, `defineProperty`)
  let changes: Record<string | symbol, unknown>
  let writes: number
  try {
    changes = withChangeTracking(row, (draft) => {
      draft.field0 = 42
    })
    writes = define.mock.calls.filter(([, key]) =>
      String(key).startsWith(`field`),
    ).length
  } finally {
    define.mockRestore()
  }
  oracleAssertion('runOrdinaryFieldCopies', () =>
    expect(changes).toEqual({ field0: 42 }),
  )
  oracleAssertion('runOrdinaryFieldCopies', () => expect(row.field0).toBe(0))
  oracleAssertion('runOrdinaryFieldCopies', () => expect(writes).toBe(0))
}

type JsonDataKeyHistory = [
  `__proto__` | `constructor` | `toString` | `ordinary`,
  number,
  boolean,
]
function runJsonDataKeyHistory([key, value, nested]: JsonDataKeyHistory): void {
  const object = Object.fromEntries([[key, { value }]])
  const payload = nested ? { nested: [object] } : object
  const expected = structuredClone(payload)
  const original = { payload: { before: true } as object }
  const changes = withChangeTracking(original, (draft) => {
    draft.payload = payload
  })
  // JSON data can own a non-function "constructor" field. Do not
  // let the assertion library mistake that field for a class tag.
  oracleAssertion(`detached JSON payload`, () =>
    expectDetachedPayloadJson(changes.payload, expected),
  )
  const saved = nested
    ? (changes.payload as { nested: Array<object> }).nested[0]!
    : changes.payload!
  oracleAssertion('runJsonDataKeyHistory', () =>
    expect(Object.hasOwn(saved, key)).toBe(true),
  )
  oracleAssertion('runJsonDataKeyHistory', () =>
    expect(Object.getPrototypeOf(saved)).toBe(Object.prototype),
  )
  object[key]!.value++
  oracleAssertion(`detached JSON payload`, () =>
    expectDetachedPayloadJson(changes.payload, expected),
  )
  oracleAssertion('runJsonDataKeyHistory', () =>
    expect(original).toEqual({ payload: { before: true } }),
  )
}

type OwnPropertyHistory = { key: string; identitySchema: boolean }
const ownPropertyHistories: Array<OwnPropertyHistory> = [
  `value`,
  `__proto__`,
  `constructor`,
  `toString`,
].flatMap((key) =>
  [false, true].map((identitySchema) => ({ key, identitySchema })),
)

async function runOwnPropertyHistory({
  key,
  identitySchema,
}: OwnPropertyHistory): Promise<void> {
  // Assignment to an existing data property must not invoke an inherited
  // setter, even when extraction also includes an unrelated object edit.
  for (const sibling of [false, true]) {
    const make = () =>
      ({
        id: 1,
        sibling: { value: 0 },
        ...Object.fromEntries([[key, { value: 1 }]]),
      }) as Record<string, unknown> & { id: number }
    const run = (row: ReturnType<typeof make>) => {
      row[key] = { value: 2 }
      if (sibling) row.sibling = { value: 1 }
    }
    const changes = withChangeTracking(make(), run)
    expectOwnDataProperty(changes, key, { value: 2 })
    const collection = storedDataRow(make(), identitySchema)
    try {
      const tx = collection.update(1, run)
      await tx.when(`settled`)
      expectOwnDataProperty(collection.get(1)!, key, { value: 2 })
    } finally {
      await collection.cleanup()
    }
  }
  const actions = [`null`, `undefined`, `delete`, `readd`] as const
  for (const present of [false, true]) {
    for (const action of actions) {
      for (const sibling of [false, true]) {
        const make = () =>
          ({
            id: 1,
            read: ``,
            sibling: { value: 0 },
            ...Object.fromEntries(present ? [[key, `before`]] : []),
          }) as Record<string, unknown> & { id: number }
        const run = (row: ReturnType<typeof make>) => {
          if (action === `delete` || action === `readd`)
            Reflect.deleteProperty(row, key)
          if (action !== `delete`)
            Object.defineProperty(row, key, {
              value:
                action === `null`
                  ? null
                  : action === `readd`
                    ? `after`
                    : undefined,
              configurable: true,
              enumerable: true,
              writable: true,
            })
          row.read = Object.hasOwn(row, key) ? String(row[key]) : `absent`
          if (sibling) row.sibling = { value: 1 }
        }
        const expected = make()
        run(expected)
        const original = make()
        const changes = withChangeTracking(original, run)
        const expectedOwnKey = present || action !== `delete`
        expect(Object.hasOwn(changes, key)).toBe(expectedOwnKey)
        expect(Object.getPrototypeOf(changes)).toBe(Object.prototype)
        // Native deletion exposes inherited properties. The update API
        // instead represents that operation as an own undefined field.
        const patchValue = action === `delete` ? undefined : expected[key]
        if (expectedOwnKey) expectOwnDataProperty(changes, key, patchValue)
        expect(changes.read).toBe(expected.read)
        expect(original).toStrictEqual(make())
        const collection = storedDataRow(make(), identitySchema)
        try {
          const tx = collection.update(1, run)
          await tx.when(`settled`)
          const saved = collection.get(1)!
          expect(saved.read).toBe(expected.read)
          // Collection patches represent deletion with an own undefined.
          if (expectedOwnKey) expectOwnDataProperty(saved, key, patchValue)
          expect(Object.getPrototypeOf(saved)).toBe(Object.prototype)
        } finally {
          await collection.cleanup()
        }
      }
    }
  }
}

type CycleBackedgeHistory = { kind: CycleKind; edit: `before` | `after` }
const cycleBackedgeHistories: Array<CycleBackedgeHistory> = cycleKinds.flatMap(
  (kind) => ([`before`, `after`] as const).map((edit) => ({ kind, edit })),
)

async function runCycleBackedge({
  kind,
  edit,
}: CycleBackedgeHistory): Promise<void> {
  const original: CycleRow = { id: 1, count: 0 }
  const collection = storedRow(original)
  let settled: Promise<unknown> | undefined
  try {
    const tx = collection.update(1, (draft) => {
      if (edit === `before`) draft.count = 1
      draft.link = cycleContainer(kind, draft)
      if (edit === `after`) draft.count = 1
    })
    settled = Promise.allSettled([tx.when(`settled`)])
    expectCycleSnapshot(collection.get(1)!, kind)
    expect(original).toEqual({ id: 1, count: 0 })
    await tx.when(`settled`)
    await settled
    expectCycleSnapshot(collection.get(1)!, kind)
    expect(original).toEqual({ id: 1, count: 0 })
  } finally {
    await settled
    await collection.cleanup()
  }
}

describe(`Mutation result detachment`, () => {
  // For any number of ordinary fields, one write changes only that field and
  // defines no property descriptors: a generated law over the field count.
  oracleProperty({
    id: `proxy.ordinary-field-copies`,
    law: {
      statement: `Changing one ordinary field copies that field without changing the original row or defining descriptors for its ordinary fields.`,
      authority: `src/proxy.ts draft-to-detached-row contract stated above`,
      limits: `The existing generated count of 1 through 40 ordinary numeric fields and one field0 assignment.`,
    },
    // What this oracle owns: the gap report judges the draft-to-stored-row copy in
    // proxy.ts by this file's tests. The fixture helpers declare the checks.
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: fc.integer({ min: 1, max: 40 }),
      runs: 40,
      fixedSeeds: [20260914],
    },
    resolve: (count) => ({ count }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`ordinary field copies`, plan, observe, () =>
        runOrdinaryFieldCopies(plan.count),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `proxy.own-property-histories`,
    law: {
      statement: `Assigning, nulling, deleting or re-adding a dangerous or ordinary data key keeps it an own data property in the change record and the stored row, with the native result and an unchanged original.`,
      authority: `src/proxy.ts draft-to-stored-row value boundary contract stated above`,
      limits: `Four keys by identity or non-identity schema; each history runs the fixed native assignment and presence/action/sibling matrix through withChangeTracking and Collection.update.`,
    },
    owns: [`src/proxy.ts`],
    histories: ownPropertyHistories,
    label: ({ key, identitySchema }) =>
      `preserves native own-property histories for ${key} with schema=${identitySchema}`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(
        `proxy.own-property-histories`,
        plan,
        observe,
        () => runOwnPropertyHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  // Contract: a native container's insertion order survives the draft patch
  // and the stored-row publication, even when its members are unchanged.
  // Model: run the same reorder on a fresh native Set or Map.
  // Grammar: Set/Map × replacement/clear-and-readd of two entries.
  // Driver and checkpoint: compare the change patch after the callback and
  // the public Collection row after update() publishes and persists it.

  oracleProperty({
    id: `proxy.json-data-keys`,
    law: {
      statement: `Assigned JSON data retains its authored own keys and prototype and detaches later caller changes.`,
      authority: `src/proxy.ts draft-to-stored-row value boundary contract stated above`,
      limits: `The existing four-key, integer-value and nested-or-direct JSON grammar; native cycles and binary containers remain fixed shared-check histories.`,
    },
    owns: [`src/proxy.ts`],
    histories: {
      arbitrary: fc.tuple(
        fc.constantFrom(`__proto__`, `constructor`, `toString`, `ordinary`),
        fc.integer(),
        fc.boolean(),
      ),
      runs: 100,
      fixedSeeds: [20260914],
      fixed: [
        {
          name: `own __proto__ assignment`,
          history: [`__proto__`, 1, false] satisfies JsonDataKeyHistory,
        },
      ],
    },
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`JSON data key detachment`, plan, observe, () =>
        runJsonDataKeyHistory(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  oracleProperty({
    id: `proxy.cycle-backedges`,
    law: {
      statement: `A draft backedge assigned inside Collection.update is stored as a detached cyclic snapshot before and after settlement, and the caller's original row is unchanged.`,
      authority: `src/proxy.ts draft-to-stored-row value boundary contract stated above`,
      limits: `Map, Set, array and object backedges with the scalar edit before or after the assignment; the shared cycle-shape check judges the stored row.`,
    },
    owns: [`src/proxy.ts`],
    histories: cycleBackedgeHistories,
    label: ({ kind, edit }) =>
      `detaches a ${kind} draft backedge with the scalar edit ${edit} assignment`,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(`proxy.cycle-backedges`, plan, observe, () =>
        runCycleBackedge(plan.history),
      ),
    check: forwardAssertionJudgment,
  })

  // Current behavior, not a promise: a draft copies a row's own enumerable
  // string keys and every own symbol key, enumerable or not. Non-enumerable
  // string keys are not copied. The change record keeps only the written key.
})

const binaryKinds = [`buffer`, `view`, `u8`, `i64`] as const
type BinaryKind = (typeof binaryKinds)[number]

// Native binary snapshots preserve the entire backing buffer and view range,
// while detaching caller ownership. Native structuredClone is a second,
// independent formulation for this bounded standard-native value domain.
// Custom typed-array subclasses retain their separately tested construction
// semantics; shared, resizable and detached buffers are outside this matrix.
function runBinaryDetachment(kind: BinaryKind): void {
  const bytes = Uint8Array.from({ length: 24 }, (_, index) => index)
  const value =
    kind === `buffer`
      ? bytes.buffer
      : kind === `view`
        ? new DataView(bytes.buffer, 3, 7)
        : kind === `u8`
          ? new Uint8Array(bytes.buffer, 3, 7)
          : new BigInt64Array(bytes.buffer, 8, 1)
  const expected = structuredClone(value)
  const changes = withChangeTracking({ value: null as unknown }, (draft) => {
    draft.value = value
  })
  bytes.fill(99)
  const actual = changes.value as typeof value
  expect(actual).not.toBe(value)
  expectDetachedBinaryClone(actual, expected)
}

oracleProperty({
  id: `proxy.binary-detachment`,
  law: {
    statement: `An assigned ArrayBuffer, DataView or typed array is detached from caller ownership with its entire backing buffer and view range preserved.`,
    authority: `src/proxy.ts draft-to-stored-row value boundary contract stated above; native structuredClone is the independent formulation`,
    limits: `ArrayBuffer, DataView, Uint8Array and BigInt64Array over one 24-byte local buffer; subclasses and shared, resizable or detached buffers are outside this matrix.`,
  },
  owns: [`src/proxy.ts`],
  histories: binaryKinds,
  label: (kind) =>
    `detaches assigned ${kind} without losing buffer bytes or view range`,
  resolve: (kind) => ({ kind }),
  model: recordedAssertionJudgment,
  driver: (plan, observe) =>
    recordAssertionJudgment(`proxy.binary-detachment`, plan, observe, () =>
      runBinaryDetachment(plan.kind),
    ),
  check: forwardAssertionJudgment,
})

// Construction compatibility has two independent axes: built-in versus
// length-sensitive subclass, and local versus foreign/shared backing storage.
// Each was accepted before native range preservation. A scalar edit must still
// work, and a newly assigned view must detach without changing its elements.

// Buffer and view are two references to one authored backing store. Copying
// must preserve that graph regardless of property traversal order or realm.
// Shared-memory concurrency is excluded: the caller mutates only after capture.
