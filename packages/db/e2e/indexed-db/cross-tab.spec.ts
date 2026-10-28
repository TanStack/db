// Ordinary native cross-tab scenarios. cross-tab-oracle.spec.ts owns the
// browser-side history and publication laws; these two tests compare with
// literal observations, and one is a harness self-test of the primary-mismatch
// cleanup. Their helpers are in cross-tab-support.ts.
import { expect, test } from '@playwright/test'
import { OracleMismatch } from '../../tests/indexed-db/cross-tab-oracle'
import { observe, open, withPages } from './cross-tab-support'

test('cleanup retains a primary mismatch and closes every page after an injected cleanup failure', async ({
  context,
}) => {
  const primary = new OracleMismatch(
    'calibration',
    'before cleanup',
    'expected',
    'wrong',
  )
  await expect(
    withPages(context, async (_events, database) => {
      await open(context, database, 'first', false, '&cleanupFailure=1')
      await open(context, database, 'second')
      throw primary
    }),
  ).rejects.toMatchObject({ cause: primary })
  expect(context.pages()).toHaveLength(0)
})

// fake-indexeddb cannot provide this witness: its deletion queue treats a
// close-pending connection as closed. Real engines must wait for BOTH native
// transaction completion and the unmanaged connection, in either release order.
for (const transactionFirst of [false, true])
  test(`native deletion waits for both obligations, transaction first ${transactionFirst}`, async ({
    context,
  }) => {
    await withPages(context, async (_events, database) => {
      const a = await open(context, database, 'owner')
      const b = await open(context, database, 'administrator')
      await a.evaluate(() => window.crossTab!.openBlocker())
      await a.evaluate(() => window.crossTab!.holdStorage())
      await b.evaluate(() => window.crossTab!.startSchema('delete'))
      await a.waitForFunction(
        () => window.crossTab!.observe().versionChanges === 1,
      )
      expect((await observe(a)).status).toBe('crashed')
      if (transactionFirst) {
        await a.evaluate(() => window.crossTab!.releaseBarrier())
        expect((await observe(a)).writes.at(-1)).toBe('complete')
        expect((await observe(b)).schema.status).toBe('pending')
        await a.evaluate(() => window.crossTab!.closeBlocker())
      } else {
        await a.evaluate(() => window.crossTab!.closeBlocker())
        await b.evaluate(
          () =>
            new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve()),
            ),
        )
        expect((await observe(a)).writes.at(-1)).toBe('pending')
        expect((await observe(b)).schema.status).toBe('pending')
        await a.evaluate(() => window.crossTab!.releaseBarrier())
      }
      await b.waitForFunction(
        () => window.crossTab!.observe().schema.status === 'complete',
      )
      expect((await observe(a)).status).toBe('crashed')
    })
  })
