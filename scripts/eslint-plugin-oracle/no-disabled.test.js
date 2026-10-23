import { describe, it } from 'node:test'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import noDisabled from './rules/no-disabled.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser },
})

ruleTester.run(`oracle/no-disabled`, noDisabled, {
  valid: [
    // A replay that does not select this property registers an empty test.
    `it.skip('runs only when its replay property is selected', () => {})`,
    `it.todo('loads every subset from one generation')`,
    // Playwright's runtime skip for a control that one browser supports.
    `test.skip(browserName !== 'chromium', 'Chromium-only control')`,
    // A replay campaign stands the other tests aside.
    `it.skipIf(oracleReplayRequested())('checks the history', () => check())`,
    `fc.assert(property, oraclePropertyOptions(12, 'cleanup-queue.history'))`,
    `fc.assert(property, { numRuns: oracleRuns(20) })`,
    // A replay passes the recorded path, and a witness a fixed seed.
    `fc.check(property, { seed: failed.seed, path: failed.counterexamplePath, numRuns: 1 })`,
    `fc.check(property, { seed: 205203, numRuns: 1 })`,
    `fc.check(property, { seed: -1659005, numRuns: 1 })`,
    `const fixedSeed = 1657019\nfc.check(property, { seed: fixedSeed, numRuns: 1 })`,
    `fc.assert(property, { seed: 2128, numRuns: oracleRuns(1) })`,
    // An expectation about a recorded run is not a run option, and a sample
    // runs no property.
    `expect(report).toMatchObject({ numRuns: 1, failed: true })`,
    `fc.sample(historyArbitrary, { numRuns: 1 })`,
    // A known gap is pinned as failing on a fixed seed, not skipped.
    `it.fails('checks the fixed history', () => fc.assert(property, { seed: 2128, numRuns: oracleRuns(12) }))`,
    // A skip on something other than the test context is not a test skip.
    `it('reads a page', (ctx) => { const cursor = open(); cursor.skip() })`,
  ],
  invalid: [
    {
      code: `it.only('checks the history', () => {})`,
      errors: [{ messageId: `only` }],
    },
    {
      code: `describe.only('cleanup queue', () => { it('a', () => {}) })`,
      errors: [{ messageId: `only` }],
    },
    {
      code: `fcTest.only.prop([history])('checks the history', (h) => check(h))`,
      errors: [{ messageId: `only` }],
    },
    {
      code: `it.skip('checks random histories', () => fc.assert(property))`,
      errors: [{ messageId: `skip`, data: { name: `skip` } }],
    },
    {
      code: `describe.skip('cleanup queue', () => { it('a', () => check()) })`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `fcTest.skip.prop([history])('checks the history', (h) => check(h))`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `it.skip('checks follower histories', assertFollowerHistory)`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `fcTest.skip.prop([history])('checks the history', checkHistory)`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `test.skip()`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `test.skip(true, 'flaky in CI')`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `it.skipIf(true)('checks the history', () => check())`,
      errors: [{ messageId: `conditional`, data: { name: `skipIf` } }],
    },
    {
      code: `describe.runIf(false)('cleanup queue', () => { it('a', () => check()) })`,
      errors: [{ messageId: `conditional`, data: { name: `runIf` } }],
    },
    {
      code: `describe.skipIf(process.env.CI)('cleanup queue', () => { it('a', () => check()) })`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `it.todo('checks the history', () => { check() })`,
      errors: [{ messageId: `skip`, data: { name: `todo` } }],
    },
    {
      code: `fc.assert(property, { numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { ...oraclePropertyOptions(100, 'p'), numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, oraclePropertyOptions(1, 'cleanup-queue.history'))`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { seed: Date.now(), numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { seed: undefined, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, filePath ? { numRuns: 1 } : {})`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `it.skipIf(useFilePath)('checks the history', () => check())`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `fc.assert(property, { numRuns: oracleRuns(0) })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `test.skip(isMobile)`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `test.skip(process.env.CI === 'true', 'flaky')`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `test.fixme('checks the history', check)`,
      errors: [{ messageId: `skip`, data: { name: `fixme` } }],
    },
    {
      code: `test.describe.fixme('cleanup queue', () => { test('a', check) })`,
      errors: [{ messageId: `skip`, data: { name: `fixme` } }],
    },
    {
      code: `test.fixme()`,
      errors: [{ messageId: `skip`, data: { name: `fixme` } }],
    },
    {
      code: `it('checks the history', (ctx) => { ctx.skip(); check() })`,
      errors: [{ messageId: `skip` }],
    },
    {
      // Only the shared helper may select a replay: its polarity is fixed.
      code: `it.skipIf(replayRequested)('checks the history', () => check())`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `it.runIf(replay.replayPath === undefined)('checks the history', () => check())`,
      errors: [{ messageId: `conditional`, data: { name: `runIf` } }],
    },
    {
      code: `it.runIf(replay.replayPath !== undefined)('checks the history', check)`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `describe.skipIf(!oracleReplayRequested())('cleanup queue', () => { it('a', () => check()) })`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `describe.skipIf(path.sep === '\\\\')('cleanup queue', () => { it('a', () => check()) })`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `fc.assert(property, replayRequested ? {} : { numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, campaign === 'replay' ? { numRuns: 1 } : {})`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { seed: process.env.SEED, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { seed: replay.replaySeed, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `let seed = 1\nfc.assert(property, { seed, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { seed: replay.replaySeed, path: undefined, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      // A comment does not grant an exception.
      code: `
        // oracle-exclusion: known gap
        it.skip('checks random histories', () => fc.assert(property))
      `,
      errors: [{ messageId: `skip` }],
    },
  ],
})
