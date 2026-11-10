import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { it } from 'vitest'
import {
  checkCompletionBaselineObservation,
  checkCompletionBaselineView,
  createCompletionDeliveryCheck,
  createCompletionModel,
  stepCompletionModel,
} from './queued-answer-completion-oracle.js'
import { receiveCompletionProgram } from './queued-answer-completion-supervisor.js'
import type { CompletionBaselineProgram } from './queued-answer-completion-baseline-history-oracle.js'
import type {
  CompletionAction,
  CompletionBaselineObservation,
  CompletionDelivery,
  CompletionPublicView,
} from './queued-answer-completion-oracle.js'

// A single exact selected constituent runs in the native child. This runner
// registers no random campaign and changes none of the original eight budgets.
// Parent and child judge the same model/check; parent action input must match
// the independently authored recipe, rather than production-selected facts.
it(`checks a selected baseline constituent through the shared judgment`, async () => {
  const path = process.env.H02_COMPLETION_PARENT_PROGRAM
  if (!path) throw new Error(`H02_COMPLETION_PARENT_PROGRAM is required`)
  const programBytes = readFileSync(path)
  if (
    createHash(`sha256`).update(programBytes).digest(`hex`) !==
    process.env.H02_COMPLETION_PARENT_PROGRAM_SHA256
  )
    throw new Error(
      `selected baseline program bytes differ from the exact recipe`,
    )
  const program = JSON.parse(
    programBytes.toString(`utf8`),
  ) as CompletionBaselineProgram
  const model = createCompletionModel(program.setup)
  let deliveryCheck = createCompletionDeliveryCheck(program.setup, `empty`)
  const actions = program.steps.flatMap((step) =>
    step.kind === `semantic` ? [step.action] : [],
  )
  const orderedSteps = program.steps.filter((step) => step.kind !== `control`)
  let orderedIndex = 0
  const expectedCuts = program.steps.filter(
    (step) => step.kind === `baseline-observe`,
  ).length
  let actionIndex = 0
  let cuts = 0
  const observed = { established: false, unexpectedHostError: false }
  let hostErrors = 0
  const selectedHostError =
    program.gate === `graph-failure`
      ? program.errors.graph
      : program.gate === `facade-rollback`
        ? program.errors.facadeB
        : program.gate === `subscriber-tail` ||
            program.gate === `initial-status-tail`
          ? program.errors.tail
          : undefined
  const outcome = await receiveCompletionProgram(
    program,
    (receipt) => {
      if (receipt.phase === `completion-baseline-action`) {
        const action = receipt.action as CompletionAction
        const expected = orderedSteps[orderedIndex++]
        if (
          expected?.kind !== `semantic` ||
          !isDeepStrictEqual(action, expected.action) ||
          !isDeepStrictEqual(action, actions[actionIndex])
        )
          throw new Error(
            `receiving model action does not match authored recipe action ${actionIndex}`,
          )
        actionIndex++
        stepCompletionModel(model, action)
        if (action.type === `restart`)
          deliveryCheck = createCompletionDeliveryCheck(
            { ...program.setup, run: action.run, facts: action.facts },
            `empty`,
          )
      } else if (receipt.phase === `completion-baseline-view`) {
        checkCompletionBaselineView(
          program.setup,
          receipt.view as CompletionPublicView,
        )
        observed.established = true
      } else if (receipt.phase === `completion-baseline-delivery`) {
        deliveryCheck(model, receipt.delivery as CompletionDelivery)
      } else if (receipt.phase === `completion-baseline-cut`) {
        const expected = orderedSteps[orderedIndex++]
        if (
          expected?.kind !== `baseline-observe` ||
          expected.boundary !== receipt.boundary
        )
          throw new Error(
            `receiving observation does not match its authored recipe order`,
          )
        checkCompletionBaselineObservation(
          model,
          receipt as unknown as CompletionBaselineObservation,
        )
        cuts++
      } else if (receipt.phase === `completion-host-error`) {
        hostErrors++
        if (
          receipt.expectedInjection !== true ||
          receipt.error !== selectedHostError
        )
          observed.unexpectedHostError = true
      }
    },
    `baseline-constituent`,
  )
  if (
    outcome.reason !== `exited` ||
    outcome.signal !== null ||
    outcome.primaryObservationError !== undefined ||
    outcome.cleanupErrors.length > 0 ||
    outcome.bindingStatus !== `bound` ||
    outcome.bindingError !== undefined
  )
    throw new Error(
      `baseline receiving instrumentation failed; inspect ${outcome.logPath}`,
    )
  if (
    observed.unexpectedHostError ||
    outcome.receipts.some((receipt) => receipt.phase === `worker-error`)
  )
    throw new Error(
      `baseline receiving had an unexpected host/worker exception; inspect ${outcome.logPath}`,
    )
  const expectedUncaught = selectedHostError !== undefined && hostErrors > 0
  if (outcome.exitCode !== 0 && !(outcome.exitCode === 1 && expectedUncaught))
    throw new Error(
      `unexpected baseline child exit ${outcome.exitCode}; inspect ${outcome.logPath}`,
    )
  if (
    actionIndex !== actions.length ||
    orderedIndex !== orderedSteps.length ||
    cuts !== expectedCuts ||
    (program.setup.ready && !observed.established)
  )
    throw new Error(
      `baseline receiving omitted its authored actions or observations; inspect ${outcome.logPath}`,
    )
}, 60_000)
