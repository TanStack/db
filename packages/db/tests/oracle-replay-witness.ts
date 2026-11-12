// The oracle framework lives in @tanstack/oracles. This module keeps the import
// path that TanStack DB's oracles use. It imports oracle-config first, so the
// framework runs under TanStack DB's configuration (its environment prefix and
// property registry) whichever name a test imports.
import './oracle-config.js'

export * from '@tanstack/oracles'
