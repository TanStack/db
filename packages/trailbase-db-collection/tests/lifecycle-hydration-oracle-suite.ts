/**
 * Campaign registration for the primary lifecycle owner's persisted receiver.
 * The independent row law and comparison stay in lifecycle-hydration-oracle;
 * this module supplies generated reach and framework registration only. Both
 * Node storage and real Chromium use the same model, grammar, and three cuts.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  hydrationLifecycleHistories,
  hydrationLifecycleHistoryArb,
  hydrationLifecycleStates,
  hydrationLifecycleViolations,
} from './lifecycle-hydration-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  HydrationLifecycleHistory,
  HydrationLifecycleObservation,
} from './lifecycle-hydration-oracle'

type State = (typeof hydrationLifecycleStates)[number]
export type HydrationBrowserObservation = HydrationLifecycleObservation & {
  browserErrors?: ReadonlyArray<string>
}
type Receiver = (
  history: HydrationLifecycleHistory,
  id: string,
) => Promise<HydrationBrowserObservation>

// A builder changes only the premise it promises. Other row sets, the render
// option and the retirement cut remain generated. Rejected lists carry no
// payload. Each builder invocation returns a fresh history object.
const builds: Array<{
  state: State
  build: (h: HydrationLifecycleHistory) => HydrationLifecycleHistory
}> = [
  {
    state: `hydration-held-cleanup`,
    build: (h) => ({ ...h, oldList: `complete` }),
  },
  {
    state: `late-list-rejection`,
    build: (h) => ({ ...h, oldList: `reject`, old: 0 }),
  },
  ...([`cleaned-up`, `replacement-loading`, `replacement-ready`] as const).map(
    (resumeAt) => ({
      state: `resume-${resumeAt}`,
      build: (h: HydrationLifecycleHistory) => ({ ...h, resumeAt }),
    }),
  ),
  {
    state: `empty-replacement`,
    build: (h) => ({ ...h, replacement: 0 }),
  },
  {
    state: `nonempty-replacement`,
    build: (h) => ({
      ...h,
      replacement: h.replacement || 1 << (h.previous % 3),
    }),
  },
  {
    state: `new-row-outside-old-list`,
    build: (h) => {
      const key = 1 << (h.previous % 3)
      return {
        ...h,
        oldList: `complete`,
        old: h.old & ~key,
        replacement: h.replacement | key,
      }
    },
  },
  {
    state: `old-row-omitted`,
    build: (h) => {
      const key = 1 << (h.previous % 3)
      return {
        ...h,
        oldList: `complete`,
        old: h.old | key,
        replacement: h.replacement & ~key,
      }
    },
  },
]

export function registerHydrationLifecycle(
  property: string,
  receive: Receiver,
) {
  const required = new WeakMap<
    HydrationLifecycleHistory,
    ReadonlyArray<State>
  >()
  let sequence = 0
  const constructed = builds.map(({ state, build }) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (generated: HydrationLifecycleHistory) => {
      const history = { ...build(generated) }
      required.set(history, [state])
      return history
    },
  }))
  oracleProperty({
    id: property,
    law: {
      statement: `Cleanup retires old source authority: a late list or persisted-hydration continuation preserves the cleaned-up or replacement Collection, its durable rows, and its replacement reader.`,
      authority: `TrailBase tests/ORACLE.md cleanup law; glossary cleanup and sync run; shared persisted-startup complete eager-result law; SQLite guide Render after SQLite restore.`,
      owner: `TrailBase lifecycle oracle, persisted hydration projection`,
      limits: `Three string keys and numeric values, one retired run and one replacement, controlled RecordApi/native stream. Network-first remains before its deadline; no remote service, arbitrary I/O failure or concurrent mutation.`,
    },
    histories: {
      arbitrary: hydrationLifecycleHistoryArb,
      runs: 50,
      fixedSeeds: [728159],
      states: hydrationLifecycleStates,
      constructed,
      fixed: hydrationLifecycleHistories.map((history) => ({
        name: JSON.stringify(history),
        history,
      })),
    },
    // Row truth remains in the independently specified shared comparison.
    // This projection adds only each construction's reach obligation, never a
    // production-derived expectation about rows or lifecycle.
    model: (history) => ({ required: required.get(history) ?? [] }),
    driver: async (history, observe) => {
      const actual = await receive(history, `${property}-${sequence++}`)
      for (const state of actual.reached) observe(`reach`, state)
      observe(`completed`, actual)
    },
    check: (history, trace, expected) =>
      hydrationLifecycleVerdict(history, trace, expected.required),
    calibrations: [
      {
        name: `late old work erases replacement rows`,
        law: `retired source authority`,
        corrupt: (trace, history) =>
          history.resumeAt === `replacement-ready` && history.replacement !== 0
            ? trace.map((entry) => {
                if (entry.checkpoint !== `completed`) return entry
                const raw = entry.value as HydrationLifecycleObservation
                return {
                  ...entry,
                  value: {
                    ...raw,
                    retiredResume: { ...raw.retiredResume, rows: [] },
                  },
                }
              })
            : undefined,
      },
      ...builds.map(({ state }) => ({
        name: `missing generated builder state ${state}`,
        law: `constructed builder reach`,
        corrupt: (
          trace: ReadonlyArray<Observation>,
          history: HydrationLifecycleHistory,
        ) =>
          required.get(history)?.includes(state)
            ? trace.filter(
                (entry) =>
                  !(entry.checkpoint === `reach` && entry.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 120000,
  })
}

/** Product mismatches retain their original law; browser errors are secondary. */
export function hydrationLifecycleVerdict(
  history: HydrationLifecycleHistory,
  trace: ReadonlyArray<Observation>,
  required: ReadonlyArray<State>,
): Verdict {
  const result = trace.find((entry) => entry.checkpoint === `completed`)
  const raw = result?.value as HydrationBrowserObservation | undefined
  const browserErrors = raw?.browserErrors ?? []
  const secondary = browserErrors.length
    ? `; secondary browser errors: ${browserErrors.join(`; `)}`
    : ``
  if (result) {
    const failures = hydrationLifecycleViolations(
      history,
      result.value as HydrationBrowserObservation,
    )
    if (failures.length)
      return violation(
        `completed`,
        failures.join(`; `) + secondary,
        `retired source authority`,
      )
  }
  const reached = new Set(
    trace
      .filter((entry) => entry.checkpoint === `reach`)
      .map((entry) => entry.value),
  )
  const missing = required.filter((state) => !reached.has(state))
  if (missing.length)
    return violation(
      `reach`,
      `generated construction omitted ${missing.join(`, `)}${secondary}`,
      `constructed builder reach`,
    )
  if (browserErrors.length && result)
    return violation(
      `browser`,
      browserErrors.join(`; `),
      `detached-browser-error`,
    )
  return result
    ? pass
    : violation(
        `completed`,
        `No final observation${secondary}`,
        `retired source authority`,
      )
}
