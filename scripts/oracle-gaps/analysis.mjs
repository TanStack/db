// The static half of a check: what the report owes before any test runs
// (check.mjs). It instruments each source file (schemata.mjs), reads every
// oracle file's `owns` declaration and refuses a broken one, resolves each
// function's owners through the type checker (owners.mjs), and names the
// function each mutant belongs to. It reads only files, so the CLI's own
// oracle checks it in-process.
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { ownership, readOwns } from './owners.mjs'
import { instrument } from './schemata.mjs'

// One compiler host per TypeScript copy. The declarations under
// node_modules, such as the standard library's, are parsed once and kept,
// which makes each later program several times faster to build.
const hosts = new WeakMap()
const compilerOptions = (ts) => ({
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  noEmit: true,
  skipLibCheck: true,
  types: [],
})
function hostFor(ts) {
  if (!hosts.has(ts)) {
    const base = ts.createCompilerHost(compilerOptions(ts))
    const kept = new Map()
    hosts.set(ts, {
      ...base,
      getSourceFile(name, language, onError, fresh) {
        if (!name.includes(`/node_modules/`))
          return base.getSourceFile(name, language, onError, fresh)
        if (!kept.has(name))
          kept.set(name, base.getSourceFile(name, language, onError, fresh))
        return kept.get(name)
      },
    })
  }
  return hosts.get(ts)
}

/**
 * The instrumented sources, the mutants (each with its function), the
 * oracle files' declarations, and the ownership. `testFiles` are the
 * absolute paths of every test file the package's config includes. A
 * declaration that names nothing, a list that is not a literal, or an entry
 * that names a missing file or function throws, because it would hide gaps.
 */
export function analyze(ts, pkg, sources, testFiles) {
  const relative = (file) => file.slice(pkg.length + 1)
  // An oracle file is a test file that calls `declareOracle`.
  const declarations = new Map()
  for (const file of testFiles) {
    const declared = readOwns(ts, file, readFileSync(file, `utf8`))
    if (!declared.declares) continue
    if (declared.problem) throw new Error(`${relative(file)}: ${declared.problem}`)
    for (const entry of declared.entries) {
      const [source] = entry.split(`#`)
      if (!existsSync(join(pkg, source)))
        throw new Error(
          `${relative(file)}: owns entry ${entry} names a missing file, ${source}`,
        )
    }
    declarations.set(file, declared.entries)
  }
  const instrumented = new Map()
  const mutants = []
  for (const source of sources) {
    const path = realpathSync(join(pkg, source))
    const result = instrument(
      ts,
      path,
      readFileSync(path, `utf8`),
      source,
      mutants.length,
    )
    instrumented.set(path, result.code)
    mutants.push(...result.mutants)
  }
  // A function's owners are the oracle files whose `owns` reference trees
  // contain it; only their tests judge its mutants. The type checker reads
  // the package from the sources and the files owns names.
  const program = ts.createProgram(
    [
      ...new Set([
        ...sources,
        ...[...declarations.values()].flat().map((entry) => entry.split(`#`)[0]),
      ]),
    ].map((source) => join(pkg, source)),
    compilerOptions(ts),
    hostFor(ts),
  )
  const owned = ownership(ts, program, pkg, declarations)
  for (const [file, entries] of declarations)
    for (const entry of entries) {
      const [source, fn] = entry.split(`#`)
      if (fn !== undefined && !owned.has(source, fn))
        throw new Error(
          `${relative(file)}: owns entry ${entry} names no function in ${source}`,
        )
    }
  // Each mutant belongs to the function whose lines hold it; keys and
  // ownership both read this one name.
  for (const mutant of mutants)
    mutant.function = owned.functionAt(mutant.source, mutant.line)
  return { instrumented, mutants, declarations, owned }
}
