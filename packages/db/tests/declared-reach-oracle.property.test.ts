/**
 * Declared reach (ORC-015) cannot miss by chance where a property fixes it.
 *
 * A generated property declares the states its laws depend on, and
 * `createOracleReach` fails a run in which too few histories entered one.
 * These rules decide what a reach counts, when its check runs, and what the
 * check proves (#2287):
 *
 * - A history counts once per declared state it enters. A `reach()` call for
 *   an undeclared state, or before the first `beginHistory()`, is a driver
 *   error: it throws and counts nothing. Options that cannot describe a reach
 *   (a minimum below one, a fractional or negative number of fixed
 *   histories, a state declared twice) throw when the reach is created.
 * - The check fails for each state that fewer than `minimum` histories
 *   entered. It runs in an ordinary run and in a run with only
 *   `TANSTACK_DB_ORACLE_SEED`: a seed alone reseeds the whole campaign at its
 *   full budget. A path replay, which runs one recorded history, skips it in
 *   every reach of that process, also in a property that the replay does not
 *   name: a reach need not carry its property's name, so it cannot tell whose
 *   replay runs. An explicit `replaying` option overrides the environment.
 * - A property can run fixed examples first in every run. It declares their
 *   number as `fixedHistories: n` and begins each example's history with
 *   `beginHistory({ fixed: true })`. The check then also fails for each state
 *   that no fixed history entered: such a state's reach would depend on the
 *   seed. Fixedness belongs to the history, not to its position, so another
 *   test may share the reach. Shrinking can run an example again, so a fixed
 *   history beyond the n declared ones counts as a fixed history too. When
 *   fewer than n fixed histories ran, a failure stopped the run inside the
 *   examples, and the check reports only that.
 * - The examples come on top of the base run budget, so they never displace
 *   a random history. A replay keeps its seed, and a path replay of the
 *   property keeps its path and still runs one history.
 *
 * `runOracleCampaign` runs a fixed-seed and a random campaign, each with its
 * own reach and a minimum of one. A seed-only run of its replay prefix runs one
 * campaign with that seed and checks its reach; a seed and path run one
 * recorded history and check none. Each campaign that passes reports its
 * counts on one `ORACLE_REACH` line. An invalid prefix environment throws.
 *
 * The model below states these rules over a generated ledger: a run kind, an
 * optional `replaying` override, the options, the states reached before the
 * first history, each history with its fixed mark and the states it enters,
 * the campaign runner's fixed seed, and an optional invalid campaign
 * environment. The drivers run `createOracleReach`, `runOracleCampaign`, and
 * `oracleRandomParameters` under that run kind's environment, and
 * `oraclePropertyOptions` under the process's own. Each check compares one
 * whole observation with the model.
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
type CampaignFault = `bad-seed` | `path-without-seed` | `bad-path`
type LedgerHistory = {
  fixed: boolean
  // The indices of the states it enters, with repeats. The index equal to
  // the number of declared states names an undeclared one.
  states: ReadonlyArray<number>
}
type Ledger = {
  run: RunKind
  replaying: boolean | undefined
  states: ReadonlyArray<string>
  minimum: number
  fixedHistories: number
  // The indices of the states reached before the first history.
  early: ReadonlyArray<number>
  histories: ReadonlyArray<LedgerHistory>
  fixedSeed: number
  campaignFault: CampaignFault | undefined
}
// The states a failing reach check names, and an absent failure when the check
// passes or does not run.
type Failure = {
  belowMinimum: ReadonlyMap<string, number>
  unfixed: ReadonlyArray<string>
  // How many fixed histories ran, when fewer than the declared ones did.
  stoppedAt?: number
}
type Rejection = readonly [string, `undeclared` | `early`]
type Verdict = {
  // Whether creating the reach threw.
  invalid: boolean
  // The reach calls that threw, in call order.
  rejected: ReadonlyArray<Rejection>
  counts: ReadonlyMap<string, number>
  failure: Failure | undefined
}

const stateName = (index: number) => `state ${index}`

// The grammar: two to four states, and up to six histories over them. About
// one ledger in twenty has each kind of invalid option, a quarter reach a
// state or two before any history, and about one reach in ten names an
// undeclared state.
const ledgerArbitrary: fc.Arbitrary<Ledger> = fc
  .integer({ min: 2, max: 4 })
  .chain((stateCount) => {
    const names = Array.from({ length: stateCount }, (_, index) =>
      stateName(index),
    )
    const reachIndex = fc.oneof(
      { arbitrary: fc.integer({ min: 0, max: stateCount - 1 }), weight: 9 },
      { arbitrary: fc.constant(stateCount), weight: 1 },
    )
    const mostly = <T, U>(valid: fc.Arbitrary<T>, invalid: fc.Arbitrary<U>) =>
      fc.oneof(
        { arbitrary: valid, weight: 19 },
        { arbitrary: invalid, weight: 1 },
      )
    return fc.record({
      run: fc.constantFrom<RunKind>(`ordinary`, `seed`, `path`, `other-path`),
      replaying: fc.oneof(
        { arbitrary: fc.constant(undefined), weight: 3 },
        { arbitrary: fc.boolean(), weight: 1 },
      ),
      states: mostly(fc.constant(names), fc.constant([...names, names[0]!])),
      minimum: mostly(
        fc.integer({ min: 1, max: 3 }),
        fc.constantFrom(0, -1, 1.5),
      ),
      fixedHistories: mostly(
        fc.integer({ min: 0, max: 4 }),
        fc.constantFrom(-1, 0.5),
      ),
      early: fc.oneof(
        { arbitrary: fc.constant([]), weight: 3 },
        {
          arbitrary: fc.array(reachIndex, { minLength: 1, maxLength: 2 }),
          weight: 1,
        },
      ),
      histories: fc.array(
        fc.record({
          fixed: fc.boolean(),
          states: fc.array(reachIndex, { maxLength: 4 }),
        }),
        { maxLength: 6 },
      ),
      fixedSeed: fc.integer(),
      campaignFault: mostly(
        fc.constant(undefined),
        fc.constantFrom<CampaignFault>(
          `bad-seed`,
          `path-without-seed`,
          `bad-path`,
        ),
      ),
    })
  })

// The model. Invalid options throw before any history. A reach call for an
// undeclared state, or before the first history, throws and counts nothing.
// Every fixed history counts as fixed, also one beyond the declared number,
// which shrinking runs again. A history counts once per declared state it
// enters.
// A path replay of any property checks nothing, unless an explicit
// `replaying: false` says otherwise. Otherwise a state fails below the
// minimum, and, when fixed histories are declared, a state that no fixed
// history entered fails too. When fewer fixed histories ran than were
// declared, a failure stopped the run, and the check names how many ran and
// no state.
function expectedVerdict(ledger: Ledger): Verdict {
  const valid =
    Number.isInteger(ledger.minimum) &&
    ledger.minimum >= 1 &&
    Number.isInteger(ledger.fixedHistories) &&
    ledger.fixedHistories >= 0 &&
    new Set(ledger.states).size === ledger.states.length
  if (!valid) {
    return {
      invalid: true,
      rejected: [],
      counts: new Map(),
      failure: undefined,
    }
  }
  const declared = new Set(ledger.states)
  const rejected: Array<Rejection> = ledger.early.map((index) => [
    stateName(index),
    declared.has(stateName(index)) ? `early` : `undeclared`,
  ])
  let fixedBegun = 0
  const begun: Array<{ fixed: boolean; entered: Set<string> }> = []
  for (const history of ledger.histories) {
    if (history.fixed) fixedBegun += 1
    const entered = new Set<string>()
    for (const index of history.states) {
      if (declared.has(stateName(index))) entered.add(stateName(index))
      else rejected.push([stateName(index), `undeclared`])
    }
    begun.push({ fixed: history.fixed, entered })
  }
  const counts = new Map(
    ledger.states.map((state) => [
      state,
      begun.filter(({ entered }) => entered.has(state)).length,
    ]),
  )
  const stopped = fixedBegun < ledger.fixedHistories
  const belowMinimum = new Map(
    [...counts].filter(([, count]) => count < ledger.minimum),
  )
  const unfixed =
    ledger.fixedHistories === 0
      ? []
      : ledger.states.filter((state) =>
          begun.every(({ fixed, entered }) => !fixed || !entered.has(state)),
        )
  const failure: Failure | undefined = stopped
    ? { belowMinimum: new Map(), unfixed: [], stoppedAt: fixedBegun }
    : belowMinimum.size > 0 || unfixed.length > 0
      ? { belowMinimum, unfixed }
      : undefined
  const checked =
    ledger.replaying === undefined
      ? ledger.run === `ordinary` || ledger.run === `seed`
      : !ledger.replaying
  return {
    invalid: false,
    rejected,
    counts,
    failure: checked ? failure : undefined,
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
  let reach: ReturnType<typeof createOracleReach<string>>
  try {
    reach = await withEnvironment(replayNames, runEnvironment(ledger.run), () =>
      createOracleReach(`ledger`, ledger.states, {
        minimum: ledger.minimum,
        fixedHistories: ledger.fixedHistories,
        ...(ledger.replaying === undefined
          ? {}
          : { replaying: ledger.replaying }),
      }),
    )
  } catch {
    return {
      invalid: true,
      rejected: [],
      counts: new Map(),
      failure: undefined,
    }
  }
  const rejected: Array<Rejection> = []
  const attempt = (state: string) => {
    try {
      reach.reach(state)
    } catch (error) {
      const message = (error as Error).message
      rejected.push([
        state,
        /undeclared reach state/.test(message)
          ? `undeclared`
          : /before the first beginHistory/.test(message)
            ? `early`
            : (message as `early`),
      ])
    }
  }
  for (const index of ledger.early) attempt(stateName(index))
  for (const history of ledger.histories) {
    reach.beginHistory({ fixed: history.fixed })
    for (const index of history.states) attempt(stateName(index))
  }
  let failure: string | undefined
  try {
    reach.assertReached()
  } catch (error) {
    failure = (error as Error).message
  }
  return {
    invalid: false,
    rejected,
    counts: new Map(reach.counts()),
    failure: namedStates(failure),
  }
}

// The states a failure names: `name (count)` below the minimum, and a list of
// names for the fixed histories, or how many fixed histories ran.
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

// The campaign runner's replay prefix, and the environment each run kind or
// invalid environment sets for it. The runner reads only its own prefix, so a
// replay of another property is an ordinary run for it.
const campaignPrefix = `TANSTACK_DB_REACH_LEDGER`
function campaignRun(run: RunKind): RunKind {
  return run === `other-path` ? `ordinary` : run
}
function campaignEnvironment(ledger: Ledger): Record<string, string> {
  const seed = `${campaignPrefix}_SEED`
  const path = `${campaignPrefix}_PATH`
  if (ledger.campaignFault === `bad-seed`) return { [seed]: `x` }
  if (ledger.campaignFault === `path-without-seed`) return { [path]: `0` }
  if (ledger.campaignFault === `bad-path`) return { [seed]: `1`, [path]: `a` }
  const run = campaignRun(ledger.run)
  if (run === `ordinary`) return {}
  if (run === `seed`) return { [seed]: `1` }
  return { [seed]: `1`, [path]: `0` }
}

type CampaignLine = {
  property: string
  campaign: string
  minimum: number | null
  counts: Record<string, number>
}
type CampaignObservation = {
  // The parameters the runner passed to each campaign, in order.
  parameters: ReadonlyArray<{ seed?: number; path?: string; numRuns?: number }>
  lines: ReadonlyArray<CampaignLine>
  failure: Failure | `invalid environment` | undefined
}

// The campaign driver replays the ledger's declared reaches, without fixed
// marks or early reaches, and with each state declared once: those rules
// belong to the ledger check above.
function campaignLedger(ledger: Ledger): Ledger {
  const states = [...new Set(ledger.states)]
  return {
    ...ledger,
    states,
    early: [],
    histories: ledger.histories.map((history) => ({
      fixed: false,
      states: history.states.filter((index) => index < states.length),
    })),
  }
}

// The campaign model: two campaigns without a prefix seed, one replay
// campaign with one. Each campaign has a minimum of one and no fixed
// histories, checks reach unless a path replays it, and reports its counts
// when it passes. The first failing campaign ends the run.
function expectedCampaign(ledger: Ledger): CampaignObservation {
  if (ledger.campaignFault !== undefined) {
    return { parameters: [], lines: [], failure: `invalid environment` }
  }
  const run = campaignRun(ledger.run)
  const campaigns: ReadonlyArray<
    readonly [string, { seed?: number; path?: string; numRuns?: number }]
  > =
    run === `ordinary`
      ? [
          [`fixed`, { seed: ledger.fixedSeed }],
          [`random`, {}],
        ]
      : [
          [
            `replay`,
            run === `seed` ? { seed: 1 } : { seed: 1, path: `0`, numRuns: 1 },
          ],
        ]
  const replayed = campaignLedger(ledger)
  const parameters: Array<{ seed?: number; path?: string; numRuns?: number }> =
    []
  const lines: Array<CampaignLine> = []
  for (const [campaign, campaignParameters] of campaigns) {
    parameters.push(campaignParameters)
    const { counts, failure } = expectedVerdict({
      ...replayed,
      minimum: 1,
      fixedHistories: 0,
      replaying: run === `path`,
    })
    if (failure !== undefined) return { parameters, lines, failure }
    lines.push({
      property: campaignPrefix,
      campaign,
      minimum: run === `path` ? null : 1,
      counts: Object.fromEntries(counts),
    })
  }
  return { parameters, lines, failure: undefined }
}

// The driver: one ledger through each campaign that runOracleCampaign runs.
function observeCampaign(ledger: Ledger): Promise<CampaignObservation> {
  const replayed = campaignLedger(ledger)
  return withEnvironment(
    [`${campaignPrefix}_SEED`, `${campaignPrefix}_PATH`],
    campaignEnvironment(ledger),
    async () => {
      const parameters: Array<{
        seed?: number
        path?: string
        numRuns?: number
      }> = []
      // The runner reports each campaign's counts on the console.
      const info = vi.spyOn(console, `info`).mockImplementation(() => {})
      const lines = () =>
        info.mock.calls.map(
          ([line]) =>
            JSON.parse(
              String(line).replace(/^ORACLE_REACH /, ``),
            ) as CampaignLine,
        )
      try {
        await runOracleCampaign(
          campaignPrefix,
          replayed.states,
          (reach, campaignParameters) => {
            parameters.push(campaignParameters)
            for (const history of replayed.histories) {
              reach.beginHistory()
              for (const index of history.states) {
                reach.reach(stateName(index))
              }
            }
          },
          { fixedSeed: ledger.fixedSeed },
        )
        return { parameters, lines: lines(), failure: undefined }
      } catch (error) {
        const message = (error as Error).message
        return {
          parameters,
          lines: lines(),
          failure: /_SEED must be an integer|_PATH requires a seed/.test(
            message,
          )
            ? (`invalid environment` as const)
            : namedStates(message),
        }
      } finally {
        info.mockRestore()
      }
    },
  )
}

// The check: the observed campaigns refine the campaign model.
async function checkCampaign(ledger: Ledger) {
  expect(await observeCampaign(ledger), `campaign observation`).toEqual(
    expectedCampaign(ledger),
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
  model: [expectedVerdict, expectedCampaign, expectedRunParameters],
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
  `invalid reach options`,
  `a reach of an undeclared state`,
  `a replaying option that overrides the environment`,
  `a fixed history beyond the declared ones`,
  `an unfixed history before the first fixed one`,
  `an invalid campaign environment`,
] as const

// One fixed ledger enters each reach state, first in every run, so this
// property's own reach cannot miss by chance.
const fixedLedger = (
  overrides: Partial<Ledger>,
): [Ledger, number, Array<number>] => [
  {
    run: `ordinary`,
    replaying: undefined,
    states: [stateName(0), stateName(1)],
    minimum: 1,
    fixedHistories: 0,
    early: [],
    histories: [],
    fixedSeed: 7,
    campaignFault: undefined,
    ...overrides,
  },
  60,
  [1],
]
const history = (fixed: boolean, ...states: Array<number>) => ({
  fixed,
  states,
})
const ledgerExamples = [
  fixedLedger({ run: `seed` }),
  fixedLedger({ run: `path` }),
  fixedLedger({
    fixedHistories: 1,
    histories: [history(true, 0), history(false, 1)],
  }),
  fixedLedger({ minimum: 2, histories: [history(false, 0, 1)] }),
  fixedLedger({ histories: [history(false, 0, 1)] }),
  fixedLedger({ early: [0], histories: [history(false, 0, 1)] }),
  fixedLedger({ run: `other-path` }),
  fixedLedger({ fixedHistories: 3, histories: [history(true, 0, 1)] }),
  fixedLedger({ minimum: 0 }),
  fixedLedger({ histories: [history(false, 0, 1, 2)] }),
  fixedLedger({ replaying: true }),
  fixedLedger({
    fixedHistories: 1,
    histories: [history(true, 0, 1), history(true, 0)],
  }),
  fixedLedger({
    fixedHistories: 1,
    histories: [history(false, 0), history(true, 0, 1)],
  }),
  fixedLedger({ campaignFault: `bad-seed`, histories: [history(false, 0, 1)] }),
]
const ledgerExampleInputs = new Set(ledgerExamples.map(([ledger]) => ledger))
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
    ledgerReach.beginHistory({ fixed: ledgerExampleInputs.has(ledger) })
    const verdict = await checkLedger(ledger)
    await checkCampaign(ledger)
    checkRunParameters(ledger.run, baseRuns, examples)
    const { counts, failure } = verdict
    const ordinary = expectedVerdict({
      ...ledger,
      run: `ordinary`,
      replaying: undefined,
    }).failure
    const environmentChecks = ledger.run === `ordinary` || ledger.run === `seed`
    if (verdict.invalid) ledgerReach.reach(`invalid reach options`)
    if (ledger.campaignFault !== undefined)
      ledgerReach.reach(`an invalid campaign environment`)
    if (verdict.invalid) return
    if (
      ledger.replaying === undefined &&
      ledger.run === `path` &&
      (ordinary?.belowMinimum.size ?? 0) > 0
    )
      ledgerReach.reach(`a path replay with a state below the minimum`)
    if (
      ledger.replaying === undefined &&
      ledger.run === `other-path` &&
      (ordinary?.belowMinimum.size ?? 0) > 0
    )
      ledgerReach.reach(
        `a path replay of another property with a state below the minimum`,
      )
    if (
      ledger.replaying !== undefined &&
      ledger.replaying === environmentChecks
    )
      ledgerReach.reach(`a replaying option that overrides the environment`)
    if (failure?.stoppedAt !== undefined)
      ledgerReach.reach(`a run that stopped inside the fixed histories`)
    if (ledger.run === `seed` && (failure?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(`a seed-only run fails below the minimum`)
    if (failure?.unfixed.some((state) => (counts.get(state) ?? 0) > 0))
      ledgerReach.reach(`a fixed history miss that a later history enters`)
    if (ledger.minimum > 1 && (failure?.belowMinimum.size ?? 0) > 0)
      ledgerReach.reach(`a state below a minimum above one`)
    if (environmentChecks && ledger.replaying === undefined && !failure)
      ledgerReach.reach(`a ledger that passes`)
    if (verdict.rejected.some(([, reason]) => reason === `early`))
      ledgerReach.reach(`a reach before the first history`)
    if (verdict.rejected.some(([, reason]) => reason === `undeclared`))
      ledgerReach.reach(`a reach of an undeclared state`)
    if (
      ledger.histories.filter(({ fixed }) => fixed).length >
      ledger.fixedHistories
    )
      ledgerReach.reach(`a fixed history beyond the declared ones`)
    const firstFixed = ledger.histories.findIndex(({ fixed }) => fixed)
    if (ledger.fixedHistories > 0 && firstFixed > 0)
      ledgerReach.reach(`an unfixed history before the first fixed one`)
  },
)
