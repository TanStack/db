// Keeps packages/db/mangle-cache.json safe. The db build renames every
// property whose name is a cache key, anywhere in its output, so each key must
// be a name that is only ever a TypeScript `private` class member.
//
// A name is safe when:
// - every property-name use of it in packages/db/src resolves, through the
//   type checker, to a `private` member declared in packages/db/src;
// - it never appears as a string literal in packages/db/src;
// - no other package's src or tests reads `.name` or a quoted `'name'`.
//
// Each cache value must be unique and must not be an identifier anywhere in
// db or db-ivm src, so a renamed member cannot collide with a real property.
//
//   node scripts/mangle-private-members.mjs          check the cache (CI)
//   node scripts/mangle-private-members.mjs --write  update the cache
//
// --write keeps existing assignments, drops names that are no longer safe,
// and gives new safe names the next free short names, most-used first.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const cachePath = path.join(root, 'packages/db/mangle-cache.json')
const write = process.argv.includes('--write')

const walk = (dir, exts) =>
  readdirSync(dir).flatMap((entry) => {
    const file = path.join(dir, entry)
    if (entry === 'node_modules' || entry === 'dist') return []
    if (statSync(file).isDirectory()) return walk(file, exts)
    return exts.some((ext) => file.endsWith(ext)) ? [file] : []
  })
const dbSrc = path.join(root, 'packages/db/src')
const dbFiles = walk(dbSrc, ['.ts'])
const ivmFiles = walk(path.join(root, 'packages/db-ivm/src'), ['.ts'])

const config = ts.getParsedCommandLineOfConfigFile(
  path.join(root, 'packages/db/tsconfig.json'),
  {},
  { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
)
const program = ts.createProgram({
  rootNames: dbFiles,
  options: { ...config.options, noEmit: true },
})
const checker = program.getTypeChecker()
const inDbSrc = (file) => path.resolve(file).startsWith(dbSrc + path.sep)
const isPrivateMember = (decl) =>
  (ts.isPropertyDeclaration(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isGetAccessorDeclaration(decl) ||
    ts.isSetAccessorDeclaration(decl) ||
    ts.isParameter(decl)) &&
  ts.getModifiers(decl)?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword) &&
  inDbSrc(decl.getSourceFile().fileName)

const candidates = new Set()
const useCounts = new Map()
for (const file of dbFiles) {
  const visit = (node) => {
    if (isPrivateMember(node) && node.name && ts.isIdentifier(node.name))
      candidates.add(node.name.text)
    ts.forEachChild(node, visit)
  }
  visit(program.getSourceFile(file))
}

const unsafe = new Map()
const mark = (name, reason) => {
  if (candidates.has(name) && !unsafe.has(name)) unsafe.set(name, reason)
}
for (const file of dbFiles) {
  const sourceFile = program.getSourceFile(file)
  const where = (node) =>
    `${path.relative(root, file)}:${sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1}`
  const checkName = (nameNode) => {
    const name = nameNode.text
    if (!candidates.has(name)) return
    useCounts.set(name, (useCounts.get(name) ?? 0) + 1)
    const symbol = checker.getSymbolAtLocation(nameNode)
    const declarations = symbol?.declarations ?? []
    if (declarations.length === 0)
      return mark(name, `unresolved use at ${where(nameNode)}`)
    const other = declarations.find((decl) => !isPrivateMember(decl))
    if (other)
      mark(
        name,
        `${ts.SyntaxKind[other.kind]} in ${path.relative(root, other.getSourceFile().fileName)}, used at ${where(nameNode)}`,
      )
  }
  const visit = (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name))
      checkName(node.name)
    else if (
      (ts.isPropertyAssignment(node) ||
        ts.isPropertyDeclaration(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node) ||
        ts.isPropertySignature(node) ||
        ts.isMethodSignature(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      checkName(node.name)
    else if (ts.isShorthandPropertyAssignment(node))
      mark(node.name.text, `shorthand property at ${where(node)}`)
    else if (ts.isBindingElement(node)) {
      const key = node.propertyName ?? node.name
      if (ts.isIdentifier(key))
        mark(key.text, `destructuring at ${where(node)}`)
    } else if (ts.isStringLiteralLike(node))
      mark(node.text, `string literal at ${where(node)}`)
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
}

const otherFiles = readdirSync(path.join(root, 'packages'))
  .filter((pkg) => pkg !== 'db')
  .flatMap((pkg) =>
    ['src', 'tests', 'test', 'e2e'].flatMap((sub) => {
      const dir = path.join(root, 'packages', pkg, sub)
      try {
        return walk(dir, ['.ts', '.tsx', '.js', '.mjs', '.svelte', '.vue'])
      } catch {
        return []
      }
    }),
  )
  .map((file) => [file, readFileSync(file, 'utf8')])
for (const name of candidates) {
  if (unsafe.has(name)) continue
  const use = new RegExp(`\\.${name}\\b|[\`'"]${name}[\`'"]`)
  const hit = otherFiles.find(([, text]) => use.test(text))
  if (hit) mark(name, `used in ${path.relative(root, hit[0])}`)
}

const safe = new Set([...candidates].filter((name) => !unsafe.has(name)))
const identifiers = new Set(
  [...dbFiles, ...ivmFiles]
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n')
    .match(/[A-Za-z_$][\w$]*/g),
)
const cache = JSON.parse(readFileSync(cachePath, 'utf8'))

if (write) {
  const next = {}
  const taken = new Set()
  for (const [name, short] of Object.entries(cache))
    if (safe.has(name) && !identifiers.has(short) && !taken.has(short)) {
      next[name] = short
      taken.add(short)
    }
  const first = `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$`
  const rest = `${first}0123456789`
  function* shortNames() {
    for (const a of first) yield a
    for (const a of first) for (const b of rest) yield a + b
    for (const a of first)
      for (const b of rest) for (const c of rest) yield a + b + c
  }
  const free = shortNames()
  const added = [...safe]
    .filter((name) => !(name in next))
    .sort(
      (a, b) =>
        (useCounts.get(b) ?? 0) * b.length -
          (useCounts.get(a) ?? 0) * a.length || a.localeCompare(b),
    )
  for (const name of added) {
    let short
    do short = free.next().value
    while (identifiers.has(short) || taken.has(short) || safe.has(short))
    next[name] = short
    taken.add(short)
  }
  writeFileSync(cachePath, `${JSON.stringify(next, null, 2)}\n`)
  const dropped = Object.keys(cache).filter((name) => !(name in next))
  console.log(
    `mangle cache: ${Object.keys(next).length} names (${added.length} added, ${dropped.length} dropped)`,
  )
} else {
  const problems = []
  const shorts = new Map()
  for (const [name, short] of Object.entries(cache)) {
    if (!candidates.has(name))
      problems.push(`${name}: no longer a private member (run --write)`)
    else if (unsafe.has(name)) problems.push(`${name}: ${unsafe.get(name)}`)
    if (identifiers.has(short))
      problems.push(`${name} -> ${short}: ${short} is an identifier in src`)
    if (shorts.has(short))
      problems.push(`${name} -> ${short}: also used for ${shorts.get(short)}`)
    shorts.set(short, name)
  }
  if (problems.length > 0) {
    console.error(`Unsafe entries in packages/db/mangle-cache.json:`)
    for (const problem of problems) console.error(`  ${problem}`)
    process.exit(1)
  }
  const missing = [...safe].filter((name) => !(name in cache)).length
  console.log(
    `mangle cache OK: ${Object.keys(cache).length} names` +
      (missing > 0 ? ` (${missing} more safe names; --write adds them)` : ``),
  )
}
