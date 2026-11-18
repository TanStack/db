/**
 * A complete Query result replaces the prior result's owned rows on reload,
 * including an empty result and omitted rows. Query may obtain that complete
 * result from its cache; this receiver makes no extra freshness promise.
 *
 * The shared eager-reload oracle supplies the independent set/value judgment,
 * generated membership and optimistic schedules, declared reach, public cuts,
 * comparison, and wrong-result controls. This file adds only the real Query
 * cache/observer receiving path. It claims no remote backend or durability.
 */
import {
  registerEagerGateFailureConformance,
  registerEagerReloadConformance,
} from '../../db-adapter-conformance/tests/eager-reload-oracle-suite'
import {
  observeQueryEagerReload,
  queryEagerGateAdapter,
  queryEagerReloadAdapter,
} from './eager-reload-driver'

registerEagerReloadConformance(
  `adapter.query.complete-result-reload`,
  queryEagerReloadAdapter,
  {
    owns: [`src/query.ts#queryCollectionOptions`],
    replacement: `snapshot-and-sweep`,
    receive: observeQueryEagerReload,
  },
)

registerEagerGateFailureConformance(
  `adapter.query.initial-gate`,
  queryEagerGateAdapter,
  {
    owns: [`src/query.ts#queryCollectionOptions`],
    entries: [`fresh`, `reload`],
  },
)
