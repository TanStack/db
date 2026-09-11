import { createHash } from 'node:crypto'
import traverseModule from '@babel/traverse'
import MagicString, { Bundle } from 'magic-string'
import { extract } from '../track-a-analysis/probe.mjs'

const traverse = traverseModule.default ?? traverseModule
const fail = (message, node) => { throw new Error(`ENDPOINT_BOUND_UNSUPPORTED ${message} at ${node.loc.start.line}:${node.loc.start.column + 1}`) }
const inside = (node, parent) => node.start >= parent.start && node.end <= parent.end

// Server code may use its own locals, module imports and these ordinary globals.
// In particular, component state, props and dbClient cannot cross this boundary.
function checkCaptures(path) {
  const check = reference => {
    const binding = reference.scope.getBinding(reference.node.name)
    if (binding && (inside(binding.path.node, path.node) || binding.path.isImportSpecifier() || binding.path.isImportDefaultSpecifier() || binding.path.isImportNamespaceSpecifier())) return
    if (!binding && ['undefined', 'Date', 'Error', 'Promise', 'JSON', 'Math'].includes(reference.node.name)) return
    fail(`server code captures ${reference.node.name}`, reference.node)
  }
  if (path.isReferencedIdentifier()) check(path)
  path.traverse({ ReferencedIdentifier: check })
}

export function transformBoundEndpoints(code, id, ast) {
  const importsEndpoints = ast.program.body.some(node => node.type === 'ImportDeclaration' && node.source.value === './runtime' && node.specifiers.some(s => s.type === 'ImportSpecifier' && s.imported.name === 'endpoints'))
  if (!importsEndpoints) return
  if (!ast.program.body.some(node => node.type === 'ImportDeclaration' && node.source.value === 'zod' && node.specifiers.some(s => s.type === 'ImportSpecifier' && s.imported.name === 'z' && s.local.name === 'z'))) fail('z must be imported from zod', ast.program)
  const declarations = []
  const usedCalls = new Set()
  traverse(ast, { VariableDeclarator(path) {
    const node = path.node
    if (node.init?.type !== 'CallExpression' || node.init.callee.type !== 'Identifier') return
    const factory = path.scope.getBinding(node.init.callee.name)
    if (!factory?.path.isImportSpecifier() || factory.path.node.imported.name !== 'endpoints' || factory.path.parent.source.value !== './runtime') return
    const component = path.findParent(parent => parent.isFunctionDeclaration())
    if (!component?.node.id || path.parentPath.parentPath.node !== component.node.body || path.parent.kind !== 'const' || path.parent.declarations.length !== 1) fail('bind endpoints in a component function body', node)
    if (node.init.arguments.length !== 1 || node.init.arguments[0].type !== 'Identifier' || node.id.type !== 'ObjectPattern') fail('use const { query, mutation } = endpoints(dbClient)', node)
    const properties = node.id.properties
    if (properties.length !== 2 || properties.some(p => p.type !== 'ObjectProperty' || p.computed || p.key.type !== 'Identifier' || p.value.type !== 'Identifier' || p.key.name !== p.value.name) || properties.map(p => p.key.name).sort().join(',') !== 'mutation,query') fail('bind query and mutation without aliases', node)
    usedCalls.add(node.init)
    for (const property of properties) {
      const binding = path.scope.getBinding(property.key.name)
      for (const reference of binding.referencePaths) {
        const call = reference.parentPath
        const declaration = call.parentPath
        if (!call.isCallExpression() || call.node.callee !== reference.node || !declaration.isVariableDeclarator() || declaration.node.init !== call.node || declaration.parent.kind !== 'const' || declaration.parent.declarations.length !== 1 || declaration.parentPath.parentPath.node !== component.node.body || declaration.node.id.type !== 'Identifier') fail('declare endpoints directly in the component body', reference.node)
        const kind = property.key.name
        if (call.node.arguments.length !== 1 || call.node.arguments[0].type !== 'ObjectExpression') fail('endpoint needs an inline object', call.node)
        const options = call.get('arguments.0.properties')
        if (options.some(p => p.node.computed || p.node.key?.type !== 'Identifier')) fail('computed or spread endpoint options', call.node)
        const values = Object.fromEntries(options.map(p => [p.node.key.name, p]))
        const expected = kind === 'query' ? ['handler', 'input'] : ['handler', 'input', 'onMutate']
        if (options.length !== expected.length || Object.keys(values).sort().join() !== expected.join() || !values.input.isObjectProperty() || !values.handler.isObjectMethod() || !values.handler.node.async || values.handler.node.generator || (values.onMutate && (!values.onMutate.isObjectMethod() || values.onMutate.node.async || values.onMutate.node.generator))) fail('use input, async handler and synchronous onMutate', call.node)
        checkCaptures(values.input.get('value'))
        checkCaptures(values.handler)
        values.handler.traverse({ ThisExpression(p) { fail('server method receiver', p.node) }, Super(p) { fail('server method receiver', p.node) } })
        let order
        if (kind === 'query') {
          for (const name of ['db', 'todo', 'requireUser', 'asc', 'eq']) {
            const imported = values.handler.scope.getBinding(name)
            const source = ['asc', 'eq'].includes(name) ? 'drizzle-orm' : './database.server'
            if (!imported?.path.isImportSpecifier() || imported.path.node.imported.name !== name || imported.path.parent.source.value !== source) fail(`untrusted query binding ${name}`, call.node)
          }
          const facts = extract("import {asc,eq} from 'drizzle-orm';\nimport {db,todo,query,requireUser} from './fixture-bindings';\nexport const listTodos=query({" + code.slice(values.handler.node.start, values.handler.node.end) + '})')
          if (facts.status !== 'checked' || facts.orders.some(field => !facts.fields.some(selected => selected.name === field))) fail(`ENDPOINT_ORDER_NOT_CHECKED ${facts.reason ?? 'sort column must be selected'}`, values.handler.node)
          order = facts.orders
        }
        usedCalls.add(call.node)
        declarations.push({ call: call.node, values, kind, client: node.init.arguments[0].name, name: declaration.node.id.name, owner: component.node.id.name, order })
      }
    }
  } })
  // Reject aliases/rebinding or calls the supported binder did not recognize.
  traverse(ast, { CallExpression(path) {
    if (path.node.callee.type === 'Identifier' && ['endpoints', 'query', 'mutation'].includes(path.node.callee.name) && !usedCalls.has(path.node)) fail('unrecognized endpoint binding or call', path.node)
  } })
  if (!declarations.length) fail('no bound endpoints found', ast.program)
  if (/\b__bound[A-Za-z0-9_]*\b/.test(code)) fail('reserved generated binding', ast.program)
  const original = new MagicString(code, { filename: id })
  const bundle = new Bundle({ separator: '' })
  const append = text => bundle.append(text)
  const source = (start, end) => bundle.addSource({ content: original.snip(start, end) })
  const method = node => { append(node.async ? 'async function' : 'function'); source(node.key.end, node.end) }
  const revision = createHash('sha256').update(code).digest('hex')
  const moduleId = createHash('sha256').update(id.split('?')[0]).digest('hex').slice(0, 12)
  append("import {createServerFn as __boundServerFn} from '@tanstack/react-start';\nimport {bindQuery as __boundQuery,bindMutation as __boundMutation} from './runtime';\n")
  for (const [index, entry] of declarations.entries()) {
    entry.rpc = `__boundRpc${index}`
    append(`const ${entry.rpc}=__boundServerFn({method:'POST'}).inputValidator(z.object({scope:z.enum(['alice','bob']),input:`)
    source(entry.values.input.node.value.start, entry.values.input.node.value.end)
    append('})).handler(async ({data})=>(')
    method(entry.values.handler.node)
    append(`)({body:data.input,scope:data.scope,kind:'${entry.kind}',endpointSourceHash:'${revision}'},{json:value=>value}));\n`)
  }
  let cursor = 0
  for (const entry of declarations.sort((a, b) => a.call.start - b.call.start)) {
    source(cursor, entry.call.start)
    const key = JSON.stringify(`${moduleId}:${entry.owner}:${entry.name}`)
    if (entry.kind === 'query') append(`__boundQuery(${entry.client},${key},${entry.rpc},${JSON.stringify(entry.order)})`)
    else {
      append(`__boundMutation(${entry.client},${key},${entry.rpc},`)
      method(entry.values.onMutate.node)
      append(')')
    }
    cursor = entry.call.end
  }
  source(cursor, code.length)
  return { code: bundle.toString(), map: bundle.generateMap({ hires: true, includeContent: true }) }
}
