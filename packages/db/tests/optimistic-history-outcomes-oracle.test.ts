import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { createDeferred } from '../src/deferred.js'
import { oraclePropertyOptions, oracleRuns } from './oracle-config.js'
import { declareOracle } from './oracle-declaration.js'
import { createOracleReach } from './oracle-reach.js'
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

/**
 * # Do callers observe the exact optimistic request outcome?
 *
 * Row correctness is not enough. A request may remain pending, fulfill with a
 * specific value, reject with the original reason, or roll back while an
 * independent peer survives. This driver crosses those outcomes with existing
 * or absent rows, optimistic visibility, queued source work, and peer
 * settlement, then delegates row and event truth to the history model.
 *
 * The second group calibrates the outcome observer itself. It proves premature
 * success, copied values, replaced errors, and missing errors are detectable,
 * and that a shrunk failure can be replayed by seed and path.
 */

// The outcome checker is imported from the companion, which does not declare
// it. This file's calibrations reach it through the same check.
declareOracle({ check: [expectHistoryOutcome] })

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
        seed === undefined
          ? oraclePropertyOptions(100, `collection-state.optimistic-outcomes`)
          : { seed, numRuns: oracleRuns(100) },
      )
    },
  )
})

// A failed persisting edit cancels a pending same-key manual transaction when
// rollback cascades. A secondary rollback or a distinct key leaves that peer
// pending, and its later commit must still settle its own request.
const pendingPeerCases = [true, false].flatMap((sameKey) =>
  [
    { failure: `rollback` as const, cascade: true },
    { failure: `rollback` as const, cascade: false },
    { failure: `reject` as const, cascade: false },
  ].map((decision) => ({ sameKey, ...decision })),
)
it.each(pendingPeerCases)(
  `settles a pending manual peer after failure, sameKey=$sameKey failure=$failure cascade=$cascade`,
  async ({ sameKey, failure, cascade }) => {
    const peerSurvives = !sameKey || (failure === `rollback` && !cascade)
    const counts = await runOptimisticHistory(
      [],
      [
        {
          type: `edit`,
          key: 1,
          fields: { a: 1 },
          optimistic: true,
          pending: true,
        },
        {
          type: `edit`,
          key: sameKey ? 1 : 2,
          fields: { b: 2 },
          optimistic: true,
        },
        { type: `settle`, slot: 1, success: false, cascade, failure },
        ...(peerSurvives
          ? [
              {
                type: `settle` as const,
                slot: 0,
                success: true,
                cascade: false,
              },
            ]
          : []),
      ],
    )
    expect(counts).toMatchObject({
      edits: 2,
      settlements: peerSurvives ? 2 : 1,
      failures: 1,
    })
  },
)

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

/** External completion shares the primary optimistic model. The finite grammar
 * crosses each admission state with independent pending/persisting peers and
 * source transactions on the target key, another key, or a truncate. These
 * histories distinguish rejecting an inadmissible completion from preserving
 * the peer, queued source work and the later usable Collection.
 *
 * State, immutable requests, rows, metadata, public callbacks, downstream rows
 * and request verdicts are compared by runOptimisticHistory after every action.
 * Only pending target work admits its first completion; all repeated or other
 * state attempts reject. A same-key persisting peer holds accepted source work
 * through the admitted completion, so fulfillment alone cannot prove publication.
 */
const completionStates = [
  `pending`,
  `persisting`,
  `completed`,
  `failed`,
] as const
const completionPeers = [
  `none`,
  `pending-same`,
  `pending-other`,
  `persisting-same`,
  `persisting-other`,
] as const
const completionSources = [`none`, `same`, `other`, `truncate`] as const
const completionHistories = completionStates.flatMap((state) =>
  completionPeers.flatMap((peer) =>
    (peer.endsWith(`other`)
      ? [...completionSources, `peer` as const]
      : completionSources
    ).flatMap((source) =>
      [1, 2, 3].map((attempts) => ({ state, peer, source, attempts })),
    ),
  ),
)

describe(`external completion with peers and source work`, () => {
  it.each(completionHistories)(
    `preserves completion admission and independent work: %j`,
    async ({ state, peer, source, attempts }) => {
      const reach = createOracleReach(
        `external completion ${state}/${peer}/${source}/${attempts}`,
        [`attempts-compared`, `later-source-compared`],
      )
      reach.beginHistory()
      const steps: Array<OptimisticStep> = [
        {
          type: `edit`,
          key: 1,
          fields: { a: 1 },
          optimistic: true,
          pending: state === `pending`,
        },
      ]
      if (peer !== `none`)
        steps.push({
          type: `edit`,
          key: peer.endsWith(`same`) ? 1 : 2,
          fields: { b: 2 },
          optimistic: true,
          pending: peer.startsWith(`pending`),
        })
      if (state === `completed` || state === `failed`)
        steps.push({
          type: `settle`,
          slot: 0,
          success: state === `completed`,
          cascade: false,
        })
      if (source !== `none`)
        steps.push({
          type: `sync`,
          rows: [
            {
              id: source === `other` ? 3 : source === `peer` ? 2 : 1,
              a: 7,
              b: 8,
              c: 9,
            },
          ],
          truncate: source === `truncate`,
          copies: 1,
        })
      for (let i = 0; i < attempts; i++)
        steps.push({ type: `complete`, slot: 0 })
      // Drain each still-active request by its own explicit success. Target
      // and peer are independently held; an accepted completion removes only
      // the pending target from this active ordering.
      if (state === `persisting`)
        steps.push({ type: `settle`, slot: 0, success: true, cascade: false })
      if (peer !== `none`)
        steps.push({ type: `settle`, slot: 0, success: true, cascade: false })
      steps.push({
        type: `sync`,
        rows: [
          { id: 1, a: 11, b: 12, c: 13 },
          { id: 2, a: 21, b: 22, c: 23 },
        ],
        truncate: false,
        copies: 1,
      })
      const counts = await runOptimisticHistory(
        [{ id: 1, a: 0, b: 0, c: 0 }],
        steps,
      )
      expect(counts.edits).toBe(peer === `none` ? 1 : 2)
      expect(counts.completionAttempts).toBe(attempts)
      expect(counts.completionRejections).toBe(
        attempts - (state === `pending` ? 1 : 0),
      )
      reach.reach(`attempts-compared`)
      reach.reach(`later-source-compared`)
      reach.assertReached()
    },
  )
})
