import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCollection } from '../../../../packages/db/src/collection'
import { createPacedMutations } from '../../../../packages/db/src/paced-mutations'
import {
  debounceStrategy,
  throttleStrategy,
  queueStrategy,
} from '../../../../packages/db/src/strategies'
import { mockSyncCollectionOptionsNoInitialState } from '../../../../packages/db/tests/utils'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1000000)
})
afterEach(() => vi.useRealTimers())
async function ready() {
  const collection = createCollection(
    mockSyncCollectionOptionsNoInitialState<{ id: number }>({
      id: 'review-witness',
      getKey: (row) => row.id,
    }),
  )
  const preload = collection.preload()
  collection.utils.begin()
  collection.utils.commit()
  collection.utils.markReady()
  await preload
  return collection
}
for (const [name, factory] of [
  ['debounce', debounceStrategy],
  ['throttle', throttleStrategy],
] as const) {
  it(`${name}: public guide permits at most one persisting transaction`, async () => {
    const collection = await ready()
    const strategy = factory({ wait: 10, leading: true, trailing: true })
    const starts: number[] = []
    let release!: () => void
    const hold = new Promise<void>((resolve) => (release = resolve))
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => {
        collection.insert({ id })
      },
      mutationFn: () => {
        starts.push(Date.now() - 1000000)
        return hold
      },
    })
    const first = mutate(1)
    await vi.advanceTimersByTimeAsync(1)
    const second = mutate(2)
    await vi.advanceTimersByTimeAsync(20)
    try {
      console.log(
        JSON.stringify({
          strategy: name,
          starts,
          states: [first.state, second.state],
        }),
      )
      expect(
        [first, second].filter((tx) => tx.state === 'persisting').length,
        'docs/guides/mutations.md:1099 one persisting transaction at a time',
      ).toBeLessThanOrEqual(1)
    } finally {
      release()
      await Promise.all([first.isPersisted.promise, second.isPersisted.promise])
      strategy.cleanup()
      await collection.cleanup()
    }
  })
}
it('bounded queue design probe: time moves waiting transactions outside maxSize', async () => {
  const collection = await ready()
  const strategy = queueStrategy({ wait: 10, maxSize: 1 })
  const starts: number[] = []
  let release!: () => void
  const hold = new Promise<void>((resolve) => (release = resolve))
  const mutate = createPacedMutations<number, { id: number }>({
    strategy,
    onMutate: (id) => {
      collection.insert({ id })
    },
    mutationFn: ({ transaction }) => {
      starts.push(Date.now() - 1000000)
      return transaction.mutations[0].changes.id === 1
        ? hold
        : Promise.resolve()
    },
  })
  const transactions = []
  try {
    for (let id = 1; id <= 8; id++) {
      transactions.push(mutate(id))
      await vi.advanceTimersByTimeAsync(10)
    }
    expect(transactions.filter((tx) => tx.state === 'pending')).toHaveLength(7)
    expect(transactions.filter((tx) => tx.state === 'failed')).toHaveLength(0)
    release()
    await vi.advanceTimersByTimeAsync(0)
    await Promise.all(transactions.map((tx) => tx.isPersisted.promise))
    expect(starts).toEqual([0, 80, 80, 80, 80, 80, 80, 80])
    console.log(
      JSON.stringify({
        maxSize: 1,
        wait: 10,
        admitted: transactions.length,
        starts,
      }),
    )
  } finally {
    release()
    await vi.advanceTimersByTimeAsync(0)
    strategy.cleanup()
    await collection.cleanup()
  }
})
