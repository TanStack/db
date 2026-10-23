import { reducePublicKeys } from '../live/public-key-reduction.js'
import { validateJoinConditions } from '../join-conditions.js'
import { applyOptimizations } from '../optimizer-joins.js'
import { processJoins } from './joins.js'

/**
 * The join compiler and its helpers. Join operators carry it onto each IR join
 * clause, so apps without joins do not bundle it.
 */
export const joinRuntime = {
  compile: processJoins,
  optimize: applyOptimizations,
  // A joined query with a custom key reduces its public keys.
  reducePublicKeys,
  validate: validateJoinConditions,
}

export type JoinRuntime = typeof joinRuntime
