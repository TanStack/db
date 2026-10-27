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
 * oracle-declaration:
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
 *
 * An oracle file registers only oracle tests, so it may not call an imported
 * helper that registers tests in a file that is not oracle-named. Such a call
 * gets an importedRegistration report: the author registers those tests from
 * an ordinary test file. A call to an oracle-named helper is not reported,
 * because that module's tests are linted on their own.
 */

const declarationHelper = `declareOracle`

/**
 * Every module that an earlier lint parsed, by path, with the mtime and size
 * it was read at. Parsing is the costly part, so a module is parsed again only
 * when it changes. The reach that a lint computes is never kept between lints,
 * so an edit to any module reaches the next lint: see LintSession.
 */
const parsedModules = new Map()

/**
 * The reach state of one lint run: the modules it loaded, the production
 * package flags it read, and the reach search that resolves bindings.
 */
class LintSession {
  modules = new Map()
  published = new Map()
  search = new ReachSearch()
}

/**
 * Resolves reach through cycles. A binding or export that is still being
 * computed reads as not reaching, which is its least fixed point. A value that
 * consulted such an assumption above its own computation is not kept, since the
 * assumption may not hold: it is computed again on its next read. A reaching
 * value is always kept, because reach only comes from declared parts.
 */
class ReachSearch {
  #frames = []
  #active = new Map()

  solve(cache, key, compute) {
    const known = cache.get(key)
    if (known !== undefined) return known
    if (!this.#active.has(cache)) this.#active.set(cache, new Map())
    const active = this.#active.get(cache)
    const depth = active.get(key)
    if (depth !== undefined) {
      const frame = this.#frames.at(-1)
      frame.low = Math.min(frame.low, depth)
      return false
    }
    const frame = { depth: this.#frames.length, low: Infinity }
    this.#frames.push(frame)
    active.set(key, frame.depth)
    let reaches
    try {
      reaches = compute()
    } finally {
      this.#frames.pop()
      active.delete(key)
    }
    const caller = this.#frames.at(-1)
    if (caller !== undefined) caller.low = Math.min(caller.low, frame.low)
    if (reaches || frame.low >= frame.depth) cache.set(key, reaches)
    return reaches
  }
}

/**
 * Whether a binding that a module imports from `source` reaches a part. A
 * module that cannot be loaded reaches nothing.
 */
function importedModuleReaches(fromFile, source, name, session) {
  const file = resolveTestModule(fromFile, source, session)
  const module = file === undefined ? undefined : loadModule(file, session)
  return module !== undefined && module.exportReaches(name)
}

/** Whether a function that a module imports from `source` registers a test. */
function importedRegisters(fromFile, source, name, session, visiting) {
  const file = resolveTestModule(fromFile, source, session)
  const module = file === undefined ? undefined : loadModule(file, session)
  return module !== undefined && module.registersTests(name, visiting)
}

/**
 * The call that an oracle file makes to an imported helper which registers
 * tests, or undefined. A helper in an oracle-named module is linted on its own.
 */
function importedRegistrationCall(node, file, sourceCode, session) {
  if (node.callee.type !== `Identifier`) return undefined
  const definition = findVariable(sourceCode.getScope(node), node.callee.name)
    ?.defs[0]
  if (
    definition?.type !== `ImportBinding` ||
    definition.node.type !== `ImportSpecifier`
  ) {
    return undefined
  }
  const source = definition.parent.source.value
  const imported =
    definition.node.imported.name ?? definition.node.imported.value
  const module = resolveTestModule(file, source, session)
  if (module === undefined || basename(module).includes(`oracle`))
    return undefined
  const helper = loadModule(module, session)
  return helper?.registersTests(imported) ? node : undefined
}

/** The test module that a relative import names, or undefined. */
function resolveTestModule(fromFile, source, session) {
  if (!source.startsWith(`.`)) return undefined
  const base = resolve(dirname(fromFile), source)
  const stem = base.replace(/\.(m?js|tsx?)$/, ``)
  const file = [`${stem}.ts`, `${stem}.tsx`, `${base}/index.ts`].find(
    (candidate) => existsSync(candidate),
  )
  // Production declares no oracle part, so the rule does not parse it.
  if (file === undefined || isProductionModule(file, session)) return undefined
  return file
}

/**
 * Whether a file is shipped source: under `src/` in a published package. A
 * private package, such as an end-to-end suite, keeps its tests in `src/`.
 */
function isProductionModule(file, session) {
  for (let directory = dirname(file); ; directory = dirname(directory)) {
    const manifest = join(directory, `package.json`)
    if (existsSync(manifest)) {
      if (!session.published.has(directory)) {
        const { private: isPrivate } = JSON.parse(
          readFileSync(manifest, `utf8`),
        )
        session.published.set(directory, isPrivate !== true)
      }
      return (
        session.published.get(directory) &&
        relative(directory, file).split(sep)[0] === `src`
      )
    }
    if (dirname(directory) === directory) return false
  }
}

/** The name of an object property, whether its key is an identifier or a string. */
function propertyName(property) {
  if (property.computed) return stringValue(property.key)
  return property.key.name ?? stringValue(property.key)
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

/**
 * The module that a file names, for this lint. A module that cannot be read or
 * does not parse reaches nothing. Its own lint reports the error.
 */
function loadModule(file, session) {
  if (!session.modules.has(file)) {
    let parsed
    try {
      parsed = parseModule(file)
    } catch {
      parsed = undefined
    }
    const module =
      parsed === undefined
        ? undefined
        : new OracleModule(file, parsed.ast, parsed.scopeManager, session)
    session.modules.set(file, module)
  }
  return session.modules.get(file)
}

/** The parsed AST of a module, reused while its mtime and size are unchanged. */
function parseModule(file) {
  const { mtimeMs, size } = statSync(file)
  const cached = parsedModules.get(file)
  if (cached?.mtimeMs === mtimeMs && cached.size === size) return cached
  const { ast, scopeManager } = parseForESLint(readFileSync(file, `utf8`), {
    filePath: file,
    jsx: file.endsWith(`.tsx`),
    loc: true,
    range: true,
    sourceType: `module`,
  })
  setParents(ast, null)
  const parsed = { mtimeMs, size, ast, scopeManager }
  parsedModules.set(file, parsed)
  return parsed
}

class OracleModule {
  constructor(file, ast, scopeManager, session) {
    this.file = file
    this.scopeManager = scopeManager
    this.session = session
    this.reach = new Map()
    // Reach of a binding seen from another module, which ignores parameters.
    this.exportedReach = new Map()
    // Reach of an exported name, by name.
    this.exportReachCache = new Map()
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
    // Names that `typeModel` lists, with the string literal that names each.
    this.typeModels = new Map()
    this.declared = this.#declaredParts()
    this.#resolveTypeModels(ast)
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
        if (propertyName(property) === `typeModel`) {
          for (const part of parts) {
            const name = stringValue(part)
            if (name !== undefined) this.typeModels.set(name, part)
          }
          continue
        }
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
      // A class declares its name twice: in the module and inside its own
      // scope. The module binding is the one a declaration refers to.
      const moduleScope = this.#moduleScope()
      for (const variable of this.scopeManager.getDeclaredVariables(
        statement.declaration,
      )) {
        if (variable.scope === moduleScope)
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
    return this.declared.size > 0 || this.typeModels.size > 0
  }

  /**
   * A type model is a type alias or interface in this module's scope, which
   * a type-level test uses as its expected type. Record where each is used,
   * and the names that name no such type.
   */
  #resolveTypeModels(ast) {
    this.typeModelUses = []
    this.unknownTypeModels = []
    if (this.typeModels.size === 0) return
    const defined = new Map()
    for (const statement of ast.body) {
      const declaration =
        statement.type === `ExportNamedDeclaration`
          ? statement.declaration
          : statement
      if (
        declaration?.type === `TSTypeAliasDeclaration` ||
        declaration?.type === `TSInterfaceDeclaration`
      ) {
        defined.set(declaration.id.name, declaration)
      }
    }
    for (const [name, literal] of this.typeModels) {
      if (!defined.has(name)) this.unknownTypeModels.push(literal)
    }
    // A type built from a model, such as `PublishedValueFor<Variant>` under
    // another name, predicts what the model predicts.
    const models = new Set(
      [...this.typeModels.keys()].filter((name) => defined.has(name)),
    )
    const namesModel = (node) => {
      let found = false
      walk(node, (child) => {
        if (
          child.type === `TSTypeReference` &&
          child.typeName.type === `Identifier` &&
          models.has(child.typeName.name)
        ) {
          found = true
        }
      })
      return found
    }
    for (let grew = true; grew;) {
      grew = false
      for (const [name, declaration] of defined) {
        if (!models.has(name) && namesModel(declaration)) {
          models.add(name)
          grew = true
        }
      }
    }
    walk(ast, (node) => {
      if (
        node.type === `TSTypeReference` &&
        node.typeName.type === `Identifier` &&
        models.has(node.typeName.name)
      ) {
        this.typeModelUses.push(node.range[0])
      }
    })
    this.typeModelUses.sort((a, b) => a - b)
  }

  /**
   * Whether a binding is a declared part, or uses one. Seen from another
   * module (`local` false), a parameter reaches nothing: the importer passes
   * its own arguments, so this module's call sites say nothing about it.
   */
  variableReaches(variable, local = true) {
    if (variable === undefined) return false
    if (this.declared.has(variable)) return true
    return this.session.search.solve(
      local ? this.reach : this.exportedReach,
      variable,
      () =>
        variable.defs.some((definition) =>
          this.#definitionReaches(definition, local),
        ) ||
        (local && this.#fedByReachingValue(variable, local)),
    )
  }

  /**
   * A collection that code fills with values from a declared part, such as a
   * coverage Set that grammar-driven tests add the model's predictions to,
   * carries those values. A test that reads it uses the part.
   */
  #fedByReachingValue(variable, local) {
    return variable.references.some((reference) => {
      const member = reference.identifier.parent
      const call = member?.parent
      return (
        member?.type === `MemberExpression` &&
        member.object === reference.identifier &&
        !member.computed &&
        accumulatorMethods.has(member.property.name) &&
        call?.type === `CallExpression` &&
        call.callee === member &&
        call.arguments.some((argument) => this.nodeReaches(argument, local))
      )
    })
  }

  #definitionReaches(definition, local) {
    switch (definition.type) {
      case `ImportBinding`: {
        if (definition.node.type !== `ImportSpecifier`) return false
        const imported =
          definition.node.imported.name ?? definition.node.imported.value
        return this.#importReaches(definition.parent.source.value, imported)
      }
      case `FunctionName`:
      case `ClassName`:
        return this.nodeReaches(definition.node, local)
      case `Variable`:
        return (
          definition.node.init !== null &&
          this.nodeReaches(definition.node.init, local)
        )
      case `Parameter`:
        return local && this.#parameterReaches(definition)
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
    return importedModuleReaches(this.file, source, name, this.session)
  }

  /** Whether an export of this module is a declared part, or uses one. */
  exportReaches(name) {
    return this.session.search.solve(this.exportReachCache, name, () => {
      const entry = this.exported.get(name)
      if (entry?.variable !== undefined)
        return this.variableReaches(entry.variable, false)
      if (entry !== undefined)
        return this.#importReaches(entry.source, entry.imported)
      return this.starSources.some((source) =>
        this.#importReaches(source, name),
      )
    })
  }

  /**
   * Whether an export of this module is a function that registers a test. A
   * function registers a test when its body contains a registration, including
   * inside a function it declares. A cycle of re-exports registers nothing.
   */
  registersTests(name, visiting = new Set()) {
    const key = `${this.file}\0${name}`
    if (visiting.has(key)) return false
    visiting.add(key)
    const entry = this.exported.get(name)
    if (entry?.variable !== undefined) {
      const definition = entry.variable.defs[0]
      const fn =
        definition?.type === `FunctionName`
          ? definition.node
          : definition?.type === `Variable` && isFunction(definition.node.init)
            ? definition.node.init
            : undefined
      return fn !== undefined && this.#bodyRegisters(fn)
    }
    if (entry !== undefined) {
      return importedRegisters(
        this.file,
        entry.source,
        entry.imported,
        this.session,
        visiting,
      )
    }
    return this.starSources.some((source) =>
      importedRegisters(this.file, source, name, this.session, visiting),
    )
  }

  #bodyRegisters(fn) {
    const sourceCode = { getScope: (node) => this.scopeOf(node) }
    let found = false
    walk(fn, (node) => {
      if (
        !found &&
        node.type === `CallExpression` &&
        registeredTest(node, sourceCode) !== undefined
      ) {
        found = true
      }
    })
    return found
  }

  /** The innermost scope of a node, as ESLint's `getScope` finds it. */
  scopeOf(node) {
    for (let current = node; current; current = current.parent) {
      const scope = this.scopeManager.acquire(current, true)
      if (scope) return scope
    }
    return this.scopeManager.globalScope
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
      this.#predicateUsesInput(predicate)
    )
  }

  /**
   * Whether a property's predicate reads its input. A named predicate is read
   * at its definition. One passed in as a parameter cannot be seen here, so
   * it counts.
   */
  #predicateUsesInput(predicate) {
    if (predicate?.type !== `Identifier`) return this.usesInput(predicate)
    const definition = this.resolvedAt.get(predicate)?.defs[0]
    if (definition?.type === `FunctionName`)
      return this.usesInput(definition.node)
    if (definition?.type === `Variable`)
      return this.usesInput(definition.node.init)
    return true
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
    return containsOffset(this.properties, node)
  }

  /** Whether code uses a declared part, directly or through a binding. */
  nodeReaches(node, local = true) {
    if (this.containsProperty(node)) return true
    // A type-level test reaches a type model by naming it in a type.
    if (containsOffset(this.typeModelUses, node)) return true
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
      if (this.variableReaches(reference.resolved, local)) return true
    }
    return false
  }
}

const fastCheckModules = new Set([`fast-check`, `@fast-check/vitest`])

// Methods that put a value into a collection.
const accumulatorMethods = new Set([`add`, `set`, `push`, `unshift`])

/** `fc.constant(x)` or `fc.constantFrom(...)`: an arbitrary of written values. */
function isConstant(node) {
  return (
    node?.type === `CallExpression` &&
    node.callee.type === `MemberExpression` &&
    !node.callee.computed &&
    [`constant`, `constantFrom`].includes(node.callee.property.name)
  )
}

/** The value of a string literal or of a template with no substitutions. */
function stringValue(node) {
  if (node?.type === `Literal` && typeof node.value === `string`)
    return node.value
  if (node?.type === `TemplateLiteral` && node.expressions.length === 0)
    return node.quasis[0].value.cooked
  return undefined
}

/** Whether a sorted list of start offsets has one inside a node. */
function containsOffset(offsets, node) {
  const [start, end] = node.range
  let low = 0
  let high = offsets.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (offsets[middle] < start) low = middle + 1
    else high = middle
  }
  return low < offsets.length && offsets[low] < end
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

/** Whether a function written in an `.each(...)` table uses a declared part. */
function tableFunctionReaches(module, table) {
  let reaches = false
  for (const row of table.arguments) {
    walk(row, (node) => {
      if (!reaches && isFunction(node) && module.nodeReaches(node)) {
        reaches = true
      }
    })
  }
  return reaches
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
      unknownTypeModel: `This typeModel name is not a type alias or interface in this file. A type model is the expected type that type-level tests compare with, so it must be declared here.`,
      importedRegistration: `This oracle file calls a helper that registers tests. An oracle file registers only oracle tests, so register those tests from an ordinary test file and keep this file to its checks and model.`,
      undeclared: `This oracle file registers tests and declares no oracle part. Name its check, model, and grammar with \`declareOracle({ check: [...], model: [...], grammar: [...] })\` from oracle-declaration. Then move each test that reaches none of them to an ordinary test file.`,
    },
  },
  create(context) {
    // `oracle-config`, `oracle-reach`, and the other `oracle-` modules are the
    // shared oracle machinery. Their tests check that machinery, not a law.
    if (basename(context.filename).startsWith(`oracle-`)) return {}
    const { sourceCode } = context
    const session = new LintSession()
    const module = new OracleModule(
      context.filename,
      sourceCode.ast,
      sourceCode.scopeManager,
      session,
    )
    const unreached = []
    let anyReached = false
    return {
      CallExpression(node) {
        if (
          importedRegistrationCall(node, context.filename, sourceCode, session)
        ) {
          context.report({ node, messageId: `importedRegistration` })
        }
        const test = registeredTest(node, sourceCode)
        if (test === undefined || isPlaceholder(test.body)) return
        // An `.each(table)` row can carry a function that the test body calls,
        // such as a hostile observation each check must reject. A function in
        // the table that uses a declared part makes the test use it. Plain
        // data, such as the grammar's cells, does not: the body must use them.
        const table =
          calleeCall(node.callee, `each`) ?? calleeCall(node.callee, `for`)
        const reaches =
          module.propRegistrationGenerates(node, test.body, sourceCode) ||
          (table !== undefined && tableFunctionReaches(module, table)) ||
          (test.body.type === `Identifier`
            ? module.variableReaches(
                findVariable(sourceCode.getScope(test.body), test.body.name),
              )
            : module.nodeReaches(test.body))
        if (reaches) anyReached = true
        else unreached.push(node)
      },
      'Program:exit'() {
        for (const node of module.unknownTypeModels) {
          context.report({ node, messageId: `unknownTypeModel` })
        }
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
