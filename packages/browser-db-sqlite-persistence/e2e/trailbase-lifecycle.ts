/** Real OPFS receiver; the Vitest registration owns the shared judgment. */
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { observeHydrationLifecycle } from '../../trailbase-db-collection/tests/lifecycle-hydration-driver'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { runTrailBaseEager } from './trailbase-eager'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { HydrationLifecycleHistory } from '../../trailbase-db-collection/tests/lifecycle-hydration-oracle'

export async function runTrailBaseHydration(
  history: HydrationLifecycleHistory,
  id: string,
) {
  const databaseName = `ps-trailbase-converted.sqlite`
  await removeStartupOPFSArtifacts(databaseName)
  const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
  const observation = await withOracleCleanup(
    () =>
      observeHydrationLifecycle(
        createBrowserWASQLitePersistence({ database }),
        history,
        id,
      ),
    [
      () => database.close?.(),
      () =>
        removeClosedArtifacts(
          () => removeStartupOPFSArtifacts(databaseName),
          (cut, value) => console.info(`trailbase.opfs ${cut}`, value),
        ),
    ],
  )
  const artifacts = await startupOPFSArtifacts()
  if (artifacts.length)
    throw new Error(`OPFS artifacts remain: ${artifacts.join(`, `)}`)
  return observation
}

Object.assign(window, { runTrailBaseHydration, runTrailBaseEager })
