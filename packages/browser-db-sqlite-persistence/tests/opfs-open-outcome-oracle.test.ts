/**
 * jsdom production driver for the OPFS open outcome oracle in
 * `opfs-open-outcome-oracle.ts`. It calls the public opener with a controlled
 * Worker, which can refuse construction, fail to load its script (an `error`
 * event after construction), answer initialization, stay silent, or report
 * the WASM failure the way the real worker does: as a
 * `PERSISTENCE_UNAVAILABLE` response. Fake timers drive the open deadline. The
 * driver records reach at the Worker boundary: constructor calls and the
 * initialization requests that a loaded worker receives.
 *
 * No asset lookup runs here, because only the package build defines it. The
 * Chromium driver in `e2e/opfs-open-outcome-witness.e2e.test.ts` supplies the
 * lookup and the real worker's WASM fetch.
 */
import { afterEach, describe, vi } from 'vitest'
import { oracleProperty } from '../../db/tests/oracle-property'
import {
  forwardAssertionJudgment,
  recordAssertionJudgment,
  recordedAssertionJudgment,
} from '../../db/tests/oracle-assertion-adapter'
import { openBrowserWASQLiteOPFSDatabase } from '../src/opfs-database'
import {
  describeHistory,
  expectOpenOutcome,
  openHistories,
} from './opfs-open-outcome-oracle'
import { jsdomReach } from './opfs-open-outcome-jsdom-grammar-oracle'
import type {
  OpenHistory,
  OpenObservation,
  OpenSettlement,
} from './opfs-open-outcome-oracle'
import type {
  BrowserOPFSWorkerRequest,
  BrowserOPFSWorkerResponse,
} from '../src/opfs-worker-protocol'

// The helper module declares the law and model; this driver is the only
// production path that its open histories reach. The grammar check that these
// histories reach every outcome the driver controls is an ordinary test of
// test code, in opfs-open-outcome-jsdom-grammar.test.ts.
const histories = openHistories(jsdomReach)
const deadlineMs = 40

// Implements only the Worker surface that the opener uses.
class ControlledWorker {
  static history: OpenHistory
  static constructorCalls = 0
  static initRequests = 0
  static started = 0
  static terminated = 0
  static heldResponses: Array<() => void> = []

  private readonly listeners = new Set<
    (event: MessageEvent<BrowserOPFSWorkerResponse>) => void
  >()
  private readonly errorListeners = new Set<(event: MessageEvent) => void>()

  constructor() {
    ControlledWorker.constructorCalls++
    if (ControlledWorker.history.workerStart === `throws`) {
      throw new DOMException(`The worker was refused`, `SecurityError`)
    }
    ControlledWorker.started++
    if (ControlledWorker.history.workerStart === `fails to load`) {
      // The browser reports a script that fails to load after construction.
      queueMicrotask(() => {
        for (const listener of this.errorListeners) {
          listener(new Event(`error`) as MessageEvent)
        }
      })
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === `message`) this.listeners.add(listener)
    if (type === `error`) this.errorListeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === `message`) this.listeners.delete(listener)
    if (type === `error`) this.errorListeners.delete(listener)
  }

  postMessage(request: BrowserOPFSWorkerRequest): void {
    // A worker whose script did not load handles no messages.
    if (ControlledWorker.history.workerStart === `fails to load`) return
    if (request.type === `init`) ControlledWorker.initRequests++
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
  ControlledWorker.constructorCalls = 0
  ControlledWorker.initRequests = 0
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
    reached: {
      // No asset lookup runs outside the package build.
      lookup: false,
      workerStart: ControlledWorker.constructorCalls > 0,
      initialization: ControlledWorker.initRequests > 0,
    },
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

// Each enumerated open history runs through the jsdom driver, and the helper
// module's refinement check, expectOpenOutcome, judges the observation against
// its expectedOpenOutcome model. The adapter transports that judgment.
const openOutcomeLaw = `OPFS open outcome`
describe(`OPFS open outcome oracle (jsdom driver)`, () => {
  oracleProperty({
    id: `opfs.open-outcome`,
    law: {
      statement: `An OPFS open settles as the open outcome model predicts: a capability failure rejects with PersistenceUnavailableError, the deadline with TimeoutError, and an abort with its reason; a failed or interrupted open terminates the worker it started, and a later open can still succeed.`,
      authority: `The README's open settlement promise, as opfs-open-outcome-oracle.ts states it.`,
      limits: `The enumerated open histories that the jsdom driver controls; no asset lookup and no real worker WASM fetch (the Chromium witness supplies both).`,
    },
    owns: [`src/opfs-database.ts#openBrowserWASQLiteOPFSDatabase`],
    histories,
    label: describeHistory,
    resolve: (history) => ({ history }),
    model: recordedAssertionJudgment,
    driver: (plan, observe) =>
      recordAssertionJudgment(openOutcomeLaw, plan, observe, async () => {
        expectOpenOutcome(plan.history, await runOpenHistory(plan.history))
      }),
    check: forwardAssertionJudgment,
  })
})
