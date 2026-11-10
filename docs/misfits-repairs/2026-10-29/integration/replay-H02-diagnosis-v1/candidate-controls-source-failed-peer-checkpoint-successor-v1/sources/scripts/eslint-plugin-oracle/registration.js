/**
 * How the oracle rules recognize a test registration and the shared helpers
 * from oracle-config. Every rule uses these, so that the rules agree on what
 * a test is.
 */

export const testRoots = new Set([`describe`, `fcTest`, `it`, `suite`, `test`])
export const disablingModifiers = new Set([`fixme`, `skip`, `todo`])
export const conditionalModifiers = new Set([`runIf`, `skipIf`])
export const aliasModifiers = new Set([
  ...disablingModifiers,
  ...conditionalModifiers,
  `only`,
])
// The members that keep a call a test registration. Playwright's `test` also
// has calls such as `test.info()` and `test.step()` that register nothing.
export const registrationMembers = new Set([
  ...aliasModifiers,
  `concurrent`,
  `describe`,
  `each`,
  `fails`,
  `for`,
  `parallel`,
  `prop`,
  `sequential`,
  `serial`,
])
// The shared helpers that return a test registration or its `skip` form.
export const selectionHelpers = new Set([
  `oracleCalibrationTest`,
  `oracleReplayTest`,
])

/** The root identifier and member names of a callee such as `it.skip.prop(...)`. */
export function calleeChain(callee) {
  const names = []
  let node = callee
  for (;;) {
    if (node.type === `MemberExpression`) {
      if (node.property.type === `Identifier`) names.unshift(node.property.name)
      node = node.object
    } else if (
      node.type === `CallExpression` &&
      node.callee.type === `Identifier` &&
      selectionHelpers.has(node.callee.name) &&
      node.arguments.length > 0
    ) {
      // `oracleReplayTest(it)` returns `it` or `it.skip`, so a registration
      // made through it is checked as a registration of `it`.
      node = node.arguments[0]
    } else if (node.type === `CallExpression`) {
      node = node.callee
    } else {
      break
    }
  }
  return {
    root: node.type === `Identifier` ? node.name : undefined,
    rootNode: node,
    names,
  }
}

/**
 * Whether an identifier names a test function: `it`, `test`, and the
 * other test roots, a renamed import of one (`import { it as vitestIt }`),
 * or a constant bound to one through a selection helper or a member chain
 * (`const fixedCase = oracleReplayTest(it)`). A registration made through
 * such a constant is checked as a registration of its test.
 */
export function isTestRoot(node, sourceCode, seen = new Set()) {
  if (node?.type !== `Identifier`) return false
  if (testRoots.has(node.name)) return true
  const definition = findVariable(sourceCode.getScope(node), node.name)?.defs[0]
  if (definition === undefined || seen.has(definition.node)) return false
  seen.add(definition.node)
  if (definition.type === `ImportBinding`) {
    const imported = definition.node.imported
    return (
      imported !== undefined && testRoots.has(imported.name ?? imported.value)
    )
  }
  return (
    definition.type === `Variable` &&
    definition.parent.kind === `const` &&
    definition.node.init !== null &&
    isTestRoot(calleeChain(definition.node.init).rootNode, sourceCode, seen)
  )
}

export function isFunction(node) {
  return (
    node?.type === `ArrowFunctionExpression` ||
    node?.type === `FunctionExpression`
  )
}

export function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable !== undefined) return variable
  }
  return undefined
}

/** Whether `source` is an import specifier of the shared oracle-config module. */
export function isOracleConfigSource(source) {
  return /(^|\/)oracle-(config|declaration)(\.js)?$/.test(source)
}

/** A call to one of `names`, imported from oracle-config. */
export function isSharedHelperCall(node, names, sourceCode) {
  if (
    node?.type !== `CallExpression` ||
    node.callee.type !== `Identifier` ||
    !names.has(node.callee.name)
  ) {
    return false
  }
  const definition = findVariable(sourceCode.getScope(node), node.callee.name)
    ?.defs[0]
  return (
    definition?.type === `ImportBinding` &&
    isOracleConfigSource(definition.parent.source.value)
  )
}

/**
 * The test that a call registers, as `{ body }`, or undefined when the call
 * registers no test. A suite (`describe`) registers no test of its own. The
 * body is the function, or the name of the function, that the test runs.
 */
export function registeredTest(node, sourceCode) {
  if (node.parent.type === `CallExpression` && node.parent.callee === node) {
    // `it.each(table)` is the callee of the registration, not one itself.
    return undefined
  }
  const { root, rootNode, names } = calleeChain(node.callee)
  if (
    !isTestRoot(rootNode, sourceCode) ||
    root === `describe` ||
    root === `suite` ||
    names.includes(`describe`) ||
    !names.every((member) => registrationMembers.has(member))
  ) {
    return undefined
  }
  const body = registrationBody(node.arguments.slice(1), sourceCode)
  return body === undefined ? undefined : { body }
}

/**
 * The argument that a registration runs. Vitest takes `(name, fn, options)` or
 * `(name, options, fn)`, so the body is the function wherever it is. Without a
 * function, the body is a call or member expression that yields one, then an
 * identifier. An options object, a number, or a value that is not a function
 * binding is never the body while another argument can be.
 */
function registrationBody(args, sourceCode) {
  return (
    args.find(isFunction) ??
    args.find(
      (argument) =>
        argument.type === `Identifier` &&
        isFunctionBinding(argument, sourceCode),
    ) ??
    args.find(
      (argument) =>
        !plainValueTypes.has(argument.type) && argument.type !== `Identifier`,
    ) ??
    args.find((argument) => argument.type === `Identifier`)
  )
}

// Argument types that carry data, not behavior, so they can be options.
const plainValueTypes = new Set([
  `Literal`,
  `ObjectExpression`,
  `ArrayExpression`,
  `TemplateLiteral`,
])

/**
 * Whether an identifier names a function, or may. A binding that holds a plain
 * value is not a function. An import, a parameter, or a call result may be one.
 */
function isFunctionBinding(identifier, sourceCode) {
  const definition = findVariable(
    sourceCode.getScope(identifier),
    identifier.name,
  )?.defs[0]
  if (definition?.type === `FunctionName`) return true
  if (definition?.type === `Variable`) {
    const init = definition.node.init
    return init !== null && !plainValueTypes.has(init.type)
  }
  return definition !== undefined
}
