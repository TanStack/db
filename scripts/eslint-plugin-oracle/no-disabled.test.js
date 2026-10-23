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
    // Playwright's runtime skip, conditioned on the environment.
    `test.skip(browserName !== 'chromium', 'Chromium-only control')`,
    `test.skip(isMobile)`,
    `test.skip(false, 'kept for a later browser')`,
    // A replay selection may switch a test off.
    `it.skipIf(replayRequested)('checks the history', () => check())`,
    `it.runIf(replay.replayPath === undefined)('checks the history', () => check())`,
    `fc.assert(property, oraclePropertyOptions(12, 'cleanup-queue.history'))`,
    `fc.assert(property, { numRuns: oracleRuns(20) })`,
    // A pinned replay or mutant witness runs one fixed history.
    `fc.check(property, { seed: 205203, numRuns: 1 })`,
    `fc.check(property, { seed: fixedSeed, numRuns: 1 })`,
    `fc.assert(property, { seed: 2128, numRuns: oracleRuns(1) })`,
    `fc.assert(property, replayRequested ? { numRuns: oracleRuns(1) } : {})`,
    `fc.assert(property, campaign === 'replay' ? { numRuns: 1 } : {})`,
    `fc.assert(property, options.path === undefined ? options : { ...options, numRuns: 1 })`,
    // An expectation about a recorded run is not a run option.
    `expect(report).toMatchObject({ numRuns: 1, failed: true })`,
    // A known gap is pinned as failing on a fixed seed, not skipped.
    `it.fails('checks the fixed history', () => fc.assert(property, { seed: 2128, numRuns: oracleRuns(12) }))`,
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
      // A comment does not grant an exception.
      code: `
        // oracle-exclusion: known gap
        it.skip('checks random histories', () => fc.assert(property))
      `,
      errors: [{ messageId: `skip` }],
    },
  ],
})
