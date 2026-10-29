/**
 * Calibrate exact-handler receivers with complete authored rows and an upstream
 * API rejection. Every control uses the documentation grammar, existing shared
 * outcome model and shared comparison; it supplies no separate expected answer.
 * These controls establish judgment sensitivity, not execution of an adapter.
 */
import { expect, test } from 'vitest'
import { declareOracle } from './oracle-declaration'
import {
  checkDocumentedMutation,
  documentedMutationHistories,
  documentedMutationInputs,
} from './documented-mutations-oracle'
import {
  checkMutationConfirmation,
  expectedMutationConfirmation,
} from './mutation-confirmation-oracle'
import type {
  DocumentedMutationObservation,
  DocumentedRow,
} from './documented-mutations-oracle'

const histories = [
  ...documentedMutationHistories(`query`),
  ...documentedMutationHistories(`electric`),
]
const completeRowControls: Array<{
  name: string
  shape: `dated-todo` | `product`
  corrupt: (row: DocumentedRow) => void
}> = [
  {
    name: `omitted ordinary field`,
    shape: `dated-todo`,
    corrupt: (row) => {
      delete row.completed
    },
  },
  {
    name: `changed Date value`,
    shape: `dated-todo`,
    corrupt: (row) => {
      row.created_at = new Date(`2026-10-02T00:00:00Z`)
    },
  },
  {
    name: `serialized Date`,
    shape: `dated-todo`,
    corrupt: (row) => {
      row.created_at = (row.created_at as Date).toISOString()
    },
  },
  {
    name: `missing own undefined`,
    shape: `product`,
    corrupt: (row) => {
      delete row.server_value
    },
  },
  {
    name: `extra own undefined`,
    shape: `product`,
    corrupt: (row) => {
      row.unexpected = undefined
    },
  },
]

test.each(completeRowControls)(
  `rejects incomplete ordinary rows: $name`,
  ({ shape, corrupt }) => {
    const failure = new Error(`API failure`)
    const selected = histories.filter(
      (h) =>
        h.handler.shape === shape &&
        h.apiOutcome === `success` &&
        h.handler.confirmation !== `none` &&
        h.handler.operation !== `delete`,
    )
    expect(selected.length).toBeGreaterThan(0)
    for (const history of selected) {
      const inputs = documentedMutationInputs(history.handler)
      const actual = expectedMutationConfirmation(
        history.mutation,
        `settled`,
        failure,
        inputs,
      )
      checkMutationConfirmation(
        history.mutation,
        `settled`,
        actual,
        failure,
        inputs,
      )
      corrupt(actual.rows[0]!)
      expect(() =>
        checkMutationConfirmation(
          history.mutation,
          `settled`,
          actual,
          failure,
          inputs,
        ),
      ).toThrow()
    }
  },
)

test(`rejects acknowledgement attributed to an API that rejected before returning`, () => {
  const failure = new Error(`API committed then rejected`)
  const selected = histories.filter(
    (h) => h.apiOutcome === `reject-after-write`,
  )
  expect(selected.length).toBeGreaterThan(0)
  for (const history of selected) {
    const inputs = documentedMutationInputs(history.handler)
    const actual = expectedMutationConfirmation(
      history.mutation,
      `settled`,
      failure,
      inputs,
    )
    checkMutationConfirmation(
      history.mutation,
      `settled`,
      actual,
      failure,
      inputs,
    )
    const afterAcknowledgement = expectedMutationConfirmation(
      { ...history.mutation, confirmationEntry: `reached` },
      `settled`,
      failure,
      inputs,
    )
    expect(() =>
      checkMutationConfirmation(
        history.mutation,
        `settled`,
        afterAcknowledgement,
        failure,
        inputs,
      ),
    ).toThrow()
  }
})

test.each([`fulfilled`, `rejected`] as const)(
  `rejects an extracted handler that is %s while its source remains held`,
  (outcome) => {
    const failure = new Error(`API failure`)
    const selected = histories.filter(
      (h) =>
        h.apiOutcome === `success` &&
        (h.handler.confirmation === `refetch` ||
          h.handler.confirmation === `txid`),
    )
    expect(selected.length).toBeGreaterThan(0)
    for (const history of selected) {
      const inputs = documentedMutationInputs(history.handler)
      const actual: DocumentedMutationObservation = {
        ...expectedMutationConfirmation(
          history.mutation,
          `confirmation-requested`,
          failure,
          inputs,
        ),
        handlerOutcome: `pending`,
        handlerError: undefined,
      }
      checkDocumentedMutation(
        history,
        `confirmation-requested`,
        actual,
        failure,
        inputs,
      )
      actual.handlerOutcome = outcome
      if (outcome === `rejected`) actual.handlerError = failure
      expect(() =>
        checkDocumentedMutation(
          history,
          `confirmation-requested`,
          actual,
          failure,
          inputs,
        ),
      ).toThrow(/actual documented handler Promise/)
    }
  },
)

test.each([
  `missing status guard`,
  `wrong error kind`,
  `wrong error message`,
  `replaced transaction error`,
])(`rejects an incorrect HTTP-status outcome: %s`, (fault) => {
  const transportFailure = new Error(`transport failed`)
  const selected = histories.filter((h) => h.failureResponse === `http-status`)
  expect(selected.length).toBeGreaterThan(0)
  for (const history of selected) {
    const inputs = documentedMutationInputs(history.handler)
    const handlerError = new Error(`HTTP Error: 503`)
    const actual: DocumentedMutationObservation = {
      ...expectedMutationConfirmation(
        history.mutation,
        `settled`,
        handlerError,
        inputs,
      ),
      handlerOutcome: `rejected`,
      handlerError,
    }
    checkDocumentedMutation(
      history,
      `settled`,
      actual,
      transportFailure,
      inputs,
    )
    if (fault === `missing status guard`) {
      actual.handlerOutcome = `fulfilled`
      actual.handlerError = undefined
    } else if (fault === `wrong error kind`)
      actual.handlerError = `HTTP Error: 503`
    else if (fault === `wrong error message`)
      actual.handlerError = new Error(`HTTP Error: 200`)
    else actual.error = new Error(`HTTP Error: 503`)
    expect(() =>
      checkDocumentedMutation(
        history,
        `settled`,
        actual,
        transportFailure,
        inputs,
      ),
    ).toThrow()
  }
})

declareOracle({
  check: [checkMutationConfirmation, checkDocumentedMutation],
  model: [expectedMutationConfirmation],
  grammar: [documentedMutationHistories],
})
