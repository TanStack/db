// @vitest-environment node
// Core entry; the shared oracle owns the grammar, model, and comparison.
import { registerPersistedOptionsTypeOracle } from './persisted-options-type-oracle.js'

registerPersistedOptionsTypeOracle(`core`)
