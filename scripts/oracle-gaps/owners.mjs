// Ownership: which oracle files judge a function.
//
// An oracle file names what it owns in `declareOracle({ owns: [...] })`. Each
// entry is a source path relative to the package, either alone (the whole
// file) or with an entry function (`src/x.ts#run`, `src/x.ts#Class.method`).
// Owning an entry function owns its static reference tree within the package,
// as the TypeScript type checker resolves it: every function, method, or
// class that its body refers to, whether it calls it by name, through an
// import or its alias, through `this` or a typed field, through `.bind`, or
// passes it as a value. A class passed as a value brings all its methods;
// `new C()` brings only C's constructor (maintainer decision). The tree
// is read from the source, not from what any test ran, so code an oracle
// never reaches stays owned and shows up as a gap rather than dropping out of
// the oracle's scope. It stops at the package's boundary: a declaration
// outside the package, such as another package or the standard library, is
// not followed (maintainer decisions of 2026-11-05).
//
// A function is a function declaration, a method (named `Class.method`), a
// constructor (named `Class.constructor`), or a function assigned to a name; a mutant belongs to the innermost one whose
// lines hold it. A function's owners are the oracle files whose trees contain
// it. A gap is judged across all of them: a mutant is killed when any owner
// kills it, and a function with no owner is reported as `unowned`, a warning
// rather than a gap.
import { relative, resolve } from 'node:path'

/**
 * Whether a test file calls `declareOracle` (which makes it an oracle file),
 * the `owns` entries it names, and a problem when the list cannot be read
 * statically: it must be a literal list of strings or plain template
 * literals, because an entry the CLI cannot read would hide gaps.
 */
export function readOwns(ts, path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const result = { declares: false, entries: [], problem: undefined }
  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === `declareOracle`
    ) {
      result.declares = true
      const parts = node.arguments[0]
      for (const property of parts && ts.isObjectLiteralExpression(parts)
        ? parts.properties
        : [])
        if (property.name?.getText(file) === `owns`) {
          const list = ts.isPropertyAssignment(property)
            ? property.initializer
            : undefined
          if (!list || !ts.isArrayLiteralExpression(list)) {
            result.problem = `its owns list is not a literal list, so the gap report cannot read what it owns`
            continue
          }
          for (const element of list.elements)
            if (ts.isStringLiteralLike(element)) result.entries.push(element.text)
            else
              result.problem = `its owns entry ${element.getText(file)} is not a literal string`
        }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return result
}

/** The named functions of one source file, with their nodes and line spans. */
export function functionsIn(ts, file) {
  const lineOf = (pos) => file.getLineAndCharacterOfPosition(pos).line + 1
  const functions = new Map()
  const visit = (node, cls) => {
    const owner =
      ts.isClassDeclaration(node) && node.name ? node.name.text : cls
    const name =
      ts.isFunctionDeclaration(node) && node.name && node.body
        ? node.name.text
        : ts.isMethodDeclaration(node) && node.name && node.body
          ? `${owner ?? `<class>`}.${node.name.getText(file)}`
          : ts.isConstructorDeclaration(node) && node.body
            ? `${owner ?? `<class>`}.constructor`
          : ts.isVariableDeclaration(node) &&
              ts.isIdentifier(node.name) &&
              node.initializer &&
              (ts.isArrowFunction(node.initializer) ||
                ts.isFunctionExpression(node.initializer))
            ? node.name.text
            : undefined
    if (name !== undefined)
      functions.set(name, {
        node: ts.isVariableDeclaration(node) ? node.initializer : node,
        start: lineOf(node.getStart(file)),
        end: lineOf(node.end),
      })
    ts.forEachChild(node, (child) => visit(child, owner))
  }
  visit(file, undefined)
  return functions
}

/**
 * Owners by source and function. `oracles` maps each oracle file to its
 * `owns` entries; `program` is a TypeScript program over the package's
 * sources and `pkg` the package's directory.
 */
export function ownership(ts, program, pkg, oracles) {
  const checker = program.getTypeChecker()
  const inPackage = (fileName) => {
    const path = relative(pkg, fileName)
    return !path.startsWith(`..`) && !path.split(/[\\/]/).includes(`node_modules`)
  }
  const indexed = new Map()
  const functionsOf = (source) => {
    if (!indexed.has(source)) {
      const file = program.getSourceFile(resolve(pkg, source))
      indexed.set(source, file ? functionsIn(ts, file) : undefined)
    }
    return indexed.get(source)
  }
  // The package functions a declaration names: itself, or, for a class used
  // as a value, all its methods. `new C()` names only C's constructor; C's
  // methods are owned where the tree refers to them.
  const targetsOf = (declaration, constructed) => {
    const file = declaration.getSourceFile()
    if (!inPackage(file.fileName)) return []
    const source = relative(pkg, file.fileName)
    const functions = functionsOf(source)
    if (ts.isClassDeclaration(declaration) && declaration.name) {
      const prefix = `${declaration.name.text}.`
      if (constructed)
        return functions.has(`${prefix}constructor`)
          ? [{ source, fn: `${prefix}constructor` }]
          : []
      return [...functions.keys()]
        .filter((name) => name.startsWith(prefix))
        .map((fn) => ({ source, fn }))
    }
    for (const [fn, entry] of functions)
      if (
        entry.node === declaration ||
        entry.node === declaration.initializer
      )
        return [{ source, fn }]
    return []
  }
  // Every package function, method, or class an owned body refers to.
  const referencesOf = (node) => {
    const found = []
    const visit = (child) => {
      if (ts.isIdentifier(child)) {
        let symbol = checker.getSymbolAtLocation(child)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol)
        const constructed =
          ts.isNewExpression(child.parent) && child.parent.expression === child
        for (const declaration of symbol?.declarations ?? [])
          found.push(...targetsOf(declaration, constructed))
      }
      ts.forEachChild(child, visit)
    }
    if (node.body) visit(node.body)
    return found
  }
  const owners = new Map()
  const add = (source, fn, oracle) => {
    const key = `${source}#${fn}`
    owners.set(key, new Set([...(owners.get(key) ?? []), oracle]))
  }
  for (const [oracle, entries] of oracles)
    for (const entry of entries) {
      const [source, entryFunction] = entry.split(`#`)
      if (entryFunction === undefined) {
        add(source, `*`, oracle)
        continue
      }
      const seen = new Set()
      const walk = (at) => {
        const key = `${at.source}#${at.fn}`
        if (seen.has(key)) return
        seen.add(key)
        add(at.source, at.fn, oracle)
        const entryNode = functionsOf(at.source)?.get(at.fn)?.node
        if (entryNode) for (const next of referencesOf(entryNode)) walk(next)
      }
      if (functionsOf(source)?.has(entryFunction))
        walk({ source, fn: entryFunction })
    }
  return {
    has: (source, fn) => functionsOf(source)?.has(fn) === true,
    // A whole-file entry owns every function in the file.
    of: (source, fn) =>
      new Set([
        ...(owners.get(`${source}#${fn}`) ?? []),
        ...(owners.get(`${source}#*`) ?? []),
      ]),
    /** The innermost function that contains a line. */
    functionAt: (source, line) => {
      let best
      for (const [name, span] of functionsOf(source) ?? [])
        if (
          span.start <= line &&
          line <= span.end &&
          (!best || span.start >= best.start)
        )
          best = { name, start: span.start }
      return best?.name ?? `<module>`
    },
  }
}
