/**
 * A real Browser coordinator notice has the physical storage ID of its
 * committed OPFS write. A subscriber whose claim expired before it handles
 * that notice must reload its retained subset into private storage. A later
 * live claimant keeps the current head, public rows, and durable rows. This
 * fixed schedule controls receiver handling after native BroadcastChannel
 * delivery; it does not claim arbitrary scheduling or Electric delivery.
 * The independent model is two claims with half-open lifetimes: first expires
 * at t+300000, peer at t+450000. At t+300001 only the first may rotate
 * privately. A second explicit demand stays pending until the provider's
 * fresh source receipt applies; this uses the real Browser coordinator and
 * Collection load promise. The real renewal timer cannot fire within this
 * 60-second test, so recovery at this cut follows the delivered callback.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { Observation } from './cache-claim-notice.opfs'

async function observe(page: Page): Promise<Observation> {
  return page.evaluate(() => window.__cacheClaimNoticeProbe!.observe())
}

async function openProbe(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForFunction(
    () =>
      window.__cacheClaimNoticeProbe !== undefined &&
      window.__cacheClaimNoticeProbe.observe().phase !== `starting`,
  )
  const state = await observe(page)
  if (state.phase === `failed`) throw new Error(state.failure)
}

test(`a native OPFS peer notice preserves the warm cache while an expired run refetches`, async ({
  context,
}) => {
  const databaseId = `cache-claim-${crypto.randomUUID()}`
  const startAt = Date.now() + 86_400_000
  const url = (role: `expired` | `warm`, now: number) =>
    `/e2e/cache-claim-notice.opfs.html?databaseId=${databaseId}&role=${role}&now=${now}`
  const pages: Array<Page> = []
  let primaryFailure: unknown
  try {
    const expired = await context.newPage()
    pages.push(expired)
    await openProbe(expired, url(`expired`, startAt))
    await expect.poll(async () => (await observe(expired)).isLeader).toBe(true)
    await expired.evaluate(() => window.__cacheClaimNoticeProbe!.demand())
    expect((await observe(expired)).publicIds).toEqual([`old`])
    const before = await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.durable(),
    )
    const head = before.head
    expect(before.claims).toMatchObject([{ physicalId: head, ids: [`old`] }])

    const warm = await context.newPage()
    pages.push(warm)
    await openProbe(warm, url(`warm`, startAt + 150_000))
    expect((await observe(warm)).isLeader).toBe(false)
    await warm.evaluate(() => window.__cacheClaimNoticeProbe!.demand())
    expect((await observe(warm)).publicIds).toEqual([`old`])
    const shared = await warm.evaluate(() =>
      window.__cacheClaimNoticeProbe!.durable(),
    )
    expect(shared.head).toBe(head)
    expect(shared.claims).toHaveLength(2)

    await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.beginPendingDemand(),
    )
    await expect
      .poll(async () => (await observe(expired)).pendingDemand)
      .toBe(`pending`)
    await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.holdPeerNotices(),
    )
    await warm.evaluate(() => window.__cacheClaimNoticeProbe!.commitPeer())
    await expect
      .poll(async () => (await observe(expired)).heldNotices)
      .toBeGreaterThan(0)
    await expect
      .poll(async () => (await observe(warm)).publicIds)
      .toEqual([`old`, `peer`])
    const emitted = await observe(expired)
    expect(emitted.postedPeerNotices).toContain(head)
    expect(emitted.receivedPeerNotices).toContain(head)
    expect((await observe(warm)).receivedPeerNotices).toContain(head)

    await expired.evaluate(
      (now) => window.__cacheClaimNoticeProbe!.advanceClock(now),
      startAt + 300_001,
    )
    await warm.evaluate(
      (now) => window.__cacheClaimNoticeProbe!.advanceClock(now),
      startAt + 300_001,
    )
    expect((await observe(expired)).refetchEntered).toBe(false)
    expect((await observe(expired)).pendingDemand).toBe(`pending`)
    await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.releasePeerNotices(),
    )
    await expect
      .poll(async () => (await observe(expired)).refetchEntered)
      .toBe(true)
    expect((await observe(expired)).publicIds).toEqual([])
    expect((await observe(warm)).publicIds).toEqual([`old`, `peer`])
    const during = await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.durable(),
    )
    expect(during.head).toBe(head)
    expect(during.claims).toHaveLength(2)
    expect(
      during.claims.find(({ physicalId }) => physicalId === head)?.ids,
    ).toEqual([`old`, `peer`])
    const privateClaim = during.claims.find(
      ({ physicalId }) => physicalId !== head,
    )
    expect(privateClaim).toMatchObject({ ids: [] })

    await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.releaseRefetch(),
    )
    await expect
      .poll(async () => (await observe(expired)).publicIds)
      .toEqual([`fresh`])
    await expect
      .poll(async () => (await observe(expired)).pendingDemand)
      .toBe(`fulfilled`)
    expect((await observe(warm)).publicIds).toEqual([`old`, `peer`])
    const after = await expired.evaluate(() =>
      window.__cacheClaimNoticeProbe!.durable(),
    )
    expect(after.head).toBe(head)
    expect(
      after.claims.find(({ physicalId }) => physicalId === head)?.ids,
    ).toEqual([`old`, `peer`])
    expect(
      after.claims.find(({ physicalId }) => physicalId !== head)?.ids,
    ).toEqual([`fresh`])
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: Array<string> = []
  for (const page of pages.reverse()) {
    try {
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__cacheClaimNoticeProbe?.cleanup() ?? [],
        )),
      )
    } catch (error) {
      cleanupFailures.push(String(error))
    }
    try {
      await page.close()
    } catch (error) {
      cleanupFailures.push(String(error))
    }
  }
  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `The OPFS notice oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})
