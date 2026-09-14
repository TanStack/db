// Deliberately closed grammar. Unknown syntax is a fallback, not a compiler
// error. This finds candidates; the build-time snapshot must certify the tables.
export function analyzeHandlerDependencies(handler, kind, input) {
  const imported = (name, source) => {
    const binding = handler.scope.getBinding(name)
    return binding?.path.isImportSpecifier() &&
      (!source || binding.path.parent.source.value === source)
      ? binding.path.node.imported.name
      : null
  }
  function schema(node) {
    if (
      node.type !== 'CallExpression' ||
      node.callee.type !== 'MemberExpression' ||
      node.callee.computed
    )
      return false
    const { object, property } = node.callee
    if (object.type === 'Identifier' && imported(object.name, 'zod') === 'z') {
      if (property.name === 'object')
        return (
          node.arguments.length === 1 &&
          node.arguments[0].type === 'ObjectExpression' &&
          node.arguments[0].properties.every(
            (p) =>
              p.type === 'ObjectProperty' && !p.computed && schema(p.value),
          )
        )
      return (
        ['string', 'number', 'boolean'].includes(property.name) &&
        node.arguments.length === 0
      )
    }
    return (
      ['int', 'nullable', 'optional', 'strict'].includes(property.name) &&
      node.arguments.length === 0 &&
      schema(object)
    )
  }
  if (!schema(input.node)) return null
  const params = handler.node.params
  if (params.length !== 2 || params.some((p) => p.type !== 'Identifier'))
    return null
  const [request, response] = params.map((p) => p.name)
  let resultName, chain, inputAlias
  const body = [...handler.node.body.body]
  const alias = body[0]
  if (
    alias?.type === 'VariableDeclaration' &&
    alias.kind === 'const' &&
    alias.declarations.length === 1
  ) {
    const { id, init } = alias.declarations[0]
    if (
      id.type === 'Identifier' &&
      init?.type === 'MemberExpression' &&
      !init.computed &&
      init.object.name === request &&
      init.property.name === 'body'
    ) {
      inputAlias = id.name
      body.shift()
    }
  }
  const last = body.pop()
  const call = last?.type === 'ReturnStatement' ? last.argument : null
  if (
    call?.type !== 'CallExpression' ||
    call.callee.type !== 'MemberExpression' ||
    call.callee.computed ||
    call.callee.object.name !== response ||
    call.callee.property.name !== 'json' ||
    call.arguments.length !== 1
  )
    return null
  const returned = call.arguments[0]
  if (body.length === 0 && returned.type === 'AwaitExpression')
    chain = returned.argument
  else if (body.length === 1) {
    const statement = body[0]
    if (
      statement.type === 'VariableDeclaration' &&
      statement.kind === 'const' &&
      statement.declarations.length === 1
    ) {
      const { id, init } = statement.declarations[0]
      if (
        id.type !== 'Identifier' ||
        init?.type !== 'AwaitExpression' ||
        returned.type !== 'Identifier' ||
        returned.name !== id.name
      )
        return null
      resultName = id.name
      chain = init.argument
    } else if (
      kind === 'mutation' &&
      statement.type === 'ExpressionStatement' &&
      statement.expression.type === 'AwaitExpression'
    )
      chain = statement.expression.argument
  }
  if (!chain) return null
  const methods = []
  while (
    chain.type === 'CallExpression' &&
    chain.callee.type === 'MemberExpression' &&
    !chain.callee.computed
  ) {
    methods.unshift({ name: chain.callee.property.name, args: chain.arguments })
    chain = chain.callee.object
  }
  if (chain.type !== 'Identifier' || !imported(chain.name)) return null
  const database = chain.name
  const operation = methods[0]?.name
  if (
    kind === 'query'
      ? operation !== 'select'
      : !['insert', 'update', 'delete'].includes(operation)
  )
    return null
  const tables = new Set()
  const table = (node) => {
    if (node?.type !== 'Identifier' || !imported(node.name)) return false
    tables.add(node.name)
    return true
  }
  // Collect table bindings before checking column expressions.
  if (operation !== 'select' && !table(methods[0].args[0])) return null
  for (const method of methods)
    if (method.name === 'from' && !table(method.args[0])) return null
  function value(node, columns = false) {
    if (!node) return false
    if (
      [
        'StringLiteral',
        'NumericLiteral',
        'BooleanLiteral',
        'NullLiteral',
      ].includes(node.type)
    )
      return true
    if (
      node.type === 'UnaryExpression' &&
      node.operator === '-' &&
      node.argument.type === 'NumericLiteral'
    )
      return true
    if (node.type === 'ObjectExpression')
      return node.properties.every(
        (p) =>
          p.type === 'ObjectProperty' && !p.computed && value(p.value, columns),
      )
    if (node.type === 'ArrayExpression')
      return node.elements.every((n) => value(n, columns))
    if (node.type !== 'MemberExpression' || node.computed) return false
    if (node.object.type === 'Identifier')
      return (
        (columns && tables.has(node.object.name)) ||
        (inputAlias && node.object.name === inputAlias) ||
        (node.object.name === request && node.property.name === 'scope')
      )
    return (
      node.object.type === 'MemberExpression' &&
      !node.object.computed &&
      node.object.object.name === request &&
      node.object.property.name === 'body'
    )
  }
  function expression(node) {
    if (value(node, true)) return true
    if (node.type !== 'CallExpression' || node.callee.type !== 'Identifier')
      return false
    const name = imported(node.callee.name, 'drizzle-orm')
    const arity = {
      eq: 2,
      ne: 2,
      gt: 2,
      gte: 2,
      lt: 2,
      lte: 2,
      isNull: 1,
      isNotNull: 1,
      asc: 1,
      desc: 1,
    }
    if (name === 'and' || name === 'or')
      return node.arguments.length > 0 && node.arguments.every(expression)
    return (
      arity[name] === node.arguments.length &&
      node.arguments.every((n) => value(n, true))
    )
  }
  const allowed =
    operation === 'select'
      ? ['select', 'from', 'where', 'orderBy', 'limit', 'offset']
      : operation === 'insert'
        ? ['insert', 'values', 'returning']
        : operation === 'update'
          ? ['update', 'set', 'where', 'returning']
          : ['delete', 'where', 'returning']
  if (new Set(methods.map((m) => m.name)).size !== methods.length) return null
  for (const { name, args } of methods) {
    if (!allowed.includes(name)) return null
    if (['from', 'insert', 'update', 'delete'].includes(name)) {
      if (args.length !== 1 || !table(args[0])) return null
    } else if (['select', 'returning'].includes(name)) {
      if (args.length > 1 || (args.length && !value(args[0], true))) return null
    } else if (name === 'orderBy') {
      if (!args.length || !args.every(expression)) return null
    } else if (name === 'where') {
      if (args.length !== 1 || !expression(args[0])) return null
    } else if (args.length !== 1 || !value(args[0])) return null
  }
  if (
    !tables.size ||
    (operation === 'select' && !methods.some((m) => m.name === 'from'))
  )
    return null
  if (
    kind === 'mutation' &&
    returned.type !== 'AwaitExpression' &&
    !resultName &&
    !value(returned)
  )
    return null
  return { database, tables: [...tables], operation }
}
