import assert from 'node:assert/strict'
import test from 'node:test'
import { EvidenceBase, identity } from './kernel.ts'
import { endpointsRules, refreshClaims } from './endpoints.ts'

const claim = (subject) => ({
  law: 'fixture/value@1',
  subject,
  scope: { campaign: 'bounded-fixture' },
})
const finding = (target, passed = true, sample = { input: 1 }) => ({
  claim: target,
  passed,
  case: sample,
  value: 'checked',
})
const leaf = {
  id: 'fixture/observation@1',
  premises: () => [],
  inspect: (target, observations) =>
    observations.some(
      (entry) =>
        identity(entry.claim) === identity(target) && entry.value === 'checked',
    )
      ? undefined
      : 'Missing matching observation',
}

async function support(base, target) {
  const [observation] = await base.run('fixture/checker@1', async () => [
    finding(target),
  ])
  base.propose({ claim: target, rule: leaf.id, observations: [observation.id] })
  return observation
}

function random(seed) {
  let state = seed
  return (limit) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return (state >>> 8) % limit
  }
}

// Independent oracle: forward saturation of Horn clauses. The SUT traverses
// proposed arguments backwards. No SUT evaluator/helpers build expected support.
function saturate(atoms, clauses) {
  const known = new Set(atoms)
  let changed = true
  while (changed) {
    changed = false
    for (const { head, body } of clauses) {
      if (!known.has(head) && body.every((entry) => known.has(entry))) {
        known.add(head)
        changed = true
      }
    }
  }
  return known
}

test('generated cyclic and alternative arguments agree with forward-chaining oracle', async () => {
  for (let seed = 1; seed <= 60; seed++) {
    const next = random(seed)
    const clauses = Array.from({ length: 8 }, () => ({
      head: next(4),
      body: Array.from({ length: 1 + next(3) }, () => next(4)),
    }))
    for (let mask = 0; mask < 16; mask++) {
      const atoms = [0, 1, 2, 3].filter((index) => mask & (1 << index))
      const rules = clauses.map(({ head, body }, index) => ({
        id: `fixture/clause-${index}@1`,
        premises: (target) =>
          target.subject === String(head)
            ? body.map((value) => claim(String(value)))
            : undefined,
        inspect: () => undefined,
      }))
      const base = new EvidenceBase([leaf, ...rules])
      for (const atom of atoms) await support(base, claim(String(atom)))
      for (const [index, clause] of clauses.entries()) {
        base.propose({
          claim: claim(String(clause.head)),
          rule: rules[index].id,
          observations: [],
        })
      }
      const expected = saturate(atoms, clauses)
      for (let index = 0; index < 4; index++) {
        assert.equal(
          base.assess(claim(String(index))).status === 'supported',
          expected.has(index),
          `seed=${seed}, mask=${mask}, goal=${index}`,
        )
      }
    }
  }
})

test('a counterexample remains open until explicit current replay of the same law and case', async () => {
  const base = new EvidenceBase([leaf])
  const target = claim('helper')
  await support(base, target)
  const [failed] = await base.run('oracle', async () => [
    finding(target, false),
  ])
  assert.equal(base.assess(target).status, 'contradicted')
  const [unrelated] = await base.run('oracle', async () => [
    finding(target, true, { input: 2 }),
  ])
  assert.throws(() => base.resolve(1, unrelated.id), /original law and case/)
  assert.equal(base.assess(target).status, 'contradicted')
  const [otherLaw] = await base.run('oracle', async () => [
    finding(claim('another helper')),
  ])
  assert.throws(() => base.resolve(1, otherLaw.id), /original law and case/)
  base.advanceContext()
  const replay = await support(base, target)
  assert.equal(base.assess(target).status, 'contradicted')
  base.resolve(1, replay.id)
  assert.equal(base.assess(target).status, 'supported')
  assert.equal(
    base.history().observations.find((entry) => entry.id === failed.id).passed,
    false,
  )
})

test('generated context and failure histories agree with an independent state model', async () => {
  const operationPairs = new Set()
  for (let seed = 1; seed <= 80; seed++) {
    const next = random(seed)
    const base = new EvidenceBase([leaf])
    const target = claim('shared')
    let hasFreshPass = false
    const failures = []
    let epoch = 0
    let previous
    for (let step = 0; step < 35; step++) {
      const operation = next(4)
      if (previous !== undefined) operationPairs.add(`${previous}:${operation}`)
      previous = operation
      if (operation === 0) {
        await support(base, target)
        hasFreshPass = true
      } else if (operation === 1) {
        base.advanceContext()
        epoch++
        hasFreshPass = false
      } else if (operation === 2) {
        await base.run('oracle', async () => [finding(target, false)])
        failures.push({ resolutionEpoch: undefined })
      } else if (
        failures.some((failure) => failure.resolutionEpoch !== epoch)
      ) {
        const replay = await support(base, target)
        hasFreshPass = true
        for (const [index, failure] of failures.entries()) {
          if (failure.resolutionEpoch !== epoch) {
            base.resolve(index + 1, replay.id)
            failure.resolutionEpoch = epoch
          }
        }
      }
      const expected = failures.some(
        (failure) => failure.resolutionEpoch !== epoch,
      )
        ? 'contradicted'
        : hasFreshPass
          ? 'supported'
          : 'unresolved'
      assert.equal(
        base.assess(target).status,
        expected,
        `history seed=${seed}, step=${step}`,
      )
    }
  }
  assert.equal(
    operationPairs.size,
    16,
    'Generator must cover every adjacent operation pair',
  )
})

test('one run preserves separate observations, and operational errors add no evidence', async () => {
  const base = new EvidenceBase([leaf])
  const [values, work] = await base.run('oracle', async () => [
    finding(claim('values')),
    finding(claim('work'), false),
  ])
  assert.equal(values.run, work.run)
  assert.equal(base.history().challenges.length, 1)
  const before = base.history()
  await assert.rejects(
    base.run('oracle', async () => {
      throw new Error('Database unavailable')
    }),
  )
  assert.deepEqual(base.history(), before)
})

test('context changes, including return to prior code, cannot reactivate old observations', async () => {
  const base = new EvidenceBase([leaf])
  const target = claim('helper')
  await support(base, target)
  base.advanceContext()
  base.advanceContext()
  assert.equal(base.assess(target).status, 'unresolved')
  await support(base, target)
  assert.equal(base.assess(target).status, 'supported')
})

test('a run finishing after a context change remains attached to its starting epoch', async () => {
  const base = new EvidenceBase([leaf])
  const target = claim('helper')
  let release
  const pending = base.run(
    'oracle',
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  base.advanceContext()
  release([finding(target)])
  const [observation] = await pending
  base.propose({ claim: target, rule: leaf.id, observations: [observation.id] })
  assert.equal(base.assess(target).status, 'unresolved')
})

test('unregistered rules and unrelated observations cannot supply support', async () => {
  const base = new EvidenceBase([leaf])
  const other = await support(base, claim('other'))
  const target = claim('target')
  base.propose({
    claim: target,
    rule: 'agent-says-so',
    observations: [other.id],
  })
  base.propose({ claim: target, rule: leaf.id, observations: [other.id] })
  assert.equal(base.assess(target).status, 'unresolved')
})

test('shared missing premises produce one gap and failures defeat every route using them', async () => {
  const helper = claim('helper')
  const rules = ['a', 'b'].map((name) => ({
    id: name,
    premises: (target) =>
      target.subject === 'goal' ? [helper, helper] : undefined,
    inspect: () => undefined,
  }))
  const base = new EvidenceBase([leaf, ...rules])
  for (const rule of rules)
    base.propose({ claim: claim('goal'), rule: rule.id, observations: [] })
  assert.deepEqual(base.assess(claim('goal')).gaps, [helper])
  await support(base, helper)
  assert.equal(base.assess(claim('goal')).status, 'supported')
  await base.run('oracle', async () => [finding(helper, false)])
  assert.equal(base.assess(claim('goal')).status, 'unresolved')
  assert.match(base.assess(claim('goal')).reasons.join(' '), /counterexample/)
})

test('caller and rule mutation cannot rewrite stored observations', async () => {
  const target = claim('immutable')
  const mutatingRule = {
    ...leaf,
    id: 'mutates',
    inspect: (_claim, observations) => {
      observations[0].passed = false
      return 'reject'
    },
  }
  const base = new EvidenceBase([leaf, mutatingRule])
  const observation = await support(base, target)
  observation.passed = false
  const history = base.history()
  history.observations[0].value = 'changed'
  base.propose({
    claim: claim('another'),
    rule: mutatingRule.id,
    observations: [observation.id],
  })
  base.assess(claim('another'))
  assert.equal(base.history().observations[0].passed, true)
  assert.equal(base.assess(target).status, 'supported')
})

function subset(mask) {
  return ['recipes', 'tags', 'users'].filter((_, bit) => mask & (1 << bit))
}

test('Endpoints bound arguments agree with a possible-worlds oracle over all small table sets', async () => {
  for (let writeMask = 0; writeMask < 8; writeMask++) {
    for (let readMask = 0; readMask < 8; readMask++) {
      const claims = refreshClaims({
        mutation: 'update',
        query: 'list',
        writes: subset(writeMask),
        reads: subset(readMask),
        externalWrites: 'outside-this-check',
      })
      const base = new EvidenceBase(endpointsRules)
      const observations = await base.run(
        'endpoints/compiler-fixture@1',
        async () =>
          [claims.writes, claims.reads].map((claim) => ({
            ...finding(claim),
            value: 'complete',
          })),
      )
      for (const [index, target] of [claims.writes, claims.reads].entries()) {
        base.propose({
          claim: target,
          rule: `${target.law}/compiled-certificate`,
          observations: [observations[index].id],
        })
      }
      base.propose({
        claim: claims.disjoint,
        rule: 'endpoints/disjoint-bounds-rule@1',
        observations: [],
      })
      // Independently enumerate actual read/write worlds allowed by the bounds.
      let canChangeRead = false
      for (let actualWrites = 0; actualWrites < 8; actualWrites++) {
        for (let actualReads = 0; actualReads < 8; actualReads++) {
          if (
            (actualWrites | writeMask) === writeMask &&
            (actualReads | readMask) === readMask &&
            (actualWrites & actualReads) !== 0
          )
            canChangeRead = true
        }
      }
      assert.equal(
        base.assess(claims.disjoint).status === 'supported',
        !canChangeRead,
      )
    }
  }
})

// Audit repair: explanations must encode the legal ways to establish a goal.
test('generated route explanations preserve conjunctive and alternative completion sets', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const next = random(seed)
    const clauses = Array.from({ length: 7 }, () => {
      const head = 3 + next(3)
      return {
        head,
        body: Array.from({ length: 1 + next(3) }, () => next(head)),
      }
    })
    const rules = clauses.map(({ head, body }, index) => ({
      id: `explanation/${index}@1`,
      premises: (target) =>
        target.subject === String(head)
          ? body.map((n) => claim(String(n)))
          : undefined,
      inspect: () => undefined,
    }))
    const base = new EvidenceBase(rules)
    clauses.forEach(({ head }, index) =>
      base.propose({
        claim: claim(String(head)),
        rule: rules[index].id,
        observations: [],
      }),
    )
    const report = base.assess(claim('5'))
    assert.ok(
      Array.isArray(report.routes),
      'Assessment must retain argument alternatives',
    )
    // Interpret the public explanation independently of the base and rule registry.
    const establishes = (entry, futureFacts) =>
      futureFacts.has(Number(entry.claim.subject)) ||
      entry.status === 'supported' ||
      entry.routes.some(
        (route) =>
          route.status !== 'rejected' &&
          route.premises.every((premise) => establishes(premise, futureFacts)),
      )
    for (let mask = 0; mask < 8; mask++) {
      const atoms = [0, 1, 2].filter((bit) => mask & (1 << bit))
      assert.equal(
        establishes(report, new Set(atoms)),
        saturate(atoms, clauses).has(5),
        `route seed=${seed}, mask=${mask}`,
      )
    }
  }
})

test('generated repairs retain failure obligations when resolution evidence expires', async () => {
  for (let seed = 1; seed <= 40; seed++) {
    const next = random(seed)
    const base = new EvidenceBase([leaf])
    const target = claim('repair lifetime')
    let epoch = 0
    const failed = []
    const passed = []
    let step = 0
    const record = async (ok, sample) => {
      const [observation] = await base.run('oracle', async () => [
        finding(target, ok, { sample }),
      ])
      if (ok) {
        base.propose({
          claim: target,
          rule: leaf.id,
          observations: [observation.id],
        })
        passed.push({ id: observation.id, sample, epoch, step })
      } else failed.push({ sample, step, resolutionEpoch: undefined })
      step++
    }
    // A deterministic prefix forces the audited transition in every campaign.
    await record(false, 0)
    await record(true, 0)
    base.resolve(1, passed[0].id)
    failed[0].resolutionEpoch = epoch
    base.advanceContext()
    epoch++
    await record(true, 1)
    assert.equal(
      base.assess(target).status,
      'contradicted',
      `stale resolution seed=${seed}`,
    )
    for (let action = 0; action < 45; action++) {
      const operation = next(4)
      if (operation === 0) await record(true, next(3))
      else if (operation === 1) await record(false, next(3))
      else if (operation === 2) {
        base.advanceContext()
        epoch++
      } else if (failed.length && passed.length) {
        const failureIndex = next(failed.length)
        const failure = failed[failureIndex]
        const replay = passed[next(passed.length)]
        const valid =
          failure.resolutionEpoch !== epoch &&
          replay.epoch === epoch &&
          replay.sample === failure.sample &&
          replay.step > failure.step
        if (valid) {
          base.resolve(failureIndex + 1, replay.id)
          failure.resolutionEpoch = epoch
        } else assert.throws(() => base.resolve(failureIndex + 1, replay.id))
      }
      const expected = failed.some(
        (failure) => failure.resolutionEpoch !== epoch,
      )
        ? 'contradicted'
        : passed.some((pass) => pass.epoch === epoch)
          ? 'supported'
          : 'unresolved'
      assert.equal(
        base.assess(target).status,
        expected,
        `repair seed=${seed}, action=${action}`,
      )
    }
  }
})

test('generated delivery permutations cannot turn an earlier measurement into a repair replay', async () => {
  for (let seed = 1; seed <= 30; seed++) {
    const next = random(seed)
    const base = new EvidenceBase([leaf])
    const target = claim('causal replay')
    const deliveries = []
    const earlier = Array.from({ length: 2 + next(5) }, (_, index) =>
      base.run(
        'oracle',
        () =>
          new Promise((resolve) => {
            deliveries[index] = () => resolve([finding(target)])
          }),
      ),
    )
    await base.run('oracle', async () => [finding(target, false)])
    const order = [...deliveries.keys()]
    while (order.length) {
      const [index] = order.splice(next(order.length), 1)
      deliveries[index]()
      const [old] = await earlier[index]
      assert.throws(
        () => base.resolve(1, old.id),
        /replay/,
        `pre-failure run seed=${seed}`,
      )
    }
    const replay = await support(base, target)
    base.resolve(1, replay.id)
    assert.equal(base.assess(target).status, 'supported')
  }
  // Batch ordering is also only delivery order, not an execution relation.
  for (const findings of [
    [false, true],
    [true, false],
  ]) {
    const base = new EvidenceBase([leaf])
    const observations = await base.run('oracle', async () =>
      findings.map((ok) => finding(claim('batch'), ok)),
    )
    assert.throws(
      () => base.resolve(1, observations.find((entry) => entry.passed).id),
      /replay/,
    )
  }
})
