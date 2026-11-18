/** Each real host applies the same native page-admission model and check. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  nativeDecodeBatch,
  nativeDecodeHistoryArb,
  nativeDecodeModel,
  nativeDecodeStates,
  nativeDecodeViolations,
} from './batch-decode-oracle'
import type {
  NativeDecodeHistory,
  NativeDecodeObservation,
} from './batch-decode-oracle'
import type { Observation } from '../../db/tests/oracle-property'

export function registerNativeBatchDecode(
  property: string,
  receive: (
    h: NativeDecodeHistory,
    id: string,
  ) => Promise<NativeDecodeObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<NativeDecodeHistory, string>()
  const constructed = nativeDecodeStates.flatMap((state) =>
    Array.from({ length: 5 }, (_, index) => ({
      name: `generated ${state} ${index + 1}`,
      enters: [state],
      build: (h: NativeDecodeHistory) => {
        let built = { ...h }
        if (state.includes(`:`)) {
          const [mode, phase, outcome] = state.split(`:`)
          built = {
            ...built,
            mode: mode as NativeDecodeHistory['mode'],
            phase: phase as NativeDecodeHistory['phase'],
            outcome: outcome as NativeDecodeHistory['outcome'],
          }
        } else if (state === `transformed-key`) built.transformKeys = true
        else if (state === `empty-subset-after-refusal`)
          built = {
            ...built,
            mode: `on-demand`,
            outcome: h.outcome === `valid` ? `issues` : h.outcome,
          }
        else if (state === `live-overlap` || state === `live-fresh`) {
          built.phase = `live`
          built.overlap = state === `live-overlap`
        } else {
          built.outcome = h.outcome === `valid` ? `issues` : h.outcome
          if (state === `accepted-earlier-page`)
            built = {
              ...built,
              phase: `initial`,
              count: 6,
              batchSize: 1,
              refusalIndex: 5,
            }
          else
            built = {
              ...built,
              count: Math.max(3, h.count),
              refusalIndex:
                state === `refusal-first` ? 0 : Math.max(3, h.count) - 1,
            }
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
      statement: `Native decoding admits complete SQLite pages, retains earlier accepted pages after a refusal, preserves legal transformed keys/Date/boolean values, and exposes fatal refusal with watcher release and no same-run resumption. An explicit new sync run can recover valid source rows.`,
      authority: `Native definitions.ts deserialization fatality, arbitrary output schemas and syncBatchSize streaming contract; glossary publication/loading error/sync error.`,
      limits: `One native table, initial pages or one live SQL transaction, 1–6 authored rows, eager/on-demand direct subscription, corrected rows and a later subset after fatal refusal, then cleanup/restart. No retained reload, persistence or mutation handler.`,
    },
    histories: {
      arbitrary: nativeDecodeHistoryArb,
      states: nativeDecodeStates,
      constructed,
      runs: 12,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `valid native transformed pages`,
          history: {
            mode: `eager`,
            phase: `initial`,
            outcome: `valid`,
            count: 3,
            batchSize: 2,
            refusalIndex: 1,
            transformKeys: true,
            overlap: false,
            coordinate: 3,
            epoch: 3000,
          },
        },
        {
          name: `live refusal retains the prior native snapshot`,
          history: {
            mode: `eager`,
            phase: `live`,
            outcome: `issues`,
            count: 3,
            batchSize: 2,
            refusalIndex: 1,
            transformKeys: true,
            overlap: true,
            coordinate: 1,
            epoch: 1000,
          },
        },
        {
          name: `later initial refusal retains earlier streamed pages`,
          history: {
            mode: `eager`,
            phase: `initial`,
            outcome: `issues`,
            count: 6,
            batchSize: 1,
            refusalIndex: 5,
            transformKeys: false,
            overlap: false,
            coordinate: 2,
            epoch: 2000,
          },
        },
      ],
    },
    model: (h) => nativeDecodeBatch(h, h.phase === `initial`),
    driver: async (h, observe) => {
      const a = await receive(h, `${property}-${sequence++}`)
      for (const state of a.reached) observe(`reach`, state)
      observe(`after native source batch`, a)
    },
    check: (h, trace) => {
      const a = trace.find((x) => x.checkpoint === `after native source batch`)
        ?.value as NativeDecodeObservation | undefined
      if (!a)
        return violation(
          `after native source batch`,
          `missing observation`,
          `native batch decoding`,
        )
      const errors = nativeDecodeViolations(h, a)
      if (errors.length)
        return violation(
          `after native source batch`,
          errors.join(`; `),
          `native batch decoding`,
          {
            actual: { history: h, observation: a },
            expected: nativeDecodeModel(h, a.sourceBatches),
          },
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
        name: `partial SQL page publication is rejected`,
        history: { fixed: `valid native transformed pages` },
        law: `native batch decoding`,
        difference: `publication split, regressed, or crossed a refused source batch`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after native source batch`
              ? {
                  ...x,
                  value: {
                    ...(x.value as NativeDecodeObservation),
                    publications: [
                      (
                        x.value as NativeDecodeObservation
                      ).publications[0]!.slice(0, 1),
                    ],
                  },
                }
              : x,
          ),
      },
      {
        name: `later complete page cannot regress to an earlier page`,
        history: { fixed: `valid native transformed pages` },
        law: `native batch decoding`,
        difference: `publication split, regressed, or crossed a refused source batch`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after native source batch`
              ? {
                  ...x,
                  value: {
                    ...(x.value as NativeDecodeObservation),
                    publications: [
                      (x.value as NativeDecodeObservation).publications.at(-1)!,
                      (x.value as NativeDecodeObservation).publications[0]!,
                    ],
                  },
                }
              : x,
          ),
      },
      {
        name: `completed native decoding cut retains cleanup diagnostics`,
        history: { fixed: `valid native transformed pages` },
        law: `receiving cleanup`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after native source batch`
              ? {
                  ...x,
                  value: {
                    ...(x.value as NativeDecodeObservation),
                    cleanupErrors: [`injected late receiving cleanup`],
                  },
                }
              : x,
          ),
      },
      {
        name: `decode mismatch survives late cleanup failure`,
        history: { fixed: `valid native transformed pages` },
        law: `native batch decoding`,
        difference: `accepted page rows differ`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after native source batch`
              ? {
                  ...x,
                  value: {
                    ...(x.value as NativeDecodeObservation),
                    rows: [],
                    cleanupErrors: [`injected late receiving cleanup`],
                  },
                }
              : x,
          ),
      },
      {
        name: `discarded previously accepted initial pages`,
        history: {
          fixed: `later initial refusal retains earlier streamed pages`,
        },
        law: `native batch decoding`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((x) =>
            x.checkpoint === `after native source batch`
              ? {
                  ...x,
                  value: { ...(x.value as NativeDecodeObservation), rows: [] },
                }
              : x,
          ),
      },
      {
        name: `fatal run cannot fulfill later subset demand`,
        history: { constructed: `generated on-demand:live:issues 1` },
        law: `native batch decoding`,
        difference: `fatal sync run admitted a later subset request`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native source batch`) return item
            const value = item.value as NativeDecodeObservation
            return {
              ...item,
              value: {
                ...value,
                continuation: {
                  ...value.continuation!,
                  laterSubsetLoads: value.continuation!.laterSubsetLoads.map(
                    (load) => ({ ...load, outcome: `fulfilled` }),
                  ),
                },
              },
            }
          }),
      },
      {
        name: `new sync run must read corrected source rows`,
        history: { fixed: `live refusal retains the prior native snapshot` },
        law: `native batch decoding`,
        difference: `explicit new sync run did not recover valid source rows`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native source batch`) return item
            const value = item.value as NativeDecodeObservation
            return {
              ...item,
              value: {
                ...value,
                continuation: { ...value.continuation!, restartRows: [] },
              },
            }
          }),
      },
      ...nativeDecodeStates.map((state) => ({
        name: `missing generated ${state}`,
        history: { constructed: `generated ${state} 1` },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>, h: NativeDecodeHistory) =>
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
