import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import { observeScope } from '../../query-db-collection/tests/scope-omission-reacquisition-oracle'
import { recordQueryHistory } from './query-ownership-browser-support'
import {
  removeStartupOPFSArtifacts,
  startupOPFSArtifacts,
} from './persisted-startup-opfs-cleanup'
import { removeClosedArtifacts } from './query-rejected-write-cutoff-cleanup'
import type { History } from '../../query-db-collection/tests/scope-omission-reacquisition-oracle'

async function runScopeOmission(h: History, id: string) {
  return recordQueryHistory(async (observe) => {
    const name = 'ps-query-scope-omission.sqlite'
    await removeStartupOPFSArtifacts(name)
    const database = await openBrowserWASQLiteOPFSDatabase({
      databaseName: name,
    })
    await withOracleCleanup(
      () =>
        observeScope(
          createBrowserWASQLitePersistence({ database }),
          h,
          id,
          observe,
        ),
      [
        () => database.close?.(),
        () =>
          removeClosedArtifacts(
            () => removeStartupOPFSArtifacts(name),
            observe,
          ),
      ],
    )
    const artifacts = await startupOPFSArtifacts()
    if (artifacts.length)
      throw new Error('Scope OPFS artifacts remain: ' + artifacts.join(','))
  })
}
Object.assign(window, { runScopeOmission })
