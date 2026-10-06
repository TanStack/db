/**
 * Real-provider refinement of the law/driver in hydration-commit.opfs.ts.
 * The insert history retains baseline+r1. The rich history replaces all rows,
 * ends with r2=3, cursor=8 and r2 ownership metadata. Both append an ordinary
 * tail after their receipt cut. Held histories additionally require scope exit. These literal expectations are a
 * second formulation of the core edit-log oracle, not derived from its model.
 * Peer B's schema/data and C's ordinary write must survive A's nested work.
 * A cycle is an assertion at a reached causal boundary, never a timeout waiver.
 */
import { expect, test } from '@playwright/test'
import type { HydrationCommitObservation } from './hydration-commit.opfs'

for (const phase of [`startup`, `subscription`, `after-ready`] as const) {
  for (const baseline of [false, true]) {
    for (const coordinator of [`default`, `browser`] as const) {
      for (const rich of [false, true]) {
        test(`${phase}, baseline=${baseline}, coordinator=${coordinator}, rich=${rich}: preserves source and peer durability`, async ({
          page,
        }) => {
          await page.goto(
            `/e2e/hydration-commit.opfs.html?phase=${phase}&baseline=${baseline}&coordinator=${coordinator}&rich=${rich}`,
          )
          await page.waitForFunction(
            () => window.__hydrationCommitDone === true,
          )
          const result = await page.evaluate(() => ({
            observation: window.__hydrationCommitResult,
            error: window.__hydrationCommitError,
            cleanupErrors: window.__hydrationCommitCleanupErrors,
          }))
          const observed: HydrationCommitObservation | undefined =
            result.observation
          expect(
            observed,
            `fixture must reach its observation cut: ${JSON.stringify(result)}`,
          ).toBeDefined()
          if (!observed) return
          expect(observed.rowReads).toBeGreaterThan(0)
          if (phase !== `after-ready`)
            expect(observed.held).toEqual({
              receipts: Array.from({ length: rich ? 6 : 1 }, () => `pending`),
              rows: [],
              ordinary: `pending`,
              interleavedSql: [],
              peerHydrationAdmitted: true,
              ordinaryAdmitted: true,
            })
          expect(observed.cycleCalls, JSON.stringify(result)).toBe(0)
          expect(observed.errors).toEqual([])
          expect(
            observed.ordinaryCommitSqlCalls,
            `the ordinary SQL observer must be reached`,
          ).toBe(1)
          expect(
            observed.tailScheduling,
            `the tail must reenter ordinary scheduling exactly once`,
          ).toEqual([
            coordinator === `browser` ? `regular-scope` : `public-apply`,
          ])
          expect(
            observed.peerWorkBeforeScopeExit,
            `peer work cannot preempt the whole owning callback`,
          ).toEqual([])
          expect({
            receipts: observed.receipts,
            source: observed.sourceStatus,
            peer: observed.peerStatus,
            ordinary: observed.ordinaryReceipt,
            exited: observed.owningScopeExited,
          }).toEqual({
            receipts: Array.from({ length: rich ? 7 : 2 }, () => `fulfilled`),
            source: `ready`,
            peer: `ready`,
            ordinary: `fulfilled`,
            exited: phase === `after-ready` ? null : true,
          })
          const expected = rich
            ? [
                { id: `r2`, value: 3 },
                { id: `tail`, value: 9 },
              ]
            : [
                ...(baseline ? [{ id: `baseline`, value: 0 }] : []),
                { id: `r1`, value: 1 },
                { id: `tail`, value: 9 },
              ]
          expect(observed.rows).toEqual(expected)
          expect(observed.durableRows).toEqual(expected)
          expect(observed.reopenedRows).toEqual(expected)
          expect(observed.durableMetadata).toEqual(
            rich ? [{ key: `cursor`, value: 8 }] : [],
          )
          expect(observed.durableRowMetadata).toEqual(
            rich ? [{ key: `r2`, metadata: { owner: `source` } }] : [],
          )
          expect(observed.peerRows).toEqual([
            { id: `peer-baseline`, value: 22 },
          ])
          expect(observed.ordinaryRows).toEqual([{ id: `ordinary`, value: 33 }])
          expect(observed.schemas).toEqual([
            { collection_id: `a`, schema_version: 11 },
            { collection_id: `b`, schema_version: 22 },
            { collection_id: `c`, schema_version: 33 },
          ])
          expect(result.error).toBeUndefined()
          expect(result.cleanupErrors).toEqual([])
        })
      }
    }
  }
}

// ORC-010 calibration: two teardown failures cannot erase the independently
// captured observation, mutate its receipt errors, or hide one another.
test(`preserves the primary observation through multiple cleanup failures`, async ({
  page,
}) => {
  await page.goto(
    `/e2e/hydration-commit.opfs.html?phase=after-ready&baseline=false&coordinator=browser&rich=false&cleanupFault=true`,
  )
  await page.waitForFunction(() => window.__hydrationCommitDone === true)
  const result = await page.evaluate(() => ({
    observation: window.__hydrationCommitResult,
    error: window.__hydrationCommitError,
    cleanup: window.__hydrationCommitCleanupErrors,
  }))
  expect(result.error).toBeUndefined()
  expect(result.observation?.cycleCalls).toBe(0)
  expect(result.observation?.errors).toEqual([])
  expect(result.observation?.reopenedRows).toEqual([
    { id: `r1`, value: 1 },
    { id: `tail`, value: 9 },
  ])
  expect(result.cleanup).toEqual([
    `Error: injected first cleanup failure`,
    `Error: injected last cleanup failure`,
  ])
})
