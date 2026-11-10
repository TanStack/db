/**
 * A completed-history count is output data, not a generated-property budget.
 * The maintainer's 2026-10-28 decision permits the typed OracleReplayWitness
 * record in its shared writer only when every value use serializes that record.
 * AGENTS.md still requires one-run unpinned property options to be reported.
 * A type annotation cannot excuse an options alias, escape, mutation or second
 * use. The initializer must be a plain data record with witness fields; custom
 * serialization hooks can receive the record without a binding reference.
 * This boundary owns only that distinction, not all no-disabled syntax.
 *
 * The finite source grammar varies location, annotation, value use, type-only
 * queries, JSON bindings and record spelling. Its intent model knows whether
 * the authored program is exclusively
 * recording a witness; it never parses source or invokes the rule. ESLint's
 * real TypeScript parser and no-disabled rule supply the report observation.
 * The comparison runs after linting and retains every report, including parser
 * errors. There is no random sampling, filesystem fixture or external process.
 * Global JSON.stringify is the supported serializer; its unmodified standard
 * behavior is a trusted premise. Global monkeypatches are outside this law.
 * Other serializers,
 * destructuring and intermodule flow are deliberately outside the allowance.
 */
import assert from 'node:assert/strict'
import tsParser from '@typescript-eslint/parser'
import { Linter } from 'eslint'
import { afterAll, test } from 'vitest'
import { declareOracle } from '../../packages/db/tests/oracle-declaration.js'
import { createOracleReach } from '../../packages/db/tests/oracle-reach.js'
import noDisabled from './rules/no-disabled.js'

const writer = '/repo/packages/db/tests/oracle-replay-witness.ts'
const flows = [
  'serialize',
  'budget',
  'both',
  'alias',
  'escape',
  'reassign',
  'shadow-json',
  'read-field',
  'replacer',
  'export',
  'runtime-typeof',
]
const jsonBindings = [
  'builtin',
  'type-alias',
  'interface',
  'import-type',
  'import-type-specifier',
  'ambient-value',
  'outer-value-inner-type',
]
const programs = []
for (const location of ['writer', 'lookalike'])
  for (const annotation of ['witness', 'other', 'none'])
    for (const flow of flows)
      for (const name of ['record', 'serializedProof'])
        for (const typeQuery of ['none', 'direct', 'qualified', 'before'])
          for (const jsonBinding of jsonBindings) {
            // An export inside a function is illegal TypeScript. Other axes
            // remain independent; the grammar never relies on parser recovery.
            if (flow === 'export' && jsonBinding === 'outer-value-inner-type')
              continue
            programs.push({
              location,
              annotation,
              flow,
              name,
              typeQuery,
              jsonBinding,
              initializer: 'plain',
            })
          }
// Custom hooks challenge the otherwise admissible recording programs. Crossing
// them with already rejected uses would hide whether this new guard runs.
for (const program of [...programs])
  if (
    program.location === 'writer' &&
    program.annotation === 'witness' &&
    program.flow === 'serialize' &&
    !['ambient-value', 'outer-value-inner-type'].includes(program.jsonBinding)
  )
    for (const initializer of [
      'spread',
      'method',
      'accessor',
      'prototype',
      'computed',
    ])
      programs.push({ ...program, initializer })

// Only a dedicated recording program emits a count observation. Every other
// authored program has an unpinned literal count whose enforcement must remain.
function expectedReports(program) {
  return program.location === 'writer' &&
    program.annotation === 'witness' &&
    program.flow === 'serialize' &&
    program.jsonBinding !== 'ambient-value' &&
    program.jsonBinding !== 'outer-value-inner-type' &&
    program.initializer === 'plain'
    ? []
    : ['singleRun']
}

function source(program) {
  const { name, annotation, flow } = program
  const type =
    annotation === 'none'
      ? ''
      : `: ${annotation === 'witness' ? 'OracleReplayWitness' : 'OtherRecord'}`
  const hook =
    'toJSON(this: OracleReplayWitness) { fc.assert(property, this); return null }'
  const custom =
    program.initializer === 'spread'
      ? '...budgetHook,'
      : program.initializer === 'prototype'
        ? '__proto__: budgetHook,'
        : program.initializer === 'method'
          ? `${hook},`
          : program.initializer === 'accessor'
            ? 'get toJSON() { return function() { fc.assert(property, this); return null } },'
            : program.initializer === 'computed'
              ? '["toJSON"]() { fc.assert(property, this); return null },'
              : ''
  const record = `const budgetHook = { ${hook} };\n${flow === 'export' ? 'export ' : ''}${flow === 'reassign' ? 'let' : 'const'} ${name}${type} = { ${custom} numRuns: 1, failed: false }`
  const serialize = `appendFileSync(channel, JSON.stringify(${name}));`
  const use =
    flow === 'serialize' || flow === 'export'
      ? `${serialize}\n${serialize}`
      : flow === 'budget'
        ? `fc.assert(property, ${name})`
        : flow === 'both'
          ? `${serialize}\nfc.assert(property, ${name})`
          : flow === 'alias'
            ? `const options = ${name}; fc.assert(property, options)`
            : flow === 'escape'
              ? `send(${name})`
              : flow === 'reassign'
                ? `${name} = replacement; ${serialize}`
                : flow === 'shadow-json'
                  ? serialize
                  : flow === 'replacer'
                    ? `JSON.stringify(${name}, (_key, value) => { fc.assert(property, value); return value })`
                    : flow === 'runtime-typeof'
                      ? `${serialize}\ntypeof ${name}`
                      : `${serialize}\nfc.assert(property, { numRuns: ${name}.numRuns })`
  const query =
    program.typeQuery === 'none'
      ? ''
      : `type Snapshot = typeof ${name}${program.typeQuery === 'qualified' ? '.numRuns' : ''};`
  const body = `${record};\n${program.typeQuery === 'before' ? query : ''}\n${use};\n${program.typeQuery === 'before' ? '' : query}`
  const rendered =
    flow === 'shadow-json' ? `function encode(JSON) { ${body} }` : body
  if (program.jsonBinding === 'outer-value-inner-type')
    return `function outer(JSON) { { type JSON = { marker: true }; ${rendered} } }`
  const prefix =
    program.jsonBinding === 'type-alias'
      ? 'type JSON = { marker: true };'
      : program.jsonBinding === 'interface'
        ? 'interface JSON { marker: true };'
        : program.jsonBinding === 'import-type'
          ? 'import type JSON from "types";'
          : program.jsonBinding === 'import-type-specifier'
            ? 'import { type JSON } from "types";'
            : program.jsonBinding === 'ambient-value'
              ? 'declare const JSON: unknown;'
              : ''
  return `${prefix}\n${rendered}`
}

// This driver asks the actual rule for all reports, rather than classifying its
// AST ourselves. Binding spelling must not change the observation.
function reports(program) {
  return new Linter({ cwd: '/repo' })
    .verify(
      source(program),
      [
        {
          files: ['**/*.ts'],
          languageOptions: {
            parser: tsParser,
            parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
          },
          plugins: { oracle: { rules: { 'no-disabled': noDisabled } } },
          rules: { 'oracle/no-disabled': 'error' },
        },
      ],
      {
        filename:
          program.location === 'writer'
            ? writer
            : '/repo/packages/db/tests/witness-output.ts',
      },
    )
    .map((report) => report.messageId ?? `parse:${report.message}`)
}

function checkReports(program, observed) {
  assert.deepEqual(observed, expectedReports(program), JSON.stringify(program))
}

const stateOf = ({
  location,
  annotation,
  flow,
  typeQuery,
  jsonBinding,
  initializer,
}) =>
  `${location}/${annotation}/${flow}/${typeQuery}/${jsonBinding}/${initializer}`
const states = [...new Set(programs.map(stateOf))]
const reach = createOracleReach('lint.replay-observation', states, {
  replaying: false,
})
let campaignEntered = false
afterAll(() => {
  // Calibrations can be selected independently. Once any source comparison
  // starts, the finite campaign still owes every declared reach state.
  if (campaignEntered) reach.assertReached()
})
declareOracle({
  check: [checkReports],
  model: [expectedReports],
  grammar: [programs],
})

test.each(programs)(
  'separates replay observations from budgets %j',
  (program) => {
    campaignEntered = true
    reach.beginHistory()
    const observed = reports(program)
    reach.reach(stateOf(program))
    checkReports(program, observed)
  },
)

test.each(['missing-report', 'spurious-report'])(
  'rejects wrong report observation %s',
  (fault) => {
    const program = programs.find(
      (candidate) =>
        (expectedReports(candidate).length === 0) ===
        (fault === 'spurious-report'),
    )
    const wrong = expectedReports(program).length === 0 ? ['singleRun'] : []
    assert.throws(() => checkReports(program, wrong))
  },
)
