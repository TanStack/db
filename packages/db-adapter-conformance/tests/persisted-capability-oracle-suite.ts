/** Shared receiving registration for the finite capability owner. */
import { afterAll, describe, expect, it } from 'vitest'
import { createOracleReach } from '../../db/tests/oracle-reach'
import { declareOracle } from '../../db/tests/oracle-declaration'
import { oracleRoute } from '../../db/tests/oracle-config'
import { createStartupHost } from './persisted-startup-host'
import {
  capabilityHistories,
  capabilityViolations,
  observeCapability,
} from './persisted-capability-oracle'
import type { PersistedStartupAdapter } from './persisted-startup-driver'
import type { PersistedStartupHistory } from './persisted-startup-oracle'

declareOracle({ check: [capabilityViolations], grammar: [capabilityHistories] })
export function registerCapabilityConformance(
  name: string,
  adapter: PersistedStartupAdapter<PersistedStartupHistory>,
) {
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
}
