import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { endpoints } from '../transform.mjs'
const compilerPlugin = () => endpoints().find((plugin) => plugin.transform)
const traverse = traverseModule.default ?? traverseModule
const source = readFileSync(
  new URL('../src/endpoint.tsx', import.meta.url),
  'utf8',
)
const compile = (code) =>
  compilerPlugin().transform(code, '/test/endpoint.tsx').code
function order(code) {
  const ast = parse(compile(code), {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  })
  let value
  traverse(ast, {
    CallExpression(path) {
      if (path.node.callee.name === '__boundQuery')
        value = path.node.arguments[3].properties
          .find((p) => p.key.value === 'order')
          .value.elements.map((n) => n.value)
    },
  })
  return value
}
test('component declarations carry server order in priority order', () => {
  assert.deepEqual(order(source), ['createdAt', 'id'])
  assert.deepEqual(
    order(
      source.replace(
        /orderBy\(asc\(todo.createdAt\),\s*asc\(todo.id\)\)/,
        'orderBy(asc(todo.id), asc(todo.createdAt))',
      ),
    ),
    ['id', 'createdAt'],
  )
})
test('sort columns must be selected', () =>
  assert.throws(
    () => compile(source.replace('createdAt: todo.createdAt,', '')),
    /ENDPOINT_ORDER_NOT_CHECKED/,
  ))
test('unsupported direction cannot silently lose client ordering', () =>
  assert.throws(
    () =>
      compile(
        source
          .replace(
            /import \{ ([^}]+) \} from 'drizzle-orm'/,
            "import { $1, desc } from 'drizzle-orm'",
          )
          .replace('asc(todo.createdAt)', 'desc(todo.createdAt)'),
      ),
    /ENDPOINT_ORDER_NOT_CHECKED/,
  ))
test('transformed responses cannot borrow intermediate query ordering', () =>
  assert.throws(
    () =>
      compile(source.replace('res.json(todos)', 'res.json(todos.reverse())')),
    /ENDPOINT_ORDER_NOT_CHECKED/,
  ))
test('server handler cannot capture the bound client', () =>
  assert.throws(
    () =>
      compile(
        source.replace('await beforeWrite()', 'await beforeWrite(dbClient)'),
      ),
    /server code captures dbClient/,
  ))
test('server handler cannot capture component state', () =>
  assert.throws(
    () =>
      compile(
        source.replace('await beforeWrite()', 'await beforeWrite(status)'),
      ),
    /server code captures status/,
  ))
test('input validator cannot capture component state', () =>
  assert.throws(
    () => compile(source.replace('min(1)', 'min(text.length)')),
    /server code captures text/,
  ))
test('optimistic callback stays within the component while RPCs move to module scope', () => {
  const output = compile(source)
  assert.ok(
    output.indexOf('const __boundRpc0') <
      output.indexOf('export function TodoApp'),
  )
  assert.ok(
    output.indexOf('listTodos.insert') >
      output.indexOf('export function TodoApp'),
  )
  assert.match(output, /__boundMutation\(dbClient,/)
})

test('a row predicate is carried as data without the server auth expression', () => {
  const filtered = source.replace(
    '.where(eq(todo.userId, user.id))',
    '.where(and(eq(todo.userId, user.id), eq(todo.completed, false)))',
  )
  assert.notEqual(filtered, source)
  assert.match(
    compile(filtered),
    /"membership":\{"kind":"completed","value":false\}/,
  )
})
test('unsupported query arguments fail before generating an incorrectly scoped request', () => {
  assert.throws(
    () =>
      compile(
        source.replace(
          'input: z.object({}),',
          'input: z.object({status:z.boolean()}),',
        ),
      ),
    /empty query arguments only/,
  )
})

test('same local names in separate lexical scopes have distinct stable identities', () => {
  const source = readFileSync(
    new URL('./fixtures/repeated-names.tsx', import.meta.url),
    'utf8',
  )
  const keys = (code) =>
    [...compile(code).matchAll(/__boundQuery\(dbClient,"([^"]+)"/g)].map(
      (match) => match[1],
    )
  assert.equal(keys(source).length, 2)
  assert.equal(new Set(keys(source)).size, 2)
  assert.deepEqual(keys(source), keys(source))
})

test('non-endpoint instrumentation does not change declaration identities', () => {
  const keys = (code) =>
    [...compile(code).matchAll(/__boundQuery\(dbClient,"([^"]+)"/g)].map(
      (match) => match[1],
    )
  assert.deepEqual(
    keys(source),
    keys("import { probe } from './probe';\n" + source),
  )
})

test('build-time schema dependencies never become client module dependencies', () => {
  const plugin = compilerPlugin()
  const clientDependencies = []
  plugin.transform.call(
    {
      environment: { name: 'client' },
      addWatchFile: (file) => clientDependencies.push(file),
    },
    source,
    '/test/endpoint.tsx',
  )
  assert.deepEqual(clientDependencies, [])
})

test('server logging remains inside the handler boundary', () => {
  const output = compile(
    source.replace(
      'await beforeWrite()',
      "console.info('server-log'); await beforeWrite()",
    ),
  )
  assert.match(output, /console.info\('server-log'\)/)
  assert.throws(
    () =>
      compile(
        source.replace(
          'await beforeWrite()',
          "const console = status; console.info('server-log'); await beforeWrite()",
        ),
      ),
    /server code captures status/,
  )
})
