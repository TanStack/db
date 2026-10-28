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
  public readonly url: string

  constructor(url: URL | string) {
    this.url = String(url)
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
    if (this.terminated) {
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

function installWorkerTestEnvironment(behavior: FakeWorkerBehavior = {}): void {
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
  vi.stubGlobal(`location`, { href: `https://example.test/` })
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
})

describe(`openBrowserWASQLiteOPFSDatabase`, () => {
  it(`reports unavailable when the page location is missing`, async () => {
    installWorkerTestEnvironment()
    vi.stubGlobal(`location`, undefined)

    await expect(
      openBrowserWASQLiteOPFSDatabase({ databaseName: `phase-7.sqlite` }),
    ).rejects.toBeInstanceOf(PersistenceUnavailableError)
    expect(FakeWorker.instances).toHaveLength(0)
  })

  // The Worker constructor resolves a relative URL against the document base,
  // which an about:srcdoc frame inherits from its parent. Its own location
  // cannot resolve a path, such as the ones Vite serves source assets from.
  it(`resolves asset URLs against the document base in an about:srcdoc frame`, async () => {
    installWorkerTestEnvironment()
    vi.stubGlobal(`location`, { href: `about:srcdoc` })
    vi.stubGlobal(`document`, {
      baseURI: `https://example.test/app/`,
      querySelector: () => null,
    })

    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `phase-7.sqlite`,
    })
    await database.close?.()

    expect(FakeWorker.instances).toHaveLength(1)
    expect(new URL(FakeWorker.instances[0]!.url).origin).toBe(
      `https://example.test`,
    )
  })

  // An abort during option evaluation rejects the open's failure signal before
  // a worker exists. If the Worker constructor then throws, nothing awaits that
  // signal; it must not surface as an unhandled rejection.
  it(`leaves no unhandled rejection when an aborted open cannot start its worker`, async () => {
    installWorkerTestEnvironment()
    vi.stubGlobal(
      `Worker`,
      class {
        constructor() {
          throw new DOMException(`cross-origin worker`, `SecurityError`)
        }
      },
    )
    const unhandled: Array<unknown> = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on(`unhandledRejection`, onUnhandled)
    const controller = new AbortController()

    try {
      await expect(
        openBrowserWASQLiteOPFSDatabase({
          databaseName: `phase-7.sqlite`,
          timeoutMs: 0,
          signal: controller.signal,
          get vfsName() {
            controller.abort()
            return `opfs`
          },
        }),
      ).rejects.toBeInstanceOf(PersistenceUnavailableError)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).toEqual([])
    } finally {
      process.off(`unhandledRejection`, onUnhandled)
    }
  })

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
