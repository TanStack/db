import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { observeBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { registerBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle-suite'
import { powerSyncBaselineLifecycleAdapter } from './persisted-baseline-lifecycle-driver'

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
  registerBaselineLifecycle(
    {
      ...config,
      owns: [`src/powersync.ts#powerSyncCollectionOptions`],
      // Each base opens a real PowerSync database: 5 fixed bases per
      // constructed history cost about 137 s of CI time on this file. Two
      // fixed bases keep it inside its CI job (P12), and each PR run's
      // random-seed units build their bases from a fresh seed (register M,
      // 2026-11-17, "2 fixed bases for three oracles" and "Random bases at
      // today's cost for expensive oracles").
      bases: 2,
    },
    async (h, id) => {
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
    },
  )
}
