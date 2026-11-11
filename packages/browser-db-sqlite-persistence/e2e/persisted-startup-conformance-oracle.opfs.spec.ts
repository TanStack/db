import { expect, test } from '@playwright/test'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { queryStartupHistories } from '../../query-db-collection/tests/persisted-startup-driver'
import {
  persistedStartupBatchHistories,
  persistedStartupHistories,
  persistedStartupSingleCommitHistories,
} from '../../db-adapter-conformance/tests/persisted-startup-oracle'
import { capabilityHistories } from '../../db-adapter-conformance/tests/persisted-capability-oracle'
import type { StartupConformanceResult } from './persisted-startup-conformance.opfs'

// The page compares each cut with the shared model. Count each adapter's
// completion separately so a missing receiver cannot masquerade as conformance.
function checkStartupConformance(result: StartupConformanceResult) {
  expect(result.error).toBeUndefined()
  expect(
    result.results.filter((item) => item.adapter === `query`),
  ).toHaveLength(queryStartupHistories.length)
  for (const adapter of [`convex`, `electric`, `trailbase`])
    expect(
      result.results.filter((item) => item.adapter === adapter),
    ).toHaveLength(persistedStartupHistories.length)
  expect(
    result.results.filter((item) => item.adapter === `powersync`),
  ).toHaveLength(persistedStartupBatchHistories.length)
  expect(result.results.filter((item) => item.adapter === `rxdb`)).toHaveLength(
    persistedStartupSingleCommitHistories.length,
  )
  for (const name of [`rxdb`, `powersync`])
    expect(
      result.capabilities.filter((item) => item.adapter === name),
    ).toHaveLength(capabilityHistories.length)
  expect(result.capabilities.flatMap(({ violations }) => violations)).toEqual(
    [],
  )
  expect(result.artifacts).toEqual([])
  expect(result.results.flatMap(({ violations }) => violations)).toEqual([])
}
declareOracle({ check: [checkStartupConformance] })
test(`complete source results replace persisted rows across OPFS startup`, async ({
  page,
}) => {
  test.setTimeout(600_000)
  let busyResponses = 0
  page.on(`console`, (message) => {
    console.info(`browser ${message.type()}: ${message.text()}`)
    if (message.text() === `startup fixture busy response injected`)
      busyResponses++
  })
  const errors: Array<string> = []
  page.on(`pageerror`, (error) => errors.push(error.message))
  // Native worker termination can release an OPFS handle after close returns.
  // Inject that exact cleanup condition once, after the first database closes.
  // Both profile runs must still complete the same shared row/durability checks.
  await page.addInitScript(() => {
    const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry
    let firstFileRemovals = 0
    FileSystemDirectoryHandle.prototype.removeEntry = function (name, options) {
      if (name === `ps-0.sqlite` && ++firstFileRemovals === 2) {
        FileSystemDirectoryHandle.prototype.removeEntry = removeEntry
        console.info(`startup fixture busy response injected`)
        return Promise.reject(
          new DOMException(
            `fixture handle release pending`,
            `NoModificationAllowedError`,
          ),
        )
      }
      return removeEntry.call(this, name, options)
    }
  })
  await page.goto(`/e2e/persisted-startup-conformance.opfs.html`)
  await page.waitForFunction(
    () => window.__persistedStartupConformance !== undefined,
  )
  const result = await page.evaluate(
    () => window.__persistedStartupConformance!,
  )
  expect(busyResponses).toBe(1)
  expect(errors).toEqual([])
  checkStartupConformance(result)
  // Reuse the same origin and file names. Successful cleanup must keep the
  // next run independent, rather than relying on a fresh browser profile.
  await page.reload()
  await page.waitForFunction(
    () => window.__persistedStartupConformance !== undefined,
  )
  checkStartupConformance(
    await page.evaluate(() => window.__persistedStartupConformance!),
  )
  expect(busyResponses).toBe(2)
})
