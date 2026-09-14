import assert from 'node:assert/strict'
import { test } from 'node:test'
import fc from 'fast-check'
import postgres from 'postgres'
import { postgresAdapter } from '../integrated-todo/src/postgres-adapter.server.ts'
import { endpoints } from '../integrated-todo/transform.mjs'

test('preparation preserves parameter identity, query options and the pending query object', () => {
  fc.assert(
    fc.property(
      fc.array(fc.oneof(fc.string(), fc.integer(), fc.constant(null))),
      fc.option(fc.boolean(), { nil: undefined }),
      fc.boolean(),
      (params, prepare, shorthand) => {
        const calls = []
        const pending = {
          values() {
            return this
          },
        }
        const client = {
          unsafe(...args) {
            calls.push(args)
            return pending
          },
        }
        const reads = postgresAdapter(client)
        const options = Object.freeze({
          ...(prepare === undefined ? {} : { prepare }),
          marker: 'preserved',
        })
        const query = 'SELECT $1::text'
        const result = shorthand
          ? reads.unsafe(query, options)
          : reads.unsafe(query, params, options)
        assert.equal(result, pending)
        assert.equal(result.values(), pending)
        assert.equal(calls.length, 1)
        assert.equal(calls[0][0], query)
        assert.equal(calls[0][2].prepare, prepare ?? true)
        assert.equal(calls[0][2].simple, false)
        assert.equal(calls[0][2].marker, 'preserved')
        if (!shorthand) assert.equal(calls[0][1], params)
        assert.equal(reads.unsafe, reads.unsafe)
      },
    ),
    { seed: 20260912, numRuns: 100 },
  )
})

test('facade shares the app pool and delegates lifecycle, transactions and explicit opt-outs', async () => {
  const client = postgres({
    host: '127.0.0.1',
    port: 55479,
    database: 'endpoints_pipeline',
    username: 'postgres',
    password: '',
    max: 7,
    prepare: false,
  })
  const originalUnsafe = client.unsafe
  try {
    const reads = postgresAdapter(client)
    assert.equal(reads.options, client.options)
    assert.equal(reads.options.max, 7)
    assert.equal(reads.options.prepare, false)
    assert.equal(client.unsafe, originalUnsafe)
    for (const method of ['begin', 'reserve', 'end', 'listen', 'notify'])
      assert.equal(reads[method], client[method])
    // Construction and inspecting options must not open a database connection.
  } finally {
    await client.end()
  }
  const calls = []
  const raw = {
    unsafe(...args) {
      calls.push(args)
      return 'result'
    },
  }
  const reads = postgresAdapter(raw)
  reads.unsafe('SELECT 1', [], { prepare: false, simple: true })
  assert.deepEqual(calls[0][2], { prepare: false, simple: true })
  raw.unsafe('SELECT 1', [])
  assert.equal(calls[1].length, 2)
  const failure = new Error('driver error')
  raw.unsafe = () => {
    throw failure
  }
  assert.throws(
    () => reads.unsafe('SELECT 1'),
    (error) => error === failure,
  )
})

test('the adapter is allowed in the server build and rejected in the client build', async () => {
  const { build } =
    await import('../integrated-todo/node_modules/vite/dist/node/index.js')
  const entry = new URL(
    '../integrated-todo/src/postgres-adapter.server.ts',
    import.meta.url,
  ).pathname
  const config = {
    configFile: false,
    logLevel: 'silent',
    plugins: [endpoints()],
    build: { write: false, lib: { entry, formats: ['es'] } },
  }
  await assert.rejects(build(config), /ENDPOINT_SERVER_IMPORT_IN_CLIENT/)
  const result = await build({
    ...config,
    plugins: [endpoints()],
    build: { ...config.build, ssr: entry },
  })
  const outputs = Array.isArray(result) ? result : [result]
  assert.ok(
    outputs.some((output) =>
      output.output.some(
        (chunk) =>
          chunk.type === 'chunk' && chunk.exports.includes('postgresAdapter'),
      ),
    ),
  )
})
