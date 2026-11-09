// @vitest-environment node
import { describe } from 'vitest'
// Core entry; the shared oracle owns the grammar, model, and comparison.
import { persistedCollectionOptions } from '../src/index.js'
import {
  registerPersistedOptionsTypeOracle,
  registerPersistedUtilityAdmissionOracle,
} from './persisted-options-type-oracle.js'

describe(`persisted collection options keep caller contracts through the core entry`, () => {
  registerPersistedOptionsTypeOracle(`core`)
  registerPersistedUtilityAdmissionOracle(`core`, persistedCollectionOptions)
})
