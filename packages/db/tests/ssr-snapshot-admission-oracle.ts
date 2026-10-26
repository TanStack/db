import { fc } from '@fast-check/vitest'

/**
 * SSR may expose only a snapshot the first browser render can reproduce.
 * The maintainer chose a programming-error rejection for incidental server-only
 * rows or readiness. An ordinary cold/loading render remains legal. The SSR
 * guide's normalized rows alone are provisional. A prepared source that has
 * completed this query may render ready only if transport captures that exact
 * query view, including readiness; otherwise non-streaming Suspense cannot finish.
 * This is a consequence of prepared SSR and hydration equality, not an inference
 * that normalized source rows prove browser Collection readiness.
 *
 * This judgment uses declared preparation and authored rows, never production
 * registration or readiness classifiers. `sourceState` combines adapter startup
 * and readiness only for this eager synchronous grammar. `preparation` describes
 * caller actions, not inferred implementation state. The host drivers below
 * supply the real hook and compare return/throw, rendered rows and status before
 * browser commit. Runtime failures, persistence, source identity metadata, custom
 * filters discarding required transport, and asynchronous providers are outside
 * this grammar. Source loading and an unawaited query preload are valid histories.
 */
export type SsrSnapshotHistory = {
  preparation: `none` | `source` | `query` | `pending-query`
  sourceState: `idle` | `loading` | `ready`
  rows: Array<{ id: string; name: string }>
  serverWrite?: boolean
  browserWrite?: boolean
  browserPreload?: boolean
}

export const ssrSnapshotHistoryArbitrary = fc
  .record({
    preparation: fc.constantFrom<SsrSnapshotHistory[`preparation`]>(
      `none`,
      `source`,
      `query`,
      `pending-query`,
    ),
    sourceState: fc.constantFrom<SsrSnapshotHistory[`sourceState`]>(
      `idle`,
      `loading`,
      `ready`,
    ),
    count: fc.integer({ min: 0, max: 3 }),
    serverWrite: fc.boolean(),
    browserWrite: fc.boolean(),
    browserPreload: fc.boolean(),
  })
  .filter(({ preparation, sourceState, count }) =>
    sourceState === `idle`
      ? count === 0 && (preparation === `none` || preparation === `source`)
      : preparation === `query`
        ? sourceState === `ready`
        : preparation !== `pending-query` || sourceState === `loading`,
  )
  .map(
    ({
      preparation,
      sourceState,
      count,
      serverWrite,
      browserWrite,
      browserPreload,
    }): SsrSnapshotHistory => ({
      preparation,
      sourceState,
      serverWrite,
      browserWrite,
      browserPreload,
      rows: Array.from({ length: count }, (_, index) => ({
        id: String(index + 1),
        name: `server ${index + 1}`,
      })),
    }),
  )

export function expectedSsrSnapshot(history: SsrSnapshotHistory) {
  const prepared =
    history.preparation === `query` || history.preparation === `source`
  return {
    rejects:
      !prepared && (history.sourceState === `ready` || history.rows.length > 0),
    rows: history.rows,
    status:
      history.preparation === `query` ||
      (history.preparation === `source` && history.sourceState === `ready`)
        ? `ready`
        : `loading`,
  } as const
}

// Named replays reconstruct the admission boundary before random shrinking can
// stop a campaign at its first mismatch. They use the same driver and judgment.
export const ssrSnapshotExamples: Array<SsrSnapshotHistory> = [
  { preparation: `none`, sourceState: `idle`, rows: [] },
  { preparation: `none`, sourceState: `ready`, rows: [] },
  {
    preparation: `none`,
    sourceState: `ready`,
    rows: [{ id: `1`, name: `server 1` }],
  },
  {
    preparation: `query`,
    sourceState: `ready`,
    rows: [{ id: `1`, name: `server 1` }],
  },
  {
    preparation: `source`,
    sourceState: `ready`,
    rows: [{ id: `1`, name: `server 1` }],
  },
  {
    preparation: `source`,
    sourceState: `loading`,
    rows: [{ id: `1`, name: `server 1` }],
  },
  {
    preparation: `pending-query`,
    sourceState: `loading`,
    rows: [{ id: `1`, name: `server 1` }],
  },
]

// Adjacent timing witnesses keep preparation fixed while moving publication
// across the render/transport and transport/browser observation cuts.
ssrSnapshotExamples.push(
  {
    preparation: `source`,
    sourceState: `loading`,
    rows: [{ id: `1`, name: `server 1` }],
    serverWrite: true,
  },
  { preparation: `none`, sourceState: `idle`, rows: [], browserWrite: true },
  {
    preparation: `source`,
    sourceState: `ready`,
    rows: [],
    serverWrite: true,
    browserWrite: true,
  },
)

ssrSnapshotExamples.push({
  preparation: `source`,
  sourceState: `loading`,
  rows: [{ id: `1`, name: `server 1` }],
  browserWrite: true,
  browserPreload: true,
})

/**
 * Runtime failure does not waive the first-browser view law. The SSR guide's
 * preparation section preserves ordinary runtime errors, and requires the
 * first browser view to reproduce the server's rendered rows and status.
 * Once hydration commits, the browser's own source outcome is observable.
 * Keeping those cuts distinct must neither turn provider failure into an SSR
 * programming error nor retain the server's error after healthy browser sync.
 *
 * This extension uses empty eager sources so it judges lifecycle flags without
 * inventing a row-retention policy after failure. An outcome is an authored sync
 * callback signal, not an abstraction of the Collection's full lifecycle: ready
 * calls markReady; error returns after markError. Preloading handles a rejection
 * as a normal runtime failure. A throwing callback and error-detail transport
 * require separate judgments and are outside this grammar.
 */
export type SsrRuntimeErrorHistory = {
  serverOutcome: `ready` | `error`
  browserOutcome: `ready` | `error`
  browserPreload: boolean
  definedError: boolean
}

// Every outcome/start combination is legal. Omitting browserPreload leaves
// browser startup to the hydration subscription. Defined and undefined causes
// exercise the same status law; neither proves portable error object identity.
// The error/cold history reconstructs missing error transport; ready/error with
// browserPreload reconstructs a local error overriding a transported ready view.
// Removing either outcome axis loses one direction. Removing preload timing
// conflates before-hydration failure with ordinary failure after commit. The
// finite outcome domain excludes an in-progress or throwing callback; a ready
// callback cannot also signal error in this history. Empty rows bound this
// extension to status, while the existing source grammar owns row variation.
export const ssrRuntimeErrorHistoryArbitrary = fc.record({
  serverOutcome: fc.constantFrom(`ready` as const, `error` as const),
  browserOutcome: fc.constantFrom(`ready` as const, `error` as const),
  browserPreload: fc.boolean(),
  definedError: fc.boolean(),
})

export const ssrRuntimeErrorExamples: Array<SsrRuntimeErrorHistory> = (
  [`ready`, `error`] as const
).flatMap((serverOutcome) =>
  ([`ready`, `error`] as const).flatMap((browserOutcome) =>
    [false, true].flatMap((browserPreload) =>
      [false, true].map((definedError) => ({
        serverOutcome,
        browserOutcome,
        browserPreload,
        definedError,
      })),
    ),
  ),
)

export function expectedSsrRuntimeErrorViews(history: SsrRuntimeErrorHistory) {
  // The server's authored outcome determines markup and the first browser view.
  // Browser preload changes timing, never what the initial markup requires.
  const view = (status: `ready` | `error`) => ({
    rows: [],
    status,
    isReady: status === `ready`,
    isError: status === `error`,
    isLoading: false,
    isIdle: false,
  })
  return {
    initial: view(history.serverOutcome),
    committed: view(history.browserOutcome),
  }
}

/**
 * A receiving reader has a host initialization kind, independently of the
 * query's rows and readiness. Hydration owes that reader its server view even
 * after an earlier reader publishes live rows. A new browser mount owes the
 * current live view. The maintainer retained both promises on 2026-10-26;
 * docs/guides/ssr.md's per-reader hydration and ordinary-browser laws supply
 * their authority. Counting earlier readers cannot identify the host kind.
 *
 * This grammar composes the existing preparation law with zero to two earlier
 * hydrated readers and authored browser rows. A mount follows at least one
 * authoritative reader. Same and different rows, including ready-empty and
 * loading-empty server views, distinguish row equality from readiness equality.
 * Server/browser writes remain in the adjacent handoff grammar: this lane
 * isolates a change of receiving reader after a completed handoff.
 *
 * Removing initialization kind loses the mount/hydrate distinction. Removing
 * earlier readers loses consumption before a later hydration. Row variation
 * detects stale values; equal empty rows isolate readiness. Root/child mounting
 * checks that host hydration intent ends after the provider mounts. Nested
 * providers either inherit that intent or receive it explicitly. Counts range
 * from zero to three rows and zero to two earlier readers. Construction excludes
 * a fresh mount without an authoritative earlier reader, and an explicitly
 * hydration-marked provider on an ordinary mounted root.
 */
export type SsrReceivingHistory = {
  snapshot: SsrSnapshotHistory
  browserRows: SsrSnapshotHistory[`rows`]
  initializationKind: `hydrate` | `mount`
  mountLocation?: `root` | `child`
  providerNesting?: `none` | `inherit` | `marked`
  previousReaders: number
}

export const ssrReceivingHistoryArbitrary = fc
  .record({
    preparation: fc.constantFrom<SsrSnapshotHistory[`preparation`]>(
      `none`,
      `source`,
      `query`,
    ),
    ready: fc.boolean(),
    count: fc.integer({ min: 0, max: 3 }),
    browserCount: fc.integer({ min: 0, max: 3 }),
    sameRows: fc.boolean(),
    initializationKind: fc.constantFrom<
      SsrReceivingHistory[`initializationKind`]
    >(`hydrate`, `mount`),
    previousReaders: fc.integer({ min: 0, max: 2 }),
    mountLocation: fc.constantFrom(`root` as const, `child` as const),
    providerNesting: fc.constantFrom(
      `none` as const,
      `inherit` as const,
      `marked` as const,
    ),
  })
  .map((value): SsrReceivingHistory => {
    const rows = Array.from(
      { length: value.preparation === `none` ? 0 : value.count },
      (_, index) => ({ id: String(index + 1), name: `server ${index + 1}` }),
    )
    return {
      snapshot: {
        preparation: value.preparation,
        sourceState:
          value.preparation === `none`
            ? `idle`
            : value.preparation === `query` || value.ready
              ? `ready`
              : `loading`,
        rows,
      },
      browserRows: value.sameRows
        ? rows.map((row) => ({ ...row }))
        : Array.from({ length: value.browserCount }, (_, index) => ({
            id: String(index + 1),
            name: `browser ${index + 1}`,
          })),
      initializationKind: value.initializationKind,
      mountLocation:
        value.initializationKind === `mount` ? value.mountLocation : `root`,
      providerNesting:
        value.initializationKind === `mount` &&
        value.providerNesting === `marked`
          ? `inherit`
          : value.providerNesting,
      previousReaders:
        value.initializationKind === `mount`
          ? Math.max(1, value.previousReaders)
          : value.previousReaders,
    }
  })

// The judgment reuses the preparation model. Browser rows are authored input,
// not a read from the production query; readiness follows the completed source
// publication that this receiving driver explicitly awaits.
export function expectedSsrReceivingViews(history: SsrReceivingHistory) {
  const server = expectedSsrSnapshot(history.snapshot)
  const authoritative = { rows: history.browserRows, status: `ready` }
  return {
    initial:
      history.initializationKind === `hydrate`
        ? { rows: server.rows, status: server.status }
        : authoritative,
    authoritative,
  }
}

export const ssrReceivingExamples: Array<SsrReceivingHistory> = [
  {
    snapshot: {
      preparation: `query`,
      sourceState: `ready`,
      rows: [{ id: `1`, name: `server 1` }],
    },
    browserRows: [{ id: `1`, name: `browser 1` }],
    initializationKind: `hydrate`,
    previousReaders: 1,
  },
  {
    snapshot: { preparation: `source`, sourceState: `loading`, rows: [] },
    browserRows: [],
    initializationKind: `hydrate`,
    previousReaders: 1,
  },
]
ssrReceivingExamples.push(
  ...ssrReceivingExamples.map((history): SsrReceivingHistory => ({
    ...history,
    initializationKind: `mount`,
  })),
  {
    snapshot: { preparation: `none`, sourceState: `idle`, rows: [] },
    browserRows: [],
    initializationKind: `hydrate`,
    previousReaders: 0,
  },
  {
    ...ssrReceivingExamples[0]!,
    initializationKind: `mount`,
    mountLocation: `child`,
  },
  {
    ...ssrReceivingExamples[0]!,
    providerNesting: `inherit`,
  },
  {
    ...ssrReceivingExamples[0]!,
    providerNesting: `marked`,
  },
  {
    ...ssrReceivingExamples[0]!,
    initializationKind: `mount`,
    providerNesting: `inherit`,
  },
)
