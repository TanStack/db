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
  function record(db, table, operation) {
    if (!imported(table)) return fail('SQL table must be a direct import')
    effects.push({ database: db, tables: [table.node.name], operation })
  }
  // Only arithmetic SQL fragments are accepted here. Larger raw SQL statements
  // need the SQL parser path; arbitrary fragments must never become plain data.
  function expression(path) {
    if (path.isTaggedTemplateExpression()) {
      if (
        !imported(path.get('tag'), 'drizzle-orm') ||
        imported(path.get('tag'), 'drizzle-orm').path.node.imported.name !==
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
        imported(c.root, 'drizzle-orm') &&
        imported(c.root, 'drizzle-orm').path.node.imported.name === 'sql'
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
        if (first.name !== 'select') record(db, first.args[0], first.name)
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
    if (kind === 'mutation' && effect.operation === 'select') continue
    const proof = compileDependencies(effect, handler, file, root, snapshot)
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
