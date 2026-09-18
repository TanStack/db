import { fc, test as fcTest } from '@fast-check/vitest'
import { afterEach, describe, expect, vi } from 'vitest'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import type {
  BrowserOPFSWorkerErrorCode,
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

type Database = Awaited<ReturnType<typeof openBrowserWASQLiteOPFSDatabase>>
type RequestKind = BrowserOPFSWorkerRequest[`type`]
type DeliveryOrder = `pagehide-before-response` | `response-before-pagehide`

type PagehideHistory = {
  pending: RequestKind
  delivery: DeliveryOrder
  persisted: boolean
  executeCount: number
}

type FailureHistory = {
  stage: `init` | `close`
  code: BrowserOPFSWorkerErrorCode
}

type WorkerBehavior = {
  heldResponseType?: RequestKind
  initErrorCode?: BrowserOPFSWorkerErrorCode
  closeErrorCode?: BrowserOPFSWorkerErrorCode
}

type Settlement = {
  label: string
  status: `fulfilled` | `rejected`
  observation: unknown
}

type TrackedResult<T> = {
  settlement: Settlement
  value?: T
}

class ControlledPage {
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

class ControlledWorker {
  static instances: Array<ControlledWorker> = []
  static behavior: WorkerBehavior = {}

  private readonly listeners: {
    message: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
    error: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
    messageerror: Set<(event: MessageEvent<BrowserOPFSWorkerResponse>) => void>
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
    listener: (event: MessageEvent<BrowserOPFSWorkerResponse>) => void,
  ): void {
    this.listeners[type].add(listener)
  }

  removeEventListener(
    type: keyof ControlledWorker[`listeners`],
    listener: (event: MessageEvent<BrowserOPFSWorkerResponse>) => void,
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

  releaseHeldResponses(): void {
    for (const response of this.heldResponses.splice(0)) {
      this.emitMessage(response)
    }
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

function installEnvironment(behavior: WorkerBehavior): ControlledPage {
  const page = new ControlledPage()
  ControlledWorker.instances = []
  ControlledWorker.behavior = behavior
  vi.stubGlobal(`Worker`, ControlledWorker)
  vi.stubGlobal(`navigator`, {
    storage: { getDirectory: () => Promise.resolve({}) },
  })
  vi.stubGlobal(`addEventListener`, page.addEventListener.bind(page))
  vi.stubGlobal(`removeEventListener`, page.removeEventListener.bind(page))
  return page
}

async function cleanupEnvironment(): Promise<void> {
  for (const worker of ControlledWorker.instances) worker.releaseHeldResponses()
  await Promise.resolve()
  vi.unstubAllGlobals()
  ControlledWorker.instances = []
  ControlledWorker.behavior = {}
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : String(error)
}

function track<T>(
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
        observation: errorName(error),
      }
      ledger.push(settlement)
      return { settlement }
    },
  )
}

function expectedErrorName(code: BrowserOPFSWorkerErrorCode): string {
  if (code === `PERSISTENCE_UNAVAILABLE`) {
    return `PersistenceUnavailableError`
  }
  if (code === `INVALID_CONFIG`) {
    return `InvalidPersistedCollectionConfigError`
  }
  return `OPFSWorkerRequestError`
}

function expectDisposed(page: ControlledPage, worker: ControlledWorker): void {
  expect(worker.terminationCalls).toBe(1)
  expect(worker.listenerCount(`message`)).toBe(0)
  expect(worker.listenerCount(`error`)).toBe(0)
  expect(worker.listenerCount(`messageerror`)).toBe(0)
  expect(page.listenerCount).toBe(0)
  expect(page.addCalls).toBe(1)
  expect(page.removeCalls).toBe(1)
}

async function runPagehideHistory(history: PagehideHistory): Promise<void> {
  const page = installEnvironment({ heldResponseType: history.pending })
  const settlements: Array<Settlement> = []
  const expectedFulfilled: Array<Settlement> = []
  const tracked: Array<Promise<TrackedResult<unknown>>> = []
  let database: Database | undefined

  try {
    if (history.pending === `init`) {
      tracked.push(
        track(
          `init`,
          openBrowserWASQLiteOPFSDatabase({ databaseName: `oracle.sqlite` }),
          () => `database`,
          settlements,
        ),
      )
      expectedFulfilled.push({
        label: `init`,
        status: `fulfilled`,
        observation: `database`,
      })
    } else {
      database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
      })
      if (history.pending === `execute`) {
        for (let index = 0; index < history.executeCount; index++) {
          const sql = `SELECT ${index}`
          tracked.push(
            track(
              `execute-${index}`,
              database.execute(sql),
              (rows) => rows,
              settlements,
            ),
          )
          expectedFulfilled.push({
            label: `execute-${index}`,
            status: `fulfilled`,
            observation: [{ sql }],
          })
        }
      } else {
        tracked.push(
          track(
            `close`,
            Promise.resolve(database.close!()),
            () => `closed`,
            settlements,
          ),
        )
        expectedFulfilled.push({
          label: `close`,
          status: `fulfilled`,
          observation: `closed`,
        })
      }
    }

    const worker = ControlledWorker.instances[0]!
    const pendingCount =
      history.pending === `execute` ? history.executeCount : 1
    await Promise.resolve()
    expect(page.addCalls).toBe(1)
    expect(worker.heldResponseCount).toBe(pendingCount)
    expect(
      worker.requests.filter(({ type }) => type === history.pending),
    ).toHaveLength(pendingCount)

    let completed: Array<TrackedResult<unknown>>
    if (history.delivery === `response-before-pagehide`) {
      worker.releaseHeldResponses()
      completed = await Promise.all(tracked)
      if (history.pending === `init`) {
        database = completed[0]?.value as Database
      }
      page.dispatchPageHide(history.persisted)
    } else {
      page.dispatchPageHide(history.persisted)
      // This checkpoint is intentionally before any Promise continuation.
      expectDisposed(page, worker)
      completed = await Promise.all(tracked)
      const terminalLedger = [...settlements]
      worker.releaseHeldResponses()
      await Promise.resolve()
      expect(settlements).toEqual(terminalLedger)
    }

    const expectedSettlements =
      history.delivery === `response-before-pagehide`
        ? expectedFulfilled
        : expectedFulfilled.map((settlement) => ({
            ...settlement,
            status: `rejected` as const,
            observation: `AbortError`,
          }))
    expect(settlements).toEqual(expectedSettlements)
    expect(completed.map(({ settlement }) => settlement)).toEqual(
      expectedSettlements,
    )
    expect(worker.heldResponseCount).toBe(0)
    expectDisposed(page, worker)

    if (database) {
      const postDisposal: Array<Settlement> = []
      await Promise.all([
        track(
          `post-disposal-execute`,
          database.execute(`SELECT 99`),
          (rows) => rows,
          postDisposal,
        ),
        track(
          `post-disposal-close`,
          Promise.resolve(database.close!()),
          () => `closed`,
          postDisposal,
        ),
      ])
      expect(postDisposal).toEqual([
        {
          label: `post-disposal-execute`,
          status: `rejected`,
          observation: `InvalidPersistedCollectionConfigError`,
        },
        {
          label: `post-disposal-close`,
          status: `rejected`,
          observation: `InvalidPersistedCollectionConfigError`,
        },
      ])
      expect(worker.terminationCalls).toBe(1)
    }

    page.dispatchPageHide(!history.persisted)
    expect(worker.terminationCalls).toBe(1)
    expect(page.removeCalls).toBe(1)
  } finally {
    await cleanupEnvironment()
  }
}

async function runFailureHistory(history: FailureHistory): Promise<void> {
  const page = installEnvironment(
    history.stage === `init`
      ? { initErrorCode: history.code }
      : { closeErrorCode: history.code },
  )
  const settlements: Array<Settlement> = []

  try {
    let result: TrackedResult<unknown>
    if (history.stage === `init`) {
      result = await track(
        `init`,
        openBrowserWASQLiteOPFSDatabase({ databaseName: `oracle.sqlite` }),
        () => `database`,
        settlements,
      )
    } else {
      const database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
      })
      result = await track(
        `close`,
        Promise.resolve(database.close!()),
        () => `closed`,
        settlements,
      )
    }

    expect(result.settlement).toEqual({
      label: history.stage,
      status: `rejected`,
      observation: expectedErrorName(history.code),
    })
    expectDisposed(page, ControlledWorker.instances[0]!)
  } finally {
    await cleanupEnvironment()
  }
}

afterEach(async () => {
  await cleanupEnvironment()
})

const lifecycleSeed = Number(
  process.env.TANSTACK_DB_OPFS_LIFECYCLE_ORACLE_SEED ?? 1844,
)
const lifecycleRuns = Number(
  process.env.TANSTACK_DB_OPFS_LIFECYCLE_ORACLE_RUNS ?? 48,
)
const lifecyclePath = process.env.TANSTACK_DB_OPFS_LIFECYCLE_ORACLE_PATH

const pagehideHistory = fc.record({
  pending: fc.constantFrom<RequestKind>(`init`, `execute`, `close`),
  delivery: fc.constantFrom<DeliveryOrder>(
    `pagehide-before-response`,
    `response-before-pagehide`,
  ),
  persisted: fc.boolean(),
  executeCount: fc.integer({ min: 1, max: 3 }),
})

const failureHistory = fc.record({
  stage: fc.constantFrom<FailureHistory[`stage`]>(`init`, `close`),
  code: fc.constantFrom<BrowserOPFSWorkerErrorCode>(
    `PERSISTENCE_UNAVAILABLE`,
    `INVALID_CONFIG`,
    `INTERNAL`,
  ),
})

/*
Law/source: package lifecycle docs require pagehide to synchronously dispose the
dedicated worker and reject pending work with AbortError. All terminal paths
remove page/worker listeners, disposal is idempotent, and next use is rejected.
Domain/histories: generated pending init/execute/close, one to three concurrent
queries, both pagehide persisted values, response-before/pagehide-before orders,
late response delivery, repeated pagehide/close, and every worker error code at
init or close.
Reference: an independent settlement ledger and terminal-state model. The model
derives outcomes from event order and protocol error code, without consulting
the production request map or disposal flag.
Production path/checkpoint: the public OPFS opener and database methods using a
controlled Worker. Compare immediately when pagehide returns, after settlement,
after late delivery, and after post-disposal next use.
Observed: exact settlement sequence/value or error name, request reach, page and
worker listener ownership, and termination count. Synthetic events and a fake
worker do not prove real bfcache admission, durability, native OPFS handle
release, or the separate wa-sqlite partial-open race.
Challenge/replay: fixed examples pin every request/order boundary; generated
runs print a shrink seed/path. Registration, AbortError, listener cleanup, and
idempotency mutants are killed. Replay with TANSTACK_DB_OPFS_LIFECYCLE_ORACLE_*
and this file's package-local Vitest command.
*/
describe(`OPFS page lifecycle oracle`, () => {
  fcTest.prop([pagehideHistory], {
    seed: lifecycleSeed,
    numRuns: lifecycleRuns,
    ...(lifecyclePath ? { path: lifecyclePath } : {}),
    examples: [
      [
        {
          pending: `init`,
          delivery: `pagehide-before-response`,
          persisted: true,
          executeCount: 1,
        },
      ],
      [
        {
          pending: `execute`,
          delivery: `pagehide-before-response`,
          persisted: false,
          executeCount: 3,
        },
      ],
      [
        {
          pending: `close`,
          delivery: `pagehide-before-response`,
          persisted: false,
          executeCount: 1,
        },
      ],
      [
        {
          pending: `init`,
          delivery: `response-before-pagehide`,
          persisted: false,
          executeCount: 1,
        },
      ],
      [
        {
          pending: `execute`,
          delivery: `response-before-pagehide`,
          persisted: true,
          executeCount: 2,
        },
      ],
      [
        {
          pending: `close`,
          delivery: `response-before-pagehide`,
          persisted: true,
          executeCount: 1,
        },
      ],
    ],
  })(
    `matches the independent model across generated histories`,
    runPagehideHistory,
  )

  fcTest.prop([failureHistory], { seed: 1845, numRuns: 18 })(
    `matches terminal cleanup and error mapping across worker failures`,
    runFailureHistory,
  )
})
