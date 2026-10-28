/**
 * Each reader's first successful hydration view must reproduce that reader's
 * server-rendered view. The SSR guide's per-reader promise supplies this law;
 * transport order and source readiness do not authorize browser substitution.
 * A reader that never rendered successfully on the server, such as a rejected
 * Suspense reader, supplies no successful view to this comparison. Its host
 * driver separately observes the fallback or error boundary.
 *
 * This is a metamorphic judgment over public hook observations. Neither side
 * comes from DbClient records, transport payloads, or a second query evaluator.
 * Drivers must record the first server view and the first successful browser
 * hydration view independently. A missing browser observation is a mismatch.
 * Later live publications are outside this first-view checkpoint.
 */
export type SsrStreamReaderView = {
  status: string
  names: ReadonlyArray<string>
}

export type SsrStreamReaderComparison = {
  reader: string
  server: SsrStreamReaderView
  hydration: SsrStreamReaderView | undefined
}

/** Shared legal inputs for the stream-cut drivers; hosts add scheduling cuts. */
export type SsrStreamHistory = {
  count: number
  writes: number
  ordinaryFirst?: boolean
  ordinaryLast?: boolean
  browserWrite?: boolean
  splitHydration?: boolean
  holdSourceReadiness?: boolean
  sourceError?: boolean
}

export function ssrStreamHydrationMismatches(
  readers: ReadonlyArray<SsrStreamReaderComparison>,
): Array<SsrStreamReaderComparison> {
  return readers.filter(
    ({ server, hydration }) =>
      hydration === undefined ||
      server.status !== hydration.status ||
      server.names.length !== hydration.names.length ||
      server.names.some((name, index) => name !== hydration.names[index]),
  )
}

/**
 * Waiting is owed to a server record, not to a local preload with the same
 * portable hash. Closing transport cannot manufacture that record. Conversely,
 * an already received pending record owns its result promise independently of
 * the stream carrying records. Transport failure rejects with its actual cause,
 * including undefined. These are lifetime cuts of the same missing-view law;
 * the actual Router receiver supplies the public host witness.
 */
export type SsrStreamRecordHistory = {
  record: `missing` | `pending` | `local`
  terminal: `arrival` | `close` | `error` | `cleanup`
  attemptAfterTerminal: boolean
  peerFirst: boolean
  definedCause: boolean
  restartAfterCleanup: boolean
}

export function expectedSsrStreamRecordOutcome(
  history: SsrStreamRecordHistory,
): `snapshot` | `pending` | `missing-error` | `transport-error` {
  if (history.terminal === `arrival`) return `snapshot`
  if (history.record === `pending` && history.terminal === `close`)
    return `pending`
  return history.terminal === `error` ? `transport-error` : `missing-error`
}
