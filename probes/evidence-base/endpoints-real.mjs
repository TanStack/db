import { createHash } from 'node:crypto'
import { canSkipRefetch } from '../endpoints/integrated-todo/effect-verdict.mjs'
import { identity } from './kernel.ts'

export const ENDPOINTS_CHECK_ID = 'endpoints/safe-skip-refetch-check@1'
export const ENDPOINTS_RULE_ID = 'endpoints/safe-skip-refetch-certificate@1'
export const ENDPOINTS_PRODUCER = 'endpoints/effect-verdict@1'

export const endpointsSkipContract = Object.freeze({
  id: ENDPOINTS_CHECK_ID,
  version: 1,
  law: 'endpoints/safe-skip-refetch@1',
  source: 'probes/endpoints/design/field-trip-optimistic-coherence/V1-SCOPE.md',
  domain:
    'One retained query and one mutation analyzed under a shared build artifact',
  reference: {
    kind: 'certificate',
    description:
      'The production effect verdict requires a baseline, no optimistic or repair obligation, complete bounds, and disjoint read/write sets.',
    trusted: [
      'the build-time SQL effect analyzer',
      'the captured schema artifact',
      'effect-verdict.mjs set intersection',
    ],
  },
  productionPath:
    'probes/endpoints/integrated-todo/effect-verdict.mjs#canSkipRefetch',
  checkpoint: 'after the production refresh verdict is returned',
  observes: [
    'verdict',
    'premises',
    'captured artifact and statement fingerprints',
    'derivation trace and unresolved effects',
  ],
  omissions: [
    'the analyzer rules are trusted by this certificate',
    'external writes are outside mutation reconciliation',
    'latency and byte savings are separate claims',
    'the certificate does not enact refresh policy',
  ],
  reachWitness:
    'the returned verdict and production-path check ID are recorded',
  faultControls: [
    'overlapping read/write bounds must reject skip',
    'incomplete effects must remain unresolved',
    'missing baseline or pending optimism must require refresh',
    'different schema artifacts must remain unresolved',
  ],
  replay:
    'rerun the exact captured query, mutation, authority state and dependency versions after the challenged observation',
})

export function skipRefetchClaim(input) {
  return {
    law: endpointsSkipContract.law,
    subject: `${input.mutationId} → ${input.queryId}`,
    scope: {
      queryArtifact: input.query.artifact,
      mutationArtifact: input.mutation.artifact,
      queryStatement: input.query.statement,
      mutationStatement: input.mutation.statement,
      authority: input.authority,
      externalWrites: 'outside-mutation-reconciliation',
    },
  }
}

export const endpointsEvidenceRules = [
  {
    id: ENDPOINTS_RULE_ID,
    premises: (claim) =>
      claim.law === endpointsSkipContract.law ? [] : undefined,
    inspect: (claim, observations) =>
      observations.some(
        (observation) =>
          identity(observation.claim) === identity(claim) &&
          observation.producer === ENDPOINTS_PRODUCER &&
          observation.check?.id === ENDPOINTS_CHECK_ID &&
          observation.value?.verdict === 'skip',
      )
        ? undefined
        : 'Need a current production skip-refetch certificate',
  },
]

function fingerprint(value) {
  return createHash('sha256').update(identity(value)).digest('hex')
}

export async function runEndpointsSkipCheck(base, input, dependencies = []) {
  const claim = skipRefetchClaim(input)
  const capturedCase = {
    queryId: input.queryId,
    mutationId: input.mutationId,
    query: input.query,
    mutation: input.mutation,
    authority: input.authority,
  }
  const observations = await base.runCheck(
    endpointsSkipContract,
    ENDPOINTS_PRODUCER,
    [
      {
        kind: 'config',
        name: 'endpoints/query-analysis',
        fingerprint: fingerprint(input.query),
      },
      {
        kind: 'config',
        name: 'endpoints/mutation-analysis',
        fingerprint: fingerprint(input.mutation),
      },
      ...dependencies,
    ],
    async () => {
      const verdict = canSkipRefetch(
        input.query,
        input.mutation,
        input.authority,
      )
      return {
        reached: true,
        findings: [
          {
            claim,
            case: capturedCase,
            outcome:
              verdict.verdict === 'skip'
                ? 'pass'
                : verdict.verdict === 'refresh'
                  ? 'fail'
                  : 'unresolved',
            value: verdict,
          },
        ],
      }
    },
  )
  base.propose({
    claim,
    rule: ENDPOINTS_RULE_ID,
    observations: observations.map(({ id }) => id),
  })
  return { claim, observations, assessment: base.assess(claim) }
}
