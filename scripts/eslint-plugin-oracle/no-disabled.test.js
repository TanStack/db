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
    {
      code: `import { oracleReplayRequested } from '../../db/tests/oracle-config.js'\nit.skipIf(oracleReplayRequested())('checks the history', () => check())`,
      languageOptions: { sourceType: `module` },
    },
    {
      code: `import { oracleReplayRequested } from './oracle-config'\nit.skipIf(oracleReplayRequested())('checks the history', () => check())`,
      languageOptions: { sourceType: `module` },
    },
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
    // The shared replay helpers may select a replay, in either polarity for
    // a registration and through the alias helper.
    ...[
      `it.skipIf(oracleReplaySkips('cursor.exact-width'))('a', () => check())`,
      `if (!oracleReplayRequested()) { it('a', () => check()) }`,
      `if (oracleReplayRequested()) { it('replays the path', () => check()) }`,
      `const propertyTest = oracleReplayTest(fcTest, 'cursor.exact-width')\npropertyTest.prop([a])('a', check)`,
      `describe('s', () => { if (oracleReplaySkips('cursor.exact-width')) return\n it('a', () => check()) })`,
    ].map((code) => ({
      code: `import { oracleReplayRequested, oracleReplaySkips, oracleReplayTest } from './oracle-config.js'\n${code}`,
      languageOptions: { sourceType: `module` },
    })),
    // Playwright's test API calls that register nothing.
    `test('a', async () => { if (rejected) { expect(test.info().project.name).not.toBe('webkit') } })`,
    // Registrations in a loop or over a table run in every ordinary run.
    `for (const campaign of campaigns) { it(campaign.name, () => check(campaign)) }`,
    `const fixedRuns = { seed: 1846, numRuns: 40 }`,
    // A skip on something other than the test context is not a test skip.
    `it('reads a page', (ctx) => { const cursor = open(); cursor.skip() })`,
    // An inner variable that shadows the context is not the test context.
    `it('reads a page', (ctx) => { pages.forEach((ctx) => ctx.skip()) })`,
    `it('reads a page', (_, ctx) => { ctx.skip() })`,
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
      code: `it('checks the history', (ctx) => { steps.forEach(() => ctx.skip()) })`,
      errors: [{ messageId: `skip` }],
    },
    {
      // A local function with the helper's name is not the shared helper.
      code: `const oracleReplayRequested = () => process.env.CI === 'true'\nit.skipIf(oracleReplayRequested())('checks the history', () => check())`,
      errors: [{ messageId: `conditional` }],
    },
    {
      code: `it.skipIf(oracleReplayRequested())('checks the history', () => check())`,
      errors: [{ messageId: `conditional` }],
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
      code: `const propertyTest = replay.replayPath === undefined ? fcTest : fcTest.skip`,
      errors: [{ messageId: `alias`, data: { name: `skip` } }],
    },
    {
      code: `const run = it.skip\nrun('a', () => check())`,
      errors: [{ messageId: `alias` }],
    },
    {
      code: `const run = fcTest.skip.prop([a])\nrun('a', check)`,
      errors: [{ messageId: `skip` }],
    },
    {
      code: `if (!replayRequested) { it('a', () => check()) }`,
      errors: [{ messageId: `guarded` }],
    },
    {
      code: `describe('s', () => { if (requested !== id) { return }\n it('a', () => check()) })`,
      errors: [{ messageId: `guarded` }],
    },
    {
      code: `process.env.CI || it('a', () => check())`,
      errors: [{ messageId: `guarded` }],
    },
    {
      code: `const oracleReplayRequested = () => true\nif (!oracleReplayRequested()) { it('a', () => check()) }`,
      errors: [{ messageId: `guarded` }],
    },
    {
      code: `fc.assert(property, { seed: replay.replaySeed, path: replay.replayPath, numRuns: 1 })`,
      errors: [{ messageId: `singleRun` }],
    },
    {
      code: `fc.assert(property, { numRuns: 300 })`,
      errors: [{ messageId: `literalRuns` }],
    },
    {
      code: `fcTest.prop([history], { numRuns: 200 })('checks the history', check)`,
      errors: [{ messageId: `literalRuns` }],
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
