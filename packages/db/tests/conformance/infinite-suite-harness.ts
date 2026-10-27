/**
 * Shared machinery for the infinite-query suite: row fixtures, the state that
 * scopes each scenario's resources to that scenario, the driver wrapper, and
 * the helpers that the oracle and unit scenario modules both use.
 *
 * This module declares no oracle part. Its registry self-test checks the
 * harness's own bookkeeping, not a law. The laws are in
 * infinite-suite-oracle.ts, and the hand-written scenarios are in
 * infinite-suite-cases.ts.
 */
import { expect, it } from 'vitest'
import { ScenarioLifetime } from './scenario-lifetime'
import { ScenarioSources } from './scenario-sources'
import type { scenarioRegistry } from './registration'
import type {
  InfiniteQueryDriver,
  InfiniteQueryHandle,
} from './infinite-contract'

export interface InfiniteRow {
  id: string
  label: string
  rank: number
}

export type ScenarioRegistry = ReturnType<typeof scenarioRegistry>

/** Resources of the scenario that runs now. Both are null between scenarios. */
export interface ScenarioState {
  lifetime: ScenarioLifetime | null
  sources: ScenarioSources | null
}

/** What a scenario module needs to register its scenarios into one suite. */
export interface InfiniteQueryContext {
  driver: InfiniteQueryDriver
  registry: ScenarioRegistry
  state: ScenarioState
}

export function createScenarioState(): ScenarioState {
  return { lifetime: null, sources: null }
}

function runningLifetime(state: ScenarioState): ScenarioLifetime {
  if (state.lifetime === null) throw new Error(`No scenario is running`)
  return state.lifetime
}

/**
 * The lifetime of whichever scenario runs when a body defers cleanup. A
 * module binds it once, when it registers, and each call reads the state then.
 * The binding is nullable like the state it reads: bodies assert that a
 * scenario is running, and `defer` throws when none is.
 */
export function scenarioLifetime(
  state: ScenarioState,
): Pick<ScenarioLifetime, 'defer'> | null {
  return { defer: (cleanup) => runningLifetime(state).defer(cleanup) }
}

/** Releases a promise with the running scenario, and observes its rejection. */
export function trackScenarioPromise(
  state: ScenarioState,
  promise: Promise<void>,
): Promise<void> {
  void promise.catch(() => undefined)
  runningLifetime(state).defer(() => promise)
  return promise
}

/**
 * Wraps the adapter's driver so that every source, handle, and mounted
 * collection a scenario creates is released when that scenario ends.
 */
export function wrapDriver(
  rawDriver: InfiniteQueryDriver,
  state: ScenarioState,
): InfiniteQueryDriver {
  const track = <H extends InfiniteQueryHandle>(handle: H): H => {
    const unmount = handle.unmount.bind(handle)
    if (state.lifetime) handle.unmount = state.lifetime.defer(unmount)
    return handle
  }
  return {
    ...rawDriver,
    makeSource: (data) => state.sources!.track(rawDriver.makeSource(data)),
    makeOnDemandSource: (data, delay) =>
      state.sources!.track(rawDriver.makeOnDemandSource(data, delay)),
    makeLaggingOnDemandSource: (data) =>
      state.sources!.track(rawDriver.makeLaggingOnDemandSource(data)),
    makePrecreated: (build) =>
      state.sources!.track(rawDriver.makePrecreated(build)),
    mount: (build, config) => track(rawDriver.mount(build, config)),
    mountControllable: (build, initial, config) =>
      track(rawDriver.mountControllable(build, initial, config)),
    mountCollection: (collection, config) =>
      track(rawDriver.mountCollection(collection, config)),
    mountCollectionControllable: (collection, config) =>
      track(rawDriver.mountCollectionControllable(collection, config)),
    mountConfigControllable: (build, config) =>
      track(rawDriver.mountConfigControllable(build, config)),
    mountInputControllable: (collection, build, config) =>
      track(rawDriver.mountInputControllable(collection, build, config)),
  }
}

/** Runs one scenario body with its own lifetime and sources, then releases both. */
export async function runScenario(
  state: ScenarioState,
  fn: () => Promise<void> | void,
): Promise<void> {
  const resources = new ScenarioLifetime()
  const ownedSources = new ScenarioSources()
  state.lifetime = resources
  state.sources = ownedSources
  try {
    await resources.run(async () => {
      try {
        await fn()
      } finally {
        ownedSources.defer(resources)
      }
    })
  } finally {
    state.lifetime = null
    state.sources = null
  }
}

export function rows(count: number, prefix = ``): Array<InfiniteRow> {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}${index + 1}`,
    label: `${prefix || `row`}-${index + 1}`,
    rank: count - index,
  }))
}

export async function captureError(
  fn: () => InfiniteQueryHandle,
): Promise<unknown> {
  try {
    const handle = fn()
    await handle.flush()
    handle.unmount()
    return undefined
  } catch (error) {
    return error
  }
}

export async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return
    await Promise.resolve()
  }
  throw new Error(`Condition did not become true`)
}

export async function waitForAsync(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`Condition did not become true`)
}

/** Harness self-test: the suite registers each scenario key exactly once. */
export function registerRegistrySelfTest(registry: ScenarioRegistry): void {
  it(`registers every distinct scenario without whole-test waivers`, () => {
    expect(registry.size).toBe(39)
  })
}
