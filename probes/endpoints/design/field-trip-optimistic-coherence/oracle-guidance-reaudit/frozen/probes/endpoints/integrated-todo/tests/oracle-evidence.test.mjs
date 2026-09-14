import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Evidence } from './oracles/evidence.mjs'
import fc from 'fast-check'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shrinking retains the same law, checkpoint, operation and differing collection', async () => {
  const e = new Evidence('test')
  const fail = (law, actual, context = {}) =>
    e.run({ actual }, () =>
      e.check(law, actual, [[1], [2]], {
        checkpoint: 'optimistic',
        operation: 'edit',
        ...context,
      }),
    )
  await assert.rejects(fail('rows', [[9], [2]]))
  await fail('read-count', [[9], [2]])
  await fail('rows', [[1], [9]])
  await fail('rows', [[9], [2]], { checkpoint: 'settled' })
  await e.run({}, () => {
    throw Error('build failed')
  })
  await assert.rejects(fail('rows', [[3], [2]]))
  assert.equal(e.rejectedShrinks.length, 4)
  assert.deepEqual(e.original.input.actual, [[9], [2]])
  assert.deepEqual(e.reduced.input.actual, [[3], [2]])
})

test('cleanup preserves the frozen mismatch and attempts every release after failures', async () => {
  const e = new Evidence('test'),
    released = [],
    actual = [[9]]
  await assert.rejects(
    e.run({}, async () => {
      try {
        e.check('rows', actual, [[1]], { checkpoint: 'immediate' })
      } finally {
        actual[0][0] = 1
        await e.cleanup('first', () => {
          released.push('first')
          throw Error('close failed')
        })
        await e.cleanup('second', () => {
          released.push('second')
        })
        await e.settled('pending', [
          Promise.reject(Error('late close')),
          Promise.resolve(),
        ])
      }
    }),
    /rows/,
  )
  assert.deepEqual(released, ['first', 'second'])
  assert.deepEqual(e.original.failure.actual, [[9]])
  assert.deepEqual(
    e.cleanupErrors.map((item) => item.name),
    ['first', 'pending:0'],
  )
})

test('replay distinguishes the original violation, a different failure and a repaired history', async () => {
  const packet = {
    reduced: {
      input: { value: 9 },
      failure: { law: 'rows', checkpoint: 'immediate', difference: [] },
    },
  }
  for (const mode of ['same', 'different', 'fixed']) {
    const e = new Evidence('test')
    const run = e.replay(packet, (input) =>
      e.run(input, () =>
        mode === 'fixed'
          ? undefined
          : e.check(mode === 'same' ? 'rows' : 'other', input.value, 1, {
              checkpoint: 'immediate',
            }),
      ),
    )
    if (mode === 'fixed') await run
    else await assert.rejects(run)
    assert.equal(
      e.replayVerdict,
      {
        same: 'same-violation',
        different: 'different-failure',
        fixed: 'passes',
      }[mode],
    )
  }
})

test('fast-check cannot shrink a row failure into a build failure', async () => {
  const options = { seed: 9142602, numRuns: 1, examples: [[9]] }
  const value = fc.integer({ min: 0, max: 9 })
  const broken = await fc.check(
    fc.asyncProperty(value, async (n) => {
      if (n < 5) throw Error('build failed')
      assert.equal(n, 1, 'rows')
    }),
    options,
  )
  assert.deepEqual(broken.counterexample, [0])
  assert.match(broken.error, /build failed/)

  const evidence = new Evidence('shrinking-control')
  const checked = await fc.check(
    fc.asyncProperty(value, (n) =>
      evidence.run({ n }, () => {
        if (n < 5) throw Error('build failed')
        evidence.check('rows', n, 1, { checkpoint: 'same-turn' })
      }),
    ),
    options,
  )
  assert.deepEqual(checked.counterexample, [5])
  assert.equal(evidence.original.input.n, 9)
  assert.equal(evidence.reduced.input.n, 5)
  assert.ok(evidence.rejectedShrinks.length > 0)
  assert.equal(evidence.reduced.failure.law, 'rows')
})

test('the persisted final verdict includes teardown failures after successful comparisons', async () => {
  const evidence = new Evidence('teardown-control')
  const output = await mkdtemp(join(tmpdir(), 'oracle-evidence-'))
  const previousExitCode = process.exitCode
  try {
    evidence.check('rows', [1], [1], { checkpoint: 'settled' })
    await evidence.cleanup('resource', () => {
      throw Error('close failed')
    })
    await evidence.finish({ ok: true }, output)
    const report = JSON.parse(
      await readFile(join(output, 'report.json'), 'utf8'),
    )
    assert.equal(report.ok, false)
    assert.equal(report.outcome, 'cleanup-failure')
    assert.equal(report.evidence.cleanupErrors[0].name, 'resource')
  } finally {
    process.exitCode = previousExitCode
    await rm(output, { recursive: true, force: true })
  }
})

test('a nested runner cannot hide an earlier different failure and accept a later matching failure', async () => {
  const evidence = new Evidence('nested-runner')
  await assert.rejects(
    evidence.run({ case: 'original' }, () =>
      evidence.check('rows', 9, 1, { checkpoint: 'immediate' }),
    ),
  )
  let reachedLaterComparison = false
  await assert.doesNotReject(
    evidence.run({ case: 'shrink' }, async () => {
      await evidence.run({ case: 'inner' }, () =>
        evidence.check('other-law', 9, 1, { checkpoint: 'immediate' }),
      )
      reachedLaterComparison = true
      evidence.check('rows', 5, 1, { checkpoint: 'immediate' })
    }),
  )
  assert.equal(reachedLaterComparison, false)
  assert.equal(evidence.reduced.input.case, 'original')
})

test('a requested fault that survives or is never reached cannot report a passing control', async () => {
  const output = await mkdtemp(join(tmpdir(), 'oracle-fault-'))
  const priorFault = process.env.ENDPOINT_ORACLE_TEST_FAULT
  const priorExit = process.exitCode
  try {
    process.env.ENDPOINT_ORACLE_TEST_FAULT = 'unit-control'
    for (const reached of [false, true]) {
      const evidence = new Evidence('fault-control')
      if (reached) evidence.fault('unit-control')
      const report = { ok: true }
      await evidence.finish(report, output)
      assert.equal(report.ok, false)
      assert.equal(
        report.outcome,
        reached ? 'fault-survived' : 'fault-unreached',
      )
    }
  } finally {
    if (priorFault === undefined) delete process.env.ENDPOINT_ORACLE_TEST_FAULT
    else process.env.ENDPOINT_ORACLE_TEST_FAULT = priorFault
    process.exitCode = priorExit
    await rm(output, { recursive: true, force: true })
  }
})
