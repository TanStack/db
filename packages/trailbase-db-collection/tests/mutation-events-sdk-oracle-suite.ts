/** The same two-obligation model judges fixed and generated real SDK histories. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  constructMutationEvent,
  mutationEventHistoryArb,
  mutationEventModel,
  mutationEventStates,
  mutationEventViolations,
} from './mutation-events-sdk-oracle'
import type { Observation } from '../../db/tests/oracle-property'
import type {
  MutationEventHistory,
  MutationEventResult,
  MutationEventState,
} from './mutation-events-sdk-oracle'

export function registerMutationEventConformance(
  property: string,
  receive: (
    history: MutationEventHistory,
    lateCleanupFailure?: boolean,
    awaitOwnAppliedReceipt?: boolean,
  ) => Promise<MutationEventResult>,
  { owns }: { owns: ReadonlyArray<string> },
) {
  const required = new WeakMap<MutationEventHistory, MutationEventState>()
  const constructed = mutationEventStates.flatMap((state) =>
    Array.from({ length: 5 }, (_, index) => ({
      name: `${state} construction ${index + 1}`,
      enters: [state],
      build: (h: MutationEventHistory) => {
        const built = constructMutationEvent(h, state)
        required.set(built, state)
        return built
      },
    })),
  )
  const drive =
    (lateCleanupFailure = false, awaitOwnAppliedReceipt = false) =>
    async (
      h: MutationEventHistory,
      observe: (cut: string, value: unknown) => void,
    ) => {
      const result = await receive(
        h,
        lateCleanupFailure,
        awaitOwnAppliedReceipt,
      )
      for (const state of result.reached) observe(`reach`, state)
      observe(`result`, result)
    }
  oracleProperty({
    id: property,
    owns,
    law: {
      statement: `A built-in TrailBase mutation fulfills only after its backend response and a new source event arrive. Missing confirmation rejects promptly once HTTP is available and its source has stopped. Graceful EOF drains buffered valid events first. Accepted proof survives closure, cleanup/restart and a delayed HTTP response across the retention window; a retired request cannot adopt a replacement run's event. The handler never waits for its own applied receipt.`,
      authority: `docs/collections/trailbase-collection.md Mutation Handlers; tests/ORACLE.md mutation event round-trip; optimistic-history-oracle.ts acceptance/settlement law; explicit user decision 2026-11-24 N11: reject promptly when confirmation is impossible and preserve already-established proof.`,
      limits: `One CRUD mutation, eager/on-demand, old same-key event or none, either response/event order, optional untouched peer, or a public change callback starting the one handler while an older same-key event publishes, installed SDK with controlled HTTP/full SSE frames. EOF/error before request or while a confirmation wait is registered; EOF after buffered valid input; one explicit cleanup/restart while HTTP is held; or clock advancement through the existing retention window with actual prune callbacks invoked if present. Production's 120s confirmation callback is controlled after the promptness cut. No concurrent handlers, live service, persistence, in-flight HTTP cancellation or backend rollback promise.`,
    },
    histories: {
      arbitrary: mutationEventHistoryArb,
      states: mutationEventStates,
      constructed,
      runs: 60,
      fixedSeeds: [2377],
      fixed: [
        {
          name: `an older event cannot confirm the update its publication starts`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: false,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            reentrantEntry: true,
          },
        },
        {
          name: `healthy missing event retains its confirmation deadline`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            missingEvent: true,
          },
        },
        {
          name: `registered confirmation rejects on stream EOF`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: `pending-confirmation`,
            endKind: `eof`,
          },
        },
        {
          name: `buffered final event confirms before EOF`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: false,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: `buffered-event`,
            endKind: `eof`,
          },
        },
        {
          name: `old handler cannot borrow a replacement event`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `event`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: `retired-unconfirmed`,
          },
        },
        {
          name: `accepted old proof survives cleanup and later HTTP`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `event`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: `retired-confirmed`,
          },
        },
        {
          name: `accepted proof survives a delayed HTTP response`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `event`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            proofExpiry: true,
          },
        },
        {
          name: `closed stream cannot reuse a prior update`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: `before-request`,
          },
        },
        {
          name: `old update event cannot confirm a later update`,
          history: {
            operation: `update`,
            mode: `eager`,
            first: `response`,
            previousEvent: true,
            clockMode: `fixed`,
            peer: true,
            coordinate: 7,
            streamEnd: undefined,
          },
        },
      ],
    },
    model: mutationEventModel,
    driver: drive(),
    check: (h, trace, expected) => {
      const needed = required.get(h)
      if (
        needed &&
        !trace.some(
          (entry) => entry.checkpoint === `reach` && entry.value === needed,
        )
      )
        return violation(
          `reach`,
          `Missing ${needed}`,
          `constructed builder reach`,
        )
      const result = trace.find((entry) => entry.checkpoint === `result`)
        ?.value as MutationEventResult | undefined
      if (!result)
        return violation(
          `result`,
          `Missing mutation observation`,
          `fresh mutation confirmation`,
        )
      const failures = mutationEventViolations(expected, result.cuts)
      const retired = h.streamEnd?.startsWith(`retired-`) === true
      if (
        result.lifecycle.status !== `ready` ||
        result.lifecycle.stopped !== (!!h.streamEnd && !retired) ||
        result.lifecycle.subscriptions !== (retired ? 2 : 1)
      )
        failures.push(`source lifecycle changed or resubscribed`)
      if (result.timerLeaksAtCuts.length)
        failures.push(`settled handler retained a confirmation timer`)
      if (
        retired &&
        (result.replacementReadiness?.source !== `fulfilled` ||
          (h.mode === `on-demand` &&
            result.replacementReadiness.query !== `fulfilled`))
      )
        failures.push(
          `replacement preload did not fulfill after old handler settlement`,
        )
      if (failures.length)
        return violation(
          `result`,
          failures.join(`; `),
          `fresh mutation confirmation`,
          { expected, actual: result },
        )
      if (result.cleanupErrors?.length || result.browserErrors?.length)
        return violation(
          `result`,
          `Receiving cleanup failed`,
          `mutation cleanup`,
          { expected: [], actual: result },
        )
      return pass
    },
    calibrations: [
      {
        name: `terminal confirmation cannot wait for its old deadline`,
        history: { constructed: `terminal-stream-waiting construction 1` },
        law: `fresh mutation confirmation`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as MutationEventResult),
                    cuts: (entry.value as MutationEventResult).cuts.map(
                      (cut) =>
                        cut.name === `response-without-confirmation`
                          ? {
                              ...cut,
                              rows: (
                                entry.value as MutationEventResult
                              ).cuts.find(
                                (item) => item.name === `first-obligation`,
                              )!.rows,
                              settlement: `pending`,
                              handlerSettlement: `pending`,
                              state: `persisting`,
                            }
                          : cut,
                    ),
                  },
                },
          ),
      },
      {
        name: `terminal source cannot confirm from an old event`,
        history: { constructed: `terminal-stream-unconfirmed construction 1` },
        law: `fresh mutation confirmation`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as MutationEventResult),
                    cuts: (entry.value as MutationEventResult).cuts.map(
                      (cut) =>
                        cut.name === `response-without-confirmation`
                          ? {
                              ...cut,
                              settlement: `fulfilled`,
                              state: `completed`,
                            }
                          : cut,
                    ),
                  },
                },
          ),
      },
      {
        name: `one obligation cannot settle a fresh mutation`,
        history: { constructed: `fresh-event-response-first construction 1` },
        law: `fresh mutation confirmation`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as { cuts: Array<unknown> }),
                    cuts: (entry.value as MutationEventResult).cuts.map(
                      (cut) =>
                        cut.name === `first-obligation`
                          ? {
                              ...cut,
                              settlement: `fulfilled`,
                              state: `completed`,
                            }
                          : cut,
                    ),
                  },
                },
          ),
      },
      {
        name: `own applied receipt cannot hold its handler forever`,
        history: { constructed: `fresh-event-response-first construction 1` },
        driver: drive(false, true),
        law: `fresh mutation confirmation`,
      },
      {
        name: `late teardown failure remains visible`,
        history: { constructed: `fresh-event-response-first construction 1` },
        driver: drive(true),
        law: `mutation cleanup`,
      },
      {
        name: `late teardown cannot replace a semantic mismatch`,
        history: { constructed: `fresh-event-response-first construction 1` },
        driver: drive(true),
        law: `fresh mutation confirmation`,
        corrupt: (trace) =>
          trace.map((entry) =>
            entry.checkpoint !== `result`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as MutationEventResult),
                    cuts: (entry.value as MutationEventResult).cuts.map(
                      (cut) =>
                        cut.name === `first-obligation`
                          ? {
                              ...cut,
                              settlement: `fulfilled`,
                              state: `completed`,
                            }
                          : cut,
                    ),
                  },
                },
          ),
      },
      ...constructed.map((builder) => ({
        name: `${builder.name} cannot omit its state`,
        history: { constructed: builder.name },
        law: `constructed builder reach`,
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
