import { strict as assert } from 'node:assert'
import {
  checkCompletionBaselineObservation,
  checkCompletionObservation,
  createCompletionDeliveryCheck,
  createCompletionModel,
  modelCompletionView,
  stepCompletionModel,
} from '../../packages/query-db-collection/tests/queued-answer-completion-oracle.js'
import type {
  CandidateObservation,
  CompletionAction,
  CompletionBaselineObservation,
  CompletionDelivery,
  CompletionModel,
  CompletionSetup,
} from '../../packages/query-db-collection/tests/queued-answer-completion-oracle.js'

/**
 * Pure calibration supplies wrong recorded observations to the same comparison
 * as receiving. It imports no production, test runner, config or registering
 * module, constructs no QueryClient, and runs no generated program/campaign.
 * These controls establish checker sensitivity only. They supply no receiving
 * reach, unchanged-production RED, candidate GREEN, or product-mutant credit.
 */
const setup: CompletionSetup = {
  run: `one`,
  profile: `inline`,
  ready: true,
  window: { offset: 0, limit: 2 },
  facts: {
    roots: [
      { id: 1, rank: 10 },
      { id: 2, rank: 20 },
    ],
    marked: [],
    children: [
      { id: 101, parent: 1 },
      { id: 201, parent: 2 },
    ],
  },
}
const step = (model: CompletionModel, ...actions: Array<CompletionAction>) => {
  for (const action of actions) stepCompletionModel(model, action)
}
const required = (
  model: CompletionModel,
  id: string,
  kind: `source` | `output` | `publication`,
) => step(model, { type: `require`, requirement: { id, kind } })
function waiting() {
  const model = createCompletionModel(setup)
  required(model, `tail`, `publication`)
  step(model, {
    type: `request-window`,
    operation: `old`,
    options: {},
    requires: [`tail`],
  })
  return model
}
function common(model: CompletionModel) {
  return {
    phase: `candidate-cut` as const,
    run: model.run,
    view: modelCompletionView(model),
    operations: model.operations.map((operation) => ({
      operation: operation.operation,
      returned: `promise` as const,
      outcome: structuredClone(operation.outcome),
    })),
  }
}
function hostGap(
  model: CompletionModel,
): Extract<CandidateObservation, { cut: `host-gap` }> {
  return {
    ...common(model),
    cut: `host-gap`,
    answerExecuted: true,
    demandSettled: true,
    queuedTask: 1,
    dispatches: 0,
    existingOperation: `old`,
  }
}

export function runCompletionCheckerControls(): Array<{
  name: string
  outcome: `accepted` | `rejected`
}> {
  const results: Array<{ name: string; outcome: `accepted` | `rejected` }> = []
  const accepts = (name: string, run: () => void) => {
    assert.doesNotThrow(run, name)
    results.push({ name, outcome: `accepted` })
  }
  const rejects = (name: string, run: () => void) => {
    assert.throws(run, /completion (law|instrument):/, name)
    results.push({ name, outcome: `rejected` })
  }
  const model = waiting()
  accepts(`legitimate held host gap`, () =>
    checkCompletionObservation(model, hostGap(model)),
  )
  for (const [name, value] of [
    [`missing`, undefined],
    [`empty`, ``],
    [`unknown`, `absent`],
  ] as const) {
    const malformed = {
      ...hostGap(model),
      existingOperation: value,
    } as unknown as CandidateObservation
    rejects(
      `${name} host-gap operation cannot establish a pending request`,
      () => checkCompletionObservation(model, malformed),
    )
  }
  rejects(`empty optional host-gap operation identity is rejected`, () =>
    checkCompletionObservation(model, {
      ...hostGap(model),
      partialOperation: ``,
    }),
  )
  const early = hostGap(model)
  early.operations[0]!.outcome = { state: `fulfilled` }
  rejects(`answer settlement cannot fulfill gap operation`, () =>
    checkCompletionObservation(model, early),
  )
  step(model, {
    type: `request-window`,
    operation: `partial`,
    options: { limit: 1 },
    requires: [`tail`],
  })
  const partial = { ...hostGap(model), partialOperation: `partial` }
  accepts(`new partial operation remains pending`, () =>
    checkCompletionObservation(model, partial),
  )
  partial.operations[1]!.returned = `true`
  rejects(`new gap call cannot return literal true`, () =>
    checkCompletionObservation(model, partial),
  )
  const held: CandidateObservation = {
    ...common(model),
    cut: `held-flush`,
    graphQuiescent: true,
    realFlushEntered: true,
    flushHeld: true,
    queuedTasks: 0,
    operation: `old`,
  }
  accepts(`quiescent held flush retains obligation`, () =>
    checkCompletionObservation(model, held),
  )
  held.operations[0]!.outcome = { state: `fulfilled` }
  rejects(`no-delta held flush cannot report success`, () =>
    checkCompletionObservation(model, held),
  )

  const output = waiting()
  required(output, `receipt`, `output`)
  step(
    output,
    {
      type: `stage-output`,
      requirement: `receipt`,
      target: `root`,
      snapshot: `desired`,
      disposition: `retained`,
    },
    {
      type: `request-window`,
      operation: `with-output`,
      options: {},
      requires: [`receipt`, `tail`],
    },
  )
  const receipt: CandidateObservation = {
    ...common(output),
    cut: `receipt-held`,
    receipts: [
      {
        requirement: `receipt`,
        target: `root`,
        role: `forward`,
        returnedPromise: true,
        pending: true,
        beforeFirstStop: true,
      },
    ],
  }
  accepts(`actual held selected receipt keeps operation pending`, () =>
    checkCompletionObservation(output, receipt),
  )
  receipt.operations[1]!.outcome = { state: `fulfilled` }
  rejects(`omitting selected output obligation is visible`, () =>
    checkCompletionObservation(output, receipt),
  )
  rejects(
    `successful certificate cannot precede selected output application`,
    () => step(output, { type: `tail-success`, requirement: `tail` }),
  )

  const retry = waiting()
  step(retry, {
    type: `tail-failure`,
    requirement: `tail`,
    error: `first`,
    affected: [`old`],
  })
  required(retry, `retry-tail`, `publication`)
  step(retry, {
    type: `request-window`,
    operation: `retry`,
    options: {},
    requires: [`retry-tail`],
  })
  const old: CandidateObservation = {
    ...common(retry),
    cut: `old-completion-delivered`,
    oldCompletion: `old`,
    currentCompletion: `new`,
    retryAttachedBeforeDelivery: true,
  }
  accepts(`old observer cannot poison retry`, () =>
    checkCompletionObservation(retry, old),
  )
  old.operations[1]!.outcome = { state: `rejected`, error: `first` }
  rejects(`old completion failure poisoning retry is rejected`, () =>
    checkCompletionObservation(retry, old),
  )
  step(
    retry,
    { type: `install`, target: `root`, snapshot: `desired` },
    { type: `tail-success`, requirement: `retry-tail` },
  )
  accepts(`successful retry preserves the old rejected operation`, () =>
    checkCompletionObservation(retry, {
      ...common(retry),
      cut: `final`,
      winningOperation: `retry`,
      wholeTailReturned: true,
      graphRunning: false,
      pendingRequiredReceipts: 0,
    }),
  )

  const scoped = waiting()
  required(scoped, `peer`, `source`)
  step(
    scoped,
    {
      type: `request-window`,
      operation: `unrelated`,
      options: {},
      requires: [`peer`],
    },
    {
      type: `tail-failure`,
      requirement: `tail`,
      error: `subscriber`,
      affected: [`old`],
    },
  )
  const scope: CandidateObservation = {
    ...common(scoped),
    cut: `retryable-scope-failed`,
    error: `subscriber`,
    registeredAffected: [`old`],
    authoredAffected: [`old`],
    peerPending: true,
    installedBeforeThrow: true,
  }
  accepts(`retryable tail ends only authored attached operation`, () =>
    checkCompletionObservation(scoped, scope),
  )
  scope.operations[1]!.outcome = { state: `rejected`, error: `subscriber` }
  rejects(`subscriber fail-all is rejected`, () =>
    checkCompletionObservation(scoped, scope),
  )
  scope.operations = common(scoped).operations
  scope.authoredAffected = [`old`, `unrelated`]
  scope.registeredAffected = [...scope.authoredAffected]
  rejects(`production-derived affected-set substitution is rejected`, () =>
    checkCompletionObservation(scoped, scope),
  )

  const graph = waiting()
  required(graph, `peer`, `source`)
  step(
    graph,
    {
      type: `request-window`,
      operation: `peer`,
      options: {},
      requires: [`peer`],
      firstError: `earlier`,
    },
    { type: `graph-failure`, error: `graph` },
  )
  const terminal: CandidateObservation = {
    ...common(graph),
    cut: `graph-failed`,
    error: `graph`,
    peerPending: true,
    resumedGraphEntered: true,
  }
  accepts(`terminal graph ends unfinished operations before peer`, () =>
    checkCompletionObservation(graph, terminal),
  )
  terminal.operations[1]!.outcome = { state: `pending` }
  rejects(`terminal graph waiting for unanswered peer is rejected`, () =>
    checkCompletionObservation(graph, terminal),
  )
  terminal.operations = common(graph).operations
  terminal.operations[1]!.outcome = { state: `rejected`, error: `graph` }
  rejects(`terminal graph cannot replace an operation's first error`, () =>
    checkCompletionObservation(graph, terminal),
  )

  const cleanup = waiting()
  required(cleanup, `retained`, `output`)
  step(
    cleanup,
    {
      type: `stage-output`,
      requirement: `retained`,
      target: `root`,
      snapshot: `desired`,
      disposition: `retained`,
    },
    { type: `cleanup` },
    { type: `restart`, run: `two`, facts: setup.facts },
  )
  const abandoned: CandidateObservation = {
    ...common(cleanup),
    cut: `retained-cleanup-abandoned`,
    requirement: `retained`,
    acceptedAt: 1,
    cleanupStartedAt: 2,
    rejectedAt: 3,
    receiptError: `AbortError`,
    retainedTarget: true,
    retiredRun: `one`,
  }
  accepts(`state14 legal cleanup abandonment`, () =>
    checkCompletionObservation(cleanup, abandoned),
  )
  abandoned.rejectedAt = 1
  rejects(
    `accepted live rejection cannot masquerade as cleanup abandonment`,
    () => checkCompletionObservation(cleanup, abandoned),
  )
  const stale: CandidateObservation = {
    ...common(cleanup),
    cut: `stale-task`,
    retiredRun: `one`,
    currentTaskBefore: 2,
    currentTaskAfter: 2,
    staleDispatches: 1,
    staleGraphEntries: 0,
    currentAcceptedResumes: 1,
  }
  accepts(`stale dispatch preserves positive current progress`, () =>
    checkCompletionObservation(cleanup, stale),
  )
  stale.currentTaskAfter = 0
  rejects(`stale callback clearing current task is rejected`, () =>
    checkCompletionObservation(cleanup, stale),
  )

  const tail = waiting()
  step(tail, {
    type: `tail-failure`,
    requirement: `tail`,
    error: `tail`,
    affected: [`old`],
  })
  const throwing: CandidateObservation = {
    ...common(tail),
    cut: `tail-failed`,
    error: `tail`,
    lastReceiptSettled: true,
    realTailEntered: true,
    inputBefore: 7,
    inputAfter: 7,
    windowBefore: 2,
    windowAfter: 2,
  }
  accepts(`same-revision throwing recheck rejects`, () =>
    checkCompletionObservation(tail, throwing),
  )
  type TailObservation = CandidateObservation | CompletionBaselineObservation
  const compareTail = (
    state: CompletionModel,
    observation: TailObservation,
  ) => {
    if (observation.phase === `candidate-cut`)
      checkCompletionObservation(state, observation)
    else checkCompletionBaselineObservation(state, observation)
  }
  const omitError = (observation: TailObservation): TailObservation => {
    const malformed = structuredClone(observation) as unknown as Record<
      string,
      unknown
    >
    delete malformed.error
    return malformed as unknown as TailObservation
  }
  const tailCases: Array<{
    name: string
    state: CompletionModel
    observe: (state: CompletionModel) => TailObservation
  }> = [
    {
      name: `recheck`,
      state: tail,
      observe: (state) => ({ ...throwing, ...common(state) }),
    },
    {
      name: `installed candidate`,
      state: tail,
      observe: (state) => ({
        ...common(state),
        cut: `installed-tail-failed`,
        error: `tail`,
        installedAt: 1,
        realStatusCallbackAt: 2,
        thrownAt: 3,
      }),
    },
    {
      name: `installed baseline`,
      state: tail,
      observe: (state) => ({
        ...common(state),
        phase: `completion-baseline-cut`,
        boundary: `installed-tail-exception`,
        error: `tail`,
        installedAt: 1,
        callbackAt: 2,
        threwAt: 3,
      }),
    },
    {
      name: `scoped candidate`,
      state: scoped,
      observe: (state) => ({
        ...common(state),
        cut: `retryable-scope-failed`,
        error: `subscriber`,
        registeredAffected: [`old`],
        authoredAffected: [`old`],
        peerPending: true,
        installedBeforeThrow: true,
      }),
    },
  ]
  for (const entry of tailCases) {
    if (entry.name.startsWith(`installed`))
      accepts(`${entry.name} preserves a real authored tail error`, () =>
        compareTail(entry.state, entry.observe(entry.state)),
      )
    rejects(`${entry.name} cannot omit the observed tail error`, () =>
      compareTail(entry.state, omitError(entry.observe(entry.state))),
    )
    rejects(`${entry.name} cannot use an empty observed tail error`, () =>
      compareTail(entry.state, {
        ...entry.observe(entry.state),
        error: ``,
      } as TailObservation),
    )
    const unfailed = waiting()
    rejects(`${entry.name} requires an authored tail failure`, () =>
      compareTail(unfailed, entry.observe(unfailed)),
    )
    rejects(`${entry.name} cannot compare two absent failures as equal`, () =>
      compareTail(unfailed, omitError(entry.observe(unfailed))),
    )
  }
  const missingRevisions = structuredClone(throwing) as unknown as Record<
    string,
    unknown
  >
  delete missingRevisions.inputBefore
  delete missingRevisions.inputAfter
  delete missingRevisions.windowBefore
  delete missingRevisions.windowAfter
  rejects(`omitted revision pairs do not establish unchanged revisions`, () =>
    checkCompletionObservation(
      tail,
      missingRevisions as unknown as CandidateObservation,
    ),
  )
  throwing.operations[0]!.outcome = { state: `fulfilled` }
  rejects(`saved successful checkpoint cannot certify throwing tail`, () =>
    checkCompletionObservation(tail, throwing),
  )
  const torn = hostGap(waiting())
  torn.view.roots[0]!.children = []
  rejects(`torn nested public snapshot is rejected`, () =>
    checkCompletionObservation(waiting(), torn),
  )
  const unknown = {
    ...hostGap(waiting()),
    cut: `unsupported-future-cut`,
  } as unknown as CandidateObservation
  rejects(`unknown candidate cut is rejected`, () =>
    checkCompletionObservation(waiting(), unknown),
  )
  rejects(`invalid enqueue identities cannot establish repeated yield`, () =>
    checkCompletionObservation(waiting(), {
      ...common(waiting()),
      cut: `repeated-yield`,
      enqueues: [-1, 2],
      acceptedResumes: 1,
      operation: `old`,
    }),
  )
  rejects(`invalid facade sequence cannot establish ordered failure`, () =>
    checkCompletionObservation(waiting(), {
      ...common(waiting()),
      cut: `facade-attempt-failed`,
      facadeACommit: -2,
      facadeBThrow: -1,
      aReceiptPending: true,
      restoringReceiptPending: true,
    }),
  )

  const deliveredModel = createCompletionModel(setup)
  const deliveryCheck = createCompletionDeliveryCheck(setup)
  step(
    deliveredModel,
    {
      type: `source-write`,
      facts: {
        ...setup.facts,
        roots: [
          { id: 1, rank: 11 },
          { id: 2, rank: 20 },
        ],
      },
    },
    { type: `install`, target: `root`, snapshot: `desired` },
  )
  const delivery: CompletionDelivery = {
    phase: `candidate-delivery`,
    layer: `root`,
    rows: modelCompletionView(deliveredModel).roots,
    read: modelCompletionView(deliveredModel).roots,
    changes: [
      {
        type: `update`,
        value: { id: 1, rank: 11, children: [101] },
        previousValue: { id: 1, rank: 10, children: [101] },
      },
    ],
  }
  accepts(`legitimate coherent callback uses shared event comparison`, () =>
    deliveryCheck(deliveredModel, delivery),
  )
  const duplicate = structuredClone(delivery)
  duplicate.changes.push(structuredClone(duplicate.changes[0]!))
  rejects(`duplicate callback payload is rejected`, () =>
    createCompletionDeliveryCheck(setup)(deliveredModel, duplicate),
  )
  const wrongRead = structuredClone(delivery)
  wrongRead.read = []
  rejects(`torn callback synchronous read is rejected`, () =>
    createCompletionDeliveryCheck(setup)(deliveredModel, wrongRead),
  )
  const unknownDelivery = {
    ...delivery,
    phase: `candidate-unhandled`,
  } as unknown as CompletionDelivery
  rejects(`unknown delivery phase is rejected`, () =>
    createCompletionDeliveryCheck(setup)(deliveredModel, unknownDelivery),
  )
  accepts(`unchanged publication interval permits zero row callbacks`, () =>
    createCompletionDeliveryCheck(setup).checkpoint(
      createCompletionModel(setup),
    ),
  )
  rejects(`zero callbacks cannot hide changed root content`, () =>
    createCompletionDeliveryCheck(setup).checkpoint(deliveredModel),
  )
  rejects(
    `root callback cannot substitute for missing downstream callback`,
    () => deliveryCheck.checkpoint(deliveredModel),
  )
  deliveryCheck(deliveredModel, { ...delivery, layer: `downstream` })
  accepts(`both public event replicas reach their authored interval`, () =>
    deliveryCheck.checkpoint(deliveredModel),
  )
  const facadeSetup: CompletionSetup = { ...setup, profile: `facade` }
  const facadeModel = createCompletionModel(facadeSetup)
  step(
    facadeModel,
    {
      type: `source-write`,
      facts: {
        ...setup.facts,
        children: [...setup.facts.children, { id: 102, parent: 1 }],
      },
    },
    { type: `install`, target: { bucket: 1 }, snapshot: `desired` },
  )
  const facadeView = modelCompletionView(facadeModel)
  const facadeDelivery: CompletionDelivery = {
    phase: `candidate-delivery`,
    layer: `facade`,
    bucket: 1,
    handle: facadeView.facades[0]!.handle,
    rows: [101, 102],
    read: [101, 102],
    changes: [{ type: `insert`, value: 102 }],
  }
  rejects(`zero callbacks cannot hide changed facade content`, () =>
    createCompletionDeliveryCheck(facadeSetup).checkpoint(facadeModel),
  )
  const facadeCheck = createCompletionDeliveryCheck(facadeSetup)
  facadeCheck(facadeModel, facadeDelivery)
  accepts(`facade content advances without a parent handle update`, () =>
    facadeCheck.checkpoint(facadeModel),
  )
  const initialize = createCompletionDeliveryCheck(facadeSetup, `empty`)
  rejects(`omitted initialization stream cannot establish nonempty roots`, () =>
    initialize.checkpoint(createCompletionModel(facadeSetup)),
  )
  const initialized = createCompletionModel(facadeSetup)
  const initializedView = modelCompletionView(initialized)
  for (const layer of [`root`, `downstream`] as const)
    initialize(initialized, {
      phase: `candidate-delivery`,
      layer,
      rows: initializedView.roots,
      read: initializedView.roots,
      changes: initializedView.roots.map((value) => ({
        type: `insert`,
        value,
        handle: initializedView.facades.find(
          (entry) => entry.bucket === value.id,
        )!.handle,
      })),
    })
  rejects(
    `root initialization cannot hide absent public facade initial batch`,
    () => initialize.checkpoint(initialized),
  )
  for (const facade of initializedView.facades)
    initialize(initialized, {
      phase: `candidate-delivery`,
      layer: `facade`,
      bucket: facade.bucket,
      handle: facade.handle,
      rows: facade.rows,
      read: facade.rows,
      changes: facade.rows.map((value) => ({ type: `insert`, value })),
    })
  accepts(`public facade initial batches complete initialization`, () =>
    initialize.checkpoint(initialized),
  )
  const emptySetup: CompletionSetup = {
    ...facadeSetup,
    facts: { ...setup.facts, children: [] },
  }
  accepts(`empty facade content permits zero row callbacks`, () =>
    createCompletionDeliveryCheck(emptySetup).checkpoint(
      createCompletionModel(emptySetup),
    ),
  )
  rejects(`failed flush cannot expose forward facade content`, () =>
    createCompletionDeliveryCheck(facadeSetup)(initialized, facadeDelivery),
  )
  const staleHandle = { ...facadeDelivery, handle: `retired:1:1` }
  rejects(`retired facade cannot deliver as the active public handle`, () =>
    createCompletionDeliveryCheck(facadeSetup)(facadeModel, staleHandle),
  )
  const ordinary = waiting()
  required(ordinary, `answer`, `source`)
  required(ordinary, `peer`, `source`)
  step(
    ordinary,
    {
      type: `request-window`,
      operation: `aggregate`,
      options: {},
      requires: [`answer`, `peer`, `tail`],
    },
    { type: `source-failure`, requirement: `answer`, error: `source` },
  )
  const source: CandidateObservation = {
    ...common(ordinary),
    cut: `source-failed`,
    error: `source`,
    peerPending: true,
    requirement: `answer`,
  }
  accepts(`ordinary source failure keeps existing peer aggregation`, () =>
    checkCompletionObservation(ordinary, source),
  )
  source.operations[1]!.outcome = { state: `rejected`, error: `source` }
  rejects(
    `ordinary source failure cannot acquire terminal fail-fast policy`,
    () => checkCompletionObservation(ordinary, source),
  )
  const complete = waiting()
  step(
    complete,
    {
      type: `request-window`,
      operation: `partial`,
      options: { limit: 1 },
      requires: [`tail`],
    },
    { type: `install`, target: `root`, snapshot: `desired` },
    { type: `tail-success`, requirement: `tail` },
  )
  const final: CandidateObservation = {
    ...common(complete),
    cut: `final`,
    winningOperation: `partial`,
    wholeTailReturned: true,
    graphRunning: false,
    pendingRequiredReceipts: 0,
  }
  accepts(`winning partial window succeeds after its complete tail`, () =>
    checkCompletionObservation(complete, final),
  )
  final.view.window.limit = 2
  rejects(
    `partial options cannot report the prior settled window after success`,
    () => checkCompletionObservation(complete, final),
  )
  return results
}
