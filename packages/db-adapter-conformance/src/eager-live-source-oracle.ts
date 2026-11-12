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
 *   problem. A driver whose client library creates the reported value
 *   declares `matchesFailure`, the relation that names the value owed for
 *   each injected failure (HEALTH-4); the check then compares through it.
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
 *   `undefined` differs from an absent field. With declared `valueKinds`,
 *   each row's `value` strictly equals the delivered value, on the initial
 *   load and on a live change: same type and prototype, `Object.is` for
 *   numbers, Dates by time, and arrays and plain objects element by element
 *   with no extra own keys. With declared `fieldKinds`, each row's `typed`
 *   record holds one field per kind, as typed columns do, and each field
 *   must round-trip the same way on both paths. The law set parameterizes FID-1 by each
 *   adapter's `valueDomain`; a driver declares the kinds of it this oracle
 *   generates.
 * - **PUB-7** (capability `complete-snapshot`). A later complete delivery
 *   replaces the rows: keys it omits are gone.
 * - **LIFE-2, LIFE-5.** Cleanup releases the provider subscription. A restart
 *   is a fresh sync run: one new provider subscription, status `loading`, and
 *   no rows until its own first delivery. With capability
 *   `prompt-after-restart`, the provider's next step can come in the same
 *   task as the restart, before any event-loop turn, as an answer already
 *   queued when the new subscription opens does. The new run still owes that
 *   step's law: a failure fails it (READY-4) and a delivery applies. A result
 *   a client cached for the retired run, which the client may replay on a
 *   later turn, does not take the step's place.
 * - **LIFE-10.** A provider that fails ends its source: the adapter releases
 *   that subscription at the failure, and releases each subscription at most
 *   once across that end and the later cleanup.
 * - **HEALTH-5.** No history causes an unhandled rejection, or an error- or
 *   warning-level console diagnostic that the driver does not declare.
 * - **EVID-1, EVID-2, EVID-3** (capability `await-evidence`).
 *   `awaitTxId(txid)` fulfills once a committed batch carrying that id has
 *   applied, also when the batch came first, and stays pending before. A
 *   wait with a timeout and no evidence rejects after the timeout, and later
 *   evidence does not change that. A sync run retires when it fails or is
 *   cleaned up, and a wait still pending then rejects; a wait registered
 *   after a failure rejects unless the shown rows already reflect its
 *   evidence (EVID-2; maintainer decision 2026-10-30, the law set's "retired
 *   ... when it fails"). A retired run's evidence fulfills a wait in a later
 *   run once that run is ready, because its rows are read after that
 *   evidence, and not before (EVID-2 as revised by maintainer decision
 *   2026-10-30). Txids number batches across runs, as a backend's
 *   transaction ids do.
 * - **HEALTH-1, HEALTH-2, RETRY-1** (capability `retry-policy`). A transient
 *   failure that the adapter keeps retrying shows nothing before the first
 *   ready. After it, the failure joins the node's `failureReason`, oldest
 *   first, with `cause` the newest and no `error`. The next successful
 *   delivery clears it. With `retryReportAfter: k` (maintainer decision
 *   2026-10-30: a retrying source must not flap its health), only an
 *   extended outage shows: an attempt joins `failureReason` from the `k`th
 *   consecutive failed attempt after ready on, and fewer show nothing. Under
 *   `matchesFailure` the node shows the attempt that crossed the threshold
 *   (maintainer decision 2026-10-30) and may list later attempts after it,
 *   in order; a later attempt does not replace it (RETRY-1). Attempts come
 *   in each of the driver's `transientVariants` kinds. With capability
 *   `empty-response`, an accepted response that delivers nothing ends the
 *   run of failed attempts, so the count starts again, and leaves a
 *   reported outage in place (maintainer decision 2026-10-30).
 * - **HEALTH-1, HEALTH-2** (capability `delivery-error`). After ready, an
 *   error the source reports for its current result joins `failureReason`,
 *   and the rows, status, and subscription stay; the next valid delivery
 *   clears it. Under `rejectedDelivery: reported` (the law set's default
 *   `errorMapping`), a delivery the adapter rejects after ready is reported
 *   the same way, with the adapter's own error.
 * - **EVID-1** (capability `await-sync`). An `awaitSync` call waits for the
 *   run's first accepted result, fulfills while the latest result is
 *   accepted, and rejects while it is a failure, after the run failed, or
 *   when the run retires. A result the client cached for an earlier
 *   subscription, such as a failed run's error, is not the new run's.
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
 * - **PUB-4, PUB-3** (capability `duplicate-key-delivery`, parameter
 *   `duplicateInsert`). A complete delivery can hold two rows with one key.
 *   Under `replace`, the later row wins (PUB-3) and the delivery otherwise
 *   applies as a complete delivery. Under `error`, the adapter rejects it
 *   (PUB-4): no row of it is written and nothing publishes; rows accepted
 *   earlier stay. The failure
 *   is reported as a sync failure: before the first ready, status `error`
 *   and `preload()` rejects; after it, status stays `ready` with a health
 *   `error`. The error is the adapter's own, so its value is not fixed.
 *   Whether the adapter releases its provider subscription at that point is
 *   not fixed either; cleanup still releases each one exactly once.
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
  /** A value of a declared kind (FID-1); present only with `valueKinds`. */
  readonly value?: unknown
  /**
   * One field per declared `fieldKinds` kind, each holding a value of that
   * kind, as a typed column does (FID-1); present only with `fieldKinds`.
   */
  readonly typed?: Readonly<Partial<Record<ValueKind, unknown>>>
}

/**
 * Value kinds from FID-1's `valueDomain`. `jsonValueKinds` are those a JSON
 * backend represents: `-0`, Dates, and bigints are not among them.
 */
export type ValueKind =
  | `string`
  | `integer`
  | `float`
  | `negative-zero`
  | `boolean`
  | `null`
  | `date`
  | `bigint`
  | `array`
  | `object`
  /** A `Float64Array`: its elements follow the number rules, -0 included. */
  | `float-array`

export const jsonValueKinds: ReadonlyArray<ValueKind> = [
  `string`,
  `integer`,
  `float`,
  `boolean`,
  `null`,
  `array`,
  `object`,
]

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
  | `duplicate-key-delivery`
  | `source-failure-after-ready`
  | `empty-response`
  | `delivery-error`
  | `await-sync`
  | `prompt-after-restart`

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
  deliverSnapshot: (rows: ReadonlyArray<ConformanceRow>) => void | Promise<void>
  /** Delivers one committed change batch that carries `txid`. */
  deliverChanges: (
    changes: ReadonlyArray<ProviderChange>,
    txid: string,
  ) => void | Promise<void>
  /** The provider stops with `error` and delivers nothing more. */
  fail: (error: Error) => void | Promise<void>
  /**
   * One failed attempt the adapter keeps retrying (capability
   * `retry-policy`), of the driver's `transientVariants` kind `variant`.
   */
  transientFailure?: (error: Error, variant: number) => void | Promise<void>
  /** Drops the transport (capability `transport-reconnect`). */
  disconnect?: () => void | Promise<void>
  /** Restores the transport (capability `transport-reconnect`). */
  reconnect?: () => void | Promise<void>
  /**
   * Supplies the replacement capability that the adapter requested and
   * resolves after the adapter renewed its provider subscription with it
   * (capability `capability-renewal`). Rejects when the adapter never asked.
   */
  completeRenewal?: () => Promise<void>
  /**
   * An accepted response that carries no change, such as an HTTP 204 to a
   * live request (capability `empty-response`).
   */
  emptyResponse?: () => void | Promise<void>
  /**
   * After ready, the source reports `error` for its current result and keeps
   * its subscription; its next valid delivery clears it (capability
   * `delivery-error`).
   */
  deliveryError?: (error: Error) => void | Promise<void>
  /** Renewals the adapter completed on its latest subscription. */
  renewals?: () => number
  /**
   * Sets the backend's rows before the adapter subscribes: rows committed
   * before the subscription, which no change event announces (capability
   * `listen-before-fetch`). A later `deliverChanges` before the first ready
   * is a backend commit on top of them; `deliverSnapshot` then delivers the
   * fetch result the oracle computed.
   */
  seed?: (rows: ReadonlyArray<ConformanceRow>) => void | Promise<void>
  /** Fetches the adapter issued while its change listener was not live. */
  fetchesBeforeListening?: () => number
}

/** One adapter under test. */
export interface EagerLiveSourceFixture {
  readonly collection: ObservedCollection
  readonly provider: ControlledProvider
  /** The adapter's `awaitTxId` utility (capability `await-evidence`). */
  awaitTxId?: (txid: string, timeout?: number) => Promise<unknown>
  /**
   * The adapter's wait for its source's current result to be accepted
   * (capability `await-sync`), such as Convex's `awaitSync`.
   */
  awaitSync?: () => Promise<unknown>
  /** Releases fixture resources after the history's final cleanup. */
  dispose?: () => void | Promise<void>
  /**
   * The adapter's propagation step (the law set's `propagationStep`), when a
   * delivery reaches the Collection later than a few event-loop turns, as
   * through a throttled change watcher. The check awaits it before every
   * comparison.
   */
  settle?: () => Promise<void>
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
   * The value kinds the backend represents (FID-1). Rows then carry a
   * `value` of one of these kinds; the driver delivers it in the backend's
   * own form, and the Collection must show it decoded.
   */
  readonly valueKinds?: ReadonlyArray<ValueKind>
  /**
   * Kinds the backend stores in typed columns (FID-1). Rows then carry
   * `typed`, one field per kind; the driver stores each in the backend's form
   * for its column, and the Collection must show it decoded.
   */
  readonly fieldKinds?: ReadonlyArray<ValueKind>
  /**
   * Generated values the backend itself cannot store as given, such as a
   * number its storage rounds: a platform limit, not adapter behavior. The
   * grammar avoids them. Every use needs a coverage-map entry naming the
   * limit and its evidence.
   */
  readonly excludesValue?: (kind: ValueKind, value: unknown) => boolean
  /**
   * The law set's `duplicateInsert` policy for an insert of a key the run
   * holds; required with `duplicate-key-delivery`.
   */
  readonly duplicateInsert?: `error` | `replace`
  /**
   * The law set's `errorMapping` for a delivery the adapter rejects after
   * ready (PUB-4): `fails` the sync run (the default), or is `reported` in
   * `failureReason` until the next valid delivery clears it.
   */
  readonly rejectedDelivery?: `fails` | `reported`
  /**
   * For an adapter whose client library creates the reported failure value,
   * such as an HTTP client's error for a failed response: whether `reported`
   * is the value the adapter owes for the injected failure `failure`. The
   * driver carries the failure's identity through its transport (for
   * example in a response header), so a stale or replaced value does not
   * match. Without it, the check compares the provider's value by identity.
   */
  readonly matchesFailure?: (reported: unknown, failure: number) => boolean
  /**
   * Names of the kinds of failed attempt the driver's provider can make
   * (`retry-policy`), such as an HTTP status the client retries or a
   * network error. Each is generated and reached after ready. Default: one
   * kind.
   */
  readonly transientVariants?: ReadonlyArray<string>
  /**
   * What carries a batch's txid (`await-evidence`): the batch itself
   * (`batch`, the default), or each change in it (`change`), as Electric's
   * row messages do. Under `change`, a batch with no delivered change
   * carries no txid, so it is no evidence.
   */
  readonly txidEvidence?: `batch` | `change`
  /**
   * The consecutive failed attempts after ready from which a retried
   * failure shows in `failureReason` (`retry-policy`); fewer show nothing.
   * Default 1: every retried failure shows.
   */
  readonly retryReportAfter?: number
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
 * - `fail`: the provider stops. After the first ready only with
 *   `source-failure-after-ready`: a provider that can end terminally then, as
 *   the law set's `terminal-source-end` or an `errorMapping` that reports a
 *   terminal failure describes. Without it, the adapter's provider has no
 *   failure after ready to deliver.
 * - `malformed`: a complete delivery holding two rows with one key, legal
 *   where a complete delivery is (PUB-4).
 * - `transient-failure`: one failed attempt the adapter keeps retrying, of
 *   one of the driver's kinds. Attempts come in outages: runs of one to two
 *   more than `retryReportAfter` attempts, anywhere in a history, so an
 *   outage can cross the threshold after a live batch, a second time in one
 *   run, or in a later run.
 * - `disconnect`, `reconnect`: transport loss and return.
 * - `renew`: the adapter's renewal of an expiring capability completes. Legal
 *   once per sync run.
 * - `delivery-error`: after ready, the source reports an error for its
 *   current result and keeps its subscription.
 * - `empty-response`: the provider accepts a request and delivers nothing.
 *   Two outages below the threshold around one are generated as one
 *   element, so the reset it causes is reached.
 * - `restart`: cleanup, then `preload()` starts a new sync run. With
 *   `prompt-after-restart`, half the restarts are `prompt`: the next step
 *   runs in the same task as `preload()`, and only a synchronous check of
 *   LIFE-5 (status `loading`, no rows, no problem) comes between them.
 *   Random steps rarely put a failed run's restart next to a failure, so a
 *   history can open with a failure, a prompt restart, and a failure or a
 *   complete delivery (see the scenario prefix below).
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
      readonly changes: ReadonlyArray<HistoryChange>
    }
  | {
      readonly kind: `wait`
      readonly ahead: number
      readonly timeout?: boolean
    }
  | { readonly kind: `fail` }
  | {
      /**
       * A complete delivery of `rows` plus a second row for the key of
       * `rows[duplicate % rows.length]` with another title (capability
       * `duplicate-key-delivery`).
       */
      readonly kind: `malformed`
      readonly rows: ReadonlyArray<ConformanceRow>
      readonly duplicate: number
    }
  | {
      /** One failed attempt of the driver's kind `variant`. */
      readonly kind: `transient-failure`
      readonly variant?: number
    }
  | { readonly kind: `disconnect` }
  | { readonly kind: `reconnect` }
  | { readonly kind: `renew` }
  | { readonly kind: `empty-response` }
  | { readonly kind: `delivery-error` }
  | { readonly kind: `sync-wait` }
  | { readonly kind: `restart`; readonly prompt?: boolean }

/**
 * A change in a generated batch. `retouch` re-delivers a row the source
 * holds: the held key at position `id`, counted modulo the held keys in key
 * order, so it rarely misses. With `negative-zero` in the value kinds, every zero in its
 * value changes sign, so the row differs only by -0 versus 0. Without it,
 * the re-delivery is equal. The model resolves it to an upsert.
 */
export type HistoryChange =
  ProviderChange | { readonly type: `retouch`; readonly id: number }

export type EagerLiveSourceHistory = ReadonlyArray<EagerLiveSourceStep>

/**
 * Edge cases for each value kind, as factories so no two rows share an
 * object. They cover FID-1's named cases: explicit falsy values, embedded
 * newlines, integers past 2^31 and at 2^53 - 1, bigints beyond 2^53, Dates
 * with milliseconds and before the epoch, and nested objects and arrays.
 */
const valueExamples: Record<ValueKind, ReadonlyArray<() => unknown>> = {
  string: [() => ``, () => `plain`, () => `two\nlines`, () => `ünïcødé ✓`],
  integer: [() => 0, () => -7, () => 2 ** 31, () => Number.MAX_SAFE_INTEGER],
  float: [() => 0.5, () => -1.25, () => 1e-7, () => Number.MAX_VALUE],
  // Nested too, so an equality that tells -0 from 0 only at the root fails.
  'negative-zero': [() => -0, () => [-0], () => ({ z: -0 })],
  boolean: [() => true, () => false],
  null: [() => null],
  date: [
    () => new Date(0),
    () => new Date(Date.UTC(2026, 9, 29, 12, 34, 56, 789)),
    () => new Date(-86_400_000),
  ],
  bigint: [() => 9_007_199_254_740_993n, () => -(2n ** 63n), () => 0n],
  // Zeros inside containers give a retouch a sign to flip.
  array: [() => [], () => [0, `a`, null], () => [[1], [true]]],
  object: [
    () => ({}),
    () => ({ a: 0, b: `x` }),
    () => ({ nested: { deep: [1, { k: null }] } }),
    () => ({ '': false }),
  ],
  // -0 and 0 are distinct inside typed arrays too (maintainer decision
  // 2026-11-02).
  'float-array': [
    () => Float64Array.of(0),
    () => Float64Array.of(-0, 1.5),
    () => new Float64Array(0),
  ],
}

/** A value the driver's backend cannot store as given; see `excludesValue`. */
type ValueExclusion = (kind: ValueKind, value: unknown) => boolean

function valueArb(
  kinds: ReadonlyArray<ValueKind>,
  excludes: ValueExclusion = () => false,
): fc.Arbitrary<unknown> {
  return fc.oneof(
    ...kinds.map((kind) => {
      const examples = valueExamples[kind].filter(
        (example) => !excludes(kind, example()),
      )
      if (examples.length === 0) {
        throw new Error(`every ${kind} example is excluded`)
      }
      return fc.integer({ min: 0, max: examples.length - 1 }).map(
        (index) => examples[index]!(),
        (value) => {
          const described = describeValue(value)
          const index = examples.findIndex(
            (example) => describeValue(example()) === described,
          )
          if (index < 0) throw new Error(`not a declared ${kind} value`)
          return index
        },
      )
    }),
  )
}

function rowArb(
  kinds: ReadonlyArray<ValueKind>,
  fieldKinds: ReadonlyArray<ValueKind> = [],
  excludes?: ValueExclusion,
): fc.Arbitrary<ConformanceRow> {
  const fields = {
    id: fc.integer({ min: 1, max: 5 }),
    title: fc.constantFrom(`a`, `b`, `c`),
    note: fc.constantFrom(`x`, `y`),
    ...(kinds.length > 0 ? { value: valueArb(kinds, excludes) } : {}),
    ...(fieldKinds.length > 0
      ? {
          typed: fc.record(
            Object.fromEntries(
              fieldKinds.map((kind) => [kind, valueArb([kind], excludes)]),
            ) as Record<ValueKind, fc.Arbitrary<unknown>>,
          ),
        }
      : {}),
  }
  return fc.record(fields, {
    requiredKeys: [
      `id`,
      `title`,
      ...(kinds.length > 0 ? [`value` as const] : []),
      ...(fieldKinds.length > 0 ? [`typed` as const] : []),
    ],
  }) as fc.Arbitrary<ConformanceRow>
}

function changeArb(
  kinds: ReadonlyArray<ValueKind>,
  fieldKinds: ReadonlyArray<ValueKind> = [],
  excludes?: ValueExclusion,
): fc.Arbitrary<HistoryChange> {
  const changes: Array<fc.Arbitrary<HistoryChange>> = [
    rowArb(kinds, fieldKinds, excludes).map(
      (row) => ({ type: `upsert` as const, row }),
      (value) => unmapChange(`upsert`, value).row,
    ),
    fc.integer({ min: 1, max: 5 }).map(
      (id) => ({ type: `delete` as const, id }),
      (value) => unmapChange(`delete`, value).id,
    ),
  ]
  if (kinds.length > 0 || fieldKinds.length > 0) {
    changes.push(
      fc.integer({ min: 1, max: 5 }).map(
        (id) => ({ type: `retouch` as const, id }),
        (value) => unmapChange(`retouch`, value).id,
      ),
    )
  }
  return fc.oneof(...changes)
}

// Unmappers describe the same generated language to fast-check's membership
// and context-free shrinking checks. They do not change generation or its
// random choices. The underlying arbitraries validate the recovered fields.
function unmapChange<T extends HistoryChange[`type`]>(
  type: T,
  value: unknown,
): Extract<HistoryChange, { type: T }> {
  if (
    typeof value !== `object` ||
    value === null ||
    !(`type` in value) ||
    value.type !== type
  )
    throw new Error(`not a ${type} change`)
  return value as Extract<HistoryChange, { type: T }>
}

function unmapStep<T extends EagerLiveSourceStep[`kind`]>(
  kind: T,
  value: unknown,
): Extract<EagerLiveSourceStep, { kind: T }> {
  if (
    typeof value !== `object` ||
    value === null ||
    !(`kind` in value) ||
    value.kind !== kind
  )
    throw new Error(`not a ${kind} step`)
  return value as Extract<EagerLiveSourceStep, { kind: T }>
}

function unmapHistory(value: unknown): Array<EagerLiveSourceStep> {
  if (!Array.isArray(value)) throw new Error(`not a history`)
  return value as Array<EagerLiveSourceStep>
}

function unmapAttempt(value: unknown): {
  kind: `transient-failure`
  variant: number
} {
  return {
    kind: `transient-failure`,
    variant: unmapStep(`transient-failure`, value).variant ?? 0,
  }
}

function constantStep<T extends EagerLiveSourceStep[`kind`]>(kind: T) {
  return fc.constant(undefined).map(
    () => ({ kind }) as Extract<EagerLiveSourceStep, { kind: T }>,
    (value) => {
      unmapStep(kind, value)
      return undefined
    },
  )
}

function splitHistory<
  TLeft extends EagerLiveSourceStep,
  TRight extends EagerLiveSourceStep,
>(
  value: unknown,
  left: fc.Arbitrary<Array<TLeft>>,
  right: fc.Arbitrary<Array<TRight>>,
): [Array<TLeft>, Array<TRight>] {
  const history = unmapHistory(value)
  for (let cut = 0; cut <= history.length; cut++) {
    const first = history.slice(0, cut)
    const last = history.slice(cut)
    if (
      left.canShrinkWithoutContext(first) &&
      right.canShrinkWithoutContext(last)
    )
      return [first, last]
  }
  throw new Error(`history has no legal prefix and suffix`)
}

function unflattenHistory(
  value: unknown,
  element: fc.Arbitrary<Array<EagerLiveSourceStep>>,
): Array<Array<EagerLiveSourceStep>> {
  const history = unmapHistory(value)
  const paths = new Map<number, Array<Array<EagerLiveSourceStep>>>([[0, []]])
  for (let start = 0; start < history.length; start++) {
    const prefix = paths.get(start)
    if (prefix === undefined || prefix.length >= 12) continue
    for (let end = start + 1; end <= history.length; end++) {
      const part = history.slice(start, end)
      const earlier = paths.get(end)
      if (
        (earlier === undefined || earlier.length > prefix.length + 1) &&
        element.canShrinkWithoutContext(part)
      )
        paths.set(end, [...prefix, part])
    }
  }
  const path = paths.get(history.length)
  if (path === undefined)
    throw new Error(`history has no legal element partition`)
  return path
}

/** What the grammar needs from a driver: its capabilities and value kinds. */
export type GrammarDomain = Pick<
  EagerLiveSourceDriver,
  | `capabilities`
  | `valueKinds`
  | `fieldKinds`
  | `excludesValue`
  | `retryReportAfter`
  | `transientVariants`
  | `rejectedDelivery`
>

/** Generates histories whose steps use only the driver's declarations. */
export function eagerLiveSourceHistoryArb(
  domain: GrammarDomain,
): fc.Arbitrary<EagerLiveSourceHistory> {
  const { capabilities } = domain
  const kinds = domain.valueKinds ?? []
  const fieldKinds = domain.fieldKinds ?? []
  const steps: Array<{
    weight: number
    arbitrary: fc.Arbitrary<EagerLiveSourceStep>
  }> = [
    {
      weight: 4,
      arbitrary: fc
        .record({
          rows: fc.uniqueArray(
            rowArb(kinds, fieldKinds, domain.excludesValue),
            {
              selector: (row) => row.id,
              maxLength: 4,
            },
          ),
          seen: fc.integer({ min: 0, max: 3 }),
        })
        .map(
          ({ rows, seen }) =>
            capabilities.has(`listen-before-fetch`)
              ? { kind: `snapshot` as const, rows, seen }
              : { kind: `snapshot` as const, rows },
          (value) => {
            const step = unmapStep(`snapshot`, value)
            return { rows: [...step.rows], seen: step.seen ?? 0 }
          },
        ),
    },
    {
      weight: 6,
      arbitrary: fc
        .array(changeArb(kinds, fieldKinds, domain.excludesValue), {
          maxLength: 3,
        })
        .map(
          (changes) => ({ kind: `changes` as const, changes }),
          (value) => [...unmapStep(`changes`, value).changes],
        ),
    },
    { weight: 2, arbitrary: constantStep(`fail`) },
    {
      weight: 1,
      arbitrary: capabilities.has(`prompt-after-restart`)
        ? fc.boolean().map(
            (prompt) => ({ kind: `restart` as const, prompt }),
            (value) => unmapStep(`restart`, value).prompt ?? false,
          )
        : constantStep(`restart`),
    },
  ]
  if (capabilities.has(`duplicate-key-delivery`)) {
    steps.push({
      weight: 1,
      arbitrary: fc
        .record({
          rows: fc.uniqueArray(
            rowArb(kinds, fieldKinds, domain.excludesValue),
            {
              selector: (row) => row.id,
              minLength: 1,
              maxLength: 3,
            },
          ),
          duplicate: fc.nat(2),
        })
        .map(
          ({ rows, duplicate }) => ({
            kind: `malformed` as const,
            rows,
            duplicate,
          }),
          (value) => {
            const step = unmapStep(`malformed`, value)
            return { rows: [...step.rows], duplicate: step.duplicate }
          },
        ),
    })
  }
  if (capabilities.has(`await-evidence`)) {
    // One wait in four is timed. A timed wait settles at its own step, so
    // only untimed waits can be fulfilled by a later batch.
    steps.push({
      weight: 4,
      arbitrary: fc
        .record({
          ahead: fc.integer({ min: 0, max: 2 }),
          timeout: fc.integer({ min: 0, max: 3 }).map(
            (n) => n === 0,
            (value) => {
              if (typeof value !== `boolean`)
                throw new Error(`not a timeout flag`)
              return value ? 0 : 1
            },
          ),
        })
        .map(
          ({ ahead, timeout }) => ({ kind: `wait` as const, ahead, timeout }),
          (value) => {
            const step = unmapStep(`wait`, value)
            return { ahead: step.ahead, timeout: step.timeout ?? false }
          },
        ),
    })
  }
  // An outage is a run of failed attempts. It is one element of the
  // history, so it lands anywhere; other steps are elements of one step.
  const outages: Array<fc.Arbitrary<Array<EagerLiveSourceStep>>> = []
  if (capabilities.has(`retry-policy`)) {
    const variants = domain.transientVariants?.length ?? 1
    const threshold = domain.retryReportAfter ?? 1
    const attempt = fc.nat(variants - 1).map(
      (variant) => ({ kind: `transient-failure` as const, variant }),
      (value) => unmapStep(`transient-failure`, value).variant ?? 0,
    )
    // Half the outages stay below the threshold, half cross it by up to two
    // attempts. A recurring outage crosses it, recovers on a live batch, and
    // crosses it again, so a second report in one run is not rare.
    const crossing = fc.array(attempt, {
      minLength: threshold,
      maxLength: threshold + 2,
    })
    outages.push(
      fc.oneof(
        fc.array(attempt, {
          minLength: 1,
          maxLength: Math.max(1, threshold - 1),
        }),
        crossing,
      ),
      fc
        .tuple(
          crossing,
          fc.array(changeArb(kinds, fieldKinds, domain.excludesValue), {
            maxLength: 3,
          }),
          crossing,
        )
        .map(
          ([first, changes, second]): Array<EagerLiveSourceStep> => [
            ...first,
            { kind: `changes`, changes },
            ...second,
          ],
          (value) => {
            const history = unmapHistory(value)
            const cut = history.findIndex((step) => step.kind === `changes`)
            if (cut < 0) throw new Error(`not a recurring outage`)
            return [
              history.slice(0, cut).map(unmapAttempt),
              [...unmapStep(`changes`, history[cut]).changes],
              history.slice(cut + 1).map(unmapAttempt),
            ] as [
              Array<{ kind: `transient-failure`; variant: number }>,
              Array<HistoryChange>,
              Array<{ kind: `transient-failure`; variant: number }>,
            ]
          },
        ),
    )
    if (capabilities.has(`empty-response`)) {
      // Two outages below the threshold around an empty response: together
      // they may reach it, but not in a row.
      const below = fc.array(attempt, {
        minLength: 1,
        maxLength: Math.max(1, threshold - 1),
      })
      outages.push(
        fc.tuple(below, below).map(
          ([first, second]): Array<EagerLiveSourceStep> => [
            ...first,
            { kind: `empty-response` },
            ...second,
          ],
          (value) => {
            const history = unmapHistory(value)
            const cut = history.findIndex(
              (step) => step.kind === `empty-response`,
            )
            if (cut < 0) throw new Error(`not an outage reset`)
            return [
              history.slice(0, cut).map(unmapAttempt),
              history.slice(cut + 1).map(unmapAttempt),
            ] as [
              Array<{ kind: `transient-failure`; variant: number }>,
              Array<{ kind: `transient-failure`; variant: number }>,
            ]
          },
        ),
      )
    }
  }
  if (capabilities.has(`empty-response`)) {
    steps.push({
      weight: 1,
      arbitrary: constantStep(`empty-response`),
    })
  }
  if (capabilities.has(`await-sync`)) {
    steps.push({
      weight: 2,
      arbitrary: constantStep(`sync-wait`),
    })
  }
  if (capabilities.has(`delivery-error`)) {
    steps.push({
      weight: 3,
      arbitrary: constantStep(`delivery-error`),
    })
  }
  if (capabilities.has(`transport-reconnect`)) {
    steps.push(
      // A reconnect needs a ready run and a disconnect before it, so both
      // weigh enough that random seeds keep the reach minimum.
      { weight: 2, arbitrary: constantStep(`disconnect`) },
      { weight: 3, arbitrary: constantStep(`reconnect`) },
    )
  }
  if (capabilities.has(`capability-renewal`)) {
    steps.push({
      weight: 2,
      arbitrary: constantStep(`renew`),
    })
  }
  const element = fc.oneof(
    ...steps.map(({ weight, arbitrary }) => ({
      weight,
      arbitrary: arbitrary.map(
        (step) => [step],
        (value) => {
          const history = unmapHistory(value)
          if (history.length !== 1) throw new Error(`not a one-step element`)
          return history[0]!
        },
      ),
    })),
    ...outages.map((arbitrary, index) => ({
      weight: index === 0 ? 3 : 1,
      arbitrary,
    })),
  )
  const generated = fc.array(element, { minLength: 1, maxLength: 12 }).map(
    (elements) => elements.flat(),
    (value) => unflattenHistory(value, element),
  )
  // EVID-2 and a prompt restart after a failure need sequences that random
  // steps rarely produce, so a history can open with one: no prefix weighs 5
  // and each declared scenario 1, so with one scenario one history in six
  // opens with it, with two one in seven each. A listen-before-fetch startup
  // burst still comes before the prefix.
  const snapshot = steps[0]!.arbitrary
  const scenarios: Array<fc.Arbitrary<Array<EagerLiveSourceStep>>> = []
  if (capabilities.has(`await-evidence`)) {
    // EVID-2: a txid that a retired run committed and the current run has
    // not: a batch with a change, a restart, and a wait for it.
    scenarios.push(
      fc
        .tuple(
          snapshot,
          fc.array(changeArb(kinds, fieldKinds, domain.excludesValue), {
            minLength: 1,
            maxLength: 3,
          }),
          fc.boolean(),
        )
        .map(
          ([first, changes, timeout]): Array<EagerLiveSourceStep> => [
            first,
            { kind: `changes`, changes },
            { kind: `restart` },
            { kind: `wait`, ahead: 0, timeout },
          ],
          (value) => {
            const history = unmapHistory(value)
            if (
              history.length !== 4 ||
              unmapStep(`wait`, history[3]).ahead !== 0
            )
              throw new Error(`not a retired-evidence prefix`)
            unmapStep(`restart`, history[2])
            return [
              history[0]!,
              unmapStep(`changes`, history[1]).changes,
              unmapStep(`wait`, history[3]).timeout ?? false,
            ] as [EagerLiveSourceStep, Array<HistoryChange>, boolean]
          },
        ),
    )
  }
  if (capabilities.has(`prompt-after-restart`)) {
    // A failed run, its prompt restart, and the new run's first step.
    scenarios.push(
      fc.oneof(constantStep(`fail`), snapshot).map(
        (next): Array<EagerLiveSourceStep> => [
          { kind: `fail` },
          { kind: `restart`, prompt: true },
          next,
        ],
        (value) => {
          const history = unmapHistory(value)
          if (
            history.length !== 3 ||
            unmapStep(`restart`, history[1]).prompt !== true
          )
            throw new Error(`not a prompt restart prefix`)
          unmapStep(`fail`, history[0])
          return history[2]!
        },
      ),
    )
  }
  const opening: fc.Arbitrary<Array<EagerLiveSourceStep>> = fc.oneof(
    {
      weight: 5,
      arbitrary: fc.constant(undefined).map(
        (): Array<EagerLiveSourceStep> => [],
        (value) => {
          if (unmapHistory(value).length !== 0)
            throw new Error(`not an empty history`)
          return undefined
        },
      ),
    },
    ...scenarios.map((arbitrary) => ({ weight: 1, arbitrary })),
  )
  const history =
    scenarios.length === 0
      ? generated
      : fc.tuple(opening, generated).map(
          ([prefix, rest]) => [...prefix, ...rest],
          (value) => splitHistory(value, opening, generated),
        )
  if (!capabilities.has(`listen-before-fetch`)) return history
  // A startup burst: batches the backend commits while the first fetch is
  // outstanding. Without it, two buffered batches that touch one key before
  // the read point are too rare for PUB-5 to be checked.
  const startup = fc
    .array(changeArb(kinds, fieldKinds, domain.excludesValue), {
      minLength: 1,
      maxLength: 3,
    })
    .map(
      (changes) => ({ kind: `changes` as const, changes }),
      (value) => [...unmapStep(`changes`, value).changes],
    )
  const startupBurst = fc.array(startup, { maxLength: 3 })
  return fc.tuple(startupBurst, history).map(
    ([batches, rest]) => [...batches, ...rest],
    (value) => splitHistory(value, startupBurst, history),
  )
}

// Campaign history data represents Dates and Float64Arrays with tagged values.
// resolveEagerLiveSourceHistory restores their native forms before the same
// provider/model/checker runs, so FID-1 keeps both type and signed-zero laws.
type HistoryValueData =
  | { kind: `date`; milliseconds: number }
  | { kind: `float-array`; values: ReadonlyArray<number> }
  | { kind: `plain`; value: unknown }

function historyValueData(value: unknown): HistoryValueData {
  if (value instanceof Date)
    return { kind: `date`, milliseconds: value.getTime() }
  if (value instanceof Float64Array)
    return { kind: `float-array`, values: [...value] }
  return { kind: `plain`, value }
}
function historyValue(value: unknown): unknown {
  if (typeof value !== `object` || value === null || !(`kind` in value))
    throw new Error(`not a history value`)
  const data = value as HistoryValueData
  switch (data.kind) {
    case `date`:
      return new Date(data.milliseconds)
    case `float-array`:
      return Float64Array.from(data.values)
    case `plain`:
      return data.value
    default:
      throw new Error(`not a history value`)
  }
}
function mapHistoryValues(
  history: EagerLiveSourceHistory,
  map: (value: unknown) => unknown,
): EagerLiveSourceHistory {
  const row = (value: ConformanceRow): ConformanceRow => ({
    ...value,
    ...(Object.hasOwn(value, `value`) ? { value: map(value.value) } : {}),
    ...(value.typed === undefined
      ? {}
      : {
          typed: Object.fromEntries(
            Object.entries(value.typed).map(([kind, item]) => [
              kind,
              map(item),
            ]),
          ),
        }),
  })
  return history.map((step): EagerLiveSourceStep => {
    if (step.kind === `snapshot` || step.kind === `malformed`)
      return { ...step, rows: step.rows.map(row) }
    if (step.kind !== `changes`) return step
    return {
      ...step,
      changes: step.changes.map((change) =>
        change.type === `upsert` ? { ...change, row: row(change.row) } : change,
      ),
    }
  })
}
/** Same history shape; row values are tagged history data until resolution. */
export function eagerLiveSourceHistoryData(
  history: EagerLiveSourceHistory,
): EagerLiveSourceHistory {
  return mapHistoryValues(history, historyValueData)
}
export function resolveEagerLiveSourceHistory(
  history: EagerLiveSourceHistory,
): EagerLiveSourceHistory {
  return mapHistoryValues(history, historyValue)
}
export function eagerLiveSourceDataHistoryArb(
  domain: GrammarDomain,
): fc.Arbitrary<EagerLiveSourceHistory> {
  return eagerLiveSourceHistoryArb(domain).map(
    eagerLiveSourceHistoryData,
    (value) => resolveEagerLiveSourceHistory(unmapHistory(value)),
  )
}

export interface EagerLiveSourceConstruction {
  name: string
  enters: ReadonlyArray<EagerLiveSourceReachState>
  build: (generated: EagerLiveSourceHistory) => EagerLiveSourceHistory
}

/**
 * Constructed histories keep generated rows and a generated suffix. Each
 * recipe fixes only the action relationships that make its states reachable.
 * All recipes remain inside the original grammar, including its 12-element
 * bound and capability/value declarations. Five independently seeded witnesses
 * per recipe preserve the old minimum of five histories per required state.
 */
export function eagerLiveSourceConstructedHistories(
  domain: GrammarDomain,
): Array<EagerLiveSourceConstruction> {
  const required = reachStatesFor(domain)
  const recipes: Array<{
    name: string
    enters: ReadonlyArray<EagerLiveSourceReachState>
    steps: (
      row: (offset?: number, kind?: ValueKind) => ConformanceRow,
    ) => Array<EagerLiveSourceStep>
  }> = []
  const capabilities = domain.capabilities
  const listen = capabilities.has(`listen-before-fetch`)
  const snapshot = (
    rows: ReadonlyArray<ConformanceRow>,
    seen = 0,
  ): EagerLiveSourceStep =>
    listen ? { kind: `snapshot`, rows, seen } : { kind: `snapshot`, rows }
  const restart = (): EagerLiveSourceStep =>
    capabilities.has(`prompt-after-restart`)
      ? { kind: `restart`, prompt: false }
      : { kind: `restart` }
  const changes = (...rows: Array<ConformanceRow>): EagerLiveSourceStep => ({
    kind: `changes`,
    changes: rows.map((row) => ({ type: `upsert`, row })),
  })
  const add = (
    name: string,
    enters: Array<EagerLiveSourceReachState>,
    steps: (
      row: (offset?: number, kind?: ValueKind) => ConformanceRow,
    ) => Array<EagerLiveSourceStep>,
  ) => {
    const owned = enters.filter((state) => required.includes(state))
    if (owned.length > 0) recipes.push({ name, enters: owned, steps })
  }
  add(
    `whole rows and a complete batch`,
    [
      `first-ready`,
      `change-batch`,
      `multi-change-batch`,
      `field-removed`,
      `replacing-snapshot`,
    ],
    (row) => {
      const a = row(),
        b = row(1),
        c = row(2)
      return [
        snapshot([{ ...a, note: `x` }, b]),
        {
          kind: `changes`,
          changes: [
            { type: `delete`, id: b.id },
            { type: `upsert`, row: a },
            { type: `upsert`, row: c },
          ],
        },
        ...(capabilities.has(`complete-snapshot`) ? [snapshot([a])] : []),
      ]
    },
  )
  add(
    `restart after a loading failure`,
    [`failure-before-ready`, `restart`, `restart-after-failure`],
    (row) => [{ kind: `fail` }, restart(), snapshot([row()])],
  )
  if (capabilities.has(`source-failure-after-ready`))
    add(`failure after readiness`, [`failure-after-ready`], (row) => [
      snapshot([row()]),
      { kind: `fail` },
    ])
  if (capabilities.has(`prompt-after-restart`))
    add(
      `prompt failure after a failed run`,
      [`prompt-restart`, `prompt-failure-after-failed-run`],
      () => [
        { kind: `fail` },
        { kind: `restart`, prompt: true },
        { kind: `fail` },
      ],
    )
  if (capabilities.has(`await-evidence`))
    add(
      `evidence before and across retirement`,
      [
        `wait-before-evidence-fulfilled`,
        `wait-timed-out`,
        `wait-rejected-at-retirement`,
        `wait-on-retired-evidence`,
      ],
      (row) => [
        ...(listen
          ? [
              { kind: `wait` as const, ahead: 1, timeout: false },
              changes(row(1)),
              snapshot([row()]),
            ]
          : [
              snapshot([row()]),
              { kind: `wait` as const, ahead: 1, timeout: false },
              changes(row(1)),
            ]),
        { kind: `wait`, ahead: 2, timeout: true },
        { kind: `wait`, ahead: 1, timeout: false },
        restart(),
        { kind: `wait`, ahead: 0, timeout: false },
        snapshot([row(2)]),
      ],
    )
  if (capabilities.has(`transport-reconnect`))
    add(`reconnect`, [`reconnect`], (row) => [
      snapshot([row()]),
      { kind: `disconnect` },
      { kind: `reconnect` },
    ])
  if (capabilities.has(`capability-renewal`))
    add(`renewal`, [`renewal`], () => [{ kind: `renew` }])
  if (capabilities.has(`retry-policy`)) {
    const threshold = domain.retryReportAfter ?? 1
    const attempts = (n: number, variant = 0): Array<EagerLiveSourceStep> =>
      Array.from({ length: n }, () => ({ kind: `transient-failure`, variant }))
    add(
      `recurring outages across a batch and restart`,
      [
        `transient-failure-reported`,
        `transient-failure-below-threshold`,
        `transient-failure-repeated`,
        `transient-failure-recovered`,
        `outage-reported-again`,
        `outage-reported-after-batch`,
        `outage-reported-in-later-run`,
      ],
      (row) => [
        snapshot([row()]),
        ...attempts(threshold + 1),
        changes(row(1)),
        ...attempts(threshold),
        restart(),
        snapshot([row(2)]),
        ...attempts(threshold),
      ],
    )
    for (const [variant, name] of (domain.transientVariants ?? []).entries())
      add(`outage kind ${name}`, [`transient:${name}`], (row) => [
        snapshot([row()]),
        ...attempts(threshold, variant),
      ])
    if (capabilities.has(`empty-response`))
      add(
        `an empty response restarts the outage count`,
        [`outage-count-reset`],
        (row) => [
          snapshot([row()]),
          ...attempts(Math.max(1, threshold - 1)),
          { kind: `empty-response` },
          ...attempts(Math.max(1, threshold - 1)),
        ],
      )
  }
  if (capabilities.has(`delivery-error`))
    add(
      `delivery error and recovery`,
      [`delivery-error-reported`, `delivery-error-recovered`],
      (row) => [snapshot([row()]), { kind: `delivery-error` }, changes(row(1))],
    )
  if (capabilities.has(`await-sync`))
    add(
      `awaitSync before readiness and after failure`,
      [`sync-wait-pending`, `sync-wait-on-failure`],
      () => [{ kind: `sync-wait` }, { kind: `fail` }, { kind: `sync-wait` }],
    )
  if (listen) {
    add(
      `a read misses a buffered change`,
      [`change-before-ready`, `read-missed-change`],
      (row) => {
        const a = row()
        return [
          changes({ ...a, title: `a` }),
          changes({ ...a, title: `b` }),
          snapshot([{ ...a, title: `c` }], 1),
        ]
      },
    )
    add(
      `an already-seen change is superseded`,
      [`seen-change-superseded`],
      (row) => {
        const a = row()
        return [
          changes({ ...a, title: `a` }),
          changes({ ...a, title: `b` }),
          snapshot([{ ...a, title: `c` }], 2),
        ]
      },
    )
  }
  if (capabilities.has(`duplicate-key-delivery`)) {
    add(`malformed initial delivery`, [`malformed-before-ready`], (row) => [
      { kind: `malformed`, rows: [row(), row(1)], duplicate: 0 },
    ])
    if (capabilities.has(`complete-snapshot`))
      add(
        `malformed replacement delivery`,
        [`malformed-after-ready`, `rejected-delivery-reported`],
        (row) => [
          snapshot([row()]),
          { kind: `malformed`, rows: [row(1), row(2)], duplicate: 1 },
          changes(row(3)),
        ],
      )
  }
  const kinds = domain.valueKinds ?? []
  for (let at = 0; at < kinds.length; at += 4) {
    const group = kinds.slice(at, at + 4)
    add(
      `value kinds ${group.join(`, `)}`,
      group.flatMap((kind): Array<ValueReachState> => [
        `value:${kind}:load`,
        `value:${kind}:change`,
      ]),
      (row) => {
        const rows = group.map((kind, index) => row(index, kind))
        return [
          snapshot(rows),
          changes(...rows.slice(0, 3)),
          ...(rows.length > 3 ? [changes(...rows.slice(3))] : []),
        ]
      },
    )
  }
  if ((domain.fieldKinds ?? []).length > 0)
    add(
      `typed fields on both delivery paths`,
      (domain.fieldKinds ?? []).flatMap((kind): Array<ValueReachState> => [
        `field:${kind}:load`,
        `field:${kind}:change`,
      ]),
      (row) => [snapshot([row()]), changes(row(1))],
    )
  if (kinds.includes(`negative-zero`))
    add(`a retouch flips zero signs`, [`zero-sign-flipped`], (row) => [
      snapshot([row(0, `negative-zero`)]),
      { kind: `changes`, changes: [{ type: `retouch`, id: 1 }] },
    ])
  const covered = new Set(recipes.flatMap((recipe) => recipe.enters))
  const missing = required.filter((state) => !covered.has(state))
  if (missing.length > 0)
    throw new Error(`no construction for ${missing.join(`, `)}`)
  const arbitrary = eagerLiveSourceHistoryArb(domain)
  return recipes.flatMap((recipe) =>
    Array.from({ length: 5 }, (_, witness) => ({
      name: `${recipe.name}, witness ${witness + 1}`,
      enters: recipe.enters,
      build: (generated: EagerLiveSourceHistory): EagerLiveSourceHistory => {
        const native = resolveEagerLiveSourceHistory(generated)
        const text = describeValue(native)
        const entropy = [...text].reduce(
          (sum, character) => (sum + character.charCodeAt(0)) % 65_521,
          witness,
        )
        const pick = (
          kind: ValueKind,
          offset: number,
          valuePath = false,
        ): unknown => {
          const examples = valueExamples[kind].filter(
            (make) =>
              !domain.excludesValue?.(kind, make()) &&
              (!valuePath || kindOf(make()) === kind),
          )
          if (examples.length === 0)
            throw new Error(`no constructed ${kind} value`)
          return examples[(entropy + offset) % examples.length]!()
        }
        const row = (
          offset = 0,
          kind = kinds[(entropy + offset) % kinds.length],
        ): ConformanceRow => ({
          id: ((entropy + offset) % 5) + 1,
          title: ([`a`, `b`, `c`] as const)[(entropy + offset) % 3]!,
          ...(kind === undefined ? {} : { value: pick(kind, offset, true) }),
          ...((domain.fieldKinds ?? []).length === 0
            ? {}
            : {
                typed: Object.fromEntries(
                  (domain.fieldKinds ?? []).map((field, index) => [
                    field,
                    pick(field, offset + index),
                  ]),
                ),
              }),
        })
        const prefix = recipe.steps(row)
        // Keep the longest generated suffix that fits the same language. A
        // recipe itself is generated-data dependent even when no suffix fits.
        for (let keep = Math.min(native.length, 4); keep >= 0; keep--) {
          const history = [...prefix, ...native.slice(0, keep)]
          if (arbitrary.canShrinkWithoutContext(history))
            return eagerLiveSourceHistoryData(history)
        }
        throw new Error(`${recipe.name} is outside the history grammar`)
      },
    })),
  )
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
 *   failure after the first ready is listed (RETRY-1), from the
 *   `retryReportAfter`th attempt of the outage on.
 * - `outage` counts the current outage's failed attempts after ready.
 * - `retiredEvidence` holds the txids that retired runs committed (EVID-2).
 * - `waits` records every `awaitTxId` call with the settlement the model
 *   expects, across sync runs, because a retired wait must reject.
 *
 * Model-only terms: `phase` combines Collection status with whether the
 * provider can still deliver. `stopped` maps to status `ready` plus a node
 * `error`; it is not a Collection status.
 */
type Phase = `loading` | `ready` | `loading-error` | `stopped`

/** A listed failure: an injected failure's index, or the adapter's error. */
type FailureEntry = number | `adapter`

/** A wait's expected settlement. */
type WaitExpectation = `pending` | `fulfilled` | `rejected`

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
  /**
   * Txids committed in retired sync runs (EVID-2). Txids number batches
   * across runs, as a backend's transaction ids do.
   */
  retiredEvidence: Set<number>
  renewed: boolean
  /**
   * A provider failure's index; `adapter` for the adapter's own error.
   */
  failure: number | `adapter` | undefined
  /** `adapter` for a rejected delivery reported under `reported`. */
  transient: Array<FailureEntry>
  /** Consecutive failed attempts after ready in the current outage. */
  outage: number
  /** Each `awaitSync` call and its expected settlement, across sync runs. */
  syncWaits: Array<{ run: number; expected: WaitExpectation }>
  /** Each wait, and the law that rejects it when it must reject. */
  waits: Array<{
    run: number
    txid: number
    expected: WaitExpectation
    rejectLaw?: `EVID-2` | `EVID-3`
  }>
}

/** What the model predicts at a checkpoint. */
export interface ExpectedObservation {
  status: `loading` | `ready` | `error`
  rows: RowState
  /** Index of the failure the health node's `error` must carry, or none. */
  healthError: number | `adapter` | null
  /** Indices of the failures `failureReason.errors` must list, in order. */
  failureReason: ReadonlyArray<FailureEntry>
  preload: `pending` | `fulfilled` | { rejectedWith: number | `adapter` }
  waits: ReadonlyArray<WaitExpectation>
  syncWaits: ReadonlyArray<WaitExpectation>
  /** Unreleased provider subscriptions: one while the provider runs. */
  /** Undefined when no law fixes it: after the adapter rejected a delivery. */
  openSubscriptions: number | undefined
  /** Subscriptions opened in total: one per sync run, renewal included. */
  openedSubscriptions: number
  renewalsThisRun: number
}

/**
 * FID-1's strict equality as a canonical description, written here rather
 * than taken from any codec or equality helper in production. Two values
 * describe alike exactly when they have the same type and prototype, equal
 * numbers under `Object.is`, equal Date times, and the same elements or own
 * enumerable keys, whatever their key order. A value no kind produces, such
 * as a class instance or an own `undefined`, describes as itself so that it
 * differs from every generated value.
 */
export function describeValue(value: unknown): string {
  switch (typeof value) {
    case `string`:
      return `s${JSON.stringify(value)}`
    case `number`:
      return Object.is(value, -0) ? `n-0` : `n${String(value)}`
    case `boolean`:
      return `b${String(value)}`
    case `bigint`:
      return `i${String(value)}`
    case `undefined`:
      return `undefined`
    case `object`: {
      if (value === null) return `null`
      const prototype = Object.getPrototypeOf(value) as unknown
      if (value instanceof Date && prototype === Date.prototype) {
        const time = value.getTime()
        return Number.isNaN(time) ? `d?` : `d${time}`
      }
      if (Array.isArray(value) && prototype === Array.prototype) {
        return `[${value.map(describeValue).join(`,`)}]`
      }
      if (prototype === Float64Array.prototype) {
        return `f[${[...(value as Float64Array)].map(describeValue).join(`,`)}]`
      }
      if (prototype === Object.prototype || prototype === null) {
        const fields = Object.keys(value)
          .sort()
          .map(
            (key) =>
              `${JSON.stringify(key)}:${describeValue((value as Record<string, unknown>)[key])}`,
          )
        return `{${fields.join(`,`)}}`
      }
      return `?${Object.prototype.toString.call(value)}`
    }
    default:
      return `?${typeof value}`
  }
}

/** The kind of a generated value, for reach. */
function kindOf(value: unknown): ValueKind {
  if (value === null) return `null`
  if (value instanceof Float64Array) return `float-array`
  if (describeValue(value).includes(`n-0`)) return `negative-zero`
  if (typeof value === `number`) {
    return Number.isInteger(value) ? `integer` : `float`
  }
  if (value instanceof Date) return `date`
  if (Array.isArray(value)) return `array`
  return typeof value === `object` ? `object` : (typeof value as ValueKind)
}

type RowFields = Omit<ConformanceRow, `id`>

/**
 * A row as the model compares it: its title, then `/note` when the row has
 * its own `note`, then `#` and the described `value` when it has its own
 * `value`. An own `undefined` note shows as `undefined`.
 */
function rowValue(row: RowFields): string {
  const head = Object.hasOwn(row, `note`)
    ? `${row.title}/${String(row.note)}`
    : row.title
  const value = Object.hasOwn(row, `value`)
    ? `#${describeValue(row.value)}`
    : ``
  const typed = Object.hasOwn(row, `typed`)
    ? `$${describeValue(row.typed)}`
    : ``
  return `${head}${value}${typed}`
}

/** Title and note, without the value. */
function rowHead(value: string): string {
  const mark = value.search(/[#$]/)
  return mark === -1 ? value : value.slice(0, mark)
}

/**
 * Rows the model generated, by description, so that a computed state can be
 * delivered as rows again (the initial cut's read). Only generated rows are
 * remembered, never observed ones.
 */
const generatedRows = new Map<string, RowFields>()

function modelValue(row: ConformanceRow): string {
  const { id: _id, ...fields } = row
  const value = rowValue(fields)
  generatedRows.set(value, fields)
  return value
}

function rowFromValue(id: number, value: string): ConformanceRow {
  const fields = generatedRows.get(value)
  if (!fields) throw new Error(`the model lost row ${value}`)
  return { id, ...fields }
}

function rowMap(rows: ReadonlyArray<ConformanceRow>): Map<number, string> {
  return new Map(rows.map((row) => [row.id, modelValue(row)]))
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
    retiredEvidence: new Set(),
    renewed: false,
    failure: undefined,
    transient: [],
    outage: 0,
    waits: [],
    syncWaits: [],
  }
}

/** A delivery needs a running sync run whose provider is still connected. */
function canDeliver(state: ModelState): boolean {
  return (
    (state.phase === `loading` || state.phase === `ready`) && state.connected
  )
}

/** HEALTH-2: a delivery, failure, or restart ends the outage. */
function endOutage(state: ModelState): void {
  state.transient = []
  state.outage = 0
}

/**
 * EVID-2: a sync run retires when it fails or is cleaned up, and its pending
 * waits reject then; no evidence can arrive for them. Authority: the law
 * set's "retired ... when it fails", confirmed by maintainer decision
 * 2026-10-30 (a pending wait rejects at the failure).
 */
function retireWaits(state: ModelState): void {
  for (const wait of state.waits) {
    if (wait.run === state.run && wait.expected === `pending`) {
      wait.expected = `rejected`
      wait.rejectLaw = `EVID-2`
    }
  }
  for (const wait of state.syncWaits) {
    if (wait.run === state.run && wait.expected === `pending`) {
      wait.expected = `rejected`
    }
  }
}

/**
 * READY-3: the first complete delivery opens the gate. EVID-2: a retired
 * run's evidence fulfills a wait once the current run is ready, because its
 * rows are read after that evidence (maintainer decision 2026-10-30).
 */
function openGate(state: ModelState): void {
  state.phase = `ready`
  for (const wait of state.waits) {
    if (
      wait.run === state.run &&
      wait.expected === `pending` &&
      state.retiredEvidence.has(wait.txid)
    ) {
      wait.expected = `fulfilled`
    }
  }
  // EVID-1: the first accepted result fulfills the run's `awaitSync` waits.
  for (const wait of state.syncWaits) {
    if (wait.run === state.run && wait.expected === `pending`) {
      wait.expected = `fulfilled`
    }
  }
}

function rowState(rows: ReadonlyMap<number, string>): RowState {
  return [...rows].sort(([a], [b]) => a - b)
}

/** A value with the sign of every zero in it changed, nested ones too. */
function flipZeros(value: unknown): unknown {
  if (typeof value === `number`) {
    return value === 0 ? (Object.is(value, -0) ? 0 : -0) : value
  }
  if (Array.isArray(value)) return value.map(flipZeros)
  if (value instanceof Float64Array) {
    return value.map((item) => flipZeros(item) as number)
  }
  if (
    typeof value === `object` &&
    value !== null &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, flipZeros(item)]),
    )
  }
  return value
}

/**
 * Folds one batch onto `rows` in order and returns the changes a provider
 * delivers: a delete or retouch of a key it does not hold is dropped, and a
 * retouch delivers the held row again, its zeros flipped when `flipZeros`.
 * `onChange` sees the rows after each delivered change; `flipped` counts
 * retouches that changed a value.
 */
function foldBatch(
  rows: Map<number, string>,
  changes: ReadonlyArray<HistoryChange>,
  options: { onChange?: () => void; flipZeros?: boolean } = {},
): { delivered: Array<ProviderChange>; flipped: number } {
  const delivered: Array<ProviderChange> = []
  let flipped = 0
  for (const change of changes) {
    if (change.type === `upsert`) {
      rows.set(change.row.id, modelValue(change.row))
      delivered.push(change)
    } else if (change.type === `delete`) {
      if (!rows.has(change.id)) continue
      rows.delete(change.id)
      delivered.push(change)
    } else {
      const keys = [...rows.keys()].sort((a, b) => a - b)
      if (keys.length === 0) continue
      const id = keys[change.id % keys.length]!
      const held = rowFromValue(id, rows.get(id)!)
      const row =
        options.flipZeros && Object.hasOwn(held, `value`)
          ? { ...held, value: flipZeros(held.value) }
          : held
      const value = modelValue(row)
      if (value !== rows.get(id)) flipped++
      rows.set(id, value)
      delivered.push({ type: `upsert`, row })
    }
    options.onChange?.()
  }
  return { delivered, flipped }
}

/** Whether a key held in both lost the `note` it had in `before`. */
function lostField(
  before: ReadonlyMap<number, string>,
  after: ReadonlyMap<number, string>,
): boolean {
  return [...before].some(
    ([id, value]) =>
      rowHead(value).includes(`/`) &&
      after.has(id) &&
      !rowHead(after.get(id)!).includes(`/`),
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
      /** Whether a retouch changed a value only by the sign of a zero. */
      flipped: boolean
    }
  | { kind: `wait`; txid: number; timeout: boolean }
  | { kind: `fail`; failure: number }
  | {
      kind: `malformed`
      rows: ReadonlyArray<ConformanceRow>
      afterReady: boolean
      /** `duplicateInsert: replace` applied the later row. */
      replaced: boolean
    }
  | { kind: `transient-failure`; failure: number; variant: number }
  | { kind: `disconnect` }
  | { kind: `reconnect` }
  | { kind: `renew` }
  | { kind: `empty-response`; resetOutage: boolean }
  | { kind: `delivery-error`; failure: number }
  | { kind: `sync-wait` }
  | { kind: `restart`; prompt: boolean }

/**
 * Applies one step to the model. Returns the accepted step and the row
 * states that a publication during the step may show (PUB-1), or
 * `undefined` when the step is illegal now.
 */
/** The driver facts the model depends on. */
interface ModelOptions {
  changeCommits: EagerLiveSourceDriver[`changeCommits`]
  listenBeforeFetch: boolean
  /** The value kinds include `negative-zero`, so a retouch flips zeros. */
  flipZeros: boolean
  duplicateInsert: `error` | `replace`
  txidEvidence: `batch` | `change`
  retryReportAfter: number
  rejectedDelivery: `fails` | `reported`
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
    foldBatch(backend, batch.changes, {
      onChange: () => prefixes.push(rowState(backend)),
    })
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
      endOutage(state)
      if (options.listenBeforeFetch && state.phase === `loading`) {
        const buffered = state.buffered.length
        const seen = Math.min(step.seen ?? buffered, buffered)
        const cut = initialCut(state, seen, options.changeCommits)
        state.rows = cut.backend
        state.backend = new Map(cut.backend)
        openGate(state)
        for (const batch of state.buffered) {
          if (options.txidEvidence === `batch` || batch.changes.length > 0) {
            applyEvidence(state, batch.txid)
          }
        }
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
      openGate(state)
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
        const { delivered, flipped } = foldBatch(state.backend, step.changes, {
          flipZeros: options.flipZeros,
        })
        state.lastTxid += 1
        state.buffered.push({ changes: delivered, txid: state.lastTxid })
        return {
          done: {
            kind: `changes`,
            changes: delivered,
            txid: state.lastTxid,
            beforeReady: true,
            removesField: false,
            flipped: flipped > 0,
          },
          publishable: [],
        }
      }
      if (state.phase !== `ready`) return undefined
      // PUB-3: fold the batch in order. PUB-1: each prefix is a committed
      // state when the provider commits each change alone.
      const prefixes: Array<RowState> = []
      const { delivered, flipped } = foldBatch(state.rows, step.changes, {
        onChange: () => prefixes.push(rowState(state.rows)),
        flipZeros: options.flipZeros,
      })
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
          rowHead(held.get(change.row.id) ?? ``).includes(`/`)
        ) {
          removesField = true
        }
        held.set(change.row.id, modelValue(change.row))
      }
      foldBatch(state.backend, delivered)
      state.lastTxid += 1
      endOutage(state)
      // EVID-1: under `change`, only a batch with a change carries its txid.
      if (options.txidEvidence === `batch` || delivered.length > 0) {
        applyEvidence(state, state.lastTxid)
      }
      return {
        done: {
          kind: `changes`,
          changes: delivered,
          txid: state.lastTxid,
          beforeReady: false,
          removesField,
          flipped: flipped > 0,
        },
        publishable:
          options.changeCommits === `per-change`
            ? prefixes
            : [rowState(state.rows)],
      }
    }
    case `wait`: {
      const txid = Math.max(1, state.lastTxid + step.ahead)
      // EVID-1: evidence the shown rows reflect fulfills the wait: this
      // run's, or a retired run's once the Collection is ready (EVID-2).
      // EVID-3: a wait with a timeout and no evidence rejects once the
      // timeout passes, which is before the next checkpoint. EVID-2: after
      // a failure no evidence can arrive, so the wait rejects.
      const timeout = step.timeout === true
      const running = state.phase === `loading` || state.phase === `ready`
      const shown =
        state.committed.has(txid) ||
        (state.phase !== `loading` &&
          state.phase !== `loading-error` &&
          state.retiredEvidence.has(txid))
      state.waits.push({
        run: state.run,
        txid,
        expected: shown
          ? `fulfilled`
          : !running || timeout
            ? `rejected`
            : `pending`,
        rejectLaw: running ? `EVID-3` : `EVID-2`,
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
      endOutage(state)
      retireWaits(state)
      return { done: { kind: `fail`, failure }, publishable: [] }
    }
    case `malformed`: {
      if (!canDeliver(state)) return undefined
      // PUB-4: the adapter rejects the delivery. No row of it is written,
      // so the rows stay; the sync run fails with the adapter's own error.
      const base = step.rows[step.duplicate % step.rows.length]!
      const titles = [`a`, `b`, `c`].filter((title) => title !== base.title)
      const rows = [...step.rows, { ...base, title: titles[0]! }]
      const afterReady = state.phase === `ready`
      if (options.duplicateInsert === `replace`) {
        // PUB-3: the later row wins; the delivery applies as a complete one.
        // Before the first ready of a listen-before-fetch run, the cut's
        // read point would need its own rule, so the step is not legal there.
        if (options.listenBeforeFetch && !afterReady) return undefined
        state.rows = rowMap(rows)
        state.backend = rowMap(rows)
        openGate(state)
        endOutage(state)
        return {
          done: { kind: `malformed`, rows, afterReady, replaced: true },
          publishable: [rowState(state.rows)],
        }
      }
      if (afterReady && options.rejectedDelivery === `reported`) {
        // HEALTH-1: a rejected delivery the next valid delivery can clear is
        // the node's failure reason; the run and its rows stay.
        state.transient.push(`adapter`)
        return {
          done: { kind: `malformed`, rows, afterReady, replaced: false },
          publishable: [],
        }
      }
      state.failure = `adapter`
      state.phase = afterReady ? `stopped` : `loading-error`
      endOutage(state)
      state.buffered = []
      retireWaits(state)
      return {
        done: { kind: `malformed`, rows, afterReady, replaced: false },
        publishable: [],
      }
    }
    case `transient-failure`: {
      if (!canDeliver(state)) return undefined
      const failure = failures.next++
      // RETRY-1: before the first ready a retried failure shows nothing.
      // HEALTH-1: after it, the failure joins `failureReason` once the
      // outage reached `retryReportAfter` attempts.
      if (state.phase === `ready`) {
        state.outage += 1
        if (state.outage >= options.retryReportAfter) {
          state.transient.push(failure)
        }
      }
      return {
        done: {
          kind: `transient-failure`,
          failure,
          variant: step.variant ?? 0,
        },
        publishable: [],
      }
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
    case `sync-wait`: {
      // EVID-1 (`awaitSync`): while the run's latest source result is a
      // failure the wait rejects with it; it fulfills after an accepted
      // result, so before the first one it waits. A result the client
      // cached for an earlier subscription is not this run's (maintainer
      // decision 2026-11-02).
      state.syncWaits.push({
        run: state.run,
        expected:
          state.phase === `loading`
            ? `pending`
            : state.phase === `ready` && state.transient.length === 0
              ? `fulfilled`
              : `rejected`,
      })
      return { done: { kind: `sync-wait` }, publishable: [] }
    }
    case `delivery-error`: {
      if (!canDeliver(state) || state.phase !== `ready`) return undefined
      const failure = failures.next++
      // HEALTH-1, HEALTH-2: the error joins `failureReason` until the next
      // valid delivery; status, rows, and the subscription stay.
      state.transient.push(failure)
      return { done: { kind: `delivery-error`, failure }, publishable: [] }
    }
    case `empty-response`: {
      if (!canDeliver(state) || state.phase !== `ready`) return undefined
      // RETRY-1: an accepted response ends the run of failed attempts, so a
      // later outage counts from one; a reported outage stays until an
      // applied delivery (maintainer decision 2026-10-30: "in a row").
      const resetOutage = state.outage > 0
      state.outage = 0
      return { done: { kind: `empty-response`, resetOutage }, publishable: [] }
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
      // EVID-2: the retired run's evidence fulfills a later wait only once
      // this run is ready (`openGate`).
      for (const txid of state.committed) state.retiredEvidence.add(txid)
      state.committed = new Set()
      state.renewed = false
      state.failure = undefined
      endOutage(state)
      return {
        done: { kind: `restart`, prompt: step.prompt === true },
        publishable: [],
      }
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
    syncWaits: state.syncWaits.map((wait) => wait.expected),
    // LIFE-10: a failed provider's source is released at its end.
    openSubscriptions: running
      ? 1
      : state.failure === `adapter`
        ? undefined
        : 0,
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
  `restart-after-failure`,
  `prompt-restart`,
  `prompt-failure-after-failed-run`,
  `wait-before-evidence-fulfilled`,
  `wait-timed-out`,
  `wait-rejected-at-retirement`,
  `wait-on-retired-evidence`,
  `transient-failure-reported`,
  `transient-failure-below-threshold`,
  `transient-failure-repeated`,
  `outage-reported-again`,
  `outage-reported-after-batch`,
  `outage-reported-in-later-run`,
  `outage-count-reset`,
  `delivery-error-reported`,
  `delivery-error-recovered`,
  `rejected-delivery-reported`,
  `sync-wait-pending`,
  `sync-wait-on-failure`,
  `transient-failure-recovered`,
  `reconnect`,
  `renewal`,
  `change-before-ready`,
  `read-missed-change`,
  `seen-change-superseded`,
  `field-removed`,
  `malformed-before-ready`,
  `malformed-after-ready`,
] as const

/**
 * Per value kind, a value delivered on the initial load and one delivered by
 * a live change: a decoder can differ between the two paths.
 */
export type ValueReachState =
  | `value:${ValueKind}:${`load` | `change`}`
  | `field:${ValueKind}:${`load` | `change`}`

export type EagerLiveSourceReachState =
  | (typeof eagerLiveSourceReachStates)[number]
  | ValueReachState
  | `zero-sign-flipped`
  /** A failed attempt of each declared kind after ready. */
  | `transient:${string}`

const capabilityOfState: Partial<
  Record<(typeof eagerLiveSourceReachStates)[number], EagerLiveSourceCapability>
> = {
  'replacing-snapshot': `complete-snapshot`,
  'prompt-restart': `prompt-after-restart`,
  'prompt-failure-after-failed-run': `prompt-after-restart`,
  'wait-before-evidence-fulfilled': `await-evidence`,
  'wait-timed-out': `await-evidence`,
  'wait-rejected-at-retirement': `await-evidence`,
  'wait-on-retired-evidence': `await-evidence`,
  'transient-failure-reported': `retry-policy`,
  'transient-failure-below-threshold': `retry-policy`,
  'outage-reported-again': `retry-policy`,
  'outage-reported-after-batch': `retry-policy`,
  'outage-reported-in-later-run': `retry-policy`,
  'outage-count-reset': `empty-response`,
  'delivery-error-reported': `delivery-error`,
  'delivery-error-recovered': `delivery-error`,
  'rejected-delivery-reported': `duplicate-key-delivery`,
  'sync-wait-pending': `await-sync`,
  'sync-wait-on-failure': `await-sync`,
  'transient-failure-repeated': `retry-policy`,
  'transient-failure-recovered': `retry-policy`,
  reconnect: `transport-reconnect`,
  renewal: `capability-renewal`,
  'change-before-ready': `listen-before-fetch`,
  'read-missed-change': `listen-before-fetch`,
  'seen-change-superseded': `listen-before-fetch`,
  'malformed-before-ready': `duplicate-key-delivery`,
  'failure-after-ready': `source-failure-after-ready`,
  'malformed-after-ready': `duplicate-key-delivery`,
}

/** The declared states a driver's declarations let histories reach. */
export function reachStatesFor(
  domain: GrammarDomain,
): Array<EagerLiveSourceReachState> {
  const fixed: Array<EagerLiveSourceReachState> =
    eagerLiveSourceReachStates.filter((state) => {
      const capability = capabilityOfState[state]
      return capability === undefined || domain.capabilities.has(capability)
    })
  // A malformed delivery after ready also needs `complete-snapshot`; an
  // unreported attempt needs `retryReportAfter` above 1.
  const reachable = fixed.filter(
    (state) =>
      (state !== `malformed-after-ready` ||
        domain.capabilities.has(`complete-snapshot`)) &&
      (state !== `transient-failure-below-threshold` ||
        (domain.retryReportAfter ?? 1) > 1) &&
      (state !== `rejected-delivery-reported` ||
        domain.rejectedDelivery === `reported`),
  )
  const values = (domain.valueKinds ?? []).flatMap(
    (kind): Array<ValueReachState> => [
      `value:${kind}:load`,
      `value:${kind}:change`,
    ],
  )
  const fields = (domain.fieldKinds ?? []).flatMap(
    (kind): Array<ValueReachState> => [
      `field:${kind}:load`,
      `field:${kind}:change`,
    ],
  )
  const zeros: Array<EagerLiveSourceReachState> = domain.valueKinds?.includes(
    `negative-zero`,
  )
    ? [`zero-sign-flipped`]
    : []
  const variants: Array<EagerLiveSourceReachState> = domain.capabilities.has(
    `retry-policy`,
  )
    ? (domain.transientVariants ?? []).map(
        (name): EagerLiveSourceReachState => `transient:${name}`,
      )
    : []
  return [...reachable, ...values, ...fields, ...zeros, ...variants]
}

/** JSON for a message; a bigint shows as `<digits>n`, `-0` as `-0`. */
function show(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === `bigint`
      ? `${String(item)}n`
      : Object.is(item, -0)
        ? `-0`
        : item,
  )
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
      `${law} violated at step ${step} of ${show(history)}: ` +
        `expected ${show(expected)}, observed ${show(actual)}`,
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
 * event-loop turns, or within the propagation step their fixture declares. Three macrotask turns cover microtask receipts and one
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
      return wasReady
        ? `PUB-7`
        : done.buffered > 0
          ? `READY-10/PUB-9`
          : `READY-3`
    case `changes`:
      return done.beforeReady ? `READY-10/PUB-9` : `PUB-3/FID-4`
    case `wait`:
      return done.timeout ? `EVID-3` : `EVID-1`
    case `sync-wait`:
      return `EVID-1`
    case `fail`:
      return wasReady ? `HEALTH-1` : `READY-4`
    case `malformed`:
      return done.replaced ? `PUB-3 (duplicateInsert: replace)` : `PUB-4`
    case `transient-failure`:
      return wasReady ? `HEALTH-1` : `RETRY-1`
    case `disconnect`:
    case `reconnect`:
      return `RECON-1`
    case `renew`:
      return `RENEW-1`
    case `empty-response`:
      return `RETRY-1`
    case `delivery-error`:
      return `HEALTH-1`
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
    flipZeros: driver.valueKinds?.includes(`negative-zero`) === true,
    duplicateInsert: driver.duplicateInsert ?? `error`,
    txidEvidence: driver.txidEvidence ?? `batch`,
    retryReportAfter: driver.retryReportAfter ?? 1,
    rejectedDelivery: driver.rejectedDelivery ?? `fails`,
  }
  if (
    driver.capabilities.has(`duplicate-key-delivery`) &&
    driver.duplicateInsert === undefined
  ) {
    throw new Error(`duplicate-key-delivery needs a duplicateInsert policy`)
  }
  // No law fixes whether a reconnect or a renewal ends an outage that a
  // threshold is still counting; a connection-aware source reports at once.
  if (
    (driver.retryReportAfter ?? 1) > 1 &&
    (driver.capabilities.has(`transport-reconnect`) ||
      driver.capabilities.has(`capability-renewal`))
  ) {
    throw new Error(
      `retryReportAfter above 1 has no law with transport-reconnect or capability-renewal`,
    )
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
  let created: EagerLiveSourceFixture | undefined
  try {
    created = driver.create()
    if (listenBeforeFetch) {
      await created.provider.seed?.(structuredClone(seedFrom(0)))
    }
  } catch (error) {
    // A setup failure leaves no console or rejection patch, and no fixture,
    // behind (ORC-010).
    detached.stop()
    await created?.dispose?.()
    throw error
  }
  const fixture = created
  const { collection, provider } = fixture
  const state = initialModel(seedFrom(0))
  const failures: Array<Error> = []
  const failureCounter = { next: 0 }
  const waits: Array<{ current: Settlement }> = []
  const syncWaits: Array<{ current: Settlement }> = []
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
        // FID-1: a publication that differs from a committed state only in
        // a value or typed field names the value law.
        const valuesOnly = publishable.some((rows) =>
          sameRows(rows, publication, rowHead),
        )
        throw violation(
          valuesOnly ? `FID-1 (values)` : `${law} (publication)`,
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
  // (also READY-10/PUB-9 when its batch should still be buffered; EVID-2
  // when a retired run committed it),
  // EVID-3 for a timed wait that did not reject, and LIFE-10 for a failed
  // provider's subscription that stays open or is released twice.
  // HEALTH-4: the reported value for an injected failure is the provider's
  // value, or under `matchesFailure` the value the driver's relation names.
  const matches = (reported: unknown, index: number) =>
    driver.matchesFailure
      ? driver.matchesFailure(reported, index)
      : reported === failure(index)
  const compare = async (
    stepIndex: number,
    law: string,
    delivery: boolean = false,
  ) => {
    await settle()
    await fixture.settle?.()
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
    if (
      !sameRows(rows, expected.rows) &&
      sameRows(rows, expected.rows, rowTitle)
    ) {
      throw violation(
        sameRows(rows, expected.rows, rowHead)
          ? `FID-1 (values)`
          : `FID-1 (fields)`,
        stepIndex,
        expected.rows,
        rows,
      )
    }
    check(`rows`, sameRows(rows, expected.rows), expected.rows, rows)
    if (readyRows !== undefined) {
      // READY-10 when the cut folded buffered batches; READY-3 otherwise.
      if (!sameRows(readyRows, expected.rows)) {
        throw violation(
          `${law.includes(`READY-10`) ? `READY-10` : `READY-3`} (rows when ready)`,
          stepIndex,
          expected.rows,
          readyRows,
        )
      }
      readyRows = undefined
    }
    if (!sameRows(events.rows(), rows)) {
      throw violation(`PUB-2 (change events)`, stepIndex, rows, events.rows())
    }
    const health = collection.health
    if (expected.healthError === null) {
      check(`health error`, health.error === null, null, health.error?.message)
    } else if (expected.healthError === `adapter`) {
      check(`health error`, health.error !== null, `an error`, null)
    } else {
      check(
        `health error cause`,
        matches(health.error?.cause, expected.healthError),
        failure(expected.healthError).message,
        health.error?.message ?? null,
      )
    }
    const reasons =
      health.failureReason?.errors.map((entry) => entry.cause) ?? []
    // `adapter`: the adapter's own error, not an injected failure value.
    const matchesEntry = (cause: unknown, entry: FailureEntry) =>
      entry === `adapter`
        ? cause instanceof Error &&
          failures.every((_, index) => !matches(cause, index))
        : matches(cause, entry)
    const describeEntry = (entry: FailureEntry) =>
      entry === `adapter` ? `an adapter error` : failure(entry).message
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
    if (!driver.matchesFailure) {
      const want = expected.failureReason
      checkReason(
        reasons.length === want.length &&
          reasons.every((cause, index) => matchesEntry(cause, want[index]!)) &&
          (want.length === 0 || health.failureReason?.cause === reasons.at(-1)),
        want.map(describeEntry),
        reasons.map(String),
      )
    } else {
      // Client-created values: the outage shows the attempt that crossed
      // the threshold (maintainer decision 2026-10-30), and may list later
      // attempts after it, in order. RETRY-1: a later attempt does not
      // replace that first failure.
      const want = expected.failureReason
      if (want.length > 0 && !matchesEntry(reasons[0], want[0]!)) {
        throw violation(
          reasons.length > 0 &&
            want.slice(1).some((i) => matchesEntry(reasons[0], i))
            ? `RETRY-1 (health failureReason)`
            : `${reasonLaw} (health failureReason)`,
          stepIndex,
          describeEntry(want[0]!),
          reasons.map(String),
        )
      }
      let next = 0
      checkReason(
        reasons.length <= want.length &&
          reasons.every((cause) => {
            while (next < want.length && !matchesEntry(cause, want[next]!))
              next++
            return next++ < want.length
          }),
        want.map(describeEntry),
        reasons.map(String),
      )
    }
    const want = expected.preload
    const got = preload.current
    check(
      `preload`,
      typeof want === `string`
        ? got === want
        : typeof got === `object` &&
            (want.rejectedWith === `adapter` ||
              matches(got.rejected, want.rejectedWith)),
      want,
      typeof got === `object` ? { rejected: String(got.rejected) } : got,
    )
    expected.syncWaits.forEach((wantWait, index) => {
      const settled = syncWaits[index]!.current
      const gotKind = typeof settled === `object` ? `rejected` : settled
      if (gotKind !== wantWait) {
        throw violation(
          `EVID-1 (awaitSync ${index})`,
          stepIndex,
          wantWait,
          gotKind,
        )
      }
    })
    expected.waits.forEach((wantWait, index) => {
      const gotWait = waits[index]!.current
      const gotKind = typeof gotWait === `object` ? `rejected` : gotWait
      if (gotKind === wantWait) return
      // A wait for a batch still buffered before the cut fulfilled: the
      // adapter applied that batch early, or fulfilled the wait without it.
      const buffered = state.buffered.some(
        (batch) =>
          batch.txid === state.waits[index]!.txid &&
          state.waits[index]!.run === state.run,
      )
      const model = state.waits[index]!
      const retired = state.retiredEvidence.has(model.txid)
      const current = state.committed.has(model.txid)
      // A fulfilled wait names the evidence it lacked; an unfulfilled one
      // names why it should have settled.
      const waitLaw =
        gotKind === `fulfilled`
          ? buffered
            ? `EVID-1/READY-10/PUB-9`
            : retired && !current
              ? `EVID-2`
              : !current
                ? `EVID-1`
                : (model.rejectLaw ?? law)
          : wantWait === `fulfilled`
            ? retired && !current
              ? `EVID-2`
              : `EVID-1`
            : wantWait === `rejected`
              ? (model.rejectLaw ?? law)
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
    if (
      expected.openSubscriptions !== undefined &&
      open !== expected.openSubscriptions
    ) {
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
    // The kinds of failure open in the failure reason, which a delivery
    // clears.
    const open = new Set<`retried` | `delivery-error`>()
    const reachRecovered = () => {
      if (open.has(`retried`)) reach(`transient-failure-recovered`)
      if (open.has(`delivery-error`)) reach(`delivery-error-recovered`)
      open.clear()
    }
    // Reported outages and applied live batches in the current run.
    let outagesThisRun = 0
    let batchesThisRun = 0
    // A prompt restart whose checkpoint waits for the next accepted step,
    // which runs in the same task.
    let prompt: { index: number; afterFailure: boolean } | undefined
    for (const [index, step] of history.entries()) {
      const wasReady = state.phase === `ready`
      const phaseBefore = state.phase
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
      if (prompt?.afterFailure && done.kind === `fail`) {
        reach(`prompt-failure-after-failed-run`)
      }
      prompt = undefined
      switch (done.kind) {
        case `snapshot`:
          await provider.deliverSnapshot(structuredClone(done.rows))
          for (const row of done.rows) {
            if (Object.hasOwn(row, `value`)) {
              reach(`value:${kindOf(row.value)}:load`)
            }
            for (const kind of Object.keys(row.typed ?? {})) {
              reach(`field:${kind as ValueKind}:load`)
            }
          }
          reach(wasReady ? `replacing-snapshot` : `first-ready`)
          if (done.missed > 0) reach(`read-missed-change`)
          if (done.superseded) reach(`seen-change-superseded`)
          if (done.removesField) reach(`field-removed`)
          if (transientBefore > 0) reachRecovered()
          break
        case `changes`:
          await provider.deliverChanges(
            structuredClone(done.changes),
            String(done.txid),
          )
          for (const change of done.changes) {
            if (
              change.type === `upsert` &&
              Object.hasOwn(change.row, `value`)
            ) {
              reach(`value:${kindOf(change.row.value)}:change`)
            }
            if (change.type === `upsert`) {
              for (const kind of Object.keys(change.row.typed ?? {})) {
                reach(`field:${kind as ValueKind}:change`)
              }
            }
          }
          reach(done.beforeReady ? `change-before-ready` : `change-batch`)
          if (!done.beforeReady) batchesThisRun++
          if (done.removesField) reach(`field-removed`)
          if (done.flipped) reach(`zero-sign-flipped`)
          if (done.changes.length > 1) reach(`multi-change-batch`)
          if (transientBefore > 0) reachRecovered()
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
        case `sync-wait`: {
          syncWaits.push(recordSettlement(fixture.awaitSync!()))
          if (state.syncWaits.at(-1)!.expected === `pending`) {
            reach(`sync-wait-pending`)
          } else if (state.syncWaits.at(-1)!.expected === `rejected`) {
            reach(`sync-wait-on-failure`)
          }
          break
        }
        case `wait`: {
          const pending = fixture.awaitTxId!(
            String(done.txid),
            done.timeout ? waitTimeoutMs : undefined,
          )
          waits.push(recordSettlement(pending))
          // EVID-2: a retired run committed this txid; this run has not.
          if (
            state.retiredEvidence.has(done.txid) &&
            !state.committed.has(done.txid)
          ) {
            reach(`wait-on-retired-evidence`)
          }
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
          await provider.fail(error)
          reach(wasReady ? `failure-after-ready` : `failure-before-ready`)
          break
        }
        case `malformed`:
          await provider.deliverSnapshot(structuredClone(done.rows))
          reach(
            done.afterReady
              ? `malformed-after-ready`
              : `malformed-before-ready`,
          )
          if (done.afterReady && state.transient.at(-1) === `adapter`) {
            reach(`rejected-delivery-reported`)
          }
          break
        case `transient-failure`: {
          const error = new Error(
            `conformance transient failure ${done.failure}`,
          )
          failures[done.failure] = error
          await provider.transientFailure!(error, done.variant)
          const kind = driver.transientVariants?.[done.variant]
          if (wasReady && kind !== undefined) reach(`transient:${kind}`)
          if (state.transient.at(-1) === done.failure) {
            open.add(`retried`)
            reach(`transient-failure-reported`)
          } else if (wasReady) reach(`transient-failure-below-threshold`)
          // RETRY-1: a later attempt in the same outage.
          if (transientBefore > 0) reach(`transient-failure-repeated`)
          if (transientBefore === 0 && state.transient.length > 0) {
            // An outage crossed the threshold: after an earlier reported
            // outage of this run, after a live batch, or in a later run.
            if (outagesThisRun > 0) reach(`outage-reported-again`)
            if (batchesThisRun > 0) reach(`outage-reported-after-batch`)
            if (state.run > 1) reach(`outage-reported-in-later-run`)
            outagesThisRun++
          }
          break
        }
        case `disconnect`:
          await provider.disconnect!()
          break
        case `reconnect`:
          await provider.reconnect!()
          reach(`reconnect`)
          break
        case `renew`:
          await provider.completeRenewal!()
          reach(`renewal`)
          break
        case `delivery-error`: {
          const error = new Error(`conformance delivery error ${done.failure}`)
          failures[done.failure] = error
          await provider.deliveryError!(error)
          reach(`delivery-error-reported`)
          open.add(`delivery-error`)
          break
        }
        case `empty-response`:
          await provider.emptyResponse!()
          if (done.resetOutage) reach(`outage-count-reset`)
          break
        case `restart`: {
          const pendingBefore = waits.some((wait) => wait.current === `pending`)
          // LIFE-5: a failed run's restart starts loading, as any does.
          const failedBefore =
            phaseBefore === `loading-error` || phaseBefore === `stopped`
          events.stop()
          await collection.cleanup()
          // The backend may change while no sync run listens.
          if (listenBeforeFetch) {
            await provider.seed?.(structuredClone(seedFrom(index + 1)))
          }
          readyRows = undefined
          watchReady()
          preload = recordSettlement(collection.preload())
          events = foldChanges(collection)
          // LIFE-5 at a prompt restart's own cut: no turn passes before the
          // next step, which may otherwise hide an early ready. A fresh run
          // also shows no problem from the failed one.
          if (done.prompt) {
            const restarted = {
              status: collection.status,
              rows: observedRows(collection),
              problem:
                collection.health.error ?? collection.health.failureReason,
            }
            if (
              restarted.status !== `loading` ||
              restarted.rows.length > 0 ||
              restarted.problem !== null
            ) {
              throw violation(
                `LIFE-5 (prompt restart)`,
                index,
                { status: `loading`, rows: [], problem: null },
                restarted,
              )
            }
          }
          reach(`restart`)
          if (failedBefore) reach(`restart-after-failure`)
          if (done.prompt) reach(`prompt-restart`)
          open.clear()
          outagesThisRun = 0
          batchesThisRun = 0
          if (pendingBefore) reach(`wait-rejected-at-retirement`)
          if (done.prompt) {
            // No turn before the next step: its checkpoint covers this one.
            events.take()
            prompt = { index, afterFailure: failedBefore }
            continue
          }
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
              : done.kind === `malformed` && !done.replaced
                ? `PUB-4`
                : `PUB-1`,
        )
      } else {
        events.take()
      }
    }
    // A prompt restart with no later accepted step still has its checkpoint.
    if (prompt) await compare(prompt.index, `LIFE-2/LIFE-5`)
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
    await fixture.settle?.()
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
    case `fail`:
      return !ready || driver.capabilities.has(`source-failure-after-ready`)
    case `malformed`:
      return (
        driver.capabilities.has(`duplicate-key-delivery`) &&
        (!ready || driver.capabilities.has(`complete-snapshot`))
      )
    case `wait`:
      return driver.capabilities.has(`await-evidence`) && !!fixture.awaitTxId
    case `sync-wait`:
      return driver.capabilities.has(`await-sync`) && !!fixture.awaitSync
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
    case `empty-response`:
      return (
        driver.capabilities.has(`empty-response`) &&
        !!fixture.provider.emptyResponse
      )
    case `delivery-error`:
      return (
        driver.capabilities.has(`delivery-error`) &&
        !!fixture.provider.deliveryError
      )
    default:
      return true
  }
}

/** A row's title, without its note and fields. */
function rowTitle(value: string): string {
  return rowHead(value).split(`/`)[0]!
}

/**
 * Same keys in order, and rows equal under `project`: the whole row by
 * default, `rowHead` for title and note, or `rowTitle`.
 */
function sameRows(
  a: RowState,
  b: RowState,
  project: (value: string) => string = (value) => value,
): boolean {
  return (
    a.length === b.length &&
    a.every(
      ([id, value], index) =>
        b[index]![0] === id && project(b[index]![1]) === project(value),
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

/** A reach counter: a driver begins each history, then records each declared state it enters. */
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
 *
 * A calibration names the law it calibrates (`law`: the violation's whole
 * law, such as `FID-1 (values)`, or a pattern that must match the whole law,
 * for a mutant that either of two laws may reject). Only that law's
 * violations fail a history then, so the calibration checks that this law
 * rejects the mutant, whichever other law a generated history happens to
 * break first. A name that is only part of a law, such as `FID-1` or
 * `HEALTH-`, matches nothing, so a calibration cannot pass on a broader law
 * than it names.
 */
export function eagerLiveSourceProperty(
  driver: EagerLiveSourceDriver,
  reach?: ReachCounter,
  law?: string | RegExp,
) {
  let target: string | undefined
  return fc.asyncProperty(
    eagerLiveSourceHistoryArb(driver),
    async (history) => {
      reach?.beginHistory()
      try {
        await checkEagerLiveSourceHistory(driver, history, {
          reach: reach?.reach,
        })
      } catch (error) {
        const violated =
          error instanceof ConformanceViolation
            ? error.law
            : `failure outside the comparison`
        const calibrated = law === undefined || namesLaw(law, violated)
        if (calibrated) target ??= violated
        if (violated === target) throw error
      }
    },
  )
}

/**
 * Whether a calibration's `law` names the violated law: the same string, or a
 * pattern that matches the whole of it. The pattern is anchored at both ends,
 * so an alternative that matches only a prefix of the law, as `EVID-2` does in
 * `/EVID-2|EVID-2 \(awaitTxId \d+\)/`, cannot hide one that matches all of
 * it. The `g`, `y`, and `m` flags are dropped: they would make the answer
 * depend on the pattern's `lastIndex` or on one line of the law.
 */
export function namesLaw(law: string | RegExp, violated: string): boolean {
  if (typeof law === `string`) return violated === law
  return new RegExp(
    `^(?:${law.source})$`,
    law.flags.replace(/[gmy]/g, ``),
  ).test(violated)
}

// Exported for calibration tests: the model's prediction for a history.
export const eagerLiveSourceModel = {
  initial: initialModel,
  step: stepModel,
  expected: expectedObservation,
}
