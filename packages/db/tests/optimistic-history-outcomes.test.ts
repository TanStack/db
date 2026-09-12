import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createDeferred } from '../src/deferred.js'
import {
  expectHistoryOutcome,
  observeHistoryPromise,
  runOptimisticHistory,
  withHistoryCleanup,
} from './optimistic-history-oracle.js'
import type {
  HistoryOutcome,
  OptimisticStep,
} from './optimistic-history-oracle.js'

type Scenario = {
  existing: boolean
  optimistic: boolean
  failure: `rollback` | `reject`
  queued: boolean
  settlePeer: boolean
  a: number
  b: number
}

async function runOutcomeScenario(scenario: Scenario) {
  const { existing, optimistic, failure, queued, settlePeer, a, b } = scenario
  const initial = existing ? [{ id: 1, a: 0, b: 0, c: 0 }] : []
  const steps: Array<OptimisticStep> = [
    { type: `edit`, key: 1, fields: { a }, optimistic },
    { type: `edit`, key: 2, fields: { b }, optimistic: true },
    ...(queued
      ? [
          {
            type: `sync` as const,
            rows: [{ id: 3, a, b, c: 0 }],
            truncate: false,
            immediate: false,
            copies: 1,
          },
        ]
      : []),
    { type: `settle`, slot: 0, success: false, cascade: true, failure },
    ...(settlePeer
      ? [{ type: `settle` as const, slot: 0, success: true, cascade: false }]
      : []),
  ]
  // The existing independent history model judges rows, immutable requests,
  // downstream state and every outcome. These inputs cannot become no-op edits.
  const counts = await runOptimisticHistory(initial, steps)
  expect(counts).toMatchObject({
    edits: 2,
    failures: 1,
    settlements: settlePeer ? 2 : 1,
    queued: queued ? 1 : 0,
  })
}

describe(`Optimistic request outcome histories`, () => {
  const cells = [false, true].flatMap((existing) =>
    [false, true].flatMap((optimistic) =>
      ([`rollback`, `reject`] as const).map((failure) => ({
        existing,
        optimistic,
        failure,
      })),
    ),
  )
  it.each(cells)(`observes exact request outcomes: %j`, async (cell) => {
    for (const queued of [false, true]) {
      for (const settlePeer of [false, true]) {
        await runOutcomeScenario({ ...cell, queued, settlePeer, a: 2, b: 3 })
      }
    }
  })
  it.each([851203, undefined])(
    `varies failed request and surviving peer histories, seed=%s`,
    async (seed) => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            existing: fc.boolean(),
            optimistic: fc.boolean(),
            failure: fc.constantFrom(`rollback` as const, `reject` as const),
            queued: fc.boolean(),
            settlePeer: fc.boolean(),
            a: fc.integer({ min: 1, max: 20 }),
            b: fc.integer({ min: 1, max: 20 }),
          }),
          runOutcomeScenario,
        ),
        { seed, numRuns: 100 },
      )
    },
  )
})

describe(`Outcome observer calibration`, () => {
  it.each([
    `early-success`,
    `wrong-value`,
    `wrong-error`,
    `missing-error`,
    `receipt-error`,
  ] as const)(
    `rejects %s through the actual outcome checker`,
    async (fault) => {
      const value = { id: 1 }
      const error = new Error(`original`)
      let expected: HistoryOutcome<unknown>
      let bad: HistoryOutcome<unknown>
      if (fault === `early-success`) {
        expected = { status: `pending` }
        bad = { status: `fulfilled`, value }
      } else if (fault === `wrong-value`) {
        expected = { status: `fulfilled`, value }
        bad = { status: `fulfilled`, value: { ...value } }
      } else if (fault === `receipt-error`) {
        expected = { status: `fulfilled`, value: undefined }
        bad = { status: `rejected`, reason: error }
      } else {
        expected = { status: `rejected`, reason: error }
        bad = {
          status: `rejected`,
          reason: fault === `wrong-error` ? new Error(`original`) : undefined,
        }
      }
      expectHistoryOutcome(expected, expected, `valid neighbor`)
      expect(() => expectHistoryOutcome(bad, expected, fault)).toThrowError(
        expect.objectContaining({ name: `AssertionError` }),
      )
      const gate = createDeferred<unknown>()
      const observed = observeHistoryPromise(gate.promise)
      expectHistoryOutcome(
        observed.read(),
        { status: `pending` },
        `before settlement`,
      )
      if (expected.status === `rejected`) gate.reject(error)
      else gate.resolve(value)
      await observed.settled
      expectHistoryOutcome(
        observed.read(),
        expected.status === `rejected`
          ? expected
          : { status: `fulfilled`, value },
        `after settlement`,
      )
    },
  )
  it(`shrinks and replays a premature success counterexample`, () => {
    const property = fc.property(fc.integer({ min: 1, max: 100 }), (value) => {
      expectHistoryOutcome(
        { status: `pending` },
        { status: `pending` },
        `valid`,
      )
      expectHistoryOutcome(
        { status: `fulfilled`, value },
        { status: `pending` },
        `fault`,
      )
    })
    const failed = fc.check(property, { seed: 851204 })
    expect(failed.failed).toBe(true)
    expect(failed.numShrinks).toBeGreaterThan(0)
    expect(failed.errorInstance).toMatchObject({ name: `AssertionError` })
    const replay = fc.check(property, {
      seed: failed.seed,
      path: failed.counterexamplePath!,
      endOnFailure: true,
    })
    expect(replay.failed).toBe(true)
    expect(replay.counterexample).toEqual(failed.counterexample)
    expect(replay.errorInstance).toMatchObject({ name: `AssertionError` })
  })
  it.each([undefined, Object.freeze(new Error(`frozen primary`))])(
    `retains primary %s and every cleanup failure`,
    async (primary) => {
      const cleanupError = new Error(`cleanup`)
      const calls: Array<number> = []
      const observed = observeHistoryPromise(
        withHistoryCleanup(
          () => Promise.reject(primary),
          () => [
            () => {
              calls.push(1)
              throw cleanupError
            },
            () => {
              calls.push(2)
              return Promise.reject(undefined)
            },
            () => {
              calls.push(3)
            },
          ],
        ),
      )
      await observed.settled
      expect(calls).toEqual([1, 2, 3])
      const result = observed.read()
      expect(result.status).toBe(`rejected`)
      if (result.status !== `rejected`)
        throw new Error(`missing cleanup rejection`)
      expect(result.reason).toBeInstanceOf(AggregateError)
      const aggregate = result.reason as AggregateError
      expect(aggregate.cause).toBe(primary)
      expect(aggregate.errors).toHaveLength(3)
      expect(aggregate.errors[0]).toBe(primary)
      expect(aggregate.errors[1]).toBe(cleanupError)
      expect(aggregate.errors[2]).toBeUndefined()
    },
  )
  it(`preserves successful results and single errors without wrappers`, async () => {
    const value = { id: 1 }
    expect(
      await withHistoryCleanup(
        () => Promise.resolve(value),
        () => [() => {}],
      ),
    ).toBe(value)
    const error = Object.freeze(new Error(`single`))
    for (const fromCleanup of [false, true]) {
      const observed = observeHistoryPromise(
        withHistoryCleanup(
          () => (fromCleanup ? Promise.resolve(value) : Promise.reject(error)),
          () => [
            () => {
              if (fromCleanup) throw error
            },
          ],
        ),
      )
      await observed.settled
      expectHistoryOutcome(
        observed.read(),
        { status: `rejected`, reason: error },
        `single error`,
      )
    }
  })
})
