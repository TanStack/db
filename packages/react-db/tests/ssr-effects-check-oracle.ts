// The server-render observation and its admission and diagnostic judgment,
// shared by the SSR effects oracle (ssr-effects-oracle.test.ts) and its
// checker calibration (ssr-effects-calibration.test.ts). Moved unchanged from
// the oracle file so the calibration can import it without registering the
// oracle's properties a second time.
import { expect } from 'vitest'
import { expectedSsrSnapshot } from '../../db/tests/ssr-snapshot-admission-oracle'
import { atOracleCheckpoint } from '../../db/tests/oracle-failure-fidelity'
import type { SsrSnapshotHistory } from '../../db/tests/ssr-snapshot-admission-oracle'

export type Observation = {
  reactVersion: string
  rendererVersion: string
  calls: number
  view?: { rows: unknown; status?: string }
  failure?: string
  diagnostics: Array<string>
  cleanupFailures: Array<string>
}

const isLayoutDiagnostic = (message: string) =>
  /useLayoutEffect does nothing on the server/i.test(message)

// Preparation independently decides ordinary admission and rows/status.
// Completed-query Suspense shares the ready judgment. Standalone builders and
// supplied Collections check only return/diagnostics, without a transport claim.
// Keeping raw messages permits unrelated diagnostics and exposes exact warnings.
export function checkRender(
  history: SsrSnapshotHistory,
  actual: Observation,
  path: string,
  expected = expectedSsrSnapshot(history),
) {
  try {
    atOracleCheckpoint(`SSR path reached`, path, () => {
      expect(
        actual.calls,
        `real server renderer invoked the hook`,
      ).toBeGreaterThan(0)
    })
    const descriptor = path.includes(`provider`) || path.includes(`explicit`)
    atOracleCheckpoint(`SSR preparation admission`, path, () => {
      if (descriptor && expected.rejects) {
        expect(actual.failure, `untransported server view rejects`).toMatch(
          /SSR.*(?:preload|hydrat)/i,
        )
      } else {
        expect(actual.failure, `legal SSR render`).toBeUndefined()
        expect(actual.view, `hook returned its public view`).toBeDefined()
        if (path.startsWith(`suspense`))
          expect(actual.view?.rows, `prepared Suspense rows`).toEqual(
            expected.rows,
          )
        else if (descriptor)
          expect(actual.view, `server public view`).toEqual({
            rows: expected.rows,
            status: expected.status,
          })
      }
    })
    if (!descriptor || !expected.rejects)
      atOracleCheckpoint(`SSR client-layout diagnostic`, path, () => {
        expect(
          actual.diagnostics.filter(isLayoutDiagnostic),
          `legal SSR emits no client-layout diagnostic: ${JSON.stringify(actual.diagnostics)}`,
        ).toEqual([])
      })
  } catch (error) {
    if (actual.cleanupFailures.length)
      throw new AggregateError(
        [error, ...actual.cleanupFailures.map((failure) => new Error(failure))],
        `SSR comparison and cleanup failed`,
        { cause: error },
      )
    throw error
  }
  atOracleCheckpoint(`SSR cleanup`, path, () => {
    expect(actual.cleanupFailures, `server cleanup diagnostics`).toEqual([])
  })
}
