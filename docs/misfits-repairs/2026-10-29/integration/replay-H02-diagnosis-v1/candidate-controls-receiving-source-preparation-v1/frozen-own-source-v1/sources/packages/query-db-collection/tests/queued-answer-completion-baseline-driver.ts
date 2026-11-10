import { isDeepStrictEqual } from 'node:util'
import { emitProgressReceipt as emit } from '../../../scripts/h02-progress/receipt-transport.mjs'
import {
  holdCompletionInsertion,
  holdCompletionTarget,
} from './queued-answer-completion-attachments.js'
import { createCompletionFixture } from './queued-answer-completion-fixture.js'
import {
  checkCompletionBaselineObservation,
  checkCompletionBaselineView,
  createCompletionDeliveryCheck,
  createCompletionModel,
  stepCompletionModel,
} from './queued-answer-completion-oracle.js'
import type {
  CompletionBoundaryEvent,
  CompletionRoot,
} from './queued-answer-completion-attachments.js'
import type {
  CompletionBaselineControl,
  CompletionBaselineProgram,
} from './queued-answer-completion-baseline-history-oracle.js'
import type { CompletionProviderRequest } from './queued-answer-completion-fixture.js'
import type {
  CompletionAction,
  CompletionBaselineObservation,
  CompletionDelivery,
} from './queued-answer-completion-oracle.js'

const hostTurn = () => new Promise<void>((done) => setTimeout(done, 0))
function need<Value>(value: Value | undefined, name: string): Value {
  if (value === undefined)
    throw new Error(`completion receiving premise missing: ${name}`)
  return value
}
type RawChild = { id: number; parent: number; $key?: string | number }
type RawRow = {
  id: number
  rank: number
  children: Array<number> | { handle: number; rows: Array<RawChild> }
}
type RawChange<Row> = {
  type: `insert` | `update` | `delete`
  value: Row
  previousValue?: Row
}
type RawRootDelivery = {
  changes: Array<RawChange<RawRow>>
  read: Array<RawRow>
}
type RawFacadeDelivery = {
  target: number
  bucket: number
  changes: Array<RawChange<RawChild>>
  read: Array<RawChild>
}
type Fixture = ReturnType<typeof createCompletionFixture>
type OutputReceipt = ReturnType<Fixture[`rootReceipts`]>[number]
type Hold =
  | ReturnType<typeof holdCompletionTarget<CompletionRoot>>
  | ReturnType<typeof holdCompletionInsertion<RawChild>>

/**
 * Existing-law constituents use real QueryClient/QueryDB instances and public
 * operations. Their independent recipe supplies facts, dependencies, overlays,
 * targets and failure identities. This driver never fabricates an applied
 * receipt, operation Promise, host classification or future continuation fact.
 * The outer unchanged 20s/384MiB/1GiB instrument bounds an unreached premise;
 * this recorder adds no numerical product deadline or local retry ceiling.
 */
export async function driveCompletionBaselineProgram(
  program: CompletionBaselineProgram,
) {
  emit(`worker-start`, { mode: `baseline-constituent`, program })
  const model = createCompletionModel(program.setup)
  const errors = {
    source: new Error(program.errors.source),
    tail: new Error(program.errors.tail),
    graph: new Error(program.errors.graph),
    facadeB: new Error(program.errors.facadeB),
  }
  let fixture = createCompletionFixture(program.setup, {
    cacheIdentity: `scope`,
    dispatching: () => undefined,
    heldInitial: program.gate === `initial-status-tail` ? [`roots`] : [],
    observeBoundary: (event) =>
      emit(`completion-boundary`, { boundaryEvent: event }),
  })
  const registerErrors = () => {
    for (const name of [`source`, `tail`, `graph`, `facadeB`] as const)
      fixture.recorder.registerError(errors[name], program.errors[name])
  }
  registerErrors()
  const hostError = (error: unknown, surface: string) => {
    const expectedInjection = Object.values(errors).some(
      (injected) => injected === error,
    )
    emit(`completion-host-error`, {
      surface,
      expectedInjection,
      error: fixture.recorder.error(error),
    })
  }
  const windowError = (event: ErrorEvent) =>
    hostError(event.error, `window-error`)
  const uncaughtMonitor = (error: Error) =>
    hostError(error, `uncaught-exception-monitor`)
  globalThis.addEventListener(`error`, windowError)
  process.on(`uncaughtExceptionMonitor`, uncaughtMonitor)
  const originalFixture = fixture
  let deliveryCheck = createCompletionDeliveryCheck(program.setup, `empty`)
  let eventCursor = 0
  const handles = new Map<string, string>()
  const intervals = new Map<string, number>()
  const handle = (bucket: number, token: number) => {
    const object = `${model.run}:${token}`
    let label = handles.get(object)
    if (!label) {
      const group = `${model.run}:${bucket}`
      const interval = (intervals.get(group) ?? 0) + 1
      intervals.set(group, interval)
      label = `${group}:${interval}`
      handles.set(object, label)
    }
    return label
  }
  const project = (row: RawRow) => ({
    id: row.id,
    rank: row.rank,
    children: Array.isArray(row.children)
      ? [...row.children]
      : row.children.rows.map(({ id }) => id),
  })
  const publicHandle = (row: RawRow) =>
    Array.isArray(row.children)
      ? undefined
      : handle(row.id, row.children.handle)
  const drainDeliveries = () => {
    const events = fixture.recorder.events()
    for (const event of events.slice(eventCursor)) {
      let delivery: CompletionDelivery | undefined
      if (
        event.boundary === `root-callback` ||
        event.boundary === `downstream-callback`
      ) {
        const raw = event.detail as RawRootDelivery
        const rows = raw.read.map(project)
        for (const row of raw.read) publicHandle(row)
        delivery = {
          phase: `candidate-delivery`,
          layer: event.boundary === `root-callback` ? `root` : `downstream`,
          rows,
          read: rows,
          changes: raw.changes.map((change) => ({
            type: change.type,
            value: project(change.value),
            previousValue:
              change.previousValue && project(change.previousValue),
            handle: publicHandle(change.value),
            previousHandle:
              change.previousValue && publicHandle(change.previousValue),
          })),
        }
      } else if (event.boundary === `facade-callback`) {
        const raw = event.detail as RawFacadeDelivery
        delivery = {
          phase: `candidate-delivery`,
          layer: `facade`,
          bucket: raw.bucket,
          handle: need(
            handles.get(`${model.run}:${raw.target}`),
            `facade public exposure before callback`,
          ),
          rows: raw.read.map(({ id }) => id),
          read: raw.read.map(({ id }) => id),
          changes: raw.changes.map((change) => ({
            type: change.type,
            value: change.value.id,
            previousValue: change.previousValue?.id,
          })),
        }
      }
      if (delivery) {
        emit(`completion-baseline-delivery`, {
          delivery,
          capturedAt: event.sequence,
        })
        deliveryCheck(model, delivery)
      }
    }
    eventCursor = events.length
  }
  const events = (boundary: string): Array<CompletionBoundaryEvent> =>
    fixture.recorder.events().filter((event) => event.boundary === boundary)
  const outputs = (): Array<OutputReceipt> => [
    ...fixture.rootReceipts(),
    ...fixture.facades.observations().flatMap((entry) => entry.receipts),
  ]
  const pending = (): Array<CompletionProviderRequest> =>
    Object.values(fixture.providers)
      .flatMap((provider) => provider.requests())
      .filter((request) => !request.answered && !request.cancelled())
  const selectedRequest = (
    plan: CompletionBaselineProgram[`answerScopes`][keyof CompletionBaselineProgram[`answerScopes`]],
  ) =>
    pending().find(
      (request) =>
        request.source === plan.source &&
        isDeepStrictEqual(request.requested, plan.scope),
    )
  const waitFor = async (premise: () => boolean) => {
    while (!premise()) await hostTurn()
  }
  const boundOutputs = new Map<string, OutputReceipt>()
  const selectedOutput = (id: string) =>
    need(boundOutputs.get(id), `actual original output receipt ${id}`)
  let hold: Hold | undefined
  let cleanupEvidence:
    | {
        acceptedAt: number
        cleanupStartedAt: number
        rejectedAt: number
        error: string
      }
    | undefined
  let observedFailure: unknown
  let failure: unknown
  const cleanedFixtures = new Set<Fixture>()
  const captureFailure = async (invoke: () => unknown) => {
    try {
      await invoke()
    } catch (error) {
      const selected =
        program.gate === `facade-rollback`
          ? errors.facadeB
          : program.gate === `graph-failure`
            ? errors.graph
            : program.gate === `subscriber-tail` ||
                program.gate === `initial-status-tail`
              ? errors.tail
              : undefined
      if (error !== selected) throw error
      observedFailure = error
      fixture.recorder.event(`baseline-caught-failure`, {
        error: fixture.recorder.error(error),
      })
    }
  }
  const writeFacts = async (
    action: Extract<CompletionAction, { type: `source-write` }>,
  ) => {
    fixture.setFacts(action.facts)
    if (
      program.gate === `park-root` ||
      program.gate === `subscriber-tail` ||
      (program.gate === `cleanup-abandonment` && program.target === `root`)
    ) {
      const changed = action.facts.roots.filter((row) => {
        const before = program.setup.facts.roots.find(({ id }) => id === row.id)
        const selected =
          row.id === program.selectedKeys.root ||
          row.id === program.selectedKeys.facadeB
        return selected && before && before.rank !== row.rank
      })
      await captureFailure(() => fixture.writeRoots(changed))
    } else {
      const inserted = action.facts.children.filter(
        (row) => !program.setup.facts.children.some(({ id }) => id === row.id),
      )
      await captureFailure(() => fixture.writeChildren(inserted))
    }
    await hostTurn()
  }
  const callWindow = (
    action: Extract<CompletionAction, { type: `request-window` }>,
  ) =>
    fixture.operations.call(action.operation, () =>
      fixture.live.utils.setWindow(action.options),
    )
  const releaseAnswers = async (
    facts: CompletionBaselineProgram[`changedFacts`],
  ) => {
    fixture.setFacts(facts)
    for (const provider of Object.values(fixture.providers))
      provider.hold(false)
    for (const request of pending()) request.answer()
    await hostTurn()
    await hostTurn()
  }
  const bindHold = () => {
    if (hold) throw new Error(`baseline optimistic hold was bound twice`)
    if (program.overlay.kind === `root`) {
      const row = need(
        fixture.live.toArray.find(({ id }) => id === program.selectedKeys.root),
        `shown root for hold`,
      )
      const key = fixture.live.getKeyFromItem(row)
      const value: CompletionRoot = { ...row, rank: program.overlay.row.rank }
      hold = holdCompletionTarget(
        fixture.live,
        key,
        value,
        fixture.read,
        fixture.recorder,
      )
    } else {
      const overlay = program.overlay
      const row = need(
        fixture.live.toArray.find(({ id }) => id === overlay.bucket),
        `shown parent for retained facade hold`,
      )
      if (Array.isArray(row.children))
        throw new Error(
          `baseline facade hold requires actual Collection include`,
        )
      const collection = row.children
      const id = program.selectedKeys.optimisticChild
      const value = { id, parent: overlay.bucket, $key: id }
      if (collection.getKeyFromItem(value) !== id)
        throw new Error(`authored facade child key did not bind its public key`)
      hold = holdCompletionInsertion(
        collection,
        value,
        () => collection.toArray.map((child) => ({ ...child })),
        fixture.recorder,
      )
    }
  }
  const physicalAction = async (action: CompletionAction) => {
    if (action.type === `request-window`) {
      callWindow(action)
      return
    }
    if (action.type === `request-initial`) {
      fixture.operations.call(action.operation, () => fixture.live.preload())
      return
    }
    if (action.type === `source-write`) {
      await writeFacts(action)
      return
    }
    if (action.type === `stage-output`) {
      const target = action.target
      const role = action.snapshot === `restore` ? `restore` : `forward`
      const match = outputs().find(
        (receipt) =>
          receipt.role === role &&
          receipt.receipt !== true &&
          isDeepStrictEqual(receipt.target, target) &&
          ![...boundOutputs.values()].some(
            (used) => used.acceptedAt === receipt.acceptedAt,
          ),
      )
      boundOutputs.set(
        action.requirement,
        need(match, `accepted ${role} receipt for authored target`),
      )
      return
    }
    if (action.type === `settle-optimistic`) {
      await need(hold, `real optimistic hold`).release()
      await hostTurn()
      return
    }
    if (action.type === `apply-output`) {
      const receipt = selectedOutput(action.requirement)
      await receipt.receipt
      return
    }
    if (action.type === `source-failure`) {
      await waitFor(
        () =>
          selectedRequest(program.answerScopes.failure) !== undefined &&
          selectedRequest(program.answerScopes.peer) !== undefined,
      )
      need(
        selectedRequest(program.answerScopes.failure),
        `authored failed demand`,
      ).fail(errors.source)
      await waitFor(() => fixture.live.utils.lastSubsetError === errors.source)
      return
    }
    if (action.type === `source-answer`) {
      await releaseAnswers(action.facts)
      await waitFor(() =>
        fixture.operations
          .observations()
          .every((operation) => operation.outcome.state !== `pending`),
      )
      return
    }
    if (action.type === `cleanup`) {
      drainDeliveries()
      const receipt = selectedOutput(`selected`)
      const acceptedAt = receipt.acceptedAt
      const cleanupStartedAt = fixture.recorder.event(
        `baseline-cleanup-start`,
        { run: model.run },
      )
      await fixture.cleanup()
      cleanedFixtures.add(fixture)
      let abandoned: unknown
      try {
        await receipt.receipt
      } catch (error) {
        abandoned = error
      }
      const error = fixture.recorder.cleanupAbandonment(abandoned)
      const rejectedAt = fixture.recorder.event(`baseline-receipt-abandoned`, {
        error,
      })
      cleanupEvidence = { acceptedAt, cleanupStartedAt, rejectedAt, error }
      // Cleanup callbacks remain raw lifecycle evidence. The live publication
      // callback comparison ends at the old run's cleanup boundary and restarts
      // from empty for the fresh initialization, as its membership requires.
      eventCursor = fixture.recorder.events().length
      return
    }
    if (action.type === `restart`) {
      fixture = createCompletionFixture(
        { ...program.setup, run: action.run, facts: action.facts, ready: true },
        {
          cacheIdentity: `scope`,
          dispatching: () => undefined,
          heldInitial: [`roots`],
          observeBoundary: (event) =>
            emit(`completion-boundary`, { boundaryEvent: event }),
        },
      )
      registerErrors()
      deliveryCheck = createCompletionDeliveryCheck(
        { ...program.setup, run: action.run, facts: action.facts },
        `empty`,
      )
      eventCursor = 0
      return
    }
  }
  const physicalControl = async (control: CompletionBaselineControl) => {
    switch (control) {
      case `bind-output-holds`:
        bindHold()
        break
      case `begin-replay`:
        fixture.providers.marked.hold(true)
        void fixture.providers.marked.collection
          .reload()
          .catch((error: unknown) => {
            fixture.recorder.event(`baseline-reload-rejected`, {
              error: fixture.recorder.error(error),
            })
          })
        await waitFor(() =>
          pending().some((request) => request.source === `marked`),
        )
        break
      case `hold-demand-sources`:
        fixture.providers.marked.hold(true)
        fixture.providers.children.hold(true)
        break
      case `arm-facade-B-commit-fault`:
        fixture.facades.failNext(
          program.selectedKeys.facadeB,
          `commit`,
          errors.facadeB,
        )
        break
      case `retry-publication`:
        fixture.recorder.event(`baseline-public-retry-enter`)
        {
          const result = fixture.live.utils.setWindow({})
          fixture.recorder.event(`baseline-public-retry-return`, {
            literalTrue: result === true,
          })
          if (result !== true) await result
          fixture.recorder.event(`baseline-public-retry-settled`)
        }
        await hostTurn()
        break
      case `arm-subscriber-tail`:
        fixture.faults.publicSubscriber(errors.tail)
        break
      case `prepare-held-initial`:
        break // Root was held before actual subscription admission.
      case `arm-initial-status-tail`:
        fixture.faults.realStatusCallback(errors.tail)
        break
      case `throw-current-graph`:
        await waitFor(
          () => selectedRequest(program.answerScopes.peer) !== undefined,
        )
        fixture.attachment().failNextGraph(errors.graph)
        await captureFailure(() =>
          fixture.writeRoots([
            {
              ...program.setup.facts.roots[0]!,
              rank:
                program.setup.facts.roots[0]!.rank -
                program.parameters.rankScale / 10,
            },
          ]),
        )
        await hostTurn()
        break
      case `establish-replacement`:
        fixture.providers.roots.hold(false)
        for (const request of pending()) request.answer()
        await fixture.establish()
        break
    }
  }
  const observe = (boundary: CompletionBaselineObservation[`boundary`]) => {
    drainDeliveries()
    const common = {
      phase: `completion-baseline-cut` as const,
      boundary,
      run: model.run,
      view: fixture.read(),
      operations:
        fixture === originalFixture
          ? fixture.operations.observations()
          : originalFixture.operations.observations(),
    }
    let observation: CompletionBaselineObservation
    switch (boundary) {
      case `public-state`:
        observation = { ...common, boundary }
        break
      case `held-window`:
        observation = {
          ...common,
          boundary,
          operation: `window`,
          pendingProviderAnswers: pending().length,
        }
        break
      case `held-output`:
        observation = {
          ...common,
          boundary,
          receipts: [...boundOutputs].map(([requirement, receipt]) => ({
            requirement,
            target: receipt.target,
            role: receipt.role,
            returnedPromise: receipt.receipt !== true,
            pending: receipt.outcome.state === `pending`,
          })),
        }
        break
      case `source-failed-peer`:
        observation = {
          ...common,
          boundary,
          requirement: `answer`,
          error: fixture.recorder.error(errors.source),
          peerPending: selectedRequest(program.answerScopes.peer) !== undefined,
        }
        break
      case `facade-rollback`:
        observation = {
          ...common,
          boundary,
          committedAt: selectedOutput(`A-forward`).acceptedAt,
          threwAt: need(
            events(`facade-injected-throw`).at(-1),
            `actual B throw`,
          ).sequence,
          forwardRequirement: `A-forward`,
          restorationRequirement: `A-restore`,
        }
        break
      case `installed-tail-exception`: {
        const status = program.gate === `initial-status-tail`
        const callback = need(
          events(status ? `real-status-callback` : `root-callback`).at(-1),
          `actual installed callback`,
        )
        const thrown = need(
          events(
            status
              ? `real-status-callback-throw`
              : `real-root-subscriber-throw`,
          ).at(-1),
          `actual callback throw`,
        )
        const committed = need(
          events(`output-commit-return`)
            .filter((event) => event.sequence < callback.sequence)
            .at(-1),
          `actual preceding root installation`,
        )
        observation = {
          ...common,
          boundary,
          error: fixture.recorder.error(errors.tail),
          installedAt: committed.sequence,
          callbackAt: callback.sequence,
          threwAt: thrown.sequence,
        }
        break
      }
      case `cleanup-abandoned`:
        observation = {
          ...common,
          boundary,
          requirement: `selected`,
          retiredRun: program.setup.run,
          ...need(cleanupEvidence, `actual cleanup-abandonment order`),
        }
        break
      case `completed-window`:
        observation = { ...common, boundary, operation: `window` }
        break
      case `graph-exception`:
        observation = {
          ...common,
          boundary,
          error: fixture.recorder.error(errors.graph),
          graphEntered: events(`graph-injected-throw`).length > 0,
        }
        break
    }
    emit(`completion-baseline-cut`, observation)
    checkCompletionBaselineObservation(model, observation)
  }
  try {
    if (program.setup.ready) {
      await fixture.establish()
      checkCompletionBaselineView(program.setup, fixture.read())
      drainDeliveries()
      emit(`completion-baseline-view`, {
        setup: program.setup,
        view: fixture.read(),
      })
    }
    for (const step of program.steps) {
      if (step.kind === `semantic`) {
        // Model visibility actions describe authored observable checkpoints.
        // They never force production installation or manufacture a receipt.
        if (step.action.type === `cleanup`) await physicalAction(step.action)
        stepCompletionModel(model, step.action)
        emit(`completion-baseline-action`, { action: step.action })
        if (step.action.type !== `cleanup`) await physicalAction(step.action)
      } else if (step.kind === `control`) await physicalControl(step.control)
      else observe(step.boundary)
    }
    if (observedFailure !== undefined)
      emit(`completion-baseline-handled-exception`, {
        error: fixture.recorder.error(observedFailure),
        class:
          program.gate === `graph-failure`
            ? `terminal-graph`
            : `installed-or-rollback-tail`,
      })
  } catch (error) {
    failure = error
  }
  let cleanupFailed = false
  try {
    if (
      hold &&
      hold.transaction.state !== `completed` &&
      hold.transaction.state !== `failed`
    )
      hold.rollback()
  } catch (error) {
    cleanupFailed = true
    if (failure === undefined) failure = error
    else emit(`completion-secondary-cleanup-error`, { error: String(error) })
  }
  try {
    if (!cleanedFixtures.has(fixture)) await fixture.cleanup()
  } catch (error) {
    cleanupFailed = true
    if (failure === undefined) failure = error
    else emit(`completion-secondary-cleanup-error`, { error: String(error) })
  }
  emit(cleanupFailed ? `completion-worker-cleanup-failed` : `worker-cleaned`, {
    mode: `baseline-constituent`,
    gate: program.gate,
  })
  globalThis.removeEventListener(`error`, windowError)
  process.off(`uncaughtExceptionMonitor`, uncaughtMonitor)
  if (failure !== undefined) throw failure
}
