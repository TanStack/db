// Inventory is independent of the compiler classifier. A declaration is not a
// passing witness: record cells only after the full-stack sequence succeeds.
export const inventory = {
  'schema.multiple-tables': 'Several independent relation identities',
  'schema.foreign-key-set-null': 'Server-only ON DELETE SET NULL effects',
  'type.integer': 'int4 values',
  'type.text': 'Text and Unicode values',
  'type.boolean': 'Boolean values',
  'type.timestamp': 'Timestamp transport and total createdAt/id order',
  'schema.nullable': 'Nullable generated scalar columns',
  'schema.not-null': 'NOT NULL generated scalar columns',
  'predicate.eq': 'Scalar equality',
  'predicate.ne': 'Scalar inequality',
  'predicate.gt': 'Integer greater-than',
  'predicate.gte': 'Integer greater-than-or-equal',
  'predicate.lt': 'Integer less-than',
  'predicate.lte': 'Integer less-than-or-equal',
  'predicate.and': 'Predicate conjunction',
  'predicate.or': 'Predicate disjunction',
  'predicate.isNull': 'SQL NULL membership',
  'predicate.isNotNull': 'SQL non-NULL membership',
  'mutation.insert': 'Insert',
  'mutation.edit': 'Column updates',
  'mutation.complete': 'Boolean updates',
  'mutation.delete': 'Delete',
  'mutation.cross-table': 'An opaque handler also changes another table',
  'mutation.post-commit-error': 'A handler errors after committed writes',
  'mutation.rejected': 'Rejected write restores optimistic state',
  'mutation.foreign-key-conflict':
    'Concurrent parent deletion invalidates a child update',
  'query.limit': 'Finite result windows',
  'query.join': 'Joins and relationship projection',
  'query.aggregate': 'Grouping and aggregates',
  'query.cte': 'CTEs and recursive queries',
  'query.window': 'Window functions',
  'query.set-operation': 'UNION/INTERSECT/EXCEPT',
  'type.numeric': 'Exact numeric and bigint transport',
  'type.json-array': 'JSON and array expressions',
  'schema.trigger': 'User-defined trigger effects',
  'effect.rewrite': 'BEFORE UPDATE rewrites authored values',
  'effect.suppress': 'BEFORE UPDATE suppresses a row without an error',
  'effect.reject': 'Trigger rejects a statement and rolls back its changes',
  'effect.fanout':
    'AFTER UPDATE changes all recipient rows in the caller scope',
  'effect.transition':
    'Statement trigger reads NEW TABLE and changes another table',
  'effect.deferred':
    'Constraint trigger runs at the implicit transaction commit',
  'authority.external-writer': 'External writers and replica visibility',
  'demand.subset': 'On-demand subset transport and refill',
}
export class SqlManifest {
  witnesses = new Map()
  rejected = new Map()
  add(feature, witness) {
    if (!Object.hasOwn(inventory, feature))
      throw Error('Uninventoried SQL feature ' + feature)
    const entries = this.witnesses.get(feature) ?? new Set()
    entries.add(witness)
    this.witnesses.set(feature, entries)
  }
  record(program, steps, witness) {
    this.add('schema.multiple-tables', witness)
    this.add('type.timestamp', witness)
    for (const table of program.tables) {
      if (table.parent !== null)
        this.add('schema.foreign-key-set-null', witness)
      for (const column of table.columns) {
        this.add('type.' + column.type, witness)
        this.add(
          column.nullable ? 'schema.nullable' : 'schema.not-null',
          witness,
        )
      }
    }
    function visit(node, record) {
      if (!node) return
      record('predicate.' + node.op)
      node.args?.forEach((child) => visit(child, record))
    }
    for (const query of program.queries)
      visit(query.predicate, (feature) => this.add(feature, witness))
    // These describe the actual operations issued by the reference/driver,
    // including fallback inserts when a requested target row does not exist.
    for (const operation of steps) {
      if (operation.effectWitness) {
        this.add('schema.trigger', witness)
        this.add('effect.' + operation.effectWitness, witness)
      }
      this.add('mutation.' + operation.kind, witness)
      if (operation.outcome === 'reject') this.add('mutation.rejected', witness)
      else if (operation.serverError) {
        if (operation.serverError.code === '23503')
          this.add('mutation.foreign-key-conflict', witness)
      } else {
        if (operation.input.cross) this.add('mutation.cross-table', witness)
        if (operation.input.failAfterCommit)
          this.add('mutation.post-commit-error', witness)
      }
    }
  }
  report() {
    return Object.entries(inventory).map(([feature, description]) => ({
      feature,
      description,
      status: this.witnesses.has(feature)
        ? 'tested'
        : this.rejected.has(feature)
          ? 'explicitly-rejected'
          : 'not-tested',
      witnesses: [...(this.witnesses.get(feature) ?? [])],
      rejection: this.rejected.get(feature),
      ...(this.witnesses.has(feature)
        ? {
            execution: 'full-stack',
            optimism:
              'direct whole-row guesses; predicate propagation within one relation',
            affectedCollections: 'conservative all retained',
            reconciliation: 'full-result refresh',
            resultPatches: 'not-tested',
            subsets: 'deferred',
          }
        : {}),
    }))
  }
}
