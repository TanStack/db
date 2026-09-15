import { identity } from './kernel.ts'
import type { Claim, Rule } from './kernel.ts'

/** A bounded example package, not the production SQL analyzer. */
export interface RefreshScope {
  mutation: string
  query: string
  writes: string[]
  reads: string[]
  externalWrites: 'outside-this-check'
}

export function refreshClaims(scope: RefreshScope): {
  writes: Claim
  reads: Claim
  disjoint: Claim
} {
  const writes: Claim = {
    law: 'endpoints/complete-write-bound@1',
    subject: scope.mutation,
    scope: { tables: scope.writes, externalWrites: scope.externalWrites },
  }
  const reads: Claim = {
    law: 'endpoints/complete-read-bound@1',
    subject: scope.query,
    scope: { tables: scope.reads },
  }
  return {
    writes,
    reads,
    disjoint: {
      law: 'endpoints/disjoint-bounds@1',
      subject: `${scope.mutation} → ${scope.query}`,
      scope: { writes: { ...writes }, reads: { ...reads } },
    },
  }
}

function bounds(claim: Claim): { writes: Claim; reads: Claim } | undefined {
  if (
    claim.law !== 'endpoints/disjoint-bounds@1' ||
    !claim.scope ||
    typeof claim.scope !== 'object' ||
    Array.isArray(claim.scope)
  )
    return
  const { writes, reads } = claim.scope
  const isClaim = (value: unknown): value is Claim => {
    if (
      !value ||
      typeof value !== 'object' ||
      !('law' in value) ||
      !('subject' in value) ||
      !('scope' in value)
    )
      return false
    return typeof value.law === 'string' && typeof value.subject === 'string'
  }
  if (
    !isClaim(writes) ||
    !isClaim(reads) ||
    writes.law !== 'endpoints/complete-write-bound@1' ||
    reads.law !== 'endpoints/complete-read-bound@1'
  )
    return
  return { writes, reads }
}

function tables(claim: Claim): string[] | undefined {
  const scope = claim.scope
  if (
    !scope ||
    typeof scope !== 'object' ||
    Array.isArray(scope) ||
    !Array.isArray(scope.tables)
  )
    return
  return scope.tables.every((table) => typeof table === 'string')
    ? scope.tables
    : undefined
}

/** Admission trusts the registered producer; it does not analyze PostgreSQL. */
function boundRule(law: string): Rule {
  return {
    id: `${law}/compiled-certificate`,
    premises: (claim) => (claim.law === law ? [] : undefined),
    inspect: (claim, observations) => {
      if (!tables(claim)) return 'Expected a table bound'
      return observations.some(
        (observation) =>
          identity(observation.claim) === identity(claim) &&
          observation.producer === 'endpoints/compiler-fixture@1' &&
          observation.value === 'complete',
      )
        ? undefined
        : 'Need a complete compiler-bound observation'
    },
  }
}

export const endpointsRules: Rule[] = [
  boundRule('endpoints/complete-write-bound@1'),
  boundRule('endpoints/complete-read-bound@1'),
  {
    id: 'endpoints/disjoint-bounds-rule@1',
    premises: (claim) => {
      const pair = bounds(claim)
      return pair ? [pair.writes, pair.reads] : undefined
    },
    inspect: (claim) => {
      const pair = bounds(claim)
      const writes = pair && tables(pair.writes)
      const reads = pair && tables(pair.reads)
      if (!writes || !reads) return 'Expected two table bounds'
      const written = new Set(writes)
      return reads.some((table) => written.has(table))
        ? 'Bounds overlap'
        : undefined
    },
  },
]
