// Removes the development-only oracle state probes from a package's
// published build (maintainer decision, 2026-11-09). The probe-form lint rule
// gives every probe one shape:
//
//   const probing = typeof process === 'undefined' ? false : process.env.NODE_ENV !== 'production'
//   probing && globalThis.__oracleProbe?.('package#name', condition)
//
// A bundler that defines `process.env.NODE_ENV` already drops them, but a
// server that loads the published files without a bundler still reads
// `process.env` once per probing call, which made a small `consolidate()` two
// to five times slower. This plugin blanks each guard declaration and probe
// statement, so the published files carry neither. It keeps every line
// break, so source maps stay correct. A probe or guard reference that
// survives fails the build instead of shipping a probe or a
// `ReferenceError`.
//
// It runs only in `vite build`. Vitest, and the gap report through Vitest,
// load the sources with their probes.
import ts from 'typescript'

const blank = (text) => text.replace(/[^\n]/g, ` `)

// The guard declarations and probe statements of one module, as source ranges.
function probeRanges(file) {
  const ranges = []
  const visit = (node) => {
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) =>
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === `probing`,
      )
    )
      ranges.push([node.getStart(file), node.end])
    else if (
      ts.isExpressionStatement(node) &&
      ts.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind ===
        ts.SyntaxKind.AmpersandAmpersandToken &&
      ts.isIdentifier(node.expression.left) &&
      node.expression.left.text === `probing`
    )
      ranges.push([node.getStart(file), node.end])
    else ts.forEachChild(node, visit)
  }
  visit(file)
  return ranges
}

// The first identifier that names the probe or its guard, if any survives.
function survivingReference(file) {
  let found
  const visit = (node) => {
    if (found) return
    if (
      ts.isIdentifier(node) &&
      (node.text === `probing` || node.text === `__oracleProbe`)
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
      if (!/\.[cm]?[jt]sx?$/.test(id) || !code.includes(`__oracleProbe`))
        return null
      const parse = (text) =>
        ts.createSourceFile(id, text, ts.ScriptTarget.Latest, true)
      let stripped = code
      for (const [start, end] of probeRanges(parse(code)).reverse())
        stripped =
          stripped.slice(0, start) +
          blank(stripped.slice(start, end)) +
          stripped.slice(end)
      const file = parse(stripped)
      const survivor = survivingReference(file)
      if (survivor) {
        const { line } = file.getLineAndCharacterOfPosition(
          survivor.getStart(file),
        )
        throw new Error(
          `${id}:${line + 1}: \`${survivor.text}\` is outside a probe statement in the probe form; the published build must not carry it`,
        )
      }
      return { code: stripped, map: null }
    },
  }
}
