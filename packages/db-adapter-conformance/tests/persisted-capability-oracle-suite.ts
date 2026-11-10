/** Shared receiving registration for the finite capability owner. */
import { oracleProperty, pass, violation } from '../../db/tests/oracle-property'
import { createStartupHost } from './persisted-startup-host'
import {
  capabilityHistories,
  capabilityMustAccept,
  capabilityViolations,
  observeCapability,
} from './persisted-capability-oracle'
import type { PersistedStartupAdapter } from './persisted-startup-driver'
import type { PersistedStartupHistory } from './persisted-startup-oracle'

export function registerCapabilityConformance(
  name: string,
  adapter: PersistedStartupAdapter<PersistedStartupHistory>,
) {
  for (const host of [`controlled`, `node-sqlite`] as const)
    oracleProperty({
      id: `adapter.${name}.capability.${host}`,
      law: {
        statement: `An advertised persistence capability must satisfy its structural protocol before source delivery; absent metadata and an explicit null capability remain legal.`,
        authority: `SyncMetadataApi.persistence and sync-persistence.ts's cross-package protocol contract.`,
        limits: `The finite 22-history required-member grammar, through the real SDK and named local persistence host; no optional extension faults, on-demand results, or arbitrary malformed values.`,
        owner: `Adapter conformance: persistence capability admission`,
      },
      // This table is the whole finite grammar. Enumeration preserves all 22
      // cases on each host without inventing a meaningless random campaign.
      histories: capabilityHistories,
      model: capabilityMustAccept,
      driver: async (h, observe) => {
        const storage = createStartupHost(host)
        try {
          observe(
            `admission`,
            await observeCapability(
              adapter,
              storage.persistence,
              h,
              `${name}-${host}-${JSON.stringify(h)}`,
            ),
          )
        } finally {
          storage.close()
        }
      },
      check: (h, trace, mustAccept) => {
        const admission = trace.find(
          (entry) => entry.checkpoint === `admission`,
        )
        if (!admission)
          return violation(`admission`, `sync admission was not observed`)
        const failures = capabilityViolations(h, admission.value, mustAccept)
        return failures.length
          ? violation(`admission`, failures.join(`; `), `capability protocol`)
          : pass
      },
    })
}
