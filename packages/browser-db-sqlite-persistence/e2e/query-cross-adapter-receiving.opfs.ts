/** Real Chromium QueryObserver and OPFS receive the unchanged shared judgments. */
import { observeEagerGateFailure } from '../../db-adapter-conformance/tests/eager-reload-driver'
import {
  observeQueryEagerReload,
  queryEagerGateAdapter,
} from '../../query-db-collection/tests/eager-reload-driver'
import { recordFailingQueries } from '../../query-db-collection/tests/failing-queries-driver'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  createBrowserWASQLitePersistence,
  openBrowserWASQLiteOPFSDatabase,
} from '../src'
import { recordQueryHistory } from './query-ownership-browser-support'
import { removeStartupOPFSArtifacts } from './persisted-startup-opfs-cleanup'
import type {
  EagerGateHistory,
  EagerReloadHistory,
} from '../../db-adapter-conformance/tests/eager-reload-oracle'
import type { FailingQueryHistory } from '../../query-db-collection/tests/failing-queries-oracle'

let sequence = 0
const runQueryCompleteReload = (
  history: EagerReloadHistory,
  id: string,
  omitReplacement: boolean,
) => observeQueryEagerReload(history, id, omitReplacement)

const runQuerySelectFailures = (history: FailingQueryHistory) =>
  recordQueryHistory(async (observe) => {
    if (!history.persisted) return recordFailingQueries(history, observe)
    const databaseName = `query-select-${sequence++}.sqlite`
    await removeStartupOPFSArtifacts(databaseName)
    const database = await openBrowserWASQLiteOPFSDatabase({ databaseName })
    await withOracleCleanup(
      () =>
        recordFailingQueries(
          history,
          observe,
          createBrowserWASQLitePersistence({ database }),
        ),
      [
        () => database.close?.(),
        () => removeStartupOPFSArtifacts(databaseName),
      ],
    )
  })

const runQueryInitialGate = (history: EagerGateHistory, id: string) =>
  observeEagerGateFailure(queryEagerGateAdapter, history, id)

Object.assign(window, {
  runQueryCompleteReload,
  runQuerySelectFailures,
  runQueryInitialGate,
})
