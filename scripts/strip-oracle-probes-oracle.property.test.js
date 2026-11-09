/**
 * Law (scripts.strip-oracle-probes): a build that strips the oracle state
 * probes gives the program that the production build of the source gives. For
 * every program that the probe-form rule accepts, the stripped program (1)
 * keeps no runtime reference that came from a guard, and (2) behaves like the
 * source with `process.env.NODE_ENV` defined as "production", where each guard
 * is `false` and no probe runs. Where the stripper cannot keep both promises,
 * it fails the build with a message and emits no changed code.
 *
 * Authority: the maintainer decision of 2026-11-09, which removes the probes
 * from published builds because unbundled Node paid for the `process.env` read
 * in every guard. The probe-form rule's header in
 * @tanstack/eslint-plugin-oracles is the one definition of the form: the guard
 * is a `const probing` with the guard initializer, in the function's own
 * scope, and the probe is one expression statement `probing && globalThis
 * .__oracleProbe?.(name, condition)`. Parentheses never matter, and the guard
 * may sit at the function's top, in one of its blocks, or in a switch case.
 * The rule admits any other use of `probing`, and it rejects every mention of
 * `__oracleProbe` outside a probe.
 *
 * Refusal decisions, from that rule. A surviving reference to `probing` is a
 * runtime read or binding that the stripper cannot remove with its guard. The
 * stripper refuses a value read, a parameter or other binding named
 * `probing`, a guard in a `for` head, and a `probing` declaration whose
 * initializer is not the guard form. It accepts a property name, a label, and
 * a type position, which hold no runtime reference to the guard. It refuses
 * every `__oracleProbe` mention that is left, because the rule rejects each
 * of them: a type-only mention can be admitted only if the rule changes first.
 *
 * Limits. The grammar draws programs with one exported function, up to six
 * units, and a fixed set of probe forms, placements, and mentions. A program
 * that the rule rejects is not checked, and the grammar's admission model must
 * agree with the rule on every drawn program. The reference is esbuild with
 * a define, which is a separate implementation of the same constant folding;
 * the observations are one trace, the probe calls, the thrown error, and the
 * identifiers of the stripped output. The programs do not touch `process`
 * except through the guard, so an identifier check on `process` covers the
 * guard only. Programs run in `new Function`, not in a bundle, and the probe
 * recorder is installed on `globalThis` for each run.
 *
 * Structure:
 *   1. The grammar draws a probe-bearing function, with guards and probes in
 *      lint-legal placements, and hostile uses of `probing` and `__oracleProbe`.
 *   2. The admission model predicts, from the drawn units alone, whether the
 *      rule accepts the program. The rule itself decides, and the two must
 *      agree on every program.
 *   3. The model predicts the refusal and the number of `probing` identifiers
 *      that the stripped output keeps.
 *   4. The driver stripts each accepted program with the plugin's transform,
 *      then strips types with esbuild. The reference is esbuild with
 *      `process.env.NODE_ENV` defined as "production". Both run in
 *      `new Function`, with a probe recorder.
 *   5. The comparison checks each observation against the model, and reach
 *      counts the declared placements that the accepted histories enter.
 */
import { Linter } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import oraclePlugin from '@tanstack/eslint-plugin-oracles'
import { transform } from 'esbuild'
import fc from 'fast-check'
import ts from 'typescript'
import { afterAll, describe, expect, it } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'
import {
  oracleFixedSeed,
  oraclePropertyOptions,
  oracleRuns,
  withOracleFixedHistories,
} from '../packages/db/tests/oracle-config.js'
import { createOracleReach } from '../packages/db/tests/oracle-reach.js'
import { stripOracleProbes } from './strip-oracle-probes.mjs'

const PROPERTY = `scripts.strip-oracle-probes`
const FIXED_SEED = 3117
const BASE_RUNS = 160
// The plugin's id names a TypeScript module, so it strips the program.
const MODULE_ID = `packages/db/src/generated.ts`
const GUARD_INIT = `typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production'`
const NAMES = [`pkg#alpha`, `db-ivm#gamma.delta`]

// -- 1. Grammar ---------------------------------------------------------------
//
// A program is one exported function with a top-level guard variant and up to
// six units. Each unit is a marker, a probe in one of five forms, a probe in a
// lint-legal placement, a probe in a hostile or a rule-rejected position, or a
// mention of `probing` that is not a reference. The units are the grammar's
// inputs only: nothing here says what the stripped program should do.

const TOP_WEIGHTS = [
  [4, `plain`],
  [2, `parenthesized`],
  [2, `siblings-before`],
  [2, `siblings-after`],
  [1, `none`],
  [1, `non-guard`],
]

const PROBE_FORMS = [
  `plain`,
  `paren-statement`,
  `paren-guard`,
  `cast-receiver`,
  `paren-callee`,
]

// Units that take a probe, and where their statement sits.
const PROBE_UNITS = new Set([
  `probe`,
  `if-body`,
  `if-else-body`,
  `for-body`,
  `while-body`,
  `do-body`,
  `labeled-body`,
  `block-guard`,
  `switch-guard`,
  `arrow-guard`,
  `for-head`,
])
// Placements whose probe sits at the function's top level, under its guard.
const TOP_LEVEL_PROBE_UNITS = new Set([
  `probe`,
  `if-body`,
  `if-else-body`,
  `for-body`,
  `while-body`,
  `do-body`,
  `labeled-body`,
])
const GUARD_TOPS = new Set([
  `plain`,
  `parenthesized`,
  `siblings-before`,
  `siblings-after`,
])
// Units the rule rejects, each for its own reason.
const REJECTED_UNITS = new Set([
  `bare-call`,
  `wrong-operand`,
  `one-argument`,
  `bad-name`,
  `assignment-condition`,
  `outer-guard-arrow`,
  `type-only-mention`,
])
// Units that read or bind `probing` at runtime, which the stripper refuses.
const REFUSED_UNITS = new Set([`value-read`, `binding`])
// `probing` names that are not references, and the `probing` identifiers that
// the stripped output keeps for each unit, as the grammar wrote them.
const MENTION_TOKENS = { property: 2, label: 2 }

const UNIT_WEIGHTS = [
  [6, `marker`],
  [5, `probe`],
  [2, `if-body`],
  [2, `if-else-body`],
  [2, `for-body`],
  [1, `while-body`],
  [1, `do-body`],
  [1, `labeled-body`],
  [2, `block-guard`],
  [2, `switch-guard`],
  [2, `arrow-guard`],
  [1, `for-head`],
  [1, `value-read`],
  [1, `binding`],
  [2, `type-only`],
  [2, `property`],
  [2, `label`],
  [1, `bare-call`],
  [1, `wrong-operand`],
  [1, `one-argument`],
  [1, `bad-name`],
  [1, `assignment-condition`],
  [1, `outer-guard-arrow`],
  [1, `type-only-mention`],
]

const weighted = (entries) =>
  fc.oneof(
    ...entries.map(([weight, value]) => ({
      weight,
      arbitrary: fc.constant(value),
    })),
  )

const unitArbitrary = fc.record({
  kind: weighted(UNIT_WEIGHTS),
  form: fc.constantFrom(...PROBE_FORMS),
  name: fc.constantFrom(...NAMES),
})

const programArbitrary = fc.record({
  top: weighted(TOP_WEIGHTS),
  hostProcess: fc.boolean(),
  units: fc.array(unitArbitrary, { minLength: 1, maxLength: 6 }),
  fixed: fc.constant(false),
})

// The probe's text, without its statement terminator. Each form is a legal
// spelling of the probe, or a cast receiver, and the condition runs a push so
// a probe that the stripper leaves would also change the trace.
function probeText(form, name, index) {
  const condition = `trace.push('condition-${index}') > 0`
  const call = `globalThis.__oracleProbe?.('${name}', ${condition})`
  switch (form) {
    case `plain`:
      return `probing && ${call}`
    case `paren-statement`:
      return `(probing && ${call})`
    case `paren-guard`:
      return `(probing) && ${call}`
    case `cast-receiver`:
      return `probing && (globalThis as { __oracleProbe?: (name: string, condition: unknown) => void }).__oracleProbe?.('${name}', ${condition})`
    case `paren-callee`:
      return `probing && (globalThis.__oracleProbe)?.('${name}', ${condition})`
    default:
      throw new Error(`unknown probe form ${form}`)
  }
}

function topText(top) {
  switch (top) {
    case `plain`:
      return `const probing = ${GUARD_INIT};`
    case `parenthesized`:
      return `const probing = (${GUARD_INIT});`
    case `siblings-before`:
      return `const sibling = trace.push('sibling'), probing = ${GUARD_INIT};`
    case `siblings-after`:
      return `const probing = ${GUARD_INIT}, sibling = trace.push('sibling');`
    case `none`:
      return ``
    case `non-guard`:
      return `const probing = trace.push('non-guard') > 0;`
    default:
      throw new Error(`unknown guard variant ${top}`)
  }
}

function unitText(unit, index) {
  const probe = probeText(unit.form, unit.name, index)
  switch (unit.kind) {
    case `marker`:
      return `trace.push('marker-${index}');`
    case `probe`:
      return `${probe};`
    case `if-body`:
      return `if (trace.length < 0) ${probe};`
    case `if-else-body`:
      return `if (trace.length >= 0) trace.push('then-${index}'); else ${probe};`
    case `for-body`:
      return `for (let k${index} = 0; k${index} < 2; k${index}++) ${probe};`
    case `while-body`:
      return `while (trace.length < 0) ${probe};`
    case `do-body`:
      return `do ${probe}; while (trace.length < 0);`
    case `labeled-body`:
      return `label${index}: ${probe};`
    case `block-guard`:
      return `{ const probing = ${GUARD_INIT}; ${probe}; trace.push('block-${index}'); }`
    case `switch-guard`:
      return `switch (trace.length) { case 0: const probing = ${GUARD_INIT}; ${probe}; break; default: trace.push('default-${index}'); }`
    case `arrow-guard`:
      return `const arrow${index} = (): void => { const probing = ${GUARD_INIT}; ${probe}; trace.push('arrow-${index}'); }; arrow${index}();`
    case `for-head`:
      return `for (const probing = ${GUARD_INIT}; trace.length < 0; ) { ${probe}; }`
    case `value-read`:
      return `trace.push(String(probing));`
    case `binding`:
      return `((probing: boolean): void => { trace.push(String(probing)); })(true);`
    case `type-only`:
      return `type Type${index} = typeof probing;`
    case `property`:
      return `const object${index} = { probing: 1 }; trace.push(String(object${index}.probing));`
    case `label`:
      return `probing: { trace.push('label-${index}'); break probing; }`
    case `bare-call`:
      return `globalThis.__oracleProbe?.('${unit.name}', true);`
    case `wrong-operand`:
      return `trace.length && globalThis.__oracleProbe?.('${unit.name}', true);`
    case `one-argument`:
      return `probing && globalThis.__oracleProbe?.('${unit.name}');`
    case `bad-name`:
      return `probing && globalThis.__oracleProbe?.('NoHash', true);`
    case `assignment-condition`:
      return `probing && globalThis.__oracleProbe?.('${unit.name}', (trace.length = 0) === 0);`
    case `outer-guard-arrow`:
      return `const outer${index} = (): void => { ${probe}; };`
    case `type-only-mention`:
      return `type Mention${index} = { __oracleProbe?: number };`
    default:
      throw new Error(`unknown unit ${unit.kind}`)
  }
}

function programText(spec) {
  const units = spec.units.map((unit, index) => unitText(unit, index))
  return [
    `export function run(trace: string[]): void {`,
    topText(spec.top),
    ...units,
    `}`,
  ].join(`\n`)
}

// The constructed histories: fixed regressions for the placements and forms
// that the stripper handled wrongly, written as unit lists. Each one is an
// input to the same grammar, model, and comparison as the drawn programs.
const u = (kind, form = `plain`, name = NAMES[0]) => ({ kind, form, name })
const constructedPrograms = () => [
  {
    top: `plain`,
    hostProcess: false,
    fixed: true,
    units: [u(`if-body`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: true,
    fixed: true,
    units: [u(`if-else-body`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: false,
    fixed: true,
    units: [u(`for-body`), u(`while-body`), u(`do-body`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: true,
    fixed: true,
    units: [u(`labeled-body`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: false,
    fixed: true,
    units: [u(`probe`, `paren-statement`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: true,
    fixed: true,
    units: [u(`probe`, `paren-guard`), u(`marker`)],
  },
  {
    top: `parenthesized`,
    hostProcess: false,
    fixed: true,
    units: [u(`probe`), u(`marker`)],
  },
  {
    top: `siblings-after`,
    hostProcess: true,
    fixed: true,
    units: [u(`probe`), u(`marker`)],
  },
  {
    top: `siblings-before`,
    hostProcess: false,
    fixed: true,
    units: [u(`probe`), u(`marker`)],
  },
  {
    top: `none`,
    hostProcess: false,
    fixed: true,
    units: [u(`block-guard`), u(`switch-guard`), u(`arrow-guard`)],
  },
  { top: `none`, hostProcess: true, fixed: true, units: [u(`for-head`)] },
  { top: `plain`, hostProcess: false, fixed: true, units: [u(`value-read`)] },
  { top: `none`, hostProcess: true, fixed: true, units: [u(`binding`)] },
  { top: `non-guard`, hostProcess: false, fixed: true, units: [u(`marker`)] },
  { top: `plain`, hostProcess: true, fixed: true, units: [u(`marker`)] },
  {
    top: `plain`,
    hostProcess: false,
    fixed: true,
    units: [u(`property`), u(`label`), u(`type-only`), u(`marker`)],
  },
  {
    top: `plain`,
    hostProcess: true,
    fixed: true,
    units: [u(`probe`, `cast-receiver`), u(`probe`, `paren-callee`)],
  },
]

// The placements and forms that each accepted program enters. A reach state
// is named for the placement, the form, or the guard variant it exercises.
const STATES = [
  ...TOP_WEIGHTS.map(([, top]) => `guard-top-${top}`),
  ...UNIT_WEIGHTS.map(([, kind]) => `unit-${kind}`),
  ...PROBE_FORMS.map((form) => `form-${form}`),
]

function reachedStates(spec) {
  const states = [`guard-top-${spec.top}`]
  for (const unit of spec.units) {
    states.push(`unit-${unit.kind}`)
    if (PROBE_UNITS.has(unit.kind)) states.push(`form-${unit.form}`)
  }
  return states
}

// -- 2. Model -----------------------------------------------------------------
//
// The model predicts from the drawn units. It does not run the stripper, and
// it does not read the rule's code. Its admission prediction says whether the
// probe-form rule would accept the program: a top-level probe needs a guard at
// the function's top, a rule-rejected unit is never admitted, and every other
// placement has its own guard in its own scope.

function predictAdmission(spec) {
  if (spec.units.some((unit) => REJECTED_UNITS.has(unit.kind))) return false
  const hasTopLevelProbe = spec.units.some((unit) =>
    TOP_LEVEL_PROBE_UNITS.has(unit.kind),
  )
  return !hasTopLevelProbe || GUARD_TOPS.has(spec.top)
}

// A non-guard `probing` declaration and a value read, binding, or `for` head
// guard all leave a `probing` reference that the stripper cannot remove.
function predictRefusal(spec) {
  return (
    spec.top === `non-guard` ||
    spec.units.some(
      (unit) => REFUSED_UNITS.has(unit.kind) || unit.kind === `for-head`,
    )
  )
}

// The `probing` identifiers that the stripped output keeps, when it does not
// refuse: the mentions that are not references, and nothing from the guard.
function predictProbingTokens(spec) {
  return spec.units.reduce(
    (count, unit) => count + (MENTION_TOKENS[unit.kind] ?? 0),
    0,
  )
}

function predictOutcome(spec) {
  return {
    refuse: predictRefusal(spec),
    probingTokens: predictProbingTokens(spec),
  }
}

// -- 3. Driver ----------------------------------------------------------------

// The probe-form rule, run as ESLint runs it. A program that does not parse is
// a grammar error, not a rejection.
const linter = new Linter({ configType: `flat` })
const lintConfig = [
  {
    files: [`**/*.ts`],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: `latest`,
      sourceType: `module`,
    },
    plugins: { oracle: oraclePlugin },
    rules: { 'oracle/probe-form': `error` },
  },
]

function ruleAccepts(text) {
  const messages = linter.verify(text, lintConfig, { filename: `generated.ts` })
  const fatal = messages.find((message) => message.fatal)
  if (fatal) {
    throw new Error(
      `the grammar drew a program that does not parse: ${fatal.message}`,
    )
  }
  return messages.length === 0
}

// The identifiers of an emitted JavaScript module that name the guard, the
// probe, or the host's `process`. Types are gone by then.
function identifierCounts(code) {
  const file = ts.createSourceFile(
    `generated.js`,
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const counts = { probing: 0, __oracleProbe: 0, process: 0 }
  const visit = (node) => {
    if (ts.isIdentifier(node) && Object.hasOwn(counts, node.text)) {
      counts[node.text]++
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return counts
}

// Runs an emitted module, with a probe recorder on `globalThis` that must
// never be called. `process` is present with a development environment, or
// absent, as a bundle with no host process would leave it.
function runModule(code, hostProcess) {
  const program = new Function(`process`, `${code}\nreturn __program;`)(
    hostProcess ? { env: { NODE_ENV: `development` } } : undefined,
  )
  const trace = []
  const probes = []
  const previous = Object.getOwnPropertyDescriptor(globalThis, `__oracleProbe`)
  globalThis.__oracleProbe = (name) => {
    probes.push(name)
  }
  try {
    try {
      program.run(trace)
      return { trace, probes, error: null }
    } catch (error) {
      return { trace, probes, error: `${error.name}: ${error.message}` }
    }
  } finally {
    if (previous) Object.defineProperty(globalThis, `__oracleProbe`, previous)
    else delete globalThis.__oracleProbe
  }
}

// Reference: the source with `process.env.NODE_ENV` defined as "production".
async function referenceObservation(text, hostProcess) {
  const { code } = await transform(text, {
    loader: `ts`,
    format: `iife`,
    globalName: `__program`,
    define: { 'process.env.NODE_ENV': `"production"` },
  })
  return runModule(code, hostProcess)
}

// Production path: the plugin's transform, then esbuild's type stripping
// without a define. A refusal is the transform's thrown error.
async function strippedObservation(text, hostProcess) {
  let source = text
  try {
    const stripped = stripOracleProbes().transform(text, MODULE_ID)
    if (stripped !== null) source = stripped.code
  } catch (error) {
    return { refusal: error.message }
  }
  const { code } = await transform(source, {
    loader: `ts`,
    format: `iife`,
    globalName: `__program`,
  })
  return {
    ...runModule(code, hostProcess),
    identifiers: identifierCounts(code),
  }
}

// -- 4. Comparison ------------------------------------------------------------

function compareOutcome(expected, reference, observed) {
  // The reference never calls the probe, whatever the program.
  expect(reference.probes).toEqual([])
  if (expected.refuse) {
    expect(
      observed.refusal,
      `the stripper must refuse this program`,
    ).toBeTypeOf(`string`)
    expect(observed.refusal).toMatch(/probing|__oracleProbe/)
    return
  }
  expect(observed.refusal, `the stripper refused a program it must keep`).toBe(
    undefined,
  )
  expect(observed.probes).toEqual([])
  expect(observed.trace).toEqual(reference.trace)
  expect(observed.error).toEqual(reference.error)
  expect(observed.identifiers).toEqual({
    probing: expected.probingTokens,
    __oracleProbe: 0,
    process: 0,
  })
}

const tally = { accepted: 0, rejected: 0, refused: 0 }

async function checkProgram(spec) {
  const text = programText(spec)
  const admitted = ruleAccepts(text)
  expect(
    admitted,
    `the admission model and the probe-form rule disagree on:\n${text}`,
  ).toBe(predictAdmission(spec))
  if (!admitted) {
    expect(spec.fixed, `a constructed history must be admitted:\n${text}`).toBe(
      false,
    )
    tally.rejected++
    return
  }
  reach.beginHistory({ fixed: spec.fixed === true })
  for (const state of reachedStates(spec)) reach.reach(state)
  tally.accepted++
  const expected = predictOutcome(spec)
  if (expected.refuse) tally.refused++
  const reference = await referenceObservation(text, spec.hostProcess)
  const observed = await strippedObservation(text, spec.hostProcess)
  compareOutcome(expected, reference, observed)
}

// fast-check passes each example as an argument tuple.
const constructedExamples = () => constructedPrograms().map((spec) => [spec])

const reach = createOracleReach(PROPERTY, STATES, {
  minimum: 2,
  fixedHistories: constructedPrograms().length,
})

declareOracle({
  model: [predictAdmission, predictOutcome],
  check: [compareOutcome],
  grammar: [programArbitrary, constructedPrograms],
})

describe(`production stripping of the probe form`, () => {
  it(`fixed-seed campaign`, async () => {
    const parameters = oracleFixedSeed(FIXED_SEED, {
      numRuns: oracleRuns(BASE_RUNS),
    })
    await fc.assert(
      fc.asyncProperty(programArbitrary, checkProgram),
      withOracleFixedHistories(parameters, constructedExamples()),
    )
  }, 600_000)
  it(`random-seed campaign`, async () => {
    const parameters = oraclePropertyOptions(BASE_RUNS, PROPERTY)
    await fc.assert(
      fc.asyncProperty(programArbitrary, checkProgram),
      withOracleFixedHistories(parameters, constructedExamples()),
    )
  }, 600_000)
  afterAll(() => {
    if (process.env.TANSTACK_DB_ORACLE_REACH_REPORT) {
      console.log(`ADMISSION`, JSON.stringify(tally))
      console.log(`REACH`, JSON.stringify([...reach.counts()]))
    }
    reach.assertReached()
  })
})
