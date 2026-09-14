import { expect, it } from 'vitest'
import { DbClient, collectionOptions } from '../src/client.js'

function fixture() {
  const db = new DbClient()
  const make = (id: string) =>
    db.collection(
      collectionOptions({
        id,
        getKey: (row: { id: number; value: number }) => row.id,
        startSync: true,
        sync: {
          sync: ({ begin, write, commit, markReady }) => {
            begin()
            write({ type: 'insert', value: { id: 1, value: 0 } })
            commit()
            markReady()
          },
        },
      }),
    )
  const a = make('a'),
    b = make('b')
  const values = () => [a.get(1)!.value, b.get(1)!.value]
  const edit = (value: number) => {
    const tx = db.createTransaction({
      autoCommit: false,
      mutationFn: () => new Promise(() => {}),
    })
    void tx.isPersisted.promise.catch(() => {})
    db._batch(() => {
      tx.mutate(() => {
        a.update(1, (draft) => {
          draft.value = value
        })
        b.update(1, (draft) => {
          draft.value = value
        })
      })
      void tx.commit()
    })
    return tx
  }
  return { db, a, b, values, edit }
}

it('delivers reentrant changes in the same order to every subscriber', async () => {
  const { db, a, b, values, edit } = fixture()
  let nested = false
  const histories: number[][] = [[], []],
    observations: number[][] = []
  const subscriptions = [
    a.subscribeChanges(
      () => {
        if (!nested) {
          nested = true
          edit(2)
        }
      },
      { includeInitialState: false },
    ),
    ...[a, b].map((collection, index) =>
      collection.subscribeChanges(
        (changes) => {
          histories[index]!.push(...changes.map((change) => change.value.value))
          observations.push(values())
        },
        { includeInitialState: false },
      ),
    ),
  ]
  try {
    edit(1)
    expect(histories).toEqual([
      [1, 2],
      [1, 2],
    ])
    expect(observations.every(([left, right]) => left === right)).toBe(true)
    expect(values()).toEqual([2, 2])
  } finally {
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    await db.cleanup()
  }
})

it('publishes public rollback after every mutation collection has restored its rows', async () => {
  const { db, a, b, values, edit } = fixture()
  const first = edit(1),
    second = edit(2)
  const observations: number[][] = []
  const subscriptions = [a, b].map((collection) =>
    collection.subscribeChanges(() => observations.push(values()), {
      includeInitialState: false,
    }),
  )
  try {
    second.rollback()
    expect(first.state).toBe('persisting')
    expect(observations).toEqual([
      [1, 1],
      [1, 1],
    ])
  } finally {
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    await db.cleanup()
  }
})

it('acknowledges a cohort before receipt callbacks or change listeners run', async () => {
  const { db, a, b, values, edit } = fixture()
  const first = edit(1),
    second = edit(2)
  const states: string[][] = []
  const subscriptions = [a, b].map((collection) =>
    collection.subscribeChanges(
      () => {
        states.push([first.state, second.state])
      },
      { includeInitialState: false },
    ),
  )
  try {
    db._batch(() => {
      first._settle()
      second._settle()
    })
    await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
    expect(
      states.every((pair) => pair.every((state) => state === 'completed')),
    ).toBe(true)
    // Core retains completed snapshots until authoritative sync acknowledges them.
    expect(values()[0]).toBe(values()[1])
  } finally {
    subscriptions.forEach((subscription) => subscription.unsubscribe())
    await db.cleanup()
  }
})
