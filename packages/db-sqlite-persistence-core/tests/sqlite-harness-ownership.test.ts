import { expect, it } from 'vitest'
import { harnessScope } from './contracts/harness-scope'

it.each([false, true])(
  `owns all returned harnesses async=%s`,
  async (asyncCleanup) => {
    const calls: Array<number> = []
    const scope = harnessScope((id: number) => ({
      id,
      cleanup() {
        const record = () => {
          calls.push(this.id)
        }
        return asyncCleanup ? Promise.resolve().then(record) : record()
      },
    }))
    expect(scope.create(1).id).toBe(1)
    expect(scope.create(2).id).toBe(2)
    await scope.cleanup()
    expect(calls).toEqual([2, 1])
    await scope.cleanup()
    expect(calls).toEqual([2, 1])
    scope.create(3)
    await scope.cleanup()
    expect(calls).toEqual([2, 1, 3])
  },
)

it.each(
  [false, true].flatMap((asyncCleanup) =>
    [undefined, `failure`, new Error(`failure`)].map((error) => ({
      asyncCleanup,
      error,
    })),
  ),
)(
  `drains healthy peers and preserves identical failures async=$asyncCleanup error=$error`,
  async ({ asyncCleanup, error }) => {
    const calls: Array<number> = []
    const scope = harnessScope((id: number) => ({
      cleanup: () => {
        calls.push(id)
        if (id === 1) return
        if (asyncCleanup) return Promise.reject(error)
        throw error
      },
    }))
    for (const id of [1, 2, 3]) scope.create(id)
    const result = await scope.cleanup().then(
      () => ({ ok: true as const }),
      (caught: unknown) => ({ ok: false as const, caught }),
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error(`Expected cleanup failure`)
    expect(result.caught).toBeInstanceOf(AggregateError)
    const aggregate = result.caught as AggregateError
    expect(aggregate.errors).toEqual([error, error])
    expect(aggregate.cause).toBe(error)
    expect(calls).toEqual([3, 2, 1])
    await scope.cleanup()
    expect(calls).toEqual([3, 2, 1])
  },
)

it(`waits for an actual cleanup gate before finishing or disposing earlier peers`, async () => {
  let release!: () => void
  let enter!: () => void
  const hold = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  const calls: Array<number> = []
  const scope = harnessScope((id: number) => ({
    cleanup: async () => {
      calls.push(id)
      if (id === 2) {
        enter()
        await hold
      }
    },
  }))
  scope.create(1)
  scope.create(2)
  let finished = false
  const drained = scope.cleanup().then(() => {
    finished = true
  })
  void drained.catch(() => undefined)
  try {
    await entered
    expect(finished).toBe(false)
    expect(calls).toEqual([2])
  } finally {
    release()
    await drained
  }
  expect(finished).toBe(true)
  expect(calls).toEqual([2, 1])
})

it(`keeps a single raw cleanup error and scope ownership independent`, async () => {
  const error = new Error(`one`)
  const scope = harnessScope(() => ({
    cleanup: () => {
      throw error
    },
  }))
  let peerCleanups = 0
  const peer = harnessScope(() => ({
    cleanup: () => {
      peerCleanups++
    },
  }))
  scope.create()
  peer.create()
  await expect(scope.cleanup()).rejects.toBe(error)
  expect(peerCleanups).toBe(0)
  await peer.cleanup()
  expect(peerCleanups).toBe(1)
})
