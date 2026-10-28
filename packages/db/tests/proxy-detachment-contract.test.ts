/**
 * Ordinary detachment regressions for draft values stored in a Collection.
 * The law and its independent model are owned by
 * proxy-detachment-contract-oracle.test.ts, which also runs the generated
 * descriptor-write property. These tests pin literal expectations and do not
 * compare against a model.
 */

import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { createChangeProxy, withChangeTracking } from '../src/proxy.js'
import { Label, storedRow } from './proxy-detachment-fixture.js'

describe(`Mutation result detachment`, () => {
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

  it.each(
    ([`Set`, `Map`] as const).flatMap((kind) =>
      ([`replace`, `clear-and-readd`] as const).map((action) => ({
        kind,
        action,
      })),
    ),
  )(
    `records $kind $action order in draft patches and stored rows`,
    async ({ kind, action }) => {
      const make = (): {
        id: number
        value: Set<string> | Map<string, number>
      } => ({
        id: 1,
        value:
          kind === `Set`
            ? new Set([`a`, `b`])
            : new Map<string, number>([
                [`a`, 1],
                [`b`, 2],
              ]),
      })
      const reorder = (row: ReturnType<typeof make>) => {
        if (kind === `Set`) {
          if (action === `replace`) row.value = new Set([`b`, `a`])
          else {
            const value = row.value as Set<string>
            value.clear()
            value.add(`b`).add(`a`)
          }
        } else if (action === `replace`)
          row.value = new Map<string, number>([
            [`b`, 2],
            [`a`, 1],
          ])
        else {
          const value = row.value as Map<string, number>
          value.clear()
          value.set(`b`, 2).set(`a`, 1)
        }
      }
      const entries = (value: Set<string> | Map<string, number>) => [...value]
      const expected = make()
      reorder(expected)
      const original = make()
      const changes = withChangeTracking(original, reorder)
      expect(Object.hasOwn(changes, `value`)).toBe(true)
      expect(
        entries(changes.value as Set<string> | Map<string, number>),
      ).toEqual(entries(expected.value))
      expect(entries(original.value)).toEqual(entries(make().value))

      const collection = storedRow(make())
      try {
        const tx = collection.update(1, reorder)
        await tx.isPersisted.promise
        expect(entries(collection.get(1)!.value)).toEqual(
          entries(expected.value),
        )
      } finally {
        await collection.cleanup()
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

  it(`includes a changed sibling alias in detached changes even when it has a nested row back-reference`, () => {
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

  it.each([`unchanged`, `nested`] as const)(
    `copies enumerable string keys and every symbol key into a %s draft`,
    (shape) => {
      const tag = Symbol(`tag`)
      const hidden = Symbol(`hidden`)
      const make = () => {
        const value: Record<PropertyKey, unknown> = { id: 1, title: `a` }
        Object.defineProperty(value, `secret`, {
          value: `s`,
          enumerable: false,
          writable: true,
          configurable: true,
        })
        value[tag] = `t`
        Object.defineProperty(value, hidden, {
          value: `h`,
          enumerable: false,
          writable: true,
          configurable: true,
        })
        return value
      }
      const row = shape === `nested` ? { child: make() } : make()
      const { proxy, getChanges } = createChangeProxy(row)
      const draft = (
        shape === `nested` ? (proxy as { child: object }).child : proxy
      ) as Record<PropertyKey, unknown>
      expect(Reflect.ownKeys(draft)).toEqual([`id`, `title`, tag, hidden])
      expect(draft.secret).toBeUndefined()
      expect(draft[tag]).toBe(`t`)
      expect(draft[hidden]).toBe(`h`)
      draft.title = `b`
      expect(Reflect.ownKeys(draft)).toEqual([`id`, `title`, tag, hidden])
      const changes = getChanges() as Record<PropertyKey, unknown>
      expect(Object.keys(changes)).toEqual([
        shape === `nested` ? `child` : `title`,
      ])
    },
  )
})

for (const kind of [
  `length-subclass`,
  `legacy-subclass`,
  `foreign`,
  `shared`,
] as const) {
  it(`keeps ${kind} typed arrays usable and detached`, () => {
    class LengthOnly extends Uint8Array {
      constructor(length: number) {
        if (typeof length !== `number` || arguments.length !== 1)
          throw new TypeError(`one numeric length required`)
        super(length)
      }
    }
    function Legacy(length: number): Uint8Array {
      if (typeof length !== `number`)
        throw new TypeError(`numeric length required`)
      return Reflect.construct(Uint8Array, [length], Legacy) as Uint8Array
    }
    Object.setPrototypeOf(Legacy.prototype, Uint8Array.prototype)
    const value =
      kind === `legacy-subclass`
        ? Legacy(3)
        : kind === `length-subclass`
          ? new LengthOnly(3)
          : kind === `foreign`
            ? (runInNewContext(
                `new Uint8Array(new Uint8Array([7,1,2,3,8]).buffer, 1, 3)`,
              ) as Uint8Array)
            : new Uint8Array(new SharedArrayBuffer(3))
    value.set([1, 2, 3])
    expect(
      withChangeTracking({ value, other: 0 }, (draft) => {
        draft.other = 1
      }),
    ).toEqual({ other: 1 })
    const changes = withChangeTracking({ value: null as unknown }, (draft) => {
      draft.value = value
    })
    const copy = changes.value as Uint8Array
    value.fill(99)
    expect([...copy]).toEqual([1, 2, 3])
    expect(copy).not.toBe(value)
    expect(copy.buffer).not.toBe(value.buffer)
    expect(Object.getPrototypeOf(copy)).toBe(Object.getPrototypeOf(value))
    if (kind === `foreign`) {
      expect(copy.byteOffset).toBe(1)
      expect([...new Uint8Array(copy.buffer)]).toEqual([7, 1, 2, 3, 8])
    }
  })
}

for (const kind of [`local`, `foreign`, `shared`] as const) {
  for (const viewFirst of [false, true]) {
    it(`preserves ${kind} buffer aliases with viewFirst=${viewFirst}`, () => {
      const buffer =
        kind === `local`
          ? new ArrayBuffer(8)
          : kind === `foreign`
            ? (runInNewContext(`new ArrayBuffer(8)`) as ArrayBuffer)
            : new SharedArrayBuffer(8)
      const bytes = new Uint8Array(buffer)
      bytes.set([0, 1, 2, 3, 4, 5, 6, 7])
      const view = new Uint8Array(buffer, 2, 3)
      const value = viewFirst ? { view, buffer } : { buffer, view }
      expect(
        withChangeTracking({ value, other: 0 }, (draft) => {
          draft.other = 1
        }),
      ).toEqual({ other: 1 })
      const changes = withChangeTracking(
        { value: null as unknown },
        (draft) => {
          draft.value = value
        },
      )
      const copy = changes.value as typeof value
      bytes.fill(99)
      expect(copy.buffer).not.toBe(buffer)
      expect(copy.view.buffer).toBe(copy.buffer)
      expect(copy.view.byteOffset).toBe(2)
      expect([...new Uint8Array(copy.buffer)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    })
  }
}

it(`does not classify ordinary tagged data as a native buffer`, () => {
  const value = { [Symbol.toStringTag]: `ArrayBuffer`, marker: 1 }
  const changes = withChangeTracking({ value: null as unknown }, (draft) => {
    draft.value = value
  })
  expect(changes.value).toEqual(value)
  expect(changes.value).not.toBe(value)
})
