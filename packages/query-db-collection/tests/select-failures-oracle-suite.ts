/**
 * Result application is a second receiving boundary for the same error-value
 * law. Query's documented Errors contract makes a post-ready select refusal a
 * retryable failureReason. The observed Queries and their last valid rows stay;
 * later valid application can recover in that same sync run. A terminal decode
 * policy from a different adapter would violate that recovery contract.
 *
 * Generated histories retain the exhaustive owner's two-subset vocabulary and
 * independent latest-error model. Four fetches can replace a Query's error,
 * share one value across Queries, recover one holder, and finally clear it.
 * Plain and persisted variants judge the same public cuts after application.
 * Each constructed history keeps generated failure identities/suffix actions.
 */
import fc from 'fast-check'
import {
  differs,
  oracleProperty,
  pass,
  violation,
} from '../../db/tests/oracle-property'
import {
  checkFailingQueries,
  failingQueryReach,
  failingQueryStates,
  modelFailingQueries,
} from './failing-queries-oracle'
import { recordFailingQueries } from './failing-queries-driver'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  FailingQueryHistory,
  Fetch,
  StepObservation,
} from './failing-queries-oracle'

export function registerQuerySelectFailures(
  property: string,
  {
    owns,
    receive = recordFailingQueries,
  }: {
    owns: ReadonlyArray<string>
    receive?: (
      history: FailingQueryHistory,
      observe: (checkpoint: string, value: unknown) => void,
    ) => Promise<void>
  },
) {
  const selectRequired = new WeakMap<FailingQueryHistory, string>()
  const selectDescriptors = [false, true].flatMap((persisted) =>
    [...failingQueryStates, `select refusal`].map((lawState) => ({
      persisted,
      lawState,
      state: `${persisted ? `persisted` : `plain`}: ${lawState}`,
    })),
  )
  const selectStates = selectDescriptors.map(({ state }) => state)
  const selectBuilders = selectDescriptors.map(
    ({ state, persisted, lawState }) => ({
      name: `generated ${state}`,
      enters: [state],
      build: (generated: FailingQueryHistory): FailingQueryHistory => {
        const prefixes: Record<
          (typeof failingQueryStates)[number],
          Array<Fetch>
        > = {
          "a Query recovers while another's failure stays listed": [
            { subset: 1, fails: `fresh` },
            { subset: 2, fails: `fresh` },
            { subset: 1, fails: false },
          ],
          'a Query fails again with a new error while its failure is listed': [
            { subset: 1, fails: `shared` },
            { subset: 1, fails: `fresh` },
          ],
          'a Query fails with the error value another Query lists': [
            { subset: 1, fails: `shared` },
            { subset: 2, fails: `shared` },
          ],
          'a Query recovers while another lists the same error value': [
            { subset: 1, fails: `shared` },
            { subset: 2, fails: `shared` },
            { subset: 1, fails: false },
          ],
        }
        const history = {
          ...generated,
          failureStage: `select` as const,
          persisted,
          fetches: [
            ...(lawState in prefixes
              ? prefixes[lawState as (typeof failingQueryStates)[number]]
              : [{ subset: 1 as const, fails: `fresh` as const }]),
            ...generated.fetches,
          ].slice(0, 4),
        }
        selectRequired.set(history, state)
        return history
      },
    }),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Post-ready result-application failures obey the latest-error-per-Query law, preserve ready rows and observed Queries, and permit recovery in the same sync run.`,
      authority: `docs/collections/query-collection.md Errors; review ledger R21/R22; glossary health tree.`,
      limits: `Two on-demand subsets, four settled fetch/application steps, throwing select, plain or controlled persistence wrapper. No first-load refusal, native storage failure, delayed application or arbitrary schema parser.`,
    },
    histories: {
      arbitrary: fc.record({
        persisted: fc.boolean(),
        index: fc.nat(),
        failureStage: fc.constant(`select` as const),
        fetches: fc.array(
          fc.record({
            subset: fc.constantFrom(1 as const, 2 as const),
            fails: fc.constantFrom(
              false as const,
              `fresh` as const,
              `shared` as const,
            ),
          }),
          { minLength: 4, maxLength: 4 },
        ),
      }),
      states: selectStates,
      constructed: selectBuilders,
      runs: 40,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `select refusal recovers after durable application`,
          history: {
            persisted: true,
            index: 0,
            failureStage: `select`,
            fetches: [
              { subset: 1, fails: `fresh` },
              { subset: 1, fails: false },
              { subset: 1, fails: false },
              { subset: 1, fails: false },
            ],
          },
        },
      ],
    },
    model: modelFailingQueries,
    driver: async (history, observe) => {
      const steps: Array<StepObservation> = []
      await receive(history, (checkpoint, value) => {
        if (checkpoint === `step`) steps.push(value as StepObservation)
        observe(checkpoint, value)
      })
      // The classifier describes model transitions, but it earns reach only
      // after the real select hook consumed every injected refusal.
      if (
        steps.length === history.fetches.length &&
        steps.every((step) => step.refusalReached)
      ) {
        const path = history.persisted ? `persisted` : `plain`
        for (const state of failingQueryReach(history.fetches))
          observe(`reach`, `${path}: ${state}`)
        if (history.fetches.some((fetch) => fetch.fails))
          observe(`reach`, `${path}: select refusal`)
      }
    },
    check: (history, trace, expected) => {
      const failure = checkFailingQueries(history, trace, expected)
      if (failure !== pass) return failure
      for (const entry of trace.filter((item) => item.checkpoint === `step`)) {
        const step = entry.value as StepObservation
        const wrong = differs(
          `step`,
          `retryable select refusal`,
          {
            reached: step.refusalReached,
            status: step.status,
            rows: step.rows,
            observers: step.observers,
          },
          {
            reached: true,
            status: `ready`,
            rows: [{ id: 1 }, { id: 2 }],
            observers: 2,
          },
          `select refusal did not preserve its ready rows and observed Queries`,
        )
        if (wrong) return wrong
      }
      // Completed product observations stay primary over later browser diagnostics.
      if (
        trace.some(
          (entry) =>
            entry.checkpoint === `browserErrors` &&
            (entry.value as ReadonlyArray<string>).length,
        )
      )
        return violation(
          `browserErrors`,
          `Detached browser failure`,
          `receiving errors`,
        )
      const state = selectRequired.get(history)
      return state &&
        !trace.some(
          (item) => item.checkpoint === `reach` && item.value === state,
        )
        ? violation(
            `reach`,
            `Missing generated state ${state}`,
            `constructed select reach`,
          )
        : pass
    },
    calibrations: [
      ...([`rows`, `observers`] as const).map((fault) => ({
        name: `product ${fault} mismatch precedes detached receiving error`,
        history: { constructed: `generated plain: select refusal` },
        law: `retryable select refusal`,
        corrupt: (trace: ReadonlyArray<Observation>) => [
          ...trace.map((entry) =>
            entry.checkpoint === `step`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as StepObservation),
                    ...(fault === `rows` ? { rows: [] } : { observers: 0 }),
                  },
                }
              : entry,
          ),
          {
            checkpoint: `browserErrors`,
            value: [`secondary detached rejection`],
          },
        ],
      })),
      {
        name: `detached receiving error`,
        history: { constructed: `generated plain: select refusal` },
        law: `receiving errors`,
        corrupt: (trace) => [
          ...trace,
          { checkpoint: `browserErrors`, value: [`detached rejection`] },
        ],
      },
      {
        name: `terminal select refusal`,
        history: { constructed: `generated plain: select refusal` },
        law: `retryable select refusal`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `step`
              ? {
                  ...entry,
                  value: { ...(entry.value as StepObservation), observers: 0 },
                }
              : entry,
          ),
      },
      {
        name: `drop a still-failing Query's error`,
        history: {
          constructed: `generated plain: a Query recovers while another's failure stays listed`,
        },
        law: `listed causes`,
        corrupt: (trace) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `step`) return entry
            const step = entry.value as StepObservation
            return step.listed.length > 1
              ? {
                  ...entry,
                  value: { ...step, listed: step.listed.slice(0, -1) },
                }
              : entry
          }),
      },
      ...selectStates.map((state) => ({
        name: `missing generated ${state}`,
        history: { constructed: `generated ${state}` },
        law: `constructed select reach`,
        corrupt: (
          trace: ReadonlyArray<Observation>,
          history: FailingQueryHistory,
        ) =>
          selectRequired.get(history) === state
            ? trace.filter(
                (entry) =>
                  !(entry.checkpoint === `reach` && entry.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120_000,
  })
}
