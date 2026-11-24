/**
 * Shared registration for on-demand stream ownership and applied settlement.
 * Every fixed regression and randomized construction uses the same model,
 * public production composition and comparison. Five fresh constructions per
 * state enforce required reach in each normal campaign. Each builder runs on
 * five bases. The local ledger checks every fresh built base against its
 * required production state; the ordinary generated unit uses the arbitrary.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { observeOnDemandStreams } from './on-demand-streams-driver'
import {
  constructOnDemandStreamsHistory,
  failingStreams,
  onDemandBoundaryHistoryArb,
  onDemandBoundaryModel,
  onDemandBoundarySchedules,
  onDemandBoundaryViolations,
  onDemandStreamsHistoryArb,
  onDemandStreamsModel,
  onDemandStreamsStates,
  onDemandStreamsViolations,
} from './on-demand-streams-oracle'
import type { Observation, Verdict } from '../../db/tests/oracle-property'
import type {
  OnDemandStreamsAdapter,
  OnDemandStreamsResult,
} from './on-demand-streams-driver'
import type {
  OnDemandBoundaryHistory,
  OnDemandBoundaryObservation,
  OnDemandStreamsHistory,
  OnDemandStreamsState,
  StreamCut,
} from './on-demand-streams-oracle'

/** Same boundary judgment receives actual Node and Chromium SDK observations. */
export function registerOnDemandBoundaryConformance(
  property: string,
  receive: (
    h: OnDemandBoundaryHistory,
    id: string,
  ) => Promise<OnDemandBoundaryObservation>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  let sequence = 0
  const required = new WeakMap<OnDemandBoundaryHistory, string>()
  const constructed = onDemandBoundarySchedules.map((schedule) => ({
    name: `generated ${schedule}`,
    enters: [schedule],
    build: (base: OnDemandBoundaryHistory) => {
      const built = { ...base, schedule }
      required.set(built, schedule)
      return built
    },
  }))
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A current rejected stream retains the service error, including when a secondary unrelated durable receipt rejects. Cleanup-abandoned source receipts reject with AbortError after core has canceled the demand; the obsolete result changes no source health. Accepted complete or partial-priority checkpoint rows survive cancellation, and the raw source load waits for their establishing receipt without waiting for an unrelated later receipt. A storage failure separately crashes the source with its own cause. Releasing an acquisition cancels its pending SDK wait while a healthy peer remains active. Actual standalone SDK rejection callbacks follow acquisition return, also when a subsequent acquisition reuses the cached failure.`,
      authority: `PowerSync Direct guide On-Demand Sync and Errors; glossary abort/applied receipt/cleanup; query/live/ARCHITECTURE.md Source cancellation and applied settlement; installed standalone-client 0.1.1 supplies callback scheduling as a receiving premise.`,
      limits: `Two equality demands, real installed SDK and controlled legal HTTP, one accepted receipt held behind a public optimistic transaction and either applied or abandoned by public cleanup; complete-checkpoint cancellation before/after its await continuation; priority-zero partial delivery beside a priority-three peer bucket, with cancellation of a request or pending query, empty delivery or an earlier peer receipt; or actual persistence receipts held and either failed or independently released in order at applyCommittedTx over Node SQLite or Chromium worker/OPFS; or one to three application status reentries followed by acquisition release before or after the successor checkpoint. Retained rows after crash remain diagnostic, without a post-crash read promise. The durable failure is controlled; no actual disk-failure, deployed service or future SDK scheduling claim.`,
    },
    histories: {
      arbitrary: onDemandBoundaryHistoryArb,
      states: onDemandBoundarySchedules,
      constructed,
      runs: 16,
      fixedSeeds: [2446],
    },
    model: onDemandBoundaryModel,
    driver: async (h, observe) => {
      const raw = await receive(h, `${property}-${sequence++}`)
      for (const state of raw.reached) observe(`reach`, state)
      observe(`request boundary`, raw)
    },
    check: (h, trace) => {
      const raw = trace.find((entry) => entry.checkpoint === `request boundary`)
        ?.value as OnDemandBoundaryObservation | undefined
      if (!raw)
        return violation(
          `request boundary`,
          `missing observation`,
          `request boundary`,
        )
      const failures = onDemandBoundaryViolations(h, raw)
      if (failures.length)
        return violation(
          `request boundary`,
          failures.join(`; `),
          `request boundary`,
          { actual: raw, expected: onDemandBoundaryModel(h) },
        )
      const state = required.get(h)
      if (
        state &&
        !raw.reached.includes(state as OnDemandBoundaryHistory[`schedule`])
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
        name: `an abandoned priority receipt must retain the AbortError category`,
        history: { constructed: `generated priority-cleanup-abort` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    rawErrorName: `Error`,
                  },
                }
              : entry,
          ),
      },
      {
        name: `a canceled source cannot omit its own establishing receipt`,
        history: { constructed: `generated receipt-abort` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    rawPendingWhileReceiptHeld: false,
                  },
                }
              : entry,
          ),
      },
      {
        name: `a canceled source cannot wait for the newest unrelated receipt`,
        history: { constructed: `generated receipt-abort-later-batch` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    rawOutcomeAtLaterCut: `pending`,
                  },
                }
              : entry,
          ),
      },
      {
        name: `a released acquisition cannot retain an unsettled SDK wait`,
        history: { constructed: `generated lease-release-after-checkpoint` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    pendingWaitsAfterRelease: 1,
                  },
                }
              : entry,
          ),
      },
      {
        name: `a synchronous rejection callback is distinguishable`,
        history: { constructed: `generated fresh-rejection` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    callbacksDuringAcquire: 1,
                  },
                }
              : entry,
          ),
      },
      {
        name: `a current stream failure cannot become an unrelated receipt error`,
        history: { constructed: `generated receipt-applied` },
        law: `request boundary`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    rawCause: `receipt`,
                  },
                }
              : entry,
          ),
      },
      ...constructed.map((builder) => ({
        name: `missing ${builder.name}`,
        history: { constructed: builder.name },
        law: `constructed builder reach`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `request boundary`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as OnDemandBoundaryObservation),
                    reached: [],
                  },
                }
              : entry,
          ),
      })),
    ],
  })
}

type Result = OnDemandStreamsResult & {
  browserErrors?: ReadonlyArray<string>
}
export function registerOnDemandStreamsConformance(
  property: string,
  receiver:
    | OnDemandStreamsAdapter
    | ((
        history: OnDemandStreamsHistory,
        id: string,
        failed: ReadonlyArray<string>,
      ) => Promise<Result>),
  {
    owns,
    receivingPath = `Real installed SDK with controlled HTTP, without a real service, browser, reload or persistence claim.`,
  }: {
    owns: ReadonlyArray<string>
    receivingPath?: string
  },
) {
  let sequence = 0
  const required = new WeakMap<OnDemandStreamsHistory, OnDemandStreamsState>()
  const constructed = onDemandStreamsStates.flatMap((state) =>
    Array.from({ length: 5 }, (_, index) => ({
      name: `${state} construction ${index + 1}`,
      enters: [state],
      build: (h: OnDemandStreamsHistory) => {
        const built = { ...constructOnDemandStreamsHistory(h, state) }
        required.set(built, state)
        return built
      },
    })),
  )
  const drive = async (
    h: OnDemandStreamsHistory,
    observe: (checkpoint: string, value: unknown) => void,
  ) => {
    const id = `${property}-${sequence++}`
    const result = await (typeof receiver === `function`
      ? receiver(h, id, failingStreams(h))
      : observeOnDemandStreams(receiver, h, id, failingStreams(h)))
    for (const state of result.reached) observe(`reach`, state)
    observe(`result`, result)
  }
  const check = (
    h: OnDemandStreamsHistory,
    trace: ReadonlyArray<Observation>,
    expected: ReturnType<typeof onDemandStreamsModel>,
  ): Verdict => {
    const requiredState = required.get(h)
    if (
      requiredState &&
      !trace.some(
        (entry) =>
          entry.checkpoint === `reach` && entry.value === requiredState,
      )
    )
      return violation(
        `reach`,
        `generated construction omitted ${requiredState}`,
        `constructed builder reach`,
      )
    const result = trace.find((entry) => entry.checkpoint === `result`)
      ?.value as Result | undefined
    if (!result)
      return violation(
        `result`,
        `public receiving result missing`,
        `on-demand stream ownership and settlement`,
      )
    const failures = onDemandStreamsViolations(expected, result.cuts)
    if (failures.length)
      return violation(
        `result`,
        failures.join(`; `),
        `on-demand stream ownership and settlement`,
        { expected, actual: result },
      )
    if (result.cleanupErrors?.length)
      return violation(
        `cleanup`,
        result.cleanupErrors.join(`; `),
        `receiving cleanup`,
        { expected: { cleanupErrors: [] }, actual: result },
      )
    return result.browserErrors?.length
      ? violation(
          `browser diagnostics`,
          result.browserErrors.join(`; `),
          `detached browser errors`,
        )
      : pass
  }
  const knownShared: OnDemandStreamsHistory = {
    coordinate: 17,
    rowCount: 1,
    value: 3,
    kind: `ownership`,
    overlap: `same`,
    failing: `all`,
    retire: `left`,
    changeError: false,
    recover: false,
  }
  const knownHeld: OnDemandStreamsHistory = {
    coordinate: 23,
    rowCount: 1,
    value: 5,
    kind: `settlement`,
    timing: `before-application`,
  }
  const neighbor: OnDemandStreamsHistory = {
    coordinate: 31,
    rowCount: 2,
    value: -2,
    kind: `ownership`,
    overlap: `disjoint`,
    failing: `left`,
    retire: `left`,
    changeError: false,
    recover: false,
  }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A retained failed stream keeps source health unhealthy across sibling query retirement; stream recovery clears every prior failure; successful subset readiness waits for applied rows and cannot conceal a failure received after provider synchronization. Public cleanup, including cleanup from getSubscriptions, leaves no provider stream running for the ended sync run. Name and parameters identify stream demand, one configured priority reaches the provider, empty mappings read cached rows after applied settlement without retaining streams, and mapper throws reject only their request with the authored error while peers and retry remain usable. A distinct completed empty donor releases its resources before a later demand; it authorizes no saved coverage for that different demand. A request signal stays live during getSubscriptions: an abort before acquisition retains no SDK lease; a later abort releases that request's lease, preserves a ready peer, and cannot become success at the next checkpoint.`,
      authority: `docs/collections/powersync-direct-collection.md, On-Demand Sync and Errors; docs/guides/error-handling.md reportError/reportHealthy and Honor the loadSubset signal; docs/reference/type-aliases/LoadSubsetOptions.md live signal lifecycle; packages/db/src/query/live/ARCHITECTURE.md, Source cancellation and applied settlement, requires source rejection of an aborted caller's load after accepted rows apply; glossary logical subset owner, abort, demand retirement, applied settlement and cleanup.`,
      limits: `Two equality demands, at most three streams, one optimistic insert and one outage with optional changed-error identities/recovery, or public cleanup during mapping/after application, equal/distinct numeric parameter tuples, single-stream priority, cached-only mapping or throwing mapper/retry. Cold settlement remains legal. A distinct right equality demand can first confirm an empty baseline and retire publicly, before a judged left demand receives an error behind held application. A separate public snapshot request varies abort before/during/after mapping or no abort beside one ready live-query peer; its mapped cut permits wrapper-delayed rejection, while the next actual checkpoint requires cancellation settlement. One reported stream may witness several failures. ${receivingPath}`,
    },
    histories: {
      arbitrary: onDemandStreamsHistoryArb,
      states: onDemandStreamsStates,
      runs: 60,
      fixedSeeds: [2377],
      constructed,
      fixed: [
        {
          name: `shared failure survives one retirement`,
          history: knownShared,
        },
        {
          name: `failure between provider sync and visible result`,
          history: knownHeld,
        },
        {
          name: `distinct empty donor precedes an applied load failure`,
          history: {
            ...knownHeld,
            timing: `before-application`,
            baseline: `confirmed-empty`,
          },
        },
        { name: `exclusive failure retires with its query`, history: neighbor },
        {
          name: `subscription mapper ends its own source`,
          history: {
            coordinate: 41,
            rowCount: 1,
            value: 2,
            kind: `admission`,
            cleanup: `during-mapping`,
          },
        },
        {
          name: `loaded source cleanup ends its provider stream`,
          history: {
            coordinate: 43,
            rowCount: 2,
            value: -3,
            kind: `admission`,
            cleanup: `after-application`,
          },
        },
        ...([`empty`, `throw`, `priority`] as const).map(
          (operation, index) => ({
            name: `mapper ${operation} preserves its public contract`,
            history: {
              coordinate: 47 + index,
              rowCount: 2,
              value: 4,
              kind: `mapper` as const,
              operation,
            },
          }),
        ),
        ...([`equal`, `distinct`] as const).map((parameterization, index) => ({
          name: `${parameterization} parameters preserve retained peer ownership`,
          history: {
            coordinate: 53 + index,
            rowCount: 1,
            value: 2,
            kind: `ownership` as const,
            overlap:
              parameterization === `equal`
                ? (`same` as const)
                : (`disjoint` as const),
            parameterization,
            failing: `left` as const,
            retire: `left` as const,
            changeError: false,
            recover: false,
          },
        })),
        ...(
          [`before-mapping`, `during-mapping`, `after-mapping`, `none`] as const
        ).map((abort, index) => ({
          name: `snapshot request ${abort} preserves peer ownership`,
          history: {
            coordinate: 61 + index,
            rowCount: 2,
            value: 7,
            kind: `request` as const,
            abort,
          },
        })),
      ],
    },
    model: onDemandStreamsModel,
    driver: drive,
    check,
    calibrations: [
      ...([`unknown`, `missing-connection`] as const).map((fault) => ({
        name: `query rejection cannot hide ${fault} health`,
        law: `on-demand stream ownership and settlement`,
        history: {
          fixed: `distinct empty donor precedes an applied load failure`,
        },
        corrupt: (
          trace: ReadonlyArray<Observation>,
          h: OnDemandStreamsHistory,
        ) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cuts: (entry.value as Result).cuts.map((cut) => {
                      if (cut.name !== `failed-visible-load`) return cut
                      const expected = onDemandStreamsModel(h).find(
                        (wanted) => wanted.name === cut.name,
                      )!
                      return {
                        ...cut,
                        outcomes: {
                          ...cut.outcomes,
                          left: `rejected` as const,
                        },
                        rejections: { left: expected.rejections!.left![0] },
                        problems:
                          fault === `unknown`
                            ? [...cut.problems, { kind: `other` as const }]
                            : cut.problems.filter(
                                (problem) => problem.kind !== `connection`,
                              ),
                      }
                    }),
                  },
                },
          ),
      })),
      ...([`kind`, `stream`, `messages`] as const).map((field) => ({
        name: `initial stream rejection preserves ${field}`,
        law: `on-demand stream ownership and settlement`,
        history: { constructed: `stream-error-before-sync construction 1` },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cuts: (entry.value as Result).cuts.map((cut) =>
                      cut.name === `failed-initial-load`
                        ? {
                            ...cut,
                            rejections: {
                              left:
                                field === `kind`
                                  ? { kind: `other` }
                                  : {
                                      ...cut.rejections?.left,
                                      [field]:
                                        field === `stream`
                                          ? `wrong-stream`
                                          : [],
                                    },
                            },
                          }
                        : cut,
                    ),
                  },
                },
          ),
      })),
      {
        name: `fixture rescue cannot hide a retained SDK stream`,
        law: `on-demand stream ownership and settlement`,
        history: { fixed: `exclusive failure retires with its query` },
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cuts: (entry.value as Result).cuts.map((cut) =>
                      cut.name === `source-cleaned-up`
                        ? {
                            ...cut,
                            providerState: `syncing`,
                            activeStreams: [`leaked-sdk-stream`],
                          }
                        : cut,
                    ),
                  },
                },
          ),
      },
      {
        name: `completed cuts retain secondary cleanup diagnostics`,
        law: `receiving cleanup`,
        history: { fixed: `exclusive failure retires with its query` },
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cleanupErrors: [`injected teardown failure`],
                  },
                },
          ),
      },
      {
        name: `source failure cannot disappear before its query retires`,
        law: `on-demand stream ownership and settlement`,
        history: { fixed: `exclusive failure retires with its query` },
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cleanupErrors: [`secondary injected teardown failure`],
                    cuts: (entry.value as Result).cuts.map((cut) =>
                      cut.name === `failed` ? { ...cut, problems: [] } : cut,
                    ),
                  },
                },
          ),
      },
      ...[
        {
          name: `a retired empty donor cannot retain its SDK stream`,
          fixed: `distinct empty donor precedes an applied load failure`,
          cut: `empty-baseline-retired`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            activeStreams: [`retained-donor`],
          }),
        },
        {
          name: `mapper-aborted request cannot retain an SDK lease`,
          fixed: `snapshot request during-mapping preserves peer ownership`,
          cut: `request-mapped`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            activeStreams: [...(cut.activeStreams ?? []), `leaked-request`],
          }),
        },
        {
          name: `a later checkpoint cannot fulfill a canceled request`,
          fixed: `snapshot request during-mapping preserves peer ownership`,
          cut: `request-checkpoint`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            outcomes: { ...cut.outcomes, right: `fulfilled` },
          }),
        },
        {
          name: `request cancellation cannot crash its ready peer`,
          fixed: `snapshot request after-mapping preserves peer ownership`,
          cut: `request-checkpoint`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            queryStatuses: { ...cut.queryStatuses, left: `crashed` },
          }),
        },
        {
          name: `priority omission changes the forwarded stream`,
          fixed: `mapper priority preserves its public contract`,
          cut: `loaded`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            forwardedSubscriptions: cut.forwardedSubscriptions?.map(
              (stream) => ({ ...stream, priority: undefined }),
            ),
          }),
        },
        {
          name: `cached-only request cannot fulfill before donor application`,
          fixed: `mapper empty preserves its public contract`,
          cut: `empty-receipt-held`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            outcomes: { ...cut.outcomes, right: `fulfilled` },
          }),
        },
        {
          name: `cached-only result cannot reuse older donor values`,
          fixed: `mapper empty preserves its public contract`,
          cut: `empty-cached`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            rowValues: { ...cut.rowValues, right: [-10000] },
          }),
        },
        {
          name: `mapper failure cannot leave a terminal source error`,
          fixed: `mapper throw preserves its public contract`,
          cut: `mapper-rejected`,
          wrong: (cut: StreamCut): StreamCut => ({ ...cut, sourceError: true }),
        },
        {
          name: `mapper failure cannot crash its retained donor query`,
          fixed: `mapper throw preserves its public contract`,
          cut: `mapper-rejected`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            queryStatuses: { ...cut.queryStatuses, left: `crashed` },
          }),
        },
        {
          name: `mapper rejection preserves the authored Error`,
          fixed: `mapper throw preserves its public contract`,
          cut: `mapper-rejected`,
          wrong: (cut: StreamCut): StreamCut => ({
            ...cut,
            rejections: { ...cut.rejections, right: { kind: `other` } },
          }),
        },
      ].map((control) => ({
        name: control.name,
        law: `on-demand stream ownership and settlement`,
        history: { fixed: control.fixed },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as Result),
                    cuts: (entry.value as Result).cuts.map((cut) =>
                      cut.name === control.cut ? control.wrong(cut) : cut,
                    ),
                  },
                },
          ),
      })),
      ...constructed.map((builder) => ({
        name: `${builder.name} cannot omit its required state`,
        law: `constructed builder reach`,
        history: { constructed: builder.name },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.filter(
            (entry) =>
              !(
                entry.checkpoint === `reach` &&
                entry.value === builder.enters[0]
              ),
          ),
      })),
    ],
    timeout: 120_000,
  })
}
