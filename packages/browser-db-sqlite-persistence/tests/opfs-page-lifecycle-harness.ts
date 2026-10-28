import { expect, vi } from 'vitest'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

// The fake page and worker that the OPFS page-lifecycle oracle and its scenario
// tests install. They record listeners, held responses, and termination; the
// oracle in `opfs-page-lifecycle-oracle.test.ts` owns the laws they check.

export type RequestKind = BrowserOPFSWorkerRequest[`type`]

export type ReleaseDirection = `fifo` | `reverse`

export type TerminalEventType = `error` | `messageerror`

export type WorkerBehavior = {
  heldResponseType?: RequestKind
  initErrorCode?: BrowserOPFSWorkerErrorCode
  closeErrorCode?: BrowserOPFSWorkerErrorCode
}

export type Settlement = {
  label: string
  status: `fulfilled` | `rejected`
  observation: unknown
}

export type TrackedResult<T> = {
  settlement: Settlement
  value?: T
}

export class ControlledPage {
  private readonly pagehideListeners = new Set<(event: Event) => void>()
  public addCalls = 0
  public removeCalls = 0

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (type !== `pagehide`) return
    this.addCalls++
    this.pagehideListeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (type !== `pagehide`) return
    this.removeCalls++
    this.pagehideListeners.delete(listener)
  }

  dispatchPageHide(persisted: boolean): void {
    const event = Object.assign(new Event(`pagehide`), { persisted })
    for (const listener of [...this.pagehideListeners]) listener(event)
  }

  get listenerCount(): number {
    return this.pagehideListeners.size
  }
}

export class ControlledWorker {
  static instances: Array<ControlledWorker> = []
  static behavior: WorkerBehavior = {}

  private readonly listeners: {
    message: Set<(event: Event) => void>
    error: Set<(event: Event) => void>
    messageerror: Set<(event: Event) => void>
  } = {
    message: new Set(),
    error: new Set(),
    messageerror: new Set(),
  }
  private readonly heldResponses: Array<BrowserOPFSWorkerResponse> = []
  private initialized = false

  public readonly requests: Array<BrowserOPFSWorkerRequest> = []
  public terminationCalls = 0

  constructor(..._args: Array<unknown>) {
    ControlledWorker.instances.push(this)
  }

  addEventListener(
    type: keyof ControlledWorker[`listeners`],
    listener: (event: Event) => void,
  ): void {
    this.listeners[type].add(listener)
  }

  removeEventListener(
    type: keyof ControlledWorker[`listeners`],
    listener: (event: Event) => void,
  ): void {
    this.listeners[type].delete(listener)
  }

  terminate(): void {
    this.terminationCalls++
  }

  postMessage(request: BrowserOPFSWorkerRequest): void {
    this.requests.push(request)
    if (this.terminationCalls > 0) return

    queueMicrotask(() => {
      const response = this.handleRequest(request)
      if (request.type === ControlledWorker.behavior.heldResponseType) {
        this.heldResponses.push(response)
      } else {
        this.emitMessage(response)
      }
    })
  }

  listenerCount(type: keyof ControlledWorker[`listeners`]): number {
    return this.listeners[type].size
  }

  get heldResponseCount(): number {
    return this.heldResponses.length
  }

  releaseHeldResponses(
    count = this.heldResponses.length,
    direction: ReleaseDirection = `fifo`,
  ): void {
    const releaseCount = Math.min(count, this.heldResponses.length)
    if (releaseCount === 0) return
    const responses =
      direction === `fifo`
        ? this.heldResponses.splice(0, releaseCount)
        : this.heldResponses.splice(-releaseCount).reverse()
    for (const response of responses) {
      this.emitMessage(response)
    }
  }

  emitTerminalEvent(type: TerminalEventType): void {
    for (const listener of this.listeners[type]) listener(new Event(type))
  }

  private handleRequest(
    request: BrowserOPFSWorkerRequest,
  ): BrowserOPFSWorkerResponse {
    if (request.type === `init`) {
      if (ControlledWorker.behavior.initErrorCode) {
        return {
          type: `response`,
          requestId: request.requestId,
          ok: false,
          code: ControlledWorker.behavior.initErrorCode,
          error: `controlled init failure`,
        }
      }
      this.initialized = true
      return { type: `response`, requestId: request.requestId, ok: true }
    }

    if (request.type === `execute`) {
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
        rows: [{ sql: request.sql }],
      }
    }

    if (ControlledWorker.behavior.closeErrorCode) {
      return {
        type: `response`,
        requestId: request.requestId,
        ok: false,
        code: ControlledWorker.behavior.closeErrorCode,
        error: `controlled close failure`,
      }
    }
    this.initialized = false
    return { type: `response`, requestId: request.requestId, ok: true }
  }

  private emitMessage(response: BrowserOPFSWorkerResponse): void {
    for (const listener of this.listeners.message) {
      listener({ data: response } as MessageEvent<BrowserOPFSWorkerResponse>)
    }
  }
}

export function installEnvironment(behavior: WorkerBehavior): ControlledPage {
  const page = new ControlledPage()
  ControlledWorker.instances = []
  ControlledWorker.behavior = behavior
  vi.stubGlobal(`Worker`, ControlledWorker)
  vi.stubGlobal(`navigator`, {
    storage: { getDirectory: () => Promise.resolve({}) },
  })
  vi.stubGlobal(`location`, { href: `https://example.test/` })
  vi.stubGlobal(`addEventListener`, page.addEventListener.bind(page))
  vi.stubGlobal(`removeEventListener`, page.removeEventListener.bind(page))
  return page
}

export async function cleanupEnvironment(): Promise<void> {
  for (const worker of ControlledWorker.instances) worker.releaseHeldResponses()
  await Promise.resolve()
  vi.unstubAllGlobals()
  ControlledWorker.instances = []
  ControlledWorker.behavior = {}
}

export function errorObservation(error: unknown): {
  name: string
  message: string
} {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: `NonError`, message: String(error) }
}

export function track<T>(
  label: string,
  promise: Promise<T>,
  fulfilledObservation: (value: T) => unknown,
  ledger: Array<Settlement>,
): Promise<TrackedResult<T>> {
  return promise.then(
    (value) => {
      const settlement: Settlement = {
        label,
        status: `fulfilled`,
        observation: fulfilledObservation(value),
      }
      ledger.push(settlement)
      return { settlement, value }
    },
    (error: unknown) => {
      const settlement: Settlement = {
        label,
        status: `rejected`,
        observation: errorObservation(error),
      }
      ledger.push(settlement)
      return { settlement }
    },
  )
}

export function expectDisposed(
  page: ControlledPage,
  worker: ControlledWorker,
): void {
  expect(worker.terminationCalls).toBe(1)
  expect(worker.listenerCount(`message`)).toBe(0)
  expect(worker.listenerCount(`error`)).toBe(0)
  expect(worker.listenerCount(`messageerror`)).toBe(0)
  expect(page.listenerCount).toBe(0)
  expect(page.addCalls).toBe(1)
  expect(page.removeCalls).toBe(1)
}
