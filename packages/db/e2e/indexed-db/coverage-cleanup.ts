// Shared by the value and native receiving specs: the cleanup wrapper that
// closes each page's coverage evidence without replacing the primary failure.
import type { Page } from '@playwright/test'

// Cleanup cannot replace a value/readiness mismatch or silently pass on its
// own failure. Browser contexts own page closure after this helper completes.
export async function withCoverage(
  pages: Array<Page>,
  run: () => Promise<void>,
) {
  let primary: unknown
  let failed = false
  try {
    await run()
  } catch (error) {
    primary = error
    failed = true
  }
  const results = await Promise.allSettled(
    pages.map((page) => page.evaluate(() => window.coverage.cleanup())),
  )
  const errors = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  )
  if (errors.length)
    throw new AggregateError(
      failed ? [primary, ...errors] : errors,
      'Native oracle cleanup failed',
      { cause: failed ? primary : errors[0] },
    )
  if (failed) throw primary
}
