/**
 * Direct checkpoint confirmation receives the existing mutation-confirmation
 * law. Backend commit, checkpoint POST, SDK delivery and handler settlement
 * are distinct cuts. Keys have fixed roles; generated text varies whole row
 * values. A peer makes omission visible. CRUD, the actual Collection handlers
 * and explicit transactions all enter the same independent shared judgment.
 *
 * A rejected-before-write handler cannot request confirmation. Other handlers
 * may settle without it, fulfill after it, or reject after accepted source
 * writes. The two response orders distinguish an already downloaded checkpoint
 * from a later one. This grammar excludes concurrent handlers and malformed
 * protocol frames. Node and Chromium use the same production trace and check.
 */
import { fc } from '@fast-check/vitest'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
} from '../../db/tests/mutation-confirmation-oracle'
import { pass, violation } from '../../db/tests/oracle-property'
import { directMutationInputs } from './mutation-confirmation-driver'
import type {
  DirectMutationCut,
  DirectMutationHistory,
  DirectMutationTrace,
} from './mutation-confirmation-driver'
import type { MutationConfirmationCut } from '../../db/tests/mutation-confirmation-oracle'

export const directMutationArbitrary = fc
  .record({
    syncMode: fc.constantFrom(`eager` as const, `on-demand` as const),
    operation: fc.constantFrom(
      `insert` as const,
      `update` as const,
      `delete` as const,
    ),
    outcome: fc.constantFrom(
      `fulfilled` as const,
      `reject-before-write` as const,
      `reject-after-write` as const,
    ),
    peer: fc.boolean(),
    confirmation: fc.constantFrom(`none` as const, `checkpoint` as const),
    entry: fc.constantFrom(`handler` as const, `transaction` as const),
    responseOrder: fc.constantFrom(
      `response-first` as const,
      `checkpoint-first` as const,
    ),
    text: fc.string({ maxLength: 8 }),
  })
  .map(
    (history): DirectMutationHistory => ({
      ...history,
      adapter: `powersync-direct`,
      returned: `void`,
      confirmation:
        history.outcome === `reject-before-write`
          ? `none`
          : history.confirmation,
    }),
    (value) => {
      const history = value as DirectMutationHistory
      return {
        operation: history.operation,
        outcome: history.outcome,
        peer: history.peer,
        confirmation: history.confirmation,
        entry: history.entry,
        responseOrder: history.responseOrder,
        text: history.text,
        syncMode: history.syncMode,
      }
    },
  )

export const mutationStates = [
  `mode:eager`,
  `mode:on-demand`,
  `entry:handler`,
  `entry:transaction`,
  `operation:insert`,
  `operation:update`,
  `operation:delete`,
  `outcome:fulfilled`,
  `outcome:reject-before-write`,
  `outcome:reject-after-write`,
  `requested-after-backend`,
  `order:response-first`,
  `order:checkpoint-first`,
  `late-confirmation`,
  `pending:checkpoint-downloaded`,
  `pending:checkpoint-response-received`,
  ...([`eager`, `on-demand`] as const).flatMap((mode) =>
    ([`insert`, `update`, `delete`] as const).flatMap((operation) =>
      ([`handler`, `transaction`] as const).map(
        (entry) => `path:${mode}:${operation}:${entry}`,
      ),
    ),
  ),
] as const

/** Randomized prefixes preserve the grammar and force each public path. */
export const mutationConstructions = [
  {
    name: `insert handler confirms after response`,
    patch: {
      operation: `insert`,
      outcome: `fulfilled`,
      entry: `handler`,
      confirmation: `checkpoint`,
      responseOrder: `response-first`,
      peer: true,
    },
  },
  {
    name: `update transaction rejects after downloaded confirmation`,
    patch: {
      operation: `update`,
      outcome: `reject-after-write`,
      entry: `transaction`,
      confirmation: `checkpoint`,
      responseOrder: `checkpoint-first`,
      peer: true,
    },
  },
  {
    name: `delete handler rejects before backend`,
    patch: {
      operation: `delete`,
      outcome: `reject-before-write`,
      entry: `handler`,
      confirmation: `none`,
      peer: true,
    },
  },
  {
    name: `delete transaction accepts late source data`,
    patch: {
      operation: `delete`,
      outcome: `fulfilled`,
      entry: `transaction`,
      confirmation: `none`,
      peer: true,
    },
  },
  ...([`eager`, `on-demand`] as const).flatMap((syncMode) =>
    ([`insert`, `update`, `delete`] as const).flatMap((operation) =>
      ([`handler`, `transaction`] as const).map((entry) => ({
        name: `confirmed ${syncMode} ${operation} through ${entry}`,
        patch: {
          syncMode,
          operation,
          entry,
          outcome: `fulfilled` as const,
          confirmation: `checkpoint` as const,
          peer: true,
        },
      })),
    ),
  ),
] as const

export function requiredMutationStates(
  history: DirectMutationHistory,
): Array<string> {
  return [
    `entry:${history.entry}`,
    `operation:${history.operation}`,
    `outcome:${history.outcome}`,
    `mode:${history.syncMode}`,
    `path:${history.syncMode}:${history.operation}:${history.entry}`,
    ...(history.confirmation === `checkpoint`
      ? [
          `requested-after-backend`,
          `order:${history.responseOrder}`,
          history.responseOrder === `checkpoint-first`
            ? `pending:checkpoint-downloaded`
            : `pending:checkpoint-response-received`,
        ]
      : history.outcome === `reject-before-write`
        ? []
        : [`late-confirmation`]),
  ]
}

export function mutationCuts(
  history: DirectMutationHistory,
): Array<DirectMutationCut> {
  return [
    `entered`,
    ...(history.outcome === `reject-before-write`
      ? []
      : [
          `server-written` as const,
          ...(history.confirmation === `checkpoint`
            ? [
                `confirmation-requested` as const,
                history.responseOrder === `checkpoint-first`
                  ? (`checkpoint-downloaded` as const)
                  : (`checkpoint-response-received` as const),
                `confirmation-accepted` as const,
              ]
            : []),
        ]),
    `settlement-waiter`,
    `settled`,
    ...(history.outcome !== `reject-before-write` &&
    history.confirmation === `none`
      ? [`late-confirmed` as const]
      : []),
  ]
}

/**
 * The shared model predicts held optimistic rows and the exact settlement
 * result independently of provider state. Every publication during a confirmed
 * handoff may show optimistic or confirmed rows; the old synced row between
 * them would violate the adapter's documented absence of flicker.
 */
export function checkDirectMutationConfirmation(
  history: DirectMutationHistory,
  trace: DirectMutationTrace,
) {
  const inputs = directMutationInputs(history.text)
  const expectedCuts = mutationCuts(history)
  if (
    JSON.stringify(trace.cuts.map(({ cut }) => cut)) !==
    JSON.stringify(expectedCuts)
  )
    return violation(
      `cuts`,
      `missing, repeated or reordered public checkpoint`,
      `mutation confirmation`,
    )
  try {
    for (const { cut, observation } of trace.cuts)
      checkMutationConfirmation(
        history,
        cut === `settlement-waiter`
          ? `settled`
          : cut === `checkpoint-downloaded` ||
              cut === `checkpoint-response-received`
            ? `confirmation-requested`
            : cut,
        observation,
        trace.failure,
        inputs,
      )
  } catch (error) {
    return violation(`shared judgment`, String(error), `mutation confirmation`)
  }
  if (history.confirmation === `checkpoint`) {
    const allowed = [`entered`, `settled`].map((cut) =>
      JSON.stringify(
        expectedMutationConfirmation(
          history,
          cut as MutationConfirmationCut,
          trace.failure,
          inputs,
        ).rows,
      ),
    )
    for (const rows of trace.publications)
      if (!allowed.includes(JSON.stringify(rows)))
        return violation(
          `publication`,
          `confirmed handoff exposed a third row snapshot`,
          `mutation confirmation`,
        )
  }
  const reached = new Set(trace.reached)
  if (trace.browserErrors?.length)
    return violation(
      `browser`,
      trace.browserErrors.join(`; `),
      `mutation confirmation`,
    )
  const missing = requiredMutationStates(history).filter(
    (state) => !reached.has(state),
  )
  return missing.length
    ? violation(
        `reach`,
        `missing generated states: ${missing.join(`, `)}`,
        `mutation confirmation`,
      )
    : pass
}
