/**
 * An oracle enforces its laws only in the tests that run. This rule reports
 * the edits that stop a law from running while every test still passes:
 *
 * - `.only` on a test or suite, which silences every other law in the file.
 * - `.skip`, `.todo`, or Playwright's `.fixme` on a test or suite that has a
 *   body, inline or passed by name. An empty body is a placeholder that
 *   disables nothing, such as the test that a replay registers when it does
 *   not select its property.
 * - A test that skips itself through its context, as in `ctx.skip()`.
 * - `.skipIf(condition)` or `.runIf(condition)`, unless the call is exactly
 *   `.skipIf(oracleReplayRequested())`. A replay may stand a test aside, and
 *   nothing else may switch an oracle test off. The shared helper fixes the
 *   polarity, so a condition cannot turn the test off in ordinary runs.
 * - Playwright's runtime `test.skip()` or `test.fixme()` inside a test,
 *   unless its condition is `browserName !== '<browser>'`: a control that
 *   only one browser supports.
 * - A generated property limited to one run that pins no history: a literal
 *   `numRuns` of 1 or 0, or a base of 1 passed to the run helpers. One random
 *   history is not a generated property. A replay pins its history with a
 *   `path` beside `numRuns`, and a witness with a seed that is a number
 *   literal or a constant bound to one. `oraclePropertyOptions` returns one
 *   run for a path replay, so a campaign needs no one-run option of its own.
 *
 * The rule has no inline exception. A known gap is pinned with `it.fails` on
 * a fixed seed, not skipped.
 *
 * The rule cannot see a run count lowered to any value above 1, a `path` or
 * seed read from configuration that is absent in ordinary runs, a skip
 * reached through an alias such as `const run = it.skip`, or a registration
 * inside an `if`. Reviewers still check those.
 */

const testRoots = new Set([`describe`, `fcTest`, `it`, `suite`, `test`])
const disablingModifiers = new Set([`fixme`, `skip`, `todo`])
const conditionalModifiers = new Set([`runIf`, `skipIf`])
const replaySelection = `oracleReplayRequested`
const runHelpers = new Set([
  `oraclePropertyOptions`,
  `oracleRandomParameters`,
  `oracleRuns`,
])

/** The root identifier and member names of a callee such as `it.skip.prop(...)`. */
function calleeChain(callee) {
  const names = []
  let node = callee
  for (;;) {
    if (node.type === `MemberExpression`) {
      if (node.property.type === `Identifier`) names.unshift(node.property.name)
      node = node.object
    } else if (node.type === `CallExpression`) {
      node = node.callee
    } else {
      break
    }
  }
  return { root: node.type === `Identifier` ? node.name : undefined, names }
}

function isFunction(node) {
  return (
    node?.type === `ArrowFunctionExpression` ||
    node?.type === `FunctionExpression`
  )
}

/** A test body that runs something: a named function or a non-empty one. */
function hasBody(body) {
  if (!isFunction(body)) return true
  return body.body.type !== `BlockStatement` || body.body.body.length > 0
}

function isStringLike(node) {
  return (
    node.type === `TemplateLiteral` ||
    (node.type === `Literal` && typeof node.value === `string`)
  )
}

/** The `skipIf` or `runIf` call in a callee chain, if there is one. */
function registrationCondition(callee) {
  let node = callee
  while (node.type === `CallExpression` || node.type === `MemberExpression`) {
    if (
      node.type === `CallExpression` &&
      node.callee.type === `MemberExpression` &&
      conditionalModifiers.has(node.callee.property.name)
    ) {
      return { name: node.callee.property.name, args: node.arguments }
    }
    node = node.type === `CallExpression` ? node.callee : node.object
  }
  return undefined
}

/** Exactly `.skipIf(oracleReplayRequested())`. */
function isReplaySelection({ name, args }, sourceCode) {
  const [condition] = args
  if (
    name !== `skipIf` ||
    args.length !== 1 ||
    condition.type !== `CallExpression` ||
    condition.callee.type !== `Identifier` ||
    condition.callee.name !== replaySelection ||
    condition.arguments.length > 0
  ) {
    return false
  }
  // The helper must be the shared one, not a local function of that name.
  const definition = findVariable(
    sourceCode.getScope(condition),
    replaySelection,
  )?.defs[0]
  return (
    definition?.type === `ImportBinding` &&
    /(^|\/)oracle-config(\.js)?$/.test(definition.parent.source.value)
  )
}

/** Playwright's `browserName !== '<browser>'`. */
function isBrowserCondition(node) {
  return (
    node.type === `BinaryExpression` &&
    node.operator === `!==` &&
    node.left.type === `Identifier` &&
    node.left.name === `browserName` &&
    isStringLike(node.right)
  )
}

/**
 * Whether a `.skip`, `.todo`, or `.fixme` call switches off a body that runs
 * something. A test registration passes `(name, body)`, and a todo passes
 * only its name. Playwright's runtime form passes `(condition, reason)`,
 * `(condition)`, or nothing, and skips the test that it runs in.
 */
function disablesBody(args) {
  const [first, second] = args
  if (first === undefined) return true
  if (second === undefined && isStringLike(first)) return false
  if (second === undefined || isStringLike(second)) {
    return !isBrowserCondition(first)
  }
  return hasBody(second)
}

/** A numeric literal at most 1: the run counts that check one history or none. */
function isSingleRunLiteral(node) {
  return (
    node?.type === `Literal` &&
    typeof node.value === `number` &&
    node.value <= 1
  )
}

function isNumberLiteral(node) {
  if (node?.type === `UnaryExpression` && node.operator === `-`) {
    return isNumberLiteral(node.argument)
  }
  return node?.type === `Literal` && typeof node.value === `number`
}

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.set.get(name)
    if (variable !== undefined) return variable
  }
  return undefined
}

/** A number literal, or a constant bound to one. */
function isFixedSeed(node, sourceCode) {
  if (isNumberLiteral(node)) return true
  if (node.type !== `Identifier`) return false
  const definition = findVariable(sourceCode.getScope(node), node.name)?.defs[0]
  return (
    definition?.type === `Variable` &&
    definition.parent.kind === `const` &&
    isNumberLiteral(definition.node.init)
  )
}

function propertyName(property) {
  if (property.type !== `Property` || property.computed) return undefined
  return property.key.type === `Identifier`
    ? property.key.name
    : property.key.value
}

/**
 * A one-run object pins its history when it replays a `path` or passes a
 * fixed seed. An object that an `expect` matcher compares holds an observed
 * run count, and `fc.sample` draws examples without running a property.
 */
function isPinnedOrObservation(object, sourceCode) {
  const option = (name) =>
    object.properties.find((property) => propertyName(property) === name)
  const path = option(`path`)
  if (path !== undefined && sourceCode.getText(path.value) !== `undefined`) {
    return true
  }
  const seed = option(`seed`)
  if (seed !== undefined && isFixedSeed(seed.value, sourceCode)) return true
  const { parent } = object
  if (parent.type !== `CallExpression` || !parent.arguments.includes(object)) {
    return false
  }
  const { root, names } = calleeChain(parent.callee)
  return root === `expect` || (root === `fc` && names[0] === `sample`)
}

/**
 * Whether a call skips the test that it runs in through the test context,
 * as in `it('law', (ctx) => { ctx.skip() })`.
 */
function isContextSkip(node, sourceCode) {
  const { callee } = node
  if (
    callee.type !== `MemberExpression` ||
    callee.property.type !== `Identifier` ||
    callee.property.name !== `skip` ||
    callee.object.type !== `Identifier`
  ) {
    return false
  }
  // Resolve the binding, so a context captured by a nested callback counts
  // and an unrelated variable of the same name does not.
  const definition = findVariable(sourceCode.getScope(node), callee.object.name)
    ?.defs[0]
  if (definition?.type !== `Parameter`) return false
  const fn = definition.node
  if (fn.params[0] !== definition.name) return false
  const registration = fn.parent
  return (
    registration.type === `CallExpression` &&
    registration.arguments.includes(fn) &&
    testRoots.has(calleeChain(registration.callee).root)
  )
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: `problem`,
    docs: {
      description: `Report oracle tests that stop running: .only, a skipped body, a switch-off condition, or one unpinned run.`,
    },
    schema: [],
    messages: {
      only: `\`.only\` runs only this test, so every other law in the file stops running. Remove it before committing.`,
      skip: `\`.{{name}}\` stops this test from enforcing its law. Remove it. To keep a known gap visible, pin a failing history with \`it.fails\` and a fixed seed.`,
      conditional: `\`.{{name}}\` can switch this test off in ordinary runs. Only \`.skipIf(oracleReplayRequested())\` may switch an oracle test off, so that a replay can stand it aside. Remove the condition.`,
      singleRun: `A generated property with one run that pins no history checks one random history. Pass a base run count to oracleRuns or oraclePropertyOptions. A replay passes \`path\`, and a witness passes a seed that is a number literal or a constant.`,
    },
  },
  create(context) {
    const { sourceCode } = context

    /** Whether `node` is the value of a `numRuns` option that a replay pins. */
    function isPinnedRunCount(node) {
      const { parent } = node
      return (
        parent.type === `Property` &&
        propertyName(parent) === `numRuns` &&
        parent.parent.type === `ObjectExpression` &&
        isPinnedOrObservation(parent.parent, sourceCode)
      )
    }

    return {
      CallExpression(node) {
        // A curried call such as `fcTest.prop(arbs)(name, fn)` is reported
        // once, at the outermost call, which holds the test body.
        if (
          node.parent.type === `CallExpression` &&
          node.parent.callee === node
        ) {
          return
        }
        if (isContextSkip(node, sourceCode)) {
          context.report({ node, messageId: `skip`, data: { name: `skip` } })
          return
        }
        const { root, names } = calleeChain(node.callee)
        if (runHelpers.has(root) && names.length === 0) {
          if (
            isSingleRunLiteral(node.arguments[0]) &&
            !isPinnedRunCount(node)
          ) {
            context.report({ node: node.arguments[0], messageId: `singleRun` })
          }
          return
        }
        if (!testRoots.has(root)) return
        if (names.includes(`only`)) {
          context.report({ node: node.callee, messageId: `only` })
          return
        }
        const conditional = registrationCondition(node.callee)
        if (conditional !== undefined) {
          if (!isReplaySelection(conditional, sourceCode)) {
            context.report({
              node,
              messageId: `conditional`,
              data: { name: conditional.name },
            })
          }
          return
        }
        const disabled = names.find((name) => disablingModifiers.has(name))
        if (disabled !== undefined && disablesBody(node.arguments)) {
          context.report({ node, messageId: `skip`, data: { name: disabled } })
        }
      },
      Property(node) {
        if (
          propertyName(node) === `numRuns` &&
          isSingleRunLiteral(node.value) &&
          !isPinnedRunCount(node.value)
        ) {
          context.report({ node, messageId: `singleRun` })
        }
      },
    }
  },
}
