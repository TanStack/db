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
 * - `.skipIf(condition)` or `.runIf(condition)`, unless the call is
 *   `.skipIf(oracleReplayRequested())` or `.skipIf(oracleReplaySkips(...))`.
 *   A replay may stand a test aside, and nothing else may switch an oracle
 *   test off. The shared helpers in oracle-config are false in an ordinary
 *   run, so no condition built from them can turn a test off there.
 * - A test modifier passed around as a value, as in
 *   `const run = replaying ? it.skip : it`. The rule cannot see what such an
 *   alias switches off. `oracleReplayTest(test, property)` selects a replay.
 * - A test registered under a condition, or after an early `return`, unless
 *   the condition is a shared replay helper and the test registers when the
 *   helper is false, as in `if (!oracleReplayRequested())`. Each helper is
 *   false in an ordinary run, so such a test runs there. An early `throw`
 *   fails the run loudly, and `continue` filters a loop's data, so neither
 *   guards a registration. A registration made through `oracleReplayTest`
 *   or `oracleCalibrationTest` is checked as a registration of its test.
 * - Playwright's runtime `test.skip()` or `test.fixme()` inside a test,
 *   unless its condition is `browserName !== '<browser>'`: a control that
 *   only one browser supports.
 * - A generated property limited to one run that pins no history: a literal
 *   `numRuns` of 1 or 0, or a base of 1 passed to the run helpers. One random
 *   history is not a generated property. A witness pins its history with a
 *   recorded `path` (a literal, or a failure's `counterexamplePath`) or with
 *   a seed that is a number literal or a constant bound to one. A replay from
 *   configuration takes its options from `oraclePropertyOptions`, which
 *   returns one run for a path replay.
 * - A literal run count above 1 that pins no history. It does not scale with
 *   `TANSTACK_DB_ORACLE_RUNS_MULTIPLIER`, so `oracleRuns` must wrap it.
 *
 * The rule has no inline exception. A known gap is pinned with `it.fails` on
 * a fixed seed, not skipped.
 *
 * The rule cannot see a run count lowered to any value above 1, a run count
 * or seed held in a variable that is not a constant bound to a number, a test function renamed before its modifier is
 * read (`const t = it; t.skip(...)`), a call to a local helper that registers
 * tests under a condition, or a condition inside a loop's iterable, as in
 * `cases.filter(() => !process.env.CI)`. Reviewers still check those.
 */

const testRoots = new Set([`describe`, `fcTest`, `it`, `suite`, `test`])
const disablingModifiers = new Set([`fixme`, `skip`, `todo`])
const conditionalModifiers = new Set([`runIf`, `skipIf`])
const aliasModifiers = new Set([
  ...disablingModifiers,
  ...conditionalModifiers,
  `only`,
])
const replayConditions = new Set([`oracleReplayRequested`, `oracleReplaySkips`])
// The members that keep a call a test registration. Playwright's `test` also
// has calls such as `test.info()` and `test.step()` that register nothing.
const registrationMembers = new Set([
  ...aliasModifiers,
  `concurrent`,
  `describe`,
  `each`,
  `fails`,
  `parallel`,
  `prop`,
  `sequential`,
  `serial`,
])
// oracle-config implements replay selection, so its options may carry a
// replay path from configuration.
const replaySelectionModule =
  /(^|[/\\])packages[/\\]db[/\\]tests[/\\]oracle-config\.ts$/
// The shared helpers that return a test registration or its `skip` form.
const selectionHelpers = new Set([`oracleCalibrationTest`, `oracleReplayTest`])
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

/**
 * A call to one of the shared oracle-config helpers in `names`. The binding
 * must be the import, not a local function with the same name.
 */
function isSharedHelperCall(node, names, sourceCode) {
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
    /(^|\/)oracle-config(\.js)?$/.test(definition.parent.source.value)
  )
}

/** Exactly `.skipIf(<shared replay condition>)`, not negated. */
function isReplaySelection({ name, args }, sourceCode) {
  return (
    name === `skipIf` &&
    args.length === 1 &&
    isSharedHelperCall(args[0], replayConditions, sourceCode)
  )
}

/**
 * Whether a statement always returns from its function. A `throw` fails the
 * run loudly, and `continue` or `break` skips one item of a loop's data, as
 * `.filter` would, so neither guards a registration.
 */
function returns(statement) {
  if (statement === null || statement === undefined) return false
  if (statement.type === `ReturnStatement`) return true
  if (statement.type === `BlockStatement`) {
    return returns(statement.body.at(-1))
  }
  if (statement.type === `IfStatement`) {
    return returns(statement.consequent) && returns(statement.alternate)
  }
  return false
}

/**
 * The conditions that decide whether `node` runs, each with the value that
 * the condition must have for `node` to run: every enclosing `if`,
 * conditional, or logical branch, and every earlier `if` in an enclosing
 * block that returns. `registersWhen` is undefined when no single value
 * decides it, as for `??`.
 */
function guardingConditions(node) {
  const conditions = []
  let child = node
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      (parent.type === `IfStatement` ||
        parent.type === `ConditionalExpression`) &&
      child !== parent.test
    ) {
      conditions.push({
        test: parent.test,
        registersWhen: child === parent.consequent,
      })
    } else if (parent.type === `LogicalExpression` && child === parent.right) {
      conditions.push({
        test: parent.left,
        registersWhen:
          parent.operator === `&&`
            ? true
            : parent.operator === `||`
              ? false
              : undefined,
      })
    } else if (
      parent.type === `BlockStatement` ||
      parent.type === `Program` ||
      parent.type === `SwitchCase`
    ) {
      const body =
        parent.type === `SwitchCase` ? parent.consequent : parent.body
      for (const statement of body.slice(0, body.indexOf(child))) {
        if (statement.type === `IfStatement` && returns(statement.consequent)) {
          conditions.push({ test: statement.test, registersWhen: false })
        }
      }
    }
    child = parent
  }
  return conditions
}

/**
 * Whether a guard keeps a registration in every ordinary run. Each shared
 * replay helper is false in an ordinary run, so the registration must run
 * when the helper is false: under `!helper()`, in the `else` branch of
 * `helper()`, or after `if (helper()) return`. A registration that runs only
 * when a helper is true would run only during a replay.
 */
function keepsOrdinaryRun({ test, registersWhen }, sourceCode) {
  if (registersWhen === undefined) return false
  const negated = test.type === `UnaryExpression` && test.operator === `!`
  const helper = negated ? test.argument : test
  if (!isSharedHelperCall(helper, replayConditions, sourceCode)) return false
  return negated ? registersWhen : !registersWhen
}

/** A `path` that a witness recorded: a literal, or a failure's path. */
function isRecordedPath(node) {
  if (node.type === `TemplateLiteral`) return node.expressions.length === 0
  if (node.type === `Literal`) return typeof node.value === `string`
  return (
    node.type === `MemberExpression` &&
    !node.computed &&
    node.property.name === `counterexamplePath`
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
/** The number literal that `node` is, or that a constant `node` names. */
function constantNumber(node, sourceCode) {
  if (isNumberLiteral(node)) return node
  if (node?.type !== `Identifier`) return undefined
  const definition = findVariable(sourceCode.getScope(node), node.name)?.defs[0]
  return definition?.type === `Variable` &&
    definition.parent.kind === `const` &&
    isNumberLiteral(definition.node.init)
    ? definition.node.init
    : undefined
}

/** A number literal, or a constant bound to one. */
function isFixedSeed(node, sourceCode) {
  return constantNumber(node, sourceCode) !== undefined
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
  if (path !== undefined && isRecordedPath(path.value)) return true
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
      conditional: `\`.{{name}}\` can switch this test off in ordinary runs. Only \`.skipIf(oracleReplayRequested())\` or \`.skipIf(oracleReplaySkips(property))\` may switch an oracle test off, so that a replay can stand it aside. Remove the condition.`,
      alias: `\`.{{name}}\` is passed around as a value, so the rule cannot see what it switches off. Call it directly, or select a replay with \`oracleReplayTest(test, property)\` from oracle-config.`,
      guarded: `This test registers only under a condition, so it can stop running in ordinary runs. Register it unconditionally. A replay selection uses \`oracleReplayRequested()\` or \`oracleReplaySkips(property)\` from oracle-config, or \`oracleReplayTest(test, property)\`.`,
      singleRun: `A generated property with one run that pins no history checks one random history. Pass a base run count to oracleRuns or oraclePropertyOptions, which also selects a replay. A witness passes a recorded \`path\` or a seed that is a number literal or a constant.`,
      literalRuns: `A literal run count does not scale with TANSTACK_DB_ORACLE_RUNS_MULTIPLIER. Wrap it in oracleRuns, or pass it to oraclePropertyOptions.`,
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
            isSingleRunLiteral(constantNumber(node.arguments[0], sourceCode)) &&
            !isPinnedRunCount(node)
          ) {
            context.report({ node: node.arguments[0], messageId: `singleRun` })
          }
          return
        }
        if (
          !testRoots.has(root) ||
          !names.every((member) => registrationMembers.has(member))
        ) {
          return
        }
        const unguarded = guardingConditions(node).every((condition) =>
          keepsOrdinaryRun(condition, sourceCode),
        )
        if (!unguarded) {
          context.report({ node, messageId: `guarded` })
          return
        }
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
      MemberExpression(node) {
        // Report a chain such as `fcTest.skip` or `it.skip.prop` once, at its
        // outermost member, when nothing calls it.
        if (
          node.parent.type === `MemberExpression` &&
          node.parent.object === node
        ) {
          return
        }
        if (
          node.parent.type === `CallExpression` &&
          node.parent.callee === node
        ) {
          return
        }
        const { root, names } = calleeChain(node)
        const name = names.find((member) => aliasModifiers.has(member))
        if (testRoots.has(root) && name !== undefined) {
          context.report({ node, messageId: `alias`, data: { name } })
        }
      },
      Property(node) {
        if (
          replaySelectionModule.test(context.filename) ||
          propertyName(node) !== `numRuns`
        ) {
          return
        }
        // A constant bound to a number literal counts as that literal.
        const count = constantNumber(node.value, sourceCode)
        if (count === undefined || isPinnedRunCount(node.value)) return
        context.report({
          node,
          messageId: isSingleRunLiteral(count) ? `singleRun` : `literalRuns`,
        })
      },
    }
  },
}
