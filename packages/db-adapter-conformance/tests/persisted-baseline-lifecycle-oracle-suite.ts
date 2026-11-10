/** Registration only: one judgment and grammar reach every receiving host. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  baselineLifecycleArbitrary,
  baselineLifecycleHistories,
  baselineLifecycleStates,
  baselineLifecycleViolations,
} from './persisted-baseline-lifecycle-oracle'
import type {
  BaselineLifecycleHistory,
  BaselineLifecycleObservation,
} from './persisted-baseline-lifecycle-oracle'
import type { Observation } from '../../db/tests/oracle-property'

export function registerBaselineLifecycle(
  config: { property: string; defaultRuns: number; streamFailure: boolean },
  receive: (
    h: BaselineLifecycleHistory,
    id: string,
  ) => Promise<BaselineLifecycleObservation>,
) {
  const id = config.property
  const candidate = process.env.TANSTACK_DB_BASELINE_EXPECT_HYDRATE !== `0`
  const builds = [
    {
      state: `accepted-before-retirement`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `cleanup` as const,
      }),
    },
    {
      state: `cleanup-held-continuation`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `cleanup` as const,
      }),
    },
    {
      state: `reload-held-continuation`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `reload` as const,
      }),
    },
    {
      state: `source-failure-held-baseline`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `source-fail` as const,
        initialRender: `default` as const,
      }),
    },
    {
      state: `receipt-rejection-held-baseline`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `receipt-reject` as const,
        initialRender: `default` as const,
      }),
    },
    {
      state: `empty-replacement`,
      build: (h: BaselineLifecycleHistory) => ({ ...h, replacement: 0 }),
    },
    {
      state: `replacement-overlap`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `cleanup` as const,
        old: h.old | 1,
        replacement: h.replacement | 1,
      }),
    },
    {
      state: `replacement-omits-old`,
      build: (h: BaselineLifecycleHistory) => ({
        ...h,
        action: `cleanup` as const,
        old: h.old | 1,
        replacement: h.replacement & ~1,
      }),
    },
    ...(candidate
      ? [
          {
            state: `adapter-hydrate-continuation`,
            build: (h: BaselineLifecycleHistory) => ({
              ...h,
              action: `cleanup` as const,
            }),
          },
        ]
      : []),
    ...(config.streamFailure
      ? [
          {
            state: `stream-failure-held-continuation`,
            build: (h: BaselineLifecycleHistory) => ({
              ...h,
              action: `stream-fail` as const,
              initialRender: `default` as const,
            }),
          },
        ]
      : []),
  ]
  const required = new WeakMap<BaselineLifecycleHistory, Array<string>>()
  let sequence = 0
  oracleProperty({
    id,
    law: {
      statement: `Cleanup retires source authority while persisted-baseline completion or an adapter acknowledgment is held. Accepted rows remain owed, replacement results are complete, resources release once, and failures remain handled.`,
      authority: `Shared eager-source LIFE-2/5/10, READY-4, HEALTH-5; glossary accepted sync transaction, cleanup and reload; existing TrailBase persisted-hydration row projection.`,
      owner: `Shared eager-source lifecycle receiving extension`,
      limits: `Three keys, one retirement/reload and replacement, delayed adapter acknowledgment distinct from application, local SDK data. Explicit hydrate-call reach required only for candidate mode; no remote provider service or internal-work law.`,
    },
    histories: {
      arbitrary: baselineLifecycleArbitrary(config.streamFailure),
      runs: config.defaultRuns,
      fixedSeeds: [239467],
      states: [
        ...baselineLifecycleStates,
        ...(candidate ? [`adapter-hydrate-continuation`] : []),
        ...(config.streamFailure ? [`stream-failure-held-continuation`] : []),
      ],
      constructed: builds.map(({ state, build }) => ({
        name: `generated ${state}`,
        enters: [state],
        build: (generated: BaselineLifecycleHistory) => {
          const history = { ...build(generated) }
          required.set(history, [state])
          return history
        },
      })),
      fixed: [
        ...baselineLifecycleHistories,
        ...(config.streamFailure
          ? baselineLifecycleHistories
              .filter((history) => history.action === `cleanup`)
              .map((history) => ({
                ...history,
                action: `stream-fail` as const,
              }))
          : []),
      ].map((history) => ({ name: JSON.stringify(history), history })),
    },
    model: (history) => ({ required: required.get(history) ?? [] }),
    driver: async (history, observe) => {
      let actual: BaselineLifecycleObservation
      try {
        actual = await receive(history, `${id}-${sequence++}`)
      } catch (error) {
        observe(`receiving-failure`, String(error))
        throw error
      }
      for (const state of actual.reached) observe(`reach`, state)
      if (actual.candidateHydrateCalls === 1 && actual.candidateHydrateHeld)
        observe(`reach`, `adapter-hydrate-continuation`)
      observe(`completed`, actual)
    },
    check: (history, trace, expected) => {
      const record = trace.find((item) => item.checkpoint === `completed`)
      if (!record)
        return trace.some((item) => item.checkpoint === `receiving-failure`)
          ? pass
          : violation(
              `completed`,
              `No completed observation`,
              `receiving execution`,
            )
      const actual = record.value as BaselineLifecycleObservation
      const differences = baselineLifecycleViolations(
        history,
        actual,
        candidate,
      )
      if (differences.length)
        return violation(
          `lifecycle`,
          differences.join(`; `),
          `persisted source lifecycle`,
        )
      if (actual.browserErrors?.length)
        return violation(
          `browser`,
          actual.browserErrors.join(`; `),
          `detached-browser-error`,
        )
      for (const state of expected.required)
        if (
          !trace.some(
            (item) => item.checkpoint === `reach` && item.value === state,
          )
        )
          return violation(
            `reach`,
            `generated construction omitted ${state}`,
            `constructed builder reach`,
          )
      return pass
    },
    calibrations: [
      {
        name: `lost durable accepted rows`,
        law: `persisted source lifecycle`,
        corrupt: (trace, history) =>
          trace.map((item) => {
            if (item.checkpoint !== `completed` || history.action !== `cleanup`)
              return item
            const actual = item.value as BaselineLifecycleObservation
            if (actual.before.durable.length === 0) return item
            return {
              ...item,
              value: { ...actual, resumed: { ...actual.resumed, durable: [] } },
            }
          }),
      },
      ...builds.map(({ state }) => ({
        name: `missing generated builder state ${state}`,
        law: `constructed builder reach`,
        corrupt: (
          trace: ReadonlyArray<Observation>,
          history: BaselineLifecycleHistory,
        ) =>
          required.get(history)?.includes(state)
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
