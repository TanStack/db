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
 * example keeps its baseline entry: spacing, comments, trailing commas,
 * semicolons, the parentheses around multi-line JSX, and the parentheses
 * around a single arrow parameter. Other commas and parentheses stay, because
 * moving one changes what the code calls. The tree, not a token scan, finds JSX: a parenthesis in JSX
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
    children.forEach((child, index) => {
      const parameterParen =
        bareParameter &&
        (child.kind === ts.SyntaxKind.OpenParenToken ||
          child.kind === ts.SyntaxKind.CloseParenToken)
      // A trailing comma ends its list; other commas separate values.
      const trailingComma =
        child.kind === ts.SyntaxKind.CommaToken && index === children.length - 1
      if (!parameterParen && !trailingComma) visit(child)
    })
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

/**
 * The TypeScript in a Svelte or Vue component example: its `<script>` block
 * with `lang="ts"`, and the line it starts on, counted from the fence. The
 * template is not TypeScript and is not checked. Undefined when the component
 * has no TypeScript script.
 */
export function componentScript(code) {
  const match =
    /<script\b[^>]*\blang=["']ts["'][^>]*>\n?([\s\S]*?)<\/script>/.exec(code)
  if (!match) return undefined
  const start = match.index + match[0].indexOf(`>`) + 1
  const offset = code.slice(0, start).split(`\n`).length - 1
  return { code: match[1], offset: code[start] === `\n` ? offset + 1 : offset }
}

const frameworks = new Set([
  `angular`,
  `preact`,
  `react`,
  `solid`,
  `svelte`,
  `vue`,
])

/**
 * The framework a doc or skill file documents, from its path segments: a
 * `docs/framework/<name>/` directory or a `packages/<name>-db/` package. A
 * name inside a word, such as `solid` in `consolidation`, does not count.
 * Other files document React.
 */
export function frameworkOf(file) {
  const segments = file.split(`/`)
  const name = segments.flatMap((segment, index) =>
    segments[index - 1] === `framework`
      ? [segment]
      : segment.endsWith(`-db`)
        ? [segment.slice(0, -3)]
        : [],
  )
  return name.find((candidate) => frameworks.has(candidate)) ?? `react`
}

export function selfTest() {
  const imports = [
    `include`,
    `toArray`,
    `count`,
    `Collection`,
    `QueryClient`,
    `useLiveQuery`,
    `eq`,
  ]
  const typos = {
    inclde: `include`,
    toArry: `toArray`,
    useLiveQuey: `useLiveQuery`,
    useLievQuery: `useLiveQuery`,
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

  const component = componentScript(
    `<!-- A.svelte -->\n<script lang="ts">\nconst a = 1\n</script>\n<p>{a}</p>`,
  )
  if (component?.code !== `const a = 1\n` || component.offset !== 2)
    throw new Error(
      `self-test: componentScript read ${JSON.stringify(component)}`,
    )
  if (componentScript(`<script>\nconst a = 1\n</script>`) !== undefined)
    throw new Error(
      `self-test: componentScript read a script without lang="ts"`,
    )
  if (componentScript(`<script setup lang="ts">x</script>`)?.code !== `x`)
    throw new Error(
      `self-test: componentScript missed <script setup lang="ts">`,
    )

  for (const [file, expected] of [
    [`docs/framework/preact/overview.md`, `preact`],
    [`docs/framework/react/overview.md`, `react`],
    [`packages/solid-db/skills/solid-db/SKILL.md`, `solid`],
    [
      `docs/contributing/oracle-reviews/code-weight-multiset-consolidation.md`,
      `react`,
    ],
    [`docs/guides/live-queries.md`, `react`],
  ])
    if (frameworkOf(file) !== expected)
      throw new Error(`self-test: frameworkOf(${file}) is ${frameworkOf(file)}`)

  const imported = tanstackImports(
    [
      `import Default, { inclde, type Colection } from '@tanstack/db'`,
      `import type { QueryClient } from '@tanstack/query-core'`,
      `import { notTanStack } from 'other'`,
    ].join(`\n`),
  )
  if (imported.join() !== `Default,inclde,Colection,QueryClient`)
    throw new Error(`self-test: tanstackImports found ${imported.join()}`)

  // Pairs that formatting can produce must keep one fingerprint.
  const same = [
    [`f(a, b,);`, `f(a, b)`],
    [`const o = { a: 1, b: [1, 2,], }`, `const o = { a: 1, b: [1, 2] }`],
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
    [`.where(eq(a, b))`, `.where(eq(a), b)`],
    [`f(a, -b)`, `f(a - b)`],
    [`eq(a, [b])`, `eq(a[b])`],
    [`f((a, b) => a)`, `f(a, b => a)`],
    [`eq(a.id, b.id)`, `eq(a.id, b.userId)`],
    [`'a b'`, `'ab'`],
  ]
  for (const [a, b] of different)
    if (fingerprint(a, true) === fingerprint(b, true))
      throw new Error(`self-test: fingerprints match for ${a} and ${b}`)
}
