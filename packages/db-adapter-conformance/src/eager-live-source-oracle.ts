/**
 * # Does an eager live-source sync adapter keep the core sync contract?
 *
 * A sync adapter connects one Collection to a provider that pushes a complete
 * result first and committed change batches after it. This oracle checks the
 * laws that every such adapter owes, whatever its provider:
 *
 * - **READY-2, READY-3.** After `preload()`, Collection status is `loading`
 *   until the first complete delivery applies. Then it is `ready`, `preload()`
 *   fulfills, and the rows equal that delivery.
 * - **READY-4.** A provider failure before the first ready makes status
 *   `error`, rejects `preload()` with the failure value by identity, and
 *   reports that value as the health node's `error` cause.
 * - **HEALTH-1.** A provider failure after the first ready keeps status
 *   `ready` and the rows, and reports the value as the health node's `error`
 *   cause with no `failureReason`. Before any failure, the node shows no
 *   problem.
 * - **PUB-1.** Each change publication equals one whole committed state: the
 *   rows after one provider commit, never part of a commit, never an earlier
 *   state than one already published. A commit with no changes publishes
 *   nothing. The one empty callback core sends when a sync run first becomes
 *   ready (`emitEmptyReadyEvent` in `packages/db/src/collection/changes.ts`)
 *   is a readiness notification, not a commit publication.
 * - **PUB-2.** Folding the Collection's change events gives the current rows.
 * - **PUB-3, FID-4.** After a committed change batch applies, the rows equal
 *   the batch folded onto the previous rows.
 * - **PUB-7** (capability `complete-snapshot`). A later complete delivery
 *   replaces the rows: keys it omits are gone.
 * - **LIFE-2, LIFE-5.** Cleanup releases the provider subscription. A restart
 *   is a fresh sync run: one new provider subscription, status `loading`, and
 *   no rows until its own first delivery.
 * - **LIFE-10.** A provider that fails ends its source: the adapter releases
 *   that subscription at the failure, and releases each subscription at most
 *   once across that end and the later cleanup.
 * - **HEALTH-5.** No history causes an unhandled rejection, or an error- or
 *   warning-level console diagnostic that the driver does not declare.
 * - **EVID-1, EVID-2, EVID-3** (capability `await-evidence`).
 *   `awaitTxId(txid)` fulfills once a committed batch carrying that id has
 *   applied, also when the batch came first, and stays pending before. A
 *   wait with a timeout and no evidence rejects after the timeout, and later
 *   evidence does not change that. A wait still pending when its sync run
 *   retires rejects.
 * - **HEALTH-1, HEALTH-2, RETRY-1** (capability `retry-policy`). A transient
 *   failure that the adapter keeps retrying shows nothing before the first
 *   ready. After it, the failure joins the node's `failureReason`, oldest
 *   first, with `cause` the newest and no `error`. The next successful
 *   delivery clears it.
 * - **RECON-1** (capability `transport-reconnect`). A transport disconnect and
 *   reconnect keep status and rows, and later deliveries still apply.
 * - **RENEW-1** (capability `capability-renewal`). While the source's
 *   capability awaits renewal, status and rows do not change. Renewal reuses
 *   the existing provider subscription: no new subscription, no reset.
 *
 * Authority: the sync callback contract in `packages/db/src/types.ts`
 * (`begin`, `commit`, `markReady`, `fail`, `reportError`, `reportHealthy`),
 * the Collection status and health terms in `docs/contributing/glossary.md`,
 * and the adapter conformance law set (issue #2118, version 18), whose law
 * IDs are used here.
 *
 * Boundary. The oracle checks an eager Collection whose provider pushes one
 * complete result at a time. On-demand loading, mutation handlers, and
 * reload belong to other conformance families. A driver supplies a controlled
 * provider, so a claim about a real provider client needs a driver for that
 * client too (ORC-014). Rows are compared at a settled checkpoint, three
 * event-loop turns after each step; every publication during the step is
 * recorded and checked against PUB-1, so a torn intermediate state is seen.
 *
 * Layout. The production driver contract comes first, then the history
 * grammar, the independent model, and the check that runs a history through
 * a driver and compares each checkpoint with the model.
 */
import * as fc from 'fast-check'
import type { ChangeMessage, HealthNode } from '@tanstack/db'

// ---------------------------------------------------------------------------
// Production driver contract
// ---------------------------------------------------------------------------

/** The row every conformance history uses. A driver maps it to its provider. */
export interface ConformanceRow {
  readonly id: number
  readonly title: string
}

/** One change in a provider's committed batch. */
export type ProviderChange =
  | { readonly type: `upsert`; readonly row: ConformanceRow }
  | { readonly type: `delete`; readonly id: number }

/** Optional capabilities from the law set that this oracle can check. */
export type EagerLiveSourceCapability =
  | `complete-snapshot`
  | `await-evidence`
  | `transport-reconnect`
  | `capability-renewal`
  | `retry-policy`

/**
 * The public Collection surface the oracle reads. A driver passes the
 * Collection that its adapter's options factory produced; the oracle starts
 * it, restarts it, and cleans it up.
 */
export interface ObservedCollection {
  readonly status: string
  readonly health: HealthNode
  values: () => IterableIterator<ConformanceRow>
  preload: () => Promise<void>
  cleanup: () => Promise<void>
  subscribeChanges: (
    callback: (changes: Array<ChangeMessage<ConformanceRow, number>>) => void,
    options?: { includeInitialState?: boolean },
  ) => { unsubscribe: () => void }
}

/**
 * The provider a driver controls. Each delivery acts on the provider
 * subscription that the adapter opened most recently. A driver must deliver
 * exactly what it is given; it must not repair or reorder deliveries.
 */
export interface ControlledProvider {
  /**
   * For each provider subscription the adapter opened, in order, how many
   * times the adapter released it (unsubscribe, cancel, or reader release).
   */
  releases: () => ReadonlyArray<number>
  /** Delivers a complete result: every row the source holds. */
  deliverSnapshot: (rows: ReadonlyArray<ConformanceRow>) => void
  /** Delivers one committed change batch that carries `txid`. */
  deliverChanges: (changes: ReadonlyArray<ProviderChange>, txid: string) => void
  /** The provider stops with `error` and delivers nothing more. */
  fail: (error: Error) => void
  /** A failure the adapter keeps retrying (capability `retry-policy`). */
  transientFailure?: (error: Error) => void
  /** Drops the transport (capability `transport-reconnect`). */
  disconnect?: () => void
  /** Restores the transport (capability `transport-reconnect`). */
  reconnect?: () => void
  /**
   * Supplies the replacement capability that the adapter requested and
   * resolves after the adapter renewed its provider subscription with it
   * (capability `capability-renewal`). Rejects when the adapter never asked.
   */
  completeRenewal?: () => Promise<void>
  /** Renewals the adapter completed on its latest subscription. */
  renewals?: () => number
}

/** One adapter under test. */
export interface EagerLiveSourceFixture {
  readonly collection: ObservedCollection
  readonly provider: ControlledProvider
  /** The adapter's `awaitTxId` utility (capability `await-evidence`). */
  awaitTxId?: (txid: string, timeout?: number) => Promise<unknown>
  /** Releases fixture resources after the history's final cleanup. */
  dispose?: () => void | Promise<void>
}

/** A production driver: it builds a fresh fixture for each history. */
export interface EagerLiveSourceDriver {
  readonly adapter: string
  readonly capabilities: ReadonlySet<EagerLiveSourceCapability>
  /**
   * How the adapter commits one provider change batch (PUB-1): as one sync
   * transaction, or as one per change because the provider commits each
   * change on its own.
   */
  readonly changeCommits: `per-batch` | `per-change`
  /**
   * Console diagnostics the adapter declares (HEALTH-5). Any other
   * `console.error` or `console.warn` call is a violation.
   */
  readonly declaredDiagnostic?: (
    level: `error` | `warn`,
    args: ReadonlyArray<unknown>,
  ) => boolean
  create: () => EagerLiveSourceFixture
}

// ---------------------------------------------------------------------------
// History grammar
// ---------------------------------------------------------------------------

/**
 * A history starts one sync run with `preload()` and applies these steps.
 * The model decides which steps are legal now; an illegal step is skipped and
 * counted, so a generated list stays meaningful after shrinking.
 *
 * - `snapshot`: a complete delivery. Legal while the sync run is active and
 *   connected; after the first ready only with `complete-snapshot`.
 * - `changes`: one committed batch, legal after the first ready. Its txid is
 *   the next in the sync run. A delete of a key the source does not hold is
 *   dropped, because a provider never sends one.
 * - `wait`: `awaitTxId` for the last txid plus `ahead`, so a wait can target
 *   an applied batch (`ahead` 0) or a future one. With `timeout`, the wait
 *   carries a short timeout.
 * - `fail`: the provider stops.
 * - `transient-failure`: a failure the adapter keeps retrying.
 * - `disconnect`, `reconnect`: transport loss and return.
 * - `renew`: the adapter's renewal of an expiring capability completes. Legal
 *   once per sync run.
 * - `restart`: cleanup, then `preload()` starts a new sync run.
 *
 * Keys range over 1..5 and titles over three values, so batches revisit
 * keys, deletes hit live rows, and complete deliveries omit held keys.
 */
export type EagerLiveSourceStep =
  | { readonly kind: `snapshot`; readonly rows: ReadonlyArray<ConformanceRow> }
  | {
      readonly kind: `changes`
      readonly changes: ReadonlyArray<ProviderChange>
    }
  | {
      readonly kind: `wait`
      readonly ahead: number
      readonly timeout?: boolean
    }
  | { readonly kind: `fail` }
  | { readonly kind: `transient-failure` }
  | { readonly kind: `disconnect` }
  | { readonly kind: `reconnect` }
  | { readonly kind: `renew` }
  | { readonly kind: `restart` }

export type EagerLiveSourceHistory = ReadonlyArray<EagerLiveSourceStep>

const rowArb: fc.Arbitrary<ConformanceRow> = fc.record({
  id: fc.integer({ min: 1, max: 5 }),
  title: fc.constantFrom(`a`, `b`, `c`),
})

const changeArb: fc.Arbitrary<ProviderChange> = fc.oneof(
  rowArb.map((row) => ({ type: `upsert` as const, row })),
  fc.integer({ min: 1, max: 5 }).map((id) => ({ type: `delete` as const, id })),
)

/** Generates histories whose steps use only `capabilities`. */
export function eagerLiveSourceHistoryArb(
  capabilities: ReadonlySet<EagerLiveSourceCapability>,
): fc.Arbitrary<EagerLiveSourceHistory> {
  const steps: Array<{
    weight: number
    arbitrary: fc.Arbitrary<EagerLiveSourceStep>
  }> = [
    {
      weight: 4,
      arbitrary: fc
        .uniqueArray(rowArb, { selector: (row) => row.id, maxLength: 4 })
        .map((rows) => ({ kind: `snapshot` as const, rows })),
    },
    {
      weight: 6,
      arbitrary: fc
        .array(changeArb, { maxLength: 3 })
        .map((changes) => ({ kind: `changes` as const, changes })),
    },
    { weight: 2, arbitrary: fc.constant({ kind: `fail` as const }) },
    { weight: 1, arbitrary: fc.constant({ kind: `restart` as const }) },
  ]
  if (capabilities.has(`await-evidence`)) {
    // One wait in four is timed. A timed wait settles at its own step, so
    // only untimed waits can be fulfilled by a later batch.
    steps.push({
      weight: 4,
      arbitrary: fc
        .record({
          ahead: fc.integer({ min: 0, max: 2 }),
          timeout: fc.integer({ min: 0, max: 3 }).map((n) => n === 0),
        })
        .map(({ ahead, timeout }) => ({
          kind: `wait` as const,
          ahead,
          timeout,
        })),
    })
  }
  if (capabilities.has(`retry-policy`)) {
    steps.push({
      weight: 3,
      arbitrary: fc.constant({ kind: `transient-failure` as const }),
    })
  }
  if (capabilities.has(`transport-reconnect`)) {
    steps.push(
      // A reconnect needs a ready run and a disconnect before it, so both
      // weigh enough that random seeds keep the reach minimum.
      { weight: 2, arbitrary: fc.constant({ kind: `disconnect` as const }) },
      { weight: 3, arbitrary: fc.constant({ kind: `reconnect` as const }) },
    )
  }
  if (capabilities.has(`capability-renewal`)) {
    steps.push({
      weight: 2,
      arbitrary: fc.constant({ kind: `renew` as const }),
    })
  }
  return fc.array(fc.oneof(...steps), { minLength: 1, maxLength: 12 })
}

// ---------------------------------------------------------------------------
// Independent model
// ---------------------------------------------------------------------------

/**
 * The model holds only what a legal next step can observe:
 *
 * - `phase` is the sync run's place in the initial gate. `loading` before the
 *   first complete delivery, `ready` after it, `loading-error` after a
 *   failure before ready, and `stopped` after a failure after ready. A
 *   failure ends deliveries and releases the source, so it is a phase and not
 *   a flag.
 * - `rows` is the source's result as the provider delivered it: an
 *   independent Map, folded from steps, never read from the adapter.
 * - `lastTxid` numbers the sync run's batches. A wait targets it.
 * - `transient` lists the open transient failures, oldest first. Only a
 *   failure after the first ready is listed (RETRY-1).
 * - `waits` records every `awaitTxId` call with the settlement the model
 *   expects, across sync runs, because a retired wait must reject.
 *
 * Model-only terms: `phase` combines Collection status with whether the
 * provider can still deliver. `stopped` maps to status `ready` plus a node
 * `error`; it is not a Collection status.
 */
type Phase = `loading` | `ready` | `loading-error` | `stopped`

/** A wait's expected settlement. `unchecked` after its sync run failed. */
type WaitExpectation = `pending` | `fulfilled` | `rejected` | `unchecked`

type RowState = ReadonlyArray<[number, string]>

interface ModelState {
  run: number
  phase: Phase
  rows: Map<number, string>
  connected: boolean
  lastTxid: number
  committed: Set<number>
  renewed: boolean
  failure: number | undefined
  transient: Array<number>
  waits: Array<{ run: number; txid: number; expected: WaitExpectation }>
}

/** What the model predicts at a checkpoint. */
export interface ExpectedObservation {
  status: `loading` | `ready` | `error`
  rows: RowState
  /** Index of the failure the health node's `error` must carry, or none. */
  healthError: number | null
  /** Indices of the failures `failureReason.errors` must list, in order. */
  failureReason: ReadonlyArray<number>
  preload: `pending` | `fulfilled` | { rejectedWith: number }
  waits: ReadonlyArray<WaitExpectation>
  /** Unreleased provider subscriptions: one while the provider runs. */
  openSubscriptions: number
  /** Subscriptions opened in total: one per sync run, renewal included. */
  openedSubscriptions: number
  renewalsThisRun: number
}

function initialModel(): ModelState {
  return {
    run: 1,
    phase: `loading`,
    rows: new Map(),
    connected: true,
    lastTxid: 0,
    committed: new Set(),
    renewed: false,
    failure: undefined,
    transient: [],
    waits: [],
  }
}

/** A delivery needs a running sync run whose provider is still connected. */
function canDeliver(state: ModelState): boolean {
  return (
    (state.phase === `loading` || state.phase === `ready`) && state.connected
  )
}

/** Retiring a sync run rejects its pending waits (EVID-2). */
function retireWaits(state: ModelState): void {
  for (const wait of state.waits) {
    if (wait.run === state.run && wait.expected === `pending`) {
      wait.expected = `rejected`
    }
  }
}

function rowState(rows: ReadonlyMap<number, string>): RowState {
  return [...rows].sort(([a], [b]) => a - b)
}

/** A step the model accepts, with what it actually delivers. */
type AcceptedStep =
  | { kind: `snapshot`; rows: ReadonlyArray<ConformanceRow> }
  | { kind: `changes`; changes: Array<ProviderChange>; txid: number }
  | { kind: `wait`; txid: number; timeout: boolean }
  | { kind: `fail`; failure: number }
  | { kind: `transient-failure`; failure: number }
  | { kind: `disconnect` }
  | { kind: `reconnect` }
  | { kind: `renew` }
  | { kind: `restart` }

/**
 * Applies one step to the model. Returns the accepted step and the row
 * states that a publication during the step may show (PUB-1), or
 * `undefined` when the step is illegal now.
 */
function stepModel(
  state: ModelState,
  step: EagerLiveSourceStep,
  failures: { next: number },
  changeCommits: EagerLiveSourceDriver[`changeCommits`],
): { done: AcceptedStep; publishable: ReadonlyArray<RowState> } | undefined {
  switch (step.kind) {
    case `snapshot`: {
      if (!canDeliver(state)) return undefined
      // PUB-7: a complete delivery replaces the rows. READY-3: the first one
      // opens the initial gate. HEALTH-2: a successful delivery clears the
      // open transient failures.
      state.rows = new Map(step.rows.map((row) => [row.id, row.title]))
      state.phase = `ready`
      state.transient = []
      return {
        done: { kind: `snapshot`, rows: step.rows },
        publishable: [rowState(state.rows)],
      }
    }
    case `changes`: {
      if (state.phase !== `ready` || !state.connected) return undefined
      // PUB-3: fold the batch in order. A provider never deletes a key it
      // does not hold, so such a delete is not delivered. PUB-1: each prefix
      // is a committed state when the provider commits each change alone.
      const delivered: Array<ProviderChange> = []
      const prefixes: Array<RowState> = []
      for (const change of step.changes) {
        if (change.type === `upsert`) {
          state.rows.set(change.row.id, change.row.title)
          delivered.push(change)
        } else if (state.rows.has(change.id)) {
          state.rows.delete(change.id)
          delivered.push(change)
        } else {
          continue
        }
        prefixes.push(rowState(state.rows))
      }
      state.lastTxid += 1
      state.committed.add(state.lastTxid)
      state.transient = []
      // EVID-1: a wait for this txid fulfills once the batch applied.
      for (const wait of state.waits) {
        if (
          wait.run === state.run &&
          wait.txid === state.lastTxid &&
          wait.expected === `pending`
        ) {
          wait.expected = `fulfilled`
        }
      }
      return {
        done: { kind: `changes`, changes: delivered, txid: state.lastTxid },
        publishable:
          changeCommits === `per-change` ? prefixes : [rowState(state.rows)],
      }
    }
    case `wait`: {
      if (state.phase !== `loading` && state.phase !== `ready`) return undefined
      const txid = Math.max(1, state.lastTxid + step.ahead)
      // EVID-1: evidence already applied fulfills the wait. EVID-3: a wait
      // with a timeout and no evidence rejects once the timeout passes, which
      // is before the next checkpoint.
      const timeout = step.timeout === true
      state.waits.push({
        run: state.run,
        txid,
        expected: state.committed.has(txid)
          ? `fulfilled`
          : timeout
            ? `rejected`
            : `pending`,
      })
      return { done: { kind: `wait`, txid, timeout }, publishable: [] }
    }
    case `fail`: {
      if (!canDeliver(state)) return undefined
      const failure = failures.next++
      state.failure = failure
      // READY-4 before the first ready; HEALTH-1 after it. LIFE-10: the
      // source ends here.
      state.phase = state.phase === `loading` ? `loading-error` : `stopped`
      state.transient = []
      // No law fixes what a pending txid wait does after its source failed.
      for (const wait of state.waits) {
        if (wait.run === state.run && wait.expected === `pending`) {
          wait.expected = `unchecked`
        }
      }
      return { done: { kind: `fail`, failure }, publishable: [] }
    }
    case `transient-failure`: {
      if (!canDeliver(state)) return undefined
      const failure = failures.next++
      // RETRY-1: before the first ready a retried failure shows nothing.
      // HEALTH-1: after it, the failure joins `failureReason`.
      if (state.phase === `ready`) state.transient.push(failure)
      return { done: { kind: `transient-failure`, failure }, publishable: [] }
    }
    case `disconnect`: {
      if (!canDeliver(state)) return undefined
      state.connected = false
      return { done: { kind: `disconnect` }, publishable: [] }
    }
    case `reconnect`: {
      if (state.connected) return undefined
      if (state.phase !== `loading` && state.phase !== `ready`) return undefined
      state.connected = true
      return { done: { kind: `reconnect` }, publishable: [] }
    }
    case `renew`: {
      if (!canDeliver(state) || state.renewed) return undefined
      // RENEW-1: renewal changes neither rows nor status.
      state.renewed = true
      return { done: { kind: `renew` }, publishable: [] }
    }
    case `restart`: {
      // LIFE-5: cleanup retires the sync run; the next one starts empty.
      retireWaits(state)
      state.run += 1
      state.phase = `loading`
      state.rows = new Map()
      state.connected = true
      state.lastTxid = 0
      state.committed = new Set()
      state.renewed = false
      state.failure = undefined
      state.transient = []
      return { done: { kind: `restart` }, publishable: [] }
    }
  }
}

/** What the model predicts after an accepted step. */
function expectedObservation(state: ModelState): ExpectedObservation {
  const running = state.phase === `loading` || state.phase === `ready`
  return {
    status:
      state.phase === `loading`
        ? `loading`
        : state.phase === `loading-error`
          ? `error`
          : `ready`,
    rows: rowState(state.rows),
    healthError: running ? null : state.failure!,
    failureReason: state.transient,
    preload:
      state.phase === `loading`
        ? `pending`
        : state.phase === `loading-error`
          ? { rejectedWith: state.failure! }
          : `fulfilled`,
    waits: state.waits.map((wait) => wait.expected),
    // LIFE-10: a failed provider's source is released at its end.
    openSubscriptions: running ? 1 : 0,
    openedSubscriptions: state.run,
    renewalsThisRun: state.renewed ? 1 : 0,
  }
}

// ---------------------------------------------------------------------------
// Refinement check
// ---------------------------------------------------------------------------

/** Declared states whose laws need generated histories to reach them. */
export const eagerLiveSourceReachStates = [
  `first-ready`,
  `replacing-snapshot`,
  `change-batch`,
  `multi-change-batch`,
  `failure-before-ready`,
  `failure-after-ready`,
  `restart`,
  `wait-before-evidence-fulfilled`,
  `wait-timed-out`,
  `wait-rejected-at-retirement`,
  `transient-failure-reported`,
  `transient-failure-recovered`,
  `reconnect`,
  `renewal`,
] as const

export type EagerLiveSourceReachState =
  (typeof eagerLiveSourceReachStates)[number]

const capabilityOfState: Partial<
  Record<EagerLiveSourceReachState, EagerLiveSourceCapability>
> = {
  'replacing-snapshot': `complete-snapshot`,
  'wait-before-evidence-fulfilled': `await-evidence`,
  'wait-timed-out': `await-evidence`,
  'wait-rejected-at-retirement': `await-evidence`,
  'transient-failure-reported': `retry-policy`,
  'transient-failure-recovered': `retry-policy`,
  reconnect: `transport-reconnect`,
  renewal: `capability-renewal`,
}

/** The declared states a driver's capabilities let histories reach. */
export function reachStatesFor(
  capabilities: ReadonlySet<EagerLiveSourceCapability>,
): Array<EagerLiveSourceReachState> {
  return eagerLiveSourceReachStates.filter((state) => {
    const capability = capabilityOfState[state]
    return capability === undefined || capabilities.has(capability)
  })
}

/** A law violation at one checkpoint. */
export class ConformanceViolation extends Error {
  constructor(
    readonly law: string,
    readonly step: number,
    readonly expected: unknown,
    readonly actual: unknown,
    readonly history: EagerLiveSourceHistory,
  ) {
    super(
      `${law} violated at step ${step} of ${JSON.stringify(history)}: ` +
        `expected ${JSON.stringify(expected)}, observed ${JSON.stringify(actual)}`,
    )
    this.name = `ConformanceViolation`
  }
}

type Settlement = `pending` | `fulfilled` | { rejected: unknown }

function recordSettlement(promise: Promise<unknown>): { current: Settlement } {
  const record: { current: Settlement } = { current: `pending` }
  promise.then(
    () => {
      record.current = `fulfilled`
    },
    (error: unknown) => {
      record.current = { rejected: error }
    },
  )
  return record
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The checkpoint premise: the adapters in scope apply a delivery within a few
 * event-loop turns. Three macrotask turns cover microtask receipts and one
 * timer hop. A slower adapter shows as a mismatch at this cut, not as a pass.
 */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 3; turn++) await sleep(0)
}

/** The timeout a `wait` step with `timeout` passes, and how long it waits. */
const waitTimeoutMs = 5
const timeoutSettleMs = 30

/** The laws an observation answers to after each kind of step. */
function lawFor(done: AcceptedStep, wasReady: boolean): string {
  switch (done.kind) {
    case `snapshot`:
      return wasReady ? `PUB-7` : `READY-3`
    case `changes`:
      return `PUB-3/FID-4`
    case `wait`:
      return done.timeout ? `EVID-3` : `EVID-1`
    case `fail`:
      return wasReady ? `HEALTH-1` : `READY-4`
    case `transient-failure`:
      return wasReady ? `HEALTH-1` : `RETRY-1`
    case `disconnect`:
    case `reconnect`:
      return `RECON-1`
    case `renew`:
      return `RENEW-1`
    case `restart`:
      return `LIFE-2/LIFE-5`
  }
}

export interface CheckOptions {
  /** Called when the history enters a declared state (ORC-015). */
  reach?: (state: EagerLiveSourceReachState) => void
}

/**
 * Records detached failures and console diagnostics for one history
 * (HEALTH-5). Each history installs it and removes it when it ends.
 */
function watchDetachedFailures(driver: EagerLiveSourceDriver) {
  const found: Array<string> = []
  const onRejection = (reason: unknown) => {
    found.push(`unhandled rejection: ${String(reason)}`)
  }
  const hasProcess = typeof process !== `undefined`
  if (hasProcess) process.on(`unhandledRejection`, onRejection)
  const original = { error: console.error, warn: console.warn }
  for (const level of [`error`, `warn`] as const) {
    console[level] = (...args: Array<unknown>) => {
      if (!driver.declaredDiagnostic?.(level, args)) {
        found.push(`console.${level}: ${args.map(String).join(` `)}`)
      }
    }
  }
  return {
    found: () => found,
    stop: () => {
      if (hasProcess) process.off(`unhandledRejection`, onRejection)
      console.error = original.error
      console.warn = original.warn
    },
  }
}

/**
 * Runs one history through a driver and compares every checkpoint with the
 * model. Throws a `ConformanceViolation` naming the first violated law. The
 * fixture is always cleaned up; a cleanup failure after a violation is kept
 * as a secondary error and does not replace it (ORC-010).
 */
export async function checkEagerLiveSourceHistory(
  driver: EagerLiveSourceDriver,
  history: EagerLiveSourceHistory,
  options: CheckOptions = {},
): Promise<{ accepted: number; skipped: number }> {
  const reach = options.reach ?? (() => {})
  const detached = watchDetachedFailures(driver)
  const fixture = driver.create()
  const { collection, provider } = fixture
  const state = initialModel()
  const failures: Array<Error> = []
  const failureCounter = { next: 0 }
  const waits: Array<{ current: Settlement }> = []
  let preload = recordSettlement(collection.preload())
  let events = foldChanges(collection)
  let accepted = 0
  let skipped = 0
  let primary: unknown

  const failure = (index: number) => failures[index]!
  const violation = (
    law: string,
    stepIndex: number,
    want: unknown,
    got: unknown,
  ) => new ConformanceViolation(law, stepIndex, want, got, history)

  /**
   * PUB-1: every publication during the step showed one whole committed
   * state, in commit order, and none was empty.
   */
  const checkPublications = (
    stepIndex: number,
    publishable: ReadonlyArray<RowState>,
    becameReady: boolean,
  ) => {
    let last = -1
    let readiness = becameReady ? 1 : 0
    for (const publication of events.take()) {
      if (publication === `empty`) {
        if (readiness-- > 0) continue
        throw violation(`PUB-1 (empty publication)`, stepIndex, `none`, `empty`)
      }
      // A publication shows a commit after the last one shown. Prefix states
      // can repeat within a batch, so the search starts after that commit.
      const index = publishable.findIndex(
        (rows, commit) => commit > last && sameRows(rows, publication),
      )
      if (index === -1) {
        throw violation(
          `PUB-1 (publication)`,
          stepIndex,
          publishable,
          publication,
        )
      }
      last = index
    }
  }

  // `law` names the step's law. Observations whose law does not depend on
  // the step name their own: HEALTH-2 when a delivery should have cleared a
  // retried failure, EVID-1 for a wait that fulfilled without evidence,
  // EVID-3 for a timed wait that did not reject, and LIFE-10 for a failed
  // provider's subscription that stays open or is released twice.
  const compare = async (
    stepIndex: number,
    law: string,
    delivery: boolean = false,
  ) => {
    await settle()
    const expected = expectedObservation(state)
    const rows = rowState(
      new Map([...collection.values()].map((row) => [row.id, row.title])),
    )
    const check = (name: string, ok: boolean, want: unknown, got: unknown) => {
      if (!ok) throw violation(`${law} (${name})`, stepIndex, want, got)
    }
    const detachedNow = detached.found()
    if (detachedNow.length > 0) {
      throw violation(`HEALTH-5`, stepIndex, `no detached failure`, detachedNow)
    }
    check(
      `status`,
      collection.status === expected.status,
      expected.status,
      collection.status,
    )
    check(`rows`, sameRows(rows, expected.rows), expected.rows, rows)
    check(`change events`, sameRows(events.rows(), rows), rows, events.rows())
    const health = collection.health
    if (expected.healthError === null) {
      check(`health error`, health.error === null, null, health.error?.message)
    } else {
      check(
        `health error cause`,
        health.error?.cause === failure(expected.healthError),
        failure(expected.healthError).message,
        health.error?.message ?? null,
      )
    }
    const reasons =
      health.failureReason?.errors.map((entry) => entry.cause) ?? []
    const wantReasons = expected.failureReason.map(failure)
    const reasonLaw = delivery ? `HEALTH-2` : law
    const checkReason = (ok: boolean, want: unknown, got: unknown) => {
      if (!ok)
        throw violation(
          `${reasonLaw} (health failureReason)`,
          stepIndex,
          want,
          got,
        )
    }
    checkReason(
      reasons.length === wantReasons.length &&
        reasons.every((cause, index) => cause === wantReasons[index]) &&
        (wantReasons.length === 0 ||
          health.failureReason?.cause === wantReasons.at(-1)),
      wantReasons.map((error) => error.message),
      reasons.map(String),
    )
    const want = expected.preload
    const got = preload.current
    check(
      `preload`,
      typeof want === `string`
        ? got === want
        : typeof got === `object` &&
            got.rejected === failure(want.rejectedWith),
      want,
      typeof got === `object` ? { rejected: String(got.rejected) } : got,
    )
    expected.waits.forEach((wantWait, index) => {
      if (wantWait === `unchecked`) return
      const gotWait = waits[index]!.current
      const gotKind = typeof gotWait === `object` ? `rejected` : gotWait
      if (gotKind === wantWait) return
      const waitLaw =
        gotKind === `fulfilled`
          ? `EVID-1`
          : wantWait === `rejected` && state.waits[index]!.run === state.run
            ? `EVID-3`
            : law
      throw violation(
        `${waitLaw} (awaitTxId ${index})`,
        stepIndex,
        wantWait,
        gotKind,
      )
    })
    const releases = provider.releases()
    const open = releases.filter((count) => count === 0).length
    const failed = state.phase === `loading-error` || state.phase === `stopped`
    if (open !== expected.openSubscriptions) {
      throw violation(
        `${failed ? `LIFE-10` : law} (open provider subscriptions)`,
        stepIndex,
        expected.openSubscriptions,
        open,
      )
    }
    check(
      `opened provider subscriptions`,
      releases.length === expected.openedSubscriptions,
      expected.openedSubscriptions,
      releases.length,
    )
    if (releases.some((count) => count > 1)) {
      throw violation(
        `LIFE-10 (releases per subscription)`,
        stepIndex,
        `at most 1`,
        releases,
      )
    }
    if (provider.renewals) {
      const renewals = provider.renewals()
      check(
        `renewals`,
        renewals === expected.renewalsThisRun,
        expected.renewalsThisRun,
        renewals,
      )
    }
  }

  try {
    await compare(-1, `READY-2`)
    for (const [index, step] of history.entries()) {
      const wasReady = state.phase === `ready`
      const transientBefore = state.transient.length
      // Support is decided before the model moves, so a skipped step leaves
      // the model unchanged.
      const result = supports(driver, fixture, step, wasReady)
        ? stepModel(state, step, failureCounter, driver.changeCommits)
        : undefined
      if (result === undefined) {
        skipped++
        continue
      }
      accepted++
      const { done, publishable } = result
      switch (done.kind) {
        case `snapshot`:
          provider.deliverSnapshot(done.rows)
          reach(wasReady ? `replacing-snapshot` : `first-ready`)
          if (transientBefore > 0) reach(`transient-failure-recovered`)
          break
        case `changes`:
          provider.deliverChanges(done.changes, String(done.txid))
          reach(`change-batch`)
          if (done.changes.length > 1) reach(`multi-change-batch`)
          if (transientBefore > 0) reach(`transient-failure-recovered`)
          if (
            state.waits.some(
              (wait, waitIndex) =>
                wait.run === state.run &&
                wait.txid === done.txid &&
                waits[waitIndex]?.current === `pending`,
            )
          ) {
            reach(`wait-before-evidence-fulfilled`)
          }
          break
        case `wait`: {
          const pending = fixture.awaitTxId!(
            String(done.txid),
            done.timeout ? waitTimeoutMs : undefined,
          )
          waits.push(recordSettlement(pending))
          if (done.timeout) {
            await sleep(timeoutSettleMs)
            if (state.waits.at(-1)!.expected === `rejected`)
              reach(`wait-timed-out`)
          }
          break
        }
        case `fail`: {
          const error = new Error(
            `conformance provider failure ${done.failure}`,
          )
          failures[done.failure] = error
          provider.fail(error)
          reach(wasReady ? `failure-after-ready` : `failure-before-ready`)
          break
        }
        case `transient-failure`: {
          const error = new Error(
            `conformance transient failure ${done.failure}`,
          )
          failures[done.failure] = error
          provider.transientFailure!(error)
          if (wasReady) reach(`transient-failure-reported`)
          break
        }
        case `disconnect`:
          provider.disconnect!()
          break
        case `reconnect`:
          provider.reconnect!()
          reach(`reconnect`)
          break
        case `renew`:
          await provider.completeRenewal!()
          reach(`renewal`)
          break
        case `restart`: {
          const pendingBefore = waits.some((wait) => wait.current === `pending`)
          events.stop()
          await collection.cleanup()
          preload = recordSettlement(collection.preload())
          events = foldChanges(collection)
          reach(`restart`)
          if (pendingBefore) reach(`wait-rejected-at-retirement`)
          break
        }
      }
      await compare(
        index,
        lawFor(done, wasReady),
        done.kind === `snapshot` || done.kind === `changes`,
      )
      if (done.kind !== `restart`) {
        checkPublications(
          index,
          publishable,
          !wasReady && state.phase === `ready`,
        )
      } else {
        events.take()
      }
    }
  } catch (error) {
    primary = error
  }

  // Final cleanup retires the last sync run: pending waits reject (EVID-2),
  // every provider subscription is released exactly once (LIFE-2, LIFE-10),
  // and nothing detached fails during teardown (HEALTH-5).
  const cleanupErrors: Array<unknown> = []
  try {
    if (
      primary === undefined &&
      waits.some((wait) => wait.current === `pending`)
    ) {
      reach(`wait-rejected-at-retirement`)
    }
    events.stop()
    await collection.cleanup()
    await settle()
    if (primary === undefined) {
      retireWaits(state)
      primary = retiredWaitViolation(state, waits, history)
    }
    const releases = provider.releases()
    if (primary === undefined && !releases.every((count) => count === 1)) {
      primary = violation(
        `LIFE-2/LIFE-10 (releases per subscription)`,
        history.length,
        `exactly 1 each`,
        releases,
      )
    }
    if (primary === undefined && detached.found().length > 0) {
      primary = violation(
        `HEALTH-5`,
        history.length,
        `no detached failure`,
        detached.found(),
      )
    }
  } catch (error) {
    cleanupErrors.push(error)
  } finally {
    detached.stop()
  }
  try {
    await fixture.dispose?.()
  } catch (error) {
    cleanupErrors.push(error)
  }

  if (primary !== undefined) {
    if (cleanupErrors.length === 0) throw primary
    throw new AggregateError(cleanupErrors, `conformance violation`, {
      cause: primary,
    })
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, `fixture cleanup failed`)
  }
  return { accepted, skipped }
}

/** EVID-2: after final cleanup, every wait still owed must have rejected. */
function retiredWaitViolation(
  state: ModelState,
  waits: ReadonlyArray<{ current: Settlement }>,
  history: EagerLiveSourceHistory,
): ConformanceViolation | undefined {
  for (const [index, wait] of state.waits.entries()) {
    if (wait.expected !== `rejected`) continue
    const got = waits[index]!.current
    if (typeof got !== `object`) {
      return new ConformanceViolation(
        `EVID-2 (awaitTxId ${index})`,
        history.length,
        `rejected`,
        got,
        history,
      )
    }
  }
  return undefined
}

/** A step the driver cannot express is skipped, as an illegal one is. */
function supports(
  driver: EagerLiveSourceDriver,
  fixture: EagerLiveSourceFixture,
  step: EagerLiveSourceStep,
  ready: boolean,
): boolean {
  switch (step.kind) {
    case `snapshot`:
      return !ready || driver.capabilities.has(`complete-snapshot`)
    case `wait`:
      return driver.capabilities.has(`await-evidence`) && !!fixture.awaitTxId
    case `transient-failure`:
      return (
        driver.capabilities.has(`retry-policy`) &&
        !!fixture.provider.transientFailure
      )
    case `disconnect`:
    case `reconnect`:
      return driver.capabilities.has(`transport-reconnect`)
    case `renew`:
      return driver.capabilities.has(`capability-renewal`)
    default:
      return true
  }
}

function sameRows(a: RowState, b: RowState): boolean {
  return (
    a.length === b.length &&
    a.every(
      ([id, title], index) => b[index]![0] === id && b[index]![1] === title,
    )
  )
}

/**
 * Folds the Collection's change events into rows (PUB-2) and records the row
 * state after each publication (PUB-1). The fold keeps every event, so a
 * duplicate insert or a delete of an absent key shows as a mismatch rather
 * than disappearing. It subscribes right after `preload()`, while the sync
 * run holds no rows, so it needs no initial state.
 */
function foldChanges(collection: ObservedCollection) {
  const rows = new Map<number, string>()
  let inconsistent = false
  let publications: Array<RowState | `empty`> = []
  const subscription = collection.subscribeChanges((changes) => {
    if (changes.length === 0) {
      publications.push(`empty`)
      return
    }
    for (const change of changes) {
      if (change.type === `delete`) {
        if (!rows.delete(change.key)) inconsistent = true
      } else {
        if (change.type === `insert` && rows.has(change.key))
          inconsistent = true
        rows.set(change.key, change.value.title)
      }
    }
    publications.push(rowState(rows))
  })
  return {
    rows: (): RowState =>
      inconsistent ? [[-1, `inconsistent change events`]] : rowState(rows),
    /** The publications since the last call. */
    take: () => {
      const taken = publications
      publications = []
      return taken
    },
    stop: () => subscription.unsubscribe(),
  }
}

/** A reach counter, such as the one `createOracleReach` returns. */
export interface ReachCounter {
  beginHistory: () => void
  reach: (state: EagerLiveSourceReachState) => void
}

/**
 * The generated property every driver runs. It checks each history with
 * `checkEagerLiveSourceHistory` and counts reach.
 *
 * Shrinking keeps the first violation (ORC-010). After a history first fails,
 * a smaller history that fails a different law, or fails outside the
 * comparison, counts as passing, so the reported counterexample violates the
 * law and observation that the campaign found.
 */
export function eagerLiveSourceProperty(
  driver: EagerLiveSourceDriver,
  reach?: ReachCounter,
) {
  let target: string | undefined
  return fc.asyncProperty(
    eagerLiveSourceHistoryArb(driver.capabilities),
    async (history) => {
      reach?.beginHistory()
      try {
        await checkEagerLiveSourceHistory(driver, history, {
          reach: reach?.reach,
        })
      } catch (error) {
        const law =
          error instanceof ConformanceViolation
            ? error.law
            : `failure outside the comparison`
        target ??= law
        if (law === target) throw error
      }
    },
  )
}

// Exported for calibration tests: the model's prediction for a history.
export const eagerLiveSourceModel = {
  initial: initialModel,
  step: stepModel,
  expected: expectedObservation,
}
