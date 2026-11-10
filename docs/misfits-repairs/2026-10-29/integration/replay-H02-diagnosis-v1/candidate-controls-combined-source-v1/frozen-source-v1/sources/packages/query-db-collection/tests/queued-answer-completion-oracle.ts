import { isDeepStrictEqual } from 'node:util'
import { declareOracle } from '../../db/tests/oracle-declaration.js'

/**
 * A finite answer getting a host turn is not window completion. ARCHITECTURE
 * laws 7, 9, 14 and 16, Atomic window publication, and the accepted H02 design
 * require the chosen window, its establishing applied output, and a successful
 * whole publication tail before success. A throwing tail cannot certify success.
 * Cleanup abandons a run; it cannot make an old callback act on its replacement.
 *
 * This companion judges completion cuts for the primary progress owner. Its
 * ordinary driver companion invokes real setWindow/preload/reload, records the
 * original returned promises, and supplies the cuts below. Neither this model
 * nor its pure checker controls import production or a registering test module.
 * The original progress profiles retain their original relational judgment.
 * The new profile adds independent child facts and rank ties.
 *
 * Authority for new continuation behavior is the accepted successors design
 * v1–v5, especially the independent assessment SHA256 af9e5c9c973b07e5a34de2c9
 * bc130d84a5d8f466a506cd63f09ae8e0be65a67d. This source packet is preparation,
 * not receiving evidence, a product RED/GREEN result, or a host-progress proof.
 */
export type CompletionWindow = { offset: number; limit: number }
export type CompletionRow = {
  id: number
  rank: number
  children: Array<number>
}
export type CompletionFacade = {
  bucket: number
  handle: string
  rows: Array<number>
}
export type CompletionOutcome =
  | { state: `pending` }
  | { state: `fulfilled` }
  | { state: `rejected`; error: string }
export type CompletionOperationObservation = {
  operation: string
  returned: `promise` | `true`
  outcome: CompletionOutcome
}
export type CompletionPublicView = {
  roots: Array<CompletionRow>
  facades: Array<CompletionFacade>
  downstream: Array<CompletionRow>
  window: CompletionWindow
  status: `loading` | `ready` | `crashed` | `cleaned-up`
  requestErrors: Array<string>
}
export type CompletionFacts = {
  roots: Array<{ id: number; rank: number }>
  marked: Array<number>
  children: Array<{ id: number; parent: number }>
}
export type CompletionSetup = {
  run: string
  profile: `inline` | `facade`
  facts: CompletionFacts
  window: CompletionWindow
  ready: boolean
}

// A prerequisite is a model-only public obligation. It combines source applied
// settlement, selected graph-output visibility, or a whole successful tail.
// It is not a production participant, fence, task token, queue, or receipt map.
// The history authors dependencies before execution. Observed pending-set
// membership may confirm reach but never supplies this expected dependency set.
export type CompletionRequirement = {
  id: string
  kind: `source` | `output` | `publication`
}
export type CompletionTarget = `root` | { bucket: number }
export type CompletionOverlay =
  | { id: string; kind: `root`; row: CompletionRow }
  | { id: string; kind: `facade`; bucket: number; rows: Array<number> }
export type CompletionAction =
  | { type: `require`; requirement: CompletionRequirement }
  | {
      type: `request-window`
      operation: string
      options: Partial<CompletionWindow>
      requires: Array<string>
      // Ordinary source failures keep existing aggregation. A terminal graph
      // failure or the accepted retryable-tail rule may end the operation early.
      firstError?: string
    }
  | { type: `request-initial`; operation: string; requires: Array<string> }
  // This action combines the authored finite response with its establishing
  // applied-demand settlement. A queryFn resolving alone is an earlier driver
  // event. The receiver must observe that exact demand's applied settlement
  // before stepping this action; host-gap records both events independently.
  | { type: `source-answer`; requirement: string; facts: CompletionFacts }
  | { type: `source-write`; facts: CompletionFacts }
  | { type: `source-failure`; requirement: string; error: string }
  | {
      type: `stage-output`
      requirement: string
      target: CompletionTarget
      snapshot: `desired` | `restore`
      disposition: `retained` | `created`
    }
  | { type: `apply-output`; requirement: string }
  | { type: `rollback-dispose`; requirement: string }
  | {
      type: `install`
      target: CompletionTarget
      snapshot: `desired` | `restore`
    }
  | { type: `tail-success`; requirement: string }
  | {
      type: `tail-failure`
      requirement: string
      error: string
      affected: Array<string>
    }
  | { type: `graph-failure`; error: string }
  | { type: `cleanup` }
  | { type: `restart`; run: string; facts: CompletionFacts }
  | { type: `obsolete-delivery`; run: string }
  | { type: `optimistic-overlay`; overlay: CompletionOverlay }
  | { type: `settle-optimistic`; overlay: string }
  | { type: `mark-ready` }

type RequirementState = CompletionRequirement & {
  run: string
  outcome: CompletionOutcome
  output?: {
    target: CompletionTarget
    rows: Array<CompletionRow>
    disposition: `retained` | `created`
    snapshot: `desired` | `restore`
    abandoned: boolean
  }
}
type OperationState = {
  operation: string
  run: string
  window: CompletionWindow
  requires: Array<string>
  outcome: CompletionOutcome
  firstError?: string
}
export type CompletionModel = {
  setup: CompletionSetup
  run: string
  retired: Set<string>
  lifecycle: `live` | `crashed` | `cleaned-up`
  facts: CompletionFacts
  settledWindow: CompletionWindow
  desiredWindow: CompletionWindow | undefined
  visible: Array<CompletionRow>
  restore: Array<CompletionRow>
  facadeRows: Map<number, Array<number>>
  handles: Map<number, string>
  handleIntervals: Map<number, number>
  requirements: Map<string, RequirementState>
  operations: Array<OperationState>
  requestErrors: Array<string>
  ready: boolean
  settledRequestOrder: number
  graphError?: string
  tailFailure?: { requirement: string; error: string; affected: Array<string> }
  overlays: Array<CompletionOverlay>
}

function demand(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`completion instrument: ${label}`)
}
function runtimeTag(value: unknown, expected: string): boolean {
  return value === expected
}
function equal(actual: unknown, expected: unknown, law: string): void {
  if (!isDeepStrictEqual(actual, expected))
    throw new Error(
      `completion law: ${law}; expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    )
}
function copyFacts(facts: CompletionFacts): CompletionFacts {
  return {
    roots: facts.roots.map((row) => ({ ...row })),
    marked: [...facts.marked],
    children: facts.children.map((row) => ({ ...row })),
  }
}
function copyRows(rows: ReadonlyArray<CompletionRow>): Array<CompletionRow> {
  return rows.map((row) => ({ ...row, children: [...row.children] }))
}
function validWindow(window: CompletionWindow): void {
  demand(
    Number.isInteger(window.offset) &&
      window.offset >= 0 &&
      Number.isInteger(window.limit) &&
      window.limit >= 0,
    `window fields are nonnegative integers`,
  )
}

/**
 * Recompute from finite provider facts: remove marked roots, order by numeric
 * rank then ascending public key, take the requested window, and independently
 * collect children by parent. This follows the architecture's total order and
 * materialization laws. Children are not the anti-join's marker relation.
 */
export function modelCompletionRows(
  facts: CompletionFacts,
  window: CompletionWindow,
): Array<CompletionRow> {
  validWindow(window)
  const marked = new Set(facts.marked)
  return facts.roots
    .filter((row) => !marked.has(row.id))
    .sort((left, right) => left.rank - right.rank || left.id - right.id)
    .slice(window.offset, window.offset + window.limit)
    .map(({ id, rank }) => ({
      id,
      rank,
      children: facts.children
        .filter((child) => child.parent === id)
        .map((child) => child.id)
        .sort((left, right) => left - right),
    }))
}

/**
 * The model retains only distinctions a public next action can expose. Desired
 * and settled windows differ under partial-option inheritance. Outstanding
 * prerequisites distinguish early success from legal success. Run identity
 * distinguishes cleanup/restart from same-run retry. Installed target values
 * distinguish a pre-installation error from a status/subscriber-tail error.
 * Facade handle intervals distinguish retention from retirement/reactivation.
 * No graph revision, private task, failure classifier, or loader state decides
 * an expected result here.
 */
export function createCompletionModel(setup: CompletionSetup): CompletionModel {
  const rows = setup.ready ? modelCompletionRows(setup.facts, setup.window) : []
  const model: CompletionModel = {
    setup: structuredClone(setup),
    run: setup.run,
    retired: new Set(),
    lifecycle: `live`,
    facts: copyFacts(setup.facts),
    settledWindow: { ...setup.window },
    desiredWindow: undefined,
    visible: copyRows(rows),
    restore: copyRows(rows),
    facadeRows: new Map(rows.map((row) => [row.id, [...row.children]])),
    handles: new Map(),
    handleIntervals: new Map(),
    requirements: new Map(),
    operations: [],
    requestErrors: [],
    ready: setup.ready,
    settledRequestOrder: -1,
    overlays: [],
  }
  installHandles(model, rows)
  return model
}

function installHandles(
  model: CompletionModel,
  rows: Array<CompletionRow>,
): void {
  if (model.setup.profile !== `facade`) return
  const active = new Set(rows.map((row) => row.id))
  for (const bucket of model.handles.keys())
    if (!active.has(bucket)) model.handles.delete(bucket)
  for (const bucket of active) {
    if (model.handles.has(bucket)) continue
    const interval = (model.handleIntervals.get(bucket) ?? 0) + 1
    model.handleIntervals.set(bucket, interval)
    // Drivers label an actual object's first appearance once, then retain that
    // label by reference identity. The label is not a generated Collection ID.
    model.handles.set(bucket, `${model.run}:${bucket}:${interval}`)
  }
}
function requirement(model: CompletionModel, id: string): RequirementState {
  const found = model.requirements.get(id)
  demand(found, `unknown authored prerequisite ${id}`)
  return found
}
function install(
  model: CompletionModel,
  target: CompletionTarget,
  rows: Array<CompletionRow>,
): void {
  if (target === `root`) {
    model.visible = copyRows(rows)
    installHandles(model, rows)
  } else {
    const row = rows.find(({ id }) => id === target.bucket)
    model.facadeRows.set(target.bucket, [...(row?.children ?? [])])
  }
}
function settleOperations(model: CompletionModel): void {
  for (const [index, operation] of model.operations.entries()) {
    if (operation.outcome.state !== `pending`) continue
    const prerequisites = operation.requires.map((id) => requirement(model, id))
    if (prerequisites.some((entry) => entry.outcome.state === `pending`))
      continue
    const failure = prerequisites.find(
      (entry) => entry.outcome.state === `rejected`,
    )
    if (failure?.outcome.state === `rejected`) {
      operation.outcome = {
        state: `rejected`,
        error: operation.firstError ?? failure.outcome.error,
      }
    } else {
      operation.outcome = { state: `fulfilled` }
      if (index > model.settledRequestOrder) {
        model.settledWindow = { ...operation.window }
        model.settledRequestOrder = index
      }
    }
  }
  if (
    model.operations.every((operation) => operation.outcome.state !== `pending`)
  )
    model.desiredWindow = undefined
}

/**
 * Actions describe external semantics, not observations selected by production.
 * A source failure settles only its prerequisite and keeps existing aggregation.
 * Retryable-tail affected operations are authored in the history; the checker
 * separately compares the observed registered set. A terminal graph failure
 * ends every unfinished operation of that run. Cleanup uses AbortError first.
 * An accepted retained output may reject only through cleanup abandonment.
 * Rollback disposal applies solely to the newly created failed-attempt target.
 */
export function stepCompletionModel(
  model: CompletionModel,
  action: CompletionAction,
): void {
  if (action.type === `obsolete-delivery`) {
    demand(
      model.retired.has(action.run),
      `obsolete delivery names a retired run`,
    )
    return
  }
  if (action.type === `restart`) {
    demand(model.lifecycle === `cleaned-up`, `restart follows complete cleanup`)
    demand(
      action.run !== model.run && !model.retired.has(action.run),
      `fresh sync run`,
    )
    model.run = action.run
    model.lifecycle = `live`
    model.facts = copyFacts(action.facts)
    model.ready = false
    model.requestErrors = []
    model.graphError = undefined
    model.tailFailure = undefined
    model.visible = []
    model.restore = []
    model.facadeRows.clear()
    model.handles.clear()
    model.handleIntervals.clear()
    model.overlays = []
    return
  }
  if (action.type === `cleanup`) {
    model.retired.add(model.run)
    model.lifecycle = `cleaned-up`
    model.ready = false
    model.visible = []
    model.handles.clear()
    model.overlays = []
    for (const entry of model.requirements.values()) {
      if (entry.run !== model.run || entry.outcome.state !== `pending`) continue
      entry.outcome = { state: `rejected`, error: `AbortError` }
      if (entry.output) entry.output.abandoned = true
    }
    for (const operation of model.operations)
      if (operation.run === model.run && operation.outcome.state === `pending`)
        operation.outcome = { state: `rejected`, error: `AbortError` }
    model.desiredWindow = undefined
    return
  }
  demand(model.lifecycle === `live`, `${action.type} requires a live sync run`)
  if (action.type === `mark-ready`) {
    model.ready = true
  } else if (action.type === `optimistic-overlay`) {
    demand(
      !model.overlays.some((overlay) => overlay.id === action.overlay.id),
      `unique optimistic fixture transaction`,
    )
    model.overlays.push(structuredClone(action.overlay))
  } else if (action.type === `settle-optimistic`) {
    demand(
      model.overlays.some((overlay) => overlay.id === action.overlay),
      `settle a live optimistic fixture transaction`,
    )
    model.overlays = model.overlays.filter(
      (overlay) => overlay.id !== action.overlay,
    )
  } else if (action.type === `source-write`) {
    model.facts = copyFacts(action.facts)
  } else if (action.type === `require`) {
    demand(
      !model.requirements.has(action.requirement.id),
      `unique prerequisite`,
    )
    model.requirements.set(action.requirement.id, {
      ...action.requirement,
      run: model.run,
      outcome: { state: `pending` },
    })
  } else if (
    action.type === `request-window` ||
    action.type === `request-initial`
  ) {
    demand(
      !model.operations.some((entry) => entry.operation === action.operation),
      `unique operation`,
    )
    demand(
      action.requires.length > 0,
      `completion program has an authored prerequisite`,
    )
    for (const id of action.requires)
      demand(
        requirement(model, id).run === model.run,
        `operation uses current-run prerequisites`,
      )
    demand(
      action.requires.some(
        (id) => requirement(model, id).outcome.state === `pending`,
      ),
      `candidate operation admission has an outstanding authored obligation`,
    )
    const window =
      action.type === `request-initial`
        ? { ...model.setup.window }
        : { ...(model.desiredWindow ?? model.settledWindow), ...action.options }
    validWindow(window)
    model.desiredWindow = window
    model.operations.push({
      operation: action.operation,
      run: model.run,
      window,
      requires: [...action.requires],
      outcome: { state: `pending` },
      firstError:
        action.type === `request-window` ? action.firstError : undefined,
    })
    settleOperations(model)
  } else if (action.type === `graph-failure`) {
    model.lifecycle = `crashed`
    model.graphError = action.error
    for (const operation of model.operations)
      if (operation.run === model.run && operation.outcome.state === `pending`)
        operation.outcome = {
          state: `rejected`,
          error: operation.firstError ?? action.error,
        }
  } else if (action.type === `install`) {
    install(
      model,
      action.target,
      action.snapshot === `restore`
        ? model.restore
        : modelCompletionRows(
            model.facts,
            model.desiredWindow ?? model.settledWindow,
          ),
    )
  } else {
    const entry = requirement(model, action.requirement)
    demand(entry.run === model.run, `prerequisite belongs to the live run`)
    demand(entry.outcome.state === `pending`, `prerequisite settles once`)
    if (action.type === `source-answer` || action.type === `source-failure`) {
      demand(
        entry.kind === `source`,
        `source action uses a source prerequisite`,
      )
      if (action.type === `source-answer`) {
        model.facts = copyFacts(action.facts)
        entry.outcome = { state: `fulfilled` }
      } else {
        entry.outcome = { state: `rejected`, error: action.error }
        for (const operation of model.operations)
          if (
            operation.run === model.run &&
            operation.outcome.state === `pending` &&
            operation.requires.includes(entry.id)
          )
            operation.firstError ??= action.error
        if (!model.requestErrors.includes(action.error))
          model.requestErrors.push(action.error)
      }
    } else if (action.type === `stage-output`) {
      demand(entry.kind === `output` && !entry.output, `output stages once`)
      entry.output = {
        target: action.target,
        rows:
          action.snapshot === `restore`
            ? copyRows(model.restore)
            : modelCompletionRows(
                model.facts,
                model.desiredWindow ?? model.settledWindow,
              ),
        disposition: action.disposition,
        snapshot: action.snapshot,
        abandoned: false,
      }
    } else if (action.type === `apply-output`) {
      demand(entry.kind === `output` && entry.output, `apply a staged output`)
      install(model, entry.output.target, entry.output.rows)
      entry.outcome = { state: `fulfilled` }
    } else if (action.type === `rollback-dispose`) {
      demand(
        entry.output?.disposition === `created`,
        `only a created target has rollback disposal`,
      )
      const target = entry.output.target
      if (target !== `root`)
        model.overlays = model.overlays.filter(
          (overlay) =>
            overlay.kind !== `facade` || overlay.bucket !== target.bucket,
        )
      entry.output.abandoned = true
      entry.outcome = { state: `fulfilled` }
    } else if (action.type === `tail-success`) {
      demand(entry.kind === `publication`, `tail certifies publication`)
      // A normal pass before an applied receipt settles is not this action.
      // The certificate belongs to the later whole successful tail, after the
      // independently chosen window is installed. Rechecks that throw never
      // get this certificate, even when revisions did not change.
      const chosen = modelCompletionRows(
        model.facts,
        model.desiredWindow ?? model.settledWindow,
      )
      equal(
        model.visible,
        chosen,
        `successful tail has installed the winning authored root result`,
      )
      if (model.setup.profile === `facade`)
        for (const row of chosen)
          equal(
            model.facadeRows.get(row.id) ?? [],
            row.children,
            `successful tail has installed each retained facade result`,
          )
      for (const operation of model.operations) {
        if (
          operation.run !== model.run ||
          operation.outcome.state !== `pending` ||
          !operation.requires.includes(entry.id)
        )
          continue
        for (const id of operation.requires) {
          const dependency = requirement(model, id)
          if (dependency.kind === `output`)
            demand(
              dependency.outcome.state === `fulfilled`,
              `successful tail follows required applied output`,
            )
        }
      }
      entry.outcome = { state: `fulfilled` }
      model.ready = true
    } else {
      demand(entry.kind === `publication`, `tail failure names publication`)
      entry.outcome = { state: `rejected`, error: action.error }
      const affected = new Set(action.affected)
      demand(
        affected.size === action.affected.length,
        `unique affected operations`,
      )
      const dependent = model.operations
        .filter(
          (operation) =>
            operation.run === model.run &&
            operation.outcome.state === `pending` &&
            operation.requires.includes(entry.id),
        )
        .map((operation) => operation.operation)
      equal(
        action.affected,
        dependent,
        `tail failure scope follows independently authored prerequisites`,
      )
      model.tailFailure = {
        requirement: entry.id,
        error: action.error,
        affected: [...action.affected],
      }
      for (const id of affected) {
        const operation = model.operations.find((item) => item.operation === id)
        demand(
          operation?.run === model.run && operation.outcome.state === `pending`,
          `affected current pending operation`,
        )
        demand(
          operation.requires.includes(entry.id),
          `authored tail dependency`,
        )
        operation.outcome = {
          state: `rejected`,
          error: operation.firstError ?? action.error,
        }
      }
    }
    settleOperations(model)
  }
}

export function modelCompletionView(
  model: CompletionModel,
): CompletionPublicView {
  let roots = copyRows(model.visible).map((row) => ({
    ...row,
    children:
      model.setup.profile === `facade`
        ? [...(model.facadeRows.get(row.id) ?? [])]
        : row.children,
  }))
  // Fixture holds are real persisting optimistic transactions. Whole-row
  // snapshots overlay the applied target until settlement (optimistic owner).
  // Keeping them explicit prevents a hold from silently changing expected
  // public payload. These fixtures update present keys without changing order.
  for (const overlay of model.overlays) {
    if (overlay.kind === `root`)
      roots = roots.map((row) =>
        row.id === overlay.row.id
          ? {
              ...copyRows([overlay.row])[0]!,
              children:
                model.setup.profile === `facade`
                  ? row.children
                  : [...overlay.row.children],
            }
          : row,
      )
    else
      roots = roots.map((row) =>
        row.id === overlay.bucket
          ? { ...row, children: [...overlay.rows] }
          : row,
      )
  }
  return {
    roots,
    facades:
      model.setup.profile === `facade`
        ? roots.map((row) => ({
            bucket: row.id,
            handle: model.handles.get(row.id)!,
            rows: [...row.children],
          }))
        : [],
    downstream: copyRows(roots),
    window: { ...model.settledWindow },
    status:
      model.lifecycle === `live`
        ? model.ready
          ? `ready`
          : `loading`
        : model.lifecycle,
    requestErrors: [...model.requestErrors],
  }
}

type CandidateCommon = {
  phase: `candidate-cut`
  run: string
  view: CompletionPublicView
  operations: Array<CompletionOperationObservation>
}
type CompletionStateObservation = Pick<
  CandidateCommon,
  `run` | `view` | `operations`
>
/**
 * Each cut carries the actual boundary facts needed for reach. These facts do
 * not compute expected rows or affected operations. Sequence numbers are
 * local recorder order; error tokens preserve in-process object identity.
 * A missing field or unknown cut fails validation instead of being ignored by
 * the primary owner's extensible receipt transport.
 */
export type CandidateObservation = CandidateCommon &
  (
    | {
        cut: `trigger`
        holdBeforeDemand: boolean
        changed: boolean
        readyWasPromise: boolean
        inputBefore: number
        inputAfter: number
        pendingD2: boolean
      }
    | {
        cut: `operator-stop`
        completedOperator: boolean
        remainingWork: boolean
        returnedBeforeTail: boolean
      }
    | {
        cut: `host-gap`
        answerExecuted: boolean
        demandSettled: boolean
        queuedTask: number
        dispatches: number
        existingOperation: string
        partialOperation?: string
      }
    | {
        cut: `repeated-yield`
        enqueues: Array<number>
        acceptedResumes: number
        operation: string
      }
    | {
        cut: `held-flush`
        graphQuiescent: boolean
        realFlushEntered: boolean
        flushHeld: boolean
        queuedTasks: number
        operation: string
      }
    | {
        cut: `receipt-held`
        receipts: Array<{
          requirement: string
          target: CompletionTarget
          role: `forward` | `restore`
          returnedPromise: boolean
          pending: boolean
          beforeFirstStop: boolean
        }>
      }
    | {
        cut: `facade-attempt-failed`
        facadeACommit: number
        facadeBThrow: number
        aReceiptPending: boolean
        restoringReceiptPending: boolean
      }
    | {
        cut: `retry-attached`
        oldOperation: string
        retryOperation: string
        queuedTaskBefore: number
        queuedTaskAfter: number
        rejectedCompletion: string
        replacementCompletion: string
        graphEntriesBeforeDispatch: number
      }
    | {
        cut: `old-completion-delivered`
        oldCompletion: string
        currentCompletion: string
        retryAttachedBeforeDelivery: boolean
      }
    | {
        cut: `rollback-disposal-delivered`
        targetCreatedByFailedAttempt: boolean
        explicitlyMarkedBeforeDisposal: boolean
        retryAttachedBeforeRejection: boolean
      }
    | {
        cut: `retained-cleanup-abandoned`
        requirement: string
        acceptedAt: number
        cleanupStartedAt: number
        rejectedAt: number
        receiptError: string
        retainedTarget: boolean
        retiredRun: string
      }
    | {
        cut: `graph-failed`
        error: string
        peerPending: boolean
        resumedGraphEntered: boolean
      }
    | {
        cut: `source-failed`
        error: string
        peerPending: boolean
        requirement: string
      }
    | {
        cut: `tail-failed`
        error: string
        lastReceiptSettled: boolean
        realTailEntered: boolean
        inputBefore: number
        inputAfter: number
        windowBefore: number
        windowAfter: number
      }
    | {
        cut: `installed-tail-failed`
        error: string
        installedAt: number
        realStatusCallbackAt: number
        thrownAt: number
      }
    | {
        cut: `retryable-scope-failed`
        error: string
        registeredAffected: Array<string>
        authoredAffected: Array<string>
        peerPending: boolean
        installedBeforeThrow: boolean
      }
    | {
        cut: `stale-task`
        retiredRun: string
        currentTaskBefore: number
        currentTaskAfter: number
        staleDispatches: number
        staleGraphEntries: number
        currentAcceptedResumes: number
      }
    | {
        cut: `final`
        winningOperation: string
        wholeTailReturned: boolean
        graphRunning: boolean
        pendingRequiredReceipts: number
      }
  )

function positive(value: number, name: string): void {
  demand(
    Number.isInteger(value) && value > 0,
    `${name} is a positive recorder identity`,
  )
}
function revision(value: number, name: string): void {
  demand(
    Number.isInteger(value) && value >= 0,
    `${name} is a nonnegative revision`,
  )
}
function booleanFields(value: object, names: ReadonlyArray<string>): void {
  const fields = value as Record<string, unknown>
  for (const name of names)
    demand(
      typeof fields[name] === `boolean`,
      `required boolean evidence ${name}`,
    )
}
function identity(value: unknown, label: string): void {
  demand(typeof value === `string` && value.length > 0, label)
}

function checkAuthoredTailError(
  model: CompletionModel,
  observed: unknown,
  law: string,
): void {
  identity(observed, `throwing tail has a recorded error identity`)
  demand(model.tailFailure, `throwing tail has an authored failure`)
  identity(model.tailFailure.error, `authored tail has an error identity`)
  equal(observed, model.tailFailure.error, law)
}

/**
 * Validate evidence and compare at the same cut. A host-gap operation remains
 * pending even after its finite answer settled. A held/no-delta flush is not
 * success. Failure observations use the explicitly stepped failure branch;
 * they never weaken the primary owner's successful-answer checker.
 *
 * Comparison here is after callback delivery. A driver observing inside a root
 * callback must use its layer's payload/read comparison separately; downstream
 * need not advance until that callback's transaction-scoped scheduler runs.
 */
export function checkCompletionObservation(
  model: CompletionModel,
  observation: CandidateObservation,
): void {
  demand(
    runtimeTag(observation.phase, `candidate-cut`),
    `unknown candidate receipt phase`,
  )
  checkCompletionPublicState(model, observation)
  const booleans: Record<CandidateObservation[`cut`], ReadonlyArray<string>> = {
    trigger: [`holdBeforeDemand`, `changed`, `readyWasPromise`, `pendingD2`],
    'operator-stop': [
      `completedOperator`,
      `remainingWork`,
      `returnedBeforeTail`,
    ],
    'host-gap': [`answerExecuted`, `demandSettled`],
    'repeated-yield': [],
    'held-flush': [`graphQuiescent`, `realFlushEntered`, `flushHeld`],
    'receipt-held': [],
    'facade-attempt-failed': [`aReceiptPending`, `restoringReceiptPending`],
    'retry-attached': [],
    'old-completion-delivered': [`retryAttachedBeforeDelivery`],
    'rollback-disposal-delivered': [
      `targetCreatedByFailedAttempt`,
      `explicitlyMarkedBeforeDisposal`,
      `retryAttachedBeforeRejection`,
    ],
    'retained-cleanup-abandoned': [`retainedTarget`],
    'graph-failed': [`peerPending`, `resumedGraphEntered`],
    'source-failed': [`peerPending`],
    'tail-failed': [`lastReceiptSettled`, `realTailEntered`],
    'installed-tail-failed': [],
    'retryable-scope-failed': [`peerPending`, `installedBeforeThrow`],
    'stale-task': [],
    final: [`wholeTailReturned`, `graphRunning`],
  }
  demand(
    Object.hasOwn(booleans, observation.cut),
    `unknown candidate cut ${String(observation.cut)}`,
  )
  booleanFields(observation, booleans[observation.cut])
  switch (observation.cut) {
    case `trigger`:
      revision(observation.inputBefore, `trigger input before`)
      revision(observation.inputAfter, `trigger input after`)
      demand(
        observation.holdBeforeDemand &&
          observation.changed &&
          observation.readyWasPromise &&
          observation.pendingD2,
        `qualifying demand trigger conjunction`,
      )
      demand(
        observation.inputAfter > observation.inputBefore,
        `exact builder input advanced synchronously`,
      )
      break
    case `operator-stop`:
      demand(
        observation.completedOperator &&
          observation.remainingWork &&
          observation.returnedBeforeTail,
        `complete operator stop retains work before tail`,
      )
      break
    case `host-gap`:
      identity(
        observation.existingOperation,
        `host-gap existing operation identity`,
      )
      if (observation.partialOperation !== undefined)
        identity(
          observation.partialOperation,
          `host-gap partial operation identity`,
        )
      demand(
        observation.answerExecuted && observation.demandSettled,
        `actual answer and last relevant demand settled`,
      )
      positive(observation.queuedTask, `queued task`)
      equal(
        observation.dispatches,
        0,
        `exact continuation remains undispatched at host gap`,
      )
      for (const id of [
        observation.existingOperation,
        observation.partialOperation,
      ].filter((entry) => entry !== undefined))
        equal(
          model.operations.find((operation) => operation.operation === id)
            ?.outcome,
          { state: `pending` },
          `host-gap operation retains its publication obligation`,
        )
      break
    case `repeated-yield`:
      demand(
        Array.isArray(observation.enqueues),
        `enqueue observations are present`,
      )
      for (const enqueue of observation.enqueues)
        positive(enqueue, `real enqueue`)
      revision(observation.acceptedResumes, `accepted resumes`)
      demand(
        new Set(observation.enqueues).size >= 2 &&
          observation.acceptedResumes >= 1,
        `distinct real yields with accepted resumption`,
      )
      equal(
        model.operations.find(
          (operation) => operation.operation === observation.operation,
        )?.outcome,
        { state: `pending` },
        `repeated yield preserves the original public obligation`,
      )
      break
    case `held-flush`:
      demand(
        observation.graphQuiescent &&
          observation.realFlushEntered &&
          observation.flushHeld,
        `real no-delta flush still withheld`,
      )
      equal(
        observation.queuedTasks,
        0,
        `held-flush can outlive the consumed task`,
      )
      equal(
        model.operations.find(
          (operation) => operation.operation === observation.operation,
        )?.outcome,
        { state: `pending` },
        `quiescence alone cannot settle a window`,
      )
      break
    case `receipt-held`:
      demand(
        observation.receipts.length > 0,
        `selected real applied receipts recorded`,
      )
      for (const receipt of observation.receipts) {
        booleanFields(receipt, [
          `returnedPromise`,
          `pending`,
          `beforeFirstStop`,
        ])
        const entry = requirement(model, receipt.requirement)
        demand(
          entry.output && receipt.returnedPromise && receipt.pending,
          `actual selected output receipt remains pending`,
        )
        equal(
          entry.outcome,
          { state: `pending` },
          `selected authored output remains unapplied`,
        )
        equal(
          receipt.target,
          entry.output.target,
          `receipt target matches authored target`,
        )
        equal(
          receipt.role,
          entry.output.snapshot === `restore` ? `restore` : `forward`,
          `receipt role matches authored forward/restoration output`,
        )
      }
      break
    case `facade-attempt-failed`:
      positive(observation.facadeACommit, `facade A commit sequence`)
      positive(observation.facadeBThrow, `facade B throw sequence`)
      demand(
        observation.facadeACommit < observation.facadeBThrow &&
          observation.aReceiptPending &&
          observation.restoringReceiptPending,
        `A receipt captured before B throw and real restoration held`,
      )
      break
    case `retry-attached`:
      identity(observation.rejectedCompletion, `old completion identity`)
      identity(
        observation.replacementCompletion,
        `replacement completion identity`,
      )
      positive(observation.queuedTaskBefore, `retry queued task`)
      equal(
        observation.queuedTaskAfter,
        observation.queuedTaskBefore,
        `retry preserves exact queued task`,
      )
      demand(
        observation.rejectedCompletion !== observation.replacementCompletion,
        `retry replaces failed completion`,
      )
      equal(
        observation.graphEntriesBeforeDispatch,
        0,
        `retry cannot consume the host gap synchronously`,
      )
      equal(
        model.operations.find(
          (operation) => operation.operation === observation.retryOperation,
        )?.outcome,
        { state: `pending` },
        `retry has a fresh pending operation`,
      )
      demand(
        model.operations.find(
          (operation) => operation.operation === observation.oldOperation,
        )?.outcome.state === `rejected`,
        `old failed operation stays rejected`,
      )
      break
    case `old-completion-delivered`:
      identity(observation.oldCompletion, `old delivered completion identity`)
      identity(observation.currentCompletion, `current completion identity`)
      demand(
        observation.oldCompletion !== observation.currentCompletion &&
          observation.retryAttachedBeforeDelivery,
        `actual old observer delivered after replacement attached`,
      )
      break
    case `rollback-disposal-delivered`:
      demand(
        observation.targetCreatedByFailedAttempt &&
          observation.explicitlyMarkedBeforeDisposal &&
          observation.retryAttachedBeforeRejection,
        `only explicit old rollback disposal gets the exemption`,
      )
      break
    case `retained-cleanup-abandoned`: {
      positive(observation.acceptedAt, `accepted output sequence`)
      positive(observation.cleanupStartedAt, `cleanup start sequence`)
      positive(observation.rejectedAt, `abandoned output sequence`)
      const entry = requirement(model, observation.requirement)
      demand(
        entry.output?.disposition === `retained` && entry.output.abandoned,
        `retained accepted output legally abandoned by cleanup`,
      )
      demand(
        observation.acceptedAt < observation.cleanupStartedAt &&
          observation.cleanupStartedAt < observation.rejectedAt,
        `acceptance precedes cleanup then receipt rejection`,
      )
      equal(
        observation.receiptError,
        `AbortError`,
        `cleanup receipt abandonment has AbortError`,
      )
      demand(
        observation.retainedTarget &&
          model.retired.has(observation.retiredRun) &&
          entry.run === observation.retiredRun,
        `abandoned receipt belongs to retired target run`,
      )
      break
    }
    case `graph-failed`:
      demand(
        observation.peerPending && observation.resumedGraphEntered,
        `terminal resumed graph failure precedes unanswered peer`,
      )
      equal(
        observation.error,
        model.graphError,
        `terminal graph preserves exact thrown error`,
      )
      equal(
        model.lifecycle,
        `crashed`,
        `terminal graph failure crashes the run`,
      )
      break
    case `source-failed`:
      demand(
        observation.peerPending &&
          requirement(model, observation.requirement).kind === `source`,
        `ordinary source failure has a real unanswered peer`,
      )
      demand(
        [...model.requirements.values()].some(
          (entry) =>
            entry.run === model.run &&
            entry.kind === `source` &&
            entry.outcome.state === `pending`,
        ),
        `ordinary failure keeps a pending source peer`,
      )
      equal(
        requirement(model, observation.requirement).outcome,
        { state: `rejected`, error: observation.error },
        `source failure preserves its exact identity`,
      )
      break
    case `tail-failed`:
      revision(observation.inputBefore, `recheck input before`)
      revision(observation.inputAfter, `recheck input after`)
      revision(observation.windowBefore, `recheck window before`)
      revision(observation.windowAfter, `recheck window after`)
      demand(
        observation.lastReceiptSettled && observation.realTailEntered,
        `last receipt starts a real throwing recheck tail`,
      )
      checkAuthoredTailError(
        model,
        observation.error,
        `recheck tail preserves exact error`,
      )
      equal(
        observation.inputAfter,
        observation.inputBefore,
        `recheck uses unchanged input revision`,
      )
      equal(
        observation.windowAfter,
        observation.windowBefore,
        `recheck uses unchanged window revision`,
      )
      break
    case `installed-tail-failed`:
      positive(observation.installedAt, `installation sequence`)
      positive(observation.realStatusCallbackAt, `status callback sequence`)
      positive(observation.thrownAt, `tail throw sequence`)
      demand(
        observation.installedAt < observation.realStatusCallbackAt &&
          observation.realStatusCallbackAt <= observation.thrownAt,
        `actual status tail throws after coherent state installation`,
      )
      checkAuthoredTailError(
        model,
        observation.error,
        `status tail preserves exact error`,
      )
      break
    case `retryable-scope-failed`: {
      demand(
        observation.peerPending && observation.installedBeforeThrow,
        `retryable subscriber tail has installed state and unanswered peer`,
      )
      const authored = model.tailFailure?.affected
      demand(authored, `tail failure was authored before comparison`)
      checkAuthoredTailError(
        model,
        observation.error,
        `retryable tail preserves exact error`,
      )
      equal(
        observation.authoredAffected,
        authored,
        `affected names are independently authored operations`,
      )
      equal(
        observation.registeredAffected,
        authored,
        `actual attachment matches authored dependency scope`,
      )
      for (const id of authored)
        demand(
          model.operations.find((operation) => operation.operation === id)
            ?.outcome.state === `rejected`,
          `attached operation rejects before peer`,
        )
      break
    }
    case `stale-task`:
      demand(
        model.retired.has(observation.retiredRun),
        `stale task belongs to retired sync run`,
      )
      positive(observation.currentTaskBefore, `live replacement task`)
      equal(
        observation.currentTaskAfter,
        observation.currentTaskBefore,
        `stale callback cannot clear live task`,
      )
      revision(
        observation.currentAcceptedResumes,
        `replacement accepted resumes`,
      )
      equal(
        observation.staleDispatches,
        1,
        `canceled old task actually dispatched`,
      )
      equal(
        observation.staleGraphEntries,
        0,
        `old task cannot enter replacement graph`,
      )
      demand(
        observation.currentAcceptedResumes > 0,
        `live replacement task positively resumes`,
      )
      break
    case `final`:
      demand(
        observation.wholeTailReturned && !observation.graphRunning,
        `success follows whole tail and graph unwind`,
      )
      equal(
        observation.pendingRequiredReceipts,
        0,
        `success awaits every selected required output`,
      )
      {
        const current = model.operations.filter(
          (operation) => operation.run === model.run,
        )
        const winning = current.at(-1)
        equal(
          observation.winningOperation,
          winning?.operation,
          `final names the independently authored winning request`,
        )
        demand(
          model.lifecycle === `live` &&
            winning?.outcome.state === `fulfilled` &&
            current.every((operation) => operation.outcome.state !== `pending`),
          `winning operation fulfills after earlier outcomes stay settled`,
        )
      }
      break
    default:
      throw new Error(
        `completion instrument: unknown candidate cut ${String((observation as { cut: unknown }).cut)}`,
      )
  }
}

function checkCompletionPublicState(
  model: CompletionModel,
  observation: CompletionStateObservation,
): void {
  equal(observation.run, model.run, `observation belongs to current sync run`)
  equal(
    observation.view,
    modelCompletionView(model),
    `coherent public values, handles, health and settled window`,
  )
  equal(
    observation.operations,
    model.operations.map((operation) => ({
      operation: operation.operation,
      returned: `promise`,
      outcome: operation.outcome,
    })),
    `original public operation results follow authored dependencies`,
  )
}

export type CompletionBaselineObservation = CompletionStateObservation & {
  phase: `completion-baseline-cut`
} & (
    | {
        boundary: `held-window`
        operation: string
        pendingProviderAnswers: number
      }
    | {
        boundary: `held-output`
        receipts: Array<{
          requirement: string
          target: CompletionTarget
          role: `forward` | `restore`
          returnedPromise: boolean
          pending: boolean
        }>
      }
    | {
        boundary: `source-failed-peer`
        requirement: string
        error: string
        peerPending: boolean
      }
    | {
        boundary: `facade-rollback`
        committedAt: number
        threwAt: number
        forwardRequirement: string
        restorationRequirement: string
      }
    | {
        boundary: `installed-tail-exception`
        error: string
        installedAt: number
        callbackAt: number
        threwAt: number
      }
    | {
        boundary: `cleanup-abandoned`
        requirement: string
        retiredRun: string
        acceptedAt: number
        cleanupStartedAt: number
        rejectedAt: number
        error: string
      }
    | { boundary: `completed-window`; operation: string }
    | { boundary: `public-state` }
    | { boundary: `graph-exception`; error: string; graphEntered: boolean }
  )

/**
 * Baseline constituent paths use the same public model and callbacks without
 * inventing candidate tokens, completion incarnations or registration facts.
 * Their authored dependencies name only applicable baseline source/output
 * obligations. A standalone tail-failure prerequisite with affected=[] records
 * a real baseline callback exception; it does not assert the future captured
 * completion's early-ending rule. Candidate programs attach that independently
 * authored obligation separately. Baseline reaches never populate the raw20
 * candidate states and do not replace real-host continuation evidence.
 */
export function checkCompletionBaselineObservation(
  model: CompletionModel,
  observation: CompletionBaselineObservation,
): void {
  demand(
    runtimeTag(observation.phase, `completion-baseline-cut`),
    `unknown baseline completion phase`,
  )
  checkCompletionPublicState(model, observation)
  switch (observation.boundary) {
    case `held-window`:
      positive(
        observation.pendingProviderAnswers,
        `actual held provider answers`,
      )
      equal(
        model.operations.find(
          (operation) => operation.operation === observation.operation,
        )?.outcome,
        { state: `pending` },
        `held source retains original window operation`,
      )
      break
    case `held-output`:
      demand(
        observation.receipts.length > 0,
        `actual baseline output receipts recorded`,
      )
      for (const receipt of observation.receipts) {
        booleanFields(receipt, [`returnedPromise`, `pending`])
        demand(
          receipt.returnedPromise && receipt.pending,
          `actual baseline applied receipt remains pending`,
        )
        const entry = requirement(model, receipt.requirement)
        demand(entry.output, `authored baseline output exists`)
        equal(
          entry.outcome,
          { state: `pending` },
          `selected baseline output remains unapplied`,
        )
        equal(
          receipt.target,
          entry.output.target,
          `baseline output binds exact authored target`,
        )
        equal(
          receipt.role,
          entry.output.snapshot === `restore` ? `restore` : `forward`,
          `baseline output role matches authored output`,
        )
      }
      break
    case `source-failed-peer`:
      booleanFields(observation, [`peerPending`])
      demand(observation.peerPending, `actual baseline peer remains unanswered`)
      equal(
        requirement(model, observation.requirement).outcome,
        { state: `rejected`, error: observation.error },
        `baseline source failure preserves exact identity`,
      )
      demand(
        [...model.requirements.values()].some(
          (entry) =>
            entry.run === model.run &&
            entry.kind === `source` &&
            entry.outcome.state === `pending`,
        ),
        `ordinary baseline source aggregation still has a pending peer`,
      )
      break
    case `facade-rollback`:
      positive(observation.committedAt, `actual baseline A commit`)
      positive(observation.threwAt, `actual baseline later throw`)
      demand(
        observation.committedAt < observation.threwAt,
        `baseline receipt capture precedes next target throw`,
      )
      for (const id of [
        observation.forwardRequirement,
        observation.restorationRequirement,
      ]) {
        const entry = requirement(model, id)
        demand(
          entry.output?.disposition === `retained`,
          `baseline rollback retains target obligation`,
        )
        equal(
          entry.outcome,
          { state: `pending` },
          `baseline retained output remains required`,
        )
      }
      equal(
        requirement(model, observation.restorationRequirement).output?.snapshot,
        `restore`,
        `baseline comparison names actual restoration obligation`,
      )
      break
    case `installed-tail-exception`:
      positive(observation.installedAt, `actual baseline installation`)
      positive(observation.callbackAt, `actual baseline callback`)
      positive(observation.threwAt, `actual baseline callback throw`)
      demand(
        observation.installedAt < observation.callbackAt &&
          observation.callbackAt <= observation.threwAt,
        `baseline installed state precedes real callback exception`,
      )
      checkAuthoredTailError(
        model,
        observation.error,
        `baseline tail preserves exact exception without invented candidate scope`,
      )
      break
    case `cleanup-abandoned`: {
      const entry = requirement(model, observation.requirement)
      positive(observation.acceptedAt, `baseline accepted output`)
      positive(observation.cleanupStartedAt, `baseline cleanup start`)
      positive(observation.rejectedAt, `baseline abandoned output`)
      demand(
        observation.acceptedAt < observation.cleanupStartedAt &&
          observation.cleanupStartedAt < observation.rejectedAt,
        `baseline acceptance precedes cleanup then abandonment`,
      )
      demand(
        entry.output?.abandoned &&
          model.retired.has(observation.retiredRun) &&
          entry.run === observation.retiredRun,
        `baseline abandonment belongs to the retired target run`,
      )
      equal(
        observation.error,
        `AbortError`,
        `baseline cleanup abandonment rejects with AbortError`,
      )
      break
    }
    case `completed-window`:
      equal(
        model.operations.find(
          (operation) => operation.operation === observation.operation,
        )?.outcome,
        { state: `fulfilled` },
        `baseline chosen public window is complete`,
      )
      break
    case `public-state`:
      break
    case `graph-exception`:
      booleanFields(observation, [`graphEntered`])
      demand(
        observation.graphEntered,
        `actual baseline graph entered before its fault`,
      )
      equal(
        model.lifecycle,
        `crashed`,
        `baseline graph failure crashes its own run`,
      )
      equal(
        observation.error,
        model.graphError,
        `baseline graph preserves exact thrown error`,
      )
      break
    default:
      throw new Error(
        `completion instrument: unknown baseline boundary ${String((observation as { boundary: unknown }).boundary)}`,
      )
  }
}

export type CompletionDelivery =
  | {
      phase: `candidate-delivery`
      layer: `root` | `downstream`
      rows: Array<CompletionRow>
      read: Array<CompletionRow>
      changes: Array<{
        type: `insert` | `update` | `delete`
        value: CompletionRow
        previousValue?: CompletionRow
        handle?: string
        previousHandle?: string
      }>
    }
  | {
      phase: `candidate-delivery`
      layer: `facade`
      bucket: number
      handle: string
      rows: Array<number>
      read: Array<number>
      changes: Array<{
        type: `insert` | `update` | `delete`
        value: number
        previousValue?: number
      }>
    }

/**
 * Accumulate actual events without collapsing duplicates. Each layer's callback
 * payload and synchronous read match its independently authored installed state.
 * A root callback need not have advanced downstream yet. Facade children change
 * through the facade's own events, so a parent event replica compares root
 * id/rank/handle, not a snapshot of that mutable child Collection's contents.
 * Inline roots retain their full immutable child payload in the replica.
 */
export function createCompletionDeliveryCheck(
  setup: CompletionSetup,
  initialMembership: `setup` | `empty` = `setup`,
) {
  // Use `empty` only for the actual initialization insert stream. A receiver
  // beginning after established publication seeds the prior setup instead.
  const initial = modelCompletionView(
    createCompletionModel(
      initialMembership === `empty` ? { ...setup, ready: false } : setup,
    ),
  )
  const rootValue = (row: CompletionRow, handle?: string) =>
    setup.profile === `facade` ? { id: row.id, rank: row.rank, handle } : row
  const initialHandle = (id: number) =>
    initial.facades.find((facade) => facade.bucket === id)?.handle
  const roots = new Map(
    initial.roots.map((row) => [row.id, rootValue(row, initialHandle(row.id))]),
  )
  const downstream = new Map(roots)
  const facades = new Map(
    initial.facades.map((facade) => [
      facade.handle,
      new Map(facade.rows.map((id) => [id, id])),
    ]),
  )
  return (model: CompletionModel, delivery: CompletionDelivery): void => {
    demand(
      runtimeTag(delivery.phase, `candidate-delivery`),
      `unknown candidate delivery phase`,
    )
    const expected = modelCompletionView(model)
    if (delivery.layer === `facade`) {
      const facade = expected.facades.find(
        (entry) => entry.bucket === delivery.bucket,
      )
      demand(facade, `facade delivery names a public active bucket`)
      equal(
        delivery.handle,
        facade.handle,
        `facade callback retains its public handle`,
      )
      equal(
        delivery.rows,
        facade.rows,
        `facade callback has complete authored content`,
      )
      equal(
        delivery.read,
        facade.rows,
        `facade callback read agrees with payload snapshot`,
      )
      const replica = facades.get(delivery.handle) ?? new Map<number, number>()
      const changed = new Set<number>()
      for (const change of delivery.changes) {
        demand(
          !changed.has(change.value),
          `one facade change per key in a callback`,
        )
        changed.add(change.value)
        if (change.type === `insert`) {
          demand(
            !replica.has(change.value),
            `facade insert has no previous row`,
          )
          replica.set(change.value, change.value)
        } else {
          demand(
            replica.has(change.value),
            `facade update/delete has a previous row`,
          )
          if (change.type === `delete`) replica.delete(change.value)
          else
            demand(
              runtimeTag(change.type, `update`),
              `known facade change operation`,
            )
        }
      }
      equal(
        [...replica.values()].sort((left, right) => left - right),
        facade.rows,
        `facade changes reconstruct callback content`,
      )
      facades.set(delivery.handle, replica)
      return
    }
    demand(
      runtimeTag(delivery.layer, `root`) ||
        runtimeTag(delivery.layer, `downstream`),
      `known callback layer`,
    )
    const rows =
      delivery.layer === `root` ? expected.roots : expected.downstream
    equal(delivery.rows, rows, `callback has complete authored root content`)
    equal(
      delivery.read,
      rows,
      `callback synchronous read agrees with its snapshot`,
    )
    const replica = delivery.layer === `root` ? roots : downstream
    const changed = new Set<number>()
    for (const change of delivery.changes) {
      const id = change.value.id
      demand(!changed.has(id), `one root change per key in a callback`)
      changed.add(id)
      const next = rootValue(change.value, change.handle)
      const previous = replica.get(id)
      if (change.type === `insert`) {
        demand(previous === undefined, `root insert has no previous row`)
        replica.set(id, next)
      } else {
        demand(previous !== undefined, `root update/delete has a previous row`)
        if (change.type === `delete`) {
          equal(next, previous, `delete carries the preceding public value`)
          replica.delete(id)
        } else {
          demand(
            runtimeTag(change.type, `update`),
            `known root change operation`,
          )
          if (change.previousValue)
            equal(
              rootValue(change.previousValue, change.previousHandle),
              previous,
              `update carries the preceding public value`,
            )
          replica.set(id, next)
        }
      }
    }
    equal(
      [...replica].sort(([left], [right]) => left - right),
      rows
        .map((row) => [
          row.id,
          rootValue(
            row,
            expected.facades.find((facade) => facade.bucket === row.id)?.handle,
          ),
        ])
        .sort(([left], [right]) => Number(left) - Number(right)),
      `event membership and values reconstruct the complete callback snapshot`,
    )
  }
}

export function checkCompletionBaselineView(
  setup: CompletionSetup,
  actual: CompletionPublicView,
): void {
  equal(
    actual,
    modelCompletionView(createCompletionModel(setup)),
    `baseline fixture establishes the same independently authored public value`,
  )
}

declareOracle({
  model: [
    modelCompletionRows,
    createCompletionModel,
    stepCompletionModel,
    modelCompletionView,
  ],
  check: [
    checkCompletionObservation,
    createCompletionDeliveryCheck,
    checkCompletionBaselineView,
    checkCompletionBaselineObservation,
  ],
})
