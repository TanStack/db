/**
 * Supplemental examples for the two public surfaces of one live query that
 * the row-materialization laws read but do not judge: the result array
 * `query()` returns and the keyed view `state`.
 *
 * The array is one object for the life of the query. A row view keeps its
 * identity while its key is in the result, so the array changes what a slot
 * holds only when membership or order changes, and that alone is what a
 * reader of the array follows: a publication that changes values wakes the
 * rows it changed, through their own fields, and nobody else. The array is
 * the Collection's to order, and `state` is created by its first read.
 */
import { describe, expect, it, vi } from 'vitest'
import { createCollection } from '@tanstack/db'
import { waitFor } from '@solidjs/testing-library'
import { createMemo, createRoot } from 'solid-js'
import { useLiveQuery } from '../src/useLiveQuery'
import { mockSyncCollectionOptions } from '../../db/tests/utils'

type Row = { id: string; title: string; position: number }
const collectionOf = (rows: Array<Row>) =>
  createCollection(
    mockSyncCollectionOptions<Row>({
      id: `result-array`,
      getKey: (row) => row.id,
      initialData: rows,
      rowUpdateMode: `full`,
    }),
  )
type Collection = ReturnType<typeof collectionOf>
type Message = Parameters<Collection[`utils`][`write`]>[0]
const publish = (collection: Collection, messages: Array<Message>) => {
  collection.utils.begin()
  for (const message of messages) collection.utils.write(message)
  collection.utils.commit()
}
const rows = (): Array<Row> => [
  { id: `a`, title: `a`, position: 0 },
  { id: `b`, title: `b`, position: 1 },
]

describe(`the result array`, () => {
  it(`is one object whose readers follow membership and order, and not values`, async () => {
    const collection = collectionOf(rows())
    try {
      const query = createRoot((dispose) =>
        Object.assign(
          useLiveQuery(() => collection),
          { dispose },
        ),
      )
      try {
        await waitFor(() => expect(query()).toHaveLength(2))
        const array = query()
        const reader = createRoot((dispose) => {
          const runs = { length: 0, first: 0 }
          return {
            runs,
            length: createMemo(() => {
              runs.length++
              return query().length
            }),
            first: createMemo(() => {
              runs.first++
              return query()[0]!.id
            }),
            dispose,
          }
        })
        try {
          expect(reader.length()).toBe(2)
          expect(reader.first()).toBe(`a`)
          expect(reader.runs).toEqual({ length: 1, first: 1 })

          // A value change reaches the row, and wakes nobody who reads the array.
          publish(collection, [
            {
              type: `update`,
              value: { id: `a`, title: `changed`, position: 0 },
            },
          ])
          await waitFor(() => expect(query()[0]!.title).toBe(`changed`))
          expect(query()).toBe(array)
          expect(reader.runs).toEqual({ length: 1, first: 1 })

          // A row joins: both readers follow.
          publish(collection, [
            { type: `insert`, value: { id: `c`, title: `c`, position: 2 } },
          ])
          await waitFor(() => expect(reader.length()).toBe(3))
          expect([...query()].map((row) => row.id)).toEqual([`a`, `b`, `c`])
          const views = [...query()]
          // A row leaves: the first slot now holds another row. It is the
          // view that row already had: a view follows its key, not its slot.
          publish(collection, [{ type: `delete`, key: `a` }])
          await waitFor(() => expect(reader.first()).toBe(`b`))
          expect(reader.length()).toBe(2)
          expect(query()).toBe(array)
          expect([...query()].map((row) => row.id)).toEqual([`b`, `c`])
          expect(query()[0]).toBe(views[1])
          expect(query()[1]).toBe(views[2])
          expect(query()).not.toContain(views[0])
          // A row that returns is a new row: the view it had left with it.
          publish(collection, [
            {
              type: `insert`,
              value: { id: `a`, title: `back`, position: 0 },
            },
          ])
          await waitFor(() => expect(reader.length()).toBe(3))
          expect(query().includes(views[0]!)).toBe(false)
          expect(query().includes(views[1]!)).toBe(true)
          expect(query().includes(views[2]!)).toBe(true)
          expect([...query()].map((row) => row.id).sort()).toEqual([
            `a`,
            `b`,
            `c`,
          ])
          // A view keeps its identity while its row stays in the result.
          const second = query().find((row) => row.id === `c`)!
          publish(collection, [
            {
              type: `update`,
              value: { id: `c`, title: `changed`, position: 2 },
            },
          ])
          await waitFor(() => expect(second.title).toBe(`changed`))
          expect(query().includes(second)).toBe(true)
        } finally {
          reader.dispose()
        }
      } finally {
        query.dispose()
        query.collection.cleanup()
      }
    } finally {
      collection.cleanup()
    }
  })

  it(`is read, not written: a write, a deletion, a redefinition and a freeze are refused`, async () => {
    const collection = collectionOf(rows())
    try {
      const query = createRoot((dispose) =>
        Object.assign(
          useLiveQuery(() => collection),
          { dispose },
        ),
      )
      try {
        await waitFor(() => expect(query()).toHaveLength(2))
        const array = query()
        const first = array[0]!
        const attempts: Array<() => unknown> = [
          () => {
            array[0] = { id: `x`, title: `x`, position: 0 }
          },
          () => delete array[0],
          () => Object.defineProperty(array, `0`, { value: first }),
          () => Object.freeze(array),
          () => array.push({ id: `x`, title: `x`, position: 2 }),
          () => array.sort((one, other) => other.id.localeCompare(one.id)),
        ]
        for (const attempt of attempts) expect(attempt).toThrowError(TypeError)
        expect(Reflect.set(array, `0`, first)).toBe(false)
        expect(array.length).toBe(2)
        expect(array[0]).toBe(first)
        expect([...array].map((row) => row.id)).toEqual([`a`, `b`])
        expect(Object.isFrozen(array)).toBe(false)
        expect(Array.isArray(array)).toBe(true)
        // Reading through the array's own methods works as on any array.
        expect(array.map((row) => row.id).join(``)).toBe(`ab`)
        expect(array.filter((row) => row.id === `b`)).toHaveLength(1)
        expect([...array.entries()]).toHaveLength(2)
      } finally {
        query.dispose()
        query.collection.cleanup()
      }
    } finally {
      collection.cleanup()
    }
  })
})

describe(`the result array, enumerated`, () => {
  it(`is followed by a reader that enumerates it, as by one that indexes it`, async () => {
    const collection = collectionOf(rows())
    try {
      const query = createRoot((dispose) =>
        Object.assign(
          useLiveQuery(() => collection),
          { dispose },
        ),
      )
      try {
        await waitFor(() => expect(query()).toHaveLength(2))
        const reader = createRoot((dispose) => {
          const runs = {
            keys: 0,
            entries: 0,
            names: 0,
            spread: 0,
            own: 0,
            slot: 0,
          }
          return {
            runs,
            keys: createMemo(() => {
              runs.keys++
              return Object.keys(query()).join()
            }),
            entries: createMemo(() => {
              runs.entries++
              return Object.entries(query()).length
            }),
            names: createMemo(() => {
              runs.names++
              let names = ``
              // Enumerated as an object, as a consumer may write it.
              const array: object = query()
              for (const index in array) names += index
              return names
            }),
            spread: createMemo(() => {
              runs.spread++
              return Object.keys({ ...query() }).length
            }),
            // The array's own keys, asked for directly: an array's own keys
            // always include `length`, so no other enumeration needs this
            // read to be followed.
            own: createMemo(() => {
              runs.own++
              return Reflect.ownKeys(query()).length
            }),
            // One slot's descriptor, asked for directly.
            slot: createMemo(() => {
              runs.slot++
              return Object.getOwnPropertyDescriptor(query(), `1`) !== undefined
            }),
            dispose,
          }
        })
        try {
          // Two slots and `length`.
          expect([
            reader.keys(),
            reader.entries(),
            reader.names(),
            reader.spread(),
            reader.own(),
            reader.slot(),
          ]).toEqual([`0,1`, 2, `01`, 2, 3, true])

          // A change in values wakes none of them.
          publish(collection, [
            {
              type: `update`,
              value: { id: `b`, title: `changed`, position: 1 },
            },
          ])
          await waitFor(() => expect(query()[1]!.title).toBe(`changed`))
          expect(reader.runs).toEqual({
            keys: 1,
            entries: 1,
            names: 1,
            spread: 1,
            own: 1,
            slot: 1,
          })

          // A row joins: each reader follows.
          publish(collection, [
            { type: `insert`, value: { id: `c`, title: `c`, position: 2 } },
          ])
          await waitFor(() => expect(reader.keys()).toBe(`0,1,2`))
          expect([
            reader.entries(),
            reader.names(),
            reader.spread(),
            reader.own(),
            reader.slot(),
          ]).toEqual([3, `012`, 3, 4, true])

          // Rows leave until the second slot is gone: the readers of the
          // array follow, and so does the one that asked about that slot.
          publish(collection, [{ type: `delete`, key: `a` }])
          await waitFor(() => expect(reader.keys()).toBe(`0,1`))
          publish(collection, [{ type: `delete`, key: `b` }])
          await waitFor(() => expect(reader.slot()).toBe(false))
          expect([
            reader.keys(),
            reader.entries(),
            reader.names(),
            reader.spread(),
            reader.own(),
          ]).toEqual([`0`, 1, `0`, 1, 2])

          // To none, and back to one. An empty array has no slot to ask
          // about, so there its keys alone carry the follow.
          publish(collection, [{ type: `delete`, key: `c` }])
          await waitFor(() => expect(reader.keys()).toBe(``))
          // An empty array still owns `length`.
          expect(reader.own()).toBe(1)
          publish(collection, [
            { type: `insert`, value: { id: `d`, title: `d`, position: 0 } },
          ])
          await waitFor(() => expect(reader.keys()).toBe(`0`))
          expect([
            reader.entries(),
            reader.names(),
            reader.spread(),
            reader.own(),
          ]).toEqual([1, `0`, 1, 2])
        } finally {
          reader.dispose()
        }
      } finally {
        query.dispose()
        query.collection.cleanup()
      }
    } finally {
      collection.cleanup()
    }
  })
})

describe(`a publication and an untouched row`, () => {
  it(`reads none of a row the publication left as it was`, async () => {
    const collection = collectionOf(rows())
    try {
      const query = createRoot((dispose) =>
        Object.assign(
          useLiveQuery(() => collection),
          { dispose },
        ),
      )
      try {
        await waitFor(() => expect(query()).toHaveLength(2))
        // The row the Collection holds, which is the one the view serves.
        const stored = collection.get(`a`)!
        // Two of its fields are read in tracking scopes, so they are followed.
        const reader = createRoot((dispose) => {
          const view = query()[0]!
          return {
            fields: createMemo(() => `${view.title}${view.position}`),
            dispose,
          }
        })
        try {
          expect(reader.fields()).toBe(`a0`)
          const descriptors = vi.spyOn(Object, `getOwnPropertyDescriptor`)
          const ofStored = () =>
            descriptors.mock.calls.filter(([target]) => target === stored)
              .length
          try {
            const before = ofStored()
            publish(collection, [
              {
                type: `update`,
                value: { id: `b`, title: `changed`, position: 1 },
              },
            ])
            await waitFor(() => expect(query()[1]!.title).toBe(`changed`))
            // The row it already serves is nothing to apply: not one of its
            // fields is read again.
            expect(ofStored()).toBe(before)
            expect(reader.fields()).toBe(`a0`)
          } finally {
            descriptors.mockRestore()
          }
        } finally {
          reader.dispose()
        }
      } finally {
        query.dispose()
        query.collection.cleanup()
      }
    } finally {
      collection.cleanup()
    }
  })
})

describe(`the keyed view`, () => {
  it(`is created by its first read, holds the Collection's rows, and stays with them`, async () => {
    const collection = collectionOf(rows())
    try {
      const query = createRoot((dispose) =>
        Object.assign(
          useLiveQuery(() => collection),
          { dispose },
        ),
      )
      try {
        await waitFor(() => expect(query()).toHaveLength(2))
        const state = query.state
        expect(state).toBeInstanceOf(Map)
        expect([...state.keys()]).toEqual([`a`, `b`])
        // The Collection's own rows, not the views.
        expect(state.get(`a`)).toBe(collection.get(`a`))
        expect(state.get(`a`)).not.toBe(query()[0])

        // A reader in a tracking scope follows it.
        const reader = createRoot((dispose) => {
          const seen: Array<string> = []
          return {
            seen,
            size: createMemo(() => {
              const size = state.size
              seen.push(`size:${size}`)
              return size
            }),
            title: createMemo(() => {
              const title = state.get(`a`)!.title
              seen.push(`title:${title}`)
              return title
            }),
            dispose,
          }
        })
        try {
          expect(reader.size()).toBe(2)
          expect(reader.title()).toBe(`a`)

          publish(collection, [
            {
              type: `update`,
              value: { id: `a`, title: `changed`, position: 0 },
            },
            { type: `insert`, value: { id: `c`, title: `c`, position: 2 } },
          ])
          await waitFor(() => expect(reader.size()).toBe(3))
          expect(reader.title()).toBe(`changed`)
          expect([...state.keys()]).toEqual([`a`, `b`, `c`])
          expect(state.get(`c`)).toBe(collection.get(`c`))

          publish(collection, [{ type: `delete`, key: `b` }])
          await waitFor(() => expect(reader.size()).toBe(2))
          expect(state.has(`b`)).toBe(false)
          expect([...state.keys()]).toEqual([`a`, `c`])
          expect([...query().map((row) => row.id)]).toEqual([`a`, `c`])
          expect(query.state).toBe(state)
          // Each reader re-ran for what it reads, and only then: the size
          // for the two changes in membership, the title for its one change.
          // The order between two readers is the host's to choose.
          expect(
            reader.seen.filter((entry) => entry.startsWith(`size`)),
          ).toEqual([`size:2`, `size:3`, `size:2`])
          expect(
            reader.seen.filter((entry) => entry.startsWith(`title`)),
          ).toEqual([`title:a`, `title:changed`])
        } finally {
          reader.dispose()
        }
      } finally {
        query.dispose()
        query.collection.cleanup()
      }
    } finally {
      collection.cleanup()
    }
  })
})
