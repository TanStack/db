import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  InvalidPersistedCollectionConfigError,
  PersistenceUnavailableError,
} from '@tanstack/db-sqlite-persistence-core'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

type FakeWorkerBehavior = {
  pendingRequestType?: BrowserOPFSWorkerRequest[`type`]
  initErrorCode?: BrowserOPFSWorkerErrorCode
  initErrorMessage?: string
  executeRows?: ReadonlyArray<Record<string, unknown>>
  closeErrorCode?: BrowserOPFSWorkerErrorCode
  closeErrorMessage?: string
}

class FakeWorker {
  static instances: Array<FakeWorker> = []
  static behavior: FakeWorkerBehavior = {}

  private readonly listeners: {
    message: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
    error: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
    messageerror: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
  } = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  }

  private initialized = false
  public terminated = false
  public requests: Array<BrowserOPFSWorkerRequest> = []

  constructor(..._args: Array<unknown>) {
    FakeWorker.instances.push(this)
  }

  addEventListener(
    type: keyof FakeWorker[`listeners`],
    listener: (event: MessageEvent<BrowserOPFSWorkerResponse>) => void,
  ): void {
    this.listeners[type].add(listener)
  }

  removeEventListener(
    type: keyof FakeWorker[`listeners`],
    listener: (event: MessageEvent<BrowserOPFSWorkerResponse>) => void,
  ): void {
    this.listeners[type].delete(listener)
  }

  terminate(): void {
    this.terminated = true
  }

  postMessage(request: BrowserOPFSWorkerRequest): void {
    this.requests.push(request)
    if (this.terminated) {
      return
    }

    if (request.type === FakeWorker.behavior.pendingRequestType) {
      return
    }

    queueMicrotask(() => {
      const response = this.handleRequest(request)
      this.emitMessage(response)
    })
  }

  private handleRequest(
    request: BrowserOPFSWorkerRequest,
  ): BrowserOPFSWorkerResponse {
    switch (request.type) {
      case `init`: {
        if (FakeWorker.behavior.initErrorCode) {
          return {
            type: `response`,
            requestId: request.requestId,
            ok: false,
            code: FakeWorker.behavior.initErrorCode,
            error:
              FakeWorker.behavior.initErrorMessage ??
              `init failed in fake OPFS worker`,
          }
        }

        this.initialized = true
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
        }
      }
      case `execute`: {
        if (!this.initialized) {
          return {
            type: `response`,
            requestId: request.requestId,
            ok: false,
            code: `INVALID_CONFIG`,
            error: `worker not initialized`,
          }
        }
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
          rows: FakeWorker.behavior.executeRows ?? [{ value: 1 }],
        }
      }
      case `close`: {
        if (FakeWorker.behavior.closeErrorCode) {
          return {
            type: `response`,
            requestId: request.requestId,
            ok: false,
            code: FakeWorker.behavior.closeErrorCode,
            error:
              FakeWorker.behavior.closeErrorMessage ??
              `close failed in fake OPFS worker`,
          }
        }

        this.initialized = false
        return {
          type: `response`,
          requestId: request.requestId,
          ok: true,
        }
      }
    }
  }

  private emitMessage(response: BrowserOPFSWorkerResponse): void {
    for (const listener of this.listeners.message) {
      listener({
        data: response,
      } as MessageEvent<BrowserOPFSWorkerResponse>)
    }
  }
}

const originalWorker = (globalThis as typeof globalThis & { Worker?: unknown })
  .Worker
const originalNavigator = globalThis.navigator

function installWorkerTestEnvironment(
  behavior: FakeWorkerBehavior = {},
): EventTarget {
  const page = new EventTarget()
  vi.stubGlobal(`addEventListener`, page.addEventListener.bind(page))
  vi.stubGlobal(`removeEventListener`, page.removeEventListener.bind(page))
  FakeWorker.instances = []
  FakeWorker.behavior = behavior
  Object.defineProperty(globalThis, `Worker`, {
    value: FakeWorker,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, `navigator`, {
    value: {
      storage: {
        getDirectory: () => Promise.resolve({}),
      },
    },
    configurable: true,
    writable: true,
  })
  return page
}

function restoreWorkerTestEnvironment(): void {
  Object.defineProperty(globalThis, `Worker`, {
    value: originalWorker,
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, `navigator`, {
    value: originalNavigator,
    configurable: true,
    writable: true,
  })
}

afterEach(() => {
  restoreWorkerTestEnvironment()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe(`openBrowserWASQLiteOPFSDatabase`, () => {
  it.each([false, true])(
    `aborts initialization on pagehide (persisted: %s)`,
    async (persisted) => {
      const page = installWorkerTestEnvironment({ pendingRequestType: `init` })
      const opening = openBrowserWASQLiteOPFSDatabase({
        databaseName: `pagehide.sqlite`,
      })
      const rejected = expect(opening).rejects.toMatchObject({
        name: `AbortError`,
      })

      page.dispatchEvent(Object.assign(new Event(`pagehide`), { persisted }))

      // Cleanup must be synchronous: a cached document can be frozen as soon
      // as the pagehide handler returns, before worker messages are delivered.
      expect(FakeWorker.instances[0]?.terminated).toBe(true)
      await rejected
    },
  )

  it(`rejects all pending queries and closes the connection on pagehide`, async () => {
    const page = installWorkerTestEnvironment({ pendingRequestType: `execute` })
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `pagehide.sqlite`,
    })
    const first = expect(database.execute(`SELECT 1`)).rejects.toMatchObject({
      name: `AbortError`,
    })
    const second = expect(database.execute(`SELECT 2`)).rejects.toMatchObject({
      name: `AbortError`,
    })

    page.dispatchEvent(new Event(`pagehide`))

    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    await Promise.all([first, second])
    await expect(database.execute(`SELECT 3`)).rejects.toBeInstanceOf(
      InvalidPersistedCollectionConfigError,
    )
    expect(FakeWorker.instances[0]?.requests).toHaveLength(3)
  })

  it(`aborts a pending close on pagehide`, async () => {
    const page = installWorkerTestEnvironment({ pendingRequestType: `close` })
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `pagehide.sqlite`,
    })
    const rejected = expect(database.close?.()).rejects.toMatchObject({
      name: `AbortError`,
    })

    page.dispatchEvent(new Event(`pagehide`))

    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    await rejected
  })

  it.each([`close`, `init failure`, `pagehide`] as const)(
    `removes the pagehide listener after %s`,
    async (reason) => {
      const page = installWorkerTestEnvironment(
        reason === `init failure`
          ? { initErrorCode: `PERSISTENCE_UNAVAILABLE` }
          : {},
      )
      const add = vi.spyOn(globalThis, `addEventListener`)
      const remove = vi.spyOn(globalThis, `removeEventListener`)
      const opening = openBrowserWASQLiteOPFSDatabase({
        databaseName: `pagehide.sqlite`,
      })
      if (reason === `init failure`) {
        await expect(opening).rejects.toBeInstanceOf(
          PersistenceUnavailableError,
        )
      } else {
        const database = await opening
        if (reason === `close`) {
          await database.close?.()
        } else {
          page.dispatchEvent(new Event(`pagehide`))
        }
      }

      expect(add).toHaveBeenCalledWith(`pagehide`, expect.any(Function))
      expect(remove).toHaveBeenCalledWith(`pagehide`, add.mock.calls[0]?.[1])
    },
  )

  it(`initializes via worker and supports execute + close`, async () => {
    installWorkerTestEnvironment({
      executeRows: [{ id: `1`, title: `from worker` }],
    })

    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    })
    const rows = await database.execute<{ id: string; title: string }>(
      `SELECT 1`,
    )
    expect(rows).toEqual([{ id: `1`, title: `from worker` }])

    await database.close?.()

    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it(`terminates worker when init fails`, async () => {
    installWorkerTestEnvironment({
      initErrorCode: `PERSISTENCE_UNAVAILABLE`,
      initErrorMessage: `sync handles unavailable`,
    })

    await expect(
      openBrowserWASQLiteOPFSDatabase({
        databaseName: `phase-7.sqlite`,
      }),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError)

    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it(`always terminates worker when close fails`, async () => {
    installWorkerTestEnvironment({
      closeErrorCode: `INVALID_CONFIG`,
      closeErrorMessage: `close failure`,
    })

    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    })

    await expect(database.close?.()).rejects.toBeInstanceOf(
      InvalidPersistedCollectionConfigError,
    )
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
  })

  it(`can reopen a database after closing the worker connection`, async () => {
    installWorkerTestEnvironment({
      executeRows: [{ ok: true }],
    })

    const firstDatabase = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    })
    await firstDatabase.close?.()

    const secondDatabase = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    })
    const rows = await secondDatabase.execute<{ ok: boolean }>(`SELECT 1`)
    expect(rows).toEqual([{ ok: true }])
    await secondDatabase.close?.()

    expect(FakeWorker.instances).toHaveLength(2)
    expect(FakeWorker.instances[0]?.terminated).toBe(true)
    expect(FakeWorker.instances[1]?.terminated).toBe(true)
  })
})
