import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { parse } from '@babel/parser'
import fc from 'fast-check'
import { Evidence } from './oracles/evidence.mjs'

// Execute the actual caller blocks with controlled I/O. The optional historical
// source lets the same contract demonstrate its RED without editing the checkout.
async function source(name) {
  if (process.env.ENDPOINT_BOUNDARY_REVISION)
    return execFileSync(
      'git',
      [
        'show',
        `${process.env.ENDPOINT_BOUNDARY_REVISION}:probes/endpoints/integrated-todo/tests/oracles/${name}`,
      ],
      { encoding: 'utf8' },
    )
  return readFile(new URL('./oracles/' + name, import.meta.url), 'utf8')
}
function nodes(source) {
  const result = []
  function walk(value) {
    if (!value || typeof value !== 'object') return
    if (value.type) result.push(value)
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(walk)
      else if (child && typeof child === 'object') walk(child)
    }
  }
  walk(parse(source, { sourceType: 'module' }))
  return result
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('the dependency property rejects an earlier different failure before visiting later histories', async () => {
  const text = await source('dependencies.mjs'),
    ast = nodes(text)
  const node =
    ast.find(
      (n) => n.type === 'FunctionDeclaration' && n.id.name === 'scenario',
    ) ??
    ast.find(
      (n) =>
        n.type === 'ArrowFunctionExpression' &&
        n.params.map((p) => p.name).join(',') === 'program,histories',
    )
  assert.ok(node)
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 9 }), async (value) => {
      const evidence = new Evidence('dependency-caller'),
        visited = []
      const run = (program, step) =>
        evidence.run({ program, step }, () => {
          visited.push(step.law)
          evidence.check(step.law, value, 0, { checkpoint: 'same-turn' })
        })
      const scenario = new Function(
        'evidence',
        'run',
        `return (${text.slice(node.start, node.end)})`,
      )(evidence, run)
      await assert.rejects(scenario({}, [{ law: 'rows' }]))
      await assert.doesNotReject(
        scenario({}, [{ law: 'other' }, { law: 'rows' }]),
      )
      assert.deepEqual(visited, ['rows', 'other'])
    }),
    { numRuns: 10 },
  )
})

test('the concurrent checkpoint preserves the complete drained publication batch before a mismatch', async () => {
  const text = await source('concurrent.mjs'),
    n = nodes(text).find(
      (n) => n.type === 'FunctionDeclaration' && n.id.name === 'checkpoint',
    )
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (count) => {
      const evidence = new Evidence('event-caller'),
        expected = [[{ id: 'r', text: 'right' }]]
      const events = Array.from({ length: count }, (_, ordinal) => ({
        index: 0,
        ordinal,
        rows: [[{ id: 'r', text: 'wrong' }]],
        changes: [
          { type: 'update', key: 'r', value: { id: 'r', text: 'wrong' } },
        ],
      }))
      const queue = structuredClone(events)
      const checkpoint = new Function(
        'driver',
        'program',
        'page',
        'evidence',
        'folded',
        'report',
        `return (${text.slice(n.start, n.end)})`,
      )(
        { reference: { expected: async () => expected } },
        {},
        { evaluate: async () => queue.splice(0) },
        evidence,
        [new Map()],
        {},
      )
      await assert.rejects(
        evidence.run({}, () => checkpoint('delivered 0, sibling held')),
      )
      assert.deepEqual(evidence.original.failure.trace?.[0]?.events, events)
      events[0].changes[0].value.text = 'mutated during cleanup'
      assert.equal(
        evidence.original.failure.trace[0].events[0].changes[0].value.text,
        'wrong',
      )
    }),
    { numRuns: 10 },
  )
})

test('response observation failures remain secondary evidence when a row assertion fails first', async () => {
  const text = await source('driver.mjs'),
    node = nodes(text).find(
      (n) =>
        n.type === 'CallExpression' &&
        n.callee.type === 'MemberExpression' &&
        n.callee.object.name === 'page' &&
        text.slice(n.start, n.end).includes('this.assertNoServer(body'),
    )
  const arrow = node.arguments[1],
    evidence = new Evidence('response-caller'),
    responses = [],
    errors = []
  const handler = new Function(
    'responses',
    'errors',
    `return (${text.slice(arrow.start, arrow.end)})`,
  ).call({ evidence }, responses, errors)
  const gate = deferred()
  await assert.rejects(
    evidence.run({}, async () => {
      try {
        handler({
          request: () => ({ resourceType: () => 'script' }),
          status: () => 200,
          text: async () => {
            await gate.promise
            throw Error('secondary response failure')
          },
        })
        evidence.check('rows', [9], [1], { checkpoint: 'same-turn' })
      } finally {
        gate.resolve()
        await evidence.settled('responses', responses)
      }
    }),
  )
  assert.equal(evidence.original.failure.law, 'rows')
  assert.match(
    evidence.cleanupErrors[0]?.error ?? '',
    /secondary response failure/,
  )
})

test('a delivery checkpoint cannot complete while client receipt processing is held', async () => {
  const text = await source('concurrent.mjs'),
    n = nodes(text).find(
      (n) =>
        n.type === 'IfStatement' &&
        text.slice(n.test.start, n.test.end) ===
          'position < delivery.length - 1',
    )
  const gate = deferred(),
    evidence = new Evidence('delivery-caller')
  const window = {
    endpointOracle: {
      receipts: [],
      outcomes: { a: { result: 'pending' }, b: { result: 'pending' } },
    },
  }
  const page = {
    waitForTimeout: async () => {},
    evaluate: async (fn, arg) =>
      new Function('window', 'arg', `return (${fn})(arg)`)(window, arg),
  }
  let checkpointReached = false
  const driver = {
    async until(predicate) {
      assert.equal(await predicate(), false)
      await gate.promise
      assert.equal(await predicate(), true)
    },
  }
  const operation = { input: { token: 'a' } }
  const work = new Function(
    'driver',
    'page',
    'evidence',
    'operation',
    'assert',
    'checkpoint',
    'index',
    `return (async()=>${text.slice(n.consequent.start, n.consequent.end)})()`,
  )(
    driver,
    page,
    evidence,
    operation,
    assert,
    async () => {
      checkpointReached = true
    },
    0,
  )
  try {
    await new Promise(setImmediate)
    assert.equal(checkpointReached, false)
  } finally {
    window.endpointOracle.receipts.push('a')
    gate.resolve()
    await work
  }
  assert.equal(checkpointReached, true)
})

test('every runtime mutant applies once to current source and retains valid TypeScript', async () => {
  const { applyRuntimeMutant, runtimeMutants } = await import(
    './oracles/faults.mjs'
  )
  const runtime = await readFile(
    new URL('../src/runtime.ts', import.meta.url),
    'utf8',
  )
  for (const name of runtimeMutants) {
    const result = applyRuntimeMutant(runtime, name)
    assert.notEqual(result.source, runtime)
    assert.ok(
      result.source.includes(
        `__endpointOracleFault?.(${JSON.stringify(name)})`,
      ),
    )
    assert.doesNotThrow(() =>
      parse(result.source, { sourceType: 'module', plugins: ['typescript'] }),
    )
  }
})

test('the live source-map boundary accepts empty client maps and rejects server source graphs', async () => {
  const { Driver } = await import('./oracles/driver.mjs')
  const check = (map) =>
    Driver.prototype.assertNoServer.call(
      {},
      `//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`,
      'inline fixture',
    )
  assert.doesNotThrow(() =>
    check({ sources: ['client.ts'], sourcesContent: [null] }),
  )
  assert.throws(
    () => check({ sources: ['database.server.ts'], sourcesContent: [null] }),
    /server|source/i,
  )
})
