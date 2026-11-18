/** Node receiving campaign for the companion cancellation projection. */
import { oracleProperty, violation } from '../../db/tests/oracle-property'
import {
  cancellationArbitrary,
  cancellationConstructions,
  checkMutationCancellation,
} from './mutation-confirmation-cancellation-oracle'
import {
  receiveMutationTrace,
  transportMutationTrace,
} from './mutation-confirmation-driver'
import type {
  TransportMutationTrace,
  runDirectMutationConfirmation,
} from './mutation-confirmation-driver'
import type { Observation } from '../../db/tests/oracle-property'

export function registerMutationCancellation(
  id: string,
  run: typeof runDirectMutationConfirmation,
  options: { owns: ReadonlyArray<string> },
) {
  oracleProperty({
    id,
    law: {
      statement: `An aborted confirmation wait rejects its actual mutation handler, does not confirm the backend write, and preserves either the unconfirmed base or cleanup's cleared rows.`,
      authority: `ConfirmWritesOptions.signal; PowerSyncClient.confirmWrites; Collection cleanup and optimistic handler-outcome contracts.`,
      limits: `One pending real SDK checkpoint wait, controlled source checkpoint, explicit signal cancellation or Collection cleanup; no concurrent writer or restarted-run claim.`,
    },
    owns: options.owns,
    histories: {
      arbitrary: cancellationArbitrary,
      states: [
        `entry:handler`,
        `entry:transaction`,
        `cancel:signal`,
        `cancel:cleanup`,
        `mode:eager`,
        `mode:on-demand`,
        ...cancellationConstructions.map((builder) => builder.enters[3]!),
      ],
      measured: [
        `operation:insert`,
        `operation:update`,
        `operation:delete`,
        `requested-after-backend`,
      ],
      constructed: cancellationConstructions,
      runs: 30,
      fixedSeeds: [2377],
    },
    model: (history) => [
      `entry:${history.entry}`,
      `cancel:${history.cancel}`,
      `mode:${history.syncMode}`,
      `cancel-path:${history.syncMode}:${history.cancel}:${history.entry}`,
    ],
    driver: async (history, observe) => {
      const trace = await run(history)
      for (const state of trace.reached) observe(`reach`, state)
      observe(`completed`, transportMutationTrace(trace))
    },
    check: (history, observations, required) => {
      const transported = observations.find(
        ({ checkpoint }) => checkpoint === `completed`,
      )?.value as TransportMutationTrace | undefined
      if (!transported)
        return violation(
          `completed`,
          `cancellation trace missing`,
          `mutation cancellation`,
        )
      const trace = receiveMutationTrace(transported)
      const reached = new Set(
        observations
          .filter(({ checkpoint }) => checkpoint === `reach`)
          .map(({ value }) => value),
      )
      if (!required.every((state) => reached.has(state)))
        return violation(
          `reach`,
          `constructed cancellation state missing`,
          `mutation cancellation`,
        )
      return checkMutationCancellation(history, trace)
    },
    calibrations: [
      {
        name: `rejects acknowledgement after cancellation`,
        law: `mutation cancellation`,
        history: { constructed: cancellationConstructions[0]!.name },
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint === `completed`
              ? {
                  ...entry,
                  value: {
                    ...(entry.value as TransportMutationTrace),
                    cancellation: {
                      confirmation: true,
                      rejectionName: `AbortError`,
                    },
                  },
                }
              : entry,
          ),
      },
      ...cancellationConstructions.flatMap((builder) =>
        builder.enters.map((state) => ({
          name: `${builder.name} rejects missing ${state}`,
          law: `mutation cancellation`,
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
