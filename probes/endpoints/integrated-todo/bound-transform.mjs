import { createHash } from 'node:crypto'
import traverseModule from '@babel/traverse'
import MagicString, { Bundle } from 'magic-string'
import { analyzeScalarQuery } from './scalar-query.mjs'
import { dirname, resolve } from 'node:path'
import { analyzeHandlerDependencies } from './handler-dependencies.mjs'
import { compileDependencies } from './compiled-dependencies.mjs'
import { compileFunctionDependencies } from './function-dependencies.mjs'
import { compileInlineDependencies } from './inline-dependencies.mjs'

const traverse = traverseModule.default ?? traverseModule
const fail = (message, node) => {
  throw new Error(
    `ENDPOINT_BOUND_UNSUPPORTED ${message} at ${node.loc.start.line}:${
      node.loc.start.column + 1
    }`,
  )
}
const inside = (node, parent) =>
  node.start >= parent.start && node.end <= parent.end

// Server code may use its own locals, module imports and these ordinary globals.
// In particular, component state, props and dbClient cannot cross this boundary.
function checkCaptures(path) {
  const check = (reference) => {
    const binding = reference.scope.getBinding(reference.node.name)
    if (
      binding &&
      (inside(binding.path.node, path.node) ||
        binding.path.isImportSpecifier() ||
        binding.path.isImportDefaultSpecifier() ||
        binding.path.isImportNamespaceSpecifier())
    )
      return
    if (
      !binding &&
      [
        'undefined',
        'Date',
        'Error',
        'Promise',
        'JSON',
        'Math',
        'console',
      ].includes(reference.node.name)
    )
      return
    fail(`server code captures ${reference.node.name}`, reference.node)
  }
  if (path.isReferencedIdentifier()) check(path)
  path.traverse({ ReferencedIdentifier: check })
}

export function transformBoundEndpoints(
  code,
  id,
  ast,
  { root = process.cwd(), snapshot = null } = {},
) {
  const runtimeImport = ast.program.body.find(
    (node) =>
      node.type === 'ImportDeclaration' &&
      /^\.\.?\/(?:.*\/)?runtime(?:\.ts)?$/.test(node.source.value) &&
      node.specifiers.some(
        (s) => s.type === 'ImportSpecifier' && s.imported.name === 'endpoints',
      ),
  )
  if (!runtimeImport) return
  const runtimeSource = runtimeImport.source.value
  const runtimeDirectory = dirname(resolve(dirname(id), runtimeSource))
  if (
    !ast.program.body.some(
      (node) =>
        node.type === 'ImportDeclaration' &&
        node.source.value === 'zod' &&
        node.specifiers.some(
          (s) =>
            s.type === 'ImportSpecifier' &&
            s.imported.name === 'z' &&
            s.local.name === 'z',
        ),
    )
  )
    fail('z must be imported from zod', ast.program)
  const declarations = []
  const usedCalls = new Set()
  traverse(ast, {
    VariableDeclarator(path) {
      const node = path.node
      if (
        node.init?.type !== 'CallExpression' ||
        node.init.callee.type !== 'Identifier'
      )
        return
      const factory = path.scope.getBinding(node.init.callee.name)
      if (
        !factory?.path.isImportSpecifier() ||
        factory.path.node.imported.name !== 'endpoints' ||
        factory.path.parent.source.value !== runtimeSource
      )
        return
      const component = path.findParent((parent) =>
        parent.isFunctionDeclaration(),
      )
      if (
        !component?.node.id ||
        path.parentPath.parentPath.node !== component.node.body ||
        path.parent.kind !== 'const' ||
        path.parent.declarations.length !== 1
      )
        fail('bind endpoints in a component function body', node)
      if (
        node.init.arguments.length !== 1 ||
        node.init.arguments[0].type !== 'Identifier' ||
        node.id.type !== 'ObjectPattern'
      )
        fail('use const { query, mutation } = endpoints(dbClient)', node)
      const properties = node.id.properties
      if (
        properties.length !== 2 ||
        properties.some(
          (p) =>
            p.type !== 'ObjectProperty' ||
            p.computed ||
            p.key.type !== 'Identifier' ||
            p.value.type !== 'Identifier' ||
            p.key.name !== p.value.name,
        ) ||
        properties
          .map((p) => p.key.name)
          .sort()
          .join(',') !== 'mutation,query'
      )
        fail('bind query and mutation without aliases', node)
      usedCalls.add(node.init)
      for (const property of properties) {
        const binding = path.scope.getBinding(property.key.name)
        for (const reference of binding.referencePaths) {
          const call = reference.parentPath
          const declaration = call.parentPath
          if (
            !call.isCallExpression() ||
            call.node.callee !== reference.node ||
            !declaration.isVariableDeclarator() ||
            declaration.node.init !== call.node ||
            declaration.parent.kind !== 'const' ||
            declaration.parent.declarations.length !== 1 ||
            declaration.parentPath.parentPath.node !== component.node.body ||
            declaration.node.id.type !== 'Identifier'
          )
            fail(
              'declare endpoints directly in the component body',
              reference.node,
            )
          const kind = property.key.name
          if (
            call.node.arguments.length !== 1 ||
            call.node.arguments[0].type !== 'ObjectExpression'
          )
            fail('endpoint needs an inline object', call.node)
          const options = call.get('arguments.0.properties')
          if (
            options.some(
              (p) => p.node.computed || p.node.key?.type !== 'Identifier',
            )
          )
            fail('computed or spread endpoint options', call.node)
          const values = Object.fromEntries(
            options.map((p) => [p.node.key.name, p]),
          )
          const expected =
            kind === 'query'
              ? [
                  'handler',
                  'input',
                  ...(values.params ? ['params'] : []),
                  ...(values.schema ? ['schema'] : []),
                ]
              : ['handler', 'input', 'onMutate']
          if (
            options.length !== expected.length ||
            Object.keys(values).sort().join() !== expected.join() ||
            !values.input.isObjectProperty() ||
            !values.handler.isObjectMethod() ||
            !values.handler.node.async ||
            values.handler.node.generator ||
            (values.onMutate &&
              (!values.onMutate.isObjectMethod() ||
                values.onMutate.node.async ||
                values.onMutate.node.generator))
          )
            fail('use input, async handler and synchronous onMutate', call.node)
          if (values.schema) {
            if (!values.schema.isObjectProperty())
              fail('schema must be a value', values.schema.node)
            checkCaptures(values.schema.get('value'))
          }
          checkCaptures(values.input.get('value'))
          checkCaptures(values.handler)
          values.handler.traverse({
            ThisExpression(p) {
              fail('server method receiver', p.node)
            },
            Super(p) {
              fail('server method receiver', p.node)
            },
          })
          let model
          if (kind === 'query') {
            const input = values.input.node.value
            if (
              input.type !== 'CallExpression' ||
              input.callee.type !== 'MemberExpression' ||
              input.callee.object.name !== 'z' ||
              input.callee.property.name !== 'object' ||
              input.arguments.length !== 1 ||
              input.arguments[0].type !== 'ObjectExpression'
            )
              fail('query inputs require a bounded z.object schema', input)
            const parameters = {}
            for (const property of input.arguments[0].properties) {
              if (
                property.type !== 'ObjectProperty' ||
                property.computed ||
                property.key.type !== 'Identifier' ||
                ['__proto__', 'constructor', 'prototype'].includes(
                  property.key.name,
                )
              )
                fail('unsupported query input field', property)
              let schema = property.value
              let integer = false
              if (
                schema.type === 'CallExpression' &&
                schema.callee.type === 'MemberExpression' &&
                schema.callee.property.name === 'int' &&
                schema.arguments.length === 0
              ) {
                integer = true
                schema = schema.callee.object
              }
              if (
                schema.type !== 'CallExpression' ||
                schema.callee.type !== 'MemberExpression' ||
                schema.callee.object.name !== 'z' ||
                !['boolean', 'string', 'number'].includes(
                  schema.callee.property.name,
                ) ||
                schema.arguments.length ||
                (schema.callee.property.name === 'number' && !integer)
              )
                fail(
                  'query inputs support boolean, string and integer fields',
                  property,
                )
              parameters[property.key.name] = schema.callee.property.name
            }
            if (Object.keys(parameters).length && !values.params)
              fail(
                'query input fields require params (empty query arguments only without params)',
                input,
              )
            if (values.params && !values.params.isObjectProperty())
              fail('params must be a client value', values.params.node)
            try {
              model = analyzeScalarQuery(values.handler, fail, parameters)
              model.relation =
                createHash('sha256')
                  .update(
                    resolve(
                      dirname(id),
                      values.handler.scope
                        .getBinding('db')
                        .path.parent.source.value.replace(/\.ts$/, ''),
                    ),
                  )
                  .digest('hex')
                  .slice(0, 12) +
                ':' +
                model.relation
            } catch (error) {
              if (
                !values.schema ||
                !String(error).includes('ENDPOINT_ORDER_NOT_CHECKED')
              )
                throw error
              // Unanalyzed handlers receive independent full snapshots. Their
              // rows never participate in cross-query optimistic propagation.
              model = {
                relation:
                  'opaque:' +
                  createHash('sha256')
                    .update(id + ':' + declaration.node.id.name)
                    .digest('hex'),
                order: [],
                membership: { kind: 'all' },
              }
            }
          }
          usedCalls.add(call.node)
          const analysis = analyzeHandlerDependencies(
            values.handler,
            kind,
            values.input.get('value'),
          )
          let proof = compileDependencies(
            analysis,
            values.handler,
            id,
            root,
            snapshot,
          )
          if (!proof.dependencies) {
            proof = compileFunctionDependencies(
              values.handler,
              kind,
              values.input.get('value'),
              id,
              root,
              snapshot,
            )
          }
          if (!proof.dependencies) {
            proof = compileInlineDependencies(
              values.handler,
              kind,
              id,
              root,
              snapshot,
              values.input.get('value'),
            )
          }
          declarations.push({
            call: call.node,
            values,
            kind,
            client: node.init.arguments[0].name,
            name: declaration.node.id.name,
            owner: component.node.id.name,
            model,
            proof,
          })
        }
      }
    },
  })
  // Reject aliases/rebinding or calls the supported binder did not recognize.
  traverse(ast, {
    CallExpression(path) {
      if (
        path.node.callee.type === 'Identifier' &&
        ['endpoints', 'query', 'mutation'].includes(path.node.callee.name) &&
        !usedCalls.has(path.node)
      )
        fail('unrecognized endpoint binding or call', path.node)
    },
  })
  if (!declarations.length) fail('no bound endpoints found', ast.program)
  const projections = new Map()
  for (const entry of declarations.filter((entry) => entry.kind === 'query')) {
    if (!entry.model.fields) continue
    const projection = entry.model.fields.slice().sort().join(',')
    const previous = projections.get(entry.model.relation)
    if (previous !== undefined && previous !== projection)
      fail(
        'incompatible row projections for optimistic propagation',
        entry.call,
      )
    projections.set(entry.model.relation, projection)
  }
  if (/\b__bound[A-Za-z0-9_]*\b/.test(code))
    fail('reserved generated binding', ast.program)
  const original = new MagicString(code, { filename: id })
  const bundle = new Bundle({ separator: '' })
  const append = (text) => bundle.append(text)
  const source = (start, end) =>
    bundle.addSource({ content: original.snip(start, end) })
  const method = (node) => {
    append(node.async ? 'async function' : 'function')
    source(node.key.end, node.end)
  }
  const sourceHash = createHash('sha256').update(code).digest('hex')
  const revision = createHash('sha256')
    .update(
      code +
        JSON.stringify([
          snapshot?.fingerprint ?? null,
          declarations.map((entry) => entry.proof.fingerprint ?? null),
        ]),
    )
    .digest('hex')
  const moduleId = createHash('sha256')
    .update(id.split('?')[0])
    .digest('hex')
    .slice(0, 12)
  append(
    `import {refreshRegisteredMutation as __boundRefresh} from ${JSON.stringify(
      resolve(runtimeDirectory, 'registry.server.ts'),
    )};\nimport {createServerFn as __boundServerFn} from '@tanstack/react-start';\nimport {bindQuery as __boundQuery,bindMutation as __boundMutation} from ${JSON.stringify(
      runtimeSource,
    )};\n`,
  )
  const identities = new Set()
  const occurrences = new Map()
  for (const entry of declarations) {
    // Count declarations sharing these local names in lexical traversal order.
    // Byte offsets change when earlier plugins insert unrelated instrumentation.
    const label = `${entry.owner}:${entry.name}:${entry.kind}`
    const ordinal = occurrences.get(label) ?? 0
    occurrences.set(label, ordinal + 1)
    entry.key = `${moduleId}:${label}:${ordinal}`
    entry.version = revision
    if (identities.has(entry.key))
      fail('duplicate endpoint declaration identity', entry.call)
    identities.add(entry.key)
  }
  for (const [index, entry] of declarations.entries()) {
    entry.rpc = `__boundRpc${index}`
    append(
      `const ${entry.rpc}=__boundServerFn({method:'POST'}).inputValidator(z.object({scope:z.string().min(1),`,
    )
    if (entry.kind === 'mutation')
      append(
        'reads:z.array(z.object({id:z.string(),definition:z.string(),version:z.string(),params:z.unknown(),certificate:z.string().max(100).optional(),hasBaseline:z.boolean().optional(),optimistic:z.boolean().optional()}).strict()).max(100),',
      )
    append('input:')
    source(
      entry.values.input.node.value.start,
      entry.values.input.node.value.end,
    )
    if (entry.kind === 'query') append('.strict()')
    append('})).handler(async ({data})=>')
    const invoke = (declaration, input) => {
      append('(')
      method(declaration.values.handler.node)
      append(
        `)({body:${input},scope:data.scope,kind:'${declaration.kind}',endpointSourceHash:'${sourceHash}'},{json:value=>value})`,
      )
    }
    if (entry.kind === 'mutation') {
      append(
        "__boundRefresh(data.reads,(await import('virtual:endpoints-registry.server.ts')).registry,async()=>",
      )
      invoke(entry, 'data.input')
      append(
        `,{scope:data.scope},()=>${JSON.stringify(entry.proof.dependencies)})`,
      )
    } else invoke(entry, 'data.input')
    append(');\n')
  }
  let cursor = 0
  for (const entry of declarations.sort(
    (a, b) => a.call.start - b.call.start,
  )) {
    source(cursor, entry.call.start)
    const key = JSON.stringify(entry.key)
    if (entry.kind === 'query') {
      append(
        `__boundQuery(${entry.client},${key},${entry.rpc},${JSON.stringify(
          entry.model,
        )},`,
      )
      source(
        entry.values.input.node.value.start,
        entry.values.input.node.value.end,
      )
      append('.strict().parse(')
      if (entry.values.params)
        source(
          entry.values.params.node.value.start,
          entry.values.params.node.value.end,
        )
      else append('{}')
      append(`),${JSON.stringify(entry.version)}`)
      if (entry.values.schema) {
        append(',')
        source(
          entry.values.schema.node.value.start,
          entry.values.schema.node.value.end,
        )
      }
      append(')')
    } else {
      append(`__boundMutation(${entry.client},${key},${entry.rpc},`)
      method(entry.values.onMutate.node)
      append(')')
    }
    cursor = entry.call.end
  }
  source(cursor, code.length)
  const definitions = declarations.filter((entry) => entry.kind === 'query')
  const usedImports = new Set()
  for (const entry of definitions)
    for (const path of [entry.values.input, entry.values.handler])
      path.traverse({
        ReferencedIdentifier(p) {
          const binding = p.scope.getBinding(p.node.name)
          if (binding?.path.parent.type === 'ImportDeclaration')
            usedImports.add(binding.path.parent)
        },
      })
  const imports = [...usedImports]
    .map((node) => {
      const imported = node.source.value
      const target = imported.startsWith('.')
        ? resolve(dirname(id), imported)
        : imported
      return (
        code.slice(node.start, node.source.start) +
        JSON.stringify(target) +
        code.slice(node.source.end, node.end)
      )
    })
    .join('\n')
  const registryCode =
    imports +
    `\nimport {registerQuery} from ${JSON.stringify(
      resolve(runtimeDirectory, 'registry.server.ts'),
    )};\nexport const definitions={` +
    definitions
      .map((entry) => {
        const handler = entry.values.handler.node,
          input = entry.values.input.node.value
        return `${JSON.stringify(entry.key)}:registerQuery(${JSON.stringify(
          entry.version,
        )},${JSON.stringify(entry.model.relation)},value=>(${code.slice(
          input.start,
          input.end,
        )}).strict().parse(value),async(input,context)=>(async function${code.slice(
          handler.key.end,
          handler.end,
        )})({body:input,scope:context.scope,kind:'query',endpointSourceHash:${JSON.stringify(
          sourceHash,
        )}},{json:value=>value}),undefined,${JSON.stringify(entry.proof.dependencies)})`
      })
      .join(',') +
    '};'
  return {
    code: bundle.toString(),
    map: bundle.generateMap({ hires: true, includeContent: true }),
    definitions,
    registryCode,
    dependencyDiagnostics: declarations.map(({ name, kind, proof }) => ({
      name,
      kind,
      dependencies: proof.dependencies,
      reason: proof.reason ?? null,
    })),
    watchFiles: [
      ...new Set(declarations.flatMap((entry) => entry.proof.files)),
    ],
  }
}
