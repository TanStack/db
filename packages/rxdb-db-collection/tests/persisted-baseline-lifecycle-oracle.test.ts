import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observeBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { registerBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle-suite'
import { rxdbBaselineLifecycleAdapter } from './persisted-baseline-lifecycle-driver'

for (const { host, config } of [
  {
    host: `controlled`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.rxdb.controlled`,
      defaultRuns: 24,
      streamFailure: true,
    },
  },
  {
    host: `node-sqlite`,
    config: {
      property: `adapter-conformance.persisted-baseline-lifecycle.rxdb.node-sqlite`,
      defaultRuns: 24,
      streamFailure: true,
    },
  },
] as const) {
  registerBaselineLifecycle(
    { ...config, owns: [`src/rxdb.ts#rxdbCollectionOptions`] },
    async (h, id) => {
      const storage = createStartupHost(host)
      return withOracleCleanup(
        () =>
          observeBaselineLifecycle(
            rxdbBaselineLifecycleAdapter,
            storage.persistence,
            storage.holdBaseline,
            h,
            id,
            process.env.TANSTACK_DB_BASELINE_EXPECT_HYDRATE !== `0`,
          ),
        [() => storage.close()],
      )
    },
  )
}
