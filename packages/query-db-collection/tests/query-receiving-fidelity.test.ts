/** Calibration of the shared receiving judgments, with no production model. */
import { expect, it } from 'vitest'
import {
  deliverQueryHistory,
  recordQueryHistory,
} from '../../browser-db-sqlite-persistence/e2e/query-ownership-browser-support'
import {
  directOwnershipHistories,
  expectedDirectOwnership,
  persistedDirectOwnershipOptions,
} from './persisted-direct-ownership-oracle'
import {
  expectedImmediateMaterialization,
  immediateEagerMaterializationOptions,
  immediateMaterializationHistories,
} from './immediate-eager-materialization-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-property'

function rejection(verdict: Verdict, law: string, secondary = false) {
  expect(verdict.kind).toBe('violation')
  if (verdict.kind !== 'violation') throw new Error('Missing violation')
  expect(verdict.law).toBe(law)
  if (secondary)
    expect(String(verdict.difference)).toContain('secondary-page-error')
}
it('keeps direct receiving completion and secondary diagnostics observable', () => {
  const options = persistedDirectOwnershipOptions(async () => {}, 'calibration')
  // Fresh inputs isolate product/completion diagnostics here. The actual fixed
  // production replays and reach calibrations enforce their entered states.
  for (const fixed of directOwnershipHistories) {
    const h = { ...fixed }
    const expected = expectedDirectOwnership(h)
    const valid: Array<Observation> = [
      { checkpoint: 'first', value: expected },
      { checkpoint: 'firstDurable', value: expected },
      { checkpoint: 'completed', value: true },
    ]
    expect(options.check(h, valid, expected).kind).toBe('pass')
    rejection(options.check(h, [], expected), 'receiving completion')
    rejection(
      options.check(h, valid.slice(0, 2), expected),
      'receiving completion',
    )
    const wrong = [
      { checkpoint: 'first', value: [{ id: 'wrong', value: 0, owners: [] }] },
    ]
    rejection(options.check(h, wrong, expected), 'direct row ownership')
    rejection(
      options.check(
        h,
        [
          ...wrong,
          { checkpoint: 'browserErrors', value: ['secondary-page-error'] },
        ],
        expected,
      ),
      'direct row ownership',
      true,
    )
  }
})
it('keeps immediate receiving completion and secondary diagnostics observable', () => {
  const options = immediateEagerMaterializationOptions(
    async () => {},
    'calibration',
  )
  for (const fixed of immediateMaterializationHistories) {
    const h = { ...fixed, rows: fixed.rows.map((row) => ({ ...row })) }
    const expected = expectedImmediateMaterialization(h)
    const valid: Array<Observation> = [
      { checkpoint: 'creation-return', value: expected },
      { checkpoint: 'completed', value: true },
    ]
    expect(options.check(h, valid, expected).kind).toBe('pass')
    rejection(options.check(h, [], expected), 'receiving completion')
    rejection(
      options.check(h, valid.slice(0, 1), expected),
      'receiving completion',
    )
    const wrong = [
      {
        checkpoint: 'creation-return',
        value: { ...expected, status: 'loading' },
      },
    ]
    rejection(
      options.check(h, wrong, expected),
      'immediate eager materialization',
    )
    rejection(
      options.check(
        h,
        [
          ...wrong,
          { checkpoint: 'browserErrors', value: ['secondary-page-error'] },
        ],
        expected,
      ),
      'immediate eager materialization',
      true,
    )
  }
})

it('retains cleanup failure and detached browser diagnostics together', async () => {
  const result = await recordQueryHistory((observe) => {
    observe('prefix', 1)
    return Promise.reject(new Error('cleanup failure'))
  })
  const trace: Array<Observation> = []
  let thrown: unknown
  try {
    deliverQueryHistory(
      { ...result, browserErrors: ['secondary-page-error'] },
      (checkpoint, value) => trace.push({ checkpoint, value }),
    )
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error).message).toBe('cleanup failure')
  expect((thrown as Error).cause).toMatchObject({
    message: 'cleanup failure',
    browserErrors: ['secondary-page-error'],
  })
  expect(trace).toEqual([
    { checkpoint: 'prefix', value: 1 },
    { checkpoint: 'browserErrors', value: ['secondary-page-error'] },
  ])
})
