import { createCollection, createTransaction } from '@tanstack/db'
import { describe, expect, it, vi } from 'vitest'
import { createOptimisticHold } from '../src/executor/OptimisticHold'
import type { Collection, PendingMutation } from '@tanstack/db'

interface TestItem {
  id: string
  value: string
}

function makeCollection(id: string): Collection<TestItem, string> {
  return createCollection<TestItem, string>({
    id,
    getKey: (item) => item.id,
    startSync: true,
    sync: {
      sync: ({ markReady }) => {
        markReady()
      },
    },
  })
}

async function makeCommittedMutations(
  first: Collection<TestItem, string>,
  second: Collection<TestItem, string>,
): Promise<Array<PendingMutation>> {
  const source = createTransaction({
    autoCommit: false,
    mutationFn: async () => {},
  })
  source.mutate(() => {
    first.insert({ id: `first`, value: `first` })
    second.insert({ id: `second`, value: `second` })
  })
  await source.commit()
  await Promise.resolve()
  return source.mutations
}

describe(`createOptimisticHold`, () => {
  it(`unwinds every registration when creation fails partway`, async () => {
    const first = makeCollection(`first-collection`)
    const second = makeCollection(`second-collection`)
    const mutations = await makeCommittedMutations(first, second)
    const firstTransactions = new Set(first._state.transactions.keys())
    const secondTransactions = new Set(second._state.transactions.keys())

    const originalRecompute = second._state.recomputeOptimisticState.bind(
      second._state,
    )
    const recompute = vi
      .spyOn(second._state, `recomputeOptimisticState`)
      .mockImplementation((triggeredByUserAction) => {
        if (triggeredByUserAction) {
          throw new Error(`registration failed`)
        }
        return originalRecompute(triggeredByUserAction)
      })

    expect(() => createOptimisticHold(mutations)).toThrow(`registration failed`)

    expect(new Set(first._state.transactions.keys())).toEqual(firstTransactions)
    expect(new Set(second._state.transactions.keys())).toEqual(
      secondTransactions,
    )
    expect(first.get(`first`)).toBeUndefined()
    expect(second.get(`second`)).toBeUndefined()
    recompute.mockRestore()
  })

  it(`cleans later collections when one release recompute throws`, async () => {
    const first = makeCollection(`first-release-collection`)
    const second = makeCollection(`second-release-collection`)
    const mutations = await makeCommittedMutations(first, second)
    const hold = createOptimisticHold(mutations)

    expect(first.get(`first`)?.value).toBe(`first`)
    expect(second.get(`second`)?.value).toBe(`second`)

    const originalRecompute = first._state.recomputeOptimisticState.bind(
      first._state,
    )
    const recompute = vi
      .spyOn(first._state, `recomputeOptimisticState`)
      .mockImplementation((triggeredByUserAction) => {
        if (!triggeredByUserAction) {
          throw new Error(`release failed`)
        }
        return originalRecompute(triggeredByUserAction)
      })

    expect(() => hold.release()).toThrow(`release failed`)

    expect(first._state.transactions.has(hold.transaction.id)).toBe(false)
    expect(second._state.transactions.has(hold.transaction.id)).toBe(false)
    expect(second.get(`second`)).toBeUndefined()

    recompute.mockRestore()
    first._state.recomputeOptimisticState(false)
    expect(first.get(`first`)).toBeUndefined()
  })
})
