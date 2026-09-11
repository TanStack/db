import { describe, expect, it } from 'vitest'
import { createCollection } from '../src/collection/index.js'
import { createTransaction } from '../src/transactions.js'

type Row = { id: string; rank: number }

describe('configured collection order across optimistic changes', () => {
  it.each([1, -1])(
    'merges inserts and moved updates, then restores rollback order (%s)',
    (direction) => {
      const collection = createCollection<Row, string>({
        getKey: (row) => row.id,
        compare: (a, b) => direction * (a.rank - b.rank),
        startSync: true,
        sync: {
          sync({ begin, write, commit, markReady }) {
            begin()
            for (const row of [
              { id: 'a', rank: 1 },
              { id: 'c', rank: 3 },
              { id: 'e', rank: 5 },
            ]) {
              write({ type: 'insert', value: row })
            }
            commit()
            markReady()
          },
        },
      })
      const original = [...collection.keys()]
      const transaction = createTransaction({
        autoCommit: false,
        mutationFn: async () => {},
      })
      transaction.mutate(() => {
        collection.insert([
          { id: 'd', rank: 3 },
          { id: 'b', rank: 3 },
        ])
        collection.update('a', (draft) => {
          draft.rank = 4
        })
        collection.delete('e')
      })
      const expected =
        direction === 1 ? ['b', 'c', 'd', 'a'] : ['a', 'b', 'c', 'd']
      expect([...collection.keys()]).toEqual(expected)
      expect([...collection.values()].map((row) => row.id)).toEqual(expected)
      expect([...collection.entries()].map(([key]) => key)).toEqual(expected)
      transaction.rollback()
      expect([...collection.keys()]).toEqual(original)
    },
  )
})
