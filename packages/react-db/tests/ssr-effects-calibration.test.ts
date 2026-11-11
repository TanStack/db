// @vitest-environment node
// Checker calibration for the SSR effects oracle: a hand-built server
// observation, with no production render, must pass checkRender with an
// unrelated diagnostic and fail it with a client-layout diagnostic. Moved
// unchanged from ssr-effects-oracle.test.ts, which registers only
// oracleProperty tests.
import { expect, it } from 'vitest'
import { expectedSsrSnapshot } from '../../db/tests/ssr-snapshot-admission-oracle'
import { checkRender } from './ssr-effects-check-oracle'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'
import type { Observation } from './ssr-effects-check-oracle'

it(`distinguishes a client-layout diagnostic from unrelated messages`, () => {
  const history: SsrSnapshotHistory = {
    preparation: `none`,
    sourceState: `idle`,
    rows: [],
  }
  const expected = expectedSsrSnapshot(history)
  const actual: Observation = {
    reactVersion: `calibration`,
    rendererVersion: `calibration`,
    calls: 1,
    view: { rows: expected.rows, status: expected.status },
    diagnostics: [`unrelated diagnostic`],
    cleanupFailures: [],
  }
  expect(() => checkRender(history, actual, `ordinary-provider`)).not.toThrow()
  expect(() =>
    checkRender(
      history,
      {
        ...actual,
        diagnostics: [
          `Warning: useLayoutEffect does nothing on the server, because its effect cannot be encoded.`,
        ],
      },
      `ordinary-provider`,
    ),
  ).toThrow(/SSR client-layout diagnostic/)
})
