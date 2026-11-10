import { isDeepStrictEqual } from 'node:util'
import { emitProgressReceipt as emit } from '../../../scripts/h02-progress/receipt-transport.mjs'
import {
  holdCompletionInsertion,
  holdCompletionTarget,
} from './queued-answer-completion-attachments.js'
import {
  createCompletionFixture,
  isCompletionFullDomainLoad,
} from './queued-answer-completion-fixture.js'
import {
  authorCompletionBaselinePublicationEpochs,
  modelCompletionBaselinePublicationEpoch,
} from './queued-answer-completion-baseline-history-oracle.js'
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
  const publicationEpochs = authorCompletionBaselinePublicationEpochs(
    program.setup,
    program.steps,
  )
  if (!isDeepStrictEqual(publicationEpochs, program.publicationEpochs))
    throw new Error(
      `baseline publication intervals differ from their authored grammar`,
    )
  const epochModels = new Map(
    publicationEpochs.map((epoch) => [
      epoch.id,
      modelCompletionBaselinePublicationEpoch(program, epoch),
    ]),
  )
  let activeEpoch = need(
    publicationEpochs[0],
    `initial authored publication interval`,
  )
  const callbackCapture: {
    capture?: (event: CompletionBoundaryEvent, epoch: string) => void
  } = {}
  let liveCallbackComparison = true
  const admissionEvents: Array<{
    event: CompletionBoundaryEvent
    epoch: string
  }> = []
  const receiveBoundary = (event: CompletionBoundaryEvent) => {
    emit(`completion-boundary`, { boundaryEvent: event })
    if (callbackCapture.capture) callbackCapture.capture(event, activeEpoch.id)
    else admissionEvents.push({ event, epoch: activeEpoch.id })
  }
  const armEpoch = (epoch: typeof activeEpoch) => {
    activeEpoch = epoch
    emit(`completion-baseline-epoch-start`, { epoch: epoch.id })
  }
  armEpoch(activeEpoch)
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
    observeBoundary: receiveBoundary,
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
  const handles = new Map<string, string>()
  const intervals = new Map<string, number>()
  const handle = (run: string, bucket: number, token: number) => {
    const object = `${run}:${token}`
    let label = handles.get(object)
    if (!label) {
      const group = `${run}:${bucket}`
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
  const publicHandle = (run: string, row: RawRow) =>
    Array.isArray(row.children)
      ? undefined
      : handle(run, row.id, row.children.handle)
  callbackCapture.capture = (event, epochId) => {
    if (!liveCallbackComparison) return
    const epoch = need(
      publicationEpochs.find((entry) => entry.id === epochId),
      `captured authored publication interval`,
    )
    if (epoch.kind === `cleanup`) return // Raw lifecycle evidence remains recorded.
    const expected = need(
      epochModels.get(epochId),
      `immutable callback expectation`,
    )
    if (event.boundary === `facade-public-exposure`) {
      const exposure = event.detail as { bucket: number; target: number }
      handle(expected.run, exposure.bucket, exposure.target)
      return
    }
    let delivery: CompletionDelivery | undefined
    if (
      event.boundary === `root-callback` ||
      event.boundary === `downstream-callback`
    ) {
      const raw = event.detail as RawRootDelivery
      const rows = raw.read.map(project)
      for (const row of raw.read) publicHandle(expected.run, row)
      delivery = {
        phase: `candidate-delivery`,
        layer: event.boundary === `root-callback` ? `root` : `downstream`,
        rows,
        read: rows,
        changes: raw.changes.map((change) => ({
          type: change.type,
          value: project(change.value),
          previousValue: change.previousValue && project(change.previousValue),
          handle: publicHandle(expected.run, change.value),
          previousHandle:
            change.previousValue &&
            publicHandle(expected.run, change.previousValue),
        })),
      }
    } else if (event.boundary === `facade-callback`) {
      const raw = event.detail as RawFacadeDelivery
      delivery = {
        phase: `candidate-delivery`,
        layer: `facade`,
        bucket: raw.bucket,
        handle: need(
          handles.get(`${expected.run}:${raw.target}`),
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
        epoch: epochId,
      })
      deliveryCheck(expected, delivery)
    }
  }
  for (const captured of admissionEvents)
    callbackCapture.capture(captured.event, captured.epoch)
  const closeEpoch = () => {
    if (activeEpoch.kind !== `cleanup`)
      deliveryCheck.checkpoint(
        need(epochModels.get(activeEpoch.id), `epoch-end expectation`),
      )
    emit(`completion-baseline-epoch-end`, { epoch: activeEpoch.id })
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
  const establishingLoads = (request: CompletionProviderRequest) => {
    const initiating = need(
      request.appliedLoad,
      `exact queryFn initiating source load`,
    )
    if (
      initiating.source !== request.source ||
      !isDeepStrictEqual(initiating.queryKey, request.queryKey)
    )
      throw new Error(
        `provider answer does not bind its original source acquisition`,
      )
    const loads = fixture.providers[request.source]
      .loads()
      .filter(
        (load) =>
          load.enteredAt >= initiating.enteredAt &&
          load.generation === initiating.generation &&
          isDeepStrictEqual(load.queryKey, request.queryKey),
      )
    if (!loads.includes(initiating))
      throw new Error(`source answer lost its initiating acquisition`)
    for (const load of loads)
      if (
        load.receipt === undefined ||
        load.receipt === true ||
        load.options.signal?.aborted
      )
        throw new Error(
          `source answer lacks a live original acquisition receipt`,
        )
    return loads
  }
  const releaseAnswers = async (
    action: Extract<CompletionAction, { type: `source-answer` }>,
  ) => {
    const requests = pending()
    if (requests.length === 0)
      throw new Error(`authored source answer has no actual held request`)
    const bindings = requests.map((request) => ({
      request,
      loads: establishingLoads(request),
    }))
    const loads = [...new Set(bindings.flatMap((binding) => binding.loads))]
    fixture.setFacts(action.facts)
    const releasedAt = fixture.recorder.event(
      `baseline-source-answer-release`,
      {
        requirement: action.requirement,
        requests: requests.map((request) => ({
          source: request.source,
          request: request.id,
          scope: request.requested,
        })),
        loads: loads.map((load) => ({ source: load.source, load: load.id })),
      },
    )
    for (const provider of Object.values(fixture.providers))
      provider.hold(false)
    for (const request of requests) request.answer()
    for (const load of loads) {
      await load.receipt
      if (load.read()?.state !== `fulfilled` || load.settledAt === undefined)
        throw new Error(
          `source answer did not reach its exact applied-load settlement`,
        )
    }
    for (const { request, loads: boundLoads } of bindings) {
      const executedAt = need(
        request.executedAt,
        `actual provider answer execution`,
      )
      if (
        boundLoads.some(
          (load) =>
            load.settledAt === undefined || load.settledAt <= executedAt,
        )
      )
        throw new Error(
          `source applied settlement did not follow its exact provider answer`,
        )
    }
    fixture.recorder.event(`baseline-source-answer-applied`, {
      requirement: action.requirement,
      loads: loads.map((load) => ({
        source: load.source,
        load: load.id,
        settledAt: load.settledAt,
      })),
    })
    await hostTurn()
    await hostTurn()
    return releasedAt
  }
  const checkSourceAnswerPremises = (
    action: Extract<CompletionAction, { type: `source-answer` }>,
    releasedAt: number,
  ) => {
    const premises = need(
      program.sourceAnswerPremises[action.requirement],
      `authored source-answer premises`,
    )
    const witnesses: Array<{
      source: string
      key: number
      request: number
      loads: Array<number>
    }> = []
    for (const premise of premises) {
      for (const key of premise.requiredKeys) {
        const candidates = fixture.providers[premise.source]
          .requests()
          .filter(
            (request) =>
              request.executedAt !== undefined &&
              request.answeredRows !== undefined &&
              (premise.since === `fixture-start` ||
                request.executedAt > releasedAt) &&
              request.requested.includes(key) &&
              request.requested.every((domain) =>
                premise.permittedKeys.includes(domain),
              ),
          )
        const request = need(
          candidates.find((candidate) => {
            const loads = establishingLoads(candidate)
            if (
              loads.some(
                (load) =>
                  load.read()?.state !== `fulfilled` ||
                  load.settledAt === undefined ||
                  load.settledAt <= candidate.executedAt!,
              )
            )
              return false
            if (premise.knowledge === `complete-domain`) {
              if (premise.source === `roots`)
                throw new Error(
                  `root premise cannot claim complete child-domain knowledge`,
                )
              if (
                !isCompletionFullDomainLoad(
                  premise.source,
                  candidate.options,
                  key,
                ) ||
                loads.some(
                  (load) =>
                    !isCompletionFullDomainLoad(
                      premise.source as `marked` | `children`,
                      load.options,
                      key,
                    ),
                )
              )
                return false
            }
            const actual = candidate.answeredRows!.filter((row) =>
              premise.source === `children`
                ? `parent` in row && row.parent === key
                : row.id === key,
            )
            const expected =
              premise.source === `roots`
                ? action.facts.roots.filter((row) => row.id === key)
                : premise.source === `children`
                  ? action.facts.children.filter((row) => row.parent === key)
                  : action.facts.marked
                      .filter((id) => id === key)
                      .map((id) => ({ id, rowId: id }))
            return isDeepStrictEqual(actual, expected)
          }),
          `applied ${premise.source} knowledge for authored domain ${key}; broader legal batching is an unsupported fixture premise`,
        )
        witnesses.push({
          source: premise.source,
          key,
          request: request.id,
          loads: establishingLoads(request).map((load) => load.id),
        })
      }
    }
    fixture.recorder.event(`baseline-source-answer-provenance`, {
      requirement: action.requirement,
      releasedAt,
      witnesses,
    })
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
      if (program.gate === `source-failed-peer`)
        // The held cut needs both exact descendant requests and their original
        // pending applied-load receipts; setWindow can return before they enter.
        await waitFor(() =>
          [program.answerScopes.failure, program.answerScopes.peer].every(
            (scope) => {
              const request = selectedRequest(scope)
              if (
                request === undefined ||
                request.appliedLoad?.receipt === undefined ||
                request.appliedLoad.receipt === true
              )
                return false
              return establishingLoads(request).every(
                (load) =>
                  load.read() === undefined && load.settledAt === undefined,
              )
            },
          ),
        )
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
      const request = need(
        selectedRequest(program.answerScopes.failure),
        `authored failed demand`,
      )
      const loads = establishingLoads(request)
      request.fail(errors.source)
      for (const load of loads) {
        let rejected: unknown
        try {
          await load.receipt
        } catch (error) {
          rejected = error
        }
        if (
          rejected !== errors.source ||
          load.read()?.state !== `rejected` ||
          load.settledAt === undefined ||
          request.failedAt === undefined ||
          load.settledAt <= request.failedAt
        )
          throw new Error(
            `authored failure did not settle its exact applied-load receipt`,
          )
      }
      await waitFor(() => fixture.live.utils.lastSubsetError === errors.source)
      fixture.recorder.event(`baseline-source-failure-applied`, {
        requirement: action.requirement,
        loads: loads.map((load) => ({
          source: load.source,
          load: load.id,
          settledAt: load.settledAt,
        })),
      })
      return
    }
    if (action.type === `source-answer`) {
      const releasedAt = await releaseAnswers(action)
      // This additional observation prepares the following public cut only.
      // It supplies no evidence for the independently recorded applied loads.
      await waitFor(() =>
        fixture.operations
          .observations()
          .every((operation) => operation.outcome.state !== `pending`),
      )
      checkSourceAnswerPremises(action, releasedAt)
      return
    }
    if (action.type === `cleanup`) {
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
      return
    }
    if (action.type === `restart`) {
      fixture = createCompletionFixture(
        { ...program.setup, run: action.run, facts: action.facts, ready: true },
        {
          cacheIdentity: `scope`,
          dispatching: () => undefined,
          heldInitial: [`roots`],
          observeBoundary: receiveBoundary,
        },
      )
      registerErrors()
      deliveryCheck = createCompletionDeliveryCheck(
        { ...program.setup, run: action.run, facts: action.facts },
        `empty`,
      )
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
    closeEpoch()
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
      closeEpoch()
      emit(`completion-baseline-view`, {
        setup: program.setup,
        view: fixture.read(),
      })
    }
    for (const [index, step] of program.steps.entries()) {
      const epoch = publicationEpochs.find((entry) => entry.fromStep === index)
      if (epoch && epoch.id !== activeEpoch.id) armEpoch(epoch)
      if (step.kind === `semantic`) {
        // Model visibility actions describe authored observable checkpoints.
        // They never force production installation or manufacture a receipt.
        const observedOutcome =
          step.action.type === `cleanup` ||
          step.action.type === `source-answer` ||
          step.action.type === `source-failure` ||
          step.action.type === `apply-output` ||
          step.action.type === `settle-optimistic`
        if (observedOutcome) await physicalAction(step.action)
        stepCompletionModel(model, step.action)
        emit(`completion-baseline-action`, { action: step.action })
        if (!observedOutcome) await physicalAction(step.action)
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
  // The final public cut already closed its interval. Teardown observations
  // remain raw lifecycle evidence, not publication by a later expected model.
  liveCallbackComparison = false
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
