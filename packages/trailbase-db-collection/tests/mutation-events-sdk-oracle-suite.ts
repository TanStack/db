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
      statement: `A built-in TrailBase mutation keeps optimistic state until both its backend response and a new source event have arrived; an older same-key event confirms no later mutation. Accepted source rows apply at transaction settlement.`,
      authority: `docs/collections/trailbase-collection.md Mutation Handlers; tests/ORACLE.md mutation event round-trip; optimistic-history-oracle.ts acceptance/settlement law.`,
      limits: `One CRUD mutation, eager/on-demand, old same-key event or none, either response/event order, optional untouched peer, installed SDK with controlled HTTP/full SSE frames. No concurrent mutations, live service, persistence, deadlines or cancellation contract.`,
    },
    histories: {
      arbitrary: mutationEventHistoryArb,
      states: mutationEventStates,
      constructed,
      runs: 60,
      fixedSeeds: [2377],
      fixed: [
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
