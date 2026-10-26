// @vitest-environment node
// Core entry; the shared oracle owns the grammar, model, and comparison.
import { persistedCollectionOptions } from '../src/index.js'
import {
  registerPersistedOptionsTypeOracle,
  registerPersistedUtilityAdmissionOracle,
} from './persisted-options-type-oracle.js'

registerPersistedOptionsTypeOracle(`core`)
registerPersistedUtilityAdmissionOracle(`core`, persistedCollectionOptions)
