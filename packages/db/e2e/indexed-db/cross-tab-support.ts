// Shared by the cross-tab native oracle spec and cross-tab.spec.ts: the page
// open, observation, cleanup, and evidence wrapper that every native cross-tab
// scenario uses. The laws they serve are stated in cross-tab-oracle.spec.ts.
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import type { BrowserEvidence } from './browser'

export async function open(
  context: BrowserContext,
  database: string,
  tab: string,
  split = false,
  options = '',
) {
  const page = await context.newPage()
  await page.goto(
    `/e2e/indexed-db/browser.html?database=${database}&tab=${tab}&fault=${split ? 'split' : 'none'}${options}`,
  )
  await installed(page)
  if (!options.includes('hold=startup'))
    await page.evaluate(() => window.crossTab!.ready())
  return page
}
export async function installed(page: Page) {
  await page.waitForFunction(
    () => window.crossTab !== undefined || window.crossTabFailure !== undefined,
  )
  const failure = await page.evaluate(() => window.crossTabFailure)
  if (failure) throw new Error(failure)
}
export async function awaitRestore(page: Page) {
  await installed(page)
  await page.evaluate(() => window.crossTab!.ready())
}
export const observe = (page: Page) =>
  page.evaluate(() => window.crossTab!.observe())

export async function closePages(context: BrowserContext) {
  const failures: Array<unknown> = []
  for (const page of context.pages()) {
    for (const action of [
      () => page.evaluate(() => window.crossTab?.flushEvidence()),
      () => page.evaluate(() => window.crossTab?.cleanup()),
      () => page.evaluate(() => window.crossTab?.flushEvidence()),
      () => page.close(),
    ]) {
      try {
        await action()
      } catch (error) {
        failures.push(error)
      }
    }
  }
  return failures
}

export async function withPages(
  context: BrowserContext,
  run: (events: Array<BrowserEvidence>, database: string) => Promise<void>,
) {
  const events: Array<BrowserEvidence> = []
  const errors: Array<string> = []
  await context.exposeBinding(
    'retainOracleEvent',
    (_source, event: BrowserEvidence) => {
      events.push(event)
    },
  )
  context.on('page', (page) =>
    page.on('pageerror', (error) => errors.push(String(error))),
  )
  let primary: unknown
  try {
    await run(events, `oracle-${crypto.randomUUID()}`)
  } catch (error) {
    primary = error
  }
  const cleanup = await closePages(context)
  await test.info().attach('native-evidence', {
    body: JSON.stringify({
      engine: test.info().project.name,
      browserVersion: context.browser()!.version(),
      events,
      errors,
      primary: String(primary ?? ''),
      cleanup: cleanup.map(String),
    }),
    contentType: 'application/json',
  })
  if (primary !== undefined) {
    if (cleanup.length)
      throw new AggregateError(cleanup, 'Native oracle and cleanup failed', {
        cause: primary,
      })
    throw primary
  }
  expect(errors, 'unexpected page errors').toEqual([])
  expect(cleanup, 'cleanup failures').toEqual([])
}
