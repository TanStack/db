/**
 * A generated property's failure is reported as a seed and a shrink path,
 * and the shared variables TANSTACK_DB_ORACLE_SEED and
 * TANSTACK_DB_ORACLE_PATH replay it. That works only when every campaign takes
 * its seed from one of the places a replay can reach. This rule reports a
 * `seed` option that a replay cannot reach:
 *
 * - A seed that can be `undefined`: the literal `undefined`, or a parameter of
 *   an `.each(table)` callback whose table holds `undefined`, used where
 *   nothing routes the `undefined`-seed campaign elsewhere. fast-check then
 *   draws a fresh seed on every run, which the shared variables never select,
 *   and the explicit `undefined` also overrides a global seed. The accepted
 *   form routes that campaign to the shared config:
 *   `seed === undefined ? oraclePropertyOptions(runs, id) : { seed, ... }`.
 * - A seed computed from a clock or ambient randomness, such as `Date.now()`
 *   or `Math.random()`, unless it only fills in for the shared config's seed,
 *   as in `oraclePropertyOptions(runs, id).seed ?? Date.now()`: a replay
 *   supplies that seed, and the fallback is the random campaign.
 *
 * A number literal, a constant, a recorded seed such as `failure.seed`, and a
 * parameter whose table holds only numbers are all replayable. oracle-config
 * and oracle-property implement the shared selection, so they may pick a
 * random campaign's seed themselves.
 *
 * The rule cannot see a seed passed through a helper's parameter from a call
 * elsewhere, a seed computed in a variable (such as
 * `const seed = options.seed ?? Math.random()`), or a table built by a
 * function. Reviewers still check those.
 */

import { findVariable } from '../registration.js'

const sharedSelectionModule =
  /(^|[/\\])packages[/\\]db[/\\]tests[/\\]oracle-(config|property)\.ts$/
const ambientCalls = new Set([
  `Date.now`,
  `Math.random`,
  `performance.now`,
  `crypto.getRandomValues`,
  `crypto.randomUUID`,
])

function propertyName(property) {
  if (property.type !== `Property` || property.computed) return undefined
  return property.key.type === `Identifier`
    ? property.key.name
    : property.key.value
}

/** `oraclePropertyOptions(...).seed ?? fallback`: the fallback is a random campaign. */
function isSharedSeedFallback(node) {
  return (
    node.type === `LogicalExpression` &&
    node.operator === `??` &&
    node.left.type === `MemberExpression` &&
    node.left.property.type === `Identifier` &&
    node.left.property.name === `seed` &&
    node.left.object.type === `CallExpression` &&
    node.left.object.callee.type === `Identifier` &&
    node.left.object.callee.name === `oraclePropertyOptions`
  )
}

const isUndefined = (node) =>
  node?.type === `Identifier` && node.name === `undefined`

/** The `a.b` name of a call's callee, for a member call on an identifier. */
function memberCallName(node) {
  if (node.type !== `CallExpression`) return undefined
  const { callee } = node
  if (
    callee.type !== `MemberExpression` ||
    callee.object.type !== `Identifier` ||
    callee.property.type !== `Identifier`
  ) {
    return undefined
  }
  return `${callee.object.name}.${callee.property.name}`
}

/** The ambient call inside `node`, if any. */
function ambientCall(node) {
  let found
  const visit = (current) => {
    if (found || current === null || typeof current !== `object`) return
    if (Array.isArray(current)) return current.forEach(visit)
    if (typeof current.type !== `string`) return
    if (current.type === `NewExpression` && current.callee.name === `Date`) {
      if (current.arguments.length === 0) found = `new Date()`
      return
    }
    const name = memberCallName(current)
    if (name !== undefined && ambientCalls.has(name)) {
      found = `${name}()`
      return
    }
    for (const key of Object.keys(current)) {
      if (key !== `parent`) visit(current[key])
    }
  }
  visit(node)
  return found
}

/**
 * The `.each(table)` table that supplies `parameter`, when the parameter's
 * function is the test body of `test.each(table)(name, body)`, inline or
 * named.
 */
function eachTableOf(fn, sourceCode) {
  const bodyCall = (node) => {
    const call = node.parent
    if (call?.type !== `CallExpression` || call.arguments[1] !== node) {
      return undefined
    }
    const each = call.callee
    return each.type === `CallExpression` &&
      each.callee.type === `MemberExpression` &&
      each.callee.property.name === `each`
      ? each.arguments[0]
      : undefined
  }
  const direct = bodyCall(fn)
  if (direct !== undefined) return direct
  // A named body: find the `.each(table)(name, body)` call that passes it.
  const name =
    fn.type === `FunctionDeclaration`
      ? fn.id?.name
      : fn.parent?.type === `VariableDeclarator`
        ? fn.parent.id.name
        : undefined
  if (name === undefined) return undefined
  const variable = findVariable(sourceCode.getScope(fn), name)
  for (const reference of variable?.references ?? []) {
    const table = bodyCall(reference.identifier)
    if (table !== undefined) return table
  }
  return undefined
}

/** The array literal that `node` is, or that a constant `node` names. */
function arrayLiteral(node, sourceCode) {
  if (node?.type === `ArrayExpression`) return node
  if (node?.type !== `Identifier`) return undefined
  const definition = findVariable(sourceCode.getScope(node), node.name)?.defs[0]
  return definition?.type === `Variable` &&
    definition.node.init?.type === `ArrayExpression`
    ? definition.node.init
    : undefined
}

/** Whether `node` lies on the branch where `name` is known to be defined. */
function guardedAgainstUndefined(node, name) {
  const definedWhen = (test) => {
    if (test?.type !== `BinaryExpression`) return undefined
    const sides = [test.left, test.right]
    const namesIt = sides.some(
      (side) => side.type === `Identifier` && side.name === name,
    )
    if (!namesIt || !sides.some(isUndefined)) return undefined
    if (test.operator === `===` || test.operator === `==`) return false
    if (test.operator === `!==` || test.operator === `!=`) return true
    return undefined
  }
  for (let child = node, parent = node.parent; parent;) {
    if (
      parent.type === `ConditionalExpression` ||
      parent.type === `IfStatement`
    ) {
      const defined = definedWhen(parent.test)
      const branch =
        child === parent.consequent
          ? true
          : child === parent.alternate
            ? false
            : undefined
      if (defined !== undefined && branch !== undefined && defined === branch)
        return true
    }
    child = parent
    parent = parent.parent
  }
  return false
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: `problem`,
    docs: {
      description: `Report a property seed that the shared replay variables cannot select.`,
    },
    schema: [],
    messages: {
      undefinedSeed: `This seed can be \`undefined\`, so fast-check draws a fresh seed that TANSTACK_DB_ORACLE_SEED and TANSTACK_DB_ORACLE_PATH cannot replay, and the explicit \`undefined\` overrides a global seed. Route that campaign to the shared config: \`seed === undefined ? oraclePropertyOptions(runs, id) : { seed, ... }\`.`,
      ambientSeed: `This seed comes from \`{{call}}\`, so the shared replay variables cannot select it and two runs draw different histories. Use a number literal or constant, a recorded seed, or \`oraclePropertyOptions(runs, id)\`.`,
    },
  },
  create(context) {
    const { sourceCode } = context
    if (sharedSelectionModule.test(context.filename)) return {}
    return {
      Property(node) {
        if (propertyName(node) !== `seed`) return
        const value = node.value
        const call = isSharedSeedFallback(value)
          ? undefined
          : ambientCall(value)
        if (call !== undefined) {
          context.report({ node, messageId: `ambientSeed`, data: { call } })
          return
        }
        if (isUndefined(value)) {
          context.report({ node, messageId: `undefinedSeed` })
          return
        }
        if (value.type !== `Identifier`) return
        const definition = findVariable(sourceCode.getScope(value), value.name)
          ?.defs[0]
        if (definition?.type !== `Parameter`) return
        const fn = definition.node
        if (
          fn.params[0]?.type !== `Identifier` ||
          fn.params[0].name !== value.name
        )
          return
        const table = arrayLiteral(eachTableOf(fn, sourceCode), sourceCode)
        if (
          table?.elements.some(isUndefined) &&
          !guardedAgainstUndefined(node, value.name)
        ) {
          context.report({ node, messageId: `undefinedSeed` })
        }
      },
    }
  },
}
