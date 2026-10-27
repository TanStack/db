/**
 * # How does opening the browser OPFS database settle?
 *
 * `openBrowserWASQLiteOPFSDatabase` runs up to four steps in order:
 *
 * 1. Asset lookup. Only a pre-bundled copy under a Vite dev server asks the dev
 *    server for its asset URLs; elsewhere this step is not needed.
 * 2. Worker start. The page constructs the dedicated worker, and the browser
 *    loads its script. Construction can throw, or the script can fail to load
 *    after construction, which the worker reports with an `error` event.
 * 3. WASM load. The worker fetches and compiles `wa-sqlite.wasm`.
 * 4. Initialization. The worker opens the database and answers.
 *
 * The README promises how the open settles. A capability failure in steps 1
 * to 3 rejects with `PersistenceUnavailableError`. The open deadline rejects a
 * pending open with `TimeoutError`, and the caller's abort rejects it with the
 * abort reason; both cover every step. A failed or interrupted open terminates
 * the worker it started, and a step that completes after the open settled
 * starts no worker. A later open in the same page can still succeed after an
 * interruption.
 *
 * This module holds that law, the history grammar, the model, and the
 * comparison. Each production driver supplies the entry point, controls the
 * steps it can reach, and records an observation, including which steps
 * production actually reached. The jsdom driver reaches
 * worker start, initialization, and the worker's WASM failure response with a
 * controlled worker. The Chromium driver reaches the asset lookup, a real WASM
 * fetch, and worker start against a real Vite dev server. Neither driver states
 * expected results.
 *
 * Limits: the grammar does not interrupt an open in the same turn as a failing
 * step, because no law orders those two causes yet. Initialization errors other
 * than the WASM response belong to the OPFS page lifecycle oracle.
 */
import { expect } from 'vitest'

/*
 * ## History grammar
 *
 * A history fixes how each step behaves. A held lookup or a silent
 * initialization leaves the open pending, so the grammar pairs each with an
 * interruption; a history that always fails earlier fixes the later steps to
 * their defaults, so the product has no duplicates.
 */
export type AssetLookup = `not needed` | `resolves` | `held` | `fails`
export type WorkerStart = `starts` | `throws` | `fails to load`
export type WasmLoad = `loads` | `fails`
export type Initialization = `answers` | `silent`
export type Interruption = `none` | `deadline` | `abort`

export type OpenHistory = {
  lookup: AssetLookup
  workerStart: WorkerStart
  wasm: WasmLoad
  init: Initialization
  interrupt: Interruption
}

/** The step values a production driver can control. */
export type OpenDriverReach = {
  lookup: ReadonlyArray<AssetLookup>
  workerStart: ReadonlyArray<WorkerStart>
  wasm: ReadonlyArray<WasmLoad>
  init: ReadonlyArray<Initialization>
  interrupt: ReadonlyArray<Interruption>
}

const settledEarly = {
  workerStart: `starts`,
  wasm: `loads`,
  init: `answers`,
  interrupt: `none`,
} as const

/** Every legal history within a driver's reach (bounded exhaustiveness). */
export function openHistories(
  reach: OpenDriverReach,
): ReadonlyArray<OpenHistory> {
  const interrupts = reach.interrupt.filter((value) => value !== `none`)
  return reach.lookup.flatMap((lookup): Array<OpenHistory> => {
    if (lookup === `fails`) return [{ lookup, ...settledEarly }]
    if (lookup === `held`) {
      return interrupts.map((interrupt) => ({
        lookup,
        ...settledEarly,
        interrupt,
      }))
    }
    return reach.workerStart.flatMap((workerStart): Array<OpenHistory> => {
      if (workerStart !== `starts`) {
        return [{ ...settledEarly, lookup, workerStart }]
      }
      return reach.wasm.flatMap((wasm): Array<OpenHistory> => {
        if (wasm === `fails`) return [{ ...settledEarly, lookup, wasm }]
        return reach.init.flatMap((init): Array<OpenHistory> =>
          init === `silent`
            ? interrupts.map((interrupt) => ({
                lookup,
                workerStart,
                wasm,
                init,
                interrupt,
              }))
            : [{ ...settledEarly, lookup }],
        )
      })
    })
  })
}

/*
 * ## Observation
 *
 * The driver records the settlement by error name, then lets every held step
 * complete before it counts started and terminated workers. That checkpoint
 * catches a worker started by a late step. After an interruption the driver
 * also opens again in the same page.
 *
 * `reached` is the positive execution witness: the steps that production
 * actually reached, recorded at the boundary the driver controls. The asset
 * lookup is reached when the dev server receives it, worker start when the
 * Worker constructor runs, and initialization when the worker receives the
 * request that loads the WASM file. Without it, a history could pass by
 * settling the same way through a different path.
 */
export type ReachedSteps = {
  lookup: boolean
  workerStart: boolean
  initialization: boolean
}

export type OpenSettlement =
  `opened` | `PersistenceUnavailableError` | `TimeoutError` | `AbortError`

export type OpenObservation = {
  settlement: OpenSettlement
  startedWorkers: number
  terminatedWorkers: number
  reached: ReachedSteps
  laterOpen?: `opened`
}

/*
 * ## Model
 *
 * The first step that fails or stays pending decides the settlement. Steps 1
 * and 2 run before a worker exists; steps 3 and 4 run inside one started
 * worker, which a failure or interruption terminates.
 */
export type DecidingStep =
  `lookup` | `worker start` | `wasm` | `initialization` | `none`

export function decidingStep(history: OpenHistory): DecidingStep {
  if (history.lookup === `fails` || history.lookup === `held`) return `lookup`
  if (history.workerStart !== `starts`) return `worker start`
  if (history.wasm === `fails`) return `wasm`
  if (history.init === `silent`) return `initialization`
  return `none`
}

// Steps run in order, so each step is reached only when every earlier one
// completed.
function expectedReach(history: OpenHistory): ReachedSteps {
  const lookup = history.lookup !== `not needed`
  const workerStart =
    history.lookup === `not needed` || history.lookup === `resolves`
  return {
    lookup,
    workerStart,
    initialization: workerStart && history.workerStart === `starts`,
  }
}

export function expectedOpenOutcome(history: OpenHistory): OpenObservation {
  return { ...expectedSettlement(history), reached: expectedReach(history) }
}

function expectedSettlement(
  history: OpenHistory,
): Omit<OpenObservation, `reached`> {
  const interrupted: OpenSettlement =
    history.interrupt === `deadline` ? `TimeoutError` : `AbortError`
  switch (decidingStep(history)) {
    case `lookup`:
      return history.lookup === `held`
        ? {
            settlement: interrupted,
            startedWorkers: 0,
            terminatedWorkers: 0,
            laterOpen: `opened`,
          }
        : {
            settlement: `PersistenceUnavailableError`,
            startedWorkers: 0,
            terminatedWorkers: 0,
          }
    case `worker start`:
      // A worker whose script fails to load was constructed, so the failed
      // open terminates it.
      return history.workerStart === `throws`
        ? {
            settlement: `PersistenceUnavailableError`,
            startedWorkers: 0,
            terminatedWorkers: 0,
          }
        : {
            settlement: `PersistenceUnavailableError`,
            startedWorkers: 1,
            terminatedWorkers: 1,
          }
    case `wasm`:
      return {
        settlement: `PersistenceUnavailableError`,
        startedWorkers: 1,
        terminatedWorkers: 1,
      }
    case `initialization`:
      return {
        settlement: interrupted,
        startedWorkers: 1,
        terminatedWorkers: 1,
        laterOpen: `opened`,
      }
    case `none`:
      return { settlement: `opened`, startedWorkers: 1, terminatedWorkers: 0 }
  }
}

/*
 * ## Grammar coverage
 *
 * Each driver declares the deciding steps and settlements that its history
 * product must cover. This check judges the grammar, not production: it fails
 * when a narrowed reach declaration drops an outcome. The `reached`
 * observation is the production reach witness.
 */
export function reachedOutcomes(
  histories: ReadonlyArray<OpenHistory>,
): Array<string> {
  return [
    ...new Set(
      histories.map(
        (history) =>
          `${decidingStep(history)}: ${expectedOpenOutcome(history).settlement}`,
      ),
    ),
  ].sort()
}

/** The refinement check at the observation checkpoint. */
export function expectOpenOutcome(
  history: OpenHistory,
  observation: OpenObservation,
): void {
  expect(observation).toEqual(expectedOpenOutcome(history))
}

/** A readable name for a history, used as the test title. */
export function describeHistory(history: OpenHistory): string {
  return `lookup ${history.lookup}, worker ${history.workerStart}, wasm ${history.wasm}, init ${history.init}, interrupt ${history.interrupt}`
}
