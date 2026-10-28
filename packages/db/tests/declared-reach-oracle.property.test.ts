/**
 * Declared reach (ORC-015) cannot miss by chance where a property fixes it.
 *
 * A generated property declares the states its laws depend on, and
 * `createOracleReach` fails a run in which too few histories entered one.
 * Two rules decide when that check runs and what it proves (#2287):
 *
 * - The check runs in an ordinary run and in a run with only
 *   `TANSTACK_DB_ORACLE_SEED`: a seed alone reseeds the whole campaign at its
 *   full budget. Only a path replay, which runs one recorded history, skips
 *   it.
 * - A property can run fixed examples first in every run. With
 *   `fixedHistories: n`, the check also fails for each declared state that
 *   the first n histories, the examples, did not enter. Such a state's reach
 *   would depend on the seed. The examples come on top of the base run
 *   budget, so they never displace a random history, and a path replay still
 *   runs one history.
 *
 * The model below states both rules over a generated ledger: a run kind, a
 * minimum, a number of fixed histories, and the states each history enters.
 * The driver runs `createOracleReach` and `oracleRandomParameters` under that
 * run kind's environment, and the check compares counts, the failure, and
 * the states the failure names with the model.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, expect } from 'vitest'
import { createOracleReach } from './oracle-reach.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'

const property = `oracle.declared-reach`

type RunKind = `ordinary` | `seed` | `path`
type Ledger = {
  run: RunKind
  states: ReadonlyArray<string>
  minimum: number
  fixedHistories: number
  // The indices of the states each history enters, with repeats.
  histories: ReadonlyArray<ReadonlyArray<number>>
}
type Verdict = {
  counts: ReadonlyMap<string, number>
  belowMinimum: ReadonlyMap<string, number>
  unfixed: ReadonlyArray<string>
}

// The grammar: two to four states, and up to six histories over them.
const ledgerArbitrary: fc.Arbitrary<Ledger> = fc
  .integer({ min: 2, max: 4 })
  .chain((stateCount) =>
    fc.record({
      run: fc.constantFrom<RunKind>(`ordinary`, `seed`, `path`),
      states: fc.constant(
        Array.from({ length: stateCount }, (_, index) => `state ${index}`),
      ),
      minimum: fc.integer({ min: 1, max: 3 }),
      fixedHistories: fc.integer({ min: 0, max: 4 }),
      histories: fc.array(
        fc.array(fc.integer({ min: 0, max: stateCount - 1 }), {
          maxLength: 4,
        }),
        { maxLength: 6 },
      ),
    }),
  )

// The model. A history counts once per state it enters. A path replay checks
// nothing. Otherwise a state fails below the minimum, and, when fixed
// histories are declared, a state the first ones did not enter fails too.
function expectedVerdict(ledger: Ledger): Verdict | `skipped` {
  if (ledger.run === `path`) return `skipped`
  const entered = ledger.histories.map(
    (history) => new Set(history.map((index) => ledger.states[index]!)),
  )
  const counts = new Map(
    ledger.states.map((state) => [
      state,
      entered.filter((history) => history.has(state)).length,
    ]),
  )
  const fixed = entered.slice(0, ledger.fixedHistories)
  return {
    counts,
    belowMinimum: new Map(
      [...counts].filter(([, count]) => count < ledger.minimum),
    ),
    unfixed:
      ledger.fixedHistories === 0
        ? []
        : ledger.states.filter((state) =>
            fixed.every((history) => !history.has(state)),
          ),
  }
}

// The environment each run kind sets.
function runEnvironment(run: RunKind): Record<string, string> {
  if (run === `ordinary`) return {}
  if (run === `seed`) return { TANSTACK_DB_ORACLE_SEED: `1` }
  return {
    TANSTACK_DB_ORACLE_SEED: `1`,
    TANSTACK_DB_ORACLE_PATH: `0`,
    TANSTACK_DB_ORACLE_PROPERTY: property,
  }
}

function withEnvironment<T>(variables: Record<string, string>, run: () => T) {
  const names = [
    `TANSTACK_DB_ORACLE_SEED`,
    `TANSTACK_DB_ORACLE_PATH`,
    `TANSTACK_DB_ORACLE_PROPERTY`,
  ]
  const saved = names.map((name) => [name, process.env[name]] as const)
  for (const name of names) delete process.env[name]
  Object.assign(process.env, variables)
  try {
    return run()
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

// The driver: one ledger through createOracleReach.
function observeLedger(ledger: Ledger) {
  const reach = withEnvironment(runEnvironment(ledger.run), () =>
    createOracleReach(`ledger`, ledger.states, {
      minimum: ledger.minimum,
      fixedHistories: ledger.fixedHistories,
    }),
  )
  for (const history of ledger.histories) {
    reach.beginHistory()
    for (const index of history) reach.reach(ledger.states[index]!)
  }
  let failure: string | undefined
  try {
    reach.assertReached()
  } catch (error) {
    failure = (error as Error).message
  }
  return { counts: new Map(reach.counts()), failure }
}

// The states a failure names: `name (count)` below the minimum, and a list of
// names for the fixed histories.
function namedStates(failure: string) {
  const below = /not enforced there: (.*)$/m.exec(failure)?.[1]
  const unfixed = /reach depends on the seed: (.*)$/m.exec(failure)?.[1]
  return {
    belowMinimum: new Map(
      (below?.split(`, `) ?? []).map((entry) => {
        const match = /^(.*) \((\d+)\)$/.exec(entry)!
        return [match[1]!, Number(match[2])] as const
      }),
    ),
    unfixed: unfixed?.split(`, `) ?? [],
  }
}

// The check: the observed ledger refines the model.
function checkLedger(ledger: Ledger) {
  const expected = expectedVerdict(ledger)
  const observed = observeLedger(ledger)
  if (expected === `skipped`) {
    expect(observed.failure, `a path replay checks no reach`).toBeUndefined()
    return expected
  }
  expect(observed.counts, `histories per state`).toEqual(expected.counts)
  const fails = expected.belowMinimum.size > 0 || expected.unfixed.length > 0
  expect(observed.failure !== undefined, `the reach check fails`).toBe(fails)
  if (observed.failure !== undefined) {
    const named = namedStates(observed.failure)
    expect(named.belowMinimum, `states below the minimum`).toEqual(
      expected.belowMinimum,
    )
    expect(named.unfixed, `states the fixed histories missed`).toEqual(
      expected.unfixed,
    )
  }
  return expected
}

// The run budget: the examples come on top of the base runs, except in a
// path replay of this property, which runs one history.
function expectedNumRuns(run: RunKind, baseRuns: number, examples: number) {
  return run === `path` ? 1 : baseRuns + examples
}

function checkRunParameters(
  run: RunKind,
  baseRuns: number,
  examples: ReadonlyArray<number>,
) {
  const parameters = oracleRandomParameters(
    baseRuns,
    run === `ordinary`
      ? undefined
      : run === `seed`
        ? { replaySeed: 1, replayPath: undefined, replayProperty: undefined }
        : { replaySeed: 1, replayPath: `0`, replayProperty: property },
    property,
    examples,
  )
  expect(parameters.numRuns, `runs`).toBe(
    expectedNumRuns(run, baseRuns, examples.length),
  )
  expect(parameters.examples, `examples`).toEqual(examples)
}

declareOracle({
  check: [checkLedger, checkRunParameters],
  model: [expectedVerdict, expectedNumRuns],
  grammar: [ledgerArbitrary],
})

const reachStates = [
  `a seed-only run fails below the minimum`,
  `a path replay with a state below the minimum`,
  `a fixed history miss that a later history enters`,
  `a state below a minimum above one`,
  `a ledger that passes`,
] as const
const ledgerReach = createOracleReach(`oracle.declared-reach`, reachStates)
let ledgersRan = false
afterAll(() => {
  if (ledgersRan) ledgerReach.assertReached()
})

fcTest.prop(
  [
    ledgerArbitrary,
    fc.integer({ min: 1, max: 200 }),
    fc.array(fc.integer(), { maxLength: 5 }),
  ],
  oraclePropertyOptions(200, property),
)(
  `reach ledgers refine the declared reach model`,
  (ledger, baseRuns, examples) => {
    ledgersRan = true
    ledgerReach.beginHistory()
    const verdict = checkLedger(ledger)
    checkRunParameters(ledger.run, baseRuns, examples)
    if (verdict === `skipped`) {
      const ordinary = expectedVerdict({ ...ledger, run: `ordinary` })
      if (ordinary !== `skipped` && ordinary.belowMinimum.size > 0)
        ledgerReach.reach(`a path replay with a state below the minimum`)
      return
    }
    if (ledger.run === `seed` && verdict.belowMinimum.size > 0)
      ledgerReach.reach(`a seed-only run fails below the minimum`)
    if (verdict.unfixed.some((state) => (verdict.counts.get(state) ?? 0) > 0))
      ledgerReach.reach(`a fixed history miss that a later history enters`)
    if (ledger.minimum > 1 && verdict.belowMinimum.size > 0)
      ledgerReach.reach(`a state below a minimum above one`)
    if (verdict.belowMinimum.size === 0 && verdict.unfixed.length === 0)
      ledgerReach.reach(`a ledger that passes`)
  },
)
