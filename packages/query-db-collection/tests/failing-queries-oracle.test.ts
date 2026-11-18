/**
 * While any observed Query fails, the node's `failureReason` lists the
 * failures of the Queries still failing, oldest first, and shows the newest.
 * Each failing Query keeps one failure listed: its latest error. A Query
 * that fails again with a new error replaces its listed failure, so a Query
 * failing on every refetch for hours lists one failure, not one per fetch
 * (review ledger R21: one entry per failing Query, enforced in Query
 * Collection). A Query that recovers while another still fails removes its
 * own failure, so the other Queries' failures keep their places, their `at`,
 * and their causes. When the last failing Query recovers, the slot clears.
 *
 * Core lists one failure per error value (the adapter API's maintainer
 * decision: `reportError` of a value already listed changes nothing, and
 * `reportHealthy(error)` removes the failure whose cause is that value). So
 * Queries that fail with the same value, such as a module-level
 * `throw OFFLINE`, share one listed failure, and it stays while any of them
 * still fails (review ledger R22).
 *
 * The glossary's health tree entry adds identity: the tree keeps stable
 * object identity while its content is unchanged, and `health:change`
 * announces a change (ARCHITECTURE law 17 makes the tree an observation).
 *
 * Limits: one Collection, two subsets, histories of four fetches; a
 * recovery whose result applies late is an ordinary example in query.test.ts.
 */
import { oracleProperty } from '../../db/tests/oracle-property'
import { createStartupHost } from '../../db-adapter-conformance/tests/persisted-startup-host'
import { withOracleCleanup } from '../../db/tests/oracle-cleanup'
import {
  checkFailingQueries,
  failingQueryHistories,
  failingQueryReach,
  failingQueryStates,
  modelFailingQueries,
} from './failing-queries-oracle'
import { recordFailingQueries } from './failing-queries-driver'
import { registerQuerySelectFailures } from './select-failures-oracle-suite'

oracleProperty({
  id: `query-db.failing-queries`,
  law: {
    statement: `While any observed Query fails, failureReason lists the latest error value of each still-failing Query once per value, oldest first, shows the newest, keeps a kept failure's at, and keeps the health tree's identity and announcements in step with its content.`,
    authority: `Review ledger R21 and R22; the adapter API's maintainer decision on reportError and reportHealthy; the glossary's health tree entry; ARCHITECTURE law 17.`,
    limits: `One Collection, two subsets, every history of four fetches, on Query Collection and behind the persisted wrapper. A recovery whose result applies late is an ordinary example in query.test.ts.`,
  },
  owns: [`src/query.ts#queryCollectionOptions`],
  histories: {
    enumerated: failingQueryHistories(),
    states: failingQueryStates,
  },
  label: ({ persisted, fetches }) =>
    `${persisted ? `persisted` : `plain`} ${fetches
      .map(({ subset, fails }) => `${subset}:${fails || `ok`}`)
      .join(` `)}`,
  model: modelFailingQueries,
  reached: ({ fetches }) => failingQueryReach(fetches),
  driver: recordFailingQueries,
  check: checkFailingQueries,
})

registerQuerySelectFailures(`query-db.select-failures`, {
  owns: [`src/query.ts#queryCollectionOptions`],
})

registerQuerySelectFailures(`query-db.select-failures.node-sqlite`, {
  owns: [`src/query.ts#queryCollectionOptions`],
  receive: async (history, observe) => {
    if (!history.persisted) return recordFailingQueries(history, observe)
    const host = createStartupHost(`node-sqlite`)
    return withOracleCleanup(
      () => recordFailingQueries(history, observe, host.persistence),
      [host.close],
    )
  },
})
