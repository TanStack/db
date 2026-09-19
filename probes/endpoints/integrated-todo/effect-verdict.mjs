export function queryDependencies(summary) {
  return summary.unknown.length || summary.writes.length ? null : summary.reads
}

export function mutationDependencies(summary) {
  return summary.unknown.some((effect) => effect.dimensions.includes('writes'))
    ? null
    : summary.writes
}

/**
 * Dependency-free decision kernel shared by runtime compilation evidence and
 * the evidence-base package. Analysis remains in sql-effects.mjs.
 */
export function canSkipRefetch(query, mutation, authority) {
  const premises = {
    sameArtifact: query.artifact === mutation.artifact,
    hasBaseline: authority.hasBaseline,
    optimistic: authority.optimistic,
    needsRepair: authority.needsRepair,
  }
  const base = {
    claim: 'skip-refetch',
    premises,
    artifact: query.artifact,
    statements: [query.statement, mutation.statement],
    derivation: [...query.derivation, ...mutation.derivation],
  }
  if (!premises.sameArtifact)
    return {
      ...base,
      verdict: 'unknown',
      reason: 'Different compilation artifacts',
    }
  if (!authority.hasBaseline || authority.optimistic || authority.needsRepair)
    return {
      ...base,
      verdict: 'refresh',
      reason: 'Collection requires authority',
    }
  const reads = queryDependencies(query)
  const writes = mutationDependencies(mutation)
  if (reads?.length === 0)
    return {
      ...base,
      verdict: 'skip',
      reason: 'Query has no state dependencies under the compilation context',
    }
  if (reads === null || writes === null)
    return {
      ...base,
      verdict: 'unknown',
      reason: 'Unresolved SQL effects',
      unknown: [...query.unknown, ...mutation.unknown],
    }
  const changed = new Set(writes)
  return {
    ...base,
    verdict: reads.some((id) => changed.has(id)) ? 'refresh' : 'skip',
    reason: 'Read/write intersection',
  }
}
