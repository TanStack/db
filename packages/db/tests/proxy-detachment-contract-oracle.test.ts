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
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { withChangeTracking } from '../src/proxy.js'
import { oracleRuns } from './oracle-config.js'
import {
  cycleContainer,
  cycleKinds,
  cycleMember,
  expectCycleSnapshot,
  expectDetachedBinaryClone,
  expectDetachedPayloadJson,
  expectOwnDataProperty,
  storedDataRow,
  storedRow,
} from './proxy-detachment-fixture.js'
import type {
  CycleRow} from './proxy-detachment-fixture.js';

describe(`Mutation result detachment`, () => {
  it.each([`value`, `__proto__`, `constructor`, `toString`])(
    `rejects missing or prototype-changing %s data properties`,
    (key) => {
      expectOwnDataProperty(Object.fromEntries([[key, 1]]), key, 1)
      expect(() => expectOwnDataProperty({}, key, 1)).toThrow()
      const wrong = Object.fromEntries([[key, 1]])
      Object.setPrototypeOf(wrong, { foreign: true })
      expect(() => expectOwnDataProperty(wrong, key, 1)).toThrow()
    },
  )

  it.each(
    [`value`, `__proto__`, `constructor`, `toString`].flatMap((key) =>
      [false, true].map((identitySchema) => ({ key, identitySchema })),
    ),
  )(
    `preserves native own-property histories for $key with schema=$identitySchema`,
    async ({ key, identitySchema }) => {
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
          await tx.isPersisted.promise
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
              await tx.isPersisted.promise
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
    },
  )

  // Contract: a native container's insertion order survives the draft patch
  // and the stored-row publication, even when its members are unchanged.
  // Model: run the same reorder on a fresh native Set or Map.
  // Grammar: Set/Map × replacement/clear-and-readd of two entries.
  // Driver and checkpoint: compare the change patch after the callback and
  // the public Collection row after update() publishes and persists it.

  it.each([20260914, undefined])(
    `preserves JSON data keys on assignment seed=%s`,
    (seed) => {
      fc.assert(
        fc.property(
          fc.constantFrom(`__proto__`, `constructor`, `toString`, `ordinary`),
          fc.integer(),
          fc.boolean(),
          (key, value, nested) => {
            const object = Object.fromEntries([[key, { value }]])
            const payload = nested ? { nested: [object] } : object
            const expected = structuredClone(payload)
            const original = { payload: { before: true } as object }
            const changes = withChangeTracking(original, (draft) => {
              draft.payload = payload
            })
            // JSON data can own a non-function "constructor" field. Do not
            // let the assertion library mistake that field for a class tag.
            expectDetachedPayloadJson(changes.payload, expected)
            const saved = nested
              ? (changes.payload as { nested: Array<object> }).nested[0]!
              : changes.payload!
            expect(Object.hasOwn(saved, key)).toBe(true)
            expect(Object.getPrototypeOf(saved)).toBe(Object.prototype)
            object[key]!.value++
            expectDetachedPayloadJson(changes.payload, expected)
            expect(original).toEqual({ payload: { before: true } })
          },
        ),
        {
          seed,
          numRuns: oracleRuns(100),
          examples: [[`__proto__`, 1, false]],
        },
      )
    },
  )
  it.each(
    cycleKinds.flatMap((kind) =>
      [`before`, `after`].map((edit) => ({ kind, edit })),
    ),
  )(
    `detaches a $kind draft backedge with the scalar edit $edit assignment`,
    async ({ kind, edit }) => {
      const original: CycleRow = { id: 1, count: 0 }
      const collection = storedRow(original)
      let settled: Promise<unknown> | undefined
      try {
        const tx = collection.update(1, (draft) => {
          if (edit === `before`) draft.count = 1
          draft.link = cycleContainer(kind, draft)
          if (edit === `after`) draft.count = 1
        })
        settled = Promise.allSettled([tx.isPersisted.promise])
        expectCycleSnapshot(collection.get(1)!, kind)
        expect(original).toEqual({ id: 1, count: 0 })
        await tx.isPersisted.promise
        await settled
        expectCycleSnapshot(collection.get(1)!, kind)
        expect(original).toEqual({ id: 1, count: 0 })
      } finally {
        await settled
        await collection.cleanup()
      }
    },
  )

  it.each(cycleKinds)(`accepts a native %s cyclic snapshot`, (kind) => {
    const row: CycleRow = { id: 1, count: 1 }
    row.link = cycleContainer(kind, row)
    expectCycleSnapshot(row, kind)
  })

  it.each(
    cycleKinds.flatMap((kind) =>
      [`old-value`, `missing-member`, `broken-backedge`].map((fault) => ({
        kind,
        fault,
      })),
    ),
  )(`rejects $fault in a $kind cyclic snapshot`, ({ kind, fault }) => {
    const row: CycleRow = { id: 1, count: 1 }
    row.link = cycleContainer(kind, row)
    if (fault === `old-value`)
      cycleMember(row.link, kind).owner = { ...row, count: 0 }
    else if (fault === `broken-backedge`)
      cycleMember(row.link, kind).owner = { id: 1, count: 1 }
    else if (row.link instanceof Map || row.link instanceof Set)
      row.link.clear()
    else if (Array.isArray(row.link)) row.link.length = 0
    else Reflect.deleteProperty(row.link, `member`)
    expect(() => expectCycleSnapshot(row, kind)).toThrow()
  })

  // Current behavior, not a promise: a draft copies a row's own enumerable
  // string keys and every own symbol key, enumerable or not. Non-enumerable
  // string keys are not copied. The change record keeps only the written key.
})

// Native binary snapshots preserve the entire backing buffer and view range,
// while detaching caller ownership. Native structuredClone is a second,
// independent formulation for this bounded standard-native value domain.
// Custom typed-array subclasses retain their separately tested construction
// semantics; shared, resizable and detached buffers are outside this matrix.
for (const kind of [`buffer`, `view`, `u8`, `i64`] as const) {
  it(`detaches assigned ${kind} without losing buffer bytes or view range`, () => {
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
  })
}

// Construction compatibility has two independent axes: built-in versus
// length-sensitive subclass, and local versus foreign/shared backing storage.
// Each was accepted before native range preservation. A scalar edit must still
// work, and a newly assigned view must detach without changing its elements.

// Buffer and view are two references to one authored backing store. Copying
// must preserve that graph regardless of property traversal order or realm.
// Shared-memory concurrency is excluded: the caller mutates only after capture.
