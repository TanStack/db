/**
 * Real-provider refinement of the law/driver in hydration-commit.opfs.ts.
 * The insert history retains baseline+r1. The rich history replaces all rows,
 * ends with r2=3, cursor=8 and r2 ownership metadata. Both append an ordinary
 * tail after their receipt cut. Held histories additionally require scope exit. These literal expectations are a
 * second formulation of the core edit-log oracle, not derived from its model.
 * Peer B's schema/data and C's ordinary write must survive A's nested work.
 * A cycle is an assertion at a reached causal boundary, never a timeout waiver.
 * For on-demand A, the fixture follows its claimed physical storage ID. Its
 * post-cleanup fresh claim checks durable rows, not offline Collection restore;
 * a partial on-demand cache has no authority to restore public rows alone.
 */
import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-config.js'
import type { HydrationCommitObservation } from './hydration-commit.opfs'

// The edit-log model's rows after the receipt cut and the ordinary tail: the rich
// history replaces all rows with r2; the insert history keeps r1 and an optional baseline.
function expectedHydrationCommitRows(
  baseline: boolean,
  rich: boolean,
): Array<{ id: string; value: number }> {
  return rich
    ? [
        { id: `r2`, value: 3 },
        { id: `tail`, value: 9 },
      ]
    : [
        ...(baseline ? [{ id: `baseline`, value: 0 }] : []),
        { id: `r1`, value: 1 },
        { id: `tail`, value: 9 },
      ]
}

declareOracle({ model: [expectedHydrationCommitRows] })

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
          if (phase === `subscription`) {
            expect(observed.sourceStorageId).not.toBe(`a`)
          } else {
            expect(observed.sourceStorageId).toBe(`a`)
          }
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
          const expected = expectedHydrationCommitRows(baseline, rich)
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
          expect(observed.schemas).toEqual(
            [
              {
                collection_id: observed.sourceStorageId,
                schema_version: 11,
              },
              { collection_id: `b`, schema_version: 22 },
              { collection_id: `c`, schema_version: 33 },
            ].sort((a, b) => a.collection_id.localeCompare(b.collection_id)),
          )
          expect(result.error).toBeUndefined()
          expect(result.cleanupErrors).toEqual([])
        })
      }
    }
  }
}
