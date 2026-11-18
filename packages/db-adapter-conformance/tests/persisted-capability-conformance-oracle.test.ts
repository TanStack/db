/** The structural capability law receives both actual adapters and storage hosts. */
import { rxdbStartupAdapter } from '../../rxdb-db-collection/tests/persisted-startup-driver'
import { powerSyncStartupAdapter } from '../../powersync-db-collection/tests/persisted-startup-driver'
import { registerCapabilityConformance } from './persisted-capability-oracle-suite'

registerCapabilityConformance(`rxdb`, rxdbStartupAdapter)
registerCapabilityConformance(`powersync`, powerSyncStartupAdapter)
