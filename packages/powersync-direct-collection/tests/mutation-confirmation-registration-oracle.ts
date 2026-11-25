/**
 * A receiving campaign for the existing mutation-confirmation owner, through
 * real direct adapter mutation handlers and transactions. The companion grammar
 * explains its axes and the shared check owns expected rows and settlement.
 * The service is controlled; this does not establish live-service behavior.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  checkDirectMutationConfirmation,
  directMutationArbitrary,
  mutationConstructions,
  mutationStates,
  requiredMutationStates,
} from './mutation-confirmation-history-oracle'
import {
  receiveMutationTrace,
  transportMutationTrace,
} from './mutation-confirmation-driver'
import type {
  DirectMutationHistory,
  TransportMutationTrace,
  runDirectMutationConfirmation,
} from './mutation-confirmation-driver'
import type { Observation } from '../../db/tests/oracle-property'

const constructed = mutationConstructions.map(({ name, patch }) => ({
  name,
  enters: requiredMutationStates({
    adapter: `powersync-direct`,
    returned: `void`,
    text: ``,
    responseOrder: `response-first`,
    syncMode: `eager`,
    ...patch,
  }),
  build: (generated: DirectMutationHistory): DirectMutationHistory => ({
    ...generated,
    responseOrder: `response-first`,
    syncMode: `eager`,
    ...patch,
  }),
}))

export function registerMutationConfirmation(
  id: string,
  run: typeof runDirectMutationConfirmation,
  options: { owns: ReadonlyArray<string> },
) {
  oracleProperty({
    id,
    law: {
      statement: `Backend commit precedes explicit checkpoint confirmation. Accepted source writes remain optimistic until the actual handler settles, then publish confirmed rows without an old-row flicker; the handler's own outcome decides its transaction.`,
      authority: `docs/collections/powersync-direct-collection.md#writing-data; packages/db/tests/mutation-confirmation-oracle.ts and optimistic-history-oracle.ts acceptance/settlement law.`,
      limits: `Eager and on-demand modes, one handler, real standalone SDK over controlled NDJSON; direct CRUD and explicit transactions, both checkpoint/response orders. On-demand retains a real live query and its acquisition. No concurrent writers, persistence wrapper or live-service claim. Chromium receives the same production driver separately.`,
    },
    owns: options.owns,
    histories: {
      arbitrary: directMutationArbitrary,
      states: mutationStates,
      runs: 60,
      fixedSeeds: [2377],
      constructed,
    },
    model: requiredMutationStates,
    driver: async (history, observe) => {
      const result = await run(history)
      for (const state of result.reached) observe(`reach`, state)
      observe(`completed`, transportMutationTrace(result))
    },
    check: (history, observations, required) => {
      const trace = observations.find(
        ({ checkpoint }) => checkpoint === `completed`,
      )?.value as TransportMutationTrace | undefined
      if (!trace)
        return violation(
          `completed`,
          `production trace did not complete`,
          `mutation confirmation`,
        )
      const checked = checkDirectMutationConfirmation(
        history,
        receiveMutationTrace(trace),
      )
      if (checked.kind !== `pass`) return checked
      const reached = new Set(
        observations
          .filter(({ checkpoint }) => checkpoint === `reach`)
          .map(({ value }) => value),
      )
      return required.every((state) => reached.has(state))
        ? pass
        : violation(
            `reach`,
            `generated construction omitted a required state`,
            `mutation confirmation`,
          )
    },
    calibrations: [
      ...(
        [
          { cut: `checkpoint-response-received`, builder: 0 },
          { cut: `checkpoint-downloaded`, builder: 1 },
        ] as const
      ).map(({ cut, builder }) => ({
        name: `rejects acknowledgement after only ${cut}`,
        law: `mutation confirmation`,
        history: { constructed: constructed[builder]!.name },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `completed`) return entry
            const original = entry.value as TransportMutationTrace
            return {
              ...entry,
              value: {
                ...original,
                cuts: original.cuts.map((observed) =>
                  observed.cut !== cut
                    ? observed
                    : {
                        ...observed,
                        observation: {
                          ...observed.observation,
                          confirmationStatus: `accepted`,
                        },
                      },
                ),
              },
            }
          }),
      })),
      {
        name: `rejects premature checkpoint acknowledgement`,
        law: `mutation confirmation`,
        history: { constructed: constructed[0]!.name },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `completed`) return entry
            const original = entry.value as TransportMutationTrace
            return {
              ...entry,
              value: {
                ...original,
                cuts: original.cuts.map((cut) =>
                  cut.cut !== `confirmation-requested`
                    ? cut
                    : {
                        ...cut,
                        observation: {
                          ...cut.observation,
                          confirmationStatus: `accepted`,
                        },
                      },
                ),
              },
            }
          }),
      },
      {
        name: `rejects a stale-row publication during confirmed handoff`,
        law: `mutation confirmation`,
        history: { constructed: constructed[0]!.name },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) => {
            if (entry.checkpoint !== `completed`) return entry
            const original = entry.value as TransportMutationTrace
            return {
              ...entry,
              value: {
                ...original,
                publications: [...original.publications, []],
              },
            }
          }),
      },
      ...constructed.flatMap((builder) =>
        builder.enters.map((state) => ({
          name: `${builder.name} rejects missing ${state}`,
          law: `mutation confirmation`,
          history: { constructed: builder.name },
          corrupt: (trace: ReadonlyArray<Observation>) =>
            trace.filter(
              (entry) =>
                !(entry.checkpoint === `reach` && entry.value === state),
            ),
        })),
      ),
    ],
    timeout: 120000,
  })
}
