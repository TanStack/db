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

describe(`Mutation result detachment`, () => {
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
