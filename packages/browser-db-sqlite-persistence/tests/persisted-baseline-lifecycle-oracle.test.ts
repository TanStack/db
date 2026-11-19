// @vitest-environment node
import { resolve } from 'node:path'
import { afterAll, beforeAll } from 'vitest'
import { baselineCandidatePlugins } from '../../db-adapter-conformance/tests/persisted-baseline-candidate-plugins'
import { registerBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle-suite'
import {
  captureBrowserHistory,
  startAdapterChromium,
} from './adapter-chromium-host'
import type { BaselineLifecycleObservation } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle'

let host: Awaited<ReturnType<typeof startAdapterChromium>> | undefined
beforeAll(async () => {
  host = await startAdapterChromium({
    entry: `/packages/browser-db-sqlite-persistence/e2e/persisted-baseline-lifecycle.html`,
    ready: `runBaselineLifecycle`,
    plugins: baselineCandidatePlugins(resolve(import.meta.dirname, `../../..`)),
  })
}, 120_000)
afterAll(async () => {
  await host?.close()
})
for (const { adapter, config } of [
  {
    adapter: `rxdb`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.rxdb.chromium-opfs`,
      defaultRuns: 24,
      streamFailure: true,
    },
  },
  {
    adapter: `powersync`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.powersync.chromium-opfs`,
      defaultRuns: 24,
      streamFailure: false,
    },
  },
] as const) {
  registerBaselineLifecycle(config, (history, id) =>
    captureBrowserHistory(host!, () =>
      host!.page.evaluate(
        async ({ adapter: name, history: h, id: key, candidate }) => {
          const receive = (
            window as unknown as {
              runBaselineLifecycle: (
                adapter: typeof name,
                history: typeof h,
                id: string,
                candidate: boolean,
              ) => Promise<BaselineLifecycleObservation>
            }
          ).runBaselineLifecycle
          return receive(name, h, key, candidate)
        },
        {
          adapter,
          history,
          id,
          candidate: process.env.TANSTACK_DB_BASELINE_EXPECT_HYDRATE !== `0`,
        },
      ),
    ),
  )
}
