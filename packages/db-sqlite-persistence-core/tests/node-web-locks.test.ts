// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createInProcessWebLocks } from './node-web-locks'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

// Calibrate the replacement host premise independently of any coordinator.
describe(`Node test Web Locks`, () => {
  it(`grants exclusive requests asynchronously in FIFO order and returns callback results`, async () => {
    const locks = createInProcessWebLocks()
    const entered = deferred()
    const gate = deferred()
    const events: Array<number> = []
    const first = locks.request(`same`, async (lock) => {
      expect(lock).toEqual({ name: `same`, mode: `exclusive` })
      events.push(1)
      entered.resolve()
      await gate.promise
      return 42
    })
    const second = locks.request(`same`, () => {
      events.push(2)
      return 43
    })
    const third = locks.request(`same`, () => {
      events.push(3)
      return 44
    })
    expect(events).toEqual([])
    await entered.promise
    expect(events).toEqual([1])
    gate.resolve()
    expect(await Promise.all([first, second, third])).toEqual([42, 43, 44])
    expect(events).toEqual([1, 2, 3])
  })

  it(`removes an aborted queued request without entering its callback`, async () => {
    const locks = createInProcessWebLocks()
    const entered = deferred()
    const gate = deferred()
    const first = locks.request(`same`, async () => {
      entered.resolve()
      await gate.promise
    })
    await entered.promise
    const controller = new AbortController()
    let called = false
    const queued = locks.request(`same`, { signal: controller.signal }, () => {
      called = true
    })
    const reason = new Error(`cancel queued request`)
    const rejected = expect(queued).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
    gate.resolve()
    await first
    await locks.request(`same`, () => {})
    expect(called).toBe(false)
  })

  it(`does not enter a pre-aborted request or retain its name`, async () => {
    const locks = createInProcessWebLocks()
    const reason = new Error(`already cancelled`)
    let called = false
    await expect(
      locks.request(`same`, { signal: AbortSignal.abort(reason) }, () => {
        called = true
      }),
    ).rejects.toBe(reason)
    await locks.request(`same`, () => {})
    expect(called).toBe(false)
  })

  it(`keeps a granted lock until its callback settles despite abort`, async () => {
    const locks = createInProcessWebLocks()
    const controller = new AbortController()
    const entered = deferred()
    const gate = deferred()
    let released = false
    const first = locks.request(
      `same`,
      { signal: controller.signal },
      async () => {
        entered.resolve()
        await gate.promise
        released = true
      },
    )
    await entered.promise
    controller.abort()
    const second = locks.request(`same`, () => {
      expect(released).toBe(true)
    })
    await locks.request(`other`, () => {
      expect(released).toBe(false)
    })
    gate.resolve()
    await Promise.all([first, second])
  })

  it.each([false, true])(
    `releases after callback failure (async=%s)`,
    async (asyncFailure) => {
      const locks = createInProcessWebLocks()
      const reason = new Error(`callback failed`)
      await expect(
        locks.request(`same`, () => {
          if (asyncFailure) return Promise.reject(reason)
          throw reason
        }),
      ).rejects.toBe(reason)
      expect(await locks.request(`same`, () => 42)).toBe(42)
    },
  )

  it.each([
    { mode: `shared` as const },
    { steal: true },
    { ifAvailable: true },
  ])(`rejects unsupported options %j`, async (options) => {
    const locks = createInProcessWebLocks()
    await expect(
      locks.request(`same`, options, () => {}),
    ).rejects.toMatchObject({ name: `NotSupportedError` })
  })
})
