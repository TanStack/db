/** Real RxDB/PowerSync receiving paths for the finite capability grammar. */
import { afterAll, describe, expect, it } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleRoute } from '../../db/tests/oracle-config'
import { rxdbStartupAdapter } from '../../rxdb-db-collection/tests/persisted-startup-driver'
import { powerSyncStartupAdapter } from '../../powersync-db-collection/tests/persisted-startup-driver'
import { createStartupHost } from './persisted-startup-host'
import {
  capabilityHistories,
  capabilityViolations,
  observeCapability,
} from './persisted-capability-oracle'

declareOracle({ check: [capabilityViolations], grammar: [capabilityHistories] })
for (const [name, adapter] of [
  [`rxdb`, rxdbStartupAdapter],
  [`powersync`, powerSyncStartupAdapter],
] as const)
  for (const host of [`controlled`, `node-sqlite`] as const)
    describe(`${name} capability through ${host}`, () => {
      const reach = createOracleReach(`${name}.capability.${host}`, [
        ...new Set(capabilityHistories.map((h) => h.kind)),
      ])
      afterAll(() => reach.assertReached())
      it.each(capabilityHistories)(
        `validates persistence protocol: %j`,
        async (h) => {
          oracleRoute(`fixed history`)
          reach.beginHistory()
          const storage = createStartupHost(host)
          try {
            const error = await observeCapability(
              adapter,
              storage.persistence,
              h,
              `${name}-${host}-${JSON.stringify(h)}`,
            )
            reach.reach(h.kind)
            expect(capabilityViolations(h, error)).toEqual([])
          } finally {
            storage.close()
          }
        },
      )
    })
