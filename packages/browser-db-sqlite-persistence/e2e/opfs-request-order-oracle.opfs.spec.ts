/**
 * Chromium checkpoint for the OPFS request-order oracle. The page runs every
 * fixed example in `tests/opfs-request-order-oracle.ts` against real OPFS and
 * publishes each history's observation and violation. A failure before the
 * checkpoint stays distinct from a law violation.
 */
import { expect, test } from '@playwright/test'
import { requestOrderExamples } from '../tests/opfs-request-order-oracle'
import type { OPFSRequestOrderResult } from './opfs-request-order.opfs'

test(`real Chromium OPFS connection answers requests in order and closes after them`, async ({
  page,
}) => {
  test.setTimeout(120_000)
  const pageErrors: Array<string> = []
  page.on(`pageerror`, (error) => pageErrors.push(error.message))
  await page.goto(`/e2e/opfs-request-order.opfs.html`)
  await page.waitForFunction(
    () => window.__tanstackOPFSRequestOrderOracle !== undefined,
    undefined,
    { timeout: 110_000 },
  )
  const result: OPFSRequestOrderResult = await page.evaluate(
    () => window.__tanstackOPFSRequestOrderOracle!,
  )
  expect(pageErrors).toEqual([])
  expect(result.status).toBe(`complete`)
  if (result.status !== `complete`) return
  expect(result.results).toHaveLength(requestOrderExamples.length)
  expect(
    result.results
      .filter(({ violation }) => violation !== undefined)
      .map(({ history, violation }) => ({ history, violation })),
  ).toEqual([])
})
