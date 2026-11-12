/** Package-local ownership makes the real protocol receiver visible to gap audits. */
import { registerCapabilityConformance } from '../../db-adapter-conformance/tests/persisted-capability-oracle-suite'
import { powerSyncStartupAdapter } from './persisted-startup-driver'

registerCapabilityConformance(`powersync`, powerSyncStartupAdapter, {
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
})
