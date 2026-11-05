/**
 * Synthetic properties for the oracleProperty self-oracle.
 *
 * `syntheticProperty(spec)` registers one `oracleProperty` whose parts are
 * small enough that the self-oracle's own model can predict every outcome.
 * A history is a list of one to three integers:
 *
 * - `0`, `1`, `2` are ordinary items; a history that holds `k` reaches the
 *   state `saw-k`.
 * - `3` and `4` violate the laws `three` and `four`. The check reports the
 *   first of them in the history.
 * - `6` makes the driver throw right after it records that item.
 *
 * A constructed history builds its history as its prefix followed by a generated history,
 * cut to three items. The driver appends every history it runs, with the running test's name, to
 * the file named by SELF_ORACLE_LOG, so the self-oracle knows which
 * histories each campaign ran. A `nondeterministic` spec also records, last, a
 * counter that changes on every run. A spec reports reach through the
 * property's `reached` part or, as the framework's default, through the
 * driver's `observe("reach", state)`. A `slow` spec's driver takes about
 * 300 ms per history, so a small `timeout` fails every test that runs one.
 * A spec with a `probe` binds `saw-0` to the production probe `synthetic#saw-0`
 * and predicts that a history enters it when it holds a 0. The driver calls
 * that probe first, with a condition: `agree` calls it with `true` when the
 * history holds a 0 and `false` otherwise, `always` calls it with `true` in
 * every history, `never` calls it with `false` in every history, `unreached`
 * never calls it, and `late` calls it as `agree` does and once more, with
 * `true`, from a timer it does not await. With `overReport`, the spec also reports `saw-0`
 * as reached in every history, so only the agreement can keep its count
 * right. `predict` is passed when the spec binds a probe, unless
 * `predictMode` is `missing`; with `extra` it is passed although no state is
 * bound.
 *
 * The synthetic ids come from a fixed pool, registered in oracle-config.
 */
import { appendFileSync } from 'node:fs'
import fc from 'fast-check'
import { expect } from 'vitest'
import { oracleProperty, pass, violation } from './oracle-property.js'
import type { Calibration } from './oracle-property.js'

export const syntheticIds = [
  `self-oracle.synthetic-0`,
  `self-oracle.synthetic-1`,
  `self-oracle.synthetic-2`,
  `self-oracle.synthetic-3`,
] as const

export type SyntheticHistory = ReadonlyArray<number>

export type SyntheticSpec = {
  id: (typeof syntheticIds)[number]
  source:
    | { kind: `generated`; runs: number; seed: number }
    | { kind: `enumerated`; histories: ReadonlyArray<SyntheticHistory> }
  /** Required states; each must be entered by a constructed history. */
  states: ReadonlyArray<string>
  constructed: ReadonlyArray<{
    name: string
    prefix: SyntheticHistory
    enters: ReadonlyArray<string>
  }>
  fixed: ReadonlyArray<{
    name: string
    history: SyntheticHistory
    enters?: ReadonlyArray<string>
  }>
  nondeterministic: boolean
  calibrations: ReadonlyArray<{
    name: string
    kind: `right` | `wrong-law` | `no-op` | `driver`
  }>
  /** `observe`: the driver reports reach itself, the framework's default. */
  reachVia: `reached` | `observe`
  /** Each history takes about 300 ms; with `timeout`, tests outlive it. */
  slow?: boolean
  timeout?: number
  /** Registers under an id no oracle configuration knows. */
  unregistered?: boolean
  /** How the driver calls the probe bound to `saw-0`; absent, no probe. */
  probe?: `agree` | `always` | `never` | `unreached` | `late`
  /** Reports `saw-0` as reached in every history. */
  overReport?: boolean
  /** Calls an unbound probe on every run, entering it on every other one, so only determinism sees it. */
  noisyProbe?: boolean
  /** `missing` omits `predict` for a bound probe; `extra` passes it unbound. */
  predictMode?: `missing` | `extra`
}

/** The synthetic language: one to three items, mostly ordinary ones. */
export const syntheticArbitrary: fc.Arbitrary<SyntheticHistory> = fc.array(
  fc.oneof(
    { arbitrary: fc.integer({ min: 0, max: 2 }), weight: 6 },
    { arbitrary: fc.constantFrom(3, 4, 6), weight: 1 },
  ),
  { minLength: 1, maxLength: 3 },
)

const allStates = [`saw-0`, `saw-1`, `saw-2`]
const syntheticProbe = `synthetic#saw-0`
let nonce = 0
let noise = 0

const enteredStates = (history: SyntheticHistory) =>
  allStates.filter((state) => history.includes(Number(state.slice(4))))
const reachedStates = (spec: SyntheticSpec) => (history: SyntheticHistory) =>
  spec.overReport
    ? [...new Set([...enteredStates(history), `saw-0`])]
    : enteredStates(history)

/**
 * The condition the synthetic driver passes to the probe for this history, or
 * undefined when it makes no call.
 */
const probeCondition = (
  spec: SyntheticSpec,
  history: SyntheticHistory,
): boolean | undefined => {
  switch (spec.probe) {
    case `always`:
      return true
    case `never`:
      return false
    case `agree`:
    case `late`:
      return history.includes(0)
    default:
      return undefined
  }
}

/**
 * The synthetic driver. `mutant` records a 3 in place of the first item, the
 * wrong answer a driver calibration supplies.
 */
function syntheticDriver(spec: SyntheticSpec, mutant = false) {
  return async (
    history: SyntheticHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) => {
    const log = process.env.SELF_ORACLE_LOG
    if (log)
      appendFileSync(
        log,
        `${JSON.stringify({ id: spec.id, test: expect.getState().currentTestName ?? ``, history })}\n`,
      )
    if (spec.slow) await new Promise((resolve) => setTimeout(resolve, 300))
    const condition = probeCondition(spec, history)
    if (condition !== undefined)
      process.env.NODE_ENV !== `production` &&
        (
          globalThis as {
            __oracleProbe?: (name: string, condition: unknown) => void
          }
        ).__oracleProbe?.(`synthetic#saw-0`, condition)
    if (spec.noisyProbe)
      process.env.NODE_ENV !== `production` &&
        (
          globalThis as {
            __oracleProbe?: (name: string, condition: unknown) => void
          }
        ).__oracleProbe?.(`synthetic#noise`, noise++ % 2 === 0)
    // Production work the driver does not await, calling its probe after its history.
    if (spec.probe === `late` && history.includes(0))
      setTimeout(
        () =>
          process.env.NODE_ENV !== `production` &&
          (
            globalThis as {
              __oracleProbe?: (name: string, condition: unknown) => void
            }
          ).__oracleProbe?.(`synthetic#saw-0`, true),
        0,
      )
    if (spec.reachVia === `observe`)
      for (const state of reachedStates(spec)(history)) observe(`reach`, state)
    for (const [index, item] of history.entries()) {
      observe(`item ${index}`, mutant && index === 0 ? 3 : item)
      if (item === 6)
        throw new Error(`synthetic driver failed at item ${index}`)
    }
    // Last, so a comparison of only the first observations misses it.
    if (spec.nondeterministic) observe(`nonce`, nonce++)
  }
}

function syntheticCheck(
  history: SyntheticHistory,
  trace: ReadonlyArray<{ checkpoint: string; value: unknown }>,
) {
  for (const { checkpoint, value } of trace) {
    // Only items carry the law; a nonce is not an item.
    if (!checkpoint.startsWith(`item`)) continue
    if (value === 3) return violation(checkpoint, `item is 3`, `three`)
    if (value === 4) return violation(checkpoint, `item is 4`, `four`)
  }
  const items = trace.filter(({ checkpoint }) => checkpoint.startsWith(`item`))
  if (items.length !== history.length)
    return violation(
      `trace`,
      `${items.length} of ${history.length} items recorded`,
      `trace`,
    )
  return pass
}

function syntheticCalibrations(
  spec: SyntheticSpec,
): Array<Calibration<SyntheticHistory, SyntheticHistory>> {
  return spec.calibrations.map(
    ({ name, kind }): Calibration<SyntheticHistory, SyntheticHistory> => {
      // A mutant driver records a 3 in place of the first item.
      if (kind === `driver`)
        return { name, law: `three`, driver: syntheticDriver(spec, true) }
      return {
        name,
        law: kind === `wrong-law` ? `four` : `three`,
        corrupt: (trace) => {
          const at = trace.findIndex(({ checkpoint }) =>
            checkpoint.startsWith(`item`),
          )
          if (at < 0) return undefined
          if (kind === `no-op`) return [...trace]
          return trace.map((entry, index) =>
            index === at ? { ...entry, value: 3 } : entry,
          )
        },
      }
    },
  )
}

export function syntheticProperty(spec: SyntheticSpec): void {
  const id = spec.unregistered ? `self-oracle.unregistered` : spec.id
  const parts = {
    model: () => undefined,
    // Without `reached`, the framework counts the driver's `reach` records.
    ...(spec.reachVia === `reached` ? { reached: reachedStates(spec) } : {}),
    ...((spec.probe && spec.predictMode !== `missing`) ||
    spec.predictMode === `extra`
      ? {
          predict: (history: SyntheticHistory) => ({
            'saw-0': history.includes(0),
          }),
        }
      : {}),
    driver: syntheticDriver(spec),
    calibrations: syntheticCalibrations(spec),
    ...(spec.timeout !== undefined ? { timeout: spec.timeout } : {}),
  }
  const law = {
    statement: `A synthetic history holds no 3 and no 4.`,
    authority: `the oracleProperty self-oracle's synthetic specification`,
    limits: `Synthetic; histories of one to three integers.`,
    owner: `oracleProperty framework`,
  }
  if (spec.source.kind === `enumerated`) {
    oracleProperty({
      id,
      law,
      histories: spec.source.histories,
      // A label with `|`, which a rerun command must escape.
      label: (history) => `items ${history.join(` | `)}`,
      ...parts,
      check: syntheticCheck,
    })
    return
  }
  // With a probe, `saw-0` is a probe-bound state wherever it is declared.
  const declare = (state: string) =>
    spec.probe && state === `saw-0`
      ? { name: state, probe: syntheticProbe }
      : state
  oracleProperty({
    id,
    law,
    histories: {
      arbitrary: syntheticArbitrary,
      states: spec.states.map(declare),
      measured: allStates
        .filter((state) => !spec.states.includes(state))
        .map(declare),
      runs: spec.source.runs,
      fixedSeeds: [spec.source.seed],
      constructed: spec.constructed.map(({ name, prefix, enters }) => ({
        name,
        enters,
        // A constructed history extends a generated history, so its histories
        // depend on the campaign's seed, as real constructed histories do.
        build: (generated: SyntheticHistory) =>
          [...prefix, ...generated].slice(0, 3),
      })),
      fixed: spec.fixed,
    },
    ...parts,
    check: syntheticCheck,
  })
}
