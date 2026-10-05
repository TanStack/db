/**
 * The coordinator's remote-subset contract keeps live signal/subscription
 * references local and transports clone-safe request data. This fixed history
 * starts one OPFS tab, then opens a follower on the same database and requests
 * one ID through a filtered live-query Collection. The independent expected
 * result is exactly that ID and its fixture label. After follower preload, we
 * check the public row, the remote route, and the absence of clone failures.
 * The finite warning window catches the reported 50 ms retry flood, not
 * arbitrary future failures.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RemoteSubsetObservation } from './remote-subset-two-tab.opfs'

async function observe(page: Page): Promise<RemoteSubsetObservation> {
  await page.waitForFunction(
    () =>
      window.__remoteSubsetProbe !== undefined &&
      window.__remoteSubsetProbe.observe().phase !== `starting`,
  )
  return page.evaluate(() => window.__remoteSubsetProbe!.observe())
}

test(`two real OPFS tabs transport a filtered subset without a clone retry`, async ({
  context,
}) => {
  const databaseId = `rs-${crypto.randomUUID()}`
  const itemId = `abc-123`
  const url = `/e2e/remote-subset-two-tab.opfs.html?databaseId=${databaseId}&itemId=${itemId}`
  const warnings: Array<string> = []
  const pages: Array<Page> = []
  let primaryFailure: unknown

  try {
    const leader = await context.newPage()
    pages.push(leader)
    await leader.goto(url)
    const first = await observe(leader)
    if (first.phase === `failed`) throw new Error(first.failure)
    expect(first.isLeader).toBe(true)
    expect(first.upstreamLoads).toBeGreaterThan(0)
    expect(first.rows).toHaveLength(1)
    expect(first.rows[0]).toMatchObject({ id: itemId, label: `Item ${itemId}` })

    const follower = await context.newPage()
    pages.push(follower)
    follower.on(`console`, (message) => {
      if (message.text().includes(`Failed to ensure remote subset`)) {
        warnings.push(message.text())
      }
    })
    await follower.goto(url)
    const second = await observe(follower)
    if (second.phase === `failed`) {
      throw new Error(
        `${second.failure}; wire post failures: ${JSON.stringify(second.remoteSubsetPostFailures)}`,
      )
    }
    expect(second.isLeader).toBe(false)
    expect(second.upstreamLoads).toBe(0)
    expect(second.ensureRequests).toContainEqual({
      hasWhere: true,
      hasSignal: true,
      hasSubscriptionCallback: true,
    })
    expect(second.remoteSubsetPosts).toBeGreaterThan(0)
    expect(second.remoteSubsetPostFailures).toEqual([])
    expect(second.rows).toHaveLength(1)
    expect(second.rows[0]).toMatchObject({
      id: itemId,
      label: `Item ${itemId}`,
    })

    const invalid = await follower.evaluate(() =>
      window.__remoteSubsetProbe!.tryInvalidWire(),
    )
    expect(invalid).toMatchObject({
      name: `RemoteSubsetWireValueError`,
      path: `options.where.value.nested`,
    })
    expect(invalid.postsAfter).toBe(invalid.postsBefore)
    expect((await observe(follower)).rows).toHaveLength(1)

    await follower.waitForTimeout(300)
    expect(warnings).toEqual([])
  } catch (error) {
    primaryFailure = error
  }

  const cleanupFailures: Array<string> = []
  for (const page of pages.reverse()) {
    try {
      cleanupFailures.push(
        ...(await page.evaluate(
          () => window.__remoteSubsetProbe?.cleanup() ?? [],
        )),
      )
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error.message : String(error),
      )
    }
    try {
      await page.close()
    } catch (error) {
      cleanupFailures.push(
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  if (primaryFailure && cleanupFailures.length > 0) {
    throw new AggregateError(
      cleanupFailures.map((message) => new Error(message)),
      `The remote-subset oracle and cleanup both failed`,
      { cause: primaryFailure },
    )
  }
  if (primaryFailure) throw primaryFailure
  expect(cleanupFailures).toEqual([])
})
