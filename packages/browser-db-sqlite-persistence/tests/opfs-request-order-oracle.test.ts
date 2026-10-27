/**
 * Node driver for the OPFS request-order oracle in `opfs-request-order-oracle.ts`.
 *
 * The public connection talks to the real worker module through a bridge
 * `Worker` that delivers each message in its own task, as a real Worker does.
 * The worker runs the real wa-sqlite WASM build. Only the VFS is replaced: an
 * in-memory VFS with OPFSCoopSyncVFS's lock protocol, whose files outlive a
 * connection so that a reopen reads them. "Taking the handle" makes the next
 * lock queue its reacquisition on retryOps and return SQLITE_BUSY, which is
 * what OPFSCoopSyncVFS does after it hands the handle to another connection.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, beforeAll, describe, expect, vi } from 'vitest'
import {
  oraclePropertyOptions,
  oracleReplayTest,
  oracleRuns,
} from '../../db/tests/oracle-config'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import {
  findRequestOrderViolation,
  observeRequestOrder,
  requestOrderExamples,
} from './opfs-request-order-oracle'
import type {
  AccessHandleControl,
  ExecuteKind,
  RequestOrderHistory,
} from './opfs-request-order-oracle'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

type CoopVFSHandle = {
  takeHandle: () => void
  returnHandle: () => void
  isWaiting: () => boolean
}

// The compiled WASM, the shared VFS files, and the current VFS survive module
// re-evaluation.
const harness = vi.hoisted(() => ({
  compiled: undefined as Promise<WebAssembly.Module> | undefined,
  files: new Map<string, unknown>(),
  vfs: undefined as CoopVFSHandle | undefined,
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
// retryOps and returns SQLITE_BUSY. A lock while that request is in progress
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
      mapNameToFile: Map<string, unknown>
      _module: { retryOps: Array<Promise<void>> }
    }
  }
  const SQLITE_OK = 0
  const SQLITE_BUSY = 5

  class CoopMemoryVFS extends MemoryVFS implements CoopVFSHandle {
    private handleTaken = false
    private reacquisition: undefined | (() => void)

    static async create(name: string, module: unknown) {
      const vfs = new CoopMemoryVFS(name, module)
      await vfs.isReady()
      vfs.mapNameToFile = harness.files
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

    isWaiting(): boolean {
      return this.reacquisition !== undefined
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

const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0))

// The worker module listens on this global. Each request and each response
// crosses the bridge in its own task, and a terminated bridge delivers nothing.
let deliverToWorker: (request: BrowserOPFSWorkerRequest) => void
const requestOwners = new Map<string, BridgeWorker>()

class BridgeWorker {
  private readonly listeners = new Set<(event: Event) => void>()
  private terminated = false

  addEventListener(type: string, listener: (event: Event) => void): void {
    if (type === `message`) this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (type === `message`) this.listeners.delete(listener)
  }

  postMessage(request: BrowserOPFSWorkerRequest): void {
    if (this.terminated) return
    requestOwners.set(request.requestId, this)
    setTimeout(() => {
      if (!this.terminated) deliverToWorker(request)
    }, 0)
  }

  receive(response: BrowserOPFSWorkerResponse): void {
    setTimeout(() => {
      if (this.terminated) return
      for (const listener of [...this.listeners]) {
        listener({ data: response } as MessageEvent<BrowserOPFSWorkerResponse>)
      }
    }, 0)
  }

  terminate(): void {
    this.terminated = true
  }
}

const nodeHandleControl: AccessHandleControl = {
  take: () => {
    harness.vfs!.takeHandle()
    return Promise.resolve()
  },
  untilWaiting: async () => {
    for (let task = 0; task < 200; task++) {
      if (harness.vfs!.isWaiting()) return true
      await nextTask()
    }
    return false
  },
  // The bridge delivers a message in one task; a few tasks cover the
  // connection's microtasks before it posts.
  untilDelivered: async () => {
    for (let task = 0; task < 5; task++) await nextTask()
  },
  give: () => {
    harness.vfs!.returnHandle()
    return Promise.resolve()
  },
}

beforeAll(async () => {
  vi.stubGlobal(`Worker`, BridgeWorker)
  vi.stubGlobal(`navigator`, {
    storage: { getDirectory: () => Promise.resolve({}) },
  })
  vi.stubGlobal(`FileSystemFileHandle`, {
    prototype: { createSyncAccessHandle: () => {} },
  })
  // The connection registers pagehide here; the worker registers message.
  vi.stubGlobal(
    `addEventListener`,
    (type: string, listener: (event: MessageEvent) => void) => {
      if (type === `message`) {
        deliverToWorker = (data) => listener({ data } as MessageEvent)
      }
    },
  )
  vi.stubGlobal(`removeEventListener`, () => {})
  vi.stubGlobal(`postMessage`, (response: BrowserOPFSWorkerResponse) => {
    const owner = requestOwners.get(response.requestId)
    requestOwners.delete(response.requestId)
    owner?.receive(response)
  })
  await import(`../src/opfs-worker`)
})

afterAll(() => {
  vi.unstubAllGlobals()
})

let databaseSequence = 0

async function runRequestOrderHistory(
  history: RequestOrderHistory,
): Promise<void> {
  databaseSequence++
  const observation = await observeRequestOrder(
    (databaseName) => openBrowserWASQLiteOPFSDatabase({ databaseName }),
    nodeHandleControl,
    history,
    `order-${databaseSequence}.sqlite`,
  )
  expect(findRequestOrderViolation(history, observation)).toBeUndefined()
}

const requestOrderHistory = fc
  .array(fc.constantFrom<ExecuteKind>(`insert`, `select`), {
    minLength: 1,
    maxLength: 3,
  })
  .chain((executes) =>
    fc.record({
      executes: fc.constant(executes),
      handleTakenBefore: fc.option(
        fc.integer({ min: 0, max: executes.length - 1 }),
        { nil: undefined },
      ),
      handleReturns: fc.constantFrom<RequestOrderHistory[`handleReturns`]>(
        `before-close`,
        `after-close`,
      ),
      executeAfterClose: fc.boolean(),
    }),
  )

const requestOrderProperty = `opfs.request-order`

describe(`OPFS request order oracle (Node driver)`, () => {
  // A path replay of this property selects only its random campaign.
  oracleReplayTest(fcTest).prop([requestOrderHistory], {
    seed: 1849,
    numRuns: oracleRuns(24),
    examples: requestOrderExamples.map((history): [RequestOrderHistory] => [
      history,
    ]),
    verbose: true,
  })(
    `answers requests in order and closes after them (fixed)`,
    runRequestOrderHistory,
  )
  oracleReplayTest(fcTest, requestOrderProperty).prop([requestOrderHistory], {
    ...oraclePropertyOptions(24, requestOrderProperty),
    examples: requestOrderExamples.map((history): [RequestOrderHistory] => [
      history,
    ]),
    verbose: true,
  })(
    `answers requests in order and closes after them (random)`,
    runRequestOrderHistory,
  )
})
