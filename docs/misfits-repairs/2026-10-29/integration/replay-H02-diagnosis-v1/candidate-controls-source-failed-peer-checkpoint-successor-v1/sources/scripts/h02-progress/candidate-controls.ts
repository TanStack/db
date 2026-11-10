import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { vi } from 'vitest'
import { createOracleReach } from '../../packages/db/tests/oracle-reach.js'

/**
 * Future-candidate receiving controls for the assessed v3/v4/v5 design.
 * These are observations and fault controls, not a second product model.
 * Install the narrow module replacement before importing the production path.
 * Baseline has no such module: admission refuses it instead of adding a stub.
 * Actual-host progress still uses the real scheduler in the primary driver.
 *
 * Local task IDs identify callback records, not private builder tokens or
 * completion incarnations. Dispatch is not accepted graph resumption.
 * Candidate-specific reach remains UNREACHED until an admitted receiving
 * driver binds the exact graph, public operations, and output targets.
 */
export type ControlledGraphTask = {
  id: number
  callback: () => void
  cancelled: boolean
  dispatches: number
}

export function createControlledGraphTasks() {
  const records: Array<ControlledGraphTask> = []
  let dispatching: number | undefined
  const select = (id: number) => {
    const task = records.find((record) => record.id === id)
    if (!task) throw new Error('unknown exact controlled graph task')
    return task
  }
  const dispatch = (task: ControlledGraphTask) => {
    if (dispatching !== undefined)
      throw new Error('nested controlled task dispatch is not a host-task cut')
    task.dispatches++
    dispatching = task.id
    try {
      task.callback()
    } finally {
      dispatching = undefined
    }
  }
  return {
    scheduleGraphContinuation(callback: () => void) {
      const task = {
        id: records.length + 1,
        callback,
        cancelled: false,
        dispatches: 0,
      }
      records.push(task)
      return () => {
        task.cancelled = true
      }
    },
    dispatch(id: number) {
      const task = select(id)
      if (task.cancelled)
        throw new Error('use deliberate stale dispatch for a cancelled task')
      dispatch(task)
    },
    dispatchStale(id: number) {
      dispatch(select(id))
    },
    dispatching: () => dispatching,
    records: () =>
      records.map(({ id, cancelled, dispatches }) => ({
        id,
        cancelled,
        dispatches,
      })),
  }
}

export function installCandidateContinuationControl(
  worktree: string,
  queue: ReturnType<typeof createControlledGraphTasks>,
) {
  const module = resolve(
    worktree,
    'packages/db/src/query/live/graph-continuation.ts',
  )
  if (!existsSync(module))
    throw new Error(
      'candidate continuation seam is absent; baseline controls cannot use it',
    )
  vi.doMock(module, () => ({
    scheduleGraphContinuation: queue.scheduleGraphContinuation,
  }))
  return () => vi.doUnmock(module)
}

/**
 * Bind only the actual receiving query's graph instance. A stale callback can
 * dispatch with zero graph entries; another query's run cannot satisfy reach.
 * A fault applies once, only to this graph during a controlled task dispatch.
 */
export function observeExactCandidateGraph<Args extends Array<unknown>, Result>(
  graph: { run: (...args: Args) => Result },
  queue: ReturnType<typeof createControlledGraphTasks>,
) {
  const original = graph.run
  const own = Object.getOwnPropertyDescriptor(graph, 'run')
  const entries: Array<{ dispatchId: number | undefined; faulted: boolean }> =
    []
  let nextFault: { error: unknown } | undefined
  const wrapped = function (this: typeof graph, ...args: Args): Result {
    const dispatchId = queue.dispatching()
    const fault = dispatchId === undefined ? undefined : nextFault
    if (fault) nextFault = undefined
    entries.push({ dispatchId, faulted: fault !== undefined })
    if (fault) throw fault.error
    return original.apply(this, args)
  }
  graph.run = wrapped
  return {
    entries: () => entries.map((entry) => ({ ...entry })),
    failNextDispatchedRun(error: unknown) {
      if (nextFault)
        throw new Error('an exact graph-run fault is already armed')
      nextFault = { error }
    },
    restore() {
      if (graph.run !== wrapped)
        throw new Error('exact graph-run instrument was replaced')
      if (own) Object.defineProperty(graph, 'run', own)
      else Reflect.deleteProperty(graph, 'run')
    },
  }
}

export type PromiseObservation =
  | { state: 'pending' }
  | { state: 'fulfilled' }
  | { state: 'rejected'; error: unknown }

/** Observe the original promise without substituting its result or error. */
export function observeCandidatePromise(promise: Promise<unknown>) {
  let observation: PromiseObservation = { state: 'pending' }
  void promise.then(
    () => {
      observation = { state: 'fulfilled' }
    },
    (error: unknown) => {
      observation = { state: 'rejected', error }
    },
  )
  return () => observation
}

/**
 * Attach to the real public root/facade subscription at the intended tail.
 * This callback throws only after the driver supplies the measured delivery.
 * It neither simulates a commit receipt nor swallows the host-reported error.
 */
export function failOneCandidatePublication<Delivery>(
  error: unknown,
  reached: (delivery: Delivery) => boolean,
) {
  const deliveries: Array<Delivery> = []
  let injected = false
  return {
    callback(delivery: Delivery) {
      deliveries.push(delivery)
      if (!injected && reached(delivery)) {
        injected = true
        throw error
      }
    },
    observations: () => ({ injected, deliveries: [...deliveries] }),
  }
}

/**
 * Record actual returned applied receipts and explicit rollback disposal.
 * Receiving wrappers supply exact target/attempt objects at the real commit
 * return and dispose call. No classification based on AbortError or age occurs.
 * Literal true is already visible; a promise keeps its exact settlement.
 * The driver must park writes with a legal persisting transaction.
 */
export function createCandidateReceiptObservations() {
  const receipts: Array<{
    id: number
    target: object
    attempt: object
    receipt: true | Promise<unknown>
    observe: () => PromiseObservation
  }> = []
  const disposals: Array<{ target: object; attempt: object }> = []
  return {
    returned(
      target: object,
      attempt: object,
      receipt: true | Promise<unknown>,
    ) {
      const record = {
        id: receipts.length + 1,
        target,
        attempt,
        receipt,
        observe:
          receipt === true
            ? (): PromiseObservation => ({ state: 'fulfilled' })
            : observeCandidatePromise(receipt),
      }
      receipts.push(record)
      return record.id
    },
    disposing(target: object, attempt: object) {
      disposals.push({ target, attempt })
    },
    observations: () => ({
      receipts: receipts.map(({ id, target, attempt, receipt, observe }) => ({
        id,
        target,
        attempt,
        literalTrue: receipt === true,
        observation: observe(),
      })),
      disposals: [...disposals],
    }),
  }
}

/**
 * The future receiving driver must measure each premise before marking it.
 * Queue calibration reaches none of these product states. Baseline receiving
 * neighbors are a separate gate and never import this candidate seam.
 */
export const candidateControlStates = [
  'held-publication-changed-promise-demand-input-and-pending-D2',
  'complete-operator-stop-with-remaining-work',
  'answer-settled-before-exact-task-dispatch',
  'existing-window-pending-at-host-gap',
  'new-partial-window-pending-at-host-gap',
  'repeated-yield-same-operation-obligation',
  'quiescent-D2-held-flush-still-pending',
  'prior-queued-root-and-retained-facade-receipts',
  'facade-A-commit-before-facade-B-throw',
  'retained-facade-restoration-receipt-pending',
  'retry-keeps-task-and-replaces-failed-completion',
  'old-completion-observer-after-retry',
  'explicit-rollback-disposal-rejection-after-retry',
  'unexpected-retained-target-receipt-rejection',
  'terminal-graph-failure-with-unanswered-peer',
  'ordinary-demand-failure-keeps-existing-aggregation',
  'last-receipt-recheck-tail-throws-with-same-revisions',
  'publication-installed-before-status-tail-throws',
  'retryable-tail-failure-attached-and-unattached-operations',
  'old-task-after-cleanup-restart-with-live-current-task',
] as const

export function createCandidateControlReach() {
  return createOracleReach(
    'query.queued-answer-candidate-controls',
    candidateControlStates,
    { replaying: false },
  )
}

/**
 * Actual receiving fixture cut: let the real host drain native microtasks while
 * the exact module-controlled continuation stays undispatched. Operation
 * observers must be installed when their public promises are first returned.
 * The caller supplies public readers and compares these rows through the shared
 * oracle; this helper has no expected row, window, error, or promise outcome.
 */
export async function captureCandidateHostGap<Rows, Window>(
  queue: ReturnType<typeof createControlledGraphTasks>,
  taskId: number,
  readRoot: () => Rows,
  readDownstream: () => Rows,
  readWindow: () => Window,
  operations: ReadonlyArray<() => PromiseObservation>,
) {
  const requireUndispatched = () => {
    const task = queue.records().find(({ id }) => id === taskId)
    if (!task || task.cancelled || task.dispatches !== 0)
      throw new Error('exact candidate task did not remain queued at host gap')
  }
  requireUndispatched()
  await new Promise<void>((done) => setTimeout(done, 0))
  requireUndispatched()
  return {
    root: readRoot(),
    downstream: readDownstream(),
    window: readWindow(),
    operations: operations.map((read) => read()),
    tasks: queue.records(),
  }
}
