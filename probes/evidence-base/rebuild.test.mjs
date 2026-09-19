import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import {
  CheckDidNotReachProductionPathError,
  EvidenceBase,
  identity,
} from './kernel.ts'
import {
  endpointsEvidenceRules,
  runEndpointsSkipCheck,
  skipRefetchClaim,
} from './endpoints-real.mjs'
import { decodeStore, encodeStore, loadStore, saveStore } from './storage.mjs'
import { shrinkHistory } from './oracle-tools.mjs'
import { createEvidenceService, allRules, PACKAGE_ID } from './service.mjs'
import { diagnosticsFor } from './lsp-server.mjs'
import { createMcpHandler } from './mcp-server.mjs'

const fixtureClaim = (subject = 'target') => ({
  law: 'fixture/check@1',
  subject,
  scope: { boundary: 'rebuild' },
})

const contract = {
  id: 'fixture/check@1',
  version: 1,
  law: 'fixture/check@1',
  source: 'rebuild.test.mjs',
  domain: 'one bounded fixture',
  reference: {
    kind: 'model',
    description: 'independent fixture value',
    trusted: ['test model'],
  },
  productionPath: 'fixture#run',
  checkpoint: 'after fixture execution',
  observes: ['value'],
  omissions: ['everything outside the fixture'],
  reachWitness: 'execution increments the fixture witness',
  faultControls: ['wrong value'],
  replay: 'rerun the exact fixture after the failure',
}

const fixtureRule = {
  id: 'fixture/certificate@1',
  premises: (claim) => (claim.law === contract.law ? [] : undefined),
  inspect: (claim, observations) =>
    observations.some(
      (observation) =>
        identity(observation.claim) === identity(claim) &&
        observation.value === 'expected',
    )
      ? undefined
      : 'Expected the fixture certificate',
}

async function runFixture(base, options = {}) {
  const target = fixtureClaim(options.subject)
  const observations = await base.runCheck(
    contract,
    'fixture/runner@1',
    [
      {
        kind: 'code',
        name: 'fixture/source',
        fingerprint: options.fingerprint ?? 'a',
      },
    ],
    async () => ({
      reached: options.reached ?? true,
      findings: [
        {
          claim: target,
          case: { input: 1 },
          outcome: options.outcome ?? 'pass',
          value: options.value ?? 'expected',
        },
      ],
    }),
  )
  base.propose({
    claim: target,
    rule: fixtureRule.id,
    observations: observations.map(({ id }) => id),
  })
  return { target, observations }
}

test('structured checks distinguish unresolved evidence from failures and reach errors', async () => {
  const base = new EvidenceBase([fixtureRule])
  const target = fixtureClaim()
  const [observation] = await base.runCheck(
    contract,
    'fixture/runner@1',
    [],
    async () => ({
      reached: true,
      findings: [
        {
          claim: target,
          case: { input: 1 },
          outcome: 'unresolved',
          value: { reason: 'provider unknown' },
        },
      ],
    }),
  )
  assert.equal(observation.outcome, 'unresolved')
  assert.equal(observation.passed, false)
  assert.equal(observation.check.id, contract.id)
  assert.equal(base.history().challenges.length, 0)

  const before = base.history()
  await assert.rejects(
    base.runCheck(contract, 'fixture/runner@1', [], async () => ({
      reached: false,
      findings: [],
    })),
    CheckDidNotReachProductionPathError,
  )
  assert.deepEqual(base.history(), before)
})

test('dependency revisions invalidate selectively and old bytes do not reactivate evidence', async () => {
  const base = new EvidenceBase([fixtureRule])
  const first = await runFixture(base, { fingerprint: 'a' })
  assert.equal(base.assess(first.target).status, 'supported')
  base.updateDependencies([
    { kind: 'code', name: 'fixture/source', fingerprint: 'b' },
  ])
  assert.equal(base.assess(first.target).status, 'unresolved')
  base.updateDependencies([
    { kind: 'code', name: 'fixture/source', fingerprint: 'a' },
  ])
  assert.equal(base.assess(first.target).status, 'unresolved')
  await runFixture(base, { fingerprint: 'a' })
  assert.equal(base.assess(first.target).status, 'supported')

  const unrelated = await runFixture(base, {
    subject: 'unrelated',
    fingerprint: 'a',
  })
  base.updateDependencies([
    { kind: 'config', name: 'other/config', fingerprint: 'changed' },
  ])
  assert.equal(base.assess(unrelated.target).status, 'supported')
})

test('verified storage reloads equivalent state and rejects tampering and dangling references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-store-'))
  try {
    const path = join(directory, 'evidence.json')
    const base = new EvidenceBase([fixtureRule])
    const { target } = await runFixture(base)
    await saveStore(path, base, 'fixture@1')
    const restored = await loadStore(path, [fixtureRule], {
      package: 'fixture@1',
    })
    assert.deepEqual(restored.assess(target), base.assess(target))

    const envelope = encodeStore(base, 'fixture@1')
    envelope.state.observations[0].value = 'tampered'
    assert.throws(
      () => decodeStore(envelope, [fixtureRule], 'fixture@1'),
      /checksum mismatch/,
    )

    const state = base.exportState()
    state.arguments[0].observations = [999]
    assert.throws(
      () => EvidenceBase.fromState([fixtureRule], state),
      /unknown observation/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const tables = ['recipes', 'tags', 'users']
const subset = (mask) => tables.filter((_, bit) => mask & (1 << bit))
const summary = ({
  reads = [],
  writes = [],
  unknown = [],
  statement,
  artifact = 'schema-a',
}) => ({
  reads,
  writes,
  unknown,
  derivation: [],
  artifact,
  statement,
})
const endpointsInput = (reads, writes) => ({
  queryId: 'list',
  mutationId: 'update',
  query: summary({ reads, statement: 'query' }),
  mutation: summary({ writes, statement: 'mutation' }),
  authority: { hasBaseline: true, optimistic: false, needsRepair: false },
})

test('real Endpoints decision agrees with an independent oracle over all small bounds', async () => {
  for (let readMask = 0; readMask < 8; readMask++) {
    for (let writeMask = 0; writeMask < 8; writeMask++) {
      const reads = subset(readMask)
      const writes = subset(writeMask)
      const expectedSkip = reads.every((table) => !writes.includes(table))
      const base = new EvidenceBase(endpointsEvidenceRules)
      const result = await runEndpointsSkipCheck(
        base,
        endpointsInput(reads, writes),
      )
      assert.equal(
        result.assessment.status,
        expectedSkip ? 'supported' : 'contradicted',
        `reads=${reads} writes=${writes}`,
      )
      assert.equal(
        result.observations[0].check.productionPath.includes(
          'effect-verdict.mjs',
        ),
        true,
      )
    }
  }
})

test('incomplete Endpoints effects remain unresolved rather than becoming a counterexample', async () => {
  const input = endpointsInput(['users'], ['recipes'])
  input.mutation.unknown.push({
    source: 'helper',
    reason: 'uninspected import',
    dimensions: ['writes'],
  })
  const base = new EvidenceBase(endpointsEvidenceRules)
  const result = await runEndpointsSkipCheck(base, input)
  assert.equal(result.observations[0].outcome, 'unresolved')
  assert.equal(result.assessment.status, 'unresolved')
  assert.equal(base.history().challenges.length, 0)
})

test('history shrinking preserves the exact violation and reached checkpoint', async () => {
  const history = ['noise-a', 'change-rank', 'noise-b', 'noise-c']
  const evaluate = async (candidate) => ({
    reached: true,
    violated: candidate.includes('change-rank'),
    signature: candidate.includes('change-rank')
      ? 'ordered-ids@after-change-rank'
      : 'none',
    actual: candidate.includes('change-rank') ? [2, 1] : [1, 2],
  })
  const result = await shrinkHistory(history, evaluate)
  assert.deepEqual(result.original, history)
  assert.deepEqual(result.reduced, ['change-rank'])
  assert.equal(result.replay.signature, result.violation.signature)
})

test('CLI, LSP and MCP share one persistent service and assessment semantics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'evidence-interfaces-'))
  try {
    const path = join(directory, 'evidence.json')
    const service = createEvidenceService({ storePath: path })
    await service.request({ operation: 'init' })
    const result = await service.request({
      operation: 'runEndpoints',
      input: endpointsInput(['users'], ['recipes']),
    })
    assert.equal(result.assessment.status, 'supported')

    const cli = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        new URL('./cli.mjs', import.meta.url).pathname,
        '--store',
        path,
        'status',
      ],
      { encoding: 'utf8' },
    )
    assert.equal(cli.status, 0, cli.stderr)
    assert.equal(JSON.parse(cli.stdout).observations, 1)

    assert.deepEqual(
      await diagnosticsFor(JSON.stringify({ claim: result.claim }), service),
      [],
    )
    const diagnostics = await diagnosticsFor(
      JSON.stringify({ claim: fixtureClaim('missing') }),
      service,
    )
    assert.equal(diagnostics[0].code, 'unresolved')

    const mcp = createMcpHandler(service)
    const listed = await mcp({ id: 1, method: 'tools/list' })
    assert.equal(
      listed.result.tools.some(({ name }) => name === 'evidence_assess'),
      true,
    )
    const assessed = await mcp({
      id: 2,
      method: 'tools/call',
      params: { name: 'evidence_assess', arguments: { claim: result.claim } },
    })
    assert.equal(assessed.result.structuredContent.status, 'supported')

    const restored = await loadStore(path, allRules, { package: PACKAGE_ID })
    assert.equal(
      restored.assess(skipRefetchClaim(endpointsInput(['users'], ['recipes'])))
        .status,
      'supported',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
