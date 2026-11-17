// The boundary-by-demand grammar and the independent immediate-work model of
// ordered-source-loader-oracle.test.ts, moved unchanged so that the grammar
// check in ordered-source-loader-model.test.ts can read them. That oracle file
// states the law. This module registers no tests.
export const stagedWindowAxes = {
  boundary: [`absent`, `present`] as const,
  demand: [`satisfied`, `widened`] as const,
}
export const stagedWindowCases = stagedWindowAxes.boundary.flatMap((boundary) =>
  stagedWindowAxes.demand.map((demand) => ({ boundary, demand })),
)

/**
 * Independent immediate-work model for an explicit window that consumes a
 * staged boundary continuation. A present boundary requires its tie
 * acquisition. An absent boundary starts no work, so only remaining window
 * demand can require a prefix acquisition.
 */
export const expectedStagedWindowTrace = (
  boundary: (typeof stagedWindowAxes.boundary)[number],
  demand: (typeof stagedWindowAxes.demand)[number],
): Array<`page` | `boundary`> => [
  `page`,
  ...(boundary === `present` ? ([`boundary`] as const) : []),
  ...(demand === `widened` ? ([`page`] as const) : []),
]
