/**
 * Shared production driver for an authored decoder. The receiver controls only
 * source delivery and identifies its public identity-refusal error. Collection
 * creation, query loading, parse calls, publications and cleanup run production.
 * This module has no test-runner import and is reused in actual browsers.
 */
import { createCollection, createLiveQueryCollection } from '@tanstack/db'
import {
  describeOracleCleanupError,
  retainOracleCleanupObservation,
  withOracleCleanup,
} from '../../db/tests/oracle-cleanup'
import { decodeId, observeDecodeRows } from './decode-refusal-oracle'
import type { CollectionConfig } from '@tanstack/db'
import type {
  DecodeBoundary,
  DecodeHistory,
  DecodeObservation,
  DecodedRow,
} from './decode-refusal-oracle'

export type DecodeSource = {
  options: Pick<
    CollectionConfig<DecodedRow, string>,
    `id` | `getKey` | `sync` | `syncMode`
  >
  deliver: (initial: boolean, refusal: boolean) => Promise<void>
  propagate: () => Promise<void>
  parsed: Array<string>
  causesThrown?: Array<string>
  cachedInput?: ReadonlyArray<string>
  cachedStartup?: { clientState: string; providerOpen: boolean }
  boundaryEvents?: Array<DecodeBoundary>
  /** Resource kinds this receiving path must actually allocate. */
  requiredResourceKinds: ReadonlyArray<string>
  resources: DecodeObservation['resources']
  subsetRequests: () => number
  providerActive: () => boolean
  normalizeError: (message: string) => string
}
export type DecodeAdapter = {
  open: (h: DecodeHistory, id: string) => Promise<DecodeSource> | DecodeSource
}

export function rejectionDiagnostic(
  error: unknown,
  collectionId: string,
): {
  name: string
  message: string
} {
  // Both instanceof and primitive conversion can throw for legal JS values.
  // Diagnostics stay secondary to the already recorded rejection/presence.
  try {
    if (error instanceof Error) {
      const name: unknown = error.name
      const message: unknown = error.message
      if (typeof name === `string` && typeof message === `string`)
        return {
          name,
          message: message.replaceAll(collectionId, `<receiving-collection>`),
        }
    }
  } catch {}
  return {
    name: typeof error,
    message: describeOracleCleanupError(error).replaceAll(
      collectionId,
      `<receiving-collection>`,
    ),
  }
}

export async function observeDecodeRefusal(
  adapter: DecodeAdapter,
  h: DecodeHistory,
  id: string,
): Promise<DecodeObservation> {
  const source = await adapter.open(h, id)
  const boundaryEvents = source.boundaryEvents ?? []
  // Replays use fresh identifiers. Remove only that harness identity from
  // diagnostics while keeping the public error category and content.
  const message = (value: string) =>
    source.normalizeError(value).replaceAll(id, `<receiving-collection>`)
  const cleanups: Array<() => unknown> = [() => source.propagate()]
  return retainOracleCleanupObservation<DecodeObservation>(async () => {
    const collection = createCollection(source.options)
    cleanups.unshift(() => collection.cleanup())
    const startupBefore = observeDecodeRows([...collection.base.values()])
    const admissionErrors: DecodeObservation['admissionErrors'] = []
    const publications: DecodeObservation['publications'] = []
    const readySnapshots: DecodeObservation['readySnapshots'] = []
    const offReady = collection.on(`status:change`, ({ status }) => {
      if (status === `ready`) {
        boundaryEvents.push(`source ready`)
        readySnapshots.push(observeDecodeRows(collection.toArray))
      }
    })
    cleanups.unshift(() => offReady())
    let recording = h.startup === `cached`
    let subscription: ReturnType<typeof collection.subscribeChanges> | undefined
    try {
      subscription = collection.subscribeChanges(() => {
        if (recording) publications.push(observeDecodeRows(collection.toArray))
      })
    } catch (error) {
      admissionErrors.push({
        entry: `source subscription`,
        ...rejectionDiagnostic(error, id),
      })
    }
    cleanups.unshift(() => subscription?.unsubscribe())
    let load = `pending`
    const ready = Promise.resolve()
      .then(() => collection.preload())
      .then(
        () => {
          load = `fulfilled`
        },
        () => {
          load = `rejected`
        },
      )

    // Initial-query readiness is distinct from source readiness. An on-demand
    // cold source starts ready with no requested rows. Cached initial input can
    // instead fail before source readiness. The query still has its own gate.
    if (h.mode === `on-demand` && h.retireDemand) {
      // A real pending query retires before source input. This public ownership
      // history is independent of the adapter's optional cache replacement.
      const previousRequests = source.subsetRequests()
      const retired = createLiveQueryCollection((q) =>
        q.from({ row: collection }).select(({ row }) => row),
      )
      const temporaryCleanups: Array<() => unknown> = [() => retired.cleanup()]
      await withOracleCleanup(async () => {
        const retiredSubscription = retired.subscribeChanges(() => {})
        temporaryCleanups.unshift(() => retiredSubscription.unsubscribe())
        const cancellation = retired.preload().then(
          () => {},
          () => {},
        )
        temporaryCleanups.push(() => cancellation)
        const deadline = Date.now() + 5000
        while (source.subsetRequests() === previousRequests) {
          if (Date.now() > deadline)
            throw new Error(`Temporary decoder query never admitted a request`)
          await source.propagate()
        }
      }, temporaryCleanups)
      await source.propagate()
    }
    const query =
      h.mode === `on-demand`
        ? createLiveQueryCollection((q) =>
            q.from({ row: collection }).select(({ row }) => row),
          )
        : undefined
    cleanups.unshift(() => query?.cleanup())
    const queryStartupBefore = query
      ? observeDecodeRows([...query.base.values()])
      : []
    const queryReadySnapshots: DecodeObservation['readySnapshots'] = []
    const queryPublications: DecodeObservation['publications'] = []
    const offQueryReady = query?.on(`status:change`, ({ status }) => {
      if (status === `ready`)
        queryReadySnapshots.push(observeDecodeRows(query.toArray))
    })
    let querySubscription:
      ReturnType<NonNullable<typeof query>['subscribeChanges']> | undefined
    try {
      querySubscription = query?.subscribeChanges(() => {
        if (recording) queryPublications.push(observeDecodeRows(query.toArray))
      })
    } catch (error) {
      admissionErrors.push({
        entry: `query subscription`,
        ...rejectionDiagnostic(error, id),
      })
    }
    cleanups.unshift(
      () => querySubscription?.unsubscribe(),
      () => offQueryReady?.(),
    )
    let queryLoad = `pending`
    let queryRejection: { name: string; message: string } | null = null
    const queryReady =
      query &&
      Promise.resolve()
        .then(() => query.preload())
        .then(
          () => {
            queryLoad = `fulfilled`
          },
          (error: unknown) => {
            queryLoad = `rejected`
            queryRejection = rejectionDiagnostic(error, id)
          },
        )
    await source.propagate()
    const atDemand = query
      ? {
          sourceStatus: collection.status,
          sourceLoad: load,
          sourceRows: observeDecodeRows(collection.toArray),
          queryStatus: query.status,
          queryLoad,
          queryRows: observeDecodeRows(query.toArray),
        }
      : undefined
    if (h.phase === `live`) {
      await source.deliver(true, false)
      await ready
      await queryReady
      await source.propagate()
    }
    const before =
      h.startup === `cached`
        ? startupBefore
        : observeDecodeRows(collection.toArray)
    const queryBefore =
      h.startup === `cached`
        ? queryStartupBefore
        : query
          ? observeDecodeRows(query.toArray)
          : []
    recording = true
    const parsedStart = h.startup === `cached` ? 0 : source.parsed.length
    // Cached on-demand refusal occurred synchronously during source startup,
    // before handlers/HTTP may exist. Record that public path directly. Eager
    // startup still waits for its stream checkpoint before accepting SDK rows.
    if (!(
      h.startup === `cached` &&
      h.mode === `on-demand` &&
      h.outcome !== `valid`
    ))
      await source.deliver(h.phase === `initial`, h.outcome !== `valid`)
    await source.propagate()
    // The provider drain and finite SDK promise continuations are premises.
    // A lost rejection remains pending in the observation; do not await it and
    // replace a semantic query-settlement failure with a setup timeout.
    const parsed = source.parsed.slice(parsedStart)
    const refusedId = decodeId(h, h.refusalIndex, h.phase === `initial`)
    const mode = source.options.syncMode ?? `eager`
    const reached: Array<string> = []
    if (
      parsed.length &&
      h.startup === `cached` &&
      source.cachedInput?.includes(refusedId) &&
      (h.outcome !== `throw` ||
        source.causesThrown?.includes(h.throwCause ?? `error`))
    )
      reached.push(
        `${mode}:cached-initial-${h.outcome === `throw` ? `throw-${h.throwCause ?? `error`}` : h.outcome}`,
      )
    if (
      h.startup !== `cached` &&
      h.outcome === `throw` &&
      h.throwCause &&
      h.throwCause !== `error` &&
      source.causesThrown?.includes(h.throwCause)
    )
      reached.push(`${mode}:cold-${h.phase}-throw-${h.throwCause}`)
    if (
      h.retireDemand &&
      source.resources.some(
        (resource) => resource.coreReleased && resource.releases === 1,
      ) &&
      source.resources.some(
        (resource) =>
          resource.kind === `stream-lease` &&
          !resource.coreReleased &&
          resource.releases === 0,
      ) &&
      queryLoad === `fulfilled`
    )
      reached.push(`on-demand:retired-demand-with-active-successor`)
    if (parsed.length) reached.push(`${mode}:${h.phase}-${h.outcome}`)
    if (h.outcome !== `valid` && parsed.includes(refusedId)) {
      if (h.refusalIndex === 0)
        reached.push(
          `${mode}:refusal-first`,
          `${mode}:${h.phase}-${h.outcome}-first`,
        )
      if (h.refusalIndex > 0 && h.refusalIndex < h.count - 1)
        reached.push(
          `${mode}:refusal-middle`,
          `${mode}:${h.phase}-${h.outcome}-middle`,
        )
      if (h.refusalIndex === h.count - 1)
        reached.push(
          `${mode}:refusal-last`,
          `${mode}:${h.phase}-${h.outcome}-last`,
        )
    }
    if (h.phase === `live` && parsed.length)
      reached.push(h.overlap ? `${mode}:live-overlap` : `${mode}:live-fresh`)
    if (
      mode === `on-demand` &&
      source.subsetRequests() &&
      atDemand?.sourceStatus === `ready` &&
      atDemand.queryLoad === `pending`
    )
      reached.push(`on-demand:source-ready-query-pending`)
    const querySource = query?.health.sources.find(
      (node) => node.alias === `row`,
    )
    return {
      mode,
      subsetRequests: source.subsetRequests(),
      atDemand,
      ...(query
        ? {
            query: {
              before: queryBefore,
              rows: observeDecodeRows(query.toArray),
              readySnapshots: queryReadySnapshots,
              publications: queryPublications,
              status: query.status,
              load: queryLoad,
              rejection: queryRejection,
              sourceStatus: querySource?.status,
              sourceErrorPresent: querySource?.error != null,
              sourceError: querySource?.error?.message
                ? message(querySource.error.message)
                : null,
            },
          }
        : {}),
      before,
      rows: observeDecodeRows(collection.toArray),
      readySnapshots,
      publications,
      status: collection.status,
      load,
      error: collection.health.error?.message
        ? message(collection.health.error.message)
        : null,
      errorPresent: collection.health.error != null,
      admissionErrors,
      boundaryEvents: [...boundaryEvents],
      failureReason: collection.health.failureReason?.message ?? null,
      requiredResourceKinds: source.requiredResourceKinds,
      resources: source.resources.map((resource) => ({ ...resource })),
      providerActive: source.providerActive(),
      parsed,
      causesThrown: source.causesThrown ?? [],
      cachedInput: [...(source.cachedInput ?? [])],
      cachedStartup: source.cachedStartup ?? null,
      reached,
    }
  }, cleanups)
}
