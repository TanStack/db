import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createCollection } from '../src/collection/index.js'
import { createChangeProxy, withChangeTracking } from '../src/proxy.js'
import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { CollectionConfig } from '../src/types.js'

class Label {
  #text: string
  constructor(text: string) {
    this.#text = text
  }
  read() {
    return this.#text
  }
  rename(text: string) {
    this.#text = text
  }
}

function storedRowOptions<T extends object>(row: T & { id: number }) {
  return {
    getKey: (value) => value.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({ type: `insert`, value: row })
        commit()
        markReady()
      },
    },
    onUpdate: () => Promise.resolve(),
  } satisfies CollectionConfig<T & { id: number }, number>
}

function storedRow<T extends object>(row: T & { id: number }) {
  return createCollection(storedRowOptions(row))
}

function storedDataRow(
  row: Record<string, unknown> & { id: number },
  identitySchema: boolean,
) {
  if (!identitySchema) return storedRow(row)
  const schema: StandardSchemaV1<typeof row, typeof row> = {
    '~standard': {
      version: 1,
      vendor: `identity`,
      validate: (value) => ({ value: value as typeof row }),
    },
  }
  return createCollection({ ...storedRowOptions(row), schema })
}

type CycleKind = `Map` | `Set` | `array` | `object`
type CycleMember = { owner: CycleRow }
type CycleContainer =
  | Map<string, CycleMember>
  | Set<CycleMember>
  | Array<CycleMember>
  | { member: CycleMember }
type CycleRow = { id: number; count: number; link?: CycleContainer }

const cycleKinds: ReadonlyArray<CycleKind> = [`Map`, `Set`, `array`, `object`]

function cycleContainer(kind: CycleKind, owner: CycleRow): CycleContainer {
  const member = { owner }
  if (kind === `Map`) return new Map([[`member`, member]])
  if (kind === `Set`) return new Set([member])
  if (kind === `array`) return [member]
  return { member }
}

function cycleMember(link: CycleContainer | undefined, kind: CycleKind) {
  if (kind === `Map`) {
    expect(link).toBeInstanceOf(Map)
    const map = link as Map<string, CycleMember>
    expect([...map.keys()]).toEqual([`member`])
    return map.get(`member`)!
  }
  if (kind === `Set`) {
    expect(link).toBeInstanceOf(Set)
    const set = link as Set<CycleMember>
    expect(set.size).toBe(1)
    return [...set][0]!
  }
  if (kind === `array`) {
    expect(Array.isArray(link)).toBe(true)
    expect(link).toHaveLength(1)
    return (link as Array<CycleMember>)[0]!
  }
  expect(Object.keys(link!)).toEqual([`member`])
  return (link as { member: CycleMember }).member
}

function expectCycleSnapshot(row: CycleRow, kind: CycleKind) {
  expect(row.id).toBe(1)
  expect(row.count).toBe(1)
  const member = cycleMember(row.link, kind)
  expect(Object.keys(member)).toEqual([`owner`])
  const owner = member.owner
  expect(owner.id).toBe(1)
  expect(owner.count).toBe(1)
  expect(owner.link).toBe(row.link)
  expect(cycleMember(owner.link, kind).owner).toBe(owner)
}

function expectOwnDataProperty(object: object, key: string, value: unknown) {
  expect(Object.hasOwn(object, key)).toBe(true)
  expect(Object.getPrototypeOf(object)).toBe(Object.prototype)
  expect((object as Record<string, unknown>)[key]).toStrictEqual(value)
}

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

  it.each([null, undefined])(
    `reads an assigned %s before a later write`,
    (value) => {
      const original = {
        value: `before` as string | null | undefined,
        read: ``,
      }
      const expected = { ...original }
      const run = (row: typeof original) => {
        row.value = value
        row.read = String(row.value)
      }
      run(expected)
      const changes = withChangeTracking(original, run)
      expect({ ...original, ...changes }).toStrictEqual(expected)
    },
  )

  it.each([`replace`, `delete`] as const)(
    `keeps retired edges retired after %s with and without a surviving alias`,
    async (operation) => {
      type Row = {
        id: number
        child?: { value: number }
        alias?: { value: number }
      }
      for (const survivingAlias of [false, true]) {
        const make = (): Row => {
          const child = { value: 1 }
          return { id: 1, child, ...(survivingAlias ? { alias: child } : {}) }
        }
        const run = (row: Row) => {
          const retired = row.child!
          if (operation === `replace`) row.child = { value: 2 }
          else delete row.child
          retired.value = 3
        }
        const expected = make()
        run(expected)
        const collection = storedRow(make())
        try {
          const tx = collection.update(1, run)
          await tx.isPersisted.promise
          expect(collection.get(1)!.child).toStrictEqual(expected.child)
          expect(collection.get(1)!.alias).toStrictEqual(expected.alias)
        } finally {
          await collection.cleanup()
        }
      }
    },
  )

  it.each(
    ([`Set`, `RegExp`] as const).flatMap((kind) =>
      [false, true].map((nested) => ({ kind, nested })),
    ),
  )(
    `preserves native state across existing $kind replacement and reversion, nested=$nested`,
    async ({ kind, nested }) => {
      const makeNativeValue = (value: number) => {
        if (kind === `Set`) return new Set([{ value }])
        const expression = /x/g
        expression.lastIndex = value
        return expression
      }
      const makeValue = (value: number) =>
        nested ? { nested: makeNativeValue(value) } : makeNativeValue(value)
      const observe = (container: ReturnType<typeof makeValue>) => {
        const value = `nested` in container ? container.nested : container
        return value instanceof Set ? [...value] : value.lastIndex
      }
      for (const values of [[2], [2, 1]]) {
        const make = () => ({ id: 1, value: makeValue(1) })
        const expected = make()
        const original = make()
        const { proxy, getChanges } = createChangeProxy(original)
        for (const value of values) {
          expected.value = makeValue(value)
          proxy.value = makeValue(value)
          const changes = getChanges()
          expect(observe({ ...original, ...changes }.value)).toStrictEqual(
            observe(expected.value),
          )
        }
        const collection = storedRow(make())
        try {
          const tx = collection.update(1, (draft) => {
            for (const value of values) draft.value = makeValue(value)
          })
          await tx.isPersisted.promise
          expect(observe(collection.get(1)!.value)).toStrictEqual(
            observe(expected.value),
          )
        } finally {
          await collection.cleanup()
        }
      }
    },
  )

  it(`preserves array length and present indices independently`, () => {
    for (const length of [0, 1, 3]) {
      for (const mask of [0, 1, 2, 7]) {
        const make = () => {
          const values = new Array<number>(length)
          for (let index = 0; index < length; index++)
            if (mask & (1 << index)) values[index] = index
          return values
        }
        const expected = make()
        const shape = (values: Array<number>) => ({
          length: values.length,
          keys: Object.keys(values),
          visits: values.map((value, index) => [index, value]),
        })
        const { proxy } = createChangeProxy({ values: make() })
        expect(shape(proxy.values)).toStrictEqual(shape(expected))
        const changes = withChangeTracking({ values: [99] }, (draft) => {
          draft.values = make()
        })
        expect(shape(changes.values as Array<number>)).toStrictEqual(
          shape(expected),
        )
      }
    }
  })

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
            expect(JSON.stringify(changes.payload)).toBe(
              JSON.stringify(expected),
            )
            const saved = nested
              ? (changes.payload as { nested: Array<object> }).nested[0]!
              : changes.payload!
            expect(Object.hasOwn(saved, key)).toBe(true)
            expect(Object.getPrototypeOf(saved)).toBe(Object.prototype)
            object[key]!.value++
            expect(JSON.stringify(changes.payload)).toBe(
              JSON.stringify(expected),
            )
            expect(original).toEqual({ payload: { before: true } })
          },
        ),
        { seed, numRuns: 100, examples: [[`__proto__`, 1, false]] },
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

  it(`keeps arbitrary class instances by reference as an explicit isolation exception`, async () => {
    const label = new Label(`before`)
    const collection = storedRow({ id: 1, value: undefined as unknown })
    try {
      const tx = collection.update(1, (draft) => {
        draft.value = label
      })
      expect(collection.get(1)!.value).toBe(label)
      label.rename(`after`)
      expect((collection.get(1)!.value as Label).read()).toBe(`after`)
      await tx.isPersisted.promise
    } finally {
      await collection.cleanup()
    }
  })

  it(`preserves and detaches a regular expression's matching position`, () => {
    const expression = /x/g
    expression.lastIndex = 2
    const changes = withChangeTracking(
      { value: undefined as unknown },
      (draft) => {
        draft.value = expression
      },
    )
    expect((changes.value as RegExp).lastIndex).toBe(2)
    expression.lastIndex = 0
    expect((changes.value as RegExp).lastIndex).toBe(2)
  })

  it.each([`URL`, `class`, `Date`, `RegExp`, `typed-array`] as const)(
    `preserves a newly assigned %s in the stored row`,
    async (kind) => {
      const value =
        kind === `URL`
          ? new URL(`https://example.com/path`)
          : kind === `class`
            ? new Label(`saved`)
            : kind === `Date`
              ? new Date(`2026-01-01T00:00:00Z`)
              : kind === `RegExp`
                ? /saved/gi
                : new Uint8Array([1, 2])
      const collection = storedRow({ id: 1, value: undefined as unknown })
      try {
        const tx = collection.update(1, (draft) => {
          draft.value = value
        })
        const saved = collection.get(1)!.value
        expect(Object.getPrototypeOf(saved)).toBe(Object.getPrototypeOf(value))
        if (value instanceof URL) expect((saved as URL).href).toBe(value.href)
        else if (value instanceof Label)
          expect((saved as Label).read()).toBe(`saved`)
        else expect(saved).toEqual(value)
        await tx.isPersisted.promise
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each([`Date`, `typed-array`] as const)(
    `detaches a known mutable %s after callback return`,
    (kind) => {
      const value = kind === `Date` ? new Date(0) : new Uint8Array([1])
      const changes = withChangeTracking(
        { value: undefined as unknown },
        (draft) => {
          draft.value = value
        },
      )
      if (value instanceof Date) {
        value.setTime(1000)
        expect((changes.value as Date).getTime()).toBe(0)
      } else {
        value[0] = 2
        expect((changes.value as Uint8Array)[0]).toBe(1)
      }
    },
  )

  it(`keeps a stored URL unchanged when the caller later changes its URL`, async () => {
    const value = new URL(`https://example.com/before`)
    const collection = storedRow({ id: 1, value: undefined as unknown })
    try {
      const tx = collection.update(1, (draft) => {
        draft.value = value
      })
      value.pathname = `/after`
      expect((collection.get(1)!.value as URL).pathname).toBe(`/before`)
      await tx.isPersisted.promise
    } finally {
      await collection.cleanup()
    }
  })

  it.each([`Set`, `array`] as const)(
    `can commit a new %s member holding a draft handle`,
    async (kind) => {
      type Row = {
        id: number
        count: number
        s: Set<{ back: Row }>
        arr: Array<{ owner: Row }>
      }
      const collection = storedRow<Row>({
        id: 1,
        count: 0,
        s: new Set(),
        arr: [],
      })
      try {
        const tx = collection.update(1, (draft) => {
          draft.count = 1
          if (kind === `Set`) draft.s.add({ back: draft })
          else draft.arr.push({ owner: draft })
        })
        const saved = collection.get(1)!
        const back =
          kind === `Set`
            ? saved.s.values().next().value!.back
            : saved.arr[0]!.owner
        expect(back.count).toBe(1)
        // The draft becomes a detached snapshot, not the published row wrapper.
        // Its containers must still lead back to that same snapshot.
        expect(kind === `Set` ? back.s : back.arr).toBe(
          kind === `Set` ? saved.s : saved.arr,
        )
        const cycle =
          kind === `Set`
            ? back.s.values().next().value!.back
            : back.arr[0]!.owner
        expect(cycle).toBe(back)
        await tx.isPersisted.promise
      } finally {
        await collection.cleanup()
      }
    },
  )

  it.each(
    ([`scalar`, `object`] as const).flatMap((kind) =>
      ([`object`, `array`, `Map`, `Set`] as const).map((path) => ({
        kind,
        path,
      })),
    ),
  )(
    `omits an untouched $path back-reference on a $kind-only edit`,
    ({ kind, path }) => {
      type Row = {
        count: number
        value: { x: number }
        child?: {
          name: string
          back: Row | Array<Row> | Map<string, Row> | Set<Row>
        }
      }
      const row: Row = { count: 0, value: { x: 0 } }
      row.child = {
        name: `before`,
        back:
          path === `array`
            ? [row]
            : path === `Map`
              ? new Map([[`row`, row]])
              : path === `Set`
                ? new Set([row])
                : row,
      }
      const changes = withChangeTracking(row, (draft) => {
        if (kind === `scalar`) draft.count = 1
        else draft.value = { x: 1 }
      })
      expect(Object.keys(changes)).toEqual([
        kind === `scalar` ? `count` : `value`,
      ])
    },
  )

  it(`keeps a real nested edit even when that child also reaches the row`, () => {
    type Row = { count: number; child?: { name: string; back: Row } }
    const row: Row = { count: 0 }
    row.child = { name: `before`, back: row }
    const changes = withChangeTracking(row, (draft) => {
      draft.count = 1
      draft.child!.name = `after`
    })
    expect((changes.child as NonNullable<Row[`child`]>).name).toBe(`after`)
    expect(row.child.name).toBe(`before`)
  })

  it(`publishes a changed sibling alias even when it has a nested row back-reference`, () => {
    type Child = { name: string; back?: Row }
    type Row = { child: Child; alias: Child }
    const child: Child = { name: `before` }
    const row: Row = { child, alias: child }
    child.back = row
    const changes = withChangeTracking(row, (draft) => {
      draft.alias.name = `after`
    })
    const saved = { ...row, ...changes }
    expect(saved.child.name).toBe(`after`)
    expect(saved.child).toBe(saved.alias)
    expect(child.name).toBe(`before`)
  })
})
