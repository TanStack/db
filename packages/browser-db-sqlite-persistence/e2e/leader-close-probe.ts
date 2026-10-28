import type { Page } from '@playwright/test'

// The browser probe that the leader-close checkpoints and their scenario tests share.
// It stages tabs, reads each tab's observation, and reports when a tab is ready.
export type ProbeObservation = {
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

export async function observe(page: Page): Promise<ProbeObservation> {
  return page.evaluate(() => window.__leaderCloseProbe!.observe())
}

export async function openProbe(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForFunction(
    () =>
      window.__leaderCloseProbe !== undefined &&
      window.__leaderCloseProbe.observe().phase !== `starting`,
  )
  const state = await observe(page)
  if (state.phase === `failed`) throw new Error(state.failure)
}
