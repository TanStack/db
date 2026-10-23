import { fc } from '@fast-check/vitest'

/**
 * SSR may expose only a snapshot the first browser render can reproduce.
 * The maintainer chose a programming-error rejection for incidental server-only
 * rows or readiness. An ordinary cold/loading render remains legal. The SSR
 * guide's normalized rows are provisional; they do not transfer query readiness.
 * A completed query preload separately transfers a ready result.
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
  })
  .filter(({ preparation, sourceState, count }) =>
    sourceState === `idle`
      ? count === 0 && (preparation === `none` || preparation === `source`)
      : preparation === `query`
        ? sourceState === `ready`
        : preparation !== `pending-query` || sourceState === `loading`,
  )
  .map(({ preparation, sourceState, count }): SsrSnapshotHistory => ({
    preparation,
    sourceState,
    rows: Array.from({ length: count }, (_, index) => ({
      id: String(index + 1),
      name: `server ${index + 1}`,
    })),
  }))

export function expectedSsrSnapshot(history: SsrSnapshotHistory) {
  const prepared =
    history.preparation === `query` || history.preparation === `source`
  return {
    rejects:
      !prepared && (history.sourceState === `ready` || history.rows.length > 0),
    rows: history.rows,
    status: history.preparation === `query` ? `ready` : `loading`,
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
