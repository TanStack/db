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
type DeliveryStage =
  | `pagehide-before-response-production`
  | `pagehide-after-response-production`
  | `response-before-pagehide`
type ReleaseDirection = `fifo` | `reverse`
type TerminalEventType = `error` | `messageerror`

type PagehideHistory = {
  pending: RequestKind
  delivery: DeliveryStage
  persisted: boolean
  executeCount: number
  releaseDirection: ReleaseDirection
}

type FailureHistory = {
  stage: `init` | `close`
  code: BrowserOPFSWorkerErrorCode
}

type MixedExecuteHistory = {
  executeCount: number
  completedBeforePagehide: number
  persisted: boolean
  releaseDirection: ReleaseDirection
}

type TerminalEventHistory = {
  pending: RequestKind
  eventType: TerminalEventType
  executeCount: number
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

function errorObservation(error: unknown): { name: string; message: string } {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: `NonError`, message: String(error) }
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
        observation: errorObservation(error),
      }
      ledger.push(settlement)
      return { settlement }
    },
  )
}

// Authority: the public error classes exported by sqlite-persistence-core and
// the three protocol classifications in opfs-worker-protocol.ts. Keeping the
// table declarative makes an accidental production remapping observable.
const workerFailureContracts = {
  PERSISTENCE_UNAVAILABLE: {
    name: `PersistenceUnavailableError`,
    messagePrefix: `Persistence unavailable: `,
  },
  INVALID_CONFIG: {
    name: `InvalidPersistedCollectionConfigError`,
    messagePrefix: ``,
  },
  INTERNAL: { name: `OPFSWorkerRequestError`, messagePrefix: `` },
} satisfies Record<
  BrowserOPFSWorkerErrorCode,
  { name: string; messagePrefix: string }
>

const pagehideAbort = {
  name: `AbortError`,
  message: `The page is closing its SQLite connection`,
}

const closedConnection = {
  name: `InvalidPersistedCollectionConfigError`,
  message: `Browser OPFS worker connection is closed`,
}

const terminalEventFailures = {
  error: {
    name: `PersistenceUnavailableError`,
    message: `Persistence unavailable: OPFS worker terminated unexpectedly`,
  },
  messageerror: {
    name: `PersistenceUnavailableError`,
    message: `Persistence unavailable: OPFS worker message serialization failed`,
  },
} satisfies Record<TerminalEventType, { name: string; message: string }>

function canonicalSettlements(
  settlements: ReadonlyArray<Settlement>,
): Array<Settlement> {
  return [...settlements].sort((left, right) =>
    left.label.localeCompare(right.label),
  )
}

function expectSettlementSet(
  actual: ReadonlyArray<Settlement>,
  expected: ReadonlyArray<Settlement>,
): void {
  // Keep raw arrays and compare lengths before canonicalizing: an accidental
  // duplicate cannot disappear behind request-keyed normalization.
  expect(actual).toHaveLength(expected.length)
  expect(canonicalSettlements(actual)).toEqual(canonicalSettlements(expected))
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
    expect(page.addCalls).toBe(1)
    expect(
      worker.requests.filter(({ type }) => type === history.pending),
    ).toHaveLength(pendingCount)

    let completed: Array<TrackedResult<unknown>>
    if (history.delivery === `pagehide-before-response-production`) {
      expect(worker.heldResponseCount).toBe(0)
      page.dispatchPageHide(history.persisted)
      // The listener must exist, reject pending requests, and dispose before
      // the worker's queued response-production microtask runs.
      expectDisposed(page, worker)
      completed = await Promise.all(tracked)
      const terminalLedger = [...settlements]
      worker.releaseHeldResponses()
      await Promise.resolve()
      expect(settlements).toEqual(terminalLedger)
    } else {
      await Promise.resolve()
      expect(worker.heldResponseCount).toBe(pendingCount)
      if (history.delivery === `response-before-pagehide`) {
        worker.releaseHeldResponses(undefined, history.releaseDirection)
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
        worker.releaseHeldResponses(undefined, history.releaseDirection)
        await Promise.resolve()
        expect(settlements).toEqual(terminalLedger)
      }
    }

    const expectedSettlements =
      history.delivery === `response-before-pagehide`
        ? expectedFulfilled
        : expectedFulfilled.map((settlement) => ({
            ...settlement,
            status: `rejected` as const,
            observation: pagehideAbort,
          }))
    expectSettlementSet(settlements, expectedSettlements)
    expectSettlementSet(
      completed.map(({ settlement }) => settlement),
      expectedSettlements,
    )
    expect(worker.heldResponseCount).toBe(0)
    expectDisposed(page, worker)

    if (database) {
      await expectPostDisposalNoReach(database, worker)
    }

    page.dispatchPageHide(!history.persisted)
    expect(worker.terminationCalls).toBe(1)
    expect(page.removeCalls).toBe(1)
  } finally {
    await cleanupEnvironment()
  }
}

async function expectPostDisposalNoReach(
  database: Database,
  worker: ControlledWorker,
): Promise<void> {
  const requestCount = worker.requests.length
  const postDisposal: Array<Settlement> = []
  const completed = await Promise.all([
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
  const expected = [
    {
      label: `post-disposal-execute`,
      status: `rejected` as const,
      observation: closedConnection,
    },
    {
      label: `post-disposal-close`,
      status: `fulfilled` as const,
      observation: `closed`,
    },
  ]
  expectSettlementSet(postDisposal, expected)
  expectSettlementSet(
    completed.map(({ settlement }) => settlement),
    expected,
  )
  expect(worker.requests).toHaveLength(requestCount)
  expect(worker.terminationCalls).toBe(1)
}

async function runMixedExecuteHistory(
  history: MixedExecuteHistory,
): Promise<void> {
  const page = installEnvironment({ heldResponseType: `execute` })
  const settlements: Array<Settlement> = []

  try {
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: `oracle.sqlite`,
    })
    const worker = ControlledWorker.instances[0]!
    const tracked = Array.from({ length: history.executeCount }, (_, index) => {
      const sql = `SELECT ${index}`
      return track(
        `execute-${index}`,
        database.execute(sql),
        (rows) => rows,
        settlements,
      )
    })

    await Promise.resolve()
    expect(worker.heldResponseCount).toBe(history.executeCount)
    worker.releaseHeldResponses(
      history.completedBeforePagehide,
      history.releaseDirection,
    )
    await Promise.resolve()
    expect(settlements).toHaveLength(history.completedBeforePagehide)

    page.dispatchPageHide(history.persisted)
    expectDisposed(page, worker)
    const completed = await Promise.all(tracked)
    const terminalLedger = [...settlements]
    worker.releaseHeldResponses(undefined, history.releaseDirection)
    await Promise.resolve()
    expect(settlements).toEqual(terminalLedger)

    const expected = Array.from(
      { length: history.executeCount },
      (_, index): Settlement => {
        const fulfilled =
          history.releaseDirection === `fifo`
            ? index < history.completedBeforePagehide
            : index >= history.executeCount - history.completedBeforePagehide
        return fulfilled
          ? {
              label: `execute-${index}`,
              status: `fulfilled`,
              observation: [{ sql: `SELECT ${index}` }],
            }
          : {
              label: `execute-${index}`,
              status: `rejected`,
              observation: pagehideAbort,
            }
      },
    )
    expectSettlementSet(settlements, expected)
    expectSettlementSet(
      completed.map(({ settlement }) => settlement),
      expected,
    )
    await expectPostDisposalNoReach(database, worker)
  } finally {
    await cleanupEnvironment()
  }
}

async function runTerminalEventHistory(
  history: TerminalEventHistory,
): Promise<void> {
  const page = installEnvironment({ heldResponseType: history.pending })
  const settlements: Array<Settlement> = []
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
    } else {
      database = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `oracle.sqlite`,
      })
      if (history.pending === `execute`) {
        for (let index = 0; index < history.executeCount; index++) {
          tracked.push(
            track(
              `execute-${index}`,
              database.execute(`SELECT ${index}`),
              (rows) => rows,
              settlements,
            ),
          )
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
      }
    }

    const worker = ControlledWorker.instances[0]!
    const pendingCount =
      history.pending === `execute` ? history.executeCount : 1
    await Promise.resolve()
    expect(worker.heldResponseCount).toBe(pendingCount)
    worker.emitTerminalEvent(history.eventType)
    expectDisposed(page, worker)

    const completed = await Promise.all(tracked)
    const terminalLedger = [...settlements]
    worker.releaseHeldResponses()
    await Promise.resolve()
    expect(settlements).toEqual(terminalLedger)

    const expected = tracked.map(
      (_, index): Settlement => ({
        label:
          history.pending === `execute` ? `execute-${index}` : history.pending,
        status: `rejected`,
        observation: terminalEventFailures[history.eventType],
      }),
    )
    expectSettlementSet(settlements, expected)
    expectSettlementSet(
      completed.map(({ settlement }) => settlement),
      expected,
    )
    if (database) await expectPostDisposalNoReach(database, worker)

    worker.emitTerminalEvent(history.eventType)
    page.dispatchPageHide(false)
    expect(worker.terminationCalls).toBe(1)
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
      observation: {
        name: workerFailureContracts[history.code].name,
        message: `${workerFailureContracts[history.code].messagePrefix}controlled ${history.stage} failure`,
      },
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
const mixedSeed = Number(process.env.TANSTACK_DB_OPFS_MIXED_ORACLE_SEED ?? 1845)
const mixedRuns = Number(process.env.TANSTACK_DB_OPFS_MIXED_ORACLE_RUNS ?? 32)
const mixedPath = process.env.TANSTACK_DB_OPFS_MIXED_ORACLE_PATH
const failureSeed = Number(
  process.env.TANSTACK_DB_OPFS_FAILURE_ORACLE_SEED ?? 1846,
)
const failureRuns = Number(
  process.env.TANSTACK_DB_OPFS_FAILURE_ORACLE_RUNS ?? 18,
)
const failurePath = process.env.TANSTACK_DB_OPFS_FAILURE_ORACLE_PATH
const terminalEventSeed = Number(
  process.env.TANSTACK_DB_OPFS_TERMINAL_EVENT_ORACLE_SEED ?? 1847,
)
const terminalEventRuns = Number(
  process.env.TANSTACK_DB_OPFS_TERMINAL_EVENT_ORACLE_RUNS ?? 24,
)
const terminalEventPath =
  process.env.TANSTACK_DB_OPFS_TERMINAL_EVENT_ORACLE_PATH

const pagehideHistory = fc.record({
  pending: fc.constantFrom<RequestKind>(`init`, `execute`, `close`),
  delivery: fc.constantFrom<DeliveryStage>(
    `pagehide-before-response-production`,
    `pagehide-after-response-production`,
    `response-before-pagehide`,
  ),
  persisted: fc.boolean(),
  executeCount: fc.integer({ min: 1, max: 3 }),
  releaseDirection: fc.constantFrom<ReleaseDirection>(`fifo`, `reverse`),
})

const mixedExecuteHistory = fc
  .integer({ min: 2, max: 3 })
  .chain((executeCount) =>
    fc.record({
      executeCount: fc.constant(executeCount),
      completedBeforePagehide: fc.integer({
        min: 1,
        max: executeCount - 1,
      }),
      persisted: fc.boolean(),
      releaseDirection: fc.constantFrom<ReleaseDirection>(`fifo`, `reverse`),
    }),
  )

const failureHistory = fc.record({
  stage: fc.constantFrom<FailureHistory[`stage`]>(`init`, `close`),
  code: fc.constantFrom<BrowserOPFSWorkerErrorCode>(
    `PERSISTENCE_UNAVAILABLE`,
    `INVALID_CONFIG`,
    `INTERNAL`,
  ),
})

const terminalEventHistory = fc.record({
  pending: fc.constantFrom<RequestKind>(`init`, `execute`, `close`),
  eventType: fc.constantFrom<TerminalEventType>(`error`, `messageerror`),
  executeCount: fc.integer({ min: 1, max: 3 }),
})

const pagehideExamples: Array<[PagehideHistory]> = (
  [`init`, `execute`, `close`] as const
).flatMap((pending) =>
  (
    [
      `pagehide-before-response-production`,
      `pagehide-after-response-production`,
      `response-before-pagehide`,
    ] as const
  ).flatMap((delivery) =>
    [false, true].flatMap((persisted) =>
      (pending === `execute` ? [1, 2, 3] : [1]).flatMap((executeCount) =>
        (delivery === `response-before-pagehide` && executeCount > 1
          ? ([`fifo`, `reverse`] as const)
          : ([`fifo`] as const)
        ).map((releaseDirection): [PagehideHistory] => [
          { pending, delivery, persisted, executeCount, releaseDirection },
        ]),
      ),
    ),
  ),
)

const mixedExamples: Array<[MixedExecuteHistory]> = [2, 3].flatMap(
  (executeCount) =>
    Array.from({ length: executeCount - 1 }, (_, index) => index + 1).flatMap(
      (completedBeforePagehide) =>
        [false, true].flatMap((persisted) =>
          ([`fifo`, `reverse`] as const).map(
            (releaseDirection): [MixedExecuteHistory] => [
              {
                executeCount,
                completedBeforePagehide,
                persisted,
                releaseDirection,
              },
            ],
          ),
        ),
    ),
)

const failureExamples: Array<[FailureHistory]> = (
  [`init`, `close`] as const
).flatMap((stage) =>
  ([`PERSISTENCE_UNAVAILABLE`, `INVALID_CONFIG`, `INTERNAL`] as const).map(
    (code): [FailureHistory] => [{ stage, code }],
  ),
)

const terminalEventExamples: Array<[TerminalEventHistory]> = (
  [`init`, `execute`, `close`] as const
).flatMap((pending) =>
  ([`error`, `messageerror`] as const).flatMap((eventType) =>
    (pending === `execute` ? [1, 2, 3] : [1]).map(
      (executeCount): [TerminalEventHistory] => [
        { pending, eventType, executeCount },
      ],
    ),
  ),
)

/*
Law/source: the README Notes section requires pagehide to synchronously dispose
the dedicated worker and reject pending work with AbortError; its capability
bullet and the public sqlite-persistence-core errors define terminal failures.
The worker protocol defines the three response-error classifications.
Domain/histories: pending init/execute/close; one to three sibling queries;
pagehide before response production, after production, or after delivery; mixed
completed/pending siblings; both persisted values; Worker error/messageerror;
late delivery; repeated disposal; and every response code at init and close.
Reference: an independent settlement ledger and terminal-state model. The model
uses a declarative public error table and derives outcomes from history, without
consulting the production request map, disposal flag, or completion order.
Production path/checkpoint: the public OPFS opener and database methods using a
controlled Worker. Compare immediately when pagehide returns, after settlement,
after late delivery, and after post-disposal next use.
Observed: raw settlement multiplicity plus order-independent sibling outcomes,
exact values/errors, positive and negative request reach, listener ownership,
and termination count. Synthetic events and a fake worker do not prove real
bfcache admission, durability, native handle release, or wa-sqlite #88.
Challenge/replay: fixed examples exhaust the cheap structural products;
generated lanes use verbose FastCheck output to retain original/reduced traces.
Replay each property with its TANSTACK_DB_OPFS_*_ORACLE_{SEED,RUNS,PATH}
controls and this file's package-local Vitest command.
*/
describe(`OPFS page lifecycle oracle`, () => {
  fcTest.prop([pagehideHistory], {
    seed: lifecycleSeed,
    numRuns: lifecycleRuns,
    ...(lifecyclePath ? { path: lifecyclePath } : {}),
    examples: pagehideExamples,
    verbose: true,
  })(
    `matches the independent model across generated histories`,
    runPagehideHistory,
  )

  fcTest.prop([mixedExecuteHistory], {
    seed: mixedSeed,
    numRuns: mixedRuns,
    ...(mixedPath ? { path: mixedPath } : {}),
    examples: mixedExamples,
    verbose: true,
  })(
    `preserves completed siblings while aborting pending siblings`,
    runMixedExecuteHistory,
  )

  fcTest.prop([terminalEventHistory], {
    seed: terminalEventSeed,
    numRuns: terminalEventRuns,
    ...(terminalEventPath ? { path: terminalEventPath } : {}),
    examples: terminalEventExamples,
    verbose: true,
  })(
    `rejects pending work across Worker terminal event paths`,
    runTerminalEventHistory,
  )

  fcTest.prop([failureHistory], {
    seed: failureSeed,
    numRuns: failureRuns,
    ...(failurePath ? { path: failurePath } : {}),
    examples: failureExamples,
    verbose: true,
  })(
    `matches terminal cleanup and error mapping across worker failures`,
    runFailureHistory,
  )
})
