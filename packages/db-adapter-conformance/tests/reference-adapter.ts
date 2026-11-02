/**
 * A small push adapter written for this package, and the controlled provider
 * it reads. It exists to give the eager live-source oracle a production path
 * that is expected to conform, and to host the hostile mutants that the
 * calibration tests run (ORC-006). It is not a published adapter.
 *
 * The provider pushes a complete result, then committed batches that carry a
 * txid. Its subscription is live before the result arrives, so batches can
 * arrive first; the adapter buffers them and applies them, in one
 * transaction after the result, before it reports ready. It can fail, report a failure it is retrying, drop and restore its
 * transport, and ask for a capability renewal, which the adapter answers by
 * renewing the same subscription.
 */
import { createCollection } from '@tanstack/db'
import { observedView } from '../src'
import type {
  ConformanceRow,
  ControlledProvider,
  EagerLiveSourceDriver,
  EagerLiveSourceFixture,
  ProviderChange,
} from '../src'

/** Wrong designs the calibration tests inject, one decision each. */
export type ReferenceMutant =
  /** READY-2: the sync run reports ready before its first delivery. */
  | `ready-before-delivery`
  /** READY-4: a failure before ready reports a different error value. */
  | `wraps-loading-failure`
  /** HEALTH-1: a failure after ready empties the rows. */
  | `failure-clears-rows`
  /** HEALTH-1: a retried failure is reported as a given-up one. */
  | `transient-is-fatal`
  /** HEALTH-2: a successful delivery does not clear a retried failure. */
  | `never-recovers`
  /** RETRY-1: a retried failure before ready fails the first load. */
  | `transient-fails-loading`
  /** PUB-1: one provider batch is committed as one transaction per change. */
  | `splits-batch`
  /** PUB-3: a live batch's deletes are not written. */
  | `drops-deletes`
  /** PUB-7: a later complete delivery merges into the rows. */
  | `snapshot-merges`
  /** LIFE-2: cleanup does not release the provider subscription. */
  | `leaks-subscription`
  /** LIFE-5: a new sync run starts from the previous run's rows. */
  | `restart-replays-rows`
  /** LIFE-10: a failed provider's subscription stays open until cleanup. */
  | `keeps-failed-source`
  /** LIFE-10: a failed provider's subscription is released twice. */
  | `double-release`
  /** HEALTH-5: a failure also leaves a detached rejection. */
  | `detached-rejection`
  /** HEALTH-5: a failure is also logged with console.error. */
  | `logs-failure`
  /** EVID-1: a wait for the next txid fulfills before that batch arrives. */
  | `wait-off-by-one`
  /** EVID-2: a retired run's evidence fulfills a wait before the run is ready. */
  | `retired-evidence-before-ready`
  /** EVID-2: a retired run's evidence never fulfills a later wait. */
  | `forgets-retired-evidence`
  /** EVID-2: a failure leaves pending waits pending until cleanup. */
  | `leaks-waits-after-fail`
  /** HEALTH-2, client values: a later outage reports the first outage's value. */
  | `stale-outage-value`
  /** RETRY-1, client values: each attempt replaces the reported failure. */
  | `replaces-outage-value`
  /** HEALTH-1, threshold: the outage shows one attempt early. */
  | `reports-outage-early`
  /** HEALTH-1, threshold: a delivery does not reset the attempt count. */
  | `outage-count-survives-delivery`
  /** RETRY-1, threshold: an empty response does not restart the count. */
  | `empty-response-keeps-count`
  /** HEALTH-2: an empty response clears a reported outage. */
  | `empty-response-recovers`
  /** EVID-3: a wait ignores its timeout. */
  | `wait-ignores-timeout`
  /** RECON-1: a transport drop is reported as a failure. */
  | `disconnect-fails`
  /** RENEW-1: renewal opens a second subscription instead of renewing. */
  | `renew-resubscribes`
  /** PUB-1, per-change commits: a batch of distinct keys commits in reverse. */
  | `reverses-batch`
  /** READY-10: batches committed during the initial fetch are dropped. */
  | `drops-buffered`
  /** PUB-9: buffered batches apply before the fetch result, which erases them. */
  | `buffer-before-rows`
  /** PUB-5: each buffered batch commits alone, so a replay can regress a row. */
  | `replays-per-batch`
  /** READY-10: status becomes `ready` before the buffered batches apply. */
  | `ready-before-buffer`
  /** READY-10, PUB-9: a batch during the initial fetch shows before ready. */
  | `shows-buffered`
  /** FID-1: an update merges over the held row, so a removed field stays. */
  | `merges-updates`
  /** FID-1: a live change stores a Date as its ISO string. */
  | `dates-as-strings`
  /** FID-1: the initial load stores a bigint as a number. */
  | `bigints-as-numbers`
  /** FID-1: a `null` value is stored as an absent field. */
  | `drops-nulls`
  /** FID-1: `-0` is stored as `0`. */
  | `loses-negative-zero`
  /** FID-1: a live change stores a typed boolean field as a number. */
  | `typed-booleans-as-numbers`
  /** PUB-4: a rejected delivery commits the rows written before the failure. */
  | `commits-malformed-prefix`
  /** PUB-4: a duplicate key is skipped and the delivery applies. */
  | `ignores-malformed`
  /**
   * PUB-2, checker calibration: the observed view relabels insert events as
   * updates. The adapter is unchanged; the comparison must see the events.
   */
  | `relabels-inserts`

type ProviderEvent =
  | { type: `snapshot`; rows: ReadonlyArray<ConformanceRow> }
  | { type: `changes`; changes: ReadonlyArray<ProviderChange>; txid: string }
  | { type: `failed`; error: Error }
  | { type: `transient`; error: Error }
  | { type: `transport`; connected: boolean }
  | { type: `empty` }

interface ProviderSubscription {
  releases: number
  renewed: number
  listener: (event: ProviderEvent) => void
}

/** The controlled provider: one live subscription per sync run. */
class ControlledPushProvider implements ControlledProvider {
  readonly subscriptions: Array<ProviderSubscription> = []
  private pendingRenewal: ((capability: string) => void) | undefined

  subscribe(
    listener: ProviderSubscription[`listener`],
    onRenewalDue: (renew: (capability: string) => void) => void,
  ): ProviderSubscription {
    const subscription: ProviderSubscription = {
      releases: 0,
      renewed: 0,
      listener,
    }
    this.subscriptions.push(subscription)
    // The capability is due for renewal as soon as the subscription opens;
    // the adapter's renewal stays pending until `completeRenewal`.
    onRenewalDue((capability) => {
      // The provider accepts any replacement for an open subscription.
      if (subscription.releases === 0 && capability.length > 0) {
        this.pendingRenewal = undefined
        subscription.renewed += 1
      }
    })
    return subscription
  }

  requestReplacement(): Promise<string> {
    return new Promise((resolve) => {
      this.pendingRenewal = resolve
    })
  }

  private latest(): ProviderSubscription {
    const subscription = this.subscriptions.at(-1)
    if (!subscription) throw new Error(`no provider subscription`)
    return subscription
  }

  releases = () =>
    this.subscriptions.map((subscription) => subscription.releases)
  deliverSnapshot = (rows: ReadonlyArray<ConformanceRow>) =>
    this.latest().listener({ type: `snapshot`, rows })
  deliverChanges = (changes: ReadonlyArray<ProviderChange>, txid: string) =>
    this.latest().listener({ type: `changes`, changes, txid })
  fail = (error: Error) => this.latest().listener({ type: `failed`, error })
  transientFailure = (error: Error) =>
    this.latest().listener({ type: `transient`, error })
  // The provider tells its subscription about transport loss and return, as
  // a real client's state events do.
  disconnect = () =>
    this.latest().listener({ type: `transport`, connected: false })
  reconnect = () =>
    this.latest().listener({ type: `transport`, connected: true })
  completeRenewal = async () => {
    const resolve = this.pendingRenewal
    if (!resolve) throw new Error(`the adapter did not request a renewal`)
    const before = this.latest().renewed
    resolve(`capability-${this.subscriptions.length}`)
    for (let turn = 0; turn < 10 && this.latest().renewed === before; turn++) {
      await new Promise((settle) => setTimeout(settle, 0))
    }
  }
  renewals = () => this.subscriptions.at(-1)?.renewed ?? 0
  emptyResponse = () => this.latest().listener({ type: `empty` })
}

type Waiter = { resolve: () => void; reject: (error: Error) => void }

/**
 * The row the adapter stores. A conforming adapter stores the delivered row
 * itself; each value mutant changes one kind on one path.
 */
function storedRow(
  row: ConformanceRow,
  path: `load` | `change`,
  mutant: ReferenceMutant | undefined,
): ConformanceRow {
  const { value } = row
  if (
    mutant === `dates-as-strings` &&
    path === `change` &&
    value instanceof Date
  ) {
    return { ...row, value: value.toISOString() }
  }
  if (
    mutant === `bigints-as-numbers` &&
    path === `load` &&
    typeof value === `bigint`
  ) {
    return { ...row, value: Number(value) }
  }
  if (mutant === `drops-nulls` && value === null) {
    const { value: _value, ...rest } = row
    return rest
  }
  if (mutant === `loses-negative-zero` && Object.is(value, -0)) {
    return { ...row, value: 0 }
  }
  if (
    mutant === `typed-booleans-as-numbers` &&
    path === `change` &&
    typeof row.typed?.boolean === `boolean`
  ) {
    return {
      ...row,
      typed: { ...row.typed, boolean: Number(row.typed.boolean) },
    }
  }
  return row
}

const changeKey = (change: ProviderChange) =>
  change.type === `upsert` ? change.row.id : change.id

/** How the reference adapter reports retried failures. */
interface OutagePolicy {
  /** The failed attempts in a row after ready from which an outage shows. */
  reportAfter: number
  /**
   * Reports its own error, with the provider's failure as `cause`, as a
   * client library's error would carry an HTTP failure.
   */
  clientValues: boolean
}

/** Builds the reference adapter's Collection over `provider`. */
function referenceCollection(
  provider: ControlledPushProvider,
  mutant: ReferenceMutant | undefined,
  perChange: boolean,
  policy: OutagePolicy,
) {
  // Evidence of the current sync run, and of retired runs, which counts
  // once the current run is ready (EVID-2).
  let applied = new Set<string>()
  const retired = new Set<string>()
  let waiters = new Map<string, Set<Waiter>>()
  let highestTxid = 0
  let runReady = false
  let runFailed = false
  // The first outage value, kept by the `stale-outage-value` mutant.
  let firstOutage: Error | undefined
  const wrap = (error: Error) =>
    policy.clientValues
      ? new Error(`reference failure`, { cause: error })
      : error
  const shown = (txid: string) =>
    applied.has(txid) ||
    (retired.has(txid) &&
      (runReady || mutant === `retired-evidence-before-ready`) &&
      mutant !== `forgets-retired-evidence`)
  // Only the `restart-replays-rows` mutant reads this across sync runs.
  let previousRows: ReadonlyArray<ConformanceRow> = []

  const settleWaits = (txid: string) => {
    applied.add(txid)
    highestTxid = Math.max(highestTxid, Number(txid))
    for (const waiter of waiters.get(txid) ?? []) waiter.resolve()
    waiters.delete(txid)
  }

  const collection = createCollection<ConformanceRow, number>({
    id: `reference-push`,
    getKey: (row) => row.id,
    syncMode: `eager`,
    sync: {
      // The provider delivers complete rows, so an update replaces the row.
      rowUpdateMode: mutant === `merges-updates` ? `partial` : `full`,
      sync: ({
        begin,
        write,
        commit,
        markReady,
        fail,
        reportError,
        reportHealthy,
      }) => {
        let ready = false
        let failing = false
        // Batches that arrived before the first complete result.
        const buffered: Array<{
          changes: ReadonlyArray<ProviderChange>
          txid: string
        }> = []
        let keys = new Set<number>()
        const opened: Array<ProviderSubscription> = []
        for (const txid of applied) retired.add(txid)
        applied = new Set()
        waiters = new Map()
        highestTxid = 0
        runReady = false
        runFailed = false
        // Failed attempts after ready since the last delivery, and the value
        // that reports the outage.
        let attempts = 0
        let outage: Error | undefined
        const becomeReady = () => {
          ready = true
          runReady = true
          markReady()
          for (const [txid, set] of waiters) {
            if (!shown(txid)) continue
            for (const waiter of set) waiter.resolve()
            waiters.delete(txid)
          }
        }

        const release = (subscription: ProviderSubscription) => {
          if (subscription.releases === 0 || mutant === `double-release`) {
            subscription.releases += 1
          }
        }
        if (mutant === `restart-replays-rows` && previousRows.length > 0) {
          begin()
          for (const row of previousRows) write({ type: `insert`, value: row })
          void commit()
          keys = new Set(previousRows.map((row) => row.id))
        }
        if (mutant === `ready-before-delivery`) becomeReady()

        const writeChange = (change: ProviderChange) => {
          if (change.type === `upsert`) {
            write({
              type: keys.has(change.row.id) ? `update` : `insert`,
              value: storedRow(change.row, `change`, mutant),
            })
            keys.add(change.row.id)
          } else if (mutant !== `drops-deletes` || !ready) {
            write({ type: `delete`, key: change.id })
            keys.delete(change.id)
          }
        }

        // READY-10: the buffered batches follow the result in one commit, so
        // a batch the result already reflects never shows on its own.
        const applyBuffered = (batches: typeof buffered) => {
          if (batches.length === 0) return
          const commits: Array<Array<(typeof buffered)[number]>> =
            mutant === `replays-per-batch`
              ? batches.map((batch) => [batch])
              : [batches]
          for (const group of commits) {
            begin()
            for (const batch of group) batch.changes.forEach(writeChange)
            const receipt = commit()
            for (const { txid } of group) {
              if (receipt === true) settleWaits(txid)
              else void receipt.then(() => settleWaits(txid))
            }
          }
        }

        // A successful delivery after a retried failure reports recovery.
        const delivered = () => {
          if (failing && mutant !== `never-recovers`) reportHealthy()
          failing = false
          if (mutant !== `outage-count-survives-delivery`) attempts = 0
          outage = undefined
        }

        const stop = (subscription: ProviderSubscription, error: Error) => {
          if (mutant === `detached-rejection`) void Promise.reject(error)
          if (mutant === `logs-failure`) console.error(`source failed`, error)
          if (mutant !== `keeps-failed-source`) release(subscription)
          // EVID-2: the failure retires the run, so its pending waits reject.
          runFailed = true
          if (mutant !== `leaks-waits-after-fail`) {
            for (const set of waiters.values()) {
              for (const waiter of set) waiter.reject(error)
            }
            waiters.clear()
          }
          fail(wrap(error))
        }

        const subscribe = (
          renewalDue: (renew: (capability: string) => void) => void,
        ) => {
          const subscription = provider.subscribe((event) => {
            if (event.type === `snapshot`) {
              const cut = ready ? [] : buffered.splice(0)
              if (mutant === `buffer-before-rows`) applyBuffered(cut)
              if (mutant === `snapshot-merges` && ready) {
                begin()
                for (const row of event.rows) {
                  writeChange({ type: `upsert`, row })
                }
                void commit()
              } else {
                // PUB-4: a delivery that cannot apply, such as one holding two
                // rows with one key, writes nothing and fails the sync run.
                begin({ snapshot: true })
                const written = new Set<number>()
                try {
                  for (const row of event.rows) {
                    if (mutant === `ignores-malformed` && written.has(row.id))
                      continue
                    write({
                      type: `insert`,
                      value: storedRow(row, `load`, mutant),
                    })
                    written.add(row.id)
                  }
                } catch (error) {
                  if (mutant === `commits-malformed-prefix`) void commit()
                  stop(subscription, error as Error)
                  return
                }
                void commit()
                keys = new Set(event.rows.map((row) => row.id))
              }
              if (mutant === `ready-before-buffer` && !ready) becomeReady()
              if (mutant !== `buffer-before-rows`) applyBuffered(cut)
              previousRows = event.rows
              if (!ready) becomeReady()
              delivered()
            } else if (event.type === `changes`) {
              if (!ready && mutant !== `shows-buffered`) {
                if (mutant !== `drops-buffered`) buffered.push(event)
                return
              }
              let receipt: true | Promise<void> = true
              if (mutant === `splits-batch` || perChange) {
                // The mutant reverses only batches of distinct keys, so the
                // final rows match and only the intermediate commits differ.
                const ordered =
                  mutant === `reverses-batch` &&
                  new Set(event.changes.map(changeKey)).size ===
                    event.changes.length
                    ? [...event.changes].reverse()
                    : event.changes
                for (const change of ordered) {
                  begin()
                  writeChange(change)
                  receipt = commit()
                }
              } else {
                begin()
                for (const change of event.changes) writeChange(change)
                receipt = commit()
              }
              if (receipt === true) settleWaits(event.txid)
              else void receipt.then(() => settleWaits(event.txid))
              delivered()
            } else if (event.type === `empty`) {
              // An accepted response ends the run of failed attempts.
              if (mutant !== `empty-response-keeps-count`) attempts = 0
              if (mutant === `empty-response-recovers`) delivered()
            } else if (event.type === `transport`) {
              if (mutant === `disconnect-fails` && !event.connected) {
                stop(subscription, new Error(`transport lost`))
              }
            } else if (event.type === `transient`) {
              if (!ready) {
                if (mutant === `transient-fails-loading`) {
                  stop(subscription, event.error)
                }
                return
              }
              if (mutant === `transient-is-fatal`) {
                stop(subscription, event.error)
                return
              }
              // An outage shows from its `reportAfter`th attempt in a row.
              attempts += 1
              const threshold =
                policy.reportAfter - (mutant === `reports-outage-early` ? 1 : 0)
              if (attempts < threshold) return
              failing = true
              if (!policy.clientValues) {
                reportError(event.error)
              } else {
                if (mutant === `replaces-outage-value` && outage) {
                  reportHealthy(outage)
                  outage = undefined
                }
                outage ??=
                  mutant === `stale-outage-value`
                    ? (firstOutage ??= wrap(event.error))
                    : wrap(event.error)
                reportError(outage)
              }
            } else if (!ready) {
              stop(
                subscription,
                mutant === `wraps-loading-failure`
                  ? new Error(`wrapped`, { cause: event.error })
                  : event.error,
              )
            } else {
              if (mutant === `failure-clears-rows`) {
                begin({ snapshot: true })
                void commit()
              }
              stop(subscription, event.error)
            }
          }, renewalDue)
          opened.push(subscription)
          return subscription
        }

        subscribe((renew) => {
          void provider.requestReplacement().then((capability) => {
            if (mutant === `renew-resubscribes`) subscribe(() => {})
            renew(capability)
          })
        })

        return () => {
          if (mutant !== `leaks-subscription`) {
            for (const subscription of opened) release(subscription)
          }
          const error = new Error(`reference collection was cleaned up`)
          for (const set of waiters.values()) {
            for (const waiter of set) waiter.reject(error)
          }
          waiters.clear()
        }
      },
    },
  })

  const awaitTxId = (txid: string, timeout?: number): Promise<boolean> => {
    if (shown(txid)) return Promise.resolve(true)
    // EVID-2: after a failure no evidence can arrive.
    if (runFailed && mutant !== `leaks-waits-after-fail`) {
      return Promise.reject(new Error(`reference source failed`))
    }
    if (mutant === `wait-off-by-one` && Number(txid) <= highestTxid + 1) {
      return Promise.resolve(true)
    }
    return new Promise<boolean>((resolve, reject) => {
      const set = waiters.get(txid) ?? new Set<Waiter>()
      const waiter: Waiter = { resolve: () => resolve(true), reject }
      set.add(waiter)
      waiters.set(txid, set)
      if (timeout !== undefined && mutant !== `wait-ignores-timeout`) {
        setTimeout(() => {
          if (!set.delete(waiter)) return
          reject(new Error(`timed out waiting for txid ${txid}`))
        }, timeout)
      }
    })
  }

  return { collection, awaitTxId }
}

/**
 * A production driver for the reference adapter, optionally mutated. With
 * `perChange`, the adapter commits each change of a batch on its own and
 * declares `per-change` commits, as TrailBase does. With `outage`, it
 * reports a retried outage from its `reportAfter`th attempt, with its own
 * error values when `clientValues` is set, as Electric does.
 */
export function referenceDriver(
  mutant?: ReferenceMutant,
  {
    perChange = false,
    outage = { reportAfter: 1, clientValues: false },
  }: { perChange?: boolean; outage?: OutagePolicy } = {},
): EagerLiveSourceDriver {
  const variant = outage.reportAfter > 1 || outage.clientValues
  return {
    adapter: `reference${perChange ? ` per-change` : ``}${variant ? ` outage ${outage.reportAfter}` : ``}${mutant ? ` (${mutant})` : ``}`,
    retryReportAfter: outage.reportAfter,
    // The adapter's error carries the provider's failure as `cause`.
    matchesFailure: outage.clientValues
      ? (reported, failure) =>
          reported instanceof Error &&
          reported.cause instanceof Error &&
          reported.cause.message.endsWith(` failure ${failure}`)
      : undefined,
    // A threshold has no law across a reconnect or a renewal, so a driver
    // with one declares neither.
    capabilities: new Set([
      `complete-snapshot`,
      `await-evidence`,
      `retry-policy`,
      ...(outage.reportAfter > 1
        ? []
        : ([`transport-reconnect`, `capability-renewal`] as const)),
      `listen-before-fetch`,
      `duplicate-key-delivery`,
      `source-failure-after-ready`,
      `empty-response`,
    ]),
    // The same ten kinds as typed fields, one per row field.
    fieldKinds: [
      `string`,
      `integer`,
      `float`,
      `negative-zero`,
      `boolean`,
      `null`,
      `date`,
      `bigint`,
      `array`,
      `object`,
    ],
    valueKinds: [
      `string`,
      `integer`,
      `float`,
      `negative-zero`,
      `boolean`,
      `null`,
      `date`,
      `bigint`,
      `array`,
      `object`,
    ],
    changeCommits: perChange ? `per-change` : `per-batch`,
    // A delivery holding two rows with one key fails the run (PUB-4).
    duplicateInsert: `error`,
    create(): EagerLiveSourceFixture {
      const provider = new ControlledPushProvider()
      const { collection, awaitTxId } = referenceCollection(
        provider,
        mutant,
        perChange,
        outage,
      )
      if (mutant !== `relabels-inserts`) {
        return { collection, provider, awaitTxId }
      }
      const relabeled = observedView(collection, {
        row: (row) => row,
        key: (key) => key as number,
      })
      const subscribeChanges: typeof relabeled.subscribeChanges = (
        callback,
        options,
      ) =>
        relabeled.subscribeChanges(
          (changes) =>
            callback(
              changes.map((change) =>
                change.type === `insert`
                  ? { ...change, type: `update` as const }
                  : change,
              ),
            ),
          options,
        )
      // The view's getters stay live on the derived object.
      const view = Object.create(relabeled) as typeof relabeled
      return {
        collection: Object.assign(view, { subscribeChanges }),
        provider,
        awaitTxId,
      }
    },
  }
}
