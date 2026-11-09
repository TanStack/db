// Removes the development-only oracle state probes from a package's
// published build (maintainer decision, 2026-11-09). The probe-form lint rule
// gives every probe one shape:
//
//   const probing = typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production'
//   probing && globalThis.__oracleProbe?.(name, condition)
//
// A bundler that defines `process.env.NODE_ENV` already drops them, but a
// server that loads the published files without a bundler still reads
// `process.env` once per probing call, which made a small `consolidate()` two
// to five times slower. This plugin blanks each guard declaration and probe
// statement, so the published files carry neither. It keeps every line
// break, so source maps stay correct.
//
// It matches the rule's form, so it strips what the rule admits and nothing
// else. Parentheses never matter, as in the rule. A guard declaration is
// blanked when its initializer is the guard form; a declaration with sibling
// declarators keeps them. A statement that is blanked becomes `;`, so it still
// stands as the body of an unbraced `if`, loop, or label. A `probing` that the
// stripper cannot remove with its guard, such as a value read, a binding, a
// `for` head guard, or a non-guard declaration, and any `__oracleProbe` that
// is left, fails the build instead of shipping a probe or a `ReferenceError`.
// A property name, a label, or a type position named `probing` is not a
// reference, and it stays. The stripper refuses every `__oracleProbe` left
// because the rule rejects each mention outside a probe.
//
// It runs only in `vite build`. Vitest, and the gap report through Vitest,
// load the sources with their probes. The law and its oracle are in
// scripts/strip-oracle-probes-oracle.property.test.js.
import ts from 'typescript'

const GUARD = `probing`
const PROBE = `__oracleProbe`

const blank = (text) => text.replace(/[^\n]/g, ` `)
// One empty statement in the blanked text's place, with its line breaks.
const emptyStatement = (text) => `;` + blank(text.slice(1))

// The expression with its parentheses removed. The rule reads the expression
// that the parentheses enclose, so a parenthesized form is the same form.
function unparen(node) {
  let inner = node
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression
  return inner
}

// The text of a plain string literal, or of a template literal without
// substitutions, which the repository's sources write with backticks.
function staticText(node) {
  const inner = unparen(node)
  if (ts.isStringLiteral(inner) || ts.isNoSubstitutionTemplateLiteral(inner))
    return inner.text
  return undefined
}

function isIdentifier(node, text) {
  const inner = unparen(node)
  return ts.isIdentifier(inner) && inner.text === text
}

// `process.env.NODE_ENV`, the rule's member chain, with no optional link.
function isProcessEnvNodeEnv(node) {
  const nodeEnv = unparen(node)
  if (
    !ts.isPropertyAccessExpression(nodeEnv) ||
    nodeEnv.questionDotToken ||
    nodeEnv.name.text !== `NODE_ENV`
  )
    return false
  const env = unparen(nodeEnv.expression)
  return (
    ts.isPropertyAccessExpression(env) &&
    !env.questionDotToken &&
    env.name.text === `env` &&
    isIdentifier(env.expression, `process`)
  )
}

// `process.env.NODE_ENV !== 'production'`, the guard's second operand.
function isProductionGuard(node) {
  const comparison = unparen(node)
  return (
    ts.isBinaryExpression(comparison) &&
    comparison.operatorToken.kind ===
      ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    isProcessEnvNodeEnv(comparison.left) &&
    staticText(comparison.right) === `production`
  )
}

// `typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production'`
function isGuardInit(node) {
  if (node === undefined) return false
  const conditional = unparen(node)
  if (!ts.isConditionalExpression(conditional)) return false
  const test = unparen(conditional.condition)
  return (
    ts.isBinaryExpression(test) &&
    test.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
    ts.isTypeOfExpression(unparen(test.left)) &&
    isIdentifier(unparen(test.left).expression, `process`) &&
    staticText(test.right) === `undefined` &&
    unparen(conditional.whenTrue).kind === ts.SyntaxKind.FalseKeyword &&
    isProductionGuard(conditional.whenFalse)
  )
}

// A `const probing` declarator with the guard's initializer.
function isGuardDeclarator(declaration) {
  return (
    ts.isIdentifier(declaration.name) &&
    declaration.name.text === GUARD &&
    isGuardInit(declaration.initializer)
  )
}

// One expression statement `probing && <expression that names the probe>`.
function isProbeStatement(expression) {
  const probe = unparen(expression)
  return (
    ts.isBinaryExpression(probe) &&
    probe.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
    isIdentifier(probe.left, GUARD) &&
    mentions(probe.right, PROBE)
  )
}

function mentions(node, name) {
  let found = false
  const visit = (child) => {
    if (found) return
    if (ts.isIdentifier(child) && child.text === name) found = true
    else ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

// Whether an identifier named `probing` is a runtime reference or a binding.
// The names that are not one: a property name, a label, a JSX attribute name,
// a binding element's property key, and a type-level position.
function isRuntimeReference(identifier) {
  const parent = identifier.parent
  if (
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isGetAccessorDeclaration(parent) ||
      ts.isSetAccessorDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isJsxAttribute(parent)) &&
    parent.name === identifier
  )
    return false
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === identifier
  )
    return false
  if (ts.isBindingElement(parent) && parent.propertyName === identifier)
    return false
  if (
    (ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeParameterDeclaration(parent)) &&
    parent.name === identifier
  )
    return false
  for (let ancestor = parent; ancestor; ancestor = ancestor.parent) {
    if (ts.isTypeNode(ancestor) && !ts.isExpressionWithTypeArguments(ancestor))
      return false
  }
  return true
}

// The source ranges to blank, each with how to blank it. A statement becomes
// an empty statement; a sibling-declarator guard loses only its own text and
// the comma beside it.
function stripRanges(file) {
  const ranges = []
  const visit = (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.flags & ts.NodeFlags.Const
    ) {
      const declarations = node.declarationList.declarations
      const index = declarations.findIndex(isGuardDeclarator)
      if (index === -1) return ts.forEachChild(node, visit)
      if (declarations.length === 1) {
        ranges.push([node.getStart(file), node.end, emptyStatement])
        return
      }
      // The comma goes with the guard: the one after it, or the one before it
      // when the guard is last.
      const [start, end] =
        index === 0
          ? [declarations[0].getStart(file), declarations[1].getStart(file)]
          : [declarations[index - 1].end, declarations[index].end]
      ranges.push([start, end, blank])
      return ts.forEachChild(node, visit)
    }
    if (ts.isExpressionStatement(node) && isProbeStatement(node.expression)) {
      ranges.push([node.getStart(file), node.end, emptyStatement])
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return ranges
}

// The first identifier that names the probe, or a guard reference that the
// stripper cannot remove, if any survives.
function survivingReference(file) {
  let found
  const visit = (node) => {
    if (found) return
    if (
      ts.isIdentifier(node) &&
      (node.text === PROBE || (node.text === GUARD && isRuntimeReference(node)))
    )
      found = node
    else ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

export function stripOracleProbes() {
  return {
    name: `strip-oracle-probes`,
    apply: `build`,
    enforce: `pre`,
    transform(code, id) {
      if (
        !/\.[cm]?[jt]sx?$/.test(id) ||
        !(code.includes(PROBE) || code.includes(GUARD))
      )
        return null
      const parse = (text) =>
        ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true)
      let stripped = code
      for (const [start, end, blankText] of stripRanges(parse(code)).sort(
        ([a], [b]) => b - a,
      ))
        stripped =
          stripped.slice(0, start) +
          blankText(stripped.slice(start, end)) +
          stripped.slice(end)
      const file = parse(stripped)
      const survivor = survivingReference(file)
      if (survivor) {
        const { line } = file.getLineAndCharacterOfPosition(
          survivor.getStart(file),
        )
        throw new Error(
          `${id}:${line + 1}: \`${survivor.text}\` is a reference that stripping cannot remove (it is outside a probe statement, or it reads or binds the guard); the published build must not carry it`,
        )
      }
      return { code: stripped, map: null }
    },
  }
}
