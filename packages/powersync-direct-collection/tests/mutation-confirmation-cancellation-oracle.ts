/**
 * Canceling a pending confirmation rejects the waiting handler, rather than
 * acknowledging its backend write. Public ConfirmWritesOptions.signal owns
 * signal cancellation; stopping the sync run ends its pending SDK waits.
 * This projection keeps requested confirmation distinct from accepted source
 * data. The source checkpoint is held, so abort leaves the original base;
 * cleanup additionally clears Collection rows. One handler and its untouched
 * peer are modeled, without concurrent writers or a restart claim.
 */
import { fc } from '@fast-check/vitest'
import {
  checkMutationConfirmation,
  mutationConfirmationRows,
} from '../../db/tests/mutation-confirmation-oracle'
import { pass, violation } from '../../db/tests/oracle-property'
import { directMutationArbitrary } from './mutation-confirmation-history-oracle'
import { directMutationInputs } from './mutation-confirmation-driver'
import type {
  DirectMutationHistory,
  DirectMutationTrace,
} from './mutation-confirmation-driver'

export const cancellationArbitrary = fc
  .tuple(
    directMutationArbitrary,
    fc.constantFrom(`signal` as const, `cleanup` as const),
  )
  .map(
    ([history, cancel]): DirectMutationHistory => ({
      ...history,
      outcome: `fulfilled`,
      confirmation: `checkpoint`,
      cancel,
    }),
    (value) => {
      const history = value as DirectMutationHistory
      const { cancel, ...original } = history
      return [original, cancel!]
    },
  )

export const cancellationConstructions = (
  [`eager`, `on-demand`] as const
).flatMap((syncMode) =>
  ([`signal`, `cleanup`] as const).flatMap((cancel) =>
    ([`handler`, `transaction`] as const).map((entry) => ({
      name: `${syncMode} ${cancel} cancellation through ${entry}`,
      enters: [
        `cancel:${cancel}`,
        `entry:${entry}`,
        `mode:${syncMode}`,
        `cancel-path:${syncMode}:${cancel}:${entry}`,
      ],
      build: (generated: DirectMutationHistory): DirectMutationHistory => ({
        ...generated,
        cancel,
        entry,
        syncMode,
        outcome: `fulfilled`,
        confirmation: `checkpoint`,
      }),
    })),
  ),
)

export function checkMutationCancellation(
  history: DirectMutationHistory,
  trace: DirectMutationTrace,
) {
  const pending = trace.cuts.find(
    ({ cut }) => cut === `checkpoint-response-received`,
  )
  if (!pending)
    return violation(
      `cancellation`,
      `response-received/source-held cut missing`,
      `mutation cancellation`,
    )
  try {
    checkMutationConfirmation(
      history,
      `confirmation-requested`,
      pending.observation,
      trace.failure,
      directMutationInputs(history.text),
    )
  } catch (error) {
    return violation(
      `checkpoint-response-received`,
      String(error),
      `mutation cancellation`,
    )
  }
  if (trace.browserErrors?.length)
    return violation(
      `browser`,
      trace.browserErrors.join(`; `),
      `mutation cancellation`,
    )
  const terminal = trace.cuts.filter(
    ({ cut }) => cut === `settlement-waiter` || cut === `settled`,
  )
  if (
    terminal.length !== 2 ||
    !trace.cuts.some(({ cut }) => cut === `confirmation-requested`)
  )
    return violation(
      `cancellation`,
      `requested or terminal cut missing`,
      `mutation cancellation`,
    )
  if (
    trace.cancellation?.confirmation !== false ||
    trace.cancellation.rejectionName !== `AbortError`
  )
    return violation(
      `cancellation`,
      `cancelled wait acknowledged or lost its AbortError`,
      `mutation cancellation`,
    )
  const expectedRows =
    history.cancel === `cleanup`
      ? []
      : mutationConfirmationRows(
          history.operation,
          `initial`,
          history.peer,
          directMutationInputs(history.text),
        )
  for (const { observation } of terminal) {
    const observed = {
      rows: observation.rows,
      state: observation.state,
      settlement: observation.settlement,
      handlerWrites: observation.handlerWrites,
      confirmationCalls: observation.confirmationCalls,
      providerRequests: observation.providerRequests,
      confirmationStatus: observation.confirmationStatus,
    }
    const expected = {
      rows: expectedRows,
      state: `failed`,
      settlement: `rejected`,
      handlerWrites: 1,
      confirmationCalls: 1,
      providerRequests: 1,
      confirmationStatus: `pending`,
    }
    if (
      JSON.stringify(observed) !== JSON.stringify(expected) ||
      (history.cancel === `signal` && observation.error !== trace.failure)
    )
      return violation(
        `cancellation`,
        `cancelled handler changed rows, success, request count or exact abort reason`,
        `mutation cancellation`,
      )
  }
  const required = [
    `entry:${history.entry}`,
    `cancel:${history.cancel}`,
    `mode:${history.syncMode}`,
    `cancel-path:${history.syncMode}:${history.cancel}:${history.entry}`,
  ]
  return required.every((state) => trace.reached.includes(state))
    ? pass
    : violation(
        `reach`,
        `cancellation path was not reached`,
        `mutation cancellation`,
      )
}
