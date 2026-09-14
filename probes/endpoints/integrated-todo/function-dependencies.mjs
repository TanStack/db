import { readFileSync, existsSync, realpathSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import traverseModule from '@babel/traverse'
import { compileDependencies } from './compiled-dependencies.mjs'
const traverse = traverseModule.default ?? traverseModule
const data = { kind: 'data' }
const external = (source, names = []) => ({ kind: 'external', source, names })

// Abstract interpretation collects a union of effects over all reachable branches.
// Values only preserve capabilities (functions, database handles and table bindings).
// An unresolved call invalidates the whole proof; no application code is executed.
export function compileFunctionDependencies(
  handler,
  kind,
  input,
  file,
  root,
  snapshot,
) {
  const files = new Map(),
    active = new Set(),
    resolving = new Set(),
    effects = []
  const locations = new WeakMap()
  const unknown = (reason) => {
    throw Error(reason)
  }
  let steps = 0
  function module(path) {
    if (!files.has(path)) {
      const code = readFileSync(path, 'utf8')
      const ast = parse(code, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      })
      let program
      traverse(ast, {
        Program(p) {
          program = p
          p.stop()
        },
      })
      files.set(path, { code, program })
      locations.set(program.node, path)
    }
    return files.get(path).program
  }
  function location(path) {
    const program = path.isProgram()
      ? path
      : path.findParent((p) => p.isProgram())
    return locations.get(program.node) ?? file
  }
  function source(specifier, from) {
    const base = specifier.startsWith('@/')
      ? resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') || specifier.startsWith('/')
        ? resolve(dirname(from), specifier)
        : null
    if (!base) return null
    for (const candidate of [
      base,
      ...['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.js'].map(
        (ext) => base + ext,
      ),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        try {
          return realpathSync(candidate)
        } catch {
          return null
        }
      }
    return unknown('Missing local module')
  }
  function exported(path, name, env, seen = new Set()) {
    const key = path + ':' + name
    if (seen.has(key)) return unknown('Circular export')
    seen = new Set([...seen, key])
    const program = module(path),
      matches = []
    for (const statement of program.get('body')) {
      if (statement.isExportNamedDeclaration()) {
        const declaration = statement.get('declaration')
        if (
          declaration.node &&
          Object.hasOwn(declaration.getBindingIdentifiers(), name)
        )
          return identifier(program.scope.getBinding(name).path, env)
        for (const spec of statement.get('specifiers'))
          if (spec.node.exported.name === name) {
            const origin = statement.node.source?.value
            return origin
              ? imported(origin, spec.node.local.name, path, env, seen)
              : identifier(
                  program.scope.getBinding(spec.node.local.name)?.path,
                  env,
                )
          }
      }
      if (statement.isExportDefaultDeclaration() && name === 'default')
        return evaluate(statement.get('declaration'), env)
      if (statement.isExportAllDeclaration()) {
        const target = source(statement.node.source.value, path)
        if (target) {
          const result = exported(target, name, env, seen)
          if (result) matches.push(result)
        }
      }
    }
    if (matches.length > 1) return unknown('Ambiguous export')
    return matches[0]
  }
  function imported(specifier, name, from, env, seen) {
    const target = source(specifier, from)
    if (!target) return external(specifier, name === '*' ? [] : [name])
    if (name === '*') return { kind: 'namespace', path: target }
    return exported(target, name, env, seen) ?? unknown('Missing export')
  }
  function identifier(path, env) {
    if (!path) return unknown('Unresolved binding')
    const binding = path.scope.getBinding(
      path.node.id?.name ?? path.node.local?.name ?? path.node.name,
    )
    if (binding && env.has(binding)) return env.get(binding)
    if (binding && !binding.constant) return unknown('Reassigned binding')
    if (
      path.isImportSpecifier() ||
      path.isImportDefaultSpecifier() ||
      path.isImportNamespaceSpecifier()
    )
      return imported(
        path.parent.source.value,
        path.isImportDefaultSpecifier()
          ? 'default'
          : path.isImportNamespaceSpecifier()
            ? '*'
            : path.node.imported.name,
        location(path),
        env,
      )
    if (path.isFunctionDeclaration())
      return { kind: 'function', path, env: new Map(env) }
    if (path.isVariableDeclarator()) {
      if (binding && !binding.constant)
        return unknown('Mutable captured binding')
      if (resolving.has(path.node)) return unknown('Circular value')
      resolving.add(path.node)
      try {
        const init = path.get('init')
        if (init.isCallExpression()) {
          const factory = evaluate(init.get('callee'), env)
          const isDb =
            factory.kind === 'external' &&
            factory.source.startsWith('drizzle-orm/') &&
            factory.names.join('.') === 'drizzle'
          const isTable =
            (factory.kind === 'external' &&
              factory.source === 'drizzle-orm/pg-core' &&
              factory.names.join('.') === 'pgTable') ||
            (factory.kind === 'method' &&
              factory.owner.kind === 'pgSchema' &&
              factory.name === 'table')
          if (isDb || isTable)
            return {
              kind: isDb ? 'db' : 'table',
              binding: {
                specifier: location(path),
                from: location(path),
                exportName: path.node.id.name,
              },
            }
        }
        const value = evaluate(path.get('init'), env)
        if (value.kind === 'db' || value.kind === 'table')
          value.binding ??= {
            specifier: location(path),
            from: location(path),
            exportName: path.node.id.name,
          }
        return value
      } finally {
        resolving.delete(path.node)
      }
    }
    return unknown('Unbound function parameter')
  }
  function plain(value) {
    return (
      value.kind === 'data' ||
      (value.kind === 'object' && [...value.fields.values()].every(plain)) ||
      (value.kind === 'array' && value.items.every(plain))
    )
  }
  function requirePlain(args) {
    if (!args.every(plain)) return unknown('Executable SQL/coercion value')
  }
  function member(value, name) {
    if (value.kind === 'object') return value.fields.get(name) ?? data
    if (value.kind === 'namespace')
      return (
        exported(value.path, name, new Map()) ??
        unknown('Missing namespace member')
      )
    if (value.kind === 'external')
      return external(value.source, [...value.names, name])
    if (value.kind === 'table') return data
    if (value.kind === 'array' && /^\d+$/.test(name))
      return value.items[Number(name)] ?? data
    return { kind: 'method', owner: value, name }
  }
  function bind(path, value, env) {
    if (!path?.node) return
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (binding) env.set(binding, value)
      return
    }
    if (path.isObjectPattern()) {
      for (const p of path.get('properties')) {
        if (p.isRestElement()) return unknown('Rest capability binding')
        if (p.node.computed) return unknown('Computed binding')
        bind(
          p.get('value'),
          member(value, p.node.key.name ?? p.node.key.value),
          env,
        )
      }
      return
    }
    if (path.isArrayPattern()) {
      for (const element of path.get('elements'))
        if (element.node) bind(element, data, env)
      return
    }
    if (path.isAssignmentPattern()) {
      evaluate(path.get('right'), env)
      bind(path.get('left'), value, env)
      return
    }
    return unknown('Unsupported binding')
  }
  function invoke(fn, args) {
    if (fn.kind !== 'function') return unknown('Unresolved callable')
    if (active.has(fn.path.node)) return unknown('Recursive call')
    active.add(fn.path.node)
    try {
      const env = new Map(fn.env)
      fn.path.get('params').forEach((p, i) => bind(p, args[i] ?? data, env))
      const body = fn.path.get('body')
      if (!body.isBlockStatement()) return evaluate(body, env)
      return statements(body.get('body'), env)
    } finally {
      active.delete(fn.path.node)
    }
  }
  function statements(paths, env) {
    let returned = data
    for (const path of paths) {
      if (path.isVariableDeclaration()) {
        for (const d of path.get('declarations'))
          bind(d.get('id'), evaluate(d.get('init'), env), env)
      } else if (path.isReturnStatement())
        returned = evaluate(path.get('argument'), env)
      else if (path.isThrowStatement() || path.isExpressionStatement())
        evaluate(
          path.get(path.isThrowStatement() ? 'argument' : 'expression'),
          env,
        )
      else if (path.isIfStatement()) {
        evaluate(path.get('test'), env)
        const branch = (p) =>
          p.isBlockStatement()
            ? statements(p.get('body'), new Map(env))
            : statements([p], new Map(env))
        branch(path.get('consequent'))
        if (path.node.alternate) branch(path.get('alternate'))
      } else if (path.isBlockStatement())
        statements(path.get('body'), new Map(env))
      else if (path.isForOfStatement()) {
        evaluate(path.get('right'), env)
        const child = new Map(env),
          left = path.get('left')
        if (!left.isVariableDeclaration())
          return unknown('Mutable loop binding')
        bind(left.get('declarations.0.id'), data, child)
        const body = path.get('body')
        statements(body.isBlockStatement() ? body.get('body') : [body], child)
      } else if (path.isTryStatement()) {
        statements(path.get('block.body'), new Map(env))
        if (path.node.handler) {
          const child = new Map(env)
          bind(path.get('handler.param'), data, child)
          statements(path.get('handler.body.body'), child)
        }
        if (path.node.finalizer)
          statements(path.get('finalizer.body'), new Map(env))
      } else if (!path.isFunctionDeclaration() && !path.isEmptyStatement())
        return unknown('Unsupported statement')
    }
    return returned
  }
  function effect(db, table, operation) {
    if (!db.binding || table.kind !== 'table' || !table.binding)
      return unknown('Unknown SQL binding')
    effects.push({
      database: 'database',
      tables: ['table'],
      operation,
      bindings: { database: db.binding, table: table.binding },
    })
  }
  function call(fn, args) {
    if (fn.kind === 'function') return invoke(fn, args)
    if (fn.kind === 'external') {
      const [name, ...rest] = fn.names
      if (fn.source === 'zod' && fn.names.join('.') === 'z.preprocess') {
        const before = effects.length
        invoke(args[0], [data])
        if (effects.length !== before) return unknown('Effectful validator')
        return args[1]
      }
      if (
        fn.source === 'drizzle-zod' &&
        [
          'createSelectSchema',
          'createInsertSchema',
          'createUpdateSchema',
        ].includes(name) &&
        !rest.length
      ) {
        if (args[0]?.kind !== 'table') return unknown('Unknown schema table')
        if (
          args[1] &&
          (args[1].kind !== 'object' ||
            [...args[1].fields.values()].some(
              (value) => value.kind !== 'schema',
            ))
        )
          return unknown('Unknown schema override')
        return { kind: 'schema' }
      }
      if (
        fn.source.startsWith('drizzle-orm/') &&
        name === 'drizzle' &&
        !rest.length
      )
        return { kind: 'db' }
      if (fn.source === 'drizzle-orm/pg-core' && ['pgTable'].includes(name))
        return { kind: 'table' }
      if (fn.source === 'drizzle-orm/pg-core' && name === 'pgSchema')
        return { kind: 'pgSchema' }
      if (
        fn.source === 'drizzle-orm/pg-core' &&
        [
          'text',
          'integer',
          'smallint',
          'bigint',
          'boolean',
          'timestamp',
          'date',
          'uuid',
          'varchar',
          'numeric',
          'real',
          'doublePrecision',
        ].includes(name)
      )
        return { kind: 'column' }
      if (
        fn.source === 'drizzle-orm' &&
        [
          'eq',
          'ne',
          'gt',
          'gte',
          'lt',
          'lte',
          'and',
          'or',
          'inArray',
          'notInArray',
          'isNull',
          'isNotNull',
          'asc',
          'desc',
        ].includes(name) &&
        !rest.length
      ) {
        requirePlain(args)
        return data
      }
      if (
        fn.source === 'zod' &&
        name === 'z' &&
        rest.length === 1 &&
        [
          'object',
          'string',
          'number',
          'boolean',
          'date',
          'array',
          'enum',
          'literal',
          'record',
          'union',
          'discriminatedUnion',
          'null',
          'undefined',
        ].includes(rest[0])
      )
        return { kind: 'schema' }
      if (
        fn.source === 'global' &&
        ['Error', 'TypeError', 'Date', 'String', 'Number', 'Boolean'].includes(
          name,
        )
      ) {
        requirePlain(args)
        return data
      }
      if (
        fn.source === 'global' &&
        name === 'Promise' &&
        ['all', 'allSettled'].includes(rest[0])
      )
        return data
      return unknown('External call: ' + fn.source + '.' + fn.names.join('.'))
    }
    if (fn.kind !== 'method') return unknown('Unknown call')
    const { owner, name } = fn
    if (
      owner.kind === 'schema' &&
      ['transform', 'refine', 'superRefine'].includes(name)
    ) {
      const before = effects.length
      invoke(args[0], [data, data])
      if (effects.length !== before) return unknown('Effectful validator')
      return owner
    }
    if (owner.kind === 'schema' && name === 'parse') {
      requirePlain(args)
      return data
    }
    if (owner.kind === 'schema' && name === 'default') {
      requirePlain(args)
      return owner
    }
    if (owner.kind === 'response' && name === 'json') return args[0] ?? data
    if (owner.kind === 'db') {
      if (name === 'transaction') return invoke(args[0], [owner])
      if (['insert', 'update', 'delete'].includes(name)) {
        effect(owner, args[0], name)
        return { kind: 'sql', db: owner, operation: name }
      }
      if (name === 'select') {
        requirePlain(args)
        return { kind: 'sql', db: owner, operation: 'select' }
      }
      return unknown('Unknown database method')
    }
    if (owner.kind === 'sql') {
      if (
        ['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin'].includes(
          name,
        )
      ) {
        requirePlain(args.slice(1))
        effect(owner.db, args[0], 'select')
        return owner
      }
      if (
        [
          'where',
          'orderBy',
          'groupBy',
          'having',
          'limit',
          'offset',
          'set',
          'values',
          'returning',
          'onConflictDoNothing',
        ].includes(name)
      ) {
        requirePlain(args)
        return owner
      }
      if (name === 'onConflictDoUpdate')
        return unknown('Upsert write footprint')
      return unknown('Unsupported SQL chain')
    }
    if (owner.kind === 'pgSchema' && name === 'table') return { kind: 'table' }
    if (
      owner.kind === 'column' &&
      [
        'notNull',
        'primaryKey',
        'unique',
        'default',
        'defaultNow',
        'references',
        '$type',
      ].includes(name)
    )
      return owner
    if (
      owner.kind === 'schema' &&
      [
        'optional',
        'nullable',
        'nullish',
        'int',
        'strict',
        'uuid',
        'min',
        'max',
        'trim',
        'omit',
        'pick',
        'partial',
        'extend',
        'describe',
      ].includes(name)
    )
      return owner
    if (
      (owner.kind === 'data' || owner.kind === 'array') &&
      ['map', 'filter', 'some', 'every', 'find', 'flatMap', 'forEach'].includes(
        name,
      )
    ) {
      const items = owner.kind === 'array' ? owner.items : [data]
      const values = items.map((item) => invoke(args[0], [item, data]))
      return { kind: 'array', items: values }
    }
    if (
      owner.kind === 'data' &&
      [
        'includes',
        'slice',
        'join',
        'trim',
        'toLowerCase',
        'toUpperCase',
        'startsWith',
        'endsWith',
      ].includes(name)
    )
      return data
    return unknown('Unsupported method: ' + name)
  }
  function evaluate(path, env) {
    if (++steps > 20000) return unknown('Analysis budget exceeded')
    if (!path?.node) return data
    if (path.isIdentifier()) {
      const binding = path.scope.getBinding(path.node.name)
      if (binding)
        return env.has(binding)
          ? env.get(binding)
          : identifier(binding.path, env)
      if (['undefined', 'NaN', 'Infinity'].includes(path.node.name)) return data
      if (
        [
          'Error',
          'TypeError',
          'Date',
          'String',
          'Number',
          'Boolean',
          'Promise',
        ].includes(path.node.name)
      )
        return external('global', [path.node.name])
      return unknown('Unknown global: ' + path.node.name)
    }
    if (path.isLiteral()) return data
    if (path.isFunction()) return { kind: 'function', path, env: new Map(env) }
    if (path.isAwaitExpression()) {
      const value = evaluate(path.get('argument'), env)
      return value.kind === 'sql' ? data : value
    }
    if (
      path.isTSAsExpression() ||
      path.isTSNonNullExpression() ||
      path.isTSSatisfiesExpression()
    )
      return evaluate(path.get('expression'), env)
    if (path.isMemberExpression() || path.isOptionalMemberExpression()) {
      const owner = evaluate(path.get('object'), env)
      const name = path.node.computed
        ? path.node.property.value
        : path.node.property.name
      if (name === undefined) return unknown('Dynamic property')
      if (owner.kind === 'data') return data
      return member(owner, name)
    }
    if (
      path.isCallExpression() ||
      path.isOptionalCallExpression() ||
      path.isNewExpression()
    ) {
      let fn
      const callee = path.get('callee')
      // Data member reads erase capabilities, but a method call needs its receiver.
      if (callee.isMemberExpression() || callee.isOptionalMemberExpression()) {
        const owner = evaluate(callee.get('object'), env)
        const name = callee.node.computed
          ? callee.node.property.value
          : callee.node.property.name
        if (name === undefined) return unknown('Dynamic call')
        fn = member(owner, name)
      } else fn = evaluate(callee, env)
      if (
        fn.kind === 'external' &&
        ![
          'global',
          'zod',
          'drizzle-zod',
          'drizzle-orm',
          'drizzle-orm/pg-core',
          'drizzle-orm/pglite',
          'drizzle-orm/node-postgres',
          'drizzle-orm/postgres-js',
        ].includes(fn.source)
      )
        return unknown('External call: ' + fn.source + '.' + fn.names.join('.'))
      const args = path
        .get('arguments')
        .map((p) =>
          p.isSpreadElement() ? unknown('Spread call') : evaluate(p, env),
        )
      return call(fn, args)
    }
    if (path.isObjectExpression()) {
      const fields = new Map()
      for (const p of path.get('properties')) {
        if (p.isSpreadElement()) {
          const value = evaluate(p.get('argument'), env)
          if (value.kind === 'object')
            for (const [k, v] of value.fields) fields.set(k, v)
          else if (value.kind !== 'data') return unknown('Capability spread')
          continue
        }
        if (p.node.computed || p.node.kind === 'get' || p.node.kind === 'set')
          return unknown('Dynamic object')
        fields.set(
          p.node.key.name ?? p.node.key.value,
          p.isObjectMethod()
            ? { kind: 'function', path: p, env: new Map(env) }
            : evaluate(p.get('value'), env),
        )
      }
      return { kind: 'object', fields }
    }
    if (path.isArrayExpression())
      return {
        kind: 'array',
        items: path
          .get('elements')
          .filter((p) => p.node)
          .map((p) => evaluate(p, env)),
      }
    if (path.isUnaryExpression()) {
      const value = evaluate(path.get('argument'), env)
      if (!['typeof', '!', 'void'].includes(path.node.operator))
        requirePlain([value])
      return data
    }
    if (path.isBinaryExpression() || path.isLogicalExpression()) {
      requirePlain([
        evaluate(path.get('left'), env),
        evaluate(path.get('right'), env),
      ])
      return data
    }
    if (path.isConditionalExpression()) {
      evaluate(path.get('test'), env)
      const a = evaluate(path.get('consequent'), env),
        b = evaluate(path.get('alternate'), env)
      if (a.kind !== 'data' || b.kind !== 'data')
        return unknown('Conditional capability')
      return data
    }
    if (path.isTemplateLiteral()) {
      requirePlain(path.get('expressions').map((p) => evaluate(p, env)))
      return data
    }
    return unknown('Unsupported expression: ' + path.node.type)
  }
  try {
    if (!snapshot) return { dependencies: null, files: [] }
    if (evaluate(input, new Map()).kind !== 'schema')
      return unknown('Unknown validator')
    invoke({ kind: 'function', path: handler, env: new Map() }, [
      {
        kind: 'object',
        fields: new Map([
          ['body', data],
          ['scope', data],
        ]),
      },
      { kind: 'response' },
    ])
    const dependencies = new Set()
    for (const analysis of effects) {
      if (kind === 'mutation' && analysis.operation === 'select') continue
      if (kind === 'query' && analysis.operation !== 'select')
        return unknown('Effectful query')
      const proof = compileDependencies(analysis, handler, file, root, snapshot)
      for (const path of proof.files) if (!files.has(path)) module(path)
      if (!proof.dependencies) return unknown('Unsupported schema footprint')
      for (const dependency of proof.dependencies) dependencies.add(dependency)
    }
    return {
      dependencies: [...dependencies].sort(),
      files: [...files.keys()],
      fingerprint: createHash('sha256')
        .update([...files.values()].map((f) => f.code).join('\0'))
        .digest('hex'),
    }
  } catch (error) {
    return {
      dependencies: null,
      files: [...files.keys()],
      reason: error.message,
      fingerprint: createHash('sha256')
        .update([...files.values()].map((f) => f.code).join('\0'))
        .digest('hex'),
    }
  }
}
