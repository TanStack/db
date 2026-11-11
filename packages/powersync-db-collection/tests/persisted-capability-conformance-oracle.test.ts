/** Package-local ownership makes the real protocol receiver visible to gap audits. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { registerCapabilityConformance } from '../../db-adapter-conformance/tests/persisted-capability-oracle-suite'
import {
  capabilityHistories,
  capabilityViolations,
} from '../../db-adapter-conformance/tests/persisted-capability-oracle'
import { powerSyncStartupAdapter } from './persisted-startup-driver'

declareOracle({
  owns: [`src/powersync.ts#powerSyncCollectionOptions`],
  check: [capabilityViolations],
  grammar: [capabilityHistories],
})
registerCapabilityConformance(`powersync`, powerSyncStartupAdapter)
