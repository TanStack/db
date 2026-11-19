/** Node and Chromium share the same generated predicate-union judgment. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  unionHistoryArb,
  unionHistoryModel,
  unionStates,
  unionViolations,
} from './demand-union-oracle'
import type {
  UnionHistory,
  UnionObservation,
  UnionState,
} from './demand-union-oracle'
import type { Observation } from '../../db/tests/oracle-property'

export function registerDemandUnion(
  property: string,
  receive: (h: UnionHistory, id: string) => Promise<UnionObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<UnionHistory, UnionState>()
  const constructed = unionStates.flatMap((state) =>
    Array.from({ length: 2 }, (_, index) => ({
      name: `generated ${state} ${index + 1}`,
      enters: [state],
      build: (h: UnionHistory): UnionHistory => {
        const built = { ...h }
        if (state === `broad-first` || state === `broad-last`)
          built.order = state
        else if (state.startsWith(`narrow-only`)) {
          built.order = `narrow-only`
          built.overlap = state === `narrow-only-overlap`
        } else if (state !== `changed-values`) {
          built.order = h.order === `narrow-only` ? `broad-first` : h.order
          if (state === `limited-broad`) built.limited = true
        }
        required.set(built, state)
        return built
      },
    })),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Native PowerSync source rows follow the union of active predicates; an absent predicate is universal, and retiring one owner preserves surviving support and live values.`,
      authority: `docs/collections/powersync-collection.md: On-Demand Mode; On-Demand Mode with Sync Streams.`,
      limits: `Real local SQLite on Node/Chromium, concurrent direct subset demands, literal integer predicates and same-id value changes. No remote transport, persistence, reload, pending hooks, optimistic holds, predicate exits or arbitrary expression trees.`,
    },
    histories: {
      arbitrary: unionHistoryArb,
      states: unionStates,
      constructed,
      fixedSeeds: [2377],
      runs: 8,
      fixed: [
        {
          name: `unrestricted owner keeps updates outside its filtered sibling`,
          history: {
            order: `broad-first`,
            overlap: false,
            pivot: 0,
            value: 1,
            limited: true,
          },
        },
      ],
    },
    model: unionHistoryModel,
    driver: async (h, observe) => {
      const actual = await receive(h, `${property}-${sequence++}`)
      // Retain actual reach even when a semantic mismatch stops the framework's
      // successful-unit reach report. Shrunk histories remain distinct inputs.
      console.info(
        `NATIVE_UNION_RECEIVED`,
        JSON.stringify({
          property,
          history: h,
          reached: [...new Set(actual.reached)],
        }),
      )
      for (const state of actual.reached) observe(`reach`, state)
      observe(`provider work consumed`, actual)
    },
    check: (h, trace) => {
      const actual = trace.find(
        (x) => x.checkpoint === `provider work consumed`,
      )?.value as UnionObservation | undefined
      if (!actual)
        return violation(
          `provider work consumed`,
          `missing observation`,
          `predicate union observation`,
        )
      const errors = unionViolations(h, actual)
      if (errors.length) {
        const expected = unionHistoryModel(h)
        const first = expected.find(
          (cut, index) =>
            JSON.stringify(cut) !== JSON.stringify(actual.cuts[index]),
        )
        const checkpoint =
          first?.name ??
          (errors.some((error) =>
            error.startsWith(`third retirement publication:`),
          )
            ? `third retirement publication`
            : `receiving cleanup`)
        return violation(
          checkpoint,
          errors.join(`; `),
          `predicate union at ${checkpoint}`,
          { actual, expected },
        )
      }
      const state = required.get(h)
      if (
        state &&
        !trace.some((x) => x.checkpoint === `reach` && x.value === state)
      )
        return violation(
          `reach`,
          `missing ${state}`,
          `constructed builder reach`,
        )
      return pass
    },
    calibrations: [
      {
        name: `transient row loss during third retirement`,
        history: {
          fixed: `unrestricted owner keeps updates outside its filtered sibling`,
        },
        law: `predicate union at third retirement publication`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `provider work consumed`) return entry
            const actual = entry.value as UnionObservation
            const retirement = actual.cuts.find(
              (cut) => cut.name === `retired right`,
            )!
            return {
              ...entry,
              value: {
                ...actual,
                retirementPublications: [
                  ...actual.retirementPublications,
                  {
                    revision: retirement.revision,
                    rows: retirement.rows.slice(1),
                  },
                ],
              },
            }
          }),
      },
      {
        name: `stale value outside filtered sibling`,
        history: {
          fixed: `unrestricted owner keeps updates outside its filtered sibling`,
        },
        law: `predicate union at changed values 1`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `provider work consumed`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as UnionObservation),
                    cuts: (entry.value as UnionObservation).cuts.map((cut) =>
                      cut.name === `changed values 1`
                        ? {
                            ...cut,
                            rows: cut.rows.map((row, index) =>
                              index === 0 ? { ...row, value: `stale` } : row,
                            ),
                          }
                        : cut,
                    ),
                  },
                }
              : entry,
          ),
      },
      ...unionStates.flatMap((state) =>
        [1, 2].map((index) => ({
          name: `missing generated ${state} ${index}`,
          history: { constructed: `generated ${state} ${index}` },
          law: `constructed builder reach`,
          corrupt: (trace: ReadonlyArray<Observation>, h: UnionHistory) =>
            required.get(h) === state
              ? trace.filter(
                  (x) => !(x.checkpoint === `reach` && x.value === state),
                )
              : undefined,
        })),
      ),
    ],
    timeout: 180_000,
  })
}
