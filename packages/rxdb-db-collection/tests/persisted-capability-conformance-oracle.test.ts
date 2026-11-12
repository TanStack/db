/** Package-local ownership makes the real protocol receiver visible to gap audits. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { registerCapabilityConformance } from '../../db-adapter-conformance/tests/persisted-capability-oracle-suite'
import {
  capabilityHistories,
  capabilityViolations,
} from '../../db-adapter-conformance/tests/persisted-capability-oracle'
import { rxdbStartupAdapter } from './persisted-startup-driver'

declareOracle({
  owns: [`src/rxdb.ts#rxdbCollectionOptions`],
  check: [capabilityViolations],
  grammar: [capabilityHistories],
})
registerCapabilityConformance(`rxdb`, rxdbStartupAdapter)
