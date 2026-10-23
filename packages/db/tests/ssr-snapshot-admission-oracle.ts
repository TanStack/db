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
