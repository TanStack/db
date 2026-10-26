// Browser re-export and Query Collection receiving paths use the core law.
import { persistedCollectionOptions } from '../src/index.js'
import {
  registerPersistedOptionsTypeOracle,
  registerPersistedUtilityAdmissionOracle,
} from '../../db-sqlite-persistence-core/tests/persisted-options-type-oracle.js'

registerPersistedOptionsTypeOracle(`browser`)
registerPersistedUtilityAdmissionOracle(`browser`, persistedCollectionOptions)
