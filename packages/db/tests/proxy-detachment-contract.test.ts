import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { withChangeTracking } from '../src/proxy.js'

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

function storedRow<T extends object>(row: T & { id: number }) {
  return createCollection<T & { id: number }>({
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
  })
}

describe(`Mutation result detachment`, () => {
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
