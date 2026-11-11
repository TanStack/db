/** Actual worker/OPFS storage receives the same lifecycle histories/check. */
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { observeBaselineLifecycle } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-driver'
import { rxdbBaselineLifecycleAdapter } from '../../rxdb-db-collection/tests/persisted-baseline-lifecycle-driver'
import { powerSyncBrowserBaselineLifecycleAdapter } from '../../powersync-db-collection/tests/persisted-baseline-lifecycle-browser'
import { inProcessSeams } from '../../db-sqlite-persistence-core/tests/reload-class-oracle'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { BaselineLifecycleHistory } from '../../db-adapter-conformance/tests/persisted-baseline-lifecycle-oracle'

async function runBaselineLifecycle(
  adapter: `rxdb` | `powersync`,
  history: BaselineLifecycleHistory,
  id: string,
  candidate: boolean,
) {
  const databaseName = `ps-baseline-lifecycle.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  return withOracleCleanup(
    () =>
      observeBaselineLifecycle(
        adapter === `rxdb`
          ? rxdbBaselineLifecycleAdapter
          : powerSyncBrowserBaselineLifecycleAdapter,
        createBrowserWASQLitePersistence({ database }),
        inProcessSeams.holdFirstRowSnapshot,
        history,
        id,
        candidate,
      ),
    [
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`${adapter}.opfs ${cut}`, value),
        ),
    ],
  )
}
Object.assign(window, { runBaselineLifecycle })
