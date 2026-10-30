/**
 * Calibrate the shared adapter judgment with wrong public observations. These
 * controls use the same grammar, model and comparison as the Query and Electric
 * receivers. A legal model observation passes before each mutation is applied.
 * They establish checker sensitivity, not execution of either adapter.
 */
import { expect, test } from 'vitest'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
  mutationConfirmationHistories,
  mutationConfirmationRows,
} from './mutation-confirmation-oracle'
import { declareOracle } from './oracle-declaration'
import type {
  MutationConfirmationHistory,
  MutationConfirmationObservation,
} from './mutation-confirmation-oracle'

const histories = [
  ...mutationConfirmationHistories(`query`),
  ...mutationConfirmationHistories(`electric`),
]
const controls: Array<{
  name: string
  applies: (history: MutationConfirmationHistory) => boolean
  corrupt: (
    observation: MutationConfirmationObservation,
    history: MutationConfirmationHistory,
  ) => void
}> = [
  {
    name: `automatic refetch`,
    applies: (h) => h.adapter === `query`,
    corrupt: (o) => {
      o.fetches++
    },
  },
  {
    name: `legacy return starts Electric refresh work`,
    applies: (h) => h.adapter === `electric`,
    corrupt: (o) => {
      o.providerRequests++
    },
  },
  {
    name: `lost peer`,
    applies: (h) => h.peer,
    corrupt: (o) => {
      o.rows = o.rows.filter((row) => row.id !== 2)
    },
  },
  {
    name: `partial server replacement`,
    applies: (h) => h.confirmation !== `none` && h.operation !== `delete`,
    corrupt: (o) => {
      o.rows.find((row) => row.id === 1)!.stable = `stable-1`
    },
  },
  {
    name: `success reported as failure`,
    applies: (h) => h.outcome === `fulfilled`,
    corrupt: (o) => {
      o.state = `failed`
      o.settlement = `rejected`
      o.error = new Error(`discarded legacy return`)
    },
  },
  {
    name: `failure reported as success`,
    applies: (h) => h.outcome !== `fulfilled`,
    corrupt: (o) => {
      o.state = `completed`
      o.settlement = `fulfilled`
      o.error = undefined
    },
  },
  {
    name: `replaced handler error`,
    applies: (h) => h.outcome !== `fulfilled`,
    corrupt: (o) => {
      o.error = new Error(`same text, different error`)
    },
  },
  {
    name: `accepted confirmation rolled back`,
    applies: (h) => h.confirmation !== `none`,
    corrupt: (o, h) => {
      o.rows = mutationConfirmationRows(h.operation, `initial`, h.peer)
    },
  },
  {
    name: `unconfirmed optimistic row leaked`,
    applies: (h) => h.confirmation === `none`,
    corrupt: (o, h) => {
      o.rows = mutationConfirmationRows(h.operation, `optimistic`, h.peer)
    },
  },
  {
    name: `settlement waiter ran before publication`,
    applies: () => true,
    corrupt: (o) => {
      o.state = `persisting`
    },
  },
  {
    name: `duplicate server write`,
    applies: () => true,
    corrupt: (o) => {
      o.handlerWrites++
    },
  },
]

test.each(controls)(
  `rejects wrong mutation observation: $name`,
  ({ applies, corrupt }) => {
    const failure = new Error(`handler failure`)
    const selected = histories.filter(applies)
    expect(selected.length).toBeGreaterThan(0)
    for (const history of selected) {
      const actual = expectedMutationConfirmation(history, `settled`, failure)
      checkMutationConfirmation(history, `settled`, actual, failure)
      corrupt(actual, history)
      expect(
        () => checkMutationConfirmation(history, `settled`, actual, failure),
        JSON.stringify(history),
      ).toThrow()
    }
  },
)

// Holding the actual fetch/stream response must distinguish acknowledgement
// registration from acceptance. A prematurely fulfilled utility is not enough.
test.each([`query`, `electric`] as const)(
  `rejects early acknowledgement in %s`,
  (adapter) => {
    const failure = new Error(`handler failure`)
    for (const history of mutationConfirmationHistories(adapter).filter(
      (h) => h.confirmation === (adapter === `query` ? `refetch` : `txid`),
    )) {
      const actual = expectedMutationConfirmation(
        history,
        `confirmation-requested`,
        failure,
      )
      checkMutationConfirmation(
        history,
        `confirmation-requested`,
        actual,
        failure,
      )
      actual.confirmationStatus = `accepted`
      expect(() =>
        checkMutationConfirmation(
          history,
          `confirmation-requested`,
          actual,
          failure,
        ),
      ).toThrow()
    }
  },
)

declareOracle({
  check: [checkMutationConfirmation],
  model: [expectedMutationConfirmation],
  grammar: [mutationConfirmationHistories],
})
