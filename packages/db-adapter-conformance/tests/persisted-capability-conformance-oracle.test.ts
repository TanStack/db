/** The structural capability law receives both actual adapters and storage hosts. */
import { declareOracle } from '../../db/tests/oracle-declaration'
import { rxdbStartupAdapter } from '../../rxdb-db-collection/tests/persisted-startup-driver'
import { powerSyncStartupAdapter } from '../../powersync-db-collection/tests/persisted-startup-driver'
import { registerCapabilityConformance } from './persisted-capability-oracle-suite'
import {
  capabilityHistories,
  capabilityViolations,
} from './persisted-capability-oracle'

declareOracle({ check: [capabilityViolations], grammar: [capabilityHistories] })
registerCapabilityConformance(`rxdb`, rxdbStartupAdapter)
registerCapabilityConformance(`powersync`, powerSyncStartupAdapter)
