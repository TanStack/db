import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createChangeProxy, withChangeTracking } from '../src/proxy.js'

// Drafts preserve native live membership, even if a snapshot iterator would
// make mutation tracking simpler. Nested field edits have separate laws.
describe.each([`Map`, `Set`] as const)(`%s draft iteration`, (kind) => {
  it(`calls a read-only forEach callback once per entry without reporting changes`, () => {
    const values =
      kind === `Map` ? new Map([[1, { x: 1 }]]) : new Set([{ x: 1 }])
    const context = {}
    const callback =
      vi.fn<(value: unknown, key: unknown, collection: unknown) => void>()
    const { proxy: draft, getChanges } = createChangeProxy({ values })
    const draftValues = draft.values
    draftValues.forEach(callback, context)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(getChanges()).toEqual({})
    expect(callback.mock.contexts).toEqual([context])
    const [value, key, collection] = callback.mock.calls[0]!
    expect(collection).toBe(draftValues)
    if (kind === `Set`) expect(key).toBe(value)
  })

  it(`rejects an invalid forEach callback even when empty`, () => {
    const values = kind === `Map` ? new Map() : new Set()
    withChangeTracking({ values }, (draft) => {
      expect(() => draft.values.forEach(null!)).toThrow(TypeError)
    })
  })
  it(`visits entries added before consuming an existing iterator`, () => {
    const values = kind === `Map` ? new Map([[1, 1]]) : new Set([1])
    withChangeTracking({ values }, (draft) => {
      const iterator = draft.values.values()
      if (draft.values instanceof Map) draft.values.set(2, 2)
      else draft.values.add(2)
      expect([...iterator]).toEqual([1, 2])
    })
  })

  it(`skips entries deleted before consuming an existing iterator`, () => {
    const values =
      kind === `Map`
        ? new Map([
            [1, 1],
            [2, 2],
          ])
        : new Set([1, 2])
    withChangeTracking({ values }, (draft) => {
      const iterator = draft.values.values()
      draft.values.delete(2)
      expect([...iterator]).toEqual([1])
    })
  })
})

type Item = { x: number }
const protocols = [`values`, `entries`, `iterator`, `forEach`] as const
type Protocol = (typeof protocols)[number]

function visit(
  values: Map<unknown, Item> | Set<Item>,
  protocol: Protocol,
  callback: (value: Item) => void,
) {
  switch (protocol) {
    case `forEach`:
      values.forEach(callback)
      break
    case `entries`:
      for (const [, value] of values.entries()) callback(value)
      break
    case `values`:
      for (const value of values.values()) callback(value)
      break
    case `iterator`:
      if (values instanceof Map) for (const [, value] of values) callback(value)
      else for (const value of values) callback(value)
  }
}

describe.each([`Map`, `Set`] as const)(`%s nested iteration laws`, (kind) => {
  it.each(protocols)(
    `%s tracks each nested edit once and leaves the input untouched`,
    (protocol) => {
      const input = [{ x: 1 }, { x: 2 }]
      const values =
        kind === `Map`
          ? new Map(input.map((value) => [value.x, value]))
          : new Set(input)
      let visits = 0
      const changes = withChangeTracking({ values }, (draft) => {
        visit(draft.values, protocol, (value) => {
          if (++visits > 2) throw new Error(`An edit reinserted an entry`)
          value.x += 10
        })
      })
      expect(visits).toBe(2)
      expect([...(changes.values as typeof values).values()]).toEqual([
        { x: 11 },
        { x: 12 },
      ])
      expect([...values.values()]).toEqual([{ x: 1 }, { x: 2 }])
    },
  )

  it.each(protocols)(
    `%s can write and revert without revisiting entries or reporting changes`,
    (protocol) => {
      const values =
        kind === `Map` ? new Map([[1, { x: 1 }]]) : new Set([{ x: 1 }])
      let visits = 0
      const changes = withChangeTracking({ values }, (draft) => {
        visit(draft.values, protocol, (value) => {
          if (++visits > 1) throw new Error(`An edit reinserted an entry`)
          value.x = 2
          value.x = 1
        })
      })
      expect(visits).toBe(1)
      expect(changes).toEqual({})
    },
  )

  it.each(protocols)(
    `%s preserves sibling changes when another entry reverts`,
    (protocol) => {
      const values =
        kind === `Map`
          ? new Map([
              [1, { x: 1 }],
              [2, { x: 2 }],
            ])
          : new Set([{ x: 1 }, { x: 2 }])
      let visits = 0
      const changes = withChangeTracking({ values }, (draft) => {
        visit(draft.values, protocol, (value) => {
          if (++visits > 2) throw new Error(`An edit reinserted an entry`)
          const original = value.x
          value.x += 10
          if (original === 2) value.x = original
        })
      })
      expect([...(changes.values as typeof values).values()]).toEqual([
        { x: 11 },
        { x: 2 },
      ])
    },
  )

  it.each(protocols)(
    `%s matches native membership changes during iteration`,
    (protocol) => {
      const run = (values: Map<unknown, Item> | Set<Item>) => {
        const seen: Array<number> = []
        visit(values, protocol, (value) => {
          if (seen.length > 5) throw new Error(`Iteration did not terminate`)
          seen.push(value.x)
          value.x += 10
          if (seen.length === 1) {
            if (values instanceof Map) {
              values.delete(2)
              values.set(3, { x: 3 })
            } else {
              values.delete([...values][1]!)
              values.add({ x: 3 })
            }
          }
        })
        return { seen, values: [...values.values()] }
      }
      const make = () =>
        kind === `Map`
          ? new Map([
              [1, { x: 1 }],
              [2, { x: 2 }],
            ])
          : new Set([{ x: 1 }, { x: 2 }])
      const expected = run(make())
      const changes = withChangeTracking({ values: make() }, (draft) => {
        expect(run(draft.values)).toEqual(expected)
      })
      expect([
        ...(changes.values as Map<unknown, Item> | Set<Item>).values(),
      ]).toEqual(expected.values)
    },
  )

  it(`keeps newly added values private and supports chained mutators`, () => {
    const item = { x: 1 }
    const values = kind === `Map` ? new Map<unknown, Item>() : new Set<Item>()
    const changes = withChangeTracking({ values }, (draft) => {
      if (draft.values instanceof Map) {
        expect(draft.values.set(`a`, item).set(`b`, item)).toBe(draft.values)
        draft.values.get(`a`)!.x = 2
        expect(draft.values.get(`b`)!.x).toBe(2)
      } else {
        expect(draft.values.add(item).add(item)).toBe(draft.values)
        expect(draft.values.has(item)).toBe(true)
        draft.values.values().next().value!.x = 2
        expect(draft.values.size).toBe(1)
      }
    })
    expect(item.x).toBe(1)
    expect(
      [...(changes.values as typeof values).values()].every(
        (value) => value.x === 2,
      ),
    ).toBe(true)
  })
})

it.each(protocols)(
  `Set %s observes clear and re-add after an edit just like a native iterator`,
  (protocol) => {
    const run = (values: Set<Item>) => {
      const seen: Array<number> = []
      visit(values, protocol, (value) => {
        if (seen.length > 2) throw new Error(`Iteration did not terminate`)
        seen.push(value.x)
        if (seen.length === 1) {
          value.x = 3
          values.clear()
          values.add(value)
        }
      })
      return seen
    }
    const expected = run(new Set([{ x: 1 }, { x: 2 }]))
    const changes = withChangeTracking(
      { values: new Set([{ x: 1 }, { x: 2 }]) },
      (draft) => {
        expect(run(draft.values)).toEqual(expected)
      },
    )
    expect(changes.values).toEqual(new Set([{ x: 3 }]))
  },
)

it.each(protocols)(
  `Set %s keys and values expose the same draft handle`,
  (protocol) => {
    const changes = withChangeTracking(
      { values: new Set([{ x: 1 }]) },
      (draft) => {
        const key = draft.values.keys().next().value!
        visit(draft.values, protocol, (value) => expect(value).toBe(key))
        key.x = 2
      },
    )
    expect(changes.values).toEqual(new Set([{ x: 2 }]))
  },
)

it.each([...protocols, `keys`] as const)(
  `Set %s handles retain membership after editing`,
  (protocol) => {
    const changes = withChangeTracking(
      { values: new Set([{ x: 1 }]) },
      (draft) => {
        let visits = 0
        const edit = (value: Item) => {
          if (++visits > 1) throw new Error(`An edit reinserted an entry`)
          value.x = 2
          expect(draft.values.has(value)).toBe(true)
          expect(draft.values.add(value)).toBe(draft.values)
          draft.values.add(value)
          expect(draft.values.size).toBe(1)
          expect(draft.values.delete(value)).toBe(true)
          expect(draft.values.has(value)).toBe(false)
        }
        if (protocol === `keys`)
          for (const value of draft.values.keys()) edit(value)
        else visit(draft.values, protocol, edit)
      },
    )
    expect(changes.values).toEqual(new Set())
  },
)

it(`Map for-of nested writes reach collection.update`, async () => {
  const collection = createCollection<{
    id: number
    values: Map<string, Item>
  }>({
    getKey: (row) => row.id,
    startSync: true,
    sync: {
      sync: ({ begin, write, commit, markReady }) => {
        begin()
        write({
          type: `insert`,
          value: { id: 1, values: new Map([[`a`, { x: 1 }]]) },
        })
        commit()
        markReady()
      },
    },
    onUpdate: async () => {},
  })
  try {
    const tx = collection.update(1, (draft) => {
      for (const [, value] of draft.values) value.x = 2
    })
    expect(tx.mutations[0]?.changes.values).toEqual(new Map([[`a`, { x: 2 }]]))
    expect(collection.get(1)?.values.get(`a`)?.x).toBe(2)
  } finally {
    await collection.cleanup()
  }
})

it.each([`entries`, `values`] as const)(
  `taking one Map %s value does not scan every entry`,
  (protocol) => {
    const { proxy } = createChangeProxy({
      values: new Map(Array.from({ length: 1000 }, (_, i) => [i, i])),
    })
    const values = proxy.values
    let visits = 0
    const original = Map.prototype.entries
    const spy = vi.spyOn(Map.prototype, `entries`).mockImplementation(function (
      this: Map<unknown, unknown>,
    ) {
      const iterator = original.call(this)
      const next = iterator.next.bind(iterator)
      iterator.next = () => {
        const result = next()
        if (!result.done) visits++
        return result
      }
      return iterator
    })
    try {
      values[protocol]().next()
      expect(visits).toBeLessThanOrEqual(1)
    } finally {
      spy.mockRestore()
    }
  },
)
