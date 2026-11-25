/** Each real host applies the same native page-admission model and check. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  legalNativeMutationHistory,
  nativeDecodeBatch,
  nativeDecodeHistoryArb,
  nativeDecodeModel,
  nativeDecodeStates,
  nativeDecodeViolations,
  nativeMutationExpectedRows,
  nativeMutationHistoryArb,
  nativeMutationStates,
  nativeMutationViolations,
} from './batch-decode-oracle'
import type {
  NativeDecodeHistory,
  NativeDecodeObservation,
  NativeMutationHistory,
  NativeMutationObservation,
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
        if (state.startsWith(`hydration:`)) {
          const [, mode, phase, position] = state.split(`:`)
          built = {
            ...built,
            mode: mode as NativeDecodeHistory['mode'],
            phase: phase as NativeDecodeHistory['phase'],
            outcome: h.outcome === `valid` ? `issues` : h.outcome,
            count: 3,
            batchSize: 3,
            refusalIndex:
              position === `first` ? 0 : position === `middle` ? 1 : 2,
            hydrateAfterRefusal: true,
          }
        } else if (state.includes(`:`)) {
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
      statement: `Native decoding admits complete SQLite pages, retains earlier accepted pages after a refusal, preserves legal transformed keys/Date/boolean values, and exposes fatal refusal with watcher release and no same-run resumption. A refused page grants no authority over late hydration seeds. An explicit new sync run can recover valid source rows.`,
      authority: `Native definitions.ts deserialization fatality, arbitrary output schemas and syncBatchSize streaming contract; glossary publication/loading error/sync error; docs/guides/ssr.md Initial Data hydration authority.`,
      limits: `One native table, initial pages or one live SQL transaction, 1–6 authored rows, eager/on-demand direct subscription, optional late hydration after refusal, corrected rows and a later subset after fatal refusal, then cleanup/restart. No retained reload, persistence or mutation handler. Admission counts and accepted baseline are diagnostics; there is no balanced-begin law.`,
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
        name: `refused source staging cannot block a late hydration seed`,
        history: { constructed: `generated hydration:eager:initial:middle 1` },
        law: `native batch decoding`,
        difference: `refused page gained authority over a late hydration seed`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native source batch`) return item
            const value = item.value as NativeDecodeObservation
            return {
              ...item,
              value: {
                ...value,
                hydration: { ...value.hydration!, rows: value.rows },
              },
            }
          }),
      },
      {
        name: `late hydration must notify existing native subscribers`,
        history: { constructed: `generated hydration:eager:initial:middle 1` },
        law: `native batch decoding`,
        difference: `late hydration did not notify existing subscribers`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native source batch`) return item
            const value = item.value as NativeDecodeObservation
            return {
              ...item,
              value: {
                ...value,
                hydration: { ...value.hydration!, publications: [] },
              },
            }
          }),
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
      ...constructed.map(({ name, enters: [state] }) => ({
        name: `missing ${name}`,
        history: { constructed: name },
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

/** CRUD settlement shares the decode owner's refusal/retirement boundary. */
export function registerNativeMutationRefusal(
  property: string,
  receive: (
    h: NativeMutationHistory,
    id: string,
  ) => Promise<NativeMutationObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<NativeMutationHistory, string>()
  const constructed = nativeMutationStates.map((state) => ({
    name: `generated ${state}`,
    enters: [state],
    build: (h: NativeMutationHistory) => {
      let built = {
        ...h,
        peer: false,
        peerTransaction: false,
        activePeer: false,
        peerFirst: false,
      }
      if (state.startsWith(`active-peer:`)) {
        const [, mode, order, kind] = state.split(`:`)
        built = {
          ...built,
          activePeer: true,
          timing: `before-read`,
          peerFirst: order === `peer-first`,
          mode: mode as NativeMutationHistory['mode'],
          kind: kind as NativeMutationHistory['kind'],
        }
      } else if (
        state === `healthy-same-table-peer` ||
        state === `same-table-transaction`
      )
        built = {
          ...built,
          peer: true,
          effect: `decode-refusal`,
          peerTransaction: state === `same-table-transaction`,
          timing: `before-read`,
        }
      else if (state === `initial`) built.timing = `initial`
      else if (state.startsWith(`refusal:`)) {
        const [, mode, timing, kind] = state.split(`:`)
        built = {
          ...built,
          effect: `decode-refusal`,
          mode: mode as NativeMutationHistory['mode'],
          timing: timing as NativeMutationHistory['timing'],
          kind: kind as NativeMutationHistory['kind'],
        }
      } else {
        const [effect, mode] = state.split(`:`)
        built = {
          ...built,
          effect: effect as NativeMutationHistory['effect'],
          mode: mode as NativeMutationHistory['mode'],
          timing: `before-read`,
        }
      }
      const history = legalNativeMutationHistory(built)
      required.set(history, state)
      return history
    },
  }))
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A native mutation fulfills only after its own Collection stages the observed SQLite operation; a same-table peer cannot replace that confirmation. Fatal decoder refusal rejects unconfirmed and newly admitted handlers instead of retaining an impossible wait. A rejected diff read permits later observation, and cleanup/restart cannot revive the retired request's outcome.`,
      authority: `PowerSyncTransactor.applyTransaction and PendingOperationStore's confirmation contract; PowerSync guide settled CRUD; native definitions.ts fatal deserialization; glossary optimistic state, stopped sync error and cleanup.`,
      limits: `One native table, one CRUD handler or two same-table Collections with individually owned confirmations, and one authored source update. Healthy same-table callbacks run in either order, with full owning/peer row snapshots and owning publications checked while the other callback remains parked. Real callback/read gates cover eager/on-demand, ordinary cleanup, and a committed SQLite write whose SDK result is held before forwarding. No transport or persistence wrapper. SQL rows and open sync transactions are diagnostics, not rollback or balanced-begin obligations.`,
    },
    histories: {
      arbitrary: nativeMutationHistoryArb,
      states: nativeMutationStates,
      constructed,
      runs: 8,
      fixedSeeds: [2377],
    },
    model: nativeMutationExpectedRows,
    driver: async (h, observe) => {
      const actual = await receive(h, `${property}-${sequence++}`)
      for (const state of actual.reached) observe(`reach`, state)
      observe(`after native confirmation source drained`, actual)
    },
    check: (h, trace) => {
      const actual = trace.find(
        (item) =>
          item.checkpoint === `after native confirmation source drained`,
      )?.value as NativeMutationObservation | undefined
      if (!actual)
        return violation(
          `after native confirmation source drained`,
          `missing native mutation observation`,
          `native mutation settlement`,
        )
      const state = required.get(h)
      if (state && !actual.reached.includes(state))
        return violation(`reach`, `missing ${state}`, `native mutation reach`)
      const errors = nativeMutationViolations(h, actual)
      return errors.length
        ? violation(
            `after native confirmation source drained`,
            errors.join(`; `),
            `native mutation settlement`,
            {
              actual: { history: h, observation: actual },
              expected: nativeMutationExpectedRows(h),
            },
          )
        : pass
    },
    calibrations: [
      {
        name: `a peer cannot fulfill the owning confirmation`,
        history: {
          constructed: `generated active-peer:eager:peer-first:insert`,
        },
        law: `native mutation settlement`,
        difference: `another native Collection decided the owning handler`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native confirmation source drained`)
              return item
            const actual = item.value as NativeMutationObservation
            return {
              ...item,
              value: {
                ...actual,
                activePeer: { ...actual.activePeer!, mutation: `fulfilled` },
              },
            }
          }),
      },
      {
        name: `an unconfirmed mutation cannot disappear from a publication`,
        history: {
          constructed: `generated active-peer:eager:peer-first:insert`,
        },
        law: `native mutation settlement`,
        difference: `owning native publication dropped unconfirmed optimistic state`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) => {
            if (item.checkpoint !== `after native confirmation source drained`)
              return item
            const actual = item.value as NativeMutationObservation
            return {
              ...item,
              value: {
                ...actual,
                activePeer: {
                  ...actual.activePeer!,
                  publications: [actual.activePeer!.base],
                },
              },
            }
          }),
      },
      {
        name: `a healthy mutation cannot retain its confirmation wait`,
        history: { constructed: `generated healthy:eager` },
        law: `native mutation settlement`,
        difference: `native mutation pending after its confirmation source drained`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((item) =>
            item.checkpoint === `after native confirmation source drained`
              ? {
                  ...item,
                  value: {
                    ...(item.value as NativeMutationObservation),
                    mutation: `pending`,
                  },
                }
              : item,
          ),
      },
      ...constructed.map(({ name, enters: [state] }) => ({
        name: `missing ${name}`,
        history: { constructed: name },
        law: `native mutation reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace
            .map((item) =>
              item.checkpoint === `after native confirmation source drained`
                ? {
                    ...item,
                    value: {
                      ...(item.value as NativeMutationObservation),
                      reached: (
                        item.value as NativeMutationObservation
                      ).reached.filter((reached) => reached !== state),
                    },
                  }
                : item,
            )
            .filter(
              (item) => !(item.checkpoint === `reach` && item.value === state),
            ),
      })),
    ],
    timeout: 120_000,
  })
}
