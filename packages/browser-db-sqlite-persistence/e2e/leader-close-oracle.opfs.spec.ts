/**
 * Issue #2085's source-backed recovery law: a source sync transaction keeps
 * its applied receipt pending across an unanswered RPC. The replacement
 * leader certifies its exact durable txId or applies it against an unchanged
 * durable anchor. The receipt fulfills in the original sync run, and mounted
 * dependent live queries continue to receive rows. The direct RPC's
 * indeterminate result stays intact.
 *
 * Legal history: two real Chromium tabs share one OPFS database; a follower
 * source commit reaches the leader's SQLite adapter; the page closes either
 * before or after the durable write but before its response. The follower
 * takes leadership and then receives another source commit. A third tab is a
 * passive observer whose rows cannot be supplied by the requester's optimistic
 * write. An idle close is the neighboring control. The fixture stages a source
 * cursor atomically with each row. At the held boundary, reconciled receipt,
 * passive publication, and next receipt, compare exact rows, cursor, and
 * stream position.
 * This manual source witness does not establish Electric SDK delivery or
 * arbitrary concurrent row edits. The applied_tx count is a duplicate
 * detector for this no-pruning fixture, not a permanent storage contract.
 */
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

type ProbeObservation = {
  phase: `starting` | `ready` | `failed`
  failure?: string
  isLeader: boolean
  collectionStatus: string
  publicIds: Array<string>
  liveIds: Array<string>
  liveStatus: string
  publicEventKeys: Array<string>
  liveEventKeys: Array<string>
  authoredTxIds: Record<string, string>
  syncRuns: number
  heldAtCommitBoundary: boolean
  reconciliationRequested: boolean
  firstOutcome?: {
    status: `fulfilled` | `rejected`
    errorName?: string
    message?: string
  }
}

async function observe(page: Page): Promise<ProbeObservation> {
  return page.evaluate(() => window.__leaderCloseProbe!.observe())
}

async function openProbe(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForFunction(
    () =>
      window.__leaderCloseProbe !== undefined &&
      window.__leaderCloseProbe.observe().phase !== `starting`,
  )
  const state = await observe(page)
  if (state.phase === `failed`) throw new Error(state.failure)
}

type Schedule = `none` | `before` | `after` | `after-peer` | `after-notify`

// The authored order is crossing→later. Each fulfilled source receipt has one
// durable row/cursor pair. The passive tab must eventually publish that pair
// before the later commit can mask a missing notification. This reference
// reads no coordinator route or SQLite classifier.
function expectedHistory(schedule: Schedule) {
  const crossing = schedule === `none` ? [] : [`crossing`]
  const firstIds = schedule === `after-peer` ? [`crossing`, `peer`] : crossing
  const finalIds = [...firstIds, `later`].sort()
  return {
    afterFirst: {
      firstStatus: schedule === `none` ? `absent` : `fulfilled`,
      collectionStatus: `ready`,
      syncRuns: 1,
      publicIds: firstIds,
      liveIds: firstIds,
      liveStatus: `ready`,
      passiveIds: firstIds,
      passiveLiveIds: firstIds,
      passiveLiveStatus: `ready`,
      ...(schedule === `after-notify`
        ? {
            passivePublicEventKeys: [`crossing`],
            passiveLiveEventKeys: [`crossing`],
          }
        : {}),
      durableIds: firstIds,
      cursor:
        schedule === `none`
          ? null
          : schedule === `after-peer`
            ? `peer`
            : `crossing`,
      rowVersion: firstIds.length,
      durableTxCount: firstIds.length,
    },
    afterSecond: {
      secondStatus: `fulfilled`,
      collectionStatus: `ready`,
      syncRuns: 1,
      publicIds: finalIds,
      liveIds: finalIds,
      liveStatus: `ready`,
      passiveIds: finalIds,
      passiveLiveIds: finalIds,
      passiveLiveStatus: `ready`,
      ...(schedule === `after-notify`
        ? {
            passivePublicEventKeys: [`crossing`, `later`],
            passiveLiveEventKeys: [`crossing`, `later`],
          }
        : {}),
      durableIds: finalIds,
      cursor: `later`,
      rowVersion: finalIds.length,
      durableTxCount: finalIds.length,
    },
  }
}

async function runHistory(
  context: BrowserContext,
  schedule: Schedule,
): Promise<void> {
  const databaseId = `leader-close-${crypto.randomUUID()}`
  const crossing = schedule === `none` ? [] : [`crossing`]
  const firstIds = schedule === `after-peer` ? [`crossing`, `peer`] : crossing
  const finalIds = [...firstIds, `later`].sort()
  const pageUrl = (role: `leader` | `follower` | `passive`) =>
    `/e2e/leader-close.opfs.html?databaseId=${databaseId}&role=${role}&hold=${schedule}`
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let primaryFailure: unknown

  try {
    const leader = await context.newPage()
    pages.push(leader)
    await openProbe(leader, pageUrl(`leader`))
    await expect.poll(async () => (await observe(leader)).isLeader).toBe(true)

    const follower = await context.newPage()
    pages.push(follower)
    await openProbe(follower, pageUrl(`follower`))
    expect((await observe(follower)).isLeader).toBe(false)

    const passive = await context.newPage()
    pages.push(passive)
    await openProbe(passive, pageUrl(`passive`))
    expect((await observe(passive)).isLeader).toBe(false)

    if (schedule !== `none`) {
      await follower.evaluate(() =>
        window.__leaderCloseProbe!.startSourceCommit(`crossing`),
      )
      try {
        await expect
          .poll(async () => (await observe(leader)).heldAtCommitBoundary)
          .toBe(true)
      } catch (error) {
        throw new Error(
          `No held durable RPC: ${JSON.stringify({ leader: await observe(leader), follower: await observe(follower) })}`,
          { cause: error },
        )
      }
      const heldFollower = await observe(follower)
      if (schedule === `after-notify`) {
        await expect
          .poll(async () => {
            const state = await observe(passive)
            return { publicIds: state.publicIds, liveIds: state.liveIds }
          })
          .toEqual({ publicIds: [`crossing`], liveIds: [`crossing`] })
      }
      const heldPassive = await observe(passive)
      expect({
        firstStatus: heldFollower.firstOutcome?.status ?? `pending`,
        publicIds: heldFollower.publicIds,
        liveIds: heldFollower.liveIds,
        passiveIds: heldPassive.publicIds,
        passiveLiveIds: heldPassive.liveIds,
      }).toEqual({
        firstStatus: `pending`,
        publicIds: [`crossing`],
        liveIds: [`crossing`],
        passiveIds: schedule === `after-notify` ? [`crossing`] : [],
        passiveLiveIds: schedule === `after-notify` ? [`crossing`] : [],
      })
    }
    await leader.close()
    await expect
      .poll(
        async () =>
          (await observe(follower)).isLeader ||
          (await observe(passive)).isLeader,
        { timeout: 15_000 },
      )
      .toBe(true)
    if (schedule === `after-peer`) {
      // The requester holds before entering the writer lock. The peer's
      // durable version 2 therefore precedes the exact-ID SQLite read.
      await expect
        .poll(async () => (await observe(follower)).reconciliationRequested, {
          timeout: 15_000,
        })
        .toBe(true)
      expect((await observe(follower)).firstOutcome).toBeUndefined()
      const peerOutcome = await passive.evaluate(() =>
        window.__leaderCloseProbe!.commitNext(`peer`),
      )
      expect(peerOutcome).toEqual({ status: `fulfilled` })
      const beforeReconciliation = await passive.evaluate(() =>
        window.__leaderCloseProbe!.durableState(),
      )
      expect({
        firstOutcome: (await observe(follower)).firstOutcome,
        durableIds: beforeReconciliation.ids,
        cursor: beforeReconciliation.cursor,
        rowVersion: beforeReconciliation.rowVersion,
      }).toEqual({
        firstOutcome: undefined,
        durableIds: [`crossing`, `peer`],
        cursor: `peer`,
        rowVersion: 2,
      })
      await follower.evaluate(() =>
        window.__leaderCloseProbe!.releaseReconciliation(),
      )
    }
    if (schedule !== `none`) {
      await expect
        .poll(async () => (await observe(follower)).firstOutcome, {
          timeout: 15_000,
        })
        .toBeDefined()
    }
    await expect
      .poll(async () => {
        const state = await observe(follower)
        return { status: state.collectionStatus, syncRuns: state.syncRuns }
      })
      .toEqual({
        status: `ready`,
        syncRuns: 1,
      })
    await expect
      .poll(async () => {
        const state = await observe(passive)
        return { ids: state.publicIds, liveIds: state.liveIds }
      })
      .toEqual({ ids: firstIds, liveIds: firstIds })
    await expect
      .poll(async () => {
        const state = await observe(follower)
        return { ids: state.publicIds, liveIds: state.liveIds }
      })
      .toEqual({ ids: firstIds, liveIds: firstIds })

    // First-receipt checkpoint: the source may advance only after its row and
    // resume metadata are durable. A duplicate retry creates an extra ledger
    // entry even when the final row happens to look correct.
    const firstSurvivor = await observe(follower)
    const firstPassive = await observe(passive)
    const firstDurable = await follower.evaluate(() =>
      window.__leaderCloseProbe!.durableState(),
    )
    const firstDurableTxIds = await follower.evaluate(() =>
      window.__leaderCloseProbe!.durableTxIds(),
    )
    const firstAuthoredTxIds = [
      ...(schedule === `none` ? [] : [firstSurvivor.authoredTxIds.crossing]),
      ...(schedule === `after-peer` ? [firstPassive.authoredTxIds.peer] : []),
    ]
    expect(firstAuthoredTxIds.every((txId) => typeof txId === `string`)).toBe(
      true,
    )
    expect(firstDurableTxIds).toEqual(firstAuthoredTxIds)
    const afterFirst = {
      firstStatus: firstSurvivor.firstOutcome?.status ?? `absent`,
      collectionStatus: firstSurvivor.collectionStatus,
      syncRuns: firstSurvivor.syncRuns,
      publicIds: firstSurvivor.publicIds,
      liveIds: firstSurvivor.liveIds,
      liveStatus: firstSurvivor.liveStatus,
      passiveIds: firstPassive.publicIds,
      passiveLiveIds: firstPassive.liveIds,
      passiveLiveStatus: firstPassive.liveStatus,
      ...(schedule === `after-notify`
        ? {
            passivePublicEventKeys: firstPassive.publicEventKeys,
            passiveLiveEventKeys: firstPassive.liveEventKeys,
          }
        : {}),
      durableIds: firstDurable.ids,
      cursor: firstDurable.cursor,
      rowVersion: firstDurable.rowVersion,
      durableTxCount: firstDurableTxIds.length,
    }

    const secondOutcome = await follower.evaluate(() =>
      window.__leaderCloseProbe!.commitNext(`later`),
    )
    const survivor = await observe(follower)
    await expect
      .poll(async () => {
        const state = await observe(passive)
        return { ids: state.publicIds, liveIds: state.liveIds }
      })
      .toEqual({ ids: finalIds, liveIds: finalIds })
    const laterPassive = await observe(passive)
    const durable = await follower.evaluate(() =>
      window.__leaderCloseProbe!.durableState(),
    )
    const durableTxIds = await follower.evaluate(() =>
      window.__leaderCloseProbe!.durableTxIds(),
    )
    expect(typeof survivor.authoredTxIds.later).toBe(`string`)
    expect(durableTxIds).toEqual([
      ...firstAuthoredTxIds,
      survivor.authoredTxIds.later,
    ])
    const afterSecond = {
      collectionStatus: survivor.collectionStatus,
      syncRuns: survivor.syncRuns,
      secondStatus: secondOutcome.status,
      publicIds: survivor.publicIds,
      liveIds: survivor.liveIds,
      liveStatus: survivor.liveStatus,
      passiveIds: laterPassive.publicIds,
      passiveLiveIds: laterPassive.liveIds,
      passiveLiveStatus: laterPassive.liveStatus,
      ...(schedule === `after-notify`
        ? {
            passivePublicEventKeys: laterPassive.publicEventKeys,
            passiveLiveEventKeys: laterPassive.liveEventKeys,
          }
        : {}),
      durableIds: durable.ids,
      cursor: durable.cursor,
      rowVersion: durable.rowVersion,
      durableTxCount: durableTxIds.length,
    }
    expect(
      { afterFirst, afterSecond },
      `Host observation: ${JSON.stringify({ afterFirst, afterSecond, survivor, secondOutcome, durableTxIds })}`,
    ).toEqual(expectedHistory(schedule))
  } catch (error) {
    primaryFailure = error
  }

  for (const page of pages.reverse()) {
    try {
      if (page.isClosed()) continue
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__leaderCloseProbe?.cleanup() ?? [],
        )),
      )
      await page.close()
    } catch (error) {
      cleanupFailures.push(`page cleanup: ${String(error)}`)
      try {
        await page.close()
      } catch (closeError) {
        cleanupFailures.push(`page close: ${String(closeError)}`)
      }
    }
  }
  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `Leader-close oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
}

test(`surviving OPFS source Collection accepts work after an idle leader tab closes`, async ({
  context,
}) => runHistory(context, `none`))

for (const schedule of [`before`, `after`] as const) {
  test(`surviving OPFS source Collection reconciles a leader close ${schedule} durable application`, async ({
    context,
  }) => runHistory(context, schedule))
}

test(`surviving OPFS source Collection retains a peer write during exact-ID reconciliation`, async ({
  context,
}) => runHistory(context, `after-peer`))

test(`surviving OPFS peers do not republish a commit after its answer is lost`, async ({
  context,
}) => runHistory(context, `after-notify`))
