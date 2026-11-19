/**
 * Known-defect witnesses of the follower recovery laws in
 * persisted-oracle.test.ts. Known limit #2139: production does not end a
 * rotated follower's scoped recovery, so these fixed histories fail today
 * through the same drivers and models, in
 * persisted-follower-recovery-oracle.ts. Each is `it.fails` until the fix for
 * #2139 makes it pass; then it returns to the oracle.
 */
import { it } from 'vitest'
import { fc } from '@fast-check/vitest'
import { oracleFixedSeed, oracleRuns } from '../../db/tests/oracle-config.js'
import { describeUnlessOracleReplay } from './persisted-support'

import {
  assertFollowerGenerationNoticeHistory,
  assertFollowerRemoteDemandHistory,
  assertRotatedReacquisition,
  followerGenerationNoticeHistory,
  followerRemoteDemandHistories,
  reacquisitionLimit,
  rotatedReacquisitionHistories,
} from './persisted-follower-recovery-oracle'

describeUnlessOracleReplay(`persistedCollectionOptions`, () => {
  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each([
    { ownerCommit: `before-rotation`, later: `none` },
    { ownerCommit: `after-rotation`, later: `none` },
    { ownerCommit: `after-rotation`, later: `owner` },
    { ownerCommit: `before-rotation`, later: `peer` },
  ] as const)(
    `publishes an elected owner's rows to a follower after rotation: commit $ownerCommit, later $later`,
    (history) => {
      return assertFollowerGenerationNoticeHistory({
        ...history,
        ownerRead: `ok`,
      })
    },
  )

  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each(
    ([`gap`, `reconciliation`] as const).flatMap((noticeShape) =>
      ([`before-rotation`, `after-rotation`] as const).flatMap((ownerCommit) =>
        ([`none`, `owner`] as const).map((later) => ({
          ownerCommit,
          later,
          noticeShape,
        })),
      ),
    ),
  )(
    `publishes an elected owner's rows after rotation when its notice is a $noticeShape: commit $ownerCommit, later $later`,
    (history) => {
      return assertFollowerGenerationNoticeHistory({
        ...history,
        ownerRead: `ok`,
      })
    },
  )

  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each([
    { ownerCommit: `before-rotation`, later: `owner` },
    { ownerCommit: `after-rotation`, later: `owner` },
  ] as const)(
    `fails a follower when its elected owner's update cannot be read after rotation: commit $ownerCommit`,
    (history) => {
      return assertFollowerGenerationNoticeHistory({
        ...history,
        ownerRead: `fails`,
      })
    },
  )

  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails(
    `ignores a follower read failure when rotation starts while the read is in flight`,
    () => {
      return assertFollowerGenerationNoticeHistory({
        ownerCommit: `before-rotation`,
        later: `none`,
        ownerRead: `ok`,
        readFailsAsRotationStarts: true,
      })
    },
  )

  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible. Some
  // generated histories pass today, so a random draw cannot be a fixed history that
  // fails; this fixed seed records the limit. The fix for #2139 adds the random
  // and replayed campaign back.
  it.fails(
    `checks generated follower generation-notice histories (fixed)`,
    () => {
      // Preserve the known-limit fixed-seed corpus and its expected failure.
      // This is supplemental characterization, not a passing native property.
      return (async () => {
        for (const history of fc.sample(
          followerGenerationNoticeHistory,
          oracleFixedSeed(2128, { numRuns: oracleRuns(12) }),
        ))
          await assertFollowerGenerationNoticeHistory(history)
      })()
    },
  )

  // Known limit: see #2139. A rotated follower stays in scoped recovery, so
  // the owner's rows in the new generation never become visible.
  it.fails.each(
    followerRemoteDemandHistories.filter(
      ({ placement }) => placement === `rotated`,
    ),
  )(
    `settles a follower's remote demand with the owner's applied rows: $placement broadcast, apply $apply, $consumer`,
    (...args: Parameters<typeof assertFollowerRemoteDemandHistory>) => {
      return assertFollowerRemoteDemandHistory(...args)
    },
  )

  it.fails.each(rotatedReacquisitionHistories.filter(reacquisitionLimit))(
    `ends a follower's scoped recovery only after every reacquisition succeeds: order $order, notice between $noticeBetween, fails $fails, new demand $newDemand`,
    (...args: Parameters<typeof assertRotatedReacquisition>) => {
      return assertRotatedReacquisition(...args)
    },
    10_000,
  )

  // Known limit: see #2139. Recovery never ends, so the rows stay hidden.
  it.fails(
    `holds a rotated follower's notices when two reads find the claim lost: fails 'none'`,
    () => {
      return assertRotatedReacquisition({
        order: [`a`, `b`],
        noticeBetween: false,
        fails: `none`,
        trigger: `claim-lost-during-reads`,
      })
    },
    10_000,
  )
})
