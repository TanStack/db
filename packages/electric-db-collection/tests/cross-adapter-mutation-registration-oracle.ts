/**
 * The existing shared mutation-confirmation model judges each public cut from
 * the installed Electric SDK path. Its complete finite Electric grammar varies
 * CRUD, peer presence, handler outcome, discarded legacy return and explicit
 * txid confirmation. No second expected-result computation lives here.
 */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import {
  checkMutationConfirmation,
  mutationConfirmationHistories,
} from '../../db/tests/mutation-confirmation-oracle'
import {
  electricMutationInputs,
  receiveElectricMutation,
  transportElectricMutation,
} from './cross-adapter-mutation-driver'
import type {
  ElectricMutationTrace,
  ElectricMutationTransport,
  observeElectricMutation,
} from './cross-adapter-mutation-driver'
import type { Observation } from '../../db/tests/oracle-property'

export function registerElectricMutation(
  property: string,
  run: typeof observeElectricMutation,
) {
  const histories = mutationConfirmationHistories(`electric`)
  const check = (
    history: (typeof histories)[number],
    trace: ElectricMutationTrace,
  ) => {
    try {
      for (const { cut, observation } of trace.cuts)
        checkMutationConfirmation(
          history,
          cut,
          observation,
          trace.failure,
          electricMutationInputs,
        )
      // Every schedule records entered and settled; confirmation and late cuts
      // are required by authored actions, never by the actual returned rows.
      const required = [
        `entered`,
        `settled`,
        ...(history.outcome !== `reject-before-write`
          ? [
              `server-written`,
              ...(history.confirmation === `txid`
                ? [`confirmation-requested`, `confirmation-accepted`]
                : [`late-confirmed`]),
            ]
          : []),
      ]
      if (
        !required.every((cut) => trace.cuts.some((entry) => entry.cut === cut))
      )
        return violation(
          `cuts`,
          `Missing promised public observation cut`,
          `mutation confirmation`,
        )
    } catch (error) {
      return violation(`mutation cut`, String(error), `mutation confirmation`)
    }
    if (trace.cleanupErrors?.length)
      return violation(
        `receiving cleanup`,
        trace.cleanupErrors.join(`; `),
        `receiving cleanup`,
      )
    // The promised public cuts stay primary if later receiving work also fails.
    if (trace.receivingErrors?.length)
      return violation(
        `receiving errors`,
        trace.receivingErrors.join(`; `),
        `receiving errors`,
      )
    return pass
  }
  oracleProperty({
    id: property,
    owns: [`src/electric.ts#electricCollectionOptions`],
    law: {
      statement: `A handler's promise decides its transaction outcome. Discarded returns start no confirmation. Explicit awaitTxId waits for accepted source writes; those writes publish when optimistic state drops, including after handler rejection.`,
      authority: `packages/db/tests/mutation-confirmation-oracle.ts; optimistic-history-oracle.ts acceptance/settlement law; docs/collections/electric-collection.md#mutation-handlers.`,
      limits: `The shared finite Electric grammar, numeric keys 1 and 2, one handler and one source txid. Installed ShapeStream over controlled HTTP in Node and Chromium; no real Electric server, persistence, concurrent handlers or publication event batches.`,
    },
    histories: {
      enumerated: histories,
      states: [
        `operation:insert`,
        `operation:update`,
        `operation:delete`,
        `outcome:fulfilled`,
        `outcome:reject-before-write`,
        `outcome:reject-after-write`,
        `txid-confirmation`,
        `late-confirmation`,
      ],
    },
    label: (h) =>
      `${h.operation}/${h.peer}/${h.confirmation}/${h.outcome}/${h.returned}`,
    model: (h) => h,
    driver: async (history, observe) => {
      const trace = await run(history)
      for (const state of trace.reached) observe(`reach`, state)
      observe(`completed`, transportElectricMutation(trace))
    },
    check: (history, observations) => {
      const result = observations.find(
        (entry) => entry.checkpoint === `completed`,
      )?.value as ElectricMutationTransport | undefined
      return result
        ? check(history, receiveElectricMutation(result))
        : violation(
            `completed`,
            `Missing receiving trace`,
            `mutation confirmation`,
          )
    },
    calibrations: [
      ...([`cleanup-only`, `mismatch-and-cleanup`] as const).map((fault) => ({
        name: `actual ${fault} preserves completed mutation cuts`,
        history: { enumerated: 0 },
        law:
          fault === `cleanup-only`
            ? `receiving cleanup`
            : `mutation confirmation`,
        driver: async (
          history: (typeof histories)[number],
          observe: (checkpoint: string, value: unknown) => void,
        ) => {
          const trace = await run(history, fault)
          for (const state of trace.reached) observe(`reach`, state)
          observe(`completed`, transportElectricMutation(trace))
        },
      })),
      ...[false, true].map((receivingError) => ({
        name: receivingError
          ? `product field mismatch precedes detached receiving errors`
          : `rejects an extra application field`,
        history: { enumerated: 0 },
        law: `mutation confirmation`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `completed`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as ElectricMutationTransport),
                    ...(receivingError
                      ? { receivingErrors: [`secondary detached rejection`] }
                      : {}),
                    cuts: (entry.value as ElectricMutationTransport).cuts.map(
                      (record) => ({
                        ...record,
                        observation: {
                          ...record.observation,
                          rows: record.observation.rows.map((row) => ({
                            ...row,
                            unexpectedApplicationField: `leaked`,
                          })),
                        },
                      }),
                    ),
                  },
                },
          ),
      })),
      {
        name: `rejects detached receiving errors after correct product cuts`,
        history: { enumerated: 0 },
        law: `receiving errors`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `completed`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as ElectricMutationTransport),
                    receivingErrors: [`detached rejection`],
                  },
                },
          ),
      },
      {
        name: `rejects extra refresh work from discarded legacy return`,
        history: {
          enumerated: histories.findIndex((h) => h.returned === `legacy-txid`),
        },
        law: `mutation confirmation`,
        corrupt: (trace: ReadonlyArray<Observation>) =>
          trace.map((entry) =>
            entry.checkpoint !== `completed`
              ? entry
              : {
                  ...entry,
                  value: {
                    ...(entry.value as ElectricMutationTransport),
                    cuts: (entry.value as ElectricMutationTransport).cuts.map(
                      (record) => ({
                        ...record,
                        observation: {
                          ...record.observation,
                          providerRequests:
                            record.observation.providerRequests + 1,
                        },
                      }),
                    ),
                  },
                },
          ),
      },
    ],
  })
}
