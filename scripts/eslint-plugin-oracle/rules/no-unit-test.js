import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseForESLint } from '@typescript-eslint/parser'
import {
  findVariable,
  isFunction,
  isOracleConfigSource,
  registeredTest,
} from '../registration.js'

/**
 * An oracle's expected results come from its model, and its check compares
 * production with them. A test that compares production with a value that a
 * person wrote down is a unit test. Its expectation has no independent
 * source, so it is not oracle coverage, even in a file named for an oracle.
 *
 * Each oracle file declares its parts with `declareOracle` from
 * oracle-config:
 *
 *   declareOracle({ check: [checkHistory], model: [modelHistory] })
 *
 * The check compares production observations with the model, or with a
 * second formulation. The grammar is the generators that produce legal
 * histories. Each is optional: a differential or metamorphic oracle has no
 * model, and a companion module can declare only the part that its importers
 * use. Every test in the file must reach a declared part:
 *
 * - A generated property or a fixed history reaches the check.
 * - A model pin reaches the model. It checks one model rule against its
 *   authority.
 * - A calibration reaches the check. It shows that the check rejects a
 *   wrong answer.
 * - A grammar calibration reaches the grammar. It shows that the generators
 *   reach the states that the laws need.
 *
 * A generated property counts as its own check: `fc.property(...)` or
 * `fc.asyncProperty(...)` from fast-check, run by the test directly or
 * through code it calls, or a `.prop([...])` registration. Its predicate
 * states a law over inputs that nobody wrote down. It does not count when all
 * its arbitraries are `fc.constant` or `fc.constantFrom`, or when its
 * predicate never reads its input: then it checks written values.
 *
 * A test reaches a part when its body uses the part, or uses a function or
 * value that reaches it. The rule follows bindings through the file and
 * through relative imports of other test modules, so a driver in a companion
 * module that calls the check counts. It does not follow imports of
 * production: `src/` modules of a published package, which declare no oracle
 * part. A private package, such as an end-to-end suite, keeps its tests in
 * `src/`, and the rule follows those.
 *
 * The rule reports each test that reaches no declared part. Move such a test
 * to an ordinary test file, where it stays as supplemental coverage. A file
 * whose tests reach no part, and that declares none itself, gets one report
 * that asks for the declaration.
 *
 * Files whose names start with `oracle-`, such as `oracle-replay.test.ts`,
 * test the shared oracle machinery, and the rule skips them.
 *
 * A unit test that happens to use a declared grammar passes the rule.
 * The rule cannot see whether a test that reaches a part also compares
 * production with hand-written values, or whether a declared part is really
 * a check or a model. Reviewers still check those.
 */

const declarationHelper = `declareOracle`

/** Every `{ mtimeMs, module }` that an earlier lint parsed, by path. */
const parsedModules = new Map()

/** The test module that a relative import names, or undefined. */
function resolveTestModule(fromFile, source) {
  if (!source.startsWith(`.`)) return undefined
  const base = resolve(dirname(fromFile), source)
  const stem = base.replace(/\.(m?js|tsx?)$/, ``)
  const file = [`${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`].find(
    (candidate) => existsSync(candidate),
  )
  // Production declares no oracle part, so the rule does not parse it.
  if (file === undefined || isProductionModule(file)) return undefined
  return file
}

/** Whether each package directory is published, by path. */
const publishedPackages = new Map()

/**
 * Whether a file is shipped source: under `src/` in a published package. A
 * private package, such as an end-to-end suite, keeps its tests in `src/`.
 */
function isProductionModule(file) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, `package.json`)
    if (existsSync(manifest)) {
      if (!publishedPackages.has(directory)) {
        const { private: isPrivate } = JSON.parse(
          readFileSync(manifest, `utf8`),
        )
        publishedPackages.set(directory, isPrivate !== true)
      }
      return (
        publishedPackages.get(directory) &&
        relative(directory, file).split(sep)[0] === `src`
      )
    }
    if (dirname(directory) === directory) return false
  }
}

function inTypeQuery(identifier) {
  for (let node = identifier.parent; node; node = node.parent) {
    if (node.type === `TSTypeQuery`) return true
  }
  return false
}

/** ESLint sets `parent` on the file it lints; a module parsed here needs it too. */
function setParents(node, parent) {
  node.parent = parent
  for (const [key, child] of Object.entries(node)) {
    if (key === `parent`) continue
    for (const item of Array.isArray(child) ? child : [child]) {
      if (typeof item?.type === `string`) setParents(item, node)
    }
  }
}

function loadModule(file) {
  const { mtimeMs } = statSync(file)
  const cached = parsedModules.get(file)
  if (cached?.mtimeMs === mtimeMs) return cached.module
  const { ast, scopeManager } = parseForESLint(readFileSync(file, `utf8`), {
    filePath: file,
    jsx: file.endsWith(`.tsx`),
    loc: true,
    range: true,
    sourceType: `module`,
  })
  setParents(ast, null)
  const module = new OracleModule(file, ast, scopeManager)
  parsedModules.set(file, { mtimeMs, module })
  return module
}

class OracleModule {
  constructor(file, ast, scopeManager) {
    this.file = file
    this.scopeManager = scopeManager
    this.reach = new Map()
    // Resolved references in source order, so a node's references are one
    // contiguous range.
    this.references = scopeManager.scopes
      .flatMap((scope) => scope.references)
      // A type annotation runs nothing, so only value references reach.
      // `typeof check` in a type names a value, and still runs nothing.
      .filter(
        (reference) =>
          reference.resolved !== null &&
          reference.isValueReference &&
          !inTypeQuery(reference.identifier),
      )
      .sort((a, b) => a.identifier.range[0] - b.identifier.range[0])
    this.resolvedAt = new Map(
      this.references.map((reference) => [
        reference.identifier,
        reference.resolved,
      ]),
    )
    // Start offsets of the generated properties in this module, in order.
    this.properties = []
    walk(ast, (node) => {
      if (this.#isGeneratedProperty(node)) this.properties.push(node.range[0])
    })
    this.properties.sort((a, b) => a - b)
    this.declared = this.#declaredParts()
    this.exported = new Map()
    this.starSources = []
    for (const statement of ast.body) this.#recordExports(statement)
  }

  /** The variables that `declareOracle({ check, model })` names. */
  #declaredParts() {
    const declared = new Set()
    for (const reference of this.references) {
      const call = reference.identifier.parent
      const definition = reference.resolved.defs[0]
      if (
        reference.identifier.name !== declarationHelper ||
        call.type !== `CallExpression` ||
        call.callee !== reference.identifier ||
        definition?.type !== `ImportBinding` ||
        !isOracleConfigSource(definition.parent.source.value)
      ) {
        continue
      }
      for (const property of call.arguments[0]?.properties ?? []) {
        const value = property.value
        const parts =
          value?.type === `ArrayExpression` ? value.elements : [value]
        for (const part of parts) {
          const variable = this.#variableAt(part)
          if (variable !== undefined) declared.add(variable)
        }
      }
    }
    return declared
  }

  #variableAt(identifier) {
    if (identifier?.type !== `Identifier`) return undefined
    return this.references.find(
      (reference) => reference.identifier === identifier,
    )?.resolved
  }

  #recordExports(statement) {
    if (statement.type === `ExportAllDeclaration`) {
      if (statement.exported === null) {
        this.starSources.push(statement.source.value)
      }
      return
    }
    if (statement.type !== `ExportNamedDeclaration`) return
    if (statement.declaration !== null) {
      for (const variable of this.scopeManager.getDeclaredVariables(
        statement.declaration,
      )) {
        this.exported.set(variable.name, { variable })
      }
      for (const declarator of statement.declaration.declarations ?? []) {
        for (const variable of this.scopeManager.getDeclaredVariables(
          declarator,
        )) {
          this.exported.set(variable.name, { variable })
        }
      }
      return
    }
    for (const specifier of statement.specifiers) {
      const exported = specifier.exported.name ?? specifier.exported.value
      const local = specifier.local.name ?? specifier.local.value
      if (statement.source !== null) {
        this.exported.set(exported, {
          source: statement.source.value,
          imported: local,
        })
      } else {
        const variable = findVariable(this.#moduleScope(), local)
        if (variable !== undefined) this.exported.set(exported, { variable })
      }
    }
  }

  #moduleScope() {
    return (
      this.scopeManager.scopes.find((scope) => scope.type === `module`) ??
      this.scopeManager.globalScope
    )
  }

  get declaresParts() {
    return this.declared.size > 0
  }

  /** Whether a binding is a declared part, or uses one. */
  variableReaches(variable) {
    if (variable === undefined) return false
    if (this.declared.has(variable)) return true
    const known = this.reach.get(variable)
    if (known !== undefined) return known
    // A binding that uses itself does not reach a part through that use.
    this.reach.set(variable, false)
    const reaches = variable.defs.some((definition) =>
      this.#definitionReaches(definition),
    )
    this.reach.set(variable, reaches)
    return reaches
  }

  #definitionReaches(definition) {
    switch (definition.type) {
      case `ImportBinding`: {
        if (definition.node.type !== `ImportSpecifier`) return false
        const imported =
          definition.node.imported.name ?? definition.node.imported.value
        return this.#importReaches(definition.parent.source.value, imported)
      }
      case `FunctionName`:
      case `ClassName`:
        return this.nodeReaches(definition.node)
      case `Variable`:
        return (
          definition.node.init !== null &&
          this.nodeReaches(definition.node.init)
        )
      case `Parameter`:
        return this.#parameterReaches(definition)
      default:
        return false
    }
  }

  /**
   * A parameter reaches a part when every call of its function passes an
   * argument that reaches one, as when a helper registers the property that
   * its caller passes in. A function that the file never calls by name
   * passes nothing the rule can see.
   */
  #parameterReaches(definition) {
    const index = definition.node.params.indexOf(definition.name)
    const calls = this.#callsOf(definition)
    return (
      index >= 0 &&
      calls.length > 0 &&
      calls.every((call) => {
        const argument = call.arguments[index]
        return argument !== undefined && this.nodeReaches(argument)
      })
    )
  }

  /** The calls, by name, of the function that declares a parameter. */
  #callsOf(definition) {
    const fn = definition.node
    const binding =
      fn.type === `FunctionDeclaration`
        ? fn.id
        : fn.parent.type === `VariableDeclarator`
          ? fn.parent.id
          : undefined
    if (binding?.type !== `Identifier`) return []
    const variable = this.scopeManager
      .getDeclaredVariables(fn.type === `FunctionDeclaration` ? fn : fn.parent)
      .find((declared) => declared.name === binding.name)
    return (variable?.references ?? [])
      .map((reference) => reference.identifier.parent)
      .filter(
        (call) =>
          call.type === `CallExpression` &&
          call.callee.type === `Identifier` &&
          call.callee.name === binding.name,
      )
  }

  #importReaches(source, name) {
    const file = resolveTestModule(this.file, source)
    return file !== undefined && loadModule(file).exportReaches(name)
  }

  /** Whether an export of this module is a declared part, or uses one. */
  exportReaches(name) {
    const entry = this.exported.get(name)
    if (entry?.variable !== undefined)
      return this.variableReaches(entry.variable)
    if (entry !== undefined)
      return this.#importReaches(entry.source, entry.imported)
    return this.starSources.some((source) => this.#importReaches(source, name))
  }

  /**
   * A generated property: `fc.property(...)` or `fc.asyncProperty(...)` from
   * fast-check, or a `.prop([...])` registration. Its predicate states a law
   * over inputs that nobody wrote down, so it is its own check. A property
   * whose arbitraries are all constants checks one written input, so it does
   * not count.
   */
  #isGeneratedProperty(node) {
    if (node.type !== `CallExpression`) return false
    const { callee } = node
    if (callee.type !== `MemberExpression` || callee.computed) return false
    const name = callee.property.name
    if (name !== `property` && name !== `asyncProperty`) return false
    if (!this.#isFastCheck(callee.object)) return false
    const predicate = node.arguments.at(-1)
    return (
      node.arguments.slice(0, -1).some((value) => !isConstant(value)) &&
      (predicate?.type === `Identifier` || this.usesInput(predicate))
    )
  }

  /** A function that reads at least one of its parameters. */
  usesInput(fn) {
    if (!isFunction(fn) && fn?.type !== `FunctionDeclaration`) return false
    return this.scopeManager
      .getDeclaredVariables(fn)
      .some(
        (variable) =>
          variable.defs[0]?.type === `Parameter` &&
          variable.references.length > 0,
      )
  }

  /**
   * Whether a `.prop([...])` registration runs a generated property: some
   * arbitrary is not a constant, and the test reads its input. A named test
   * is checked at its definition, and a test passed in as a parameter at
   * every call of its helper.
   */
  propRegistrationGenerates(registration, body, sourceCode) {
    const prop = calleeCall(registration.callee, `prop`)
    if (prop === undefined) return false
    const [arbitraries] = prop.arguments
    const values =
      arbitraries?.type === `ArrayExpression`
        ? arbitraries.elements
        : arbitraries?.type === `ObjectExpression`
          ? arbitraries.properties.map((property) => property.value)
          : undefined
    // Arbitraries that a caller passes in are not visible here, so only
    // written-out constants disqualify the registration.
    if (values?.every((value) => isConstant(value))) return false
    if (isFunction(body)) return this.usesInput(body)
    const definition = findVariable(sourceCode.getScope(body), body.name)
      ?.defs[0]
    // A named predicate: a function declaration or a const bound to one.
    if (definition?.type === `FunctionName`)
      return this.usesInput(definition.node)
    if (definition?.type === `Variable`)
      return this.usesInput(definition.node.init)
    if (definition?.type !== `Parameter`) return false
    const calls = this.#callsOf(definition)
    return (
      calls.length > 0 &&
      calls.every((call) => {
        const index = definition.node.params.indexOf(definition.name)
        return this.usesInput(call.arguments[index])
      })
    )
  }

  #isFastCheck(node) {
    const definition =
      node.type === `Identifier`
        ? this.resolvedAt.get(node)?.defs[0]
        : undefined
    return (
      definition?.type === `ImportBinding` &&
      fastCheckModules.has(definition.parent.source.value)
    )
  }

  /** Whether code runs a generated property that it contains. */
  containsProperty(node) {
    const [start, end] = node.range
    let low = 0
    let high = this.properties.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.properties[middle] < start) low = middle + 1
      else high = middle
    }
    return low < this.properties.length && this.properties[low] < end
  }

  /** Whether code uses a declared part, directly or through a binding. */
  nodeReaches(node) {
    if (this.containsProperty(node)) return true
    const [start, end] = node.range
    let low = 0
    let high = this.references.length
    while (low < high) {
      const middle = (low + high) >> 1
      if (this.references[middle].identifier.range[0] < start) low = middle + 1
      else high = middle
    }
    for (let index = low; index < this.references.length; index++) {
      const reference = this.references[index]
      if (reference.identifier.range[0] >= end) break
      if (this.variableReaches(reference.resolved)) return true
    }
    return false
  }
}

const fastCheckModules = new Set([`fast-check`, `@fast-check/vitest`])

/** `fc.constant(x)` or `fc.constantFrom(...)`: an arbitrary of written values. */
function isConstant(node) {
  return (
    node?.type === `CallExpression` &&
    node.callee.type === `MemberExpression` &&
    !node.callee.computed &&
    [`constant`, `constantFrom`].includes(node.callee.property.name)
  )
}

function walk(node, visit) {
  visit(node)
  for (const [key, child] of Object.entries(node)) {
    if (key === `parent`) continue
    for (const item of Array.isArray(child) ? child : [child]) {
      if (typeof item?.type === `string`) walk(item, visit)
    }
  }
}

/** The `.<name>(...)` call in a registration's callee chain, if any. */
function calleeCall(callee, name) {
  for (let node = callee; node;) {
    if (
      node.type === `CallExpression` &&
      node.callee.type === `MemberExpression` &&
      !node.callee.computed &&
      node.callee.property.name === name
    ) {
      return node
    }
    node =
      node.type === `CallExpression`
        ? node.callee
        : node.type === `MemberExpression`
          ? node.object
          : undefined
  }
  return undefined
}

function isPlaceholder(body) {
  return (
    isFunction(body) &&
    body.body.type === `BlockStatement` &&
    body.body.body.length === 0
  )
}

export default {
  meta: {
    type: `problem`,
    docs: {
      description: `Report tests in oracle files that reach no declared check or model.`,
    },
    schema: [],
    messages: {
      unitTest: `This test reaches no part that this file declares with declareOracle, so its expected result has no independent source. A unit test belongs in an ordinary test file: move it there. A fixed history runs through the declared check, a model pin uses the declared model, and a grammar calibration uses the declared grammar.`,
      undeclared: `This oracle file registers tests and declares no oracle part. Name its check, model, and grammar with \`declareOracle({ check: [...], model: [...], grammar: [...] })\` from oracle-config. Then move each test that reaches none of them to an ordinary test file.`,
    },
  },
  create(context) {
    // `oracle-config`, `oracle-reach`, and the other `oracle-` modules are the
    // shared oracle machinery. Their tests check that machinery, not a law.
    if (basename(context.filename).startsWith(`oracle-`)) return {}
    const { sourceCode } = context
    const module = new OracleModule(
      context.filename,
      sourceCode.ast,
      sourceCode.scopeManager,
    )
    const unreached = []
    let anyReached = false
    return {
      CallExpression(node) {
        const test = registeredTest(node, sourceCode)
        if (test === undefined || isPlaceholder(test.body)) return
        // An `.each(table)` row is input to the test body, so a row that
        // uses a declared part makes the test use it.
        const table = calleeCall(node.callee, `each`)
        const reaches =
          module.propRegistrationGenerates(node, test.body, sourceCode) ||
          (table?.arguments.some((row) => module.nodeReaches(row)) ?? false) ||
          (test.body.type === `Identifier`
            ? module.variableReaches(
                findVariable(sourceCode.getScope(test.body), test.body.name),
              )
            : module.nodeReaches(test.body))
        if (reaches) anyReached = true
        else unreached.push(node)
      },
      'Program:exit'() {
        // A file that relies on a companion module's declaration declares
        // nothing itself. It is undeclared only when no test reaches a part.
        if (!module.declaresParts && !anyReached) {
          if (unreached.length > 0) {
            context.report({ node: unreached[0], messageId: `undeclared` })
          }
          return
        }
        for (const node of unreached) {
          context.report({ node, messageId: `unitTest` })
        }
      },
    }
  },
}
