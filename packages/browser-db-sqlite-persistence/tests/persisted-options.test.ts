import { describe } from 'vitest'
// Browser re-export and Query Collection receiving paths use the core law.
import { persistedCollectionOptions } from '../src/index.js'
import {
  registerPersistedOptionsTypeOracle,
  registerPersistedUtilityAdmissionOracle,
} from '../../db-sqlite-persistence-core/tests/persisted-options-type-oracle.js'

describe(`persisted-options.test`, () => {
  registerPersistedOptionsTypeOracle(`browser`)
  registerPersistedUtilityAdmissionOracle(`browser`, persistedCollectionOptions)
})
