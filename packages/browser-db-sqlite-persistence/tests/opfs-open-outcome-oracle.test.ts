/**
 * jsdom production driver for the OPFS open outcome oracle in
 * `opfs-open-outcome-oracle.ts`. It calls the public opener with a controlled
 * Worker, which can refuse construction, answer initialization, stay silent,
 * or report the WASM failure the way the real worker does: as a
 * `PERSISTENCE_UNAVAILABLE` response. Fake timers drive the open deadline.
 *
 * No asset lookup runs here, because only the package build defines it. The
 * Chromium driver in `e2e/opfs-open-outcome-oracle.e2e.test.ts` supplies the
 * lookup and the real worker's WASM fetch.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import {
  describeHistory,
  expectOpenOutcome,
  openHistories,
  reachedOutcomes,
} from './opfs-open-outcome-oracle'
import type {
  OpenDriverReach,
  OpenHistory,
  OpenObservation,
  OpenSettlement,
} from './opfs-open-outcome-oracle'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

const jsdomReach: OpenDriverReach = {
  lookup: [`not needed`],
  workerStart: [`starts`, `throws`],
  wasm: [`loads`, `fails`],
  init: [`answers`, `silent`],
  interrupt: [`none`, `deadline`, `abort`],
}
const histories = openHistories(jsdomReach)
const deadlineMs = 40

// Implements only the Worker surface that the opener uses.
class ControlledWorker {
  static history: OpenHistory
  static started = 0
  static terminated = 0
  static heldResponses: Array<() => void> = []

  private readonly listeners = new Set<
    (event: MessageEvent<BrowserOPFSWorkerResponse>) => void
  >()

  constructor() {
    if (ControlledWorker.history.workerStart === `throws`) {
      throw new DOMException(`The worker was refused`, `SecurityError`)
    }
    ControlledWorker.started++
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === `message`) this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === `message`) this.listeners.delete(listener)
  }

  postMessage(request: BrowserOPFSWorkerRequest): void {
    const respond = (response: BrowserOPFSWorkerResponse) =>
      queueMicrotask(() => {
        for (const listener of this.listeners) {
          listener({
            data: response,
          } as MessageEvent<BrowserOPFSWorkerResponse>)
        }
      })
    const answered: BrowserOPFSWorkerResponse = {
      type: `response`,
      requestId: request.requestId,
      ok: true,
      rows: [],
    }
    if (request.type !== `init`) {
      respond(answered)
      return
    }
    const { wasm, init } = ControlledWorker.history
    if (wasm === `fails`) {
      respond({
        type: `response`,
        requestId: request.requestId,
        ok: false,
        code: `PERSISTENCE_UNAVAILABLE`,
        error: `Failed to load wa-sqlite WebAssembly`,
      })
    } else if (init === `silent`) {
      ControlledWorker.heldResponses.push(() => respond(answered))
    } else {
      respond(answered)
    }
  }

  terminate(): void {
    ControlledWorker.terminated++
  }
}

function installEnvironment(history: OpenHistory): void {
  ControlledWorker.history = history
  ControlledWorker.started = 0
  ControlledWorker.terminated = 0
  ControlledWorker.heldResponses = []
  vi.stubGlobal(`Worker`, ControlledWorker)
  vi.stubGlobal(`navigator`, {
    storage: { getDirectory: () => Promise.resolve({}) },
  })
  vi.stubGlobal(`location`, { href: `https://example.test/` })
  vi.stubGlobal(`addEventListener`, () => {})
  vi.stubGlobal(`removeEventListener`, () => {})
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function runOpenHistory(history: OpenHistory): Promise<OpenObservation> {
  vi.useFakeTimers()
  installEnvironment(history)
  const controller = new AbortController()
  let settlement: OpenSettlement | undefined
  const settled = openBrowserWASQLiteOPFSDatabase({
    databaseName: `outcome.sqlite`,
    timeoutMs: history.interrupt === `deadline` ? deadlineMs : 0,
    signal: controller.signal,
  }).then(
    (database) => {
      settlement = `opened`
      return database
    },
    (error: Error) => {
      settlement = error.name as OpenSettlement
      return undefined
    },
  )

  // The opener sends initialization synchronously, so the open is pending here.
  if (history.interrupt === `deadline`) {
    await vi.advanceTimersByTimeAsync(deadlineMs)
  } else if (history.interrupt === `abort`) {
    controller.abort(new DOMException(`App stopped opening`, `AbortError`))
  }
  const database = await settled

  // Checkpoint: let every held step complete before counting workers.
  for (const release of ControlledWorker.heldResponses.splice(0)) release()
  await vi.advanceTimersByTimeAsync(0)
  const observation: OpenObservation = {
    settlement: settlement!,
    startedWorkers: ControlledWorker.started,
    terminatedWorkers: ControlledWorker.terminated,
  }
  await database?.close?.()

  if (history.interrupt !== `none`) {
    ControlledWorker.history = {
      ...history,
      init: `answers`,
      interrupt: `none`,
    }
    try {
      const laterDatabase = await openBrowserWASQLiteOPFSDatabase({
        databaseName: `outcome.sqlite`,
      })
      await laterDatabase.close?.()
      observation.laterOpen = `opened`
    } catch (error) {
      observation.laterOpen = (error as Error).name as `opened`
    }
  }
  return observation
}

describe(`OPFS open outcome oracle (jsdom driver)`, () => {
  it(`reaches every outcome that this driver controls`, () => {
    expect(reachedOutcomes(histories)).toEqual([
      `initialization: AbortError`,
      `initialization: TimeoutError`,
      `none: opened`,
      `wasm: PersistenceUnavailableError`,
      `worker start: PersistenceUnavailableError`,
    ])
  })

  it.each(histories.map((history) => [describeHistory(history), history]))(
    `%s`,
    async (_name, history) => {
      expectOpenOutcome(history, await runOpenHistory(history))
    },
  )
})
