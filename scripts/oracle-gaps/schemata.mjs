// Mutant switching: compile every mutant of a source file into one copy.
//
// Each mutation site becomes a call into `globalThis.__oracleGaps`, which the
// test setup defines. The call evaluates the original expression unless its
// mutant is the active one, and it records that the current test reached the
// site. One instrumented copy therefore serves every mutant run: switching
// mutants changes a number, not the source, and nothing is written to disk.
//
// Operators, in the order the sites are numbered:
// - `binary-swap`: `===`↔`!==`, `<`↔`<=`, `>`↔`>=`, `&&`↔`||`, `??`→`&&`.
// - `drop-not`: `!x` → `x`.
// - `if-true` / `if-false`: force an `if` condition.
// - `delete-call`: skip a call statement (`switch || call()`).
//
// Comparisons and `!` go through helpers that evaluate each operand once.
// `&&`, `||`, and `??` must keep short-circuiting, so both variants are
// written out and the switch picks one. Every replacement starts with an
// identifier, so it cannot join the previous line under automatic semicolon
// insertion.
const G = `globalThis.__oracleGaps`

const comparisons = new Map([
  [`===`, `!==`],
  [`!==`, `===`],
  [`<`, `<=`],
  [`<=`, `<`],
  [`>`, `>=`],
  [`>=`, `>`],
])
const logical = new Map([
  [`&&`, `||`],
  [`||`, `&&`],
  [`??`, `&&`],
])

function functionName(ts, node) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text
  const parent = node.parent
  if (
    parent &&
    (ts.isVariableDeclaration(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent)) &&
    ts.isIdentifier(parent.name)
  )
    return parent.name.text
  return undefined
}

// `offset` keeps site numbers unique across every instrumented source file,
// because one switch serves them all.
export function instrument(ts, path, text, source, offset = 0) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1
  const mutants = []
  // `at` is the node whose line the mutant reports: the operator token for a
  // swap and the condition for an `if`, as the earlier runner reported them.
  const add = (at, operator, fn, original, replacement) => {
    const local = mutants.length + 1
    const id = offset + local
    mutants.push({
      // The path below src/ keeps labels unique across files with one name.
      id: `${source.replace(/^src\//, ``)}:M${local}`,
      number: id,
      source,
      line: lineOf(at.getStart(file)),
      operator,
      function: fn,
      original,
      replacement,
    })
    return id
  }

  // Emit `node` with its children's instrumented text spliced in, then wrap
  // the node itself if it is a mutation site. Sites are numbered before their
  // children, matching the order of the earlier per-file runner.
  function emit(node, fn) {
    const name = ts.isFunctionLike(node) ? (functionName(ts, node) ?? fn) : fn
    const ids = {}
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText(file)
      const swap = comparisons.get(op) ?? logical.get(op)
      if (swap)
        ids.binary = add(node.operatorToken, `binary-swap`, name, op, swap)
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    )
      ids.not = add(node, `drop-not`, name, `!`, ``)
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(file)
      ids.ifTrue = add(node.expression, `if-true`, name, condition, `true`)
      ids.ifFalse = add(node.expression, `if-false`, name, condition, `false`)
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression))
      ids.call = add(node, `delete-call`, name, node.getText(file), `;`)

    const children = []
    ts.forEachChild(node, (child) => {
      children.push(child)
    })
    // `emitted` maps each child to its instrumented text and to where that
    // text starts in `out`, so a wrapper can replace exactly one child.
    const emitted = new Map()
    const start = node === file ? 0 : node.getStart(file)
    let out = ``
    let position = start
    for (const child of children) {
      const childStart = child.getStart(file)
      const childText = emit(child, name)
      out += text.slice(position, childStart)
      emitted.set(child, { text: childText, at: out.length })
      out += childText
      position = child.end
    }
    out += text.slice(position, node.end)

    if (ids.binary !== undefined) {
      const op = node.operatorToken.getText(file)
      const left = emitted.get(node.left).text
      const right = emitted.get(node.right).text
      if (comparisons.has(op))
        return `${G}.cmp(${ids.binary}, ${left}, ${right}, '${op}')`
      return `${G}.v(${G}.m(${ids.binary}) ? (${left} ${logical.get(op)} ${right}) : (${left} ${op} ${right}))`
    }
    if (ids.not !== undefined)
      return `${G}.not(${ids.not}, ${emitted.get(node.operand).text})`
    if (ids.ifTrue !== undefined) {
      // Replace only the condition; the rest of the `if` stays as emitted.
      const { text: condition, at } = emitted.get(node.expression)
      return `${out.slice(0, at)}${G}.cond(${ids.ifTrue}, ${ids.ifFalse}, ${condition})${out.slice(at + condition.length)}`
    }
    if (ids.call !== undefined) {
      // `skip || call()` keeps the statement a single expression statement.
      // Wrapping it in an `if` would capture a following `else` (as in
      // `if (x) call() else other()`).
      const { text: call, at } = emitted.get(node.expression)
      return `${out.slice(0, at)}${G}.m(${ids.call}) || ${call}${out.slice(at + call.length)}`
    }
    return out
  }

  const code = emit(file, `<module>`)
  return { code, mutants }
}
