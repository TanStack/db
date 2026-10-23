// Syntax helpers for check-doc-snippets.mjs, with the cases that pin their
// judgments. `selfTest()` runs on every check, so a change that makes a helper
// miss a defect, or report a correct example, fails before any doc is read.
import ts from 'typescript'

const parse = (code, jsx) =>
  ts.createSourceFile(
    jsx ? `example.tsx` : `example.ts`,
    code,
    ts.ScriptTarget.Latest,
    true,
    jsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

const isJsx = (node) =>
  ts.isJsxElement(node) ||
  ts.isJsxSelfClosingElement(node) ||
  ts.isJsxFragment(node)

/**
 * The tokens of an example, without what formatting changes, so a reformatted
 * example keeps its baseline entry: spacing, comments, commas, semicolons,
 * the parentheses around multi-line JSX, and the parentheses around a single
 * arrow parameter. Other parentheses stay, because moving one changes what
 * the code calls. The tree, not a token scan, finds JSX: a parenthesis in JSX
 * text is text.
 */
export function fingerprint(code, jsx) {
  const tokens = []
  const visit = (node) => {
    if (ts.isParenthesizedExpression(node) && isJsx(node.expression))
      return visit(node.expression)
    const children = node.getChildren()
    if (children.length === 0) {
      if (
        node.kind === ts.SyntaxKind.CommaToken ||
        node.kind === ts.SyntaxKind.SemicolonToken ||
        node.kind === ts.SyntaxKind.EndOfFileToken
      )
        return
      tokens.push(
        ts.isStringLiteral(node)
          ? JSON.stringify(node.text)
          : // Formatting also reflows JSX text and the HTML in a template.
            node.getText().replace(/\s+/g, ``),
      )
      return
    }
    const bareParameter =
      ts.isArrowFunction(node) &&
      node.parameters.length === 1 &&
      ts.isIdentifier(node.parameters[0].name) &&
      !node.parameters[0].type
    for (const child of children)
      if (!(
        bareParameter &&
        (child.kind === ts.SyntaxKind.OpenParenToken ||
          child.kind === ts.SyntaxKind.CloseParenToken)
      ))
        visit(child)
  }
  visit(parse(code, jsx))
  return tokens.join(` `)
}

/**
 * Whether an example parses. Only syntax counts: a semantic error with a 1xxx
 * code, such as a missing default export, is still an error to report.
 */
export function parses(code, jsx) {
  const { diagnostics = [] } = ts.transpileModule(code, {
    reportDiagnostics: true,
    fileName: jsx ? `example.tsx` : `example.ts`,
    compilerOptions: { jsx: ts.JsxEmit.Preserve },
  })
  return diagnostics.length === 0
}

/** The names an example imports from a TanStack package, in every form. */
export function tanstackImports(code, jsx) {
  const names = []
  for (const statement of parse(code, jsx).statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      !statement.moduleSpecifier.text.startsWith(`@tanstack/`)
    )
      continue
    const clause = statement.importClause
    if (clause?.name) names.push(clause.name.text)
    const bindings = clause?.namedBindings
    if (bindings && ts.isNamedImports(bindings))
      names.push(...bindings.elements.map((element) => element.name.text))
  }
  return names
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        previous[j] + 1,
        row[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    previous = row
  }
  return previous[b.length]
}

/**
 * The imported name that an unknown name misspells, if any. An app's own
 * names often differ from an import only in case (`collection` and
 * `Collection`) or by a suffix (`counter` and `count`); those are not typos.
 */
export function misspelling(name, imported) {
  if (name.length < 5) return undefined
  return imported.find(
    (candidate) =>
      candidate.toLowerCase() !== name.toLowerCase() &&
      !candidate.startsWith(name) &&
      !name.startsWith(candidate) &&
      editDistance(name, candidate) <= (name.length >= 8 ? 2 : 1),
  )
}

export function selfTest() {
  const imports = [
    `leftJoin`,
    `innerJoin`,
    `count`,
    `Collection`,
    `QueryClient`,
    `useLiveQuery`,
    `eq`,
  ]
  const typos = {
    lefJoin: `leftJoin`,
    innerJion: `innerJoin`,
    useLiveQuey: `useLiveQuery`,
    collection: undefined,
    queryClient: undefined,
    counter: undefined,
    counts: undefined,
    q: undefined,
    Colection: `Collection`,
  }
  for (const [name, expected] of Object.entries(typos)) {
    const found = misspelling(name, imports)
    if (found !== expected)
      throw new Error(
        `self-test: misspelling(${name}) is ${found}, not ${expected}`,
      )
  }

  for (const [code, expected] of [
    [`import Db from '@tanstack/db'\nDb()`, true],
    [`const query = useLiveQuery((q) => q.from({ todo })`, false],
    [`q.from(...)`, false],
  ])
    if (parses(code, false) !== expected)
      throw new Error(`self-test: parses(${code}) is not ${expected}`)

  const imported = tanstackImports(
    [
      `import Default, { lefJoin, type Colection } from '@tanstack/db'`,
      `import type { QueryClient } from '@tanstack/query-core'`,
      `import { notTanStack } from 'other'`,
    ].join(`\n`),
  )
  if (imported.join() !== `Default,lefJoin,Colection,QueryClient`)
    throw new Error(`self-test: tanstackImports found ${imported.join()}`)

  // Pairs that formatting can produce must keep one fingerprint.
  const same = [
    [`f(a, b,);`, `f(a, b)`],
    [`list.map(x => x.id)`, `list.map((x) => x.id)`],
    [`return (<p>:)</p>)`, `return <p>:)</p>`],
    [
      `return (\n  <li key={t.id}>{t.text}</li>\n)`,
      `return <li key={t.id}>{t.text}</li>`,
    ],
    [`q.from({ a })\n  .join(x) // why`, `q.from({ a }).join(x)`],
  ]
  for (const [a, b] of same)
    if (fingerprint(a, true) !== fingerprint(b, true))
      throw new Error(`self-test: fingerprints differ for ${a} and ${b}`)

  // Edits that change what the code does must change the fingerprint.
  const different = [
    [`.join(leftJoin(src, on))`, `.join(leftJoin(src), on)`],
    [`f((a, b) => a)`, `f(a, b => a)`],
    [`eq(a.id, b.id)`, `eq(a.id, b.userId)`],
    [`'a b'`, `'ab'`],
  ]
  for (const [a, b] of different)
    if (fingerprint(a, true) === fingerprint(b, true))
      throw new Error(`self-test: fingerprints match for ${a} and ${b}`)
}
