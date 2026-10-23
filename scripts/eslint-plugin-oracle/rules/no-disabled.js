/**
 * An oracle enforces its laws only in the tests that run. This rule reports
 * the edits that stop a law from running while every test still passes:
 *
 * - `.only` on a test or suite, which silences every other law in the file.
 * - `.skip` or `.todo` on a test or suite that has a body, inline or passed by
 *   name. An empty body is a placeholder that disables nothing, such as the
 *   test that a replay registers when it does not select its property.
 * - `.skipIf(condition)` or `.runIf(condition)` unless the condition names a
 *   replay. Only a replay selection may switch an oracle test off.
 * - Playwright's `test.skip()` or `test.skip(true, reason)` inside a test,
 *   which skips it unconditionally. `test.skip(condition, reason)` with an
 *   environment condition, such as the browser, is allowed.
 * - A generated property limited to one unseeded run, by a literal
 *   `numRuns: 1` (or 0) or a base of 1 passed to the run helpers. One random
 *   history is not a generated property. A pinned replay passes a fixed
 *   `seed` beside its `numRuns`, or selects the one run under a condition
 *   that names the replay, so it is not reported.
 *
 * The rule has no inline exception. A known gap is pinned with `it.fails` on
 * a fixed seed, not skipped.
 *
 * The rule cannot see a run count lowered to any value above 1, a condition
 * that never selects a replay, or a skip reached through an alias such as
 * `const run = it.skip`. Reviewers still check those.
 */

const testRoots = new Set([`describe`, `fcTest`, `it`, `suite`, `test`])
const conditionalModifiers = new Set([`runIf`, `skipIf`])
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

function isBooleanLiteral(node) {
  return node?.type === `Literal` && typeof node.value === `boolean`
}

/** The condition of `it.skipIf(condition)` in a callee chain, if there is one. */
function registrationCondition(callee) {
  let node = callee
  while (node.type === `CallExpression` || node.type === `MemberExpression`) {
    if (
      node.type === `CallExpression` &&
      node.callee.type === `MemberExpression` &&
      conditionalModifiers.has(node.callee.property.name)
    ) {
      return { name: node.callee.property.name, condition: node.arguments[0] }
    }
    node = node.type === `CallExpression` ? node.callee : node.object
  }
  return undefined
}

/**
 * Whether a `.skip` or `.todo` call switches off a body that runs something.
 * A test registration passes `(name, body)`. Playwright's runtime form passes
 * `(condition, reason)`, `(condition)`, or nothing, and skips the test it
 * runs in unless the condition is false.
 */
function disablesBody(args) {
  if (args.length === 0) return true
  const [first, second] = args
  if (second === undefined || isStringLike(second)) {
    return isBooleanLiteral(first) && first.value
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

/**
 * Source text that names a replay: `replay` anywhere, or `path` or `seed` as
 * a whole name, as in `options.path`. `filePath` names no replay.
 */
const replayText = /replay|(?<![\w$])(?:path|seed)(?![\w$])/i

/** A seed that changes between runs pins no history. */
const unfixedSeedText =
  /^undefined$|Date\.now|Math\.random|performance\.now|crypto\./

/**
 * A one-run object belongs to a replay when it sits beside a fixed `seed`, or
 * when a conditional selects it for a replay, as in
 * `campaign === 'replay' ? { numRuns: 1 } : {}`. An object that an `expect`
 * matcher compares holds an observed run count, not an option.
 */
function isReplayOrObservation(object, sourceCode) {
  const seed = object.properties.find(
    (property) => propertyName(property) === `seed`,
  )
  if (seed !== undefined) {
    return !unfixedSeedText.test(sourceCode.getText(seed.value))
  }
  const { parent } = object
  if (parent.type === `ConditionalExpression` && parent.test !== object) {
    return replayText.test(sourceCode.getText(parent.test))
  }
  if (parent.type === `CallExpression` && parent.arguments.includes(object)) {
    return calleeChain(parent.callee).root === `expect`
  }
  return false
}

function propertyName(property) {
  if (property.type !== `Property` || property.computed) return undefined
  return property.key.type === `Identifier`
    ? property.key.name
    : property.key.value
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: `problem`,
    docs: {
      description: `Report oracle tests that stop running: .only, a skipped body, or one unseeded run.`,
    },
    schema: [],
    messages: {
      only: `\`.only\` runs only this test, so every other law in the file stops running. Remove it before committing.`,
      skip: `\`.{{name}}\` stops this test from enforcing its law. Remove it. To keep a known gap visible, pin a failing history with \`it.fails\` and a fixed seed.`,
      conditional: `\`.{{name}}\` can switch this test off, and its condition names no replay. Only a replay selection may switch an oracle test off. Remove the condition.`,
      singleRun: `A generated property with one unseeded run checks one random history. Pass a base run count to oracleRuns or oraclePropertyOptions; a pinned replay passes a fixed \`seed\` beside \`numRuns\`.`,
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
        isReplayOrObservation(parent.parent, sourceCode)
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
          context.report({
            node: node.callee,
            messageId: `only`,
          })
          return
        }
        const conditional = registrationCondition(node.callee)
        if (conditional !== undefined) {
          if (
            conditional.condition === undefined ||
            !replayText.test(sourceCode.getText(conditional.condition))
          ) {
            context.report({
              node,
              messageId: `conditional`,
              data: { name: conditional.name },
            })
          }
          return
        }
        const disabled = names.find(
          (name) => name === `skip` || name === `todo`,
        )
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
