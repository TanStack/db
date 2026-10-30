import { expect } from 'vitest'
import { declareOracle } from './oracle-declaration.js'

/**
 * A handler's Promise decides its transaction outcome. Its discarded return
 * value decides neither outcome nor confirmation (maintainer decision for the
 * first RC). Query starts no refetch when that Promise settles. An explicit
 * confirmation is independent of success: accepted source writes apply when
 * optimistic state drops, even if the handler rejects afterward.
 *
 * Authority: optimistic-history-oracle.ts's acceptance/settlement law and the
 * approved explicit-confirmation adapter contract. This small projection models
 * one handler, one edited key, and one untouched peer. `server-written`
 * represents the backend ledger write; its response delivery is outside this
 * projection. Source acceptance and transaction settlement stay separate. It
 * judges ordinary rows, handler work,
 * transaction state, and the public settlement Promise. It does not judge row
 * attribution, publication batches, provider framing, or concurrent handlers.
 */
export type MutationConfirmationRow = {
  id: number
  name: string
  stable: string
}
export type MutationOperation = `insert` | `update` | `delete`
export type HandlerEnding =
  | {
      outcome: `fulfilled`
      returned: `void` | `legacy-disable` | `legacy-enable` | `legacy-txid`
    }
  | { outcome: `reject-before-write` | `reject-after-write`; returned: `void` }
export type MutationConfirmationHistory = HandlerEnding & {
  adapter: `query` | `electric`
  operation: MutationOperation
  peer: boolean
  confirmation: `none` | `refetch` | `write` | `txid`
  // A collaborator can commit its write and reject before returning to the
  // handler. Its authored outcome then makes confirmation unreachable. The
  // default preserves the original histories: their rejection follows ack.
  confirmationEntry?: `reached` | `unreachable`
}
export type MutationConfirmationCut =
  | `entered`
  | `server-written`
  | `confirmation-requested`
  | `confirmation-accepted`
  | `settled`
  | `late-confirmed`
export type MutationConfirmationObservation<
  Row extends object = MutationConfirmationRow,
> = {
  rows: Array<Row>
  handlerWrites: number
  confirmationCalls: number
  fetches: number
  providerRequests: number
  confirmationStatus: `not-requested` | `pending` | `accepted`
  state: string
  settlement: `pending` | `fulfilled` | `rejected`
  error: unknown
}

// The peer and the untouched scalar make row omission and partial replacement
// observable. Expected rows are rebuilt from these inputs, never from production.
export const mutationConfirmationInputs = {
  peer: { id: 2, name: `peer`, stable: `stable-2` },
  before: { id: 1, name: `before`, stable: `stable-1` },
  optimistic: { id: 1, name: `optimistic`, stable: `stable-1` },
  confirmed: { id: 1, name: `confirmed`, stable: `server-1` },
} as const

/** Complete authored rows are inputs, not a projection of production output. */
export type MutationConfirmationInputs<Row extends object> = {
  peer: Row
  before: Row
  optimistic: Row
  confirmed: Row
}

export function mutationConfirmationRows(
  operation: MutationOperation,
  version: `initial` | `optimistic` | `confirmed`,
  includePeer?: boolean,
): Array<MutationConfirmationRow>
export function mutationConfirmationRows<Row extends object>(
  operation: MutationOperation,
  version: `initial` | `optimistic` | `confirmed`,
  includePeer: boolean,
  inputs: MutationConfirmationInputs<Row>,
): Array<Row>
export function mutationConfirmationRows(
  operation: MutationOperation,
  version: `initial` | `optimistic` | `confirmed`,
  includePeer = true,
  inputs: MutationConfirmationInputs<object> = mutationConfirmationInputs,
): Array<object> {
  const { peer, before, optimistic, confirmed } = inputs
  const rows: Array<object> = []
  if (version === `initial` && operation !== `insert`) rows.push({ ...before })
  if (version !== `initial` && operation !== `delete`)
    rows.push({ ...(version === `optimistic` ? optimistic : confirmed) })
  if (includePeer) rows.push({ ...peer })
  // Edited row then peer is the comparison's canonical role order. It is not
  // a promise about Collection iteration, and keeps the original id 1/2 order.
  return structuredClone(rows)
}

// A thrown handler never reaches its return statement. Rejection-before-write
// also cannot request confirmation. Excluding those meaningless combinations
// keeps each axis associated with an observable action.
export function mutationConfirmationHistories(
  adapter: `query` | `electric`,
): Array<MutationConfirmationHistory> {
  const confirmations =
    adapter === `query`
      ? ([`none`, `refetch`, `write`] as const)
      : ([`none`, `txid`] as const)
  const returns =
    adapter === `query`
      ? ([`void`, `legacy-disable`, `legacy-enable`] as const)
      : ([`void`, `legacy-txid`] as const)
  return [false, true].flatMap((peer) =>
    ([`insert`, `update`, `delete`] as const).flatMap((operation) => [
      ...confirmations.flatMap((confirmation) =>
        returns.map((returned) => ({
          adapter,
          peer,
          operation,
          confirmation,
          outcome: `fulfilled` as const,
          returned,
        })),
      ),
      {
        adapter,
        peer,
        operation,
        confirmation: `none`,
        outcome: `reject-before-write`,
        returned: `void`,
      } as const,
      ...confirmations.map((confirmation) => ({
        adapter,
        peer,
        operation,
        confirmation,
        outcome: `reject-after-write` as const,
        returned: `void` as const,
      })),
    ]),
  )
}

export function expectedMutationConfirmation(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  failure: Error,
): MutationConfirmationObservation
export function expectedMutationConfirmation<Row extends object>(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  failure: Error,
  inputs: MutationConfirmationInputs<Row>,
): MutationConfirmationObservation<Row>
export function expectedMutationConfirmation(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  failure: Error,
  inputs: MutationConfirmationInputs<object> = mutationConfirmationInputs,
): MutationConfirmationObservation<object> {
  const settled = cut === `settled` || cut === `late-confirmed`
  const wrote = cut !== `entered` && history.outcome !== `reject-before-write`
  const accepted =
    history.confirmation !== `none` &&
    history.confirmationEntry !== `unreachable` &&
    (cut === `confirmation-accepted` || settled)
  const requested =
    accepted ||
    (history.confirmationEntry !== `unreachable` &&
      cut === `confirmation-requested`)
  const late = cut === `late-confirmed`
  const rejected = settled && history.outcome !== `fulfilled`
  return {
    rows: mutationConfirmationRows(
      history.operation,
      settled ? (accepted || late ? `confirmed` : `initial`) : `optimistic`,
      history.peer,
      inputs,
    ),
    handlerWrites: wrote ? 1 : 0,
    confirmationCalls: requested ? 1 : 0,
    confirmationStatus: accepted
      ? `accepted`
      : requested
        ? `pending`
        : `not-requested`,
    providerRequests: 0,
    fetches:
      history.adapter === `query`
        ? 1 +
          (requested && history.confirmation === `refetch` ? 1 : 0) +
          (late ? 1 : 0)
        : 0,
    state: settled ? (rejected ? `failed` : `completed`) : `persisting`,
    settlement: settled ? (rejected ? `rejected` : `fulfilled`) : `pending`,
    error: rejected ? failure : undefined,
  }
}

// Call this at each held cut, at the settlement waiter itself, and afterward.
// The waiter snapshot is copied by the driver before any later confirmation.
export function checkMutationConfirmation(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  observed: MutationConfirmationObservation,
  failure: Error,
): void
export function checkMutationConfirmation<Row extends object>(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  observed: MutationConfirmationObservation<Row>,
  failure: Error,
  inputs: MutationConfirmationInputs<Row>,
): void
export function checkMutationConfirmation(
  history: MutationConfirmationHistory,
  cut: MutationConfirmationCut,
  observed: MutationConfirmationObservation<object>,
  failure: Error,
  inputs: MutationConfirmationInputs<object> = mutationConfirmationInputs,
): void {
  const expected = expectedMutationConfirmation(history, cut, failure, inputs)
  expect(observed.error, `${cut}: exact handler rejection`).toBe(expected.error)
  expect({ ...observed, error: undefined }, cut).toStrictEqual({
    ...expected,
    error: undefined,
  })
}

declareOracle({
  check: [checkMutationConfirmation],
  model: [expectedMutationConfirmation, mutationConfirmationRows],
  grammar: [mutationConfirmationHistories],
})
