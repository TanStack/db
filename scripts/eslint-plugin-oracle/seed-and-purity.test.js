import { describe, it } from 'vitest'
import { RuleTester } from 'eslint'
import tsParser from '@typescript-eslint/parser'
import pureModel from './rules/pure-model.js'
import replayableSeed from './rules/replayable-seed.js'

RuleTester.describe = describe
RuleTester.it = it

const ruleTester = new RuleTester({
  languageOptions: { parser: tsParser },
})

ruleTester.run(`replayable-seed`, replayableSeed, {
  valid: [
    `fc.assert(property, { seed: 42, numRuns: oracleRuns(10) })`,
    `const SEED = 7; fc.assert(property, { seed: SEED })`,
    `fc.assert(property, { seed: failure.seed, path: failure.counterexamplePath })`,
    `it.each([1, 2])('campaign %s', (seed) => fc.assert(property, { seed, numRuns: oracleRuns(5) }))`,
    `it.each([1, undefined])('campaign %s', (seed) => fc.assert(property, seed === undefined ? oraclePropertyOptions(5, 'id') : { seed, numRuns: oracleRuns(5) }))`,
    `it.each([1, undefined])('campaign %s', (seed) => fc.assert(property, { ...(seed !== undefined ? { seed, numRuns: oracleRuns(5) } : oraclePropertyOptions(5, 'id')) }))`,
    `const campaigns = [{ seed: oraclePropertyOptions(10, 'id').seed ?? Math.floor(Math.random() * 1000) }]`,
    {
      code: `const seed = replay ?? Date.now() % 2 ** 31; fc.assert(property, { seed })`,
      filename: `/repo/packages/db/tests/oracle-property.ts`,
    },
  ],
  invalid: [
    {
      code: `it.each([1, undefined])('campaign %s', (seed) => fc.assert(property, { seed, numRuns: oracleRuns(5) }))`,
      errors: [{ messageId: `undefinedSeed` }],
    },
    {
      code: `function campaign(seed) { fc.assert(property, { seed, numRuns: oracleRuns(5) }) } it.each([1, undefined])('campaign %s', campaign)`,
      errors: [{ messageId: `undefinedSeed` }],
    },
    {
      code: `fc.assert(property, { seed: undefined })`,
      errors: [{ messageId: `undefinedSeed` }],
    },
    {
      code: `fc.assert(property, { seed: Date.now() % 2 ** 31 })`,
      errors: [{ messageId: `ambientSeed`, data: { call: `Date.now()` } }],
    },
    {
      code: `fc.assert(property, { seed: Math.floor(Math.random() * 1000) })`,
      errors: [{ messageId: `ambientSeed`, data: { call: `Math.random()` } }],
    },
  ],
})

const header = `import { oracleProperty } from './oracle-property'\n`

ruleTester.run(`pure-model`, pureModel, {
  valid: [
    header +
      `function model(history, trace) { return trace.length } oracleProperty({ id: 'x', model, check: () => pass, driver: async (h, observe) => observe('at', Date.now()) })`,
    // Another module's oracleProperty is not this framework's.
    `import { oracleProperty } from './elsewhere'; oracleProperty({ model: () => Date.now() })`,
  ],
  invalid: [
    {
      code:
        header +
        `oracleProperty({ id: 'x', model: () => Date.now(), check: () => pass })`,
      errors: [{ messageId: `impure` }],
    },
    {
      code:
        header +
        `function stamp() { return new Date() } function check() { return stamp() ? pass : pass } oracleProperty({ id: 'x', model: () => 1, check })`,
      errors: [{ messageId: `impure` }],
    },
    {
      code:
        header +
        `const reached = () => { setTimeout(() => {}); return [] }; oracleProperty({ id: 'x', model: () => 1, check: () => pass, reached })`,
      errors: [{ messageId: `impure` }],
    },
  ],
})
