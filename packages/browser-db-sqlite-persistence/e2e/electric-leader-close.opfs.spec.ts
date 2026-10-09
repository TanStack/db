/**
 * A PostgreSQL row supplies the independent expected result. The installed
 * Electric SDK streams it into the follower's persisted Collection. The
 * leader closes after SQLite commits that row but before it answers. The
 * source receipt law predicts that the original Collection and mounted live
 * query keep the row, remain ready, and accept a later source row. The first
 * exact transaction ID appears once in SQLite's applied ledger.
 *
 * This fixed receiving history covers Chromium, OPFS, Web Locks,
 * BroadcastChannel, PostgreSQL, and Electric. The manual-source owner checks
 * the alternate before-durable and peer schedules. Multiple Electric
 * Collections and other browser engines remain outside this history.
 * The first-term leader has a manual source, so this does not model two
 * Electric streams contending in both tabs or the reported seven Collections.
 */
import { expect, test } from '@playwright/test'
import { makePgClient } from '../../db-collection-e2e/support/global-setup'
import type { BrowserContext, Page } from '@playwright/test'
import type { ElectricLeaderCloseObservation } from './electric-leader-close.opfs'

type Item = { id: string; label: string }

async function observe(page: Page): Promise<ElectricLeaderCloseObservation> {
  return page.evaluate(() => window.__electricLeaderCloseProbe!.observe())
}

async function openProbe(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForFunction(
    () =>
      window.__electricLeaderCloseProbe !== undefined &&
      window.__electricLeaderCloseProbe.observe().phase !== 'starting',
    undefined,
    { timeout: 60_000 },
  )
  const state = await observe(page)
  if (state.phase === 'failed') throw new Error(state.failure)
}

function publicSnapshot(state: ElectricLeaderCloseObservation) {
  return {
    status: state.status,
    publicRows: state.publicRows,
    liveRows: state.liveRows,
    liveStatus: state.liveStatus,
  }
}

function resumeIdentity(resume: unknown): {
  kind: 'resume'
  offset: string
  handle: string
  shapeId: string
} {
  expect(resume).toMatchObject({
    kind: 'resume',
    offset: expect.any(String),
    handle: expect.any(String),
    shapeId: expect.any(String),
  })
  const { offset, handle, shapeId } = resume as {
    offset: string
    handle: string
    shapeId: string
  }
  return { kind: 'resume', offset, handle, shapeId }
}

async function runHistory(context: BrowserContext): Promise<void> {
  const token = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
  const databaseId = 'electric-2085-' + token
  const collectionId = databaseId + '-items'
  const table = 'electric_2085_' + token
  const pageUrl = (role: 'leader' | 'follower') =>
    '/e2e/electric-leader-close.opfs.html?' +
    new URLSearchParams({ databaseId, collectionId, table, role })
  const postgres = makePgClient()
  const pages: Array<Page> = []
  const cleanupFailures: Array<string> = []
  let connected = false
  let primaryFailure: unknown

  try {
    await postgres.connect()
    connected = true
    await postgres.query(
      'CREATE TABLE public.' +
        table +
        ' (id TEXT PRIMARY KEY, label TEXT NOT NULL)',
    )
    const leader = await context.newPage()
    pages.push(leader)
    await openProbe(leader, pageUrl('leader'))
    await expect.poll(async () => (await observe(leader)).isLeader).toBe(true)

    const follower = await context.newPage()
    pages.push(follower)
    await openProbe(follower, pageUrl('follower'))
    expect((await observe(follower)).isLeader).toBe(false)
    const beforeSource = await follower.evaluate(() =>
      window.__electricLeaderCloseProbe!.durableState(),
    )
    expect(beforeSource.rows).toEqual([])
    const initialOffset = resumeIdentity(beforeSource.resume).offset

    const crossing: Item = { id: 'crossing', label: 'first Electric row' }
    await postgres.query(
      'INSERT INTO public.' + table + ' (id, label) VALUES ($1, $2)',
      [crossing.id, crossing.label],
    )
    // The hold proves that Electric supplied the crossing mutation and SQLite
    // applied it before close. The first RPC answer remains absent.
    try {
      await expect
        .poll(async () => (await observe(leader)).heldAfterDurability, {
          timeout: 60_000,
        })
        .toBe(true)
    } catch (error) {
      throw new Error(
        'Electric crossing did not reach the held adapter: ' +
          JSON.stringify({
            leader: await observe(leader),
            follower: await observe(follower),
          }),
        { cause: error },
      )
    }
    const held = await observe(follower)
    expect(held.crossingTxId).toEqual(expect.any(String))
    expect(held.crossingTxIds).toEqual([held.crossingTxId])
    expect(held.crossingResumeMutation).toMatchObject({
      kind: 'resume',
      offset: expect.any(String),
    })
    expect(held.crossingReceiptStatus).toBe('pending')
    expect(held.syncRuns).toBe(1)
    expect(held.reconciliationRequested).toBe(false)
    await leader.close()

    await expect
      .poll(async () => (await observe(follower)).isLeader, {
        timeout: 30_000,
      })
      .toBe(true)
    // Compare at the original receipt checkpoint, before a later source row
    // can hide a missing publication or a terminal Collection error.
    await expect
      .poll(
        async () => {
          const state = await observe(follower)
          const durable = await follower.evaluate(() =>
            window.__electricLeaderCloseProbe!.durableState(),
          )
          return {
            rpcError: state.crossingRpcError,
            requested: state.reconciliationRequested,
            succeeded: state.reconciliationSucceeded,
            receipt: state.crossingReceiptStatus,
            syncRuns: state.syncRuns,
            ...publicSnapshot(state),
            durableRows: durable.rows,
          }
        },
        { timeout: 30_000 },
      )
      .toEqual({
        rpcError: 'IndeterminateCommitError',
        requested: true,
        succeeded: true,
        receipt: 'fulfilled',
        syncRuns: 1,
        status: 'ready',
        publicRows: [crossing],
        liveRows: [crossing],
        liveStatus: 'ready',
        durableRows: [crossing],
      })
    const afterFirst = await observe(follower)
    expect(afterFirst.crossingTxIds).toEqual([afterFirst.crossingTxId])
    expect(afterFirst.reconciledTxIds).toEqual([afterFirst.crossingTxId])
    const firstDurable = await follower.evaluate(() =>
      window.__electricLeaderCloseProbe!.durableState(),
    )
    const firstTxIds = await follower.evaluate(() =>
      window.__electricLeaderCloseProbe!.durableTxIds(),
    )
    expect(
      firstTxIds.filter((txId) => txId === afterFirst.crossingTxId),
    ).toHaveLength(1)
    const crossingResume = resumeIdentity(firstDurable.resume)
    const crossingOffset = crossingResume.offset
    expect(resumeIdentity(afterFirst.crossingResumeMutation)).toEqual(
      crossingResume,
    )
    expect(crossingOffset).not.toBe(initialOffset)

    const later: Item = { id: 'later', label: 'later Electric row' }
    await postgres.query(
      'INSERT INTO public.' + table + ' (id, label) VALUES ($1, $2)',
      [later.id, later.label],
    )
    await expect
      .poll(
        async () => {
          const state = await observe(follower)
          const durable = await follower.evaluate(() =>
            window.__electricLeaderCloseProbe!.durableState(),
          )
          return {
            ...publicSnapshot(state),
            durableRows: durable.rows,
            receipt: state.crossingReceiptStatus,
            syncRuns: state.syncRuns,
          }
        },
        { timeout: 60_000 },
      )
      .toEqual({
        status: 'ready',
        publicRows: [crossing, later],
        liveRows: [crossing, later],
        liveStatus: 'ready',
        durableRows: [crossing, later],
        receipt: 'fulfilled',
        syncRuns: 1,
      })
    const afterSecond = await follower.evaluate(() =>
      window.__electricLeaderCloseProbe!.durableState(),
    )
    expect(resumeIdentity(afterSecond.resume).offset).not.toBe(crossingOffset)
    const finalTxIds = await follower.evaluate(() =>
      window.__electricLeaderCloseProbe!.durableTxIds(),
    )
    expect((await observe(follower)).crossingTxIds).toEqual([
      afterFirst.crossingTxId,
    ])
    expect(
      finalTxIds.filter((txId) => txId === afterFirst.crossingTxId),
    ).toHaveLength(1)
  } catch (error) {
    primaryFailure = error
  }

  for (const page of pages.reverse()) {
    try {
      if (page.isClosed()) continue
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__electricLeaderCloseProbe?.cleanup() ?? [],
        )),
      )
      await page.close()
    } catch (error) {
      cleanupFailures.push('page cleanup: ' + String(error))
      try {
        await page.close()
      } catch (closeError) {
        cleanupFailures.push('page close: ' + String(closeError))
      }
    }
  }
  if (connected) {
    try {
      await postgres.query('DROP TABLE IF EXISTS public.' + table)
      await postgres.end()
    } catch (error) {
      cleanupFailures.push('PostgreSQL cleanup: ' + String(error))
    }
  }
  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      'Electric leader-close oracle and cleanup both failed',
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
}

test('Electric source Collection survives a committed, unanswered leader RPC', async ({
  context,
}) => runHistory(context))
