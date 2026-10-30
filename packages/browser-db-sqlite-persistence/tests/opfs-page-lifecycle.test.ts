/**
 * Scenario checks for the OPFS page lifecycle: open deadlines, abort during open,
 * and abort during option evaluation. `opfs-page-lifecycle-oracle.test.ts` owns
 * the lifecycle law and its generated histories; these tests pin single timing
 * scenarios with hand-written expectations.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import {
  ControlledWorker,
  cleanupEnvironment,
  expectDisposed,
  installEnvironment,
  track,
} from './opfs-page-lifecycle-harness'
import type { Settlement } from './opfs-page-lifecycle-harness'

afterEach(async () => {
  await cleanupEnvironment()
  vi.useRealTimers()
})

describe(`OPFS page lifecycle oracle`, () => {
  it.each([
    { label: `default`, timeoutMs: undefined, deadline: 30_000 },
    { label: `overridden`, timeoutMs: 40, deadline: 40 },
    { label: `minimum positive`, timeoutMs: 1, deadline: 1 },
  ])(
    `terminates a silent worker at the $label open deadline`,
    async ({ timeoutMs, deadline }) => {
      vi.useFakeTimers()
      const page = installEnvironment({ heldResponseType: `init` })
      const settlements: Array<Settlement> = []
      const opened = track(
        `init`,
        openBrowserWASQLiteOPFSDatabase({
          databaseName: `oracle.sqlite`,
          ...(timeoutMs === undefined ? {} : { timeoutMs }),
        }),
        () => `database`,
        settlements,
      )
      const worker = ControlledWorker.instances[0]!

      await Promise.resolve()
      expect(worker.heldResponseCount).toBe(1)
      await vi.advanceTimersByTimeAsync(deadline - 1)
      expect(settlements).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(settlements).toEqual([
        {
          label: `init`,
          status: `rejected`,
          observation: {
            name: `TimeoutError`,
            message: `Opening browser OPFS database timed out after ${deadline} ms`,
          },
        },
      ])
      expect((await opened).settlement).toEqual(settlements[0])
      expectDisposed(page, worker)

      const terminalLedger = [...settlements]
      worker.releaseHeldResponses()
      await Promise.resolve()
      expect(settlements).toEqual(terminalLedger)
      expect(worker.terminationCalls).toBe(1)
    },
  )

  it(`aborts a pending open and ignores its late worker response`, async () => {
    vi.useFakeTimers()
    const page = installEnvironment({ heldResponseType: `init` })
    const controller = new AbortController()
    const reason = new DOMException(`App stopped opening`, `AbortError`)
    const settlements: Array<Settlement> = []
    const opened = track(
      `init`,
      openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
        timeoutMs: 40,
        signal: controller.signal,
      }),
      () => `database`,
      settlements,
    )
    const worker = ControlledWorker.instances[0]!
    await Promise.resolve()
    expect(worker.heldResponseCount).toBe(1)

    controller.abort(reason)
    expect((await opened).settlement).toEqual({
      label: `init`,
      status: `rejected`,
      observation: { name: `AbortError`, message: `App stopped opening` },
    })
    expectDisposed(page, worker)
    worker.releaseHeldResponses()
    await vi.advanceTimersByTimeAsync(40)
    expect(settlements).toHaveLength(1)
    expect(worker.terminationCalls).toBe(1)
  })

  it(`does not create a worker for an already-aborted open`, async () => {
    const page = installEnvironment({})
    const controller = new AbortController()
    const reason = new DOMException(`App stopped opening`, `AbortError`)
    controller.abort(reason)

    await expect(
      openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason)
    expect(ControlledWorker.instances).toEqual([])
    expect(page.listenerCount).toBe(0)
  })

  it(`observes an abort during synchronous option evaluation`, async () => {
    vi.useFakeTimers()
    const page = installEnvironment({ heldResponseType: `init` })
    const controller = new AbortController()
    const reason = new DOMException(`App stopped opening`, `AbortError`)
    const settlements: Array<Settlement> = []
    let vfsNameReads = 0
    const opened = track(
      `init`,
      openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
        timeoutMs: 0,
        signal: controller.signal,
        get vfsName() {
          vfsNameReads++
          controller.abort(reason)
          return `opfs`
        },
      }),
      () => `database`,
      settlements,
    )
    const worker = ControlledWorker.instances[0]!

    await vi.advanceTimersByTimeAsync(0)
    expect(vfsNameReads).toBe(1)
    expect(worker.requests.map((request) => request.type)).toEqual([`init`])
    expect(settlements).toEqual([
      {
        label: `init`,
        status: `rejected`,
        observation: { name: `AbortError`, message: `App stopped opening` },
      },
    ])
    expect((await opened).settlement).toEqual(settlements[0])
    expectDisposed(page, worker)

    worker.releaseHeldResponses()
    await vi.advanceTimersByTimeAsync(0)
    expect(settlements).toHaveLength(1)
  })

  it(`allows an explicit zero deadline while the worker remains silent`, async () => {
    vi.useFakeTimers()
    const page = installEnvironment({ heldResponseType: `init` })
    const settlements: Array<Settlement> = []
    const opened = track(
      `init`,
      openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
        timeoutMs: 0,
      }),
      () => `database`,
      settlements,
    )
    const worker = ControlledWorker.instances[0]!
    await Promise.resolve()
    expect(worker.heldResponseCount).toBe(1)

    await vi.advanceTimersByTimeAsync(60_000)
    expect(settlements).toEqual([])
    expect(worker.terminationCalls).toBe(0)
    worker.releaseHeldResponses()
    const database = (await opened).value!
    await database.close?.()
    expectDisposed(page, worker)
  })

  it.each([-1, 0.5, Number.POSITIVE_INFINITY, 2_147_483_648])(
    `rejects invalid open deadline %s before creating a worker`,
    async (timeoutMs) => {
      const page = installEnvironment({})
      await expect(
        openBrowserWASQLiteOPFSDatabase({
          databaseName: `oracle.sqlite`,
          timeoutMs,
        }),
      ).rejects.toMatchObject({
        name: `InvalidPersistedCollectionConfigError`,
      })
      expect(ControlledWorker.instances).toEqual([])
      expect(page.listenerCount).toBe(0)
    },
  )

  it(`stops observing the deadline and signal after open succeeds`, async () => {
    vi.useFakeTimers()
    const page = installEnvironment({})
    const controller = new AbortController()
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `oracle.sqlite`,
      timeoutMs: 40,
      signal: controller.signal,
    })
    const worker = ControlledWorker.instances[0]!

    await vi.advanceTimersByTimeAsync(40)
    controller.abort()
    expect(worker.terminationCalls).toBe(0)
    await expect(database.execute(`SELECT 1`)).resolves.toEqual([
      { sql: `SELECT 1` },
    ])
    await database.close?.()
    expectDisposed(page, worker)
  })
})
