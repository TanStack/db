import { test } from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { endpointsProbe } from '../transform.mjs'
import { specimen } from './fixtures/scalar-specimen.mjs'

test('endpoint modules compile independently of the original filename', () => {
  const result = endpointsProbe().transform(
    specimen,
    '/test/projects.endpoint.tsx',
  )
  assert.ok(result?.code.includes('__boundQuery'))
})
test('query parameters reach the server and instantiate client membership', () => {
  const source = specimen
    .replace(
      'input:z.object({})',
      'input:z.object({completed:z.boolean()}),params:{completed:false}',
    )
    .replace(
      'or(gt(items.score,0),isNull(items.score))',
      'eq(items.completed,req.body.completed)',
    )
  const result = endpointsProbe().transform(source, '/test/endpoint.tsx')
  assert.match(result.code, /"parameter":"completed"/)
  assert.match(result.code, /completed:false/)
})
test('registered query instances validate before a mutation starts', async () => {
  const { refreshRegisteredMutation, registerQuery } =
    await import('../src/registry.server.ts')
  let writes = 0,
    reads = 0
  const registry = {
    tasks: registerQuery(
      'v1',
      'todo',
      (value) => z.object({ completed: z.boolean() }).strict().parse(value),
      async (input, context) => {
        reads++
        return [{ id: context.scope, completed: input.completed }]
      },
    ),
  }
  const valid = {
    id: 'instance-a',
    definition: 'tasks',
    version: 'v1',
    params: { completed: false },
  }
  for (const requests of [
    [{ ...valid, definition: 'missing' }],
    [{ ...valid, version: 'old' }],
    [{ ...valid, params: { completed: 'no' } }],
    [valid, { ...valid, params: { completed: true } }],
    [{ ...valid, params: { completed: false, scope: 'bob' } }],
  ])
    assert.equal(
      (
        await refreshRegisteredMutation(
          requests,
          registry,
          async () => {
            writes++
          },
          { scope: 'alice' },
        )
      ).kind,
      'not-started',
    )
  assert.equal(writes, 0)
  assert.equal(reads, 0)
  const result = await refreshRegisteredMutation(
    [valid, { ...valid, id: 'instance-b', params: { completed: true } }],
    registry,
    async () => {
      writes++
      return 'written'
    },
    { scope: 'alice' },
  )
  assert.equal(writes, 1)
  assert.equal(reads, 2)
  assert.deepEqual(result.snapshots, [
    { id: 'instance-a', rows: [{ id: 'alice', completed: false }] },
    { id: 'instance-b', rows: [{ id: 'alice', completed: true }] },
  ])
})

test('server registry discovers query modules absent from the current import graph', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const dir = await mkdtemp(join(tmpdir(), 'endpoint-registry-'))
  try {
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src/lazy.endpoint.tsx'), specimen)
    const plugin = endpointsProbe()
    plugin.configResolved({ root: dir })
    const id = plugin.resolveId('virtual:endpoints-registry.server.ts')
    const code = await plugin.load.call(
      { environment: { name: 'ssr' }, addWatchFile() {} },
      id,
    )
    assert.match(code, /lazy\.endpoint\.tsx/)
    const specifier = JSON.parse(code.match(/from ("[^\n]+")/)[1])
    const definitions = await plugin.load.call(
      { environment: { name: 'ssr' } },
      specifier,
    )
    assert.match(definitions, /export const definitions/)
    assert.match(definitions, /registerQuery/)
    await assert.rejects(
      plugin.load.call({ environment: { name: 'client' } }, id),
      /SERVER_IMPORT_IN_CLIENT/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('only declared scalar parameters enter the optimistic predicate', () => {
  for (const [schema, predicate] of [
    ['threshold:z.number().int()', 'gt(items.score,req.body.threshold)'],
    ['label:z.string()', 'eq(items.label,req.body.label)'],
  ]) {
    const source = specimen
      .replace(
        'input:z.object({})',
        `input:z.object({${schema}}),params:values`,
      )
      .replace('or(gt(items.score,0),isNull(items.score))', predicate)
    assert.match(
      endpointsProbe().transform(source, '/test/endpoint.tsx').code,
      /"parameter":/,
    )
  }
  for (const [schema, predicate] of [
    ['threshold:z.number()', 'gt(items.score,req.body.threshold)'],
    ['threshold:z.string()', 'gt(items.score,req.body.threshold)'],
    ['completed:z.boolean()', 'eq(items.completed,req.body.other)'],
  ]) {
    const source = specimen
      .replace(
        'input:z.object({})',
        `input:z.object({${schema}}),params:values`,
      )
      .replace('or(gt(items.score,0),isNull(items.score))', predicate)
    assert.throws(
      () => endpointsProbe().transform(source, '/test/endpoint.tsx'),
      /ENDPOINT_BOUND_UNSUPPORTED/,
    )
  }
})

test('nested query modules resolve shared runtime and relation bindings', () => {
  const nested = specimen
    .replace("from './runtime'", "from '../runtime'")
    .replace("from './database.server'", "from '../database.server'")
  const parent = endpointsProbe().transform(
    specimen,
    '/test/src/endpoint.tsx',
  ).code
  const child = endpointsProbe().transform(
    nested,
    '/test/src/lazy/items.endpoint.ts',
  ).code
  const relation = (code) => code.match(/"relation":"([^"]+)"/)[1]
  assert.equal(relation(parent), relation(child))
  assert.match(child, /\/test\/src\/registry\.server\.ts/)
})
