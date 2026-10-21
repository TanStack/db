import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

/**
 * # Does the OPFS worker answer its connection's requests in order?
 *
 * The worker owns one SQLite connection. It must answer requests in the order
 * it receives them, with the result a sequential connection would produce.
 * Close is a request like any other: it waits for earlier requests, closes
 * cleanly, and later requests see a closed connection. This holds even when an
 * earlier execute waits for the OPFS access handle.
 *
 * That wait is the worker's only task-level suspension point. OPFSCoopSyncVFS
 * gives its access handle to another connection on request. Its next lock then
 * queues a Web Lock and handle acquisition on wa-sqlite's `retryOps` and
 * returns SQLITE_BUSY. wa-sqlite's `retry()` awaits that work, and further
 * worker messages can be handled during the wait. A worker that handles
 * messages concurrently lets close run while the statement waits. SQLite then
 * refuses to close a connection with an unfinalized statement, and the
 * resumed statement runs on closed VFS files.
 *
 * The model is a sequential replay over a list of inserted values. Histories
 * vary the executes before close, which one waits for the handle, whether the
 * handle returns before or after close arrives, and an execute after close.
 * The driver runs the real worker module and the real wa-sqlite WASM build in
 * Node. Only the VFS is replaced: an in-memory VFS with OPFSCoopSyncVFS's lock
 * protocol. The comparison checks every response, in order, once the worker
 * is idle.
 *
 * This does not prove Chromium's Web Lock or access-handle timing, multi-tab
 * handoff, or durability of OPFS writes.
 */

type ExecuteKind = `insert` | `select`

type RequestOrderHistory = {
  executes: Array<ExecuteKind>
  lockWaitAt: number | undefined
  handleReturns: `before-close` | `after-close`
  executeAfterClose: boolean
}

// The compiled WASM and the current VFS survive module re-evaluation.
const harness = vi.hoisted(() => ({
  compiled: undefined as Promise<WebAssembly.Module> | undefined,
  vfs: undefined as
    undefined | { takeHandle: () => void; returnHandle: () => void },
}))

vi.mock(`@journeyapps/wa-sqlite/dist/wa-sqlite.mjs`, async (importOriginal) => {
  const real = await importOriginal<{
    default: (options: object) => Promise<unknown>
  }>()
  const require = createRequire(import.meta.url)
  harness.compiled ??= WebAssembly.compile(
    readFileSync(require.resolve(`@journeyapps/wa-sqlite/dist/wa-sqlite.wasm`)),
  )
  const compiled = harness.compiled
  return {
    default: () =>
      real.default({
        instantiateWasm(
          imports: WebAssembly.Imports,
          receive: (
            instance: WebAssembly.Instance,
            module: WebAssembly.Module,
          ) => void,
        ) {
          void compiled.then(async (module) =>
            receive(await WebAssembly.instantiate(module, imports), module),
          )
          return {}
        },
      }),
  }
})

// OPFSCoopSyncVFS's lock protocol over MemoryVFS storage. While another
// connection holds the handle, the first lock queues its reacquisition on
// retryOps and returns SQLITE_BUSY; a lock while that request is in progress
// returns SQLITE_BUSY without queuing more work.
vi.mock(`@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js`, async () => {
  const { MemoryVFS } = (await import(
    `@journeyapps/wa-sqlite/src/examples/MemoryVFS.js`
  )) as unknown as {
    MemoryVFS: new (
      name: string,
      module: unknown,
    ) => {
      isReady: () => Promise<void>
      _module: { retryOps: Array<Promise<void>> }
    }
  }
  const SQLITE_OK = 0
  const SQLITE_BUSY = 5

  class CoopMemoryVFS extends MemoryVFS {
    private handleTaken = false
    private reacquisition: undefined | (() => void)

    static async create(name: string, module: unknown) {
      const vfs = new CoopMemoryVFS(name, module)
      await vfs.isReady()
      harness.vfs = vfs
      return vfs
    }

    takeHandle(): void {
      this.handleTaken = true
    }

    returnHandle(): void {
      this.handleTaken = false
      this.reacquisition?.()
      this.reacquisition = undefined
    }

    jLock(): number {
      if (!this.handleTaken) return SQLITE_OK
      if (this.reacquisition === undefined) {
        this._module.retryOps.push(
          new Promise<void>((resolve) => {
            this.reacquisition = resolve
          }),
        )
      }
      return SQLITE_BUSY
    }
  }
  return { OPFSCoopSyncVFS: CoopMemoryVFS }
})

// Sequential reference: replay the history over a list of inserted values.
function expectedResponses(
  history: RequestOrderHistory,
): Array<BrowserOPFSWorkerResponse> {
  const values: Array<number> = []
  const responses: Array<BrowserOPFSWorkerResponse> = history.executes.map(
    (kind, index) => {
      const requestId = `execute-${index}`
      if (kind === `insert`) {
        values.push(index)
        return { type: `response`, requestId, ok: true, rows: [] }
      }
      return {
        type: `response`,
        requestId,
        ok: true,
        rows: [...values].sort((a, b) => a - b).map((x) => ({ x })),
      }
    },
  )
  responses.push({ type: `response`, requestId: `close`, ok: true })
  if (history.executeAfterClose) {
    responses.push({
      type: `response`,
      requestId: `execute-after-close`,
      ok: false,
      code: `INVALID_CONFIG`,
      error: `OPFS worker database has not been initialized`,
    })
  }
  return responses
}

function sqlFor(kind: ExecuteKind, index: number): string {
  return kind === `insert`
    ? `INSERT INTO t VALUES (${index})`
    : `SELECT x FROM t ORDER BY x`
}

let receive: (request: BrowserOPFSWorkerRequest) => void
const responses: Array<BrowserOPFSWorkerResponse> = []
// Each worker message is its own task, as with a real Worker.
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

async function untilAnswered(count: number): Promise<void> {
  for (let task = 0; task < 200 && responses.length < count; task++) {
    await nextTask()
  }
}

async function send(request: BrowserOPFSWorkerRequest): Promise<void> {
  receive(request)
  await nextTask()
}

beforeAll(async () => {
  vi.stubGlobal(`navigator`, { storage: { getDirectory: () => ({}) } })
  vi.stubGlobal(`FileSystemFileHandle`, {
    prototype: { createSyncAccessHandle: () => {} },
  })
  vi.stubGlobal(
    `addEventListener`,
    (_type: string, listener: (event: MessageEvent) => void) => {
      receive = (data) => listener({ data } as MessageEvent)
    },
  )
  vi.stubGlobal(`postMessage`, (response: BrowserOPFSWorkerResponse) => {
    responses.push(response)
  })
  await import(`../src/opfs-worker`)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

async function runRequestOrderHistory(
  history: RequestOrderHistory,
): Promise<void> {
  // A fresh init creates a new wa-sqlite instance and an empty memory VFS.
  responses.length = 0
  receive({
    type: `init`,
    requestId: `init`,
    databaseName: `order.sqlite`,
    vfsName: `opfs`,
  })
  await untilAnswered(1)
  receive({
    type: `execute`,
    requestId: `schema`,
    sql: `CREATE TABLE t(x INTEGER)`,
    params: [],
  })
  await untilAnswered(2)
  expect(responses.map(({ ok }) => ok)).toEqual([true, true])
  responses.length = 0
  const vfs = harness.vfs!

  for (const [index, kind] of history.executes.entries()) {
    if (index === history.lockWaitAt) vfs.takeHandle()
    await send({
      type: `execute`,
      requestId: `execute-${index}`,
      sql: sqlFor(kind, index),
      params: [],
    })
  }
  if (history.handleReturns === `before-close`) vfs.returnHandle()
  await send({ type: `close`, requestId: `close` })
  if (history.executeAfterClose) {
    await send({
      type: `execute`,
      requestId: `execute-after-close`,
      sql: `SELECT x FROM t`,
      params: [],
    })
  }
  if (history.handleReturns === `after-close`) vfs.returnHandle()

  const expected = expectedResponses(history)
  await untilAnswered(expected.length)
  // Let a wrong worker emit extra or late responses before comparing.
  await nextTask()
  expect(responses).toEqual(expected)
}

const requestOrderHistory = fc
  .array(fc.constantFrom<ExecuteKind>(`insert`, `select`), {
    minLength: 1,
    maxLength: 3,
  })
  .chain((executes) =>
    fc.record({
      executes: fc.constant(executes),
      lockWaitAt: fc.option(fc.integer({ min: 0, max: executes.length - 1 }), {
        nil: undefined,
      }),
      handleReturns: fc.constantFrom<RequestOrderHistory[`handleReturns`]>(
        `before-close`,
        `after-close`,
      ),
      executeAfterClose: fc.boolean(),
    }),
  )

// Every lock-wait placement over the two-execute shapes, plus the reported
// trace: one insert waiting for the handle while close arrives.
const requestOrderExamples: Array<[RequestOrderHistory]> = (
  [[`insert`], [`insert`, `select`], [`select`, `insert`]] as const
).flatMap((executes) =>
  [undefined, ...executes.keys()].flatMap((lockWaitAt) =>
    ([`before-close`, `after-close`] as const).flatMap((handleReturns) =>
      [false, true].map((executeAfterClose): [RequestOrderHistory] => [
        {
          executes: [...executes],
          lockWaitAt,
          handleReturns,
          executeAfterClose,
        },
      ]),
    ),
  ),
)

const requestOrderSeed = Number(
  process.env.TANSTACK_DB_OPFS_REQUEST_ORDER_ORACLE_SEED ?? 1849,
)
const requestOrderRuns = Number(
  process.env.TANSTACK_DB_OPFS_REQUEST_ORDER_ORACLE_RUNS ?? 24,
)
const requestOrderPath = process.env.TANSTACK_DB_OPFS_REQUEST_ORDER_ORACLE_PATH
const replayRequested =
  process.env.TANSTACK_DB_OPFS_REQUEST_ORDER_ORACLE_SEED !== undefined ||
  requestOrderPath !== undefined

describe(`OPFS worker request order oracle`, () => {
  const campaigns = replayRequested
    ? [{ label: `replay`, seed: requestOrderSeed, path: requestOrderPath }]
    : [
        { label: `fixed`, seed: requestOrderSeed, path: undefined },
        { label: `random`, seed: undefined, path: undefined },
      ]
  for (const campaign of campaigns) {
    fcTest.prop([requestOrderHistory], {
      ...(campaign.seed === undefined ? {} : { seed: campaign.seed }),
      numRuns: requestOrderRuns,
      ...(campaign.path === undefined ? {} : { path: campaign.path }),
      examples: requestOrderExamples,
      verbose: true,
    })(
      `answers requests in order across an OPFS handle wait and close (${campaign.label})`,
      runRequestOrderHistory,
    )
  }
})
