/**
 * Public receiving composition for on-demand-streams-oracle.ts. A receiver
 * supplies provider controls and its Collection configuration. This module
 * owns the same query/optimistic-transaction schedule for every receiver.
 * It records public health, query fulfillment/rejection and visible row IDs.
 * The sync wrapper only records real commit receipts; it supplies no rows,
 * readiness, resource ownership or expected errors.
 */
import {
  IR,
  createCollection,
  createLiveQueryCollection,
  createTransaction,
  eq,
  parseLoadSubsetOptions,
  whenSyncAccepted,
} from '@tanstack/db'
import {
  describeOracleCleanupError,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { streamRows } from './on-demand-streams-oracle'
import type { HealthReportCounts } from './health-report-handoff'
import type {
  StreamConnectionInput,
  StreamProblem,
} from './stream-health-oracle'
import type {
  CollectionConfig,
  LoadSubsetOptions,
  SyncAppliedReceipt,
  SyncConfig,
} from '@tanstack/db'
import type {
  AuthoredStream,
  OnDemandStreamsHistory,
  OnDemandStreamsState,
  QueryOutcome,
  StreamCut,
  StreamOwner,
  StreamRejection,
  StreamRow,
} from './on-demand-streams-oracle'

export type OnDemandStreamsSource = {
  options: Pick<
    CollectionConfig<StreamRow, string>,
    `id` | `getKey` | `sync` | `syncMode`
  >
  deliver: (
    rows: ReadonlyArray<StreamRow>,
    failed: ReadonlyArray<string>,
    version: number,
  ) => Promise<void>
  recover: (rows: ReadonlyArray<StreamRow>) => Promise<void>
  requestedOwners: () => ReadonlyArray<StreamOwner>
  deliveredErrors: () => number
  distinctErrorIdentities: () => number
  fulfilledProviderWaits: () => number
  describeProblem: (cause: unknown) => StreamProblem
  providerState: () => string
  connectionInputs: () => ReadonlyArray<StreamConnectionInput>
  activeStreams: () => ReadonlyArray<string>
  acquiredLeases: () => number
  admissionWork?: () => unknown
  receiveAdmissionWork?: () => Promise<void>
  forwardedSubscriptions: () => ReadonlyArray<AuthoredStream>
  emptyMappingCut: `provider-wait` | `load-admission`
  describeFailure: (cause: unknown) => StreamRejection
  receiveHealthReports?: () => Promise<HealthReportCounts>
  receiveRequestWork?: () => Promise<void>
  receiveAppliedWork?: () => Promise<void>
  dispose: () => Promise<void>
}
export type OnDemandStreamsAdapter = {
  open: (
    h: OnDemandStreamsHistory,
    id: string,
    controls: { onSubscriptions: (options: LoadSubsetOptions) => void },
  ) => OnDemandStreamsSource | Promise<OnDemandStreamsSource>
}
export type OnDemandStreamsResult = {
  cuts: Array<StreamCut>
  reached: Array<OnDemandStreamsState>
  cleanupErrors?: ReadonlyArray<string>
  healthHandoffs?: Array<HealthReportCounts & { checkpoint: string }>
  emptyMappingBoundary?: `provider-wait` | `load-admission`
}

// A two-second bound is a setup diagnostic, never a semantic mutant kill.
// Predicates below name actual provider callbacks, query outcomes, or receipts.
export async function untilOnDemandStream(
  predicate: () => boolean,
  premise: string,
  diagnostic?: () => unknown,
): Promise<void> {
  const end = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= end)
      throw new Error(
        `On-demand receiving premise not reached: ${premise}${diagnostic ? `; ${JSON.stringify(diagnostic())}` : ``}`,
      )
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

export async function observeOnDemandStreams(
  adapter: OnDemandStreamsAdapter,
  h: OnDemandStreamsHistory,
  id: string,
  failed: ReadonlyArray<string>,
): Promise<OnDemandStreamsResult> {
  let mappingCleanup = (_options: LoadSubsetOptions) => {}
  const provider = await adapter.open(h, id, {
    onSubscriptions: (options) => mappingCleanup(options),
  })
  const receipts: Array<{ receipt: SyncAppliedReceipt; settled: boolean }> = []
  const loadAdmissions: Array<LoadSubsetOptions> = []
  const actualSync = provider.options.sync
  const sync: SyncConfig<StreamRow, string> = {
    ...actualSync,
    sync: (params) => {
      const result = actualSync.sync({
        ...params,
        commit: (signal) => {
          const receipt = params.commit(signal)
          const recorded = { receipt, settled: receipt === true }
          receipts.push(recorded)
          if (receipt !== true)
            void receipt.then(
              () => {
                recorded.settled = true
              },
              () => {
                recorded.settled = true
              },
            )
          return receipt
        },
      })
      if (!result || typeof result !== `object` || !result.loadSubset)
        throw new Error(
          `On-demand receiving path requires a public loadSubset handler`,
        )
      const loadSubset = result.loadSubset.bind(result)
      return {
        ...result,
        loadSubset: (options) => {
          loadAdmissions.push(options)
          return loadSubset(options)
        },
      }
    },
  }
  const collection = createCollection({
    ...provider.options,
    sync,
    startSync: true,
  })
  let cleanupFromMapping: Promise<void> | undefined
  if (h.kind === `admission` && h.cleanup === `during-mapping`)
    mappingCleanup = () => {
      cleanupFromMapping = collection.cleanup({ dependents: true })
    }
  const queries: Partial<
    Record<
      StreamOwner,
      {
        cleanup: () => Promise<void>
        toArray: Array<StreamRow>
        status: string
      }
    >
  > = {}
  const outcomes: Partial<Record<StreamOwner, QueryOutcome>> = {}
  const rejections: Partial<Record<StreamOwner, StreamRejection>> = {}
  const pending: Partial<Record<StreamOwner, Promise<void>>> = {}
  let releaseMutation = () => {}
  let mutation: ReturnType<typeof createTransaction> | undefined
  const cuts: Array<StreamCut> = []
  const reached: Array<OnDemandStreamsState> = []
  const healthHandoffs: Array<HealthReportCounts & { checkpoint: string }> = []
  let request: StreamCut[`request`]
  let requestSubscription:
    ReturnType<typeof collection.subscribeChanges> | undefined
  // Unwrapped sources keep their original observation timeline. A persisted
  // receiver supplies this hook because child-query cleanup does not join the
  // source wrapper's asynchronous, ordered health-report queue. Its health
  // cut follows delivery of the calls already issued by the controlled event.
  // No later provider event is supplied before that comparison.
  const receive = provider.receiveHealthReports?.bind(provider)
  const receiveHealthReports =
    receive &&
    (async (checkpoint: string) => {
      healthHandoffs.push({ checkpoint, ...(await receive()) })
    })
  const record = (name: string) => {
    const problems =
      collection.health.failureReason?.errors.map((error) =>
        provider.describeProblem(error.cause),
      ) ?? []
    cuts.push({
      name,
      outcomes: { ...outcomes },
      problems,
      rows: Object.fromEntries(
        ([`left`, `right`] as const)
          .filter((owner) => queries[owner])
          .map((owner) => [
            owner,
            queries[owner]!.toArray.map((row) => row.id).sort(),
          ]),
      ),
      rowValues: Object.fromEntries(
        ([`left`, `right`] as const)
          .filter((owner) => queries[owner])
          .map((owner) => [
            owner,
            [...queries[owner]!.toArray]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((row) => row.value),
          ]),
      ),
      queryStatuses: Object.fromEntries(
        ([`left`, `right`] as const)
          .filter((owner) => queries[owner])
          .map((owner) => [owner, queries[owner]!.status]),
      ),
      ...(name === `source-cleaned-up`
        ? { providerState: provider.providerState() }
        : {}),
      connectionInputs: [...provider.connectionInputs()],
      sourceStatus: collection.status,
      sourceError: Boolean(collection.health.error),
      activeStreams: [...provider.activeStreams()],
      forwardedSubscriptions: [...provider.forwardedSubscriptions()],
      rejections: { ...rejections },
      ...(request
        ? {
            request: {
              ...request,
              subscriptionStatus: requestSubscription!.status,
            },
          }
        : {}),
    })
  }
  const start = (owner: StreamOwner) => {
    const query = createLiveQueryCollection((q) =>
      q
        .from({ row: collection })
        .where(({ row }) => eq(row[owner], h.coordinate)),
    )
    queries[owner] = query
    outcomes[owner] = `pending`
    pending[owner] = query.preload().then(
      () => {
        outcomes[owner] = `fulfilled`
      },
      (error: unknown) => {
        outcomes[owner] = `rejected`
        rejections[owner] = provider.describeFailure(error)
      },
    )
  }
  const finished = async (owner: StreamOwner) => {
    await untilOnDemandStream(
      () => outcomes[owner] !== `pending`,
      `${owner} initial query settles`,
    )
    await pending[owner]
  }
  let completed: OnDemandStreamsResult | undefined
  try {
    return await withOracleCleanup(async () => {
      if (
        h.kind === `settlement` &&
        h.timing === `before-application` &&
        h.baseline === `confirmed-empty`
      ) {
        // A distinct public demand confirms an empty source before the judged
        // acquisition starts. No private adapter flag or persisted coverage is
        // supplied. Keep both donor cuts in the shared model's observations.
        const mapped = provider.requestedOwners().length
        start(`right`)
        await untilOnDemandStream(
          () => provider.requestedOwners().slice(mapped).includes(`right`),
          `empty baseline donor requested its distinct streams`,
        )
        await provider.deliver([], [], -1)
        await finished(`right`)
        record(`empty-baseline-confirmed`)
        await queries.right!.cleanup()
        outcomes.right = `retired`
        await provider.receiveAppliedWork?.()
        record(`empty-baseline-retired`)
        // Resource ownership is a raw observation, never a wait predicate.
        // The shared comparison rejects a retained donor at this same cut.
        if (provider.activeStreams().length === 0)
          reached.push(`confirmed-empty-baseline`)
      }
      const requestedBeforeStart = provider.requestedOwners().length
      start(`left`)
      if (h.kind === `ownership`) start(`right`)
      // A real persisted receiver initializes storage before invoking its
      // source mapper. Drain that actual work separately from SDK waits,
      // which legitimately need the first provider checkpoint after mapping.
      await provider.receiveAdmissionWork?.()
      await untilOnDemandStream(
        () =>
          provider
            .requestedOwners()
            .slice(requestedBeforeStart)
            .includes(`left`) &&
          (h.kind !== `ownership` ||
            provider.requestedOwners().includes(`right`)),
        `every logical query requested its streams`,
        () => ({
          sourceStatus: collection.status,
          sourceError: collection.health.error?.message,
          queries: Object.fromEntries(
            Object.entries(queries).map(([owner, query]) => [
              owner,
              query.status,
            ]),
          ),
          requestedOwners: provider.requestedOwners(),
          admissions: loadAdmissions.map((options) => ({
            aborted: options.signal?.aborted === true,
          })),
          receivingWork: provider.admissionWork?.(),
        }),
      )
      // Mapper histories keep one ready donor while a second request exercises
      // cached-only settlement or failure/retry. These are public queries; no
      // loadSubset callback or expected result is injected by the driver.
      if (h.kind === `request`) {
        await provider.deliver(streamRows(h), [], 0)
        await finished(`left`)
        record(`loaded`)
        const controller = new AbortController()
        const acquisitionBaseline = provider.acquiredLeases()
        const mapperBaseline = provider
          .requestedOwners()
          .filter((owner) => owner === `right`).length
        let mapped!: () => void
        const mapperReturned = new Promise<void>((resolve) => {
          mapped = resolve
        })
        mappingCleanup = (options) => {
          if (
            !parseLoadSubsetOptions(options).filters.some(
              (filter) => filter.field[0] === `right`,
            )
          )
            return
          if (h.abort === `during-mapping`) controller.abort()
          // This microtask follows the complete synchronous mapper/SDK entry.
          // It does not wait for the request outcome that the law judges.
          queueMicrotask(() => {
            if (h.abort === `after-mapping`) controller.abort()
            mapped()
          })
        }
        requestSubscription = collection.subscribeChanges(() => {}, {
          includeInitialState: false,
        })
        outcomes.right = `not-started`
        request = {
          admitted: false,
          aborted: false,
          subscriptionStatus: requestSubscription.status,
          mapperCalls: 0,
          acquisitions: 0,
        }
        if (h.abort === `before-mapping`) controller.abort()
        request.admitted = requestSubscription.requestSnapshot({
          where: new IR.Func(`eq`, [
            new IR.PropRef([`right`]),
            new IR.Value(h.coordinate),
          ]),
          signal: controller.signal,
          onLoadSubsetResult: (result) => {
            outcomes.right = result === true ? `fulfilled` : `pending`
            if (result !== true)
              void result.then(
                () => {
                  outcomes.right = `fulfilled`
                },
                (error: unknown) => {
                  outcomes.right = `rejected`
                  request!.rejection = describeOracleCleanupError(error)
                },
              )
          },
        })
        if (h.abort !== `before-mapping`) await mapperReturned
        // The premise is completed mapper entry, not load settlement. Pending
        // cancellation remains a raw observation, including with a leaked SDK
        // lease, so the original defect reaches the semantic comparison.
        await Promise.resolve()
        await Promise.resolve()
        request.aborted = controller.signal.aborted
        request.mapperCalls =
          provider.requestedOwners().filter((owner) => owner === `right`)
            .length - mapperBaseline
        request.acquisitions = provider.acquiredLeases() - acquisitionBaseline
        reached.push(
          h.abort === `before-mapping`
            ? `request-pre-aborted`
            : h.abort === `during-mapping`
              ? `request-mapper-aborted`
              : h.abort === `after-mapping`
                ? `request-post-mapper-aborted`
                : `request-healthy`,
        )
        record(`request-mapped`)
        await provider.deliver(
          streamRows(h).map((row) => ({ ...row, value: row.value + 100 })),
          [],
          1,
        )
        await Promise.all(receipts.map((entry) => entry.receipt))
        await provider.receiveRequestWork?.()
        await Promise.resolve()
        await Promise.resolve()
        record(`request-checkpoint`)
      } else if (h.kind === `mapper`) {
        await provider.deliver(streamRows(h), [], 0)
        await finished(`left`)
        record(`loaded`)
        if (h.operation === `priority`) {
          // Reach witnesses dispatch for an input with an authored priority;
          // the shared comparison alone judges the actual forwarded value.
          if (provider.forwardedSubscriptions().length > 0)
            reached.push(`priority-requested`)
        } else if (h.operation === `empty`) {
          const gate = new Promise<void>((resolve) => {
            releaseMutation = resolve
          })
          mutation = createTransaction({ mutationFn: () => gate })
          mutation.mutate(() =>
            collection.insert({
              id: `optimistic`,
              left: h.coordinate,
              right: h.coordinate,
              value: h.value,
            }),
          )
          const previousReceipts = receipts.length
          await provider.deliver(
            streamRows(h).map((row) => ({ ...row, value: row.value + 100 })),
            [],
            1,
          )
          await Promise.all(
            receipts
              .slice(previousReceipts)
              .map((entry) => whenSyncAccepted(entry.receipt)),
          )
          if (!receipts.slice(previousReceipts).some((entry) => !entry.settled))
            throw new Error(
              `Empty-mapper receiving premise needs a held donor receipt`,
            )
          const waits = provider.fulfilledProviderWaits()
          start(`right`)
          // Persistence may hold subset restore behind the donor's receipt,
          // before it forwards to the upstream mapper. Its public admitted load
          // must remain pending there. The unwrapped source instead reaches
          // the actual empty mapper and fulfilled SDK wait while still held.
          await untilOnDemandStream(
            () =>
              provider.emptyMappingCut === `load-admission`
                ? loadAdmissions.some((options) =>
                    parseLoadSubsetOptions(options).filters.some(
                      (filter) => filter.field[0] === `right`,
                    ),
                  )
                : provider.requestedOwners().includes(`right`) &&
                  provider.fulfilledProviderWaits() > waits,
            `empty demand reached its ${provider.emptyMappingCut} boundary behind donor receipt`,
          )
          record(`empty-receipt-held`)
          releaseMutation()
          await mutation.when(`settled`)
          // The same authored provider checkpoint can need another transport
          // delivery after application replays an active demand. Resume only
          // that input; the receiver does not wait for the expected verdict.
          await provider.receiveAppliedWork?.()
          await finished(`right`)
          await untilOnDemandStream(
            () =>
              provider.requestedOwners().includes(`right`) &&
              provider.fulfilledProviderWaits() > waits,
            `empty mapper and real SDK wait completed after donor application`,
          )
          record(`empty-cached`)
          await queries.left!.cleanup()
          outcomes.left = `retired`
          if (receiveHealthReports) await receiveHealthReports(`donor-retired`)
          record(`donor-retired`)
          reached.push(`empty-mapping-applied`)
        } else {
          start(`right`)
          await finished(`right`)
          record(`mapper-rejected`)
          await queries.right!.cleanup()
          start(`right`)
          await untilOnDemandStream(
            () =>
              provider.requestedOwners().filter((owner) => owner === `right`)
                .length >= 2,
            `mapper retry starts a fresh request`,
          )
          await provider.deliver(streamRows(h), [], 1)
          await finished(`right`)
          record(`mapper-retried`)
          await queries.right!.cleanup()
          outcomes.right = `retired`
          if (receiveHealthReports) await receiveHealthReports(`retry-retired`)
          record(`retry-retired`)
          reached.push(`throwing-mapper-retried`)
        }
      }
      // Start the local mutation after persisted restore has admitted the
      // provider demand, but before any provider rows arrive. Holding startup's
      // empty hydration instead would prevent the intended source path.
      if (h.kind === `settlement` && h.timing === `before-application`) {
        const gate = new Promise<void>((resolve) => {
          releaseMutation = resolve
        })
        mutation = createTransaction({ mutationFn: () => gate })
        mutation.mutate(() =>
          collection.insert({
            id: `optimistic`,
            left: h.coordinate,
            right: h.coordinate,
            value: h.value,
          }),
        )
      }
      if (h.kind === `mapper` || h.kind === `request`) {
        // Mapper-specific public cuts were recorded above.
      } else if (h.kind === `admission`) {
        if (h.cleanup === `after-application`) {
          await provider.deliver(streamRows(h), [], 0)
          await finished(`left`)
          await collection.cleanup({ dependents: true })
        } else {
          if (!cleanupFromMapping)
            throw new Error(
              `Subscription mapping did not invoke public cleanup`,
            )
          await cleanupFromMapping
          await finished(`left`)
        }
        reached.push(
          h.cleanup === `during-mapping` ? `mapping-cleanup` : `loaded-cleanup`,
        )
        record(`source-cleaned-up`)
      } else if (h.kind === `settlement` && h.timing === `before-sync`) {
        const errors = provider.deliveredErrors()
        await provider.deliver([], failed, 1)
        await finished(`left`)
        if (receiveHealthReports)
          await receiveHealthReports(`failed-initial-load`)
        if (provider.deliveredErrors() > errors)
          reached.push(`stream-error-before-sync`)
        record(`failed-initial-load`)
      } else {
        const waits = provider.fulfilledProviderWaits()
        await provider.deliver(streamRows(h), [], 0)
        await Promise.all(
          receipts.map((entry) => whenSyncAccepted(entry.receipt)),
        )
        if (h.kind === `settlement` && h.timing === `before-application`) {
          await untilOnDemandStream(
            () =>
              provider.fulfilledProviderWaits() > waits &&
              receipts.some((entry) => !entry.settled),
            `provider synchronization fulfilled while a committed receipt is held`,
          )
          record(`receipt-held`)
          const errors = provider.deliveredErrors()
          await provider.deliver([], failed, 1)
          if (
            provider.deliveredErrors() > errors &&
            receipts.some((entry) => !entry.settled)
          )
            reached.push(`stream-error-before-application`)
          releaseMutation()
          await mutation!.when(`settled`)
          await provider.receiveAppliedWork?.()
          await finished(`left`)
          if (receiveHealthReports)
            await receiveHealthReports(`failed-visible-load`)
          record(`failed-visible-load`)
        } else {
          await finished(`left`)
          if (h.kind === `ownership`) {
            await finished(`right`)
            record(`loaded`)
          }
          const errors = provider.deliveredErrors()
          await provider.deliver([], failed, 1)
          if (receiveHealthReports)
            await receiveHealthReports(
              h.kind === `settlement` ? `failed-visible-load` : `failed`,
            )
          if (h.kind === `settlement`) {
            if (provider.deliveredErrors() > errors)
              reached.push(`stream-error-after-application`)
            record(`failed-visible-load`)
          } else {
            record(`failed`)
            if (h.changeError) {
              const previous = provider.distinctErrorIdentities()
              await provider.deliver([], failed, 2)
              if (receiveHealthReports)
                await receiveHealthReports(`changed-error`)
              if (provider.distinctErrorIdentities() > previous)
                reached.push(`error-identity-changed`)
              record(`changed-error`)
            }
            await queries[h.retire]!.cleanup()
            if (receiveHealthReports)
              await receiveHealthReports(`owner-retired`)
            outcomes[h.retire] = `retired`
            const remaining = h.retire === `left` ? `right` : `left`
            if (
              provider.deliveredErrors() > errors &&
              outcomes[remaining] === `fulfilled`
            )
              reached.push(
                h.overlap === `same`
                  ? `shared-error-retained`
                  : h.overlap === `partial`
                    ? `partial-overlap-retired`
                    : `independent-error-retired`,
              )
            if (
              provider.deliveredErrors() > errors &&
              outcomes[remaining] === `fulfilled` &&
              h.parameterization
            )
              reached.push(
                h.parameterization === `equal`
                  ? `parameter-equal-retained`
                  : `parameter-distinct-retired`,
              )
            record(`owner-retired`)
            if (h.recover) {
              await provider.recover(streamRows(h))
              if (receiveHealthReports) await receiveHealthReports(`recovered`)
              reached.push(`stream-recovered`)
              record(`recovered`)
            }
          }
        }
      }
      completed = {
        cuts,
        reached,
        ...(healthHandoffs.length ? { healthHandoffs } : {}),
        ...(h.kind === `mapper` && h.operation === `empty`
          ? { emptyMappingBoundary: provider.emptyMappingCut }
          : {}),
      }
      if (h.kind !== `admission`) {
        requestSubscription?.unsubscribe()
        await queries.left?.cleanup()
        await queries.right?.cleanup()
        // The source is still active here. Receive its release reports before
        // cleanup may lawfully invalidate them; the resource cut stays after
        // the same public Collection cleanup promise as before.
        if (receiveHealthReports)
          await receiveHealthReports(`before-source-cleanup`)
        await collection.cleanup()
        record(`source-cleaned-up`)
      }
      return completed
    }, [
      () => releaseMutation(),
      () => requestSubscription?.unsubscribe(),
      () => queries.left?.cleanup(),
      () => queries.right?.cleanup(),
      () => collection.cleanup(),
      () => provider.dispose(),
    ])
  } catch (error) {
    // Semantic comparison runs in the shared registration, after recording.
    // Keep its completed cuts if teardown fails, so that comparison remains
    // primary and each teardown diagnostic survives the browser boundary.
    // A setup/body failure still uses withOracleCleanup's original exception.
    if (!completed) throw error
    return {
      ...completed,
      cleanupErrors: [
        ...(completed.cleanupErrors ?? []),
        describeOracleCleanupError(error),
      ],
    }
  }
}
