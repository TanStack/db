import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { parse } from '@babel/parser'
import { schemaFootprint } from './schema-snapshot.mjs'

export function loadSchema(root) {
  try {
    const snapshot = JSON.parse(
      readFileSync(resolve(root, '.endpoints/schema.json'), 'utf8'),
    )
    const { fingerprint, ...contents } = snapshot
    if (
      snapshot.format !== 1 ||
      typeof snapshot.databaseModule !== 'string' ||
      !Array.isArray(snapshot.searchPath) ||
      !Array.isArray(snapshot.tables) ||
      createHash('sha256').update(JSON.stringify(contents)).digest('hex') !==
        fingerprint
    )
      return null
    return snapshot
  } catch {
    return null
  }
}

export function compileDependencies(analysis, handler, file, root, snapshot) {
  if (!analysis || !snapshot) return { dependencies: null, files: [] }
  const files = new Map()
  function sourcePath(specifier, from) {
    const path = specifier.startsWith('@/')
      ? resolve(root, 'src', specifier.slice(2))
      : specifier.startsWith('.') || specifier.startsWith('/')
        ? resolve(dirname(from), specifier)
        : null
    if (!path) return null
    for (const candidate of [
      path,
      ...['.ts', '.tsx', '.js', '.mjs', '/index.ts'].map(
        (extension) => path + extension,
      ),
    ])
      if (existsSync(candidate) && statSync(candidate).isFile())
        return realpathSync(candidate)
    return null
  }
  function module(path) {
    if (!files.has(path)) {
      const code = readFileSync(path, 'utf8')
      files.set(path, {
        code,
        ast: parse(code, { sourceType: 'module', plugins: ['typescript'] }),
      })
    }
    return files.get(path).ast.program.body
  }
  function local(path, name, seen) {
    for (const statement of module(path)) {
      const declaration =
        statement.type === 'ExportNamedDeclaration'
          ? statement.declaration
          : statement
      if (declaration?.type === 'VariableDeclaration') {
        const variable = declaration.declarations.find(
          (d) => d.id.name === name,
        )
        if (variable) return { path, name, node: variable.init }
      }
      if (statement.type === 'ImportDeclaration') {
        const spec = statement.specifiers.find(
          (s) => s.type === 'ImportSpecifier' && s.local.name === name,
        )
        if (spec) {
          const target = sourcePath(statement.source.value, path)
          return target
            ? exported(target, spec.imported.name, seen)
            : {
                path,
                name,
                imported: spec.imported.name,
                source: statement.source.value,
              }
        }
      }
    }
    return null
  }
  function exported(path, name, seen = new Set()) {
    const key = path + ':' + name
    if (seen.has(key)) return null
    seen = new Set([...seen, key])
    const matches = []
    for (const statement of module(path)) {
      if (statement.type === 'ExportNamedDeclaration') {
        if (
          statement.declaration?.type === 'VariableDeclaration' &&
          statement.declaration.declarations.some((d) => d.id.name === name)
        )
          return local(path, name, seen)
        const spec = statement.specifiers.find((s) => s.exported?.name === name)
        if (spec) {
          const target =
            statement.source && sourcePath(statement.source.value, path)
          return target
            ? exported(target, spec.local.name, seen)
            : local(path, spec.local.name, seen)
        }
      }
      if (statement.type === 'ExportAllDeclaration') {
        const target = sourcePath(statement.source.value, path)
        if (target) {
          const result = exported(target, name, seen)
          if (result) matches.push(result)
        }
      }
    }
    return matches.length === 1 ? matches[0] : null
  }
  function binding(name) {
    const resolved = analysis.bindings?.[name]
    if (resolved) {
      const target = sourcePath(resolved.specifier, resolved.from)
      return target && exported(target, resolved.exportName)
    }
    const imported = handler.scope.getBinding(name)?.path
    if (!imported?.isImportSpecifier()) return null
    const target = sourcePath(imported.parent.source.value, file)
    return target && exported(target, imported.node.imported.name)
  }
  const literal = (node) =>
    node?.type === 'StringLiteral'
      ? node.value
      : node?.type === 'TemplateLiteral' && node.expressions.length === 0
        ? node.quasis[0].value.cooked
        : null
  function table(symbol) {
    const call = symbol?.node
    if (
      call?.type !== 'CallExpression' ||
      literal(call.arguments[0]) === null ||
      call.arguments[1]?.type !== 'ObjectExpression'
    )
      return null
    let schema
    if (call.callee.type === 'Identifier') {
      const factory = local(symbol.path, call.callee.name, new Set())
      if (
        factory?.source !== 'drizzle-orm/pg-core' ||
        factory.imported !== 'pgTable'
      )
        return null
    } else if (
      call.callee.type === 'MemberExpression' &&
      !call.callee.computed &&
      call.callee.property.name === 'table' &&
      call.callee.object.type === 'Identifier'
    ) {
      const namespace = local(symbol.path, call.callee.object.name, new Set())
      const init = namespace?.node
      if (
        init?.type !== 'CallExpression' ||
        init.callee.type !== 'Identifier' ||
        literal(init.arguments[0]) === null
      )
        return null
      const factory = local(namespace.path, init.callee.name, new Set())
      if (
        factory?.source !== 'drizzle-orm/pg-core' ||
        factory.imported !== 'pgSchema'
      )
        return null
      schema = literal(init.arguments[0])
    } else return null
    for (const column of call.arguments[1].properties) {
      if (column.type !== 'ObjectProperty' || column.computed) return null
      let expression = column.value
      while (
        expression.type === 'CallExpression' &&
        expression.callee.type === 'MemberExpression' &&
        !expression.callee.computed
      ) {
        if (
          ![
            'notNull',
            'primaryKey',
            'unique',
            'default',
            'defaultNow',
            'defaultRandom',
            ...(analysis.operation === 'select' ? ['$defaultFn'] : []),
            'references',
            '$type',
          ].includes(expression.callee.property.name)
        )
          return null
        expression = expression.callee.object
      }
      if (
        expression.type !== 'CallExpression' ||
        expression.callee.type !== 'Identifier'
      )
        return null
      const factory = local(symbol.path, expression.callee.name, new Set())
      const enumFactory =
        factory?.node?.type === 'CallExpression' &&
        factory.node.callee.type === 'Identifier'
          ? local(factory.path, factory.node.callee.name, new Set())
          : null
      if (
        enumFactory?.source === 'drizzle-orm/pg-core' &&
        enumFactory.imported === 'pgEnum'
      )
        continue
      if (
        factory?.source !== 'drizzle-orm/pg-core' ||
        ![
          'json',
          'jsonb',
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
        ].includes(factory.imported)
      )
        return null
    }
    return { schema, name: literal(call.arguments[0]) }
  }
  try {
    const database = binding(analysis.database)
    const snapshotModule = sourcePath(
      resolve(root, snapshot.databaseModule),
      file,
    )
    const expected = snapshotModule && exported(snapshotModule, 'db')
    if (
      !database ||
      !expected ||
      database.path !== expected.path ||
      database.name !== expected.name
    )
      return { dependencies: null, files: [...files.keys()] }
    const constructor = database.node
    const factory =
      constructor?.type === 'CallExpression' &&
      constructor.callee.type === 'Identifier'
        ? local(database.path, constructor.callee.name, new Set())
        : null
    if (
      factory?.imported !== 'drizzle' ||
      ![
        'drizzle-orm/pglite',
        'drizzle-orm/node-postgres',
        'drizzle-orm/postgres-js',
      ].includes(factory.source)
    )
      return { dependencies: null, files: [...files.keys()] }
    const tables = analysis.tables.map((name) => table(binding(name)))
    if (tables.some((t) => !t))
      return { dependencies: null, files: [...files.keys()] }
    const dependencies = schemaFootprint(snapshot, tables, analysis.operation)
    // The module identifies the configured database; schema/name identify tables.
    const authority = createHash('sha256')
      .update(database.path + ':' + database.name)
      .digest('hex')
      .slice(0, 12)
    return {
      dependencies: dependencies?.map((id) => authority + ':' + id) ?? null,
      files: [...files.keys()],
      fingerprint: createHash('sha256')
        .update([...files.values()].map((f) => f.code).join('\0'))
        .digest('hex'),
    }
  } catch {
    return { dependencies: null, files: [...files.keys()] }
  }
}
