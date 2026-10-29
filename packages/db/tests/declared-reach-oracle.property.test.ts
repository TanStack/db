/**
 * Declared reach (ORC-015) cannot miss by chance where a property fixes it.
 *
 * A generated property declares the states its laws depend on, and
 * `createOracleReach` fails a run in which too few histories entered one.
 * Two rules decide when that check runs and what it proves (#2287):
 *
 * - The check runs in an ordinary run and in a run with only
 *   `TANSTACK_DB_ORACLE_SEED`: a seed alone reseeds the whole campaign at its
 *   full budget. A path replay, which runs one recorded history, skips it.
 *   It skips it in every reach of that process, also in a property that the
 *   replay does not name and that still runs its seeded budget: a reach need
 *   not carry its property's name, so it cannot tell whose replay runs.
 * - A property can run fixed examples first in every run. With
 *   `fixedHistories: n`, the check also fails for each declared state that
 *   the first n histories, the examples, did not enter. Such a state's reach
 *   would depend on the seed. When fewer than n histories ran, a failure
 *   stopped the run inside the examples, and the check says so instead. The
 *   examples come on top of the base run budget, so they never displace a
 *   random history. A replay keeps its seed, and a path replay of the property
 *   keeps its path and still runs one history.
 *
 * The first n histories are the examples only when the reach belongs to one
 * property and that property's callback begins every history. A driver calls
 * `reach(state)` inside a history: a call before the first `beginHistory()`
 * is a driver error, so it throws and counts nothing.
 *
 * `runOracleCampaign` follows the first rule for its own replay prefix: a
 * seed-only run of its campaign checks reach, and only a path replay skips it.
 *
 * The model below states these rules over a generated ledger: a run kind, a
 * minimum, a number of fixed histories, the states each history enters, and
 * the states reached before the first history.
 * The drivers run `createOracleReach`, `runOracleCampaign`, and
 * `oracleRandomParameters` under that run kind's environment, and
 * `oraclePropertyOptions` under the process's own. The checks compare counts,
 * the failure, and the states the failure names with the model.
 */
import { fc, test as fcTest } from '@fast-check/vitest'
import { afterAll, expect, vi } from 'vitest'
import { createOracleReach } from './oracle-reach.js'
import { runOracleCampaign } from './oracle-campaign.js'
import {
  oraclePropertyOptions,
  oracleRandomParameters,
} from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'

const property = `oracle.declared-reach`

// `other-path` is a path replay of another property, in the same process.
type RunKind = `ordinary` | `seed` | `path` | `other-path`
const otherProperty = `lint.part-reach`
type Ledger = {
  run: RunKind
  states: ReadonlyArray<string>
  minimum: number
  fixedHistories: number
  // The indices of the states reached before the first history.
  early: ReadonlyArray<number>
  // The indices of the states each history enters, with repeats.
  histories: ReadonlyArray<ReadonlyArray<number>>
}
// The states a failing reach check names, and an absent failure when the check
// passes or does not run.
type Failure = {
  belowMinimum: ReadonlyMap<string, number>
  unfixed: ReadonlyArray<string>
  // How many histories ran, when fewer than the fixed ones did.
  stoppedAt?: number
}
type Verdict = {
  // The states whose reach before the first history threw, in call order.
  rejected: ReadonlyArray<string>
  counts: ReadonlyMap<string, number>
  failure: Failure | undefined
}

// The grammar: two to four states, and up to six histories over them. A
// quarter of the ledgers first reach a state or two before any history.
const ledgerArbitrary: fc.Arbitrary<Ledger> = fc
  .integer({ min: 2, max: 4 })
  .chain((stateCount) =>
    fc.record({
      run: fc.constantFrom<RunKind>(`ordinary`, `seed`, `path`, `other-path`),
      states: fc.constant(
        Array.from({ length: stateCount }, (_, index) => `state ${index}`),
      ),
      minimum: fc.integer({ min: 1, max: 3 }),
      fixedHistories: fc.integer({ min: 0, max: 4 }),
      early: fc.oneof(
        { arbitrary: fc.constant([]), weight: 3 },
        {
          arbitrary: fc.array(fc.integer({ min: 0, max: stateCount - 1 }), {
            minLength: 1,
            maxLength: 2,
          }),
          weight: 1,
        },
      ),
      histories: fc.array(
        fc.array(fc.integer({ min: 0, max: stateCount - 1 }), {
          maxLength: 4,
        }),
        { maxLength: 6 },
      ),
    }),
  )

// The model. Every reach before the first history throws and counts nothing.
// A history counts once per state it enters, in every run kind. A path replay
// of any property checks nothing. Otherwise a state fails below the minimum.
// When fixed histories are declared, a state the first ones did not enter
// fails too, unless fewer histories ran than the fixed ones: then a failure
// stopped the run, and the check names how many histories ran, and no state.
function expectedVerdict(ledger: Ledger): Verdict {
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
  const belowMinimum = new Map(
    [...counts].filter(([, count]) => count < ledger.minimum),
  )
  const stopped = ledger.histories.length < ledger.fixedHistories
  const unfixed =
    ledger.fixedHistories === 0 || stopped
      ? []
      : ledger.states.filter((state) =>
          fixed.every((history) => !history.has(state)),
        )
  const failure: Failure = stopped
    ? { belowMinimum: new Map(), unfixed, stoppedAt: ledger.histories.length }
    : { belowMinimum, unfixed }
  const fails = belowMinimum.size > 0 || unfixed.length > 0 || stopped
  const checked = ledger.run === `ordinary` || ledger.run === `seed`
  return {
    rejected: ledger.early.map((index) => ledger.states[index]!),
    counts,
    failure: checked && fails ? failure : undefined,
  }
}

// The environment each run kind sets.
function runEnvironment(run: RunKind): Record<string, string> {
  if (run === `ordinary`) return {}
  if (run === `seed`) return { TANSTACK_DB_ORACLE_SEED: `1` }
  return {
    TANSTACK_DB_ORACLE_SEED: `1`,
    TANSTACK_DB_ORACLE_PATH: `0`,
    TANSTACK_DB_ORACLE_PROPERTY: run === `path` ? property : otherProperty,
  }
}

// Runs `run` with the given variables set and the other named ones unset, and
// restores the environment afterward.
async function withEnvironment<T>(
  names: ReadonlyArray<string>,
  variables: Record<string, string>,
  run: () => T | Promise<T>,
): Promise<T> {
  for (const name of names) vi.stubEnv(name, variables[name])
  try {
    return await run()
  } finally {
    vi.unstubAllEnvs()
  }
}
const replayNames = [
  `TANSTACK_DB_ORACLE_SEED`,
  `TANSTACK_DB_ORACLE_PATH`,
  `TANSTACK_DB_ORACLE_PROPERTY`,
]

// The driver: one ledger through createOracleReach.
async function observeLedger(ledger: Ledger): Promise<Verdict> {
  const reach = await withEnvironment(
    replayNames,
    runEnvironment(ledger.run),
    () =>
      createOracleReach(`ledger`, ledger.states, {
        minimum: ledger.minimum,
        fixedHistories: ledger.fixedHistories,
      }),
  )
  const rejected: Array<string> = []
  for (const index of ledger.early) {
    try {
      reach.reach(ledger.states[index]!)
    } catch {
      rejected.push(ledger.states[index]!)
    }
  }
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
  return {
    rejected,
    counts: new Map(reach.counts()),
    failure: namedStates(failure),
  }
}

// The states a failure names: `name (count)` below the minimum, and a list of
// names for the fixed histories, or how many histories ran.
function namedStates(failure: string | undefined): Failure | undefined {
  if (failure === undefined) return undefined
  const below = /not enforced there: (.*)$/m.exec(failure)?.[1]
  const unfixed = /reach depends on the seed: (.*)$/m.exec(failure)?.[1]
  const stoppedAt = /only (\d+) of its \d+ fixed histories ran/.exec(
    failure,
  )?.[1]
  return {
    ...(stoppedAt === undefined ? {} : { stoppedAt: Number(stoppedAt) }),
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
async function checkLedger(ledger: Ledger) {
  const expected = expectedVerdict(ledger)
  expect(await observeLedger(ledger), `reach verdict`).toEqual(expected)
  return expected
}

// The campaign runner's replay prefix, and the environment each run kind sets
// for it. The runner reads only its own prefix, so a replay of another
// property is an ordinary run for it.
const campaignPrefix = `TANSTACK_DB_REACH_LEDGER`
function campaignRun(run: RunKind): RunKind {
  return run === `other-path` ? `ordinary` : run
}
function campaignEnvironment(run: RunKind): Record<string, string> {
  if (run === `ordinary`) return {}
  if (run === `seed`) return { [`${campaignPrefix}_SEED`]: `1` }
  return { [`${campaignPrefix}_SEED`]: `1`, [`${campaignPrefix}_PATH`]: `0` }
}

// The driver: one ledger through each campaign that runOracleCampaign runs.
function observeCampaign(ledger: Ledger): Promise<Failure | undefined> {
  return withEnvironment(
    [`${campaignPrefix}_SEED`, `${campaignPrefix}_PATH`],
    campaignEnvironment(campaignRun(ledger.run)),
    async () => {
      // The runner reports each campaign's counts on the console.
      const info = vi.spyOn(console, `info`).mockImplementation(() => {})
      try {
        await runOracleCampaign(campaignPrefix, ledger.states, (reach) => {
          for (const history of ledger.histories) {
            reach.beginHistory()
            for (const index of history) reach.reach(ledger.states[index]!)
          }
        })
        return undefined
      } catch (error) {
        return namedStates((error as Error).message)
      } finally {
        info.mockRestore()
      }
    },
  )
}

// The check: a campaign's reach refines the model with a minimum of one and
// no fixed histories, the campaign runner's own reach.
async function checkCampaign(ledger: Ledger) {
  const { failure } = expectedVerdict({
    ...ledger,
    run: campaignRun(ledger.run),
    minimum: 1,
    fixedHistories: 0,
  })
  expect(await observeCampaign(ledger), `campaign reach failure`).toEqual(
    failure,
  )
}

// The run parameters: the examples come on top of the base runs, and the
// replay selection stays. A seed replay keeps its seed, as does a path replay
// of another property. A path replay of this property keeps its seed and path,
// and runs one history. A replay witness channel adds reporter keys; no run
// kind here opens one, so the check leaves them out.
type Selection = { run: RunKind; seed: number; path: string }
function expectedRunParameters(
  { run, seed, path }: Selection,
  baseRuns: number,
  examples: ReadonlyArray<number>,
) {
  const numRuns = run === `path` ? 1 : baseRuns + examples.length
  if (run === `ordinary`) return { numRuns, examples }
  if (run === `path`) return { numRuns, seed, path, examples }
  return { numRuns, seed, examples }
}

// oraclePropertyOptions reads the process's replay selection and multiplier
// once, at load. The model reads the same variables on its own.
const processEnvironment = process.env
const processSelection: Selection = {
  run:
    processEnvironment.TANSTACK_DB_ORACLE_PATH !== undefined
      ? processEnvironment.TANSTACK_DB_ORACLE_PROPERTY === property
        ? `path`
        : `other-path`
      : processEnvironment.TANSTACK_DB_ORACLE_SEED === undefined
        ? `ordinary`
        : `seed`,
  seed: Number(processEnvironment.TANSTACK_DB_ORACLE_SEED),
  path: processEnvironment.TANSTACK_DB_ORACLE_PATH ?? ``,
}
const processMultiplier = Number(
  processEnvironment.TANSTACK_DB_ORACLE_RUNS_MULTIPLIER ?? `1`,
)

function checkRunParameters(
  run: RunKind,
  baseRuns: number,
  examples: ReadonlyArray<number>,
) {
  const project = (parameters: {
    numRuns: number
    seed?: number
    path?: string
    examples?: ReadonlyArray<number>
  }) => ({
    numRuns: parameters.numRuns,
    seed: parameters.seed,
    path: parameters.path,
    examples: parameters.examples,
  })
  const replayed = run === `path` ? property : otherProperty
  // toEqual treats an undefined key as absent.
  expect(
    project(
      oracleRandomParameters(
        baseRuns,
        run === `ordinary`
          ? undefined
          : run === `seed`
            ? {
                replaySeed: 1,
                replayPath: undefined,
                replayProperty: undefined,
              }
            : { replaySeed: 1, replayPath: `0`, replayProperty: replayed },
        property,
        examples,
      ),
    ),
    `run parameters`,
  ).toEqual(
    expectedRunParameters({ run, seed: 1, path: `0` }, baseRuns, examples),
  )
  expect(
    project(oraclePropertyOptions(baseRuns, property, { examples })),
    `property options under this process`,
  ).toEqual(
    expectedRunParameters(
      processSelection,
      baseRuns * processMultiplier,
      examples,
    ),
  )
}

declareOracle({
  check: [checkLedger, checkCampaign, checkRunParameters],
  model: [expectedVerdict, expectedRunParameters],
  grammar: [ledgerArbitrary],
})

const reachStates = [
  `a seed-only run fails below the minimum`,
  `a path replay with a state below the minimum`,
  `a fixed history miss that a later history enters`,
  `a state below a minimum above one`,
  `a ledger that passes`,
  `a reach before the first history`,
  `a path replay of another property with a state below the minimum`,
  `a run that stopped inside the fixed histories`,
] as const
// One fixed ledger enters each reach state, first in every run, so this
// property's own reach cannot miss by chance.
function fixedLedger(
  run: RunKind,
  minimum: number,
  fixedHistories: number,
  histories: Ledger[`histories`],
  early: Ledger[`early`] = [],
): [Ledger, number, Array<number>] {
  return [
    {
      run,
      states: [`state 0`, `state 1`],
      minimum,
      fixedHistories,
      early,
      histories,
    },
    60,
    [1],
  ]
}
const ledgerExamples = [
  fixedLedger(`seed`, 1, 0, []),
  fixedLedger(`path`, 1, 0, []),
  fixedLedger(`ordinary`, 1, 1, [[0], [1]]),
  fixedLedger(`ordinary`, 2, 0, [[0, 1]]),
  fixedLedger(`ordinary`, 1, 0, [[0, 1]]),
  fixedLedger(`ordinary`, 1, 0, [[0, 1]], [0]),
  fixedLedger(`other-path`, 1, 0, []),
  fixedLedger(`ordinary`, 1, 3, [[0, 1]]),
]
const ledgerReach = createOracleReach(`oracle.declared-reach`, reachStates, {
  fixedHistories: ledgerExamples.length,
})
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
  oraclePropertyOptions(200, property, { examples: ledgerExamples }),
)(
  `reach ledgers refine the declared reach model`,
  async (ledger, baseRuns, examples) => {
    ledgersRan = true
    ledgerReach.beginHistory()
    const { counts, failure } = await checkLedger(ledger)
    await checkCampaign(ledger)
    checkRunParameters(ledger.run, baseRuns, examples)
    const ordinary = expectedVerdict({ ...ledger, run: `ordinary` }).failure
    if (ledger.run === `path` && (ordinary?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(`a path replay with a state below the minimum`)
    if (ledger.run === `other-path` && (ordinary?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(
        `a path replay of another property with a state below the minimum`,
      )
    if (failure?.stoppedAt !== undefined)
      ledgerReach.reach(`a run that stopped inside the fixed histories`)
    if (ledger.run === `seed` && (failure?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(`a seed-only run fails below the minimum`)
    if (failure?.unfixed.some((state) => (counts.get(state) ?? 0) > 0))
      ledgerReach.reach(`a fixed history miss that a later history enters`)
    if (ledger.minimum > 1 && (failure?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(`a state below a minimum above one`)
    if (
      (ledger.run === `ordinary` || ledger.run === `seed`) &&
      failure === undefined
    )
      ledgerReach.reach(`a ledger that passes`)
    if (ledger.early.length > 0)
      ledgerReach.reach(`a reach before the first history`)
  },
)
