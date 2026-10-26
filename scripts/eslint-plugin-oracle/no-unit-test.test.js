import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import noUnitTest from './rules/no-unit-test.js'

RuleTester.describe = describe
RuleTester.it = it

// Companion modules on disk, so that the rule resolves real imports.
const root = mkdtempSync(join(tmpdir(), `oracle-no-unit-test-`))
const tests = join(root, `tests`)
mkdirSync(join(root, `src`), { recursive: true })
mkdirSync(tests, { recursive: true })
writeFileSync(
  join(tests, `history-oracle.ts`),
  `import { declareOracle } from './oracle-config.js'
function checkHistory(history) { return history }
function modelHistory(history) { return history }
declareOracle({ check: [checkHistory], model: [modelHistory] })
export async function runHistory(history) { return checkHistory(history) }
export function fixture() { return [] }
export { modelHistory }
`,
)
writeFileSync(
  join(tests, `history-reexport.ts`),
  `export { runHistory as replayHistory } from './history-oracle.js'
export * from './history-oracle.js'
`,
)
writeFileSync(
  join(root, `src`, `production.ts`),
  `import { declareOracle } from '../tests/oracle-config.js'
function compile(x) { return x }
declareOracle({ check: [compile] })
export { compile }
`,
)
writeFileSync(join(root, `package.json`), JSON.stringify({ name: `published` }))
// A private package, such as an end-to-end suite, keeps its oracle in src/.
const suite = join(root, `suite`)
mkdirSync(join(suite, `src`), { recursive: true })
writeFileSync(
  join(suite, `package.json`),
  JSON.stringify({ name: `suite`, private: true }),
)
writeFileSync(
  join(suite, `src`, `laws-oracle.ts`),
  `import { declareOracle } from './oracle-config.js'
export function checkLaws(observation) { return observation }
declareOracle({ check: [checkLaws] })
`,
)
const filename = join(tests, `subject-oracle.test.ts`)
const suiteFilename = join(suite, `src`, `pages-oracle.suite.ts`)

const header = `import { declareOracle } from './oracle-config.js'
function checkHistory(history) { return history }
function modelHistory(history) { return history }
declareOracle({ check: [checkHistory], model: [modelHistory] })
`

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser, sourceType: `module` },
})

ruleTester.run(`oracle/no-unit-test`, noUnitTest, {
  valid: [
    // A generated property reaches the declared check.
    {
      code: `${header}fcTest.prop([history])('checks generated histories', (h) => checkHistory(h))`,
      filename,
    },
    // A fixed history reaches the check through a driver.
    {
      code: `${header}async function run(h) { await checkHistory(h) }
it('retains a row after an update', async () => { await run([{ type: 'update' }]) })`,
      filename,
    },
    // A driver held in a constant, and a body passed by name.
    {
      code: `${header}const run = (h) => checkHistory(h)
const replay = () => run([])
it('replays the pinned history', replay)`,
      filename,
    },
    // A model pin reaches the declared model.
    {
      code: `${header}it('keeps an empty diff pending', () => { expect(modelHistory([])).toEqual([]) })`,
      filename,
    },
    // A table of fixed histories.
    {
      code: `${header}it.each(cases)('checks %s', (c) => checkHistory(c))`,
      filename,
    },
    // A calibration witness reaches the check through the selection helper.
    {
      code: `import { declareOracle, oracleCalibrationTest } from './oracle-config.js'
function checkHistory(history) { return history }
declareOracle({ check: [checkHistory] })
oracleCalibrationTest(it, 'p', 'fault')('rejects the hostile mutant', () => checkHistory(bad))`,
      filename,
    },
    // A class model.
    {
      code: `import { declareOracle } from './oracle-config.js'
class Model { step() {} }
function checkHistory(h) { return h }
declareOracle({ check: [checkHistory], model: [Model] })
it('steps the model', () => { new Model().step() })`,
      filename,
    },
    // A companion module declares the check, and its driver reaches it.
    {
      code: `import { runHistory } from './history-oracle.js'
it('checks a fixed history', () => runHistory([]))`,
      filename,
    },
    // A re-export and an export star keep the reach.
    {
      code: `import { replayHistory, modelHistory } from './history-reexport.js'
it('replays', () => replayHistory([]))
it('pins the model', () => modelHistory([]))`,
      filename,
    },
    // A private package's src/ is test code, so the rule follows it.
    {
      code: `import { checkLaws } from './laws-oracle.js'
it('checks the page laws', () => checkLaws([]))`,
      filename: suiteFilename,
    },
    // A test of the shared oracle machinery checks no law.
    {
      code: `import { readOracleRunConfig } from './oracle-config.js'
it('rejects a retired variable', () => expect(() => readOracleRunConfig({})).toThrow())`,
      filename: join(tests, `oracle-config.test.ts`),
    },
    // A placeholder registered during a replay runs nothing.
    {
      code: `it.skip('runs only when its replay property is selected', () => {})`,
      filename,
    },
    // A suite and a Playwright step are not tests.
    {
      code: `${header}describe('suite', () => {
  test('runs a browser history', async () => { await test.step('open', async () => {}); checkHistory([]) })
})`,
      filename,
    },
    // A file with no tests needs no declaration.
    { code: `export function fixture() { return [] }`, filename },
  ],
  invalid: [
    // The reported failure: production compared with a hand-written value.
    {
      code: `${header}import { compileExpression } from '../src/compiler.js'
fcTest.prop([history])('checks generated histories', (h) => checkHistory(h))
it('handles a simple table reference', () => {
  expect(compileExpression(ref)(row)).toEqual({ id: 1 })
})`,
      filename,
      errors: [{ messageId: `unitTest`, line: 7 }],
    },
    // A unit test registered through a selection helper's result, or
    // through a renamed import, is still a test.
    {
      code: `${header}import { oracleReplayTest } from './oracle-config.js'
import { it as vitestIt } from 'vitest'
const fixedCase = oracleReplayTest(vitestIt)
fixedCase('checks', () => checkHistory([]))
fixedCase('compiles', () => expect(compile(1)).toBe(1))
vitestIt('compiles again', () => expect(compile(2)).toBe(2))`,
      filename,
      errors: [
        { messageId: `unitTest`, line: 9 },
        { messageId: `unitTest`, line: 10 },
      ],
    },
    // A file with tests and no declaration gets one report.
    {
      code: `import { compile } from '../src/compiler.js'
it('a', () => expect(compile(1)).toBe(1))
it('b', () => expect(compile(2)).toBe(2))`,
      filename,
      errors: [{ messageId: `undeclared`, line: 2 }],
    },
    // A local function named declareOracle declares nothing.
    {
      code: `function declareOracle() {}
function checkHistory(h) { return h }
declareOracle({ check: [checkHistory] })
it('checks', () => checkHistory([]))`,
      filename,
      errors: [{ messageId: `undeclared` }],
    },
    // A production module declares no oracle part, even when it calls the
    // helper, so the rule does not follow it.
    {
      code: `${header}import { compile } from '../src/production.js'
it('checks', () => checkHistory([]))
it('compiles', () => expect(compile(1)).toBe(1))`,
      filename,
      errors: [{ messageId: `unitTest`, line: 7 }],
    },
    // A local binding that shadows the check is not the check.
    {
      code: `${header}it('checks', () => { const checkHistory = (x) => x; expect(checkHistory(1)).toBe(1) })`,
      filename,
      errors: [{ messageId: `unitTest` }],
    },
    // A helper that only uses itself reaches nothing.
    {
      code: `${header}function loop(n) { return n === 0 ? 0 : loop(n - 1) }
it('counts down', () => expect(loop(3)).toBe(0))`,
      filename,
      errors: [{ messageId: `unitTest` }],
    },
    // A type annotation runs nothing, so it does not reach the check.
    {
      code: `${header}it('types', () => { const check: typeof checkHistory | undefined = undefined; expect(check).toBeUndefined() })`,
      filename,
      errors: [{ messageId: `unitTest` }],
    },
    // A companion module's fixture does not reach its check.
    {
      code: `import { runHistory, fixture } from './history-oracle.js'
it('checks a fixed history', () => runHistory([]))
it('builds a fixture', () => expect(fixture()).toEqual([]))`,
      filename,
      errors: [{ messageId: `unitTest`, line: 3 }],
    },
    // A test inside a suite and a test passed a timeout are still tests.
    {
      code: `${header}describe('suite', () => {
  it('a', () => expect(1).toBe(1), 1000)
})`,
      filename,
      errors: [{ messageId: `unitTest` }],
    },
  ],
})
