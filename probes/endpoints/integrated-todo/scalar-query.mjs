// Bounded source analysis. Imported fixture tables/auth remain trusted; this
// does not infer PostgreSQL column types, constraints or arbitrary SQL semantics.
const identifier = (node, name) =>
  node?.type === 'Identifier' && node.name === name
const member = (node, object, property) =>
  node?.type === 'MemberExpression' &&
  !node.computed &&
  identifier(node.object, object) &&
  identifier(node.property, property)

// A direct, unfiltered table result needs no Todo fields or auth binding. The
// authored row schema supplies its runtime shape contract. Keep its projection
// and unfiltered scope separate from the legacy scoped scalar model: sharing a
// physical table alone does not make two returned row representations compatible.
function analyzeUnfilteredQuery(path) {
  const { params, body } = path.node
  if (
    params.length !== 2 ||
    params.some((param) => param.type !== 'Identifier')
  )
    return null
  const [request, response] = params
  const statements = [...body.body]
  const returned = statements.pop()
  if (
    returned?.type !== 'ReturnStatement' ||
    returned.argument?.type !== 'CallExpression' ||
    !member(returned.argument.callee, response.name, 'json') ||
    returned.argument.arguments.length !== 1
  )
    return null
  let read = returned.argument.arguments[0]
  if (read.type === 'Identifier') {
    const statement = statements.pop()
    if (
      statement?.type !== 'VariableDeclaration' ||
      statement.kind !== 'const' ||
      statement.declarations.length !== 1 ||
      !identifier(statement.declarations[0].id, read.name)
    )
      return null
    read = statement.declarations[0].init
  }
  // Preserve authored guards without interpreting their authorization policy.
  // Only standalone awaited imported calls may precede this direct result.
  for (const statement of statements) {
    let guard =
      statement.type === 'ExpressionStatement' ? statement.expression : null
    if (
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'const' &&
      statement.declarations.length === 1 &&
      statement.declarations[0].id.type === 'Identifier'
    )
      guard = statement.declarations[0].init
    const call = guard?.type === 'AwaitExpression' ? guard.argument : null
    if (
      call?.type !== 'CallExpression' ||
      call.callee.type !== 'Identifier' ||
      !path.scope.getBinding(call.callee.name)?.path.isImportSpecifier() ||
      call.arguments.length !== 1 ||
      !identifier(call.arguments[0], request.name)
    )
      return null
  }
  if (read?.type !== 'AwaitExpression') return null
  const from = read.argument
  if (
    from?.type !== 'CallExpression' ||
    from.callee.type !== 'MemberExpression' ||
    from.callee.computed ||
    !identifier(from.callee.property, 'from') ||
    from.arguments.length !== 1 ||
    from.arguments[0].type !== 'Identifier'
  )
    return null
  const select = from.callee.object
  if (
    select.type !== 'CallExpression' ||
    !member(select.callee, 'db', 'select') ||
    select.arguments.length > 1
  )
    return null
  const database = path.scope.getBinding('db')
  const table = path.scope.getBinding(from.arguments[0].name)
  if (
    !database?.path.isImportSpecifier() ||
    database.path.node.imported.name !== 'db' ||
    !table?.path.isImportSpecifier() ||
    table.path.parent.source.value !== database.path.parent.source.value ||
    !/^\.\.?\/(?:.*\/)?database\.server(?:\.ts)?$/.test(
      database.path.parent.source.value,
    )
  )
    return null
  let fields
  if (select.arguments.length) {
    const projection = select.arguments[0]
    if (projection.type !== 'ObjectExpression') return null
    fields = []
    for (const property of projection.properties) {
      if (
        property.type !== 'ObjectProperty' ||
        property.computed ||
        property.key.type !== 'Identifier' ||
        ['__proto__', 'constructor', 'prototype'].includes(property.key.name) ||
        !member(property.value, from.arguments[0].name, property.key.name)
      )
        return null
      fields.push(property.key.name)
    }
    if (!fields.includes('id') || new Set(fields).size !== fields.length)
      return null
  }
  return {
    relation: `${table.path.node.imported.name}:unfiltered:${fields ? JSON.stringify([...fields].sort()) : '*'}`,
    order: [],
    membership: { kind: 'all' },
    ...(fields ? { fields } : {}),
  }
}

export function analyzeScalarQuery(
  path,
  fail,
  parameters = {},
  { rowSchema = false } = {},
) {
  if (rowSchema) {
    const unfiltered = analyzeUnfilteredQuery(path)
    if (unfiltered) return unfiltered
  }
  const handler = path.node
  const reject = (message, node = handler) =>
    fail(`ENDPOINT_ORDER_NOT_CHECKED ${message}`, node)
  function imported(name, source) {
    const binding = path.scope.getBinding(name)
    if (
      !binding?.path.isImportSpecifier() ||
      binding.path.parent.source.value !== source
    )
      reject(`untrusted query binding ${name}`)
    return binding.path.node.imported.name
  }
  const databaseSource = path.scope.getBinding('db')?.path.parent.source?.value
  if (
    typeof databaseSource !== 'string' ||
    !/^\.\.?\/(?:.*\/)?database\.server(?:\.ts)?$/.test(databaseSource)
  )
    reject('untrusted database import')
  for (const name of ['db', 'requireUser'])
    if (imported(name, databaseSource) !== name) reject(`untrusted ${name}`)
  const statements = handler.body.body
  if (
    handler.params.length !== 2 ||
    !identifier(handler.params[0], 'req') ||
    !identifier(handler.params[1], 'res') ||
    statements.length !== 3
  )
    reject('unsupported handler shape')
  const [authStatement, readStatement, returned] = statements
  const declaration = (statement) =>
    statement?.type === 'VariableDeclaration' &&
    statement.kind === 'const' &&
    statement.declarations.length === 1
      ? statement.declarations[0]
      : undefined
  const auth = declaration(authStatement),
    read = declaration(readStatement)
  if (
    !identifier(auth?.id, 'user') ||
    auth.init?.type !== 'AwaitExpression' ||
    auth.init.argument.type !== 'CallExpression' ||
    !identifier(auth.init.argument.callee, 'requireUser') ||
    auth.init.argument.arguments.length !== 1 ||
    !identifier(auth.init.argument.arguments[0], 'req')
  )
    reject('unsupported auth binding')
  if (read?.id.type !== 'Identifier' || read.init?.type !== 'AwaitExpression')
    reject('unsupported query binding')
  const result = returned.argument
  if (
    returned.type !== 'ReturnStatement' ||
    result?.type !== 'CallExpression' ||
    !member(result.callee, 'res', 'json') ||
    result.arguments.length !== 1 ||
    !identifier(result.arguments[0], read.id.name)
  )
    reject('response transform or non-direct return')
  let cursor = read.init.argument
  const chain = []
  while (
    cursor?.type === 'CallExpression' &&
    cursor.callee.type === 'MemberExpression' &&
    !cursor.callee.computed
  ) {
    chain.unshift({ name: cursor.callee.property.name, args: cursor.arguments })
    cursor = cursor.callee.object
  }
  if (
    !identifier(cursor, 'db') ||
    chain.map((item) => item.name).join(',') !== 'select,from,where,orderBy'
  )
    reject('unsupported query chain')
  const [select, from, where, order] = chain
  if (from.args.length !== 1 || from.args[0].type !== 'Identifier')
    reject('unsupported source table')
  const table = from.args[0].name
  const relation = imported(table, databaseSource)
  if (select.args.length !== 1 || select.args[0].type !== 'ObjectExpression')
    reject('unsupported projection')
  const fields = select.args[0].properties.map((property) => {
    if (
      property.type !== 'ObjectProperty' ||
      property.computed ||
      property.key.type !== 'Identifier' ||
      !member(property.value, table, property.key.name) ||
      property.key.name.startsWith('$') ||
      ['userId', '__proto__', 'constructor', 'prototype'].includes(
        property.key.name,
      )
    )
      reject('unsupported projection')
    return property.key.name
  })
  if (
    new Set(fields).size !== fields.length ||
    !['id', 'text', 'completed', 'createdAt'].every((field) =>
      fields.includes(field),
    )
  )
    reject('projection requires base row fields')
  const orders = order.args.map((arg) => {
    if (
      arg.type !== 'CallExpression' ||
      arg.callee.type !== 'Identifier' ||
      imported(arg.callee.name, 'drizzle-orm') !== 'asc' ||
      arg.arguments.length !== 1 ||
      !['createdAt', 'id'].some((field) =>
        member(arg.arguments[0], table, field),
      )
    )
      reject('unsupported ordering')
    return arg.arguments[0].property.name
  })
  if (!orders.includes('id')) reject('total order must include id')
  function operator(node) {
    if (node?.type !== 'CallExpression' || node.callee.type !== 'Identifier')
      reject('unsupported predicate')
    return imported(node.callee.name, 'drizzle-orm')
  }
  const authPredicate = (node) =>
    operator(node) === 'eq' &&
    node.arguments.length === 2 &&
    member(node.arguments[0], table, 'userId') &&
    member(node.arguments[1], 'user', 'id')
  function predicate(node) {
    const op = operator(node)
    if (['and', 'or'].includes(op) && node.arguments.length >= 2)
      return { op, args: node.arguments.map(predicate) }
    const column = node.arguments[0]
    if (
      column?.type !== 'MemberExpression' ||
      column.computed ||
      !identifier(column.object, table) ||
      !fields.includes(column.property.name)
    )
      reject('predicate column must be selected')
    if (['isNull', 'isNotNull'].includes(op) && node.arguments.length === 1)
      return { op, column: column.property.name }
    const literal = node.arguments[1]
    if (
      literal?.type === 'MemberExpression' &&
      !literal.computed &&
      member(literal.object, 'req', 'body')
    ) {
      const name = literal.property.name
      if (
        !Object.hasOwn(parameters, name) ||
        !['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(op) ||
        node.arguments.length !== 2
      )
        reject('unsupported query parameter')
      if (!['eq', 'ne'].includes(op) && parameters[name] !== 'number')
        reject('range parameter requires an integer input')
      return { op, column: column.property.name, value: { parameter: name } }
    }
    let value = literal?.value
    if (
      literal?.type === 'UnaryExpression' &&
      literal.operator === '-' &&
      literal.argument.type === 'NumericLiteral'
    )
      value = -literal.argument.value
    else if (
      !['NumericLiteral', 'BooleanLiteral', 'StringLiteral'].includes(
        literal?.type,
      )
    )
      reject('unsupported predicate literal')
    if (
      !['eq', 'ne', 'gt', 'gte', 'lt', 'lte'].includes(op) ||
      node.arguments.length !== 2
    )
      reject('unsupported predicate operator')
    if (typeof value === 'number' && !Number.isSafeInteger(value))
      reject('numeric predicate requires a safe integer literal')
    // Text equality and booleans are exact in this fixture. Text ordering and
    // non-integer numeric semantics need a type/collation proof before optimism.
    if (!['eq', 'ne'].includes(op) && !Number.isSafeInteger(value))
      reject('range predicate requires an integer literal')
    return { op, column: column.property.name, value }
  }
  if (where.args.length !== 1) reject('unsupported predicate')
  const condition = where.args[0]
  let membership = { kind: 'all' }
  if (!authPredicate(condition)) {
    if (
      operator(condition) !== 'and' ||
      condition.arguments.length !== 2 ||
      !authPredicate(condition.arguments[0])
    )
      reject('scope predicate must enclose the row predicate')
    const expression = predicate(condition.arguments[1])
    membership =
      expression.op === 'eq' &&
      expression.column === 'completed' &&
      typeof expression.value === 'boolean'
        ? { kind: 'completed', value: expression.value }
        : { kind: 'expression', expression }
  }
  return { relation, order: orders, membership, fields }
}
