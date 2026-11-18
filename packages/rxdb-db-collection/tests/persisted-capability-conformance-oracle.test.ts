/** Package-local ownership makes the real protocol receiver visible to gap audits. */
import { registerCapabilityConformance } from '../../db-adapter-conformance/tests/persisted-capability-oracle-suite'
import { rxdbStartupAdapter } from './persisted-startup-driver'

registerCapabilityConformance(`rxdb`, rxdbStartupAdapter, {
  owns: [`src/rxdb.ts#rxdbCollectionOptions`],
})
