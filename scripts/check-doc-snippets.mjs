// Typechecks the TypeScript code examples in the guides and the shipped agent
// skills against the workspace packages' source.
//
// Examples are fragments: they use collections and components they never
// declare. The check declares each unknown name as `any`, so it reports what
// an example gets wrong about the TanStack API rather than what it leaves
// out. An unknown name that a TanStack package exports is reported instead:
// the example uses it without importing it.
//
//   node scripts/check-doc-snippets.mjs [--verbose] [--update-baseline]
//
// Mark a fence ```ts nocheck to skip an example that is not meant to compile.
//
// `doc-snippets-baseline.json` lists examples that already failed when the
// check began, by file and a hash of their code. Editing one changes its
// hash, so an edited example must pass. An example that passes must leave the
// baseline: run with --update-baseline after fixing one.
//
// Debugging: SNIPPET_ONLY=<file>:<line> checks one example, and
// SNIPPET_DUMP=<file>:<line> prints the source the check compiles for it.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import prettier from 'prettier'
import ts from 'typescript'

const root = fileURLToPath(new URL(`..`, import.meta.url))
const verbose = process.argv.includes(`--verbose`)
const updateBaseline = process.argv.includes(`--update-baseline`)
const baselinePath = join(root, `scripts`, `doc-snippets-baseline.json`)
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, `utf8`))
  : {}
const hashOf = (code) =>
  createHash(`sha256`).update(code.trim()).digest(`hex`).slice(0, 16)

function walk(dir, keep) {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory())
      return entry.name === `node_modules` || entry.name === `reference`
        ? []
        : walk(path, keep)
    return keep(path) ? [path] : []
  })
}

const markdown = [
  ...walk(join(root, `docs`), (path) => path.endsWith(`.md`)),
  ...readdirSync(join(root, `packages`)).flatMap((pkg) =>
    walk(join(root, `packages`, pkg, `skills`), (path) => path.endsWith(`.md`)),
  ),
]

// Map each workspace package to its source entry.
const paths = {}
for (const pkg of readdirSync(join(root, `packages`))) {
  const manifest = join(root, `packages`, pkg, `package.json`)
  if (!existsSync(manifest)) continue
  const { name, private: unpublished } = JSON.parse(
    readFileSync(manifest, `utf8`),
  )
  // Examples document published packages only.
  if (unpublished) continue
  for (const entry of [`src/index.ts`, `src/index.tsx`]) {
    if (existsSync(join(root, `packages`, pkg, entry))) {
      paths[name] = [join(`packages`, pkg, entry)]
      break
    }
  }
}

const fence = /```(ts|tsx|typescript)([^\n]*)\n([\s\S]*?)```/g
const snippets = []
for (const file of markdown) {
  const text = readFileSync(file, `utf8`)
  for (const match of text.matchAll(fence)) {
    if (match[2].includes(`nocheck`)) continue
    const line = text.slice(0, match.index).split(`\n`).length
    snippets.push({
      file: relative(root, file),
      line,
      code: match[3],
      name: join(
        root,
        `.snippet-check`,
        `${snippets.length}.${/<\/|<[A-Z][A-Za-z]*[ />]/.test(match[3]) ? `tsx` : `ts`}`,
      ),
    })
  }
}

if (process.env.SNIPPET_ONLY) {
  const keep = snippets.filter(
    (s) => `${s.file}:${s.line}` === process.env.SNIPPET_ONLY,
  )
  snippets.length = 0
  snippets.push(...keep)
}

const options = {
  strict: true,
  noUnusedLocals: false,
  noUncheckedIndexedAccess: false,
  allowUnreachableCode: true,
  skipLibCheck: true,
  noEmit: true,
  jsx: ts.JsxEmit.ReactJSX,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  lib: [`lib.es2022.d.ts`, `lib.dom.d.ts`, `lib.dom.iterable.d.ts`],
  baseUrl: root,
  paths,
}

// Modules an example imports but this repo cannot resolve (app files, other
// frameworks) are declared `any`, one by one. A wildcard would also erase
// third-party types that the packages themselves use.
const ambient = join(root, `.snippet-check`, `ambient.d.ts`)
const missingModules = new Set()
const ambientSource = () =>
  [...missingModules]
    .map((name) => `declare module ${JSON.stringify(name)}\n`)
    .join(``) || `export {}\n`

function check(sources) {
  const host = ts.createCompilerHost(options)
  const read = host.readFile
  host.readFile = (path) => sources.get(path) ?? read(path)
  const exists = host.fileExists
  host.fileExists = (path) => sources.has(path) || exists(path)
  const program = ts.createProgram([...sources.keys()], options, host)
  return { program, diagnostics: ts.getPreEmitDiagnostics(program) }
}

// Names the TanStack packages export, to tell "not imported" from "app code".
const exported = new Map()
{
  const probe = join(root, `.snippet-check`, `exports.ts`)
  const packages = Object.keys(paths).filter((name) =>
    name.startsWith(`@tanstack/`),
  )
  const imports = packages
    .map((name, i) => `import * as m${i} from '${name}'`)
    .join(`\n`)
  const { program } = check(new Map([[probe, imports + `\n`]]))
  const checker = program.getTypeChecker()
  program.getSourceFile(probe).statements.forEach((statement, i) => {
    const symbol = checker.getSymbolAtLocation(statement.moduleSpecifier)
    if (!symbol) return
    for (const item of checker.getExportsOfModule(symbol)) {
      const owners = exported.get(item.name) ?? []
      owners.push(packages[i])
      exported.set(item.name, owners)
    }
  })
}

// The framework a file documents, for names several adapters export.
const frameworkOf = (file) =>
  [`angular`, `solid`, `svelte`, `vue`, `react`].find((name) =>
    file.includes(name),
  ) ?? `react`

function packageFor(name, file) {
  const owners = exported.get(name)
  if (owners.length === 1) return owners[0]
  return (
    owners.find((owner) => owner === `@tanstack/db`) ??
    owners.find((owner) => owner.includes(frameworkOf(file))) ??
    owners[0]
  )
}

const importsTanStack = (code) => /from ['"]@tanstack\//.test(code)

function sourceOf(snippet, declared, autoImported) {
  const byPackage = new Map()
  for (const name of autoImported) {
    const pkg = packageFor(name, snippet.file)
    byPackage.set(pkg, [...(byPackage.get(pkg) ?? []), name])
  }
  return (
    [...byPackage]
      .map(([pkg, names]) => `import { ${names.join(`, `)} } from '${pkg}'\n`)
      .join(``) +
    `import type { Collection as SnippetCollection } from '@tanstack/db'\n` +
    [...declared]
      .map(
        (name) =>
          `declare const ${name}: ${/collection$/i.test(name) ? `SnippetCollection<Record<string, any>, string | number>` : `any`}\ntype ${name} = any\n`,
      )
      .join(``) +
    snippet.code +
    `\nexport {}\n`
  )
}

const declared = snippets.map(() => new Set())
const unimported = snippets.map(() => new Set())
const autoImported = snippets.map(() => new Set())
const unknownName = new Set([2304, 2552, 18004, 2749, 2693])
// Docs often show alternatives side by side in one block, and leave
// callback parameters unannotated where an app would annotate them.
const ignored = new Set([2451, 2300, 2393, 7005, 7006, 7019, 7031, 7034, 7053])
// An unresolvable dependency is declared as an untyped module, whose names
// cannot be used as types.
ignored.add(2709)
let diagnostics = []
// Declare unknown names until a pass adds none.
for (let pass = 0; pass < 6; pass++) {
  const sources = new Map([[ambient, ambientSource()]])
  snippets.forEach((snippet, i) =>
    sources.set(snippet.name, sourceOf(snippet, declared[i], autoImported[i])),
  )
  diagnostics = check(sources).diagnostics
  let added = 0
  for (const diagnostic of diagnostics) {
    if (
      diagnostic.code === 2307 &&
      snippets.some((s) => s.name === diagnostic.file?.fileName)
    ) {
      const name = ts
        .flattenDiagnosticMessageText(diagnostic.messageText, ``)
        .match(/'([^']+)'/)?.[1]
      if (name && !missingModules.has(name)) {
        missingModules.add(name)
        added++
      }
      continue
    }
    if (!unknownName.has(diagnostic.code)) continue
    const index = snippets.findIndex(
      (s) => s.name === diagnostic.file?.fileName,
    )
    if (index < 0) continue
    const name = ts
      .flattenDiagnosticMessageText(diagnostic.messageText, ``)
      .match(/'([^']+)'/)?.[1]
    if (!name) continue
    if (exported.has(name)) {
      if (importsTanStack(snippets[index].code)) unimported[index].add(name)
      else if (!autoImported[index].has(name)) {
        autoImported[index].add(name)
        added++
      }
    } else if (!declared[index].has(name)) {
      declared[index].add(name)
      added++
    }
  }
  if (added === 0) break
}

if (process.env.SNIPPET_DUMP) {
  const i = snippets.findIndex(
    (s) => `${s.file}:${s.line}` === process.env.SNIPPET_DUMP,
  )
  console.log(sourceOf(snippets[i], declared[i], autoImported[i]))
}
const failures = []
let unparsable = 0
snippets.forEach((snippet, i) => {
  const ownDiagnostics = diagnostics.filter(
    (d) => d.file?.fileName === snippet.name,
  )
  // Pseudo-code, such as `...` placeholders, is not meant to compile.
  if (ownDiagnostics.some((d) => d.code >= 1000 && d.code < 2000)) {
    unparsable++
    return
  }
  const offset =
    1 +
    declared[i].size * 2 +
    new Set([...autoImported[i]].map((n) => packageFor(n, snippet.file))).size
  const messages = ownDiagnostics
    .filter((d) => !unknownName.has(d.code) && !ignored.has(d.code))
    .map((d) => {
      const { line } = d.file.getLineAndCharacterOfPosition(d.start ?? 0)
      return `  line ${snippet.line + line - offset}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, ` `)}`
    })
  for (const name of unimported[i])
    messages.push(`  uses \`${name}\` without importing it`)
  if (messages.length)
    failures.push({
      snippet,
      text: `${snippet.file}:${snippet.line}\n${messages.join(`\n`)}`,
    })
})

const known = (snippet) =>
  baseline[snippet.file]?.includes(hashOf(snippet.code)) ?? false
const newFailures = failures.filter(({ snippet }) => !known(snippet))
const failing = new Set(
  failures.map(({ snippet }) => `${snippet.file}#${hashOf(snippet.code)}`),
)
const stale = Object.entries(baseline).flatMap(([file, hashes]) =>
  hashes
    .filter((hash) => !failing.has(`${file}#${hash}`))
    .map((hash) => `${file}#${hash}`),
)

if (updateBaseline && !process.env.SNIPPET_ONLY) {
  const next = {}
  for (const { snippet } of failures)
    (next[snippet.file] ??= []).push(hashOf(snippet.code))
  for (const hashes of Object.values(next)) hashes.sort()
  const sorted = Object.fromEntries(
    Object.entries(next).sort(([a], [b]) => a.localeCompare(b)),
  )
  writeFileSync(
    baselinePath,
    await prettier.format(JSON.stringify(sorted), {
      ...(await prettier.resolveConfig(baselinePath)),
      filepath: baselinePath,
    }),
  )
  console.log(`Baseline: ${failures.length} known failing examples`)
} else {
  const shown = verbose ? failures : newFailures
  if (shown.length) console.log(shown.map(({ text }) => text).join(`\n\n`))
  if (stale.length && !process.env.SNIPPET_ONLY)
    console.log(
      `\n${stale.length} baseline entries now pass or no longer exist; run with --update-baseline:\n${stale.join(`\n`)}`,
    )
  console.log(
    `\n${snippets.length} examples in ${markdown.length} files: ${newFailures.length} new failures, ${failures.length - newFailures.length} known, ${unparsable} skipped as pseudo-code`,
  )
  process.exitCode =
    newFailures.length || (stale.length && !process.env.SNIPPET_ONLY) ? 1 : 0
}
