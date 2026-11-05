/**
 * An `oracleProperty` keeps its parts' jobs separate (oracle rubric, ORC-003):
 * the driver touches production and the environment, and the model, the
 * check, the reach classifier, and the state prediction are functions of the
 * history and the recorded trace. A model that reads a clock or draws a random number gives a
 * different expectation for the same history, so a failure stops replaying
 * and the expectation is no longer independent of when it ran. This rule
 * reports a `model`, `check`, `reached`, or `predict` part that reads a clock, draws
 * ambient randomness, or schedules a timer, directly or through a function
 * declared in the same file.
 *
 * The driver is not restricted: the property's determinism test judges what
 * it records. The rule cannot see into imported functions; reviewers still
 * check those.
 */

import { findVariable } from '../registration.js'

const pureParts = new Set([`model`, `check`, `reached`, `predict`])
const ambientMembers = new Set([
  `Date.now`,
  `Math.random`,
  `performance.now`,
  `crypto.getRandomValues`,
  `crypto.randomUUID`,
])
const ambientGlobals = new Set([
  `setTimeout`,
  `setInterval`,
  `setImmediate`,
  `queueMicrotask`,
])

function propertyName(property) {
  if (property.type !== `Property` || property.computed) return undefined
  return property.key.type === `Identifier`
    ? property.key.name
    : property.key.value
}

const isFunction = (node) =>
  node?.type === `ArrowFunctionExpression` ||
  node?.type === `FunctionExpression` ||
  node?.type === `FunctionDeclaration`

/** The function that `node` is, or that a same-file binding `node` names. */
function functionOf(node, sourceCode) {
  if (isFunction(node)) return node
  if (node?.type !== `Identifier`) return undefined
  const definition = findVariable(sourceCode.getScope(node), node.name)?.defs[0]
  if (definition?.type === `FunctionName`) return definition.node
  if (definition?.type === `Variable` && isFunction(definition.node.init))
    return definition.node.init
  return undefined
}

/** The first ambient read in `fn` or a same-file function it calls. */
function ambientRead(fn, sourceCode, seen = new Set()) {
  if (seen.has(fn)) return undefined
  seen.add(fn)
  let found
  const visit = (node) => {
    if (found || node === null || typeof node !== `object`) return
    if (Array.isArray(node)) return node.forEach(visit)
    if (typeof node.type !== `string`) return
    if (
      node.type === `NewExpression` &&
      node.callee.type === `Identifier` &&
      node.callee.name === `Date` &&
      node.arguments.length === 0
    ) {
      found = { call: `new Date()` }
      return
    }
    if (node.type === `CallExpression`) {
      const { callee } = node
      if (
        callee.type === `MemberExpression` &&
        callee.object.type === `Identifier` &&
        callee.property.type === `Identifier` &&
        ambientMembers.has(`${callee.object.name}.${callee.property.name}`)
      ) {
        found = { call: `${callee.object.name}.${callee.property.name}()` }
        return
      }
      if (callee.type === `Identifier`) {
        if (ambientGlobals.has(callee.name)) {
          found = { call: `${callee.name}()` }
          return
        }
        const called = functionOf(callee, sourceCode)
        if (called !== undefined) {
          const inner = ambientRead(called, sourceCode, seen)
          if (inner !== undefined) {
            found = { call: inner.call, through: inner.through ?? callee.name }
            return
          }
        }
      }
    }
    for (const key of Object.keys(node)) {
      if (key !== `parent`) visit(node[key])
    }
  }
  visit(fn.body)
  return found
}

/** Whether `callee` is `oracleProperty` imported from the oracle-property module. */
function isOracleProperty(callee, sourceCode) {
  if (callee.type !== `Identifier` || callee.name !== `oracleProperty`)
    return false
  const definition = findVariable(sourceCode.getScope(callee), callee.name)
    ?.defs[0]
  return (
    definition?.type === `ImportBinding` &&
    /(^|\/)oracle-property(\.js)?$/.test(definition.parent.source.value)
  )
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: `problem`,
    docs: {
      description: `Report an oracleProperty model, check, or reach classifier that reads a clock, ambient randomness, or a timer.`,
    },
    schema: [],
    messages: {
      impure: `\`{{part}}\` calls \`{{call}}\`{{through}}, so the same history can get a different {{result}}. The {{part}} is a function of the history and the recorded trace; the driver records anything it needs from the clock or the environment.`,
    },
  },
  create(context) {
    const { sourceCode } = context
    return {
      CallExpression(node) {
        if (!isOracleProperty(node.callee, sourceCode)) return
        const options = node.arguments[0]
        if (options?.type !== `ObjectExpression`) return
        for (const property of options.properties) {
          const part = propertyName(property)
          if (!pureParts.has(part)) continue
          const fn = functionOf(property.value, sourceCode)
          if (fn === undefined) continue
          const read = ambientRead(fn, sourceCode)
          if (read === undefined) continue
          context.report({
            node: property,
            messageId: `impure`,
            data: {
              part,
              call: read.call,
              through: read.through ? ` through \`${read.through}\`` : ``,
              result:
                part === `check`
                  ? `verdict`
                  : part === `reached`
                    ? `set of reached states`
                    : part === `predict`
                      ? `state prediction`
                      : `expectation`,
            },
          })
        }
      },
    }
  },
}
