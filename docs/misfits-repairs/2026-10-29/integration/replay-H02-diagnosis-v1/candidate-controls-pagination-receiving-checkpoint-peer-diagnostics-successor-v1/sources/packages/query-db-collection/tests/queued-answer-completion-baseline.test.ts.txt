import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import { it } from 'vitest'
import {
  checkRetainedWindowSnapshot,
  referenceJoinedWindowRows,
} from '../../db/tests/query/pagination-window-publication-oracle.js'
import {
  checkCompletionBaselineObservation,
  checkCompletionBaselineView,
  createCompletionDeliveryCheck,
  createCompletionModel,
  stepCompletionModel,
} from './queued-answer-completion-oracle.js'
import { receiveCompletionProgram } from './queued-answer-completion-supervisor.js'
import {
  authorCompletionBaselinePublicationEpochs,
  modelCompletionBaselinePublicationEpoch,
} from './queued-answer-completion-baseline-history-oracle.js'
import type { CompletionBaselineProgram } from './queued-answer-completion-baseline-history-oracle.js'
import type { CompletionBoundaryEvent } from './queued-answer-completion-attachments.js'
import type {
  CompletionAction,
  CompletionBaselineObservation,
  CompletionDelivery,
  CompletionPublicView,
  CompletionWindow,
} from './queued-answer-completion-oracle.js'

type HeldPeerProof = {
  request: number
  source: string
  queryKey: ReadonlyArray<unknown>
  loads: Array<{
    source: string
    load: number
    generation: number
    enteredAt: number
    receipt: number
    options: number
    signal?: number
    settledAt?: number
    outcome?: { state: string; error?: string }
    aborted?: boolean
    cancellationErrorName?: string
  }>
}

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
  const publicationEpochs = authorCompletionBaselinePublicationEpochs(
    program.setup,
    program.steps,
  )
  if (!isDeepStrictEqual(publicationEpochs, program.publicationEpochs))
    throw new Error(
      `selected program omits or changes authored publication intervals`,
    )
  const epochModels = new Map(
    publicationEpochs.map((epoch) => [
      epoch.id,
      modelCompletionBaselinePublicationEpoch(program, epoch),
    ]),
  )
  let epochIndex = 0
  let activeEpoch: string | undefined
  const sourceSettlements = new Map<
    string,
    { sequence: number; state: string; error?: string }
  >()
  const appliedAnswers = new Set<string>()
  const sourceProofs = new Set<string>()
  const failureProofs = new Set<string>()
  const exposedFacades = new Set<string>()
  const subscribedFacades = new Set<string>()
  const sourceKey = (source: string, load: number) =>
    `${model.run}:${source}:${load}`
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
  const semanticErrors: Array<Error> = []
  const compare = (context: string, check: () => void) => {
    try {
      check()
    } catch (error) {
      semanticErrors.push(new Error(context, { cause: error }))
    }
  }
  const retainedSnapshot = {
    rows: referenceJoinedWindowRows(
      program.setup.facts,
      `asc`,
      program.setup.window,
    ),
    window: program.setup.window,
  }
  let childSemanticFailure: string | undefined
  let heldPeerProof: HeldPeerProof | undefined
  const secondaryChildErrors: Array<Error> = []
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
      if (receipt.phase === `completion-boundary`) {
        const event = receipt.boundaryEvent as CompletionBoundaryEvent
        if (event.boundary === `baseline-window-peer-held`) {
          if (heldPeerProof !== undefined)
            throw new Error(`duplicate original held-peer proof`)
          heldPeerProof = event.detail as HeldPeerProof
          if (
            heldPeerProof.source !== program.answerScopes.peer.source ||
            heldPeerProof.loads.length === 0
          )
            throw new Error(`held peer lacks its authored original loads`)
        } else if (event.boundary === `source-load-applied-settled`) {
          const detail = event.detail as {
            source: string
            load: number
            outcome: { state: string; error?: string }
          }
          sourceSettlements.set(sourceKey(detail.source, detail.load), {
            sequence: event.sequence,
            ...detail.outcome,
          })
        } else if (
          event.boundary === `baseline-source-answer-applied` ||
          event.boundary === `baseline-source-failure-applied`
        ) {
          const detail = event.detail as {
            requirement: string
            loads: Array<{ source: string; load: number; settledAt: number }>
          }
          const failed = event.boundary === `baseline-source-failure-applied`
          if (failed) {
            const peer = (
              event.detail as {
                peer: HeldPeerProof & {
                  disposition: string
                  requestAnswered: boolean
                  requestCancelled: boolean
                }
              }
            ).peer
            const stable = (proof: HeldPeerProof) => ({
              request: proof.request,
              source: proof.source,
              queryKey: proof.queryKey,
              loads: proof.loads.map(
                ({
                  source,
                  load,
                  generation,
                  enteredAt,
                  receipt,
                  options,
                  signal,
                }) => ({
                  source,
                  load,
                  generation,
                  enteredAt,
                  receipt,
                  options,
                  signal,
                }),
              ),
            })
            if (
              !heldPeerProof ||
              !isDeepStrictEqual(stable(peer), stable(heldPeerProof)) ||
              peer.requestAnswered !== false ||
              ![`pending`, `retired`].includes(peer.disposition) ||
              peer.requestCancelled !== (peer.disposition === `retired`) ||
              peer.loads.some((load) => {
                if (peer.disposition === `pending`)
                  return (
                    load.aborted !== false ||
                    load.outcome !== undefined ||
                    load.settledAt !== undefined
                  )
                const settled = sourceSettlements.get(
                  sourceKey(load.source, load.load),
                )
                return (
                  load.aborted !== true ||
                  load.outcome?.state !== `rejected` ||
                  load.cancellationErrorName !== `AbortError` ||
                  !settled ||
                  settled.state !== `rejected` ||
                  settled.sequence !== load.settledAt ||
                  settled.sequence >= event.sequence
                )
              })
            )
              throw new Error(
                `completion instrument: failure barrier lost its exact pending or retired original peer`,
              )
          }
          if (
            detail.loads.length === 0 ||
            detail.loads.some((load) => {
              const settled = sourceSettlements.get(
                sourceKey(load.source, load.load),
              )
              return (
                !settled ||
                settled.sequence !== load.settledAt ||
                settled.sequence >= event.sequence ||
                settled.state !== (failed ? `rejected` : `fulfilled`) ||
                (failed && settled.error !== program.errors.source)
              )
            })
          )
            throw new Error(
              `source model outcome lacks preceding exact applied-load observations`,
            )
          ;(failed ? failureProofs : appliedAnswers).add(detail.requirement)
        } else if (event.boundary === `baseline-source-answer-provenance`) {
          const detail = event.detail as {
            requirement: string
            witnesses: Array<{
              source: string
              key: number
              loads: Array<number>
            }>
          }
          const expected = program.sourceAnswerPremises[detail.requirement]
          if (!expected || !appliedAnswers.has(detail.requirement))
            throw new Error(
              `source facts lack authored applied-answer provenance`,
            )
          const domains = expected
            .flatMap((premise) =>
              premise.requiredKeys.map((key) => `${premise.source}:${key}`),
            )
            .sort()
          if (
            !isDeepStrictEqual(
              detail.witnesses
                .map((witness) => `${witness.source}:${witness.key}`)
                .sort(),
              domains,
            ) ||
            detail.witnesses.some(
              (witness) =>
                witness.loads.length === 0 ||
                witness.loads.some((load) => {
                  const settled = sourceSettlements.get(
                    sourceKey(witness.source, load),
                  )
                  return (
                    !settled ||
                    settled.state !== `fulfilled` ||
                    settled.sequence >= event.sequence
                  )
                }),
            )
          )
            throw new Error(
              `source facts omit an authored applied-domain witness`,
            )
          sourceProofs.add(detail.requirement)
        } else if (
          event.boundary === `facade-public-exposure` ||
          event.boundary === `facade-public-subscription-return`
        ) {
          const detail = event.detail as { target: number }
          ;(event.boundary === `facade-public-exposure`
            ? exposedFacades
            : subscribedFacades
          ).add(`${model.run}:${detail.target}`)
        }
      } else if (receipt.phase === `completion-baseline-epoch-start`) {
        const expected = publicationEpochs[epochIndex]
        if (
          !expected ||
          activeEpoch !== undefined ||
          expected.id !== receipt.epoch
        )
          throw new Error(
            `receiving publication interval starts out of authored order`,
          )
        activeEpoch = expected.id
      } else if (receipt.phase === `completion-baseline-epoch-end`) {
        const expected = publicationEpochs[epochIndex]
        if (
          !expected ||
          activeEpoch !== expected.id ||
          receipt.epoch !== expected.id
        )
          throw new Error(
            `receiving publication interval ends out of authored order`,
          )
        const expectedModel = epochModels.get(expected.id)
        if (!expectedModel)
          throw new Error(`authored interval has no independent expectation`)
        if (
          [...exposedFacades].some((handle) => !subscribedFacades.has(handle))
        )
          throw new Error(
            `public facade exposure lacks its actual observer installation`,
          )
        if (expected.kind !== `cleanup`)
          compare(`callback replicas at ${expected.id}`, () =>
            deliveryCheck.checkpoint(expectedModel),
          )
        activeEpoch = undefined
        epochIndex++
      } else if (receipt.phase === `completion-baseline-action`) {
        const action = receipt.action as CompletionAction
        if (
          action.type === `source-answer` &&
          !sourceProofs.delete(action.requirement)
        )
          throw new Error(
            `source-answer model step precedes exact applied provenance`,
          )
        if (
          action.type === `source-failure` &&
          !failureProofs.delete(action.requirement)
        )
          throw new Error(
            `source-failure model step precedes exact failed acquisition`,
          )
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
        if (activeEpoch !== undefined)
          throw new Error(
            `initial view preceded its complete callback interval`,
          )
        compare(`initial public view`, () =>
          checkCompletionBaselineView(
            program.setup,
            receipt.view as CompletionPublicView,
          ),
        )
        observed.established = true
      } else if (receipt.phase === `completion-baseline-delivery`) {
        const expected = publicationEpochs[epochIndex]
        const expectedModel = expected && epochModels.get(expected.id)
        if (
          !expected ||
          !expectedModel ||
          expected.kind === `cleanup` ||
          activeEpoch !== expected.id ||
          receipt.epoch !== expected.id
        )
          throw new Error(
            `public callback has no exact armed authored interval`,
          )
        const delivery = receipt.delivery as CompletionDelivery
        if (
          program.gate === `source-failed-peer` &&
          expected.kind === `publication` &&
          delivery.layer !== `facade`
        )
          compare(
            `atomic window callback at ${String(receipt.capturedAt)}`,
            () =>
              checkRetainedWindowSnapshot(
                retainedSnapshot,
                {
                  rows: delivery.read,
                  window: receipt.window as CompletionWindow | undefined,
                },
                `receiving ${delivery.layer} callback ${String(receipt.capturedAt)}`,
              ),
          )
        compare(`callback delivery at ${String(receipt.capturedAt)}`, () =>
          deliveryCheck(expectedModel, delivery),
        )
      } else if (receipt.phase === `completion-baseline-cut`) {
        if (activeEpoch !== undefined)
          throw new Error(`public cut preceded its complete callback interval`)
        const expected = orderedSteps[orderedIndex++]
        if (
          expected?.kind !== `baseline-observe` ||
          expected.boundary !== receipt.boundary
        )
          throw new Error(
            `receiving observation does not match its authored recipe order`,
          )
        const observation = receipt as unknown as CompletionBaselineObservation
        if (observation.boundary === `source-failed-peer`) {
          if (
            observation.firstFailureBarrier !==
            (program.windowReceivingSchedule === `failure-first`
              ? true
              : undefined)
          )
            throw new Error(
              `failure cut changes its authored operation observation scope`,
            )
          compare(`atomic window root read at failure barrier`, () =>
            checkRetainedWindowSnapshot(
              retainedSnapshot,
              { rows: observation.view.roots, window: observation.view.window },
              `receiving root failure checkpoint`,
            ),
          )
          compare(`atomic window downstream read at failure barrier`, () =>
            checkRetainedWindowSnapshot(
              retainedSnapshot,
              {
                rows: observation.view.downstream,
                window: observation.view.window,
              },
              `receiving downstream failure checkpoint`,
            ),
          )
        }
        compare(`public cut ${observation.boundary}`, () =>
          checkCompletionBaselineObservation(model, observation),
        )
        cuts++
      } else if (receipt.phase === `completion-baseline-semantic-failure`) {
        if (
          childSemanticFailure !== undefined ||
          typeof receipt.message !== `string`
        )
          throw new Error(`invalid or duplicate child semantic failure marker`)
        childSemanticFailure = receipt.message
      } else if (receipt.phase === `completion-secondary-cleanup-error`) {
        secondaryChildErrors.push(
          new Error(`child secondary cleanup: ${String(receipt.error)}`),
        )
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
  // Semantic comparisons cannot interrupt the supervisor's raw receipt drain.
  // Preserve their first mismatch while independently collecting finalizer,
  // transport, binding, process-exit, and secondary cleanup diagnostics.
  const diagnostics: Array<Error> = [...secondaryChildErrors]
  if (
    outcome.reason !== `exited` ||
    outcome.signal !== null ||
    outcome.primaryObservationError !== undefined ||
    outcome.cleanupErrors.length > 0 ||
    outcome.bindingStatus !== `bound` ||
    outcome.bindingError !== undefined
  )
    diagnostics.push(
      new Error(
        `baseline receiving instrumentation failed; inspect ${outcome.logPath}; reason=${outcome.reason}; signal=${outcome.signal}; binding=${outcome.bindingStatus}; bindingError=${outcome.bindingError}; observer=${outcome.primaryObservationError}; cleanup=${JSON.stringify(outcome.cleanupErrors)}`,
      ),
    )
  const workerErrors = outcome.receipts.filter(
    (receipt) => receipt.phase === `worker-error`,
  )
  const expectedSemanticFailure =
    semanticErrors.length > 0 &&
    childSemanticFailure !== undefined &&
    workerErrors.length === 1 &&
    workerErrors[0]!.message === childSemanticFailure
  if (
    observed.unexpectedHostError ||
    outcome.receipts.some(
      (receipt) =>
        (receipt.phase === `worker-error` && !expectedSemanticFailure) ||
        receipt.phase === `completion-worker-cleanup-failed`,
    ) ||
    outcome.receipts.filter((receipt) => receipt.phase === `worker-cleaned`)
      .length !== 1
  )
    diagnostics.push(
      new Error(
        `baseline receiving had an unexpected host/worker exception; inspect ${outcome.logPath}`,
      ),
    )
  const expectedUncaught = selectedHostError !== undefined && hostErrors > 0
  if (
    outcome.exitCode !== 0 &&
    !(outcome.exitCode === 1 && (expectedUncaught || expectedSemanticFailure))
  )
    diagnostics.push(
      new Error(
        `unexpected baseline child exit ${outcome.exitCode}; inspect ${outcome.logPath}`,
      ),
    )
  if (childSemanticFailure !== undefined && !expectedSemanticFailure)
    diagnostics.push(
      new Error(
        `child semantic failure lacks the independent parent mismatch and exact worker-error; inspect ${outcome.logPath}`,
      ),
    )
  if (
    actionIndex !== actions.length ||
    orderedIndex !== orderedSteps.length ||
    cuts !== expectedCuts ||
    activeEpoch !== undefined ||
    epochIndex !== publicationEpochs.length ||
    (program.setup.ready && !observed.established)
  )
    diagnostics.push(
      new Error(
        `baseline receiving omitted its authored actions or observations; inspect ${outcome.logPath}`,
      ),
    )
  const errors = [...semanticErrors, ...diagnostics]
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1)
    throw new AggregateError(
      errors,
      `baseline receiving failed; inspect ${outcome.logPath}`,
      { cause: errors[0] },
    )
}, 60_000)
