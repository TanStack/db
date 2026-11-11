import { declareOracle } from '../../db/tests/oracle-declaration'
import { baselineLifecycleViolations } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observeBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { registerBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle-suite'
import { powerSyncBaselineLifecycleAdapter } from './persisted-baseline-lifecycle-driver'

declareOracle({
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  check: [baselineLifecycleViolations],
})

for (const { host, config } of [
  {
    host: `controlled`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.powersync.controlled`,
      defaultRuns: 24,
      streamFailure: false,
    },
  },
  {
    host: `node-sqlite`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.powersync.node-sqlite`,
      defaultRuns: 24,
      streamFailure: false,
    },
  },
] as const) {
  registerBaselineLifecycle(config, async (h, id) => {
    const storage = createStartupHost(host)
    return withOracleCleanup(
      () =>
        observeBaselineLifecycle(
          powerSyncBaselineLifecycleAdapter,
          storage.persistence,
          storage.holdBaseline,
          h,
          id,
          process.env.TANSTACK_DB_BASELINE_EXPECT_HYDRATE !== `0`,
        ),
      [() => storage.close()],
    )
  })
}
