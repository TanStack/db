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
 *   An insert of a held key, an update of a key not held, and a delete of a
 *   key not held are each inconsistent.
 * - **PUB-3, FID-4.** After a committed change batch applies, the rows equal
 *   the batch folded onto the previous rows.
 * - **FID-1.** A delivered row is the complete backend row: a row without
 *   the optional `note` has no `note` in the Collection, also when the row
 *   it replaces had one. Fields compare by own property, so an own
 *   `undefined` differs from an absent field.
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
 * - **READY-8, READY-10, PUB-5, PUB-9** (capability `listen-before-fetch`).
 *   The adapter's change listener is live before it fetches. The backend can
 *   commit batches while the fetch is outstanding; the listener sees them,
 *   and the fetch result reflects only those committed before its read point.
 *   Until the initial cut applies, status stays `loading` and no row shows.
 *   The cut is the fetch result followed by the batches the listener saw, in
 *   order, and status becomes `ready` only after it applied, with the rows
 *   equal to the backend's current state. A batch the read already reflects
 *   is never replayed so that an older value overtakes a newer one: every
 *   publication is a backend state at or after the read point, in order.
 * - **READY-3, READY-10.** When status becomes `ready`, the rows already
 *   equal the initial cut. A `status:ready` listener never sees fewer rows.
 *
 * Authority: the sync callback contract in `packages/db/src/types.ts`
 * (`begin`, `commit`, `markReady`, `fail`, `reportError`, `reportHealthy`),
 * the Collection status and health terms in `docs/contributing/glossary.md`,
 * and the adapter conformance law set (issue #2118, version 18), whose law
 * IDs are used here. READY-8 and READY-10 are that law set's laws for
 * capability `live-changes`; this oracle checks them for adapters that
 * declare `listen-before-fetch`, whose provider can deliver changes while
 * the initial fetch is outstanding.
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

/**
 * The row every conformance history uses. A driver maps it to its provider.
 * `note` is optional, so a later row can remove it.
 */
export interface ConformanceRow {
  readonly id: number
  readonly title: string
  readonly note?: string
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
  | `listen-before-fetch`

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
  /** Core's status event; `cleanup()` removes its listeners. */
  on: (event: `status:ready`, callback: () => void) => () => void
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
  /**
   * Sets the backend's rows before the adapter subscribes: rows committed
   * before the subscription, which no change event announces (capability
   * `listen-before-fetch`). A later `deliverChanges` before the first ready
   * is a backend commit on top of them; `deliverSnapshot` then delivers the
   * fetch result the oracle computed.
   */
  seed?: (rows: ReadonlyArray<ConformanceRow>) => void
  /** Fetches the adapter issued while its change listener was not live. */
  fetchesBeforeListening?: () => number
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
 *   connected; after the first ready only with `complete-snapshot`. With
 *   `listen-before-fetch`, the first one is the initial fetch's result: its
 *   rows are the backend's rows before the subscription, and `seen` places
 *   the fetch's read point after that many of the batches committed since.
 * - `changes`: one committed batch, legal after the first ready, and before
 *   it with `listen-before-fetch`. Its txid is the next in the sync run. A
 *   delete of a key the source does not hold is dropped, because a provider
 *   never sends one.
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
 * keys, deletes hit live rows, and complete deliveries omit held keys. A row
 * carries `note` half the time, so an update can add or remove a field. With
 * `listen-before-fetch`, a history starts with up to three batches committed
 * during the first fetch.
 */
export type EagerLiveSourceStep =
  | {
      readonly kind: `snapshot`
      readonly rows: ReadonlyArray<ConformanceRow>
      /** The read point (`listen-before-fetch`); all batches when absent. */
      readonly seen?: number
    }
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

const rowArb: fc.Arbitrary<ConformanceRow> = fc.record(
  {
    id: fc.integer({ min: 1, max: 5 }),
    title: fc.constantFrom(`a`, `b`, `c`),
    note: fc.constantFrom(`x`, `y`),
  },
  { requiredKeys: [`id`, `title`] },
)

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
        .record({
          rows: fc.uniqueArray(rowArb, {
            selector: (row) => row.id,
            maxLength: 4,
          }),
          seen: fc.integer({ min: 0, max: 3 }),
        })
        .map(({ rows, seen }) =>
          capabilities.has(`listen-before-fetch`)
            ? { kind: `snapshot` as const, rows, seen }
            : { kind: `snapshot` as const, rows },
        ),
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
  const history = fc.array(fc.oneof(...steps), { minLength: 1, maxLength: 12 })
  if (!capabilities.has(`listen-before-fetch`)) return history
  // A startup burst: batches the backend commits while the first fetch is
  // outstanding. Without it, two buffered batches that touch one key before
  // the read point are too rare for PUB-5 to be checked.
  const startup = fc
    .array(changeArb, { minLength: 1, maxLength: 3 })
    .map((changes) => ({ kind: `changes` as const, changes }))
  return fc
    .tuple(fc.array(startup, { maxLength: 3 }), history)
    .map(([burst, rest]) => [...burst, ...rest])
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
 * - `backend` is the provider's current rows. It equals `rows` after the
 *   first ready. Before it, with `listen-before-fetch`, it starts at `seed`
 *   and `buffered` logs the batches committed since the subscription; the
 *   initial cut folds them onto the fetch result.
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
  backend: Map<number, string>
  seed: Map<number, string>
  buffered: Array<{ changes: ReadonlyArray<ProviderChange>; txid: number }>
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

/**
 * A row's value as the model compares it: its title, then its note when the
 * row has its own `note` property. An own `undefined` shows as `undefined`.
 */
function rowValue(row: { readonly title: string; readonly note?: unknown }) {
  return Object.hasOwn(row, `note`)
    ? `${row.title}/${String(row.note)}`
    : row.title
}

function rowFromValue(id: number, value: string): ConformanceRow {
  const [title = ``, note] = value.split(`/`)
  return note === undefined ? { id, title } : { id, title, note }
}

function rowMap(rows: ReadonlyArray<ConformanceRow>): Map<number, string> {
  return new Map(rows.map((row) => [row.id, rowValue(row)]))
}

/** The rows a Collection holds, as the model compares them. */
function observedRows(collection: ObservedCollection): RowState {
  return rowState(
    new Map([...collection.values()].map((row) => [row.id, rowValue(row)])),
  )
}

function initialModel(seed: ReadonlyArray<ConformanceRow> = []): ModelState {
  return {
    run: 1,
    phase: `loading`,
    rows: new Map(),
    backend: rowMap(seed),
    seed: rowMap(seed),
    buffered: [],
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

/**
 * Folds one batch onto `rows` in order and returns the changes a provider
 * delivers: a delete of a key it does not hold is dropped. `onChange` sees
 * the rows after each delivered change.
 */
function foldBatch(
  rows: Map<number, string>,
  changes: ReadonlyArray<ProviderChange>,
  onChange: () => void = () => {},
): Array<ProviderChange> {
  const delivered: Array<ProviderChange> = []
  for (const change of changes) {
    if (change.type === `upsert`) {
      rows.set(change.row.id, rowValue(change.row))
    } else if (rows.has(change.id)) {
      rows.delete(change.id)
    } else {
      continue
    }
    delivered.push(change)
    onChange()
  }
  return delivered
}

/** Whether a key held in both lost the `note` it had in `before`. */
function lostField(
  before: ReadonlyMap<number, string>,
  after: ReadonlyMap<number, string>,
): boolean {
  return [...before].some(
    ([id, value]) =>
      value.includes(`/`) && after.get(id)?.includes(`/`) === false,
  )
}

/** Whether replaying `changes` onto `rows` would change them. */
function replayChanges(
  rows: ReadonlyMap<number, string>,
  changes: ReadonlyArray<ProviderChange>,
): boolean {
  const replayed = new Map(rows)
  foldBatch(replayed, changes)
  return !sameRows(rowState(replayed), rowState(rows))
}

/** A step the model accepts, with what it actually delivers. */
type AcceptedStep =
  | {
      kind: `snapshot`
      rows: ReadonlyArray<ConformanceRow>
      /** Batches the initial cut folds after the fetch result. */
      buffered: number
      /** Buffered batches the fetch result does not reflect. */
      missed: number
      /** Whether replaying a batch the read reflects would change the rows. */
      superseded: boolean
      /** Whether a held row, or the read's row at the cut, lost a field. */
      removesField: boolean
    }
  | {
      kind: `changes`
      changes: Array<ProviderChange>
      txid: number
      beforeReady: boolean
      /** Whether an upsert removed a field the row it replaced had. */
      removesField: boolean
    }
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
/** The driver facts the model depends on. */
interface ModelOptions {
  changeCommits: EagerLiveSourceDriver[`changeCommits`]
  listenBeforeFetch: boolean
}

/** EVID-1: a wait for `txid` fulfills once its batch applied. */
function applyEvidence(state: ModelState, txid: number): void {
  state.committed.add(txid)
  for (const wait of state.waits) {
    if (
      wait.run === state.run &&
      wait.txid === txid &&
      wait.expected === `pending`
    ) {
      wait.expected = `fulfilled`
    }
  }
}

/**
 * READY-10, PUB-5, PUB-9: the initial cut of a `listen-before-fetch` sync
 * run. The fetch read the backend after `seen` of the buffered batches, so
 * its result is the seed with those folded on. The cut then folds every
 * buffered batch, in order, onto the result. A publication may show the
 * result or any backend state after it, in order; with per-change commits
 * also each change's prefix of a batch the read did not reflect. A replayed
 * batch the read already reflects is never a publishable state of its own.
 */
function initialCut(
  state: ModelState,
  seen: number,
  changeCommits: ModelOptions[`changeCommits`],
) {
  const backend = new Map(state.seed)
  const publishable: Array<RowState> = []
  let read = rowState(backend)
  state.buffered.forEach((batch, index) => {
    if (index === seen) {
      read = rowState(backend)
      publishable.push(read)
    }
    const prefixes: Array<RowState> = []
    foldBatch(backend, batch.changes, () => prefixes.push(rowState(backend)))
    if (index < seen) return
    if (changeCommits === `per-change`) publishable.push(...prefixes)
    else publishable.push(rowState(backend))
  })
  if (seen === state.buffered.length) {
    read = rowState(backend)
    publishable.push(read)
  }
  const readRows = new Map(read)
  const superseded = state.buffered
    .slice(0, seen)
    .some((batch) => replayChanges(readRows, batch.changes))
  return { backend, read, publishable, superseded }
}

function stepModel(
  state: ModelState,
  step: EagerLiveSourceStep,
  failures: { next: number },
  options: ModelOptions,
  nextSeed: ReadonlyArray<ConformanceRow> = [],
): { done: AcceptedStep; publishable: ReadonlyArray<RowState> } | undefined {
  switch (step.kind) {
    case `snapshot`: {
      if (!canDeliver(state)) return undefined
      // HEALTH-2: a successful delivery clears the open transient failures.
      state.transient = []
      if (options.listenBeforeFetch && state.phase === `loading`) {
        const buffered = state.buffered.length
        const seen = Math.min(step.seen ?? buffered, buffered)
        const cut = initialCut(state, seen, options.changeCommits)
        state.rows = cut.backend
        state.backend = new Map(cut.backend)
        state.phase = `ready`
        for (const batch of state.buffered) applyEvidence(state, batch.txid)
        state.buffered = []
        return {
          done: {
            kind: `snapshot`,
            rows: cut.read.map(([id, value]) => rowFromValue(id, value)),
            buffered,
            missed: buffered - seen,
            superseded: cut.superseded,
            removesField: lostField(new Map(cut.read), cut.backend),
          },
          publishable: cut.publishable,
        }
      }
      // PUB-7: a complete delivery replaces the rows, fields included.
      // READY-3: the first one opens the initial gate.
      const removesField = lostField(state.rows, rowMap(step.rows))
      state.rows = rowMap(step.rows)
      state.backend = rowMap(step.rows)
      state.phase = `ready`
      return {
        done: {
          kind: `snapshot`,
          rows: step.rows,
          buffered: 0,
          missed: 0,
          superseded: false,
          removesField,
        },
        publishable: [rowState(state.rows)],
      }
    }
    case `changes`: {
      if (!state.connected) return undefined
      if (state.phase === `loading` && options.listenBeforeFetch) {
        // READY-8: the listener is live, so a batch committed during the
        // fetch reaches the adapter. It shows nothing until the cut.
        const delivered = foldBatch(state.backend, step.changes)
        state.lastTxid += 1
        state.buffered.push({ changes: delivered, txid: state.lastTxid })
        return {
          done: {
            kind: `changes`,
            changes: delivered,
            txid: state.lastTxid,
            beforeReady: true,
            removesField: false,
          },
          publishable: [],
        }
      }
      if (state.phase !== `ready`) return undefined
      // PUB-3: fold the batch in order. PUB-1: each prefix is a committed
      // state when the provider commits each change alone.
      const prefixes: Array<RowState> = []
      const delivered = foldBatch(state.rows, step.changes, () =>
        prefixes.push(rowState(state.rows)),
      )
      // Reach: an upsert without `note` replaced a row that had one, before
      // or within this batch.
      const held = new Map(state.backend)
      let removesField = false
      for (const change of delivered) {
        if (change.type === `delete`) {
          held.delete(change.id)
          continue
        }
        if (
          !Object.hasOwn(change.row, `note`) &&
          held.get(change.row.id)?.includes(`/`) === true
        ) {
          removesField = true
        }
        held.set(change.row.id, rowValue(change.row))
      }
      foldBatch(state.backend, delivered)
      state.lastTxid += 1
      state.transient = []
      applyEvidence(state, state.lastTxid)
      return {
        done: {
          kind: `changes`,
          changes: delivered,
          txid: state.lastTxid,
          beforeReady: false,
          removesField,
        },
        publishable:
          options.changeCommits === `per-change`
            ? prefixes
            : [rowState(state.rows)],
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
      // LIFE-5: cleanup retires the sync run; the next one starts empty. The
      // backend may change while no sync run listens: it then holds
      // `nextSeed`.
      retireWaits(state)
      state.run += 1
      state.phase = `loading`
      state.rows = new Map()
      state.backend = rowMap(nextSeed)
      state.seed = rowMap(nextSeed)
      state.buffered = []
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
  `change-before-ready`,
  `read-missed-change`,
  `seen-change-superseded`,
  `field-removed`,
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
  'change-before-ready': `listen-before-fetch`,
  'read-missed-change': `listen-before-fetch`,
  'seen-change-superseded': `listen-before-fetch`,
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
      return wasReady ? `PUB-7` : done.buffered > 0 ? `READY-10` : `READY-3`
    case `changes`:
      return done.beforeReady ? `READY-10/PUB-9` : `PUB-3/FID-4`
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
  const listenBeforeFetch = driver.capabilities.has(`listen-before-fetch`)
  const modelOptions: ModelOptions = {
    changeCommits: driver.changeCommits,
    listenBeforeFetch,
  }
  // With `listen-before-fetch`, a sync run's backend starts with the rows of
  // its first complete delivery, committed before the adapter subscribes.
  const seedFrom = (start: number): ReadonlyArray<ConformanceRow> => {
    if (!listenBeforeFetch) return []
    for (const step of history.slice(start)) {
      if (step.kind === `restart`) break
      if (step.kind === `snapshot`) return step.rows
    }
    return []
  }
  const detached = watchDetachedFailures(driver)
  const fixture = driver.create()
  const { collection, provider } = fixture
  const state = initialModel(seedFrom(0))
  const failures: Array<Error> = []
  const failureCounter = { next: 0 }
  const waits: Array<{ current: Settlement }> = []
  if (listenBeforeFetch) provider.seed?.(seedFrom(0))
  // READY-3, READY-10: the rows at the moment status becomes `ready`.
  let readyRows: RowState | undefined
  const watchReady = () =>
    collection.on(`status:ready`, () => {
      readyRows = observedRows(collection)
    })
  watchReady()
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
    law: string,
  ) => {
    let last = -1
    let readiness = becameReady ? 1 : 0
    for (const publication of events.take()) {
      if (publication === `empty`) {
        if (readiness-- > 0) continue
        throw violation(
          `${law} (empty publication)`,
          stepIndex,
          `none`,
          `empty`,
        )
      }
      // A publication shows a commit after the last one shown. Prefix states
      // can repeat within a batch, so the search starts after that commit.
      const index = publishable.findIndex(
        (rows, commit) => commit > last && sameRows(rows, publication),
      )
      if (index === -1) {
        throw violation(
          `${law} (publication)`,
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
  // retried failure, EVID-1 for a wait that fulfilled without evidence
  // (READY-10/PUB-9 when its batch should still be buffered),
  // EVID-3 for a timed wait that did not reject, and LIFE-10 for a failed
  // provider's subscription that stays open or is released twice.
  const compare = async (
    stepIndex: number,
    law: string,
    delivery: boolean = false,
  ) => {
    await settle()
    const expected = expectedObservation(state)
    const rows = observedRows(collection)
    const check = (name: string, ok: boolean, want: unknown, got: unknown) => {
      if (!ok) throw violation(`${law} (${name})`, stepIndex, want, got)
    }
    // READY-8 comes first: a fetch before listening explains what follows.
    const early = provider.fetchesBeforeListening?.() ?? 0
    if (early > 0) {
      throw violation(`READY-8 (fetch before listening)`, stepIndex, 0, early)
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
    // FID-1: rows that differ only in a field, with the right keys and
    // titles, name the field law.
    if (!sameRows(rows, expected.rows) && sameTitles(rows, expected.rows)) {
      throw violation(`FID-1 (fields)`, stepIndex, expected.rows, rows)
    }
    check(`rows`, sameRows(rows, expected.rows), expected.rows, rows)
    if (readyRows !== undefined) {
      check(
        `rows when ready`,
        sameRows(readyRows, expected.rows),
        expected.rows,
        readyRows,
      )
      readyRows = undefined
    }
    if (!sameRows(events.rows(), rows)) {
      throw violation(`PUB-2 (change events)`, stepIndex, rows, events.rows())
    }
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
      // A wait for a batch still buffered before the cut fulfilled because
      // the adapter applied that batch early.
      const buffered = state.buffered.some(
        (batch) =>
          batch.txid === state.waits[index]!.txid &&
          state.waits[index]!.run === state.run,
      )
      const waitLaw =
        gotKind === `fulfilled`
          ? buffered
            ? `READY-10/PUB-9`
            : `EVID-1`
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
        ? stepModel(
            state,
            step,
            failureCounter,
            modelOptions,
            seedFrom(index + 1),
          )
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
          if (done.missed > 0) reach(`read-missed-change`)
          if (done.superseded) reach(`seen-change-superseded`)
          if (done.removesField) reach(`field-removed`)
          if (transientBefore > 0) reach(`transient-failure-recovered`)
          break
        case `changes`:
          provider.deliverChanges(done.changes, String(done.txid))
          reach(done.beforeReady ? `change-before-ready` : `change-batch`)
          if (done.removesField) reach(`field-removed`)
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
          // The backend may change while no sync run listens.
          if (listenBeforeFetch) provider.seed?.(seedFrom(index + 1))
          readyRows = undefined
          watchReady()
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
          done.kind === `snapshot` && done.buffered > 0
            ? `PUB-5/PUB-9`
            : done.kind === `changes` && done.beforeReady
              ? `READY-10/PUB-9`
              : `PUB-1`,
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

/** Same keys and titles, whatever the other fields. */
function sameTitles(a: RowState, b: RowState): boolean {
  const title = (value: string) => value.split(`/`)[0]
  return (
    a.length === b.length &&
    a.every(
      ([id, value], index) =>
        b[index]![0] === id && title(b[index]![1]) === title(value),
    )
  )
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
 * duplicate insert, an update of an absent key, or a delete of an absent key
 * shows as a mismatch rather than disappearing. It subscribes right after `preload()`, while the sync
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
        // An insert of a held key, or an update of a key not held.
        if ((change.type === `insert`) === rows.has(change.key))
          inconsistent = true
        rows.set(change.key, rowValue(change.value))
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
