import { EvidenceBase } from './kernel.ts'
import { endpointsRules, refreshClaims } from './endpoints.ts'

const claims = refreshClaims({
  mutation: 'updateRecipe',
  query: 'listUsers',
  writes: ['recipes'],
  reads: ['users'],
  externalWrites: 'outside-this-check',
})
const base = new EvidenceBase(endpointsRules)
base.propose({
  claim: claims.disjoint,
  rule: 'endpoints/disjoint-bounds-rule@1',
  observations: [],
})
console.log(
  'Before checks:',
  JSON.stringify(base.assess(claims.disjoint), null, 2),
)
const observations = await base.run('endpoints/compiler-fixture@1', async () =>
  [claims.writes, claims.reads].map((claim) => ({
    claim,
    passed: true,
    case: { fixture: 'declared-table-bounds' },
    value: 'complete',
  })),
)
for (const observation of observations) {
  base.propose({
    claim: observation.claim,
    rule: `${observation.claim.law}/compiled-certificate`,
    observations: [observation.id],
  })
}
console.log(
  'After checks:',
  JSON.stringify(base.assess(claims.disjoint), null, 2),
)
await base.run('counterexample-fixture', async () => [
  {
    claim: claims.writes,
    passed: false,
    case: { fixture: 'helper-writes-users' },
    value: { undeclaredWrite: 'users' },
  },
])
console.log(
  'After counterexample:',
  JSON.stringify(base.assess(claims.disjoint), null, 2),
)
