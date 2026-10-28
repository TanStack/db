/** Ordinary tests moved from paced-mutations-oracle.test.ts; the oracle file owns the law. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCollection } from '../src/collection'
import { createDeferred } from '../src/deferred'
import { createPacedMutations } from '../src/paced-mutations'
import { createSerialPacer } from '../src/strategies/serial-pacer'
import {
  debounceStrategy,
  queueStrategy,
  throttleStrategy,
} from '../src/strategies'
import { TransactionScope } from '../src/transactions'
import { mockSyncCollectionOptionsNoInitialState } from './utils'
import {
  createReadyCollection,
  observeReceipt,
  origin,
  withCleanup,
} from './paced-mutations-support'
import type { Start } from './paced-mutations-support'
import type { Strategy } from '../src/strategies/types'
import type { Transaction } from '../src/transactions'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(origin)
})
afterEach(() => {
  vi.useRealTimers()
})

/**
 * A callback can throw before returning a persistence promise. The serial
 * pacer's two-call law surfaces that same error and keeps the next eligible
 * callback runnable. This direct scheduler seam isolates the throw boundary;
 * public paced histories below check transaction and receipt behavior.
 */
it(`serial pacing stays usable after a synchronous callback error`, async () => {
  const pacer = createSerialPacer(0)
  const failure = new Error(`callback failed`)
  const starts: Array<number> = []
  expect(() =>
    pacer.schedule(() => {
      throw failure
    }),
  ).toThrow(failure)
  pacer.schedule(() => {
    starts.push(2)
    return Promise.resolve()
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(starts, `second eligible callback starts`).toEqual([2])
})
it(`serial pacing drains a successor scheduled before its callback throws`, async () => {
  const pacer = createSerialPacer(0)
  const failure = new Error(`callback failed`)
  const starts: Array<number> = []
  expect(() =>
    pacer.schedule(() => {
      pacer.schedule(() => {
        starts.push(2)
        return Promise.resolve()
      })
      throw failure
    }),
  ).toThrow(failure)
  await vi.advanceTimersByTimeAsync(0)
  expect(starts, `the reentrant successor remains admitted`).toEqual([2])
})
describe(`paced mutation timeline oracle`, () => {
  it(`drains admitted queue writes after Collection cleanup`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })
    const first = mutate(1)
    const second = mutate(2)
    const firstReceipt = observeReceipt(first)
    const secondReceipt = observeReceipt(second)
    strategy.cleanup()
    await collection.cleanup()
    expect(starts).toEqual([1])
    await vi.advanceTimersByTimeAsync(0)
    expect(starts).toEqual([1])
    await vi.advanceTimersByTimeAsync(10)
    expect(starts).toEqual([1, 2])
    expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
      `fulfilled`,
      `fulfilled`,
    ])
  })
  it(`rejects a mutation after queue cleanup with a disposal reason`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    let starts = 0
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts++
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const admitted = mutate(1)
      const admittedReceipt = observeReceipt(admitted)
      strategy.cleanup()
      const transaction = mutate(2)
      const receipt = observeReceipt(transaction)
      expect(collection.get(1)?.id).toBe(1)
      expect(collection.get(2)).toBeUndefined()
      await vi.advanceTimersByTimeAsync(20)
      expect(starts).toBe(1)
      expect(admittedReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
      expect(transaction.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(receipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `QueueDisposedError` },
      })
    })
  })
  for (const leading of [true, undefined] as const) {
    it(`drops a within-window throttle call when trailing is false and leading is ${String(leading)}`, async () => {
      const collection = await createReadyCollection()
      const strategy = throttleStrategy({ wait: 10, leading, trailing: false })
      const starts: Array<Start> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          starts.push({ at: Date.now() - origin, ids: [id] })
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(4)
        expect(starts).toEqual([{ at: 0, ids: [1] }])
        expect(firstReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })

        const dropped = mutate(2)
        const droppedReceipt = observeReceipt(dropped)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([{ at: 0, ids: [1] }])
        expect(dropped.state).toBe(`failed`)
        expect(collection.get(2)).toBeUndefined()
        expect(droppedReceipt).toMatchObject({
          outcome: `rejected`,
          error: { name: `ThrottleCallDroppedError` },
        })

        await vi.advanceTimersByTimeAsync(10)
        const next = mutate(3)
        const nextReceipt = observeReceipt(next)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([
          { at: 0, ids: [1] },
          { at: 14, ids: [3] },
        ])
        expect(nextReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
  }
  it(`rejects every optimistic call when both throttle edges are disabled`, async () => {
    const collection = await createReadyCollection()
    const strategy = throttleStrategy({
      wait: 10,
      leading: false,
      trailing: false,
    })
    let starts = 0
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts++
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      for (const id of [1, 2]) {
        const transaction = mutate(id)
        const receipt = observeReceipt(transaction)
        await vi.advanceTimersByTimeAsync(10)
        expect(transaction.state).toBe(`failed`)
        expect(collection.get(id)).toBeUndefined()
        expect(receipt).toMatchObject({
          outcome: `rejected`,
          error: { name: `ThrottleCallDroppedError` },
        })
      }
      expect(starts).toBe(0)
    })
  })
  for (const { name, strategyFactory, errorName } of [
    {
      name: `throttle`,
      strategyFactory: () =>
        throttleStrategy({ wait: 10, leading: true, trailing: false }),
      errorName: `ThrottleCallDroppedError`,
    },
    {
      name: `debounce`,
      strategyFactory: () =>
        debounceStrategy({ wait: 10, leading: true, trailing: false }),
      errorName: `DebounceCallDroppedError`,
    },
  ]) {
    it(`a dropped ${name} update preserves the prior same-row write`, async () => {
      const collection = createCollection(
        mockSyncCollectionOptionsNoInitialState<{ id: number; value: number }>({
          id: `paced-${name}-same-row`,
          getKey: (item) => item.id,
        }),
      )
      const preload = collection.preload()
      collection.utils.begin()
      collection.utils.commit()
      collection.utils.markReady()
      await preload
      const strategy = strategyFactory()
      const starts: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<
        number,
        { id: number; value: number }
      >({
        onMutate: (value) => {
          if (value === 1) collection.insert({ id: 1, value })
          else
            collection.update(1, (draft) => {
              draft.value = value
            })
        },
        mutationFn: ({ transaction }) => {
          const value = transaction.mutations[0].changes.value
          if (typeof value !== `number`) throw new Error(`Missing value`)
          starts.push(value)
          if (value === 1)
            return new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(4)
          expect(first.state).toBe(`persisting`)
          const dropped = mutate(2)
          const droppedReceipt = observeReceipt(dropped)
          await vi.advanceTimersByTimeAsync(0)
          expect(droppedReceipt).toMatchObject({
            outcome: `rejected`,
            error: { name: errorName },
          })
          expect(collection.get(1)?.value).toBe(1)
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts).toEqual([1])
          expect(firstReceipt).toMatchObject({
            outcome: `fulfilled`,
            returnedSame: true,
          })
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }
  it(`drains an admitted trailing throttle write after cleanup at its regular edge`, async () => {
    const collection = await createReadyCollection()
    const strategy = throttleStrategy({
      wait: 10,
      leading: false,
      trailing: true,
    })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts.push(Date.now() - origin)
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([])
      expect(transaction.state).toBe(`pending`)
      expect(receipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([10])
      expect(transaction.state).toBe(`completed`)
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  it(`drains a pending debounce write after cleanup at its quiet edge`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({ wait: 10 })
    const starts: Array<Start> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        starts.push({
          at: Date.now() - origin,
          ids: transaction.mutations.map((mutation) => {
            const id = mutation.changes.id
            if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
            return id
          }),
        })
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(4)
      expect(mutate(2)).toBe(transaction)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([])
      expect(transaction.state).toBe(`pending`)
      expect(receipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([{ at: 14, ids: [1, 2] }])
      expect(transaction.state).toBe(`completed`)
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  it(`drains a second leading debounce transaction when trailing is omitted`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({ wait: 10, leading: true })
    const starts: Array<Start> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        starts.push({
          at: Date.now() - origin,
          ids: transaction.mutations.map((mutation) => {
            const id = mutation.changes.id
            if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
            return id
          }),
        })
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(starts).toEqual([{ at: 0, ids: [1] }])
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      const second = mutate(2)
      const secondReceipt = observeReceipt(second)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(4)
      strategy.cleanup()
      await collection.cleanup()
      await vi.advanceTimersByTimeAsync(5)
      expect(starts).toEqual([{ at: 0, ids: [1] }])
      expect(second.state).toBe(`pending`)
      expect(secondReceipt.outcome).toBe(`pending`)
      await vi.advanceTimersByTimeAsync(1)
      expect(starts).toEqual([
        { at: 0, ids: [1] },
        { at: 14, ids: [2] },
      ])
      expect(secondReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  it(`rejects a debounce call dropped inside a leading-only window`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({
      wait: 10,
      leading: true,
      trailing: false,
    })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(starts).toEqual([1])
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      const dropped = mutate(2)
      const droppedReceipt = observeReceipt(dropped)
      await vi.advanceTimersByTimeAsync(0)
      expect(dropped.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(droppedReceipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `DebounceCallDroppedError` },
      })
      await vi.advanceTimersByTimeAsync(10)
      const next = mutate(3)
      const nextReceipt = observeReceipt(next)
      await vi.advanceTimersByTimeAsync(0)
      expect(starts).toEqual([1, 3])
      expect(nextReceipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  for (const leading of [false, undefined] as const) {
    it(`rejects debounce calls when both edges are disabled and leading is ${String(leading)}`, async () => {
      const collection = await createReadyCollection()
      const strategy = debounceStrategy({ wait: 10, leading, trailing: false })
      let starts = 0
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: () => {
          starts++
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        for (const id of [1, 2]) {
          const transaction = mutate(id)
          const receipt = observeReceipt(transaction)
          await vi.advanceTimersByTimeAsync(10)
          expect(transaction.state).toBe(`failed`)
          expect(collection.get(id)).toBeUndefined()
          expect(receipt).toMatchObject({
            outcome: `rejected`,
            error: { name: `DebounceCallDroppedError` },
          })
        }
        expect(starts).toBe(0)
      })
    })
  }
  for (const trailing of [true, false] as const) {
    it(`starts the first leading throttle call at epoch zero with trailing ${String(trailing)}`, async () => {
      vi.setSystemTime(0)
      const collection = await createReadyCollection()
      const strategy = throttleStrategy({ wait: 10, leading: true, trailing })
      const starts: Array<number> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: () => {
          starts.push(Date.now())
          return Promise.resolve()
        },
        strategy,
      })
      await withCleanup(strategy, collection, async () => {
        const transaction = mutate(1)
        const receipt = observeReceipt(transaction)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([0])
        expect(receipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
  }
  it(`keeps queue wait spacing while draining after cleanup`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts.push(Date.now() - origin)
        return Promise.resolve()
      },
      strategy,
    })
    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const second = mutate(2)
      const firstReceipt = observeReceipt(first)
      const secondReceipt = observeReceipt(second)
      strategy.cleanup()
      strategy.cleanup()
      await vi.advanceTimersByTimeAsync(0)
      expect(starts, `starts before wait`).toEqual([0])
      expect(second.state).toBe(`pending`)
      expect(secondReceipt.outcome).toBe(`pending`)
      expect(collection.get(2)?.id).toBe(2)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([0, 10])
      expect([first.state, second.state]).toEqual([`completed`, `completed`])
      expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
    })
  })
  for (const getItemsFrom of [`front`, `back`] as const) {
    it(`drains admitted queue work in ${getItemsFrom} order after cleanup`, async () => {
      const collection = await createReadyCollection()
      const strategy = queueStrategy({ wait: 10, getItemsFrom })
      const started: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          started.push(id)
          if (id === 1) {
            return new Promise<void>((resolve) => {
              releaseFirst = resolve
            })
          }
          return Promise.resolve()
        },
        strategy,
      })

      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const second = mutate(2)
          const third = mutate(3)
          const firstReceipt = observeReceipt(first)
          const secondReceipt = observeReceipt(second)
          const thirdReceipt = observeReceipt(third)
          await vi.advanceTimersByTimeAsync(0)
          expect(started).toEqual([1])
          strategy.cleanup()
          strategy.cleanup()
          await vi.advanceTimersByTimeAsync(20)
          expect(started).toEqual([1])
          expect(second.state).toBe(`pending`)
          expect(collection.get(2)?.id).toBe(2)
          expect(collection.get(3)?.id).toBe(3)

          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
          expect(started, `admitted work after cleanup`).toEqual(
            getItemsFrom === `front` ? [1, 2, 3] : [1, 3, 2],
          )
          expect([first.state, second.state, third.state]).toEqual([
            `completed`,
            `completed`,
            `completed`,
          ])
          expect([
            firstReceipt.outcome,
            secondReceipt.outcome,
            thirdReceipt.outcome,
          ]).toEqual([`fulfilled`, `fulfilled`, `fulfilled`])
          await vi.advanceTimersByTimeAsync(10)
          expect(started, `no write after drain`).toEqual(
            getItemsFrom === `front` ? [1, 2, 3] : [1, 3, 2],
          )

          expect(() =>
            strategy.execute(() => {
              throw new Error(`Disposed queue ran a new callback`)
            }),
          ).toThrowError(`Queue has been cleaned up`)
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }
  it(`holds later queue writes until each prior transaction settles`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const started: Array<number> = []
    const releases = new Map<number, () => void>()
    let releaseFutureWrites = false
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        started.push(id)
        if (releaseFutureWrites || id === 3) return Promise.resolve()
        return new Promise<void>((resolve) => releases.set(id, resolve))
      },
      strategy,
    })

    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const second = mutate(2)
        const third = mutate(3)
        expect(collection.get(1)?.id).toBe(1)
        expect(collection.get(2)?.id).toBe(2)
        expect(collection.get(3)?.id).toBe(3)

        await vi.advanceTimersByTimeAsync(30)
        expect(started).toEqual([1])
        expect([first.state, second.state, third.state]).toEqual([
          `persisting`,
          `pending`,
          `pending`,
        ])

        releases.get(1)?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2])
        expect([first.state, second.state, third.state]).toEqual([
          `completed`,
          `persisting`,
          `pending`,
        ])

        releases.get(2)?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2, 3])
        for (const transaction of [first, second, third]) {
          expect(await transaction.isPersisted.promise).toBe(transaction)
        }
      },
      async () => {
        releaseFutureWrites = true
        for (const resolve of releases.values()) resolve()
        await vi.advanceTimersByTimeAsync(0)
      },
    )
  })
  for (const { maxSize, wait, expectedStarts, expectedStates } of [
    {
      maxSize: 0,
      wait: 0,
      expectedStarts: [],
      expectedStates: [`failed`, `failed`, `failed`],
    },
    {
      maxSize: 1,
      wait: 10,
      expectedStarts: [1, 2],
      expectedStates: [`persisting`, `pending`, `failed`],
    },
    {
      maxSize: 1,
      wait: 0,
      expectedStarts: [1, 2, 3],
      expectedStates: [`persisting`, `pending`, `pending`],
    },
  ]) {
    it(`queue capacity ${maxSize} at wait ${wait} rejects only overflow`, async () => {
      const collection = await createReadyCollection()
      const strategy = queueStrategy({ maxSize, wait })
      const started: Array<number> = []
      const releases: Array<() => void> = []
      const mutate = createPacedMutations<number, { id: number }>({
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].changes.id
          if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
          started.push(id)
          return new Promise<void>((resolve) => releases.push(resolve))
        },
        strategy,
      })

      await withCleanup(
        strategy,
        collection,
        async () => {
          const transactions = [mutate(1), mutate(2), mutate(3)]
          const receipts = transactions.map(observeReceipt)
          await vi.advanceTimersByTimeAsync(0)
          expect(transactions.map((transaction) => transaction.state)).toEqual(
            expectedStates,
          )
          for (const [index, state] of expectedStates.entries()) {
            expect(collection.get(index + 1)?.id).toBe(
              state === `failed` ? undefined : index + 1,
            )
          }
          for (const [index, state] of expectedStates.entries()) {
            if (state === `failed`) {
              expect(
                receipts[index],
                `overflow receipt at admission`,
              ).toMatchObject({
                outcome: `rejected`,
                error: { name: `QueueCapacityExceededError` },
              })
            }
          }
          await vi.advanceTimersByTimeAsync(30)
          for (let index = 0; index < expectedStarts.length; index++) {
            releases[index]?.()
            await vi.advanceTimersByTimeAsync(0)
          }
          expect(started).toEqual(expectedStarts)
          for (const [index, state] of expectedStates.entries()) {
            if (state !== `failed`) {
              expect(
                receipts[index],
                `admitted receipt after drain`,
              ).toMatchObject({
                outcome: `fulfilled`,
                returnedSame: true,
              })
            }
          }
        },
        async () => {
          for (const release of releases) release()
          await vi.advanceTimersByTimeAsync(0)
        },
      )
    })
  }
  it(`queue overflow preserves admitted same-key mutations`, async () => {
    const collection = createCollection(
      mockSyncCollectionOptionsNoInitialState<{ id: number; value: number }>({
        id: `paced-capacity-same-key`,
        getKey: (item) => item.id,
      }),
    )
    const preload = collection.preload()
    collection.utils.begin()
    collection.utils.commit()
    collection.utils.markReady()
    await preload
    const strategy = queueStrategy({ maxSize: 1, wait: 10 })
    const started: Array<number> = []
    const releases: Array<() => void> = []
    const mutate = createPacedMutations<number, { id: number; value: number }>({
      onMutate: (value) => {
        if (value === 1) collection.insert({ id: 1, value })
        else
          collection.update(1, (draft) => {
            draft.value = value
          })
      },
      mutationFn: ({ transaction }) => {
        const value = transaction.mutations[0].changes.value
        if (typeof value !== `number`) throw new Error(`Missing value`)
        started.push(value)
        return new Promise<void>((resolve) => releases.push(resolve))
      },
      strategy,
    })
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const second = mutate(2)
        const overflow = mutate(3)
        const firstReceipt = observeReceipt(first)
        const secondReceipt = observeReceipt(second)
        const overflowReceipt = observeReceipt(overflow)
        await vi.advanceTimersByTimeAsync(0)
        expect([first.state, second.state, overflow.state]).toEqual([
          `persisting`,
          `pending`,
          `failed`,
        ])
        expect(collection.get(1)?.value).toBe(2)
        expect(overflowReceipt, `same-key overflow receipt`).toMatchObject({
          outcome: `rejected`,
          error: { name: `QueueCapacityExceededError` },
        })
        await vi.advanceTimersByTimeAsync(10)
        releases[0]?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(started).toEqual([1, 2])
        expect(firstReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
        expect(secondReceipt.outcome).toBe(`pending`)
        expect(
          collection.get(1)?.value,
          `admitted optimistic update after first settlement`,
        ).toBe(2)
        releases[1]?.()
        await vi.advanceTimersByTimeAsync(0)
        expect(secondReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      },
      async () => {
        for (const release of releases) release()
        await vi.advanceTimersByTimeAsync(0)
      },
    )
  })
  it(`keeps a void-returning custom queue transaction pending until its callback`, async () => {
    const collection = await createReadyCollection()
    let timer: ReturnType<typeof setTimeout> | undefined
    const strategy: Strategy = {
      _type: `queue`,
      execute: (fn) => {
        timer = setTimeout(() => fn(), 10)
      },
      cleanup: () => {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts.push(Date.now() - origin)
        return Promise.resolve()
      },
      strategy,
    })

    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(transaction.state, `custom queue admission`).toBe(`pending`)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([10])
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  it(`keeps a false-returning custom batch transaction pending until its callback`, async () => {
    const collection = await createReadyCollection()
    let timer: ReturnType<typeof setTimeout> | undefined
    const strategy: Strategy = {
      _type: `batch`,
      execute: (fn) => {
        timer = setTimeout(() => fn(), 10)
        return false
      },
      cleanup: () => {
        if (timer !== undefined) clearTimeout(timer)
      },
    }
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: () => {
        starts.push(Date.now() - origin)
        return Promise.resolve()
      },
      strategy,
    })

    await withCleanup(strategy, collection, async () => {
      const transaction = mutate(1)
      const receipt = observeReceipt(transaction)
      expect(transaction.state, `custom batch admission`).toBe(`pending`)
      expect(collection.get(1)?.id).toBe(1)
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([10])
      expect(receipt).toMatchObject({
        outcome: `fulfilled`,
        returnedSame: true,
      })
    })
  })
  it(`uses captured debounce options when reporting a dropped call`, async () => {
    const collection = await createReadyCollection()
    const options = { wait: 10, leading: true, trailing: false }
    const strategy = debounceStrategy(options)
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].changes.id
        if (typeof id !== `number`) throw new Error(`Missing mutation ID`)
        starts.push(id)
        return Promise.resolve()
      },
      strategy,
    })

    await withCleanup(strategy, collection, async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(4)
      expect(firstReceipt.outcome).toBe(`fulfilled`)
      options.trailing = true
      const dropped = mutate(2)
      const droppedReceipt = observeReceipt(dropped)
      await vi.advanceTimersByTimeAsync(0)
      expect(dropped.state).toBe(`failed`)
      expect(collection.get(2)).toBeUndefined()
      expect(droppedReceipt).toMatchObject({
        outcome: `rejected`,
        error: { name: `DebounceCallDroppedError` },
      })
      await vi.advanceTimersByTimeAsync(10)
      expect(starts).toEqual([1])
    })
  })
  it(`strategy factories preserve frozen caller options`, () => {
    const debounceOptions = Object.freeze({ wait: 10 })
    const throttleOptions = Object.freeze({ wait: 10 })
    const queueOptions = Object.freeze({ wait: 10, maxSize: 1 })
    const debounce = debounceStrategy(debounceOptions)
    const throttle = throttleStrategy(throttleOptions)
    const queue = queueStrategy(queueOptions)
    try {
      expect(debounceOptions).toEqual({ wait: 10 })
      expect(throttleOptions).toEqual({ wait: 10 })
      expect(queueOptions).toEqual({ wait: 10, maxSize: 1 })
    } finally {
      debounce.cleanup()
      throttle.cleanup()
      queue.cleanup()
    }
  })
  it(`preserves a trace failure and cleanup failure separately`, async () => {
    const collection = await createReadyCollection()
    const cleanupCollection = vi.spyOn(collection, `cleanup`)
    const cleanupError = new Error(`strategy cleanup failed`)
    const strategy: Strategy = {
      _type: `queue`,
      execute: () => true,
      cleanup: () => {
        throw cleanupError
      },
    }
    const caught: unknown = await withCleanup(strategy, collection, () => {
      expect([{ at: 0, ids: [1] }], `final execution trace`).toEqual([
        { at: 10, ids: [1] },
      ])
      return Promise.resolve()
    }).then(
      () => undefined,
      (error: unknown) => error,
    )

    expect(caught).toBeInstanceOf(AggregateError)
    const aggregate = caught as AggregateError
    expect(aggregate.cause).toMatchObject({ name: `AssertionError` })
    expect((aggregate.cause as Error).message).toContain(
      `final execution trace`,
    )
    expect(aggregate.errors).toEqual([cleanupError])
    expect(cleanupCollection).toHaveBeenCalledTimes(1)
  })
})
// Serialization must compose with timing rather than replace it. A delayed
// throttle start moves its next spacing boundary. A new debounce call moves
// the quiet boundary even if an earlier edge became eligible during the hold.
// These three-call histories distinguish a bare manager lock from that law.
describe(`paced persistence timing after a hold`, () => {
  for (const kind of [`debounce`, `throttle`] as const) {
    it(`${kind} preserves its next time boundary around a delayed write`, async () => {
      const collection = await createReadyCollection()
      const strategy =
        kind === `debounce`
          ? debounceStrategy({ wait: 10, leading: false, trailing: true })
          : throttleStrategy({ wait: 10, leading: true, trailing: true })
      const starts: Array<Start> = []
      let releaseFirst: (() => void) | undefined
      const receipts: Array<ReturnType<typeof observeReceipt>> = []
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const ids = transaction.mutations.map(
            (mutation) => mutation.modified.id,
          )
          starts.push({ at: Date.now() - origin, ids })
          return ids[0] === 1
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          receipts.push(observeReceipt(first))
          await vi.advanceTimersByTimeAsync(kind === `debounce` ? 11 : 1)
          const second = mutate(2)
          receipts.push(observeReceipt(second))
          if (kind === `debounce`) {
            await vi.advanceTimersByTimeAsync(11)
            // t22: a new call invalidates the old t21 quiet edge; now due at t32.
            const third = mutate(3)
            receipts.push(observeReceipt(third))
            expect(third, `one pending transaction while held`).toBe(second)
            await vi.advanceTimersByTimeAsync(1)
            releaseFirst!()
            await vi.advanceTimersByTimeAsync(0)
            expect(starts, `release before renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
            ])
            expect(second.state).toBe(`pending`)
            expect([...collection.keys()].sort()).toEqual([2, 3])
            await vi.advanceTimersByTimeAsync(8)
            expect(starts, `one tick before renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
            ])
            await vi.advanceTimersByTimeAsync(1)
            expect(starts, `renewed quiet edge`).toEqual([
              { at: 10, ids: [1] },
              { at: 32, ids: [2, 3] },
            ])
          } else {
            await vi.advanceTimersByTimeAsync(14)
            // t15: actual execution, rather than the blocked t10 appointment,
            // starts the documented ten-tick minimum spacing for the next write.
            releaseFirst!()
            await vi.advanceTimersByTimeAsync(0)
            expect(starts, `delayed second write`).toEqual([
              { at: 0, ids: [1] },
              { at: 15, ids: [2] },
            ])
            await vi.advanceTimersByTimeAsync(1)
            const third = mutate(3)
            receipts.push(observeReceipt(third))
            expect(collection.get(3)?.id).toBe(3)
            await vi.advanceTimersByTimeAsync(8)
            expect(starts, `one tick before actual-start spacing`).toHaveLength(
              2,
            )
            expect(third.state).toBe(`pending`)
            await vi.advanceTimersByTimeAsync(1)
            expect(starts, `actual-start spacing edge`).toEqual([
              { at: 0, ids: [1] },
              { at: 15, ids: [2] },
              { at: 25, ids: [3] },
            ])
          }
          expect(
            receipts.map((receipt) => receipt.outcome),
            `all admitted callers settle`,
          ).toEqual([`fulfilled`, `fulfilled`, `fulfilled`])
          expect(receipts.every((receipt) => receipt.returnedSame)).toBe(true)
          await vi.advanceTimersByTimeAsync(20)
          expect(starts, `no duplicate callback after drain`).toHaveLength(
            kind === `debounce` ? 2 : 3,
          )
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(40)
        },
      )
    })
  }
})
// A leading-only timer may admit work after its old window while persistence
// is still held. A later within-window dropped call must reject only itself,
// as the existing dropped-call contract requires. Serializing writes exposes
// this admission boundary because the admitted transaction stays pending.
describe(`paced pending admission isolation`, () => {
  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} rejects only the skipped call while an admitted successor waits`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({
        wait: 10,
        leading: true,
        trailing: false,
      })
      const starts: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const id = transaction.mutations[0].modified.id
          starts.push(id)
          return id === 1
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(11)
          const admitted = mutate(2)
          const admittedReceipt = observeReceipt(admitted)
          await vi.advanceTimersByTimeAsync(1)
          const dropped = mutate(3)
          const droppedReceipt = observeReceipt(dropped)
          await vi.advanceTimersByTimeAsync(0)
          expect(
            dropped,
            `dropped call cannot own the admitted receipt`,
          ).not.toBe(admitted)
          expect(
            droppedReceipt,
            `within-window admission rejection`,
          ).toMatchObject({
            outcome: `rejected`,
            error: {
              name:
                factory === debounceStrategy
                  ? `DebounceCallDroppedError`
                  : `ThrottleCallDroppedError`,
            },
          })
          expect(admittedReceipt.outcome, `admitted receipt retained`).toBe(
            `pending`,
          )
          expect(admitted.state, `admitted successor waits`).toBe(`pending`)
          expect(
            [...collection.keys()].sort(),
            `only skipped optimism removed`,
          ).toEqual([1, 2])
          expect(starts, `one persisting transaction`).toEqual([1])
          releaseFirst!()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `admitted successor drains`).toEqual([1, 2])
          expect([firstReceipt.outcome, admittedReceipt.outcome]).toEqual([
            `fulfilled`,
            `fulfilled`,
          ])
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(30)
        },
      )
    })
})
/**
 * A manual rollback settles the public receipt before the held mutation
 * handler has returned. It cannot cancel an already-started backend write.
 * The one-writing-at-a-time promise therefore waits for the old handler's
 * actual completion before starting a distinct-key successor. This three-path
 * grammar covers debounce, throttle, and queue. The model's active-handler
 * count stays one until the first controlled promise resolves; the driver
 * observes that count, receipts, and optimism at rollback and handler release.
 */
describe(`paced persistence after manual rollback`, () => {
  for (const [name, createStrategy] of [
    [
      `debounce`,
      () => debounceStrategy({ wait: 10, leading: true, trailing: true }),
    ],
    [
      `throttle`,
      () => throttleStrategy({ wait: 10, leading: true, trailing: true }),
    ],
    [`queue`, () => queueStrategy({ wait: 10 })],
  ] as const)
    it(`${name} waits for the rolled-back handler to finish before starting another`, async () => {
      const collection = await createReadyCollection()
      const strategy = createStrategy()
      const firstWrite = createDeferred<void>()
      const secondWrite = createDeferred<void>()
      const canceled = new Error(`manual rollback`)
      const starts: Array<number> = []
      const active = new Set<number>()
      const concurrency: Array<number> = []
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: async ({ transaction }) => {
          const id = transaction.mutations[0].modified.id
          starts.push(id)
          active.add(id)
          concurrency.push(active.size)
          await (id === 1 ? firstWrite.promise : secondWrite.promise)
          active.delete(id)
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutate(1)
          const firstReceipt = observeReceipt(first)
          await vi.advanceTimersByTimeAsync(1)
          const second = mutate(2)
          const secondReceipt = observeReceipt(second)
          await vi.advanceTimersByTimeAsync(20)
          expect(starts).toEqual([1])
          first.rollback({ error: canceled, isSecondaryRollback: true })
          await vi.advanceTimersByTimeAsync(0)
          expect(firstReceipt).toMatchObject({
            outcome: `rejected`,
            error: canceled,
          })
          expect(
            secondReceipt.outcome,
            `successor waits for handler completion`,
          ).toBe(`pending`)
          expect(starts, `no overlapping backend handler`).toEqual([1])
          expect([...collection.keys()]).toEqual([2])
          firstWrite.resolve()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `successor begins after handler return`).toEqual([
            1, 2,
          ])
          expect(concurrency, `one active backend handler`).toEqual([1, 1])
          secondWrite.resolve()
          await vi.advanceTimersByTimeAsync(0)
          expect(secondReceipt).toMatchObject({
            outcome: `fulfilled`,
            returnedSame: true,
          })
        },
        async () => {
          firstWrite.resolve()
          secondWrite.resolve()
          await vi.advanceTimersByTimeAsync(30)
        },
      )
    })
})
/**
 * A synchronous onMutate may call its own paced mutation function. The outer
 * call already owns the leading edge, so the nested call joins its pending
 * transaction. Both optimistic rows must be applied before the one handler
 * starts. A later timer must not invoke that completed transaction twice.
 */
describe(`paced admission reentry`, () => {
  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} admits a nested mutation without a second leading write`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({ wait: 10, leading: true, trailing: true })
      const starts: Array<Array<number>> = []
      let nested: Transaction<{ id: number }> | undefined
      const mutate = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => {
          collection.insert({ id })
          if (id === 1) nested = mutate(2)
        },
        mutationFn: ({ transaction }) => {
          starts.push(
            transaction.mutations.map((mutation) => mutation.modified.id),
          )
          return Promise.resolve()
        },
      })
      await withCleanup(strategy, collection, async () => {
        const outer = mutate(1)
        const outerReceipt = observeReceipt(outer)
        expect(nested, `nested admission reached`).toBe(outer)
        expect([...collection.keys()].sort()).toEqual([1, 2])
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `one merged leading write`).toEqual([[1, 2]])
        expect(outerReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `no stale trailing callback`).toEqual([[1, 2]])
        const next = mutate(3)
        const nextReceipt = observeReceipt(next)
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `later admission still works`).toEqual([[1, 2], [3]])
        expect(nextReceipt).toMatchObject({
          outcome: `fulfilled`,
          returnedSame: true,
        })
      })
    })
})
/**
 * One strategy object supplies one timing boundary to two managers. Their
 * transactions cannot merge, so a shared tick must retain both callbacks.
 * Reentry is the shortest history that exposes a leading call replacing a
 * second manager's trailing callback before either receipt settles.
 */
describe(`shared strategy timing across managers`, () => {
  it(`one queue strategy serializes separate managers without merging receipts`, async () => {
    const collection = await createReadyCollection()
    const strategy = queueStrategy({ wait: 10 })
    const starts: Array<number> = []
    let releaseFirst: (() => void) | undefined
    const manager = (hold: boolean) =>
      createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          starts.push(transaction.mutations[0].modified.id)
          return hold
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
    const mutateFirst = manager(true)
    const mutateSecond = manager(false)
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutateFirst(1)
        const second = mutateSecond(2)
        const receipts = [observeReceipt(first), observeReceipt(second)]
        expect(second, `separate manager transactions`).not.toBe(first)
        await vi.advanceTimersByTimeAsync(11)
        expect(starts, `queue waits for the held handler`).toEqual([1])
        releaseFirst!()
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `both managers drain in queue order`).toEqual([1, 2])
        expect(receipts.map((receipt) => receipt.outcome)).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
      },
      async () => {
        releaseFirst?.()
        await vi.advanceTimersByTimeAsync(30)
      },
    )
  })

  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} persists both managers after a reentrant shared tick`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({ wait: 10, leading: true, trailing: true })
      const starts: Array<number> = []
      let second: Transaction<{ id: number }> | undefined
      const mutateSecond = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          starts.push(transaction.mutations[0].modified.id)
          return Promise.resolve()
        },
      })
      const mutateFirst = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => {
          collection.insert({ id })
          second = mutateSecond(2)
        },
        mutationFn: ({ transaction }) => {
          starts.push(transaction.mutations[0].modified.id)
          return Promise.resolve()
        },
      })
      await withCleanup(strategy, collection, async () => {
        const first = mutateFirst(1)
        const firstReceipt = observeReceipt(first)
        expect(second, `reentrant manager admitted`).toBeDefined()
        const secondReceipt = observeReceipt(second!)
        expect(second, `manager transactions remain separate`).not.toBe(first)
        expect([...collection.keys()].sort(), `both optimistic rows`).toEqual([
          1, 2,
        ])
        expect(starts, `leading write starts once`).toEqual([1])
        await vi.advanceTimersByTimeAsync(9)
        expect(starts, `trailing write waits for shared edge`).toEqual([1])
        await vi.advanceTimersByTimeAsync(1)
        expect(starts, `both admitted writes start`).toEqual([1, 2])
        expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `no stale callback`).toEqual([1, 2])
      })
    })

  for (const kind of [`debounce`, `throttle`] as const)
    it(`${kind} retains separate manager writes at one shared trailing edge`, async () => {
      const collection = await createReadyCollection()
      const strategy =
        kind === `debounce`
          ? debounceStrategy({ wait: 10, leading: false, trailing: true })
          : throttleStrategy({ wait: 10, leading: false, trailing: true })
      const starts: Array<Start> = []
      const manager = () =>
        createPacedMutations<number, { id: number }>({
          strategy,
          onMutate: (id) => collection.insert({ id }),
          mutationFn: ({ transaction }) => {
            starts.push({
              at: Date.now() - origin,
              ids: transaction.mutations.map(
                (mutation) => mutation.modified.id,
              ),
            })
            return Promise.resolve()
          },
        })
      const mutateFirst = manager()
      const mutateSecond = manager()
      await withCleanup(strategy, collection, async () => {
        const first = mutateFirst(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(1)
        const second = mutateSecond(2)
        const secondReceipt = observeReceipt(second)
        expect(second, `separate manager receipts`).not.toBe(first)
        await vi.advanceTimersByTimeAsync(8)
        expect(starts, `before shared edge`).toEqual([])
        await vi.advanceTimersByTimeAsync(12)
        expect(starts, `both writes keep their timing`).toEqual(
          kind === `debounce`
            ? [
                { at: 11, ids: [1] },
                { at: 11, ids: [2] },
              ]
            : [
                { at: 10, ids: [1] },
                { at: 20, ids: [2] },
              ],
        )
        expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
      })
    })

  for (const factory of [debounceStrategy, throttleStrategy])
    it(`${factory.name} waits for a shared manager's rolled-back handler before starting another`, async () => {
      const collection = await createReadyCollection()
      const strategy = factory({ wait: 10, leading: true, trailing: true })
      const starts: Array<number> = []
      let releaseFirst: (() => void) | undefined
      const mutateFirst = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          starts.push(transaction.mutations[0].modified.id)
          return new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        },
      })
      const mutateSecond = createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          starts.push(transaction.mutations[0].modified.id)
          return Promise.resolve()
        },
      })
      await withCleanup(
        strategy,
        collection,
        async () => {
          const first = mutateFirst(1)
          const firstReceipt = observeReceipt(first)
          const second = mutateSecond(2)
          const secondReceipt = observeReceipt(second)
          first.rollback({ isSecondaryRollback: true })
          await vi.advanceTimersByTimeAsync(11)
          expect(starts, `timer cannot bypass held handler`).toEqual([1])
          expect(secondReceipt.outcome, `other manager still admitted`).toBe(
            `pending`,
          )
          releaseFirst!()
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `second manager starts after handler release`).toEqual(
            [1, 2],
          )
          expect(firstReceipt.outcome).toBe(`rejected`)
          expect(secondReceipt.outcome).toBe(`fulfilled`)
        },
        async () => {
          releaseFirst?.()
          await vi.advanceTimersByTimeAsync(30)
        },
      )
    })

  it(`shared debounce renews the quiet edge for another manager's eligible write`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({
      wait: 10,
      leading: false,
      trailing: true,
    })
    const starts: Array<Start> = []
    let releaseFirst: (() => void) | undefined
    const manager = () =>
      createPacedMutations<number, { id: number }>({
        strategy,
        onMutate: (id) => collection.insert({ id }),
        mutationFn: ({ transaction }) => {
          const ids = transaction.mutations.map(
            (mutation) => mutation.modified.id,
          )
          starts.push({ at: Date.now() - origin, ids })
          return ids[0] === 1
            ? new Promise<void>((resolve) => {
                releaseFirst = resolve
              })
            : Promise.resolve()
        },
      })
    const mutateFirst = manager()
    const mutateSecond = manager()
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutateFirst(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(11)
        const second = mutateSecond(2)
        const secondReceipt = observeReceipt(second)
        await vi.advanceTimersByTimeAsync(11)
        expect(starts, `second edge waits behind first handler`).toEqual([
          { at: 10, ids: [1] },
        ])
        const third = mutateFirst(3)
        const thirdReceipt = observeReceipt(third)
        await vi.advanceTimersByTimeAsync(2)
        releaseFirst!()
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `new call renews shared quiet edge`).toEqual([
          { at: 10, ids: [1] },
        ])
        await vi.advanceTimersByTimeAsync(8)
        expect(starts, `both managers start after renewed edge`).toEqual([
          { at: 10, ids: [1] },
          { at: 32, ids: [2] },
          { at: 32, ids: [3] },
        ])
        expect(
          [firstReceipt, secondReceipt, thirdReceipt].map(
            (receipt) => receipt.outcome,
          ),
        ).toEqual([`fulfilled`, `fulfilled`, `fulfilled`])
      },
      async () => {
        releaseFirst?.()
        await vi.advanceTimersByTimeAsync(30)
      },
    )
  })
})
/**
 * A failed onMutate that changed no row admits no work and consumes no leading
 * edge. This two-action model starts the next valid call at the same clock
 * instant. The production driver catches the user's original error, then
 * observes the next receipt and handler start before any timer can expire.
 */
describe(`paced admission after an optimistic callback throws`, () => {
  for (const kind of [`debounce`, `throttle`] as const)
    for (const trailing of [false, true])
      it(`${kind} trailing ${trailing} leaves its leading edge available after a failed call`, async () => {
        const collection = await createReadyCollection()
        const strategy =
          kind === `debounce`
            ? debounceStrategy({ wait: 10, leading: true, trailing })
            : throttleStrategy({ wait: 10, leading: true, trailing })
        const failure = new Error(`optimistic callback failed`)
        const starts: Array<number> = []
        const mutate = createPacedMutations<number, { id: number }>({
          strategy,
          onMutate: (id) => {
            if (id === 1) throw failure
            collection.insert({ id })
          },
          mutationFn: ({ transaction }) => {
            starts.push(transaction.mutations[0].modified.id)
            return Promise.resolve()
          },
        })
        await withCleanup(strategy, collection, async () => {
          expect(() => mutate(1)).toThrow(failure)
          const next = mutate(2)
          const receipt = observeReceipt(next)
          await vi.advanceTimersByTimeAsync(0)
          expect(starts, `failed call did not consume leading edge`).toEqual([
            2,
          ])
          expect(receipt).toMatchObject({
            outcome: `fulfilled`,
            returnedSame: true,
          })
        })
      })
})
/**
 * A failed onMutate can change a row before it throws. The reference retains
 * only successful calls. At the throw cut, the failed row is absent and the
 * earlier admitted transaction is still pending. After its timer and any held
 * handler complete, the backend sees only that earlier call. This checks the
 * transaction rollback rule through both paced admission paths.
 */
for (const kind of [`debounce`, `throttle`] as const)
  it(`${kind} keeps an earlier admitted call when a joined callback changes a row then throws`, async () => {
    const collection = await createReadyCollection()
    const strategy =
      kind === `debounce`
        ? debounceStrategy({ wait: 10, leading: false, trailing: true })
        : throttleStrategy({ wait: 10, leading: true, trailing: true })
    const firstWrite = createDeferred<void>()
    const starts: Array<Array<number>> = []
    const failure = new Error(`optimistic callback failed`)
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => {
        collection.insert({ id })
        if (id === 3) throw failure
      },
      mutationFn: ({ transaction }) => {
        const ids = transaction.mutations.map(
          (mutation) => mutation.modified.id,
        )
        starts.push(ids)
        return ids.includes(1) ? firstWrite.promise : Promise.resolve()
      },
    })
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(1)
        const second = mutate(2)
        const secondReceipt = observeReceipt(second)
        expect(() => mutate(3)).toThrow(failure)
        expect(
          collection.get(3),
          `failed row is absent at throw cut`,
        ).toBeUndefined()
        expect(collection.get(2)?.id).toBe(2)
        expect(second.state).toBe(`pending`)
        await vi.advanceTimersByTimeAsync(10)
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `only successful calls reach handlers`).toEqual(
          kind === `debounce` ? [[1, 2]] : [[1], [2]],
        )
        expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
      },
      async () => {
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(30)
      },
    )
  })
/**
 * An admitted leading call is eligible before a later call renews debounce's
 * quiet period. While an older handler runs, the later call can merge into the
 * pending transaction, but cannot revoke its eligible start. The model starts
 * the merged successor when the held handler returns, before the quiet timer.
 */
for (const releaseAt of [12, 24])
  it(`debounce keeps an eligible leading write when the held handler releases at ${releaseAt}`, async () => {
    const collection = await createReadyCollection()
    const strategy = debounceStrategy({
      wait: 10,
      leading: true,
      trailing: true,
    })
    const firstWrite = createDeferred<void>()
    const starts: Array<Array<number>> = []
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const ids = transaction.mutations.map(
          (mutation) => mutation.modified.id,
        )
        starts.push(ids)
        return ids.includes(1) ? firstWrite.promise : Promise.resolve()
      },
    })
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(11)
        const second = mutate(2)
        const secondReceipt = observeReceipt(second)
        await vi.advanceTimersByTimeAsync(1)
        const third = mutate(3)
        expect(third).toBe(second)
        expect(starts).toEqual([[1]])
        await vi.advanceTimersByTimeAsync(releaseAt - 12)
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `leading eligibility survives later call`).toEqual([
          [1],
          [2, 3],
        ])
        expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
        await vi.advanceTimersByTimeAsync(20)
        expect(starts, `renewed quiet timer cannot repeat the write`).toEqual([
          [1],
          [2, 3],
        ])
      },
      async () => {
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(30)
      },
    )
  })
/**
 * A paced manager owns the commit edge. A caller's manual commit attempt on
 * its pending receipt must throw before any backend handler starts or state
 * changes. The scheduled callback still runs once its timer edge and the held
 * predecessor's release both occur. This two-write grammar crosses all three
 * serial strategies and checks starts, state, and receipts at each cut.
 */
for (const kind of [`debounce`, `throttle`, `queue`] as const)
  it(`${kind} rejects manual commit without bypassing paced persistence`, async () => {
    const collection = await createReadyCollection()
    const strategy =
      kind === `debounce`
        ? debounceStrategy({ wait: 10, leading: true, trailing: true })
        : kind === `throttle`
          ? throttleStrategy({ wait: 10, leading: true, trailing: true })
          : queueStrategy({ wait: 0 })
    const firstWrite = createDeferred<void>()
    const starts: Array<number> = []
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => collection.insert({ id }),
      mutationFn: ({ transaction }) => {
        const id = transaction.mutations[0].modified.id
        starts.push(id)
        return id === 1 ? firstWrite.promise : Promise.resolve()
      },
    })
    let second: Transaction<{ id: number }> | undefined
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(0)
        expect(starts).toEqual([1])
        second = mutate(2)
        const secondReceipt = observeReceipt(second)
        expect(second.state).toBe(`pending`)
        expect(() => second!.commit()).toThrow(
          `Paced mutations are committed by their strategy`,
        )
        expect(second.state, `manual attempt cannot start persistence`).toBe(
          `pending`,
        )
        expect(starts).toEqual([1])
        await vi.advanceTimersByTimeAsync(10)
        expect(starts, `the held handler still owns the flight`).toEqual([1])
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(starts, `the scheduled write starts after release`).toEqual([
          1, 2,
        ])
        expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
          `fulfilled`,
          `fulfilled`,
        ])
      },
      async () => {
        firstWrite.resolve()
        if (second?.state === `pending`)
          second.rollback({ isSecondaryRollback: true })
        await vi.advanceTimersByTimeAsync(20)
      },
    )
  })
/**
 * An admitted call after a pending transaction rolls back owns a new
 * persistence obligation. The canceled leading callback may still occupy the
 * serial slot, but it cannot consume the later call's quiet edge. This legal
 * history holds the first handler, cancels its pending successor directly or
 * by same-key cascade, admits a new transaction, then crosses the quiet and
 * handler-release cuts. The independent expectation is backend starts 1 and 3:
 * the first already started, the canceled second never starts, and the third
 * retains its own persistence obligation.
 */
for (const cancellation of [`direct`, `same-key cascade`] as const)
  it(`debounce persists a new call after ${cancellation} cancels its pending leading predecessor`, async () => {
    const collection = await createReadyCollection<{
      id: number
      value: number
    }>([{ id: 1, value: 0 }])
    const strategy = debounceStrategy({
      wait: 10,
      leading: true,
      trailing: true,
    })
    const firstWrite = createDeferred<void>()
    const starts: Array<number> = []
    const canceled = new Error(`pending leading canceled`)
    const mutate = createPacedMutations<number, { id: number; value: number }>({
      strategy,
      onMutate: (value) =>
        collection.update(1, (draft) => {
          draft.value = value
        }),
      mutationFn: ({ transaction }) => {
        const value = transaction.mutations[0].modified.value
        starts.push(value)
        return value === 1 ? firstWrite.promise : Promise.resolve()
      },
    })
    let third: Transaction<{ id: number; value: number }> | undefined
    await withCleanup(
      strategy,
      collection,
      async () => {
        const first = mutate(1)
        const firstReceipt = observeReceipt(first)
        await vi.advanceTimersByTimeAsync(11)
        const second = mutate(2)
        const secondReceipt = observeReceipt(second)
        if (cancellation === `direct`)
          second.rollback({ error: canceled, isSecondaryRollback: true })
        else first.rollback({ error: canceled })
        await vi.advanceTimersByTimeAsync(0)
        expect(secondReceipt.outcome, `pending successor was canceled`).toBe(
          `rejected`,
        )
        third = mutate(3)
        const thirdReceipt = observeReceipt(third)
        expect(third, `a canceled predecessor cannot own later work`).not.toBe(
          second,
        )
        expect(collection.get(1)?.value, `new optimism is retained`).toBe(3)
        await vi.advanceTimersByTimeAsync(10)
        expect(starts, `the first handler still holds persistence`).toEqual([1])
        firstWrite.resolve()
        await vi.advanceTimersByTimeAsync(0)
        expect(
          starts,
          `new transaction starts after both prerequisites`,
        ).toEqual([1, 3])
        expect([
          firstReceipt.outcome,
          secondReceipt.outcome,
          thirdReceipt.outcome,
        ]).toEqual([
          cancellation === `direct` ? `fulfilled` : `rejected`,
          `rejected`,
          `fulfilled`,
        ])
      },
      async () => {
        firstWrite.resolve()
        if (third?.state === `pending`)
          third.rollback({ isSecondaryRollback: true })
        await vi.advanceTimersByTimeAsync(30)
      },
    )
  })
/**
 * A callback that throws before admission returns has no caller-visible
 * transaction receipt. Its newly created empty transaction must leave the
 * scope rather than remain pending forever. The resource witness inspects the
 * owning scope after the throw for both admitted and dropped calls; the public
 * Collection state alone cannot reveal this retained empty object.
 */
for (const admission of [`admitted`, `dropped`, `queued`] as const)
  it(`releases a newly created ${admission} transaction after onMutate throws`, () => {
    const create = vi.spyOn(TransactionScope.prototype, `createTransaction`)
    const failure = new Error(`optimistic callback failed`)
    const strategy =
      admission === `queued`
        ? queueStrategy({ wait: 0 })
        : debounceStrategy({
            wait: 10,
            leading: false,
            trailing: admission === `admitted`,
          })
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: () => {
        throw failure
      },
      mutationFn: () => Promise.resolve(),
    })
    try {
      expect(() => mutate(1)).toThrow(failure)
      const scope = create.mock.instances.at(-1) as unknown as TransactionScope
      const transaction = create.mock.results.at(-1)?.value as Transaction<{
        id: number
      }>
      const retained = (
        scope as unknown as { transactions: Array<Transaction<{ id: number }>> }
      ).transactions
      expect(transaction.state, `failed callback owns no pending work`).toBe(
        `failed`,
      )
      expect(retained, `the scope releases failed admission`).not.toContain(
        transaction,
      )
    } finally {
      const transaction = create.mock.results.at(-1)?.value as
        Transaction<{ id: number }> | undefined
      if (transaction?.state === `pending`) {
        void transaction.isPersisted.promise.catch(() => {})
        transaction.rollback({ isSecondaryRollback: true })
      }
      create.mockRestore()
      strategy.cleanup()
    }
  })
/**
 * Calls merged into one pending paced transaction settle together. When an
 * outer onMutate throws after admitting a nested call, the failed group has no
 * backend attempt and every receipt in that group rejects with the callback
 * error. A later independent call must still persist. The driver observes the
 * rollback immediately, then checks backend starts and receipts after the
 * scheduled edge. This group-failure rule is a product decision for paced
 * reentry; ordinary manual mutate callbacks retain earlier successful calls.
 */
for (const factory of [debounceStrategy, throttleStrategy])
  it(`${factory.name} does not fulfill erased nested intent after an outer callback throws`, async () => {
    const collection = await createReadyCollection()
    const strategy = factory({ wait: 10, leading: true, trailing: true })
    const starts: Array<Array<number>> = []
    const failure = new Error(`outer callback failed`)
    let nested: Transaction<{ id: number }> | undefined
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => {
        collection.insert({ id })
        if (id === 1) {
          nested = mutate(2)
          throw failure
        }
      },
      mutationFn: ({ transaction }) => {
        starts.push(
          transaction.mutations.map((mutation) => mutation.modified.id),
        )
        return Promise.resolve()
      },
    })
    await withCleanup(
      strategy,
      collection,
      async () => {
        expect(() => mutate(1)).toThrow(failure)
        expect(nested, `nested admission returned a receipt`).toBeDefined()
        const receipt = observeReceipt(nested!)
        expect(nested!.state, `the merged group rolls back`).toBe(`failed`)
        expect(
          [...collection.keys()],
          `the failed group has no visible row`,
        ).toEqual([])
        const later = mutate(3)
        const laterReceipt = observeReceipt(later)
        await vi.advanceTimersByTimeAsync(11)
        expect(
          starts,
          `only the later independent call reaches the backend`,
        ).toEqual([[3]])
        expect(receipt).toMatchObject({ outcome: `rejected`, error: failure })
        expect(laterReceipt.outcome).toBe(`fulfilled`)
      },
      async () => {
        if (nested?.state === `pending`)
          nested.rollback({ isSecondaryRollback: true })
        await vi.advanceTimersByTimeAsync(20)
      },
    )
  })
/**
 * An earlier call in the same pending transaction shares the failure. The
 * group has one optimistic lifetime and one backend attempt, so rejecting only
 * the nested call would leave an earlier receipt claiming a partial group.
 * The model rejects both receipts at the throw cut, and a later transaction
 * proves that the strategy did not retain a stale callback.
 */
for (const factory of [debounceStrategy, throttleStrategy])
  it(`${factory.name} does not fulfill erased nested intent in an existing pending transaction`, async () => {
    const collection = await createReadyCollection()
    const strategy = factory({ wait: 10, leading: false, trailing: true })
    const starts: Array<Array<number>> = []
    const failure = new Error(`outer callback failed`)
    let nested: Transaction<{ id: number }> | undefined
    const mutate = createPacedMutations<number, { id: number }>({
      strategy,
      onMutate: (id) => {
        collection.insert({ id })
        if (id === 1) {
          nested = mutate(2)
          throw failure
        }
      },
      mutationFn: ({ transaction }) => {
        starts.push(
          transaction.mutations.map((mutation) => mutation.modified.id),
        )
        return Promise.resolve()
      },
    })
    await withCleanup(strategy, collection, async () => {
      const prior = mutate(0)
      const priorReceipt = observeReceipt(prior)
      expect(() => mutate(1)).toThrow(failure)
      expect(nested, `nested admission returned a receipt`).toBeDefined()
      const nestedReceipt = observeReceipt(nested!)
      expect(prior.state, `the merged group rolls back`).toBe(`failed`)
      expect(
        [...collection.keys()],
        `the failed group has no visible row`,
      ).toEqual([])
      const later = mutate(3)
      const laterReceipt = observeReceipt(later)
      await vi.advanceTimersByTimeAsync(11)
      expect(starts, `only the later transaction persists`).toEqual([[3]])
      expect(priorReceipt).toMatchObject({
        outcome: `rejected`,
        error: failure,
      })
      expect(nestedReceipt).toMatchObject({
        outcome: `rejected`,
        error: failure,
      })
      expect(laterReceipt.outcome).toBe(`fulfilled`)
    })
  })
/**
 * A throttle timer transfers one eligible transaction to serial persistence.
 * A later call while that transaction waits for a held handler joins it. The
 * model has one pending transaction and no timer after the transfer. At the
 * release cut, the handler receives both rows once; no later timer repeats it.
 */
it(`throttle merges a pending serial write without a stale trailing timer`, async () => {
  const collection = await createReadyCollection()
  const strategy = throttleStrategy({ wait: 10, leading: true, trailing: true })
  const firstWrite = createDeferred<void>()
  const starts: Array<Array<number>> = []
  const mutate = createPacedMutations<number, { id: number }>({
    strategy,
    onMutate: (id) => collection.insert({ id }),
    mutationFn: ({ transaction }) => {
      const ids = transaction.mutations.map((mutation) => mutation.modified.id)
      starts.push(ids)
      return ids.includes(1) ? firstWrite.promise : Promise.resolve()
    },
  })
  await withCleanup(
    strategy,
    collection,
    async () => {
      const first = mutate(1)
      const firstReceipt = observeReceipt(first)
      await vi.advanceTimersByTimeAsync(1)
      const second = mutate(2)
      const secondReceipt = observeReceipt(second)
      await vi.advanceTimersByTimeAsync(10)
      const third = mutate(3)
      expect(third).toBe(second)
      expect(second.state).toBe(`pending`)
      expect([...collection.keys()].sort()).toEqual([1, 2, 3])
      firstWrite.resolve()
      await vi.advanceTimersByTimeAsync(0)
      expect(starts, `release starts the one pending transaction`).toEqual([
        [1],
        [2, 3],
      ])
      expect([firstReceipt.outcome, secondReceipt.outcome]).toEqual([
        `fulfilled`,
        `fulfilled`,
      ])
      await vi.advanceTimersByTimeAsync(30)
      expect(starts, `no stale timer repeats the transaction`).toEqual([
        [1],
        [2, 3],
      ])
    },
    async () => {
      firstWrite.resolve()
      await vi.advanceTimersByTimeAsync(30)
    },
  )
})
