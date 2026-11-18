/** Generated Node and browser receiving paths share one native hook judgment. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  hookHistoryArb,
  hookLifecycleModel,
  hookLifecycleViolations,
  hookStates,
  legalHookHistory,
} from './hook-lifecycle-oracle'
import type {
  HookHistory,
  HookObservation,
  HookState,
} from './hook-lifecycle-oracle'
import type { Observation } from '../../db/tests/oracle-property'

export function registerPowerSyncHooks(
  property: string,
  receive: (h: HookHistory, id: string) => Promise<HookObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<HookHistory, HookState>()
  const constructed = hookStates.flatMap((state) =>
    Array.from({ length: 5 }, (_, index) => ({
      name: `generated ${state} ${index + 1}`,
      enters: [state],
      build: (h: HookHistory) => {
        let built = { ...h }
        if (state.includes(`:`)) {
          const [mode, action] = state.split(`:`)
          built.mode = mode as HookHistory['mode']
          built.retirement =
            action === `cleanup-pending` || action === `release-pending`
              ? action
              : `settled`
          if (built.retirement === `settled`)
            built.completion = action as HookHistory['completion']
        } else if (state === `applied-held`)
          built = {
            ...built,
            mode: `on-demand`,
            retirement: `settled`,
            completion: `async`,
            holdApplied: true,
          }
        else if (state === `asynchronous-cleanup`)
          built = {
            ...built,
            retirement: `settled`,
            completion: `async`,
            asynchronousCleanup: true,
          }
        else
          built.rows =
            state === `empty-source` ? 0 : h.rows || (h.coordinate % 7) + 1
        const history = legalHookHistory(built)
        required.set(history, state)
        return history
      },
    })),
  )
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `Native PowerSync load hooks own returned cleanup, respect retirement and hook failure boundaries, and settle successful subsets only after their rows apply.`,
      authority: `Native EagerSyncHooks/OnDemandSyncHooks; glossary cleanup, acquisition release and applied settlement.`,
      limits: `One hook, one subset owner, real local SQLite, sync/async success and failure, pending cleanup/release and held core applied receipt. No failing cleanup callback, remote transport, reload or concurrent owners.`,
    },
    histories: {
      arbitrary: hookHistoryArb,
      states: hookStates,
      constructed,
      runs: 12,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `cleanup waits for late eager cleanup callback`,
          history: {
            mode: `eager`,
            completion: `async`,
            retirement: `cleanup-pending`,
            asynchronousCleanup: true,
            holdApplied: false,
            rows: 3,
            coordinate: 1,
          },
        },
        {
          name: `subset fulfillment waits for application`,
          history: {
            mode: `on-demand`,
            completion: `async`,
            retirement: `settled`,
            asynchronousCleanup: false,
            holdApplied: true,
            rows: 7,
            coordinate: 2,
          },
        },
      ],
    },
    model: hookLifecycleModel,
    driver: async (h, observe) => {
      const a = await receive(h, `${property}-${sequence++}`)
      for (const state of a.reached) observe(`reach`, state)
      observe(`after hook cleanup`, a)
    },
    check: (h, trace) => {
      const a = trace.find((x) => x.checkpoint === `after hook cleanup`)
        ?.value as HookObservation | undefined
      if (!a)
        return violation(
          `after hook cleanup`,
          `missing observation`,
          `hook ownership`,
        )
      const errors = hookLifecycleViolations(h, a)
      if (errors.length)
        return violation(
          `after hook cleanup`,
          errors.join(`; `),
          `hook ownership`,
          { actual: a, expected: hookLifecycleModel(h) },
        )
      if (a.cleanupErrors?.length)
        return violation(
          `receiving cleanup`,
          a.cleanupErrors.join(`; `),
          `receiving cleanup`,
          { actual: a, expected: { cleanupErrors: [] } },
        )
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
        name: `completed hook cut retains late cleanup diagnostics`,
        history: { fixed: `subset fulfillment waits for application` },
        law: `receiving cleanup`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after hook cleanup`
              ? {
                  ...x,
                  value: {
                    ...(x.value as HookObservation),
                    cleanupErrors: [`injected late receiving cleanup`],
                  },
                }
              : x,
          ),
      },
      {
        name: `wrong applied cut remains primary after late cleanup failure`,
        history: { fixed: `subset fulfillment waits for application` },
        law: `hook ownership`,
        difference: `subset load escaped its actual held applied receipt`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after hook cleanup`
              ? {
                  ...x,
                  value: {
                    ...(x.value as HookObservation),
                    loadPendingAtAppliedHold: false,
                    cleanupErrors: [`injected late receiving cleanup`],
                  },
                }
              : x,
          ),
      },
      {
        name: `dropped late hook cleanup`,
        history: { fixed: `cleanup waits for late eager cleanup callback` },
        law: `hook ownership`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after hook cleanup`
              ? {
                  ...x,
                  value: { ...(x.value as HookObservation), cleanupCalls: 0 },
                }
              : x,
          ),
      },
      {
        name: `subset settles before applied receipt`,
        history: { fixed: `subset fulfillment waits for application` },
        law: `hook ownership`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after hook cleanup`
              ? {
                  ...x,
                  value: {
                    ...(x.value as HookObservation),
                    loadPendingAtAppliedHold: false,
                  },
                }
              : x,
          ),
      },
      ...hookStates.map((state) => ({
        name: `missing generated ${state}`,
        history: { constructed: `generated ${state} 1` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: HookHistory) =>
          required.get(h) === state
            ? trace.filter(
                (x) => !(x.checkpoint === `reach` && x.value === state),
              )
            : undefined,
      })),
    ],
    timeout: 180_000,
  })
}
