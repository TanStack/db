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
// - `bool-flip`: a boolean literal `true` ↔ `false` (not a literal type).
// - `value-undefined`: a call whose value is used → `undefined`, and the
//   call does not run. Not a call statement (`delete-call`), and not a
//   callee or the object of a property or element access, where
//   `undefined` would only throw.
// - `if-true` / `if-false`: force an `if` condition.
// - `loop-false`: force the condition of a `for`, `while`, or `do` loop to
//   `false` (a `for` with no condition, `for...of`, and `for...in` have none).
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

// A mutant's anchor is the innermost statement that holds its site, as its
// tokens joined by single spaces, so formatting does not move it.
function anchorOf(ts, file, node) {
  let statement = node
  while (
    statement.parent &&
    !(
      statement.kind >= ts.SyntaxKind.FirstStatement &&
      statement.kind <= ts.SyntaxKind.LastStatement
    )
  )
    statement = statement.parent
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    statement.getText(file),
  )
  const tokens = []
  for (
    let token = scanner.scan();
    token !== ts.SyntaxKind.EndOfFileToken;
    token = scanner.scan()
  ) {
    // The scanner splits `>=` and `>>`; the parser rejoins them this way.
    if (token === ts.SyntaxKind.GreaterThanToken) scanner.reScanGreaterToken()
    tokens.push(scanner.getTokenText())
  }
  return tokens.join(` `)
}

// `offset` keeps site numbers unique across every instrumented source file,
// because one switch serves them all. A mutant names no function: the runner
// names it by the function declaration whose lines hold it (owners.mjs), so
// keys and ownership read one source.
export function instrument(ts, path, text, source, offset = 0) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1
  const mutants = []
  // `at` is the node whose line the mutant reports: the operator token for a
  // swap and the condition for an `if`, as the earlier runner reported them.
  const add = (at, operator, original, replacement) => {
    const probeGuard = guarded
    const local = mutants.length + 1
    const id = offset + local
    mutants.push({
      // The path below src/ keeps labels unique across files with one name.
      id: `${source.replace(/^src\//, ``)}:M${local}`,
      number: id,
      source,
      line: lineOf(at.getStart(file)),
      operator,
      original,
      replacement,
      anchor: anchorOf(ts, file, at),
      ...(probeGuard ? { probeGuard: true } : {}),
    })
    return id
  }

  // Probe-only code is reported apart from the gaps: a probe compiles to
  // nothing in production builds (the bundle check owns it), and a deleted or
  // misplaced probe is reach agreement's to catch. Probe-only code is, by the
  // syntax tree:
  // - a probe statement in the decided form,
  //   `process.env.NODE_ENV !== 'production' && globalThis.__oracleProbe?.(name, condition)`,
  //   whose receiver may be cast with `as`, including its condition;
  // - a call statement to a probe helper, a function declaration whose every
  //   statement is probe-only (found by repeating until no helper is added);
  // - an `if` with no `else` whose branch is probe-only, or a block whose
  //   statements all are.
  // Code beside a probe, and any other probe shape, is production code.
  const helpers = new Set()
  const unwrap = (node) => {
    let inner = node
    while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner))
      inner = inner.expression
    return inner
  }
  const isGuard = (node) =>
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken &&
    node.left.getText(file) === `process.env.NODE_ENV` &&
    ts.isStringLiteralLike(node.right) &&
    node.right.text === `production`
  const isHook = (node) => {
    const call = unwrap(node)
    if (!ts.isCallExpression(call) || call.arguments.length !== 2) return false
    const callee = call.expression
    return (
      ts.isPropertyAccessExpression(callee) &&
      callee.name.text === `__oracleProbe` &&
      ts.isIdentifier(unwrap(callee.expression)) &&
      unwrap(callee.expression).text === `globalThis`
    )
  }
  const isProbeStatement = (node) =>
    ts.isExpressionStatement(node) &&
    ts.isBinaryExpression(node.expression) &&
    node.expression.operatorToken.kind ===
      ts.SyntaxKind.AmpersandAmpersandToken &&
    isGuard(unwrap(node.expression.left)) &&
    isHook(node.expression.right)
  const callsHelper = (node) => {
    const target =
      ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
        ? node.expression.expression
        : undefined
    return (
      target !== undefined &&
      ts.isIdentifier(target) &&
      helpers.has(target.text)
    )
  }
  const isProbeOnly = (node) =>
    isProbeStatement(node) ||
    callsHelper(node) ||
    (ts.isIfStatement(node) &&
      node.elseStatement === undefined &&
      isProbeOnly(node.thenStatement)) ||
    (ts.isBlock(node) &&
      node.statements.length > 0 &&
      node.statements.every(isProbeOnly))
  const declarations = []
  const collect = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body)
      declarations.push(node)
    ts.forEachChild(node, collect)
  }
  collect(file)
  for (let grew = true; grew; ) {
    grew = false
    for (const node of declarations) {
      if (helpers.has(node.name.text)) continue
      if (
        node.body.statements.length > 0 &&
        node.body.statements.every(isProbeOnly)
      ) {
        helpers.add(node.name.text)
        grew = true
      }
    }
  }
  const isProbeGuard = (node) =>
    isProbeOnly(node) ||
    (ts.isFunctionDeclaration(node) &&
      node.name !== undefined &&
      helpers.has(node.name.text))
  let guarded = false

  // Emit `node` with its children's instrumented text spliced in, then wrap
  // the node itself if it is a mutation site. Sites are numbered before their
  // children, matching the order of the earlier per-file runner.
  function emit(node) {
    const outer = guarded
    guarded ||= isProbeGuard(node)
    try {
      return emitNode(node)
    } finally {
      guarded = outer
    }
  }
  function emitNode(node) {
    const ids = {}
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.getText(file)
      const swap = comparisons.get(op) ?? logical.get(op)
      if (swap)
        ids.binary = add(node.operatorToken, `binary-swap`, op, swap)
    }
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    )
      ids.not = add(node, `drop-not`, `!`, ``)
    if (
      (node.kind === ts.SyntaxKind.TrueKeyword ||
        node.kind === ts.SyntaxKind.FalseKeyword) &&
      !ts.isLiteralTypeNode(node.parent)
    ) {
      const literal = node.getText(file)
      ids.bool = add(node, `bool-flip`, literal, literal === `true` ? `false` : `true`)
    }
    if (
      ts.isCallExpression(node) &&
      !ts.isExpressionStatement(node.parent) &&
      !(
        (ts.isCallExpression(node.parent) ||
          ts.isPropertyAccessExpression(node.parent) ||
          ts.isElementAccessExpression(node.parent)) &&
        node.parent.expression === node
      ) &&
      node.expression.kind !== ts.SyntaxKind.SuperKeyword &&
      node.expression.kind !== ts.SyntaxKind.ImportKeyword
    )
      ids.value = add(node, `value-undefined`, node.getText(file), `undefined`)
    // The loop's condition: a `for`'s may be absent.
    const loopCondition =
      ts.isForStatement(node)
        ? node.condition
        : ts.isWhileStatement(node) || ts.isDoStatement(node)
          ? node.expression
          : undefined
    if (loopCondition)
      ids.loop = add(loopCondition, `loop-false`, loopCondition.getText(file), `false`)
    if (ts.isIfStatement(node)) {
      const condition = node.expression.getText(file)
      ids.ifTrue = add(node.expression, `if-true`, condition, `true`)
      ids.ifFalse = add(node.expression, `if-false`, condition, `false`)
    }
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression))
      ids.call = add(node, `delete-call`, node.getText(file), `;`)

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
      const childText = emit(child)
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
    if (ids.bool !== undefined) return `${G}.b(${ids.bool}, ${node.getText(file)})`
    if (ids.value !== undefined) return `${G}.v(${G}.m(${ids.value}) ? void 0 : ${out})`
    if (ids.loop !== undefined) {
      const { text: condition, at } = emitted.get(loopCondition)
      return `${out.slice(0, at)}${G}.v(${G}.m(${ids.loop}) ? false : ${condition})${out.slice(at + condition.length)}`
    }
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

  const code = emit(file)
  return { code, mutants }
}
