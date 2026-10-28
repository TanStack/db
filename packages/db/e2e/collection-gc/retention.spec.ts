import { expect, test } from '@playwright/test'

// The independent expected behavior lives in collection-gc-retention-oracle.ts.
// These tests supply native host delivery to its checker, not a second model.
for (const scenario of [`idle`, `startup`, `pending`] as const) {
  test(`receives ${scenario} retention through native idle callbacks`, async ({
    page,
  }) => {
    await page.goto(`/e2e/collection-gc/browser.html`)
    await page.waitForFunction(() => Boolean(window.gcReceiver))
    await page.clock.install({ time: new Date(0) })
    await page.clock.pauseAt(new Date(1000))
    const pageErrors: Array<string> = []
    page.on(`pageerror`, (error) => pageErrors.push(error.message))
    let checkFailure: unknown
    try {
      await page.evaluate((kind) => window.gcReceiver.start(kind), scenario)
      if (scenario === `pending`) {
        await page.clock.runFor(90)
        await page.evaluate(() => window.gcReceiver.rollback())
        await page.clock.runFor(20)
      } else await page.clock.runFor(scenario === `idle` ? 101 : 10)
      const reach = await page.evaluate(() => window.gcReceiver.finish())
      if (scenario === `idle`) expect(reach.requested).toBeGreaterThan(0)
      expect(pageErrors).toEqual([])
      await test.info().attach(`native-idle-reach`, {
        body: JSON.stringify({ scenario, ...reach }),
        contentType: `application/json`,
      })
    } catch (error) {
      checkFailure = error
    }
    try {
      await page.evaluate(() => window.gcReceiver.cleanup())
    } catch (error) {
      if (checkFailure)
        throw new AggregateError(
          [checkFailure, error],
          `Receiver check and cleanup failed`,
          { cause: checkFailure },
        )
      throw error
    }
    if (checkFailure) throw checkFailure
  })
}
