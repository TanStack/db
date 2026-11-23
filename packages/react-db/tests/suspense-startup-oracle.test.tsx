import fc from 'fast-check'
import { oracleProperty, pass, violation } from '../../db/tests/oracle-config'
import { observeSuspenseStartup } from './suspense-startup-driver'
import { expectedStartup, startupMismatch } from './suspense-startup-oracle'
import type { StartupHistory, StartupTrace } from './suspense-startup-oracle'

// Reuse the same history, expected first commit and comparison in Chromium.
// A held acquisition distinguishes readiness from incidental cache content.
const scopes = [`standalone`, `provider`, `explicit`] as const
const states = [
  `provider synchronous`,
  `explicit synchronous`,
  `held acquisition`,
  `synchronous with unrelated stream`,
  `pending result with local acquisition`,
]
const law = `A synchronously satisfied first acquisition commits its result without a Suspense fallback.`

oracleProperty({
  id: `react.suspense-startup`,
  law: {
    statement: law,
    authority: `React Suspense contract in docs/guides/error-handling.md and the synchronous observation cut in live-query-deferred-acquisition-oracle.test.ts.`,
    limits: `Fresh local filtered detail over a retained on-demand source, with a pending matching result, an unrelated stream, or no transport. Separate receiving witnesses own actual hydration.`,
  },
  owns: [`src/useLiveQuery.ts#useLiveQueryImpl`],
  histories: {
    arbitrary: fc
      .record({
        scope: fc.constantFrom(...scopes),
        rows: fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { maxLength: 5 }),
        selected: fc.integer({ min: 0, max: 4 }),
        held: fc.boolean(),
        unrelatedStream: fc.boolean(),
        pendingResult: fc.boolean(),
      })
      .filter(
        ({ scope, held, unrelatedStream, pendingResult }) =>
          !pendingResult ||
          (scope !== `standalone` && !held && !unrelatedStream),
      ),
    runs: 12,
    fixedSeeds: [2396],
    states,
    constructed: [
      ...([`provider`, `explicit`] as const).map((scope) => ({
        name: `${scope} synchronous`,
        enters: [`${scope} synchronous`],
        build: (history: StartupHistory) => ({
          ...history,
          scope,
          held: false,
          unrelatedStream: false,
          pendingResult: false,
        }),
      })),
      {
        name: `local query while another query streams`,
        enters: [`synchronous with unrelated stream`],
        build: (history: StartupHistory): StartupHistory => ({
          ...history,
          scope: history.scope === `explicit` ? `explicit` : `provider`,
          held: false,
          unrelatedStream: true,
          pendingResult: false,
        }),
      },
      {
        name: `pending matching result still starts local work`,
        enters: [`pending result with local acquisition`],
        build: (history: StartupHistory): StartupHistory => ({
          ...history,
          scope: history.scope === `explicit` ? `explicit` : `provider`,
          held: false,
          unrelatedStream: false,
          pendingResult: true,
        }),
      },
      {
        name: `held cached row`,
        enters: [`held acquisition`],
        build: (history: StartupHistory) => ({
          ...history,
          held: true,
          pendingResult: false,
          rows: [...new Set([...history.rows, history.selected])],
        }),
      },
    ],
    fixed: [
      {
        name: `cached filtered row under DbProvider`,
        history: {
          scope: `provider`,
          rows: [0, 1],
          selected: 1,
          held: false,
          unrelatedStream: false,
          pendingResult: false,
        },
      },
    ],
  },
  resolve: (history) => history,
  model: expectedStartup,
  driver: async (history, observe) => {
    const previous = globalThis.IS_REACT_ACT_ENVIRONMENT
    // The observation is a real flushSync commit, before an act queue drains.
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
    try {
      const trace = await observeSuspenseStartup(history)
      if (trace.acquiredBeforeRelease) {
        if (history.pendingResult)
          observe(`reach`, `pending result with local acquisition`)
        else if (history.held) observe(`reach`, `held acquisition`)
        else if (history.scope !== `standalone`) {
          observe(
            `reach`,
            history.unrelatedStream
              ? `synchronous with unrelated stream`
              : `${history.scope} synchronous`,
          )
        }
      }
      observe(`startup`, trace)
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = previous
    }
  },
  check: (_history, trace, expected) => {
    const actual = trace.find(({ checkpoint }) => checkpoint === `startup`)
    if (!actual) return violation(`startup`, `no startup observation`, law)
    const wrong = startupMismatch(actual.value as StartupTrace, expected)
    return wrong ? violation(wrong.checkpoint, wrong.difference, law) : pass
  },
  timeout: 30000,
})
