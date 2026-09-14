import assert from 'node:assert/strict'

export const runtimeMutants = [
  'accept-overlapping-inline',
  'omit-publication-batch',
  'optimistic-recipients-only',
  'misroute-relations',
  'omit-fanout',
  'omit-order',
  'early-settlement',
  'omit-cold-start',
]

// Apply only to a disposable runtime. The hook records execution separately
// from this source edit; an applied but unexecuted mutant is not a killed fault.
export function applyRuntimeMutant(source, mutant) {
  const hook = `globalThis.__endpointOracleFault?.(${JSON.stringify(mutant)})`
  const edits = {
    'omit-cold-start': ['collection.startSyncImmediate()', `${hook}`],
    'accept-overlapping-inline': [
      'operation.alone &&',
      `(${hook}, true) || operation.alone &&`,
    ],
    'omit-publication-batch': [
      'this.core._batch(() => {\n      this.invalidateReads()\n      this.wake()',
      `;${hook}\n;((publish: () => void) => publish())(() => {\n      this.invalidateReads()\n      this.wake()`,
    ],
    'optimistic-recipients-only': [
      'const targets = retained\n',
      `const targets = (${hook}, retained).filter(([,c])=>transaction.mutations.some(m=>m.collection.id===c.id))\n`,
    ],
    'misroute-relations': [
      'model.relation !== sourceModel.relation ||',
      `(${hook}, false) ||`,
    ],
    'omit-fanout': [
      'if (endpoint.inline) this.propagate(transaction)',
      `if ((${hook}, false)) this.propagate(transaction)`,
    ],
    'omit-order': ['      model.order,\n', `      (${hook}, []),\n`],
    'early-settlement': [
      'await this.persist(endpoint, input, transaction, retained, scope)',
      `${hook}\n        void this.persist(endpoint, input, transaction, retained, scope)`,
    ],
  }
  assert.ok(Object.hasOwn(edits, mutant), `Unknown oracle mutant: ${mutant}`)
  const [before, after] = edits[mutant]
  assert.equal(
    source.split(before).length,
    2,
    `Mutant ${mutant} must replace exactly one runtime expression`,
  )
  return { source: source.replace(before, after), before, after }
}
