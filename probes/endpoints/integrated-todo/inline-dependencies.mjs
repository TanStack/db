import { createHash } from 'node:crypto'
import { compileDependencies } from './compiled-dependencies.mjs'

// SQL-only v1: inspect statements written in the handler and its inline
// transaction callbacks. Application calls keep their own semantics; this is
// not a proof of their effects. Passing a database handle to a helper falls back.
export function compileInlineDependencies(
  handler,
  kind,
  file,
  root,
  snapshot,
  input,
) {
  const effects = [],
    databases = new Map(),
    handled = new Set(),
    files = new Set()
  const fingerprints = [],
    skippedCalls = new Set()
  let reason
  const fail = (message) => {
    reason ??= message
  }
  const imported = (path, source) => {
    if (!path.isIdentifier()) return null
    const binding = path.scope.getBinding(path.node.name)
    return binding?.constant &&
      binding.path.isImportSpecifier() &&
      (!source || binding.path.parent.source.value === source)
      ? binding
      : null
  }
  function chain(path) {
    const methods = []
    while (
      path.isCallExpression() &&
      path.get('callee').isMemberExpression() &&
      !path.node.callee.computed
    ) {
      methods.unshift({
        name: path.node.callee.property.name,
        path,
        args: path.get('arguments'),
      })
      path = path.get('callee.object')
    }
    return { root: path, methods }
  }
  function database(path) {
    if (!path.isIdentifier()) return null
    const binding = path.scope.getBinding(path.node.name)
    return databases.get(binding) ?? null
  }
  function record(db, table, operation, values) {
    if (!imported(table)) return fail('SQL table must be a direct import')
    effects.push({
      database: db,
      tables: [table.node.name],
      operation,
      values: values?.node,
    })
  }
  const sqlNodes = new Set()
  function primitiveInput(path) {
    if (path.isLiteral() && !path.isRegExpLiteral()) return true
    const n = path.node
    if (n.type !== 'MemberExpression' || n.computed) return false
    const request = handler.node.params[0]?.name
    if (
      !request ||
      path.scope.getBinding(request) !== handler.scope.getBinding(request)
    )
      return false
    if (n.object.name === request && n.property.name === 'scope') return true
    if (
      n.object.type !== 'MemberExpression' ||
      n.object.computed ||
      n.object.object.name !== request ||
      n.object.property.name !== 'body'
    )
      return false
    let schema = input
    if (
      !schema?.isCallExpression() ||
      schema.node.callee.type !== 'MemberExpression' ||
      schema.node.callee.property.name !== 'object' ||
      schema.node.arguments[0]?.type !== 'ObjectExpression'
    )
      return false
    const z = imported(schema.get('callee.object'), 'zod')
    if (z?.path.node.imported.name !== 'z') return false
    const field = schema
      .get('arguments.0.properties')
      .find(
        (p) =>
          p.isObjectProperty() &&
          !p.node.computed &&
          (p.node.key.name ?? p.node.key.value) === n.property.name,
      )
    if (!field) return false
    schema = field.get('value')
    while (
      schema.isCallExpression() &&
      schema.node.callee.type === 'MemberExpression' &&
      [
        'int',
        'min',
        'max',
        'nonnegative',
        'positive',
        'optional',
        'nullable',
        'uuid',
      ].includes(schema.node.callee.property.name)
    )
      schema = schema.get('callee.object')
    return (
      schema.isCallExpression() &&
      schema.node.callee.type === 'MemberExpression' &&
      !schema.node.callee.computed &&
      ['number', 'string', 'boolean'].includes(
        schema.node.callee.property.name,
      ) &&
      imported(schema.get('callee.object'), 'zod') === z
    )
  }
  function template(path) {
    if (
      !path?.isTaggedTemplateExpression() ||
      imported(path.get('tag'), 'drizzle-orm')?.path.node.imported.name !==
        'sql'
    )
      return null
    const values = path.get('quasi.expressions')
    if (!values.every(primitiveInput)) return null
    sqlNodes.add(path.node)
    return path.node.quasi.quasis
      .map((q, i) => q.value.cooked + (i < values.length ? '$' + (i + 1) : ''))
      .join('')
  }
  // Arithmetic fragments retain the earlier bounded Drizzle expression grammar.
  // Whole static templates go through the SQL parser; dynamic fragments fall back.
  function expression(path) {
    if (path.isTaggedTemplateExpression() && !sqlNodes.has(path.node)) {
      if (
        imported(path.get('tag'), 'drizzle-orm')?.path.node.imported.name !==
          'sql' ||
        path.node.quasi.quasis.some(
          (q) => !/^[\s\d+*/().-]*$/.test(q.value.cooked),
        )
      )
        fail('Unsupported SQL fragment')
    }
    if (path.isCallExpression()) {
      const c = chain(path)
      if (
        c.root.isIdentifier() &&
        imported(c.root, 'drizzle-orm')?.path.node.imported.name === 'sql'
      )
        fail('Dynamic SQL fragment')
    }
  }
  // Discover imported database receivers and inline transaction parameters first.
  for (const syntax of [handler, ...(input ? [input] : [])])
    syntax.traverse({
      CallExpression(path) {
        const c = chain(path),
          first = c.methods[0]
        if (!first || !c.root.isIdentifier()) return
        let db = database(c.root)
        if (
          !db &&
          imported(c.root) &&
          [
            'select',
            'insert',
            'update',
            'delete',
            'transaction',
            'execute',
          ].includes(first.name)
        ) {
          db = c.root.node.name
          databases.set(c.root.scope.getBinding(db), db)
        }
        if (db && first.name === 'transaction') {
          const callback = first.args[0]
          if (
            first.args.length !== 1 ||
            !callback?.isFunction() ||
            callback.node.params.length !== 1 ||
            callback.node.params[0].type !== 'Identifier'
          )
            return fail('Transaction requires an inline callback')
          databases.set(
            callback.scope.getBinding(callback.node.params[0].name),
            db,
          )
        }
      },
    })
  for (const syntax of [handler, ...(input ? [input] : [])])
    syntax.traverse({
      TaggedTemplateExpression: expression,
      CallExpression(path) {
        expression(path)
        const c = chain(path),
          db = database(c.root)
        if (!db) {
          if (
            path.get('callee').isIdentifier() &&
            imported(path.get('callee')) &&
            !imported(path.get('callee'), 'drizzle-orm')
          )
            skippedCalls.add(path.node.callee.name)
          return
        }
        // Process only the outer call of each chain.
        if (
          path.parentPath.isMemberExpression() &&
          path.parentPath.get('object').node === path.node
        )
          return
        handled.add(c.root.node)
        const first = c.methods[0]
        if (first.name === 'transaction') return
        if (first.name === 'execute') {
          const sql = first.args.length === 1 && template(first.args[0])
          if (!sql || c.methods.length !== 1)
            return fail('Unsupported executable SQL template')
          effects.push({
            database: db,
            tables: [],
            operation: 'sql',
            sql: [sql],
          })
          return
        }
        const allowed = {
          select: [
            'select',
            'from',
            'innerJoin',
            'leftJoin',
            'rightJoin',
            'fullJoin',
            'where',
            'orderBy',
            'groupBy',
            'having',
            'limit',
            'offset',
          ],
          insert: ['insert', 'values', 'returning', 'onConflictDoNothing'],
          update: ['update', 'set', 'where', 'returning'],
          delete: ['delete', 'where', 'returning'],
        }[first.name]
        if (!allowed || c.methods.some((m) => !allowed.includes(m.name)))
          return fail('Unsupported direct SQL chain')
        if (kind === 'query' && first.name !== 'select')
          return fail('Query contains a write')
        if (first.name !== 'select')
          record(
            db,
            first.args[0],
            first.name,
            c.methods.find((m) => ['set', 'values'].includes(m.name))?.args[0],
          )
        if (
          first.name === 'select' &&
          !c.methods.some((m) => m.name === 'from')
        )
          return fail('SELECT requires a visible source')
        for (const method of c.methods) {
          if (
            ['from', 'innerJoin', 'leftJoin', 'rightJoin', 'fullJoin'].includes(
              method.name,
            )
          )
            record(db, method.args[0], 'select')
          for (const arg of method.args) {
            expression(arg)
            arg.traverse({
              TaggedTemplateExpression: expression,
              CallExpression: expression,
            })
          }
        }
      },
      ReferencedIdentifier(path) {
        if (database(path) && !handled.has(path.node)) {
          // Call visitors run before their descendants. Every permitted receiver
          // has been marked by the outer-chain visitor at this point.
          fail('Database handle escapes a direct statement')
        }
      },
    })
  const dependencies = new Set()
  for (const effect of effects) {
    const proof = compileDependencies(
      { ...effect, kind },
      handler,
      file,
      root,
      snapshot,
    )
    proof.files.forEach((f) => files.add(f))
    if (!proof.dependencies) fail('Unsupported schema footprint')
    else proof.dependencies.forEach((d) => dependencies.add(d))
    if (proof.fingerprint) fingerprints.push(proof.fingerprint)
  }
  if (!effects.length) fail('No direct SQL statements found')
  return {
    dependencies: reason ? null : [...dependencies].sort(),
    files: [...files],
    fingerprint: createHash('sha256')
      .update(fingerprints.join('\0'))
      .digest('hex'),
    reason:
      reason ??
      (skippedCalls.size
        ? `SQL-only analysis; calls not inspected: ${[...skippedCalls].sort().join(', ')}`
        : null),
  }
}
