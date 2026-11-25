// @vitest-environment node
/** Cleanup calibration only. Product results retain their shared oracle checks. */
import { expect, it } from 'vitest'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { directOwnershipHistories } from '../../query-db-collection/tests/persisted-direct-ownership-oracle'
import { baselineLifecycleHistories } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle'
import { startAdapterChromium } from './adapter-chromium-host'

const receivers = [
  {
    name: `TrailBase hydration`,
    entry: `trailbase-lifecycle.html`,
    ready: `runTrailBaseHydration`,
    databaseName: `ps-trailbase-converted.sqlite`,
    args: [
      {
        previous: 3,
        old: 0,
        replacement: 6,
        oldList: `reject`,
        resumeAt: `replacement-ready`,
        initialRender: `default`,
      },
      `cleanup-calibration`,
    ],
  },
  {
    name: `Query ownership`,
    entry: `query-ownership.opfs.html`,
    ready: `runQueryPersistedDirectOwnership`,
    databaseName: `ps-query-direct-ownership.sqlite`,
    args: [directOwnershipHistories[0]!, `cleanup-calibration`],
  },
  ...([`rxdb`, `powersync`] as const).map((adapter) => ({
    name: `${adapter} baseline lifecycle`,
    entry: `persisted-baseline-lifecycle.html`,
    ready: `runBaselineLifecycle`,
    databaseName: `ps-baseline-lifecycle.sqlite`,
    args: [
      adapter,
      baselineLifecycleHistories[0]!,
      `cleanup-calibration`,
      false,
    ],
  })),
]

it.each(receivers)(
  `retries a transient post-close busy handle in $name`,
  async ({ entry, ready, databaseName, args }) => {
    const host = await startAdapterChromium({
      entry: `/packages/browser-db-sqlite-persistence/e2e/${entry}`,
      ready,
    })
    await withOracleCleanup(async () => {
      const result = await host.page.evaluate(
        async ({ ready: method, databaseName: file, args: input }) => {
          const removeEntry = FileSystemDirectoryHandle.prototype.removeEntry
          let removals = 0
          let injected = 0
          FileSystemDirectoryHandle.prototype.removeEntry = function (
            name,
            options,
          ) {
            if (name === file && ++removals === 2) {
              injected++
              return Promise.reject(
                new DOMException(
                  `fixture handle release pending`,
                  `NoModificationAllowedError`,
                ),
              )
            }
            return removeEntry.call(this, name, options)
          }
          try {
            const receive = (
              window as unknown as Record<
                string,
                (...values: Array<unknown>) => Promise<unknown>
              >
            )[method]!
            const first = await receive(...input)
            const second = await receive(...input)
            return { injected, first, second }
          } finally {
            FileSystemDirectoryHandle.prototype.removeEntry = removeEntry
          }
        },
        { ready, databaseName, args },
      )
      expect(result.injected).toBe(1)
      expect(result.first).not.toHaveProperty(`failure`)
      expect(result.second).not.toHaveProperty(`failure`)
      expect(host.errors).toEqual([])
    }, [() => host.close()])
  },
  120_000,
)

it.each([`completed`, `record`, `startup`] as const)(
  `preserves the %s history result when context teardown fails`,
  async (phase) => {
    const host = await startAdapterChromium({
      entry: `/packages/browser-db-sqlite-persistence/e2e/native-powersync-receiving.opfs.html`,
      ready: `runNativePowerSyncBatchDecode`,
    })
    const browser = host.page.context().browser()!
    const newContext = browser.newContext.bind(browser)
    const primary = new Error(`injected ${phase} failure`)
    const cleanup = new Error(`injected context close failure`)
    let closed = 0
    browser.newContext = async (options) => {
      const context = await newContext(options)
      const close = context.close.bind(context)
      if (phase === `startup`) {
        const newPage = context.newPage.bind(context)
        context.newPage = async () => {
          const page = await newPage()
          page.goto = () => Promise.reject(primary)
          return page
        }
      }
      context.close = async () => {
        if (phase === `completed`) {
          const page = context.pages()[0]!
          const event = page.waitForEvent(`pageerror`)
          await page.evaluate(() => {
            setTimeout(() => {
              throw new Error(`context teardown page error`)
            }, 0)
          })
          await event
        }
        await close()
        closed++
        throw cleanup
      }
      return context
    }
    await withOracleCleanup(async () => {
      const operation = () =>
        host.captureFreshHistory(() =>
          phase === `record`
            ? Promise.reject(primary)
            : Promise.resolve({
                marker: `completed mismatch`,
                cleanupErrors: [],
              }),
        )
      if (phase === `completed`) {
        const result = await operation()
        expect(result.marker).toBe(`completed mismatch`)
        expect(result.cleanupErrors.join(` `)).toContain(cleanup.message)
        expect(result.browserErrors).toContain(`context teardown page error`)
      } else {
        let failure: unknown
        try {
          await operation()
        } catch (error) {
          failure = error
        }
        expect(failure).toBeInstanceOf(AggregateError)
        expect((failure as AggregateError).cause).toBe(primary)
        expect((failure as AggregateError).errors).toEqual([primary, cleanup])
      }
      expect(closed).toBe(1)
    }, [
      () => {
        browser.newContext = newContext
      },
      () => host.close(),
    ])
  },
  120_000,
)
