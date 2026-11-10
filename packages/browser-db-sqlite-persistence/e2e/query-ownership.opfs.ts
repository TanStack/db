import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { observePersistedDirectOwnership } from '../../query-db-collection/tests/persisted-direct-ownership-driver'
import { observeImmediateEagerMaterialization } from '../../query-db-collection/tests/immediate-eager-materialization-driver'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { recordQueryHistory } from './query-ownership-browser-support'
import type { DirectOwnershipHistory } from '../../query-db-collection/tests/persisted-direct-ownership-oracle'
import type { ImmediateMaterializationHistory } from '../../query-db-collection/tests/immediate-eager-materialization-oracle'

async function runQueryPersistedDirectOwnership(
  h: DirectOwnershipHistory,
  id: string,
) {
  return recordQueryHistory(async (observe) => {
    const name = 'ps-query-direct-ownership.sqlite'
    await removeStartupOPFSArtifacts(name)
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: name,
    })
    await withOracleCleanup(async () => {
      await observePersistedDirectOwnership(
        createBrowserWASQLitePersistence({ database }),
        h,
        id,
        observe,
      )
    }, [() => database.close?.(), () => removeStartupOPFSArtifacts(name)])
    const artifacts = await startupOPFSArtifacts()
    if (artifacts.length)
      throw new Error(
        'Query ownership OPFS artifacts remain: ' + artifacts.join(', '),
      )
  })
}
async function runQueryImmediateEagerMaterialization(
  h: ImmediateMaterializationHistory,
  id: string,
) {
  return recordQueryHistory(async (observe) => {
    await observeImmediateEagerMaterialization(h, id, observe)
  })
}
Object.assign(window, {
  runQueryPersistedDirectOwnership,
  runQueryImmediateEagerMaterialization,
})
