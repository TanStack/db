/**
 * Finds every error message that `src` builds from library text outside the
 * error classes in `src/errors.ts`. The production error message oracle uses
 * it to check that each such message is coded.
 *
 * - A **coded site** is any `devBuild() && NODE_ENV !== 'production' ? dev :
 *   codedMessage(code, values)` expression, wherever the message goes, except
 *   an error class's `super(...)` message.
 * - A **plain site** is an `Error`, `TypeError`, or `RangeError` message, or an
 *   `AggregateError` message, with or without `new`, a message passed to an
 *   error class whose caller writes the message, such as
 *   `CollectionStateError`, or a `super(...)` message in an error class
 *   outside `errors.ts`, that contains a string or template literal with
 *   a letter and is not coded. A message built only from a caller's value, such as
 *   `new Error(String(error))`, is the caller's text and is not a site.
 *
 * Values are typed with the TypeScript checker. A value is **showable** when
 * `codedMessage` can print it: a primitive, `null`, `undefined`, an array of
 * showable values, an `Error`, or a type the checker cannot narrow (`any`, `unknown`). Plain
 * objects are not shown in production, by maintainer decision (2026-10-07).
 *
 * Messages are compared as templates: literal text with each interpolated
 * expression written `${...}` in a canonical token form. Reformatting the
 * source does not change a template; changing its text, a literal inside an
 * interpolation, or an interpolated expression does.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import ts from 'typescript'

export type CodedSite = {
  file: string
  code: number
  /** The development message as a template. */
  template: string
  /** Its literal text pieces, outside interpolations. */
  literals: Array<string>
  /**
   * For each interpolation, its expression and every sub-expression, without
   * whitespace. A value passed to `codedMessage` covers the interpolation when
   * it is one of these.
   */
  interpolations: Array<{
    expression: string
    parts: Array<string>
    /**
     * True when a data reference inside it, an identifier or property access
     * outside any callee, is showable. `JSON.stringify(row)` only formats a
     * plain object, so it is not; `materialized.id` and `typeof value` are.
     * A projection of an object, such as `Object.keys(handlers)`, does not
     * make the interpolation required; a site may still pass it.
     */
    showable: boolean
  }>
  /**
   * Value expressions passed to `codedMessage`, in canonical form, with their
   * sub-expressions.
   */
  values: Array<{ expression: string; parts: Array<string>; showable: boolean }>
}

/** A coded `super(...)` message in an error class outside `errors.ts`. */
export type ClassGuard = { file: string; name: string; code: number }

export type PlainSite = {
  file: string
  line: number
  template: string
  literals: Array<string>
}

/** Constructor name to the position of its message argument. */
const messagePosition = new Map([
  [`Error`, 0],
  [`TypeError`, 0],
  [`RangeError`, 0],
  [`AggregateError`, 1],
])
const guard = `devBuild() && process.env.NODE_ENV !== \`production\``

const wordLike = /^[\w$]/
const closing = new Set([`)`, `]`, `}`])
const spaced = new Set([`&&`, `||`, `??`, `!==`, `===`, `?`, `:`, `+`, `-`])

/**
 * An expression's tokens in a fixed layout: literals keep their exact text,
 * binary operators get single spaces, trailing commas and all other
 * whitespace go away.
 */
function compact(node: ts.Node, sourceFile: ts.SourceFile): string {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.Standard,
    node.getText(sourceFile),
  )
  const tokens: Array<string> = []
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken)
    tokens.push(scanner.getTokenText())
  let text = ``
  tokens.forEach((token, index) => {
    if (token === `,` && closing.has(tokens[index + 1] ?? ``)) return
    const previous = text.at(-1) ?? ``
    if (spaced.has(token) || spaced.has(tokens[index - 1] ?? ``))
      text += text ? ` ` : ``
    else if (wordLike.test(token) && /[\w$]/.test(previous)) text += ` `
    text += token
  })
  return text.replace(/ +/g, ` `)
}

function sourceFiles(directory: string): Array<string> {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return path.endsWith(`.ts`) && !path.endsWith(`.d.ts`) ? [path] : []
  })
}

/** Literal text with a letter; `${a}: ${b}` only joins other text. */
function hasLibraryText(node: ts.Node): boolean {
  const letters = (text: string) => /[A-Za-z]/.test(text)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return letters(node.text)
  if (
    ts.isTemplateExpression(node) &&
    [node.head, ...node.templateSpans.map((span) => span.literal)].some(
      (part) => letters(part.text),
    )
  )
    return true
  return ts.forEachChild(node, hasLibraryText) ?? false
}

/** A message expression as literal text with `${expression}` holes. */
export function messageTemplate(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
): string {
  if (ts.isParenthesizedExpression(node))
    return messageTemplate(node.expression, sourceFile)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return node.text
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map(
          (span) =>
            `\${${compact(span.expression, sourceFile)}}${span.literal.text}`,
        )
        .join(``)
    )
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return (
      messageTemplate(node.left, sourceFile) +
      messageTemplate(node.right, sourceFile)
    )
  if (ts.isConditionalExpression(node))
    return `\${${compact(node.condition, sourceFile)} ? ${messageTemplate(node.whenTrue, sourceFile)} : ${messageTemplate(node.whenFalse, sourceFile)}}`
  return `\${${compact(node, sourceFile)}}`
}

/** Whether `codedMessage` prints every value of this type. */
function isShowable(type: ts.Type, checker: ts.TypeChecker, error: ts.Type) {
  const visit = (current: ts.Type): boolean => {
    // Read before the type guards below narrow `current`.
    const flags = current.flags
    const symbol = current.getSymbol()
    if (current.isUnion()) return current.types.every(visit)
    if (current.isTypeParameter()) {
      const constraint = checker.getBaseConstraintOfType(current)
      return !constraint || constraint === current || visit(constraint)
    }
    if (
      flags &
      (ts.TypeFlags.Any |
        ts.TypeFlags.Unknown |
        ts.TypeFlags.StringLike |
        ts.TypeFlags.NumberLike |
        ts.TypeFlags.BooleanLike |
        ts.TypeFlags.BigIntLike |
        ts.TypeFlags.ESSymbolLike |
        ts.TypeFlags.EnumLike |
        ts.TypeFlags.Null |
        ts.TypeFlags.Undefined |
        ts.TypeFlags.Void |
        ts.TypeFlags.Never)
    )
      return true
    if (checker.isArrayType(current) || checker.isTupleType(current))
      return checker.getTypeArguments(current as ts.TypeReference).every(visit)
    // `codedMessage` shows an `Error` by `instanceof`, so a type must be the
    // global Error or a class, not an object shaped like one.
    return (
      checker.isTypeAssignableTo(current, error) &&
      (current === error ||
        (symbol?.getDeclarations() ?? []).some(ts.isClassLike))
    )
  }
  return visit(type)
}

/**
 * The literal text pieces of a message, outside its interpolations. The bundle
 * check searches builds for them; code inside `${...}` is not message text.
 */
export function messageLiterals(node: ts.Expression): Array<string> {
  if (ts.isParenthesizedExpression(node))
    return messageLiterals(node.expression)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return [node.text]
  if (ts.isTemplateExpression(node))
    return [
      node.head.text,
      ...node.templateSpans.map((span) => span.literal.text),
    ]
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return [...messageLiterals(node.left), ...messageLiterals(node.right)]
  if (ts.isConditionalExpression(node))
    return [
      ...messageLiterals(node.whenTrue),
      ...messageLiterals(node.whenFalse),
    ]
  return []
}

/** Expressions a message interpolates, with their sub-expressions. */
/** An expression and every sub-expression, excluding property names. */
function parts(expression: ts.Node): Array<ts.Node> {
  const all = [expression]
  ts.forEachChild(expression, (child) => {
    // A property name is not a value: `materialized.id` does not pass `id`.
    if (ts.isPropertyAccessExpression(expression) && child === expression.name)
      return
    if (ts.isExpression(child)) all.push(...parts(child))
  })
  return all
}

/**
 * The expressions a message interpolates: template spans, the non-literal
 * operands of `+`, and a message-level conditional's condition.
 */
function holes(node: ts.Expression): Array<ts.Expression> {
  if (ts.isParenthesizedExpression(node)) return holes(node.expression)
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return []
  if (ts.isTemplateExpression(node))
    return node.templateSpans.map((span) => span.expression)
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  )
    return [...holes(node.left), ...holes(node.right)]
  if (ts.isConditionalExpression(node))
    return [node.condition, ...holes(node.whenTrue), ...holes(node.whenFalse)]
  return [node]
}

function interpolations(
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  showable: (node: ts.Node) => boolean,
) {
  const references = (expression: ts.Node): Array<ts.Node> => {
    const refs: Array<ts.Node> = []
    const walk = (current: ts.Node) => {
      if (
        (ts.isIdentifier(current) &&
          !ts.isPropertyAccessExpression(current.parent)) ||
        ts.isPropertyAccessExpression(current) ||
        ts.isElementAccessExpression(current) ||
        ts.isTypeOfExpression(current)
      )
        refs.push(current)
      ts.forEachChild(current, (child) => {
        if (ts.isCallExpression(current) && child === current.expression) return
        if (ts.isPropertyAccessExpression(current) && child === current.name)
          return
        walk(child)
      })
    }
    walk(expression)
    return refs
  }
  return holes(node).map((hole) => ({
    expression: compact(hole, sourceFile),
    parts: parts(hole).map((part) => compact(part, sourceFile)),
    showable: references(hole).some(showable),
  }))
}

function codedValues(
  values: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  showable: (node: ts.Node) => boolean,
): CodedSite[`values`] {
  if (!values || !ts.isObjectLiteralExpression(values)) return []
  return values.properties.map((property) => {
    const value = ts.isShorthandPropertyAssignment(property)
      ? property.name
      : ts.isPropertyAssignment(property)
        ? property.initializer
        : property
    return {
      expression: compact(value, sourceFile),
      parts: parts(value).map((part) => compact(part, sourceFile)),
      showable: showable(value),
    }
  })
}

/** Every coded and plain error site under `sourceRoot`. */
export function findErrorSites(
  sourceRoot: string,
  /** Error classes whose message the caller writes; their text is a site. */
  callerMessageClasses: Iterable<string> = [],
): {
  coded: Array<CodedSite>
  plain: Array<PlainSite>
  classGuards: Array<ClassGuard>
} {
  const coded: Array<CodedSite> = []
  const plain: Array<PlainSite> = []
  const classGuards: Array<ClassGuard> = []
  const callerMessage = new Set(callerMessageClasses)
  const configPath = join(dirname(sourceRoot), `tsconfig.json`)
  const config = ts.parseJsonConfigFileContent(
    ts.readConfigFile(configPath, (path) => readFileSync(path, `utf8`)).config,
    ts.sys,
    dirname(configPath),
  )
  const paths = sourceFiles(sourceRoot).sort()
  const program = ts.createProgram(paths, config.options)
  const checker = program.getTypeChecker()
  const error = checker.getDeclaredTypeOfSymbol(
    checker.resolveName(`Error`, undefined, ts.SymbolFlags.Type, false)!,
  )
  const showable = (node: ts.Node) =>
    isShowable(checker.getTypeAtLocation(node), checker, error)
  for (const path of paths) {
    const file = relative(sourceRoot, path)
    if (file === `errors.ts`) continue
    const sourceFile = program.getSourceFile(path)!
    // A guard passed to `super(...)` is an error class's message; the class
    // oracle owns it.
    const isClassMessage = (node: ts.Node) =>
      ts.isCallExpression(node.parent) &&
      node.parent.expression.kind === ts.SyntaxKind.SuperKeyword
    const isCoded = (node: ts.Node): node is ts.ConditionalExpression =>
      ts.isConditionalExpression(node) &&
      compact(node.condition, sourceFile) === guard &&
      ts.isCallExpression(node.whenFalse) &&
      node.whenFalse.expression.getText(sourceFile) === `codedMessage`
    const visit = (node: ts.Node) => {
      if (isCoded(node) && isClassMessage(node)) {
        const owner = ts.findAncestor(node, ts.isClassLike)
        classGuards.push({
          file,
          name: owner?.name?.text ?? `(anonymous)`,
          code: Number(
            (node.whenFalse as ts.CallExpression).arguments[0]!.getText(
              sourceFile,
            ),
          ),
        })
      } else if (isCoded(node)) {
        const call = node.whenFalse as ts.CallExpression
        coded.push({
          file,
          code: Number(call.arguments[0]!.getText(sourceFile)),
          template: messageTemplate(node.whenTrue, sourceFile),
          literals: messageLiterals(node.whenTrue),
          interpolations: interpolations(node.whenTrue, sourceFile, showable),
          values: codedValues(call.arguments[1], sourceFile, showable),
        })
      } else if (
        (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
        ts.isIdentifier(node.expression) &&
        (messagePosition.has(node.expression.text) ||
          callerMessage.has(node.expression.text))
      ) {
        const message =
          node.arguments?.[messagePosition.get(node.expression.text) ?? 0]
        if (message && !isCoded(message) && hasLibraryText(message))
          plain.push({
            file,
            line:
              sourceFile.getLineAndCharacterOfPosition(message.getStart())
                .line + 1,
            template: messageTemplate(message, sourceFile),
            literals: messageLiterals(message),
          })
      }
      // An error class outside errors.ts that passes library text to super.
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.SuperKeyword &&
        node.arguments[0] &&
        !isCoded(node.arguments[0]) &&
        hasLibraryText(node.arguments[0]) &&
        ts
          .findAncestor(node, ts.isClassLike)
          ?.heritageClauses?.some((clause) =>
            clause.types.some((type) =>
              /Error$/.test(type.expression.getText(sourceFile)),
            ),
          )
      )
        plain.push({
          file,
          line:
            sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1,
          template: messageTemplate(node.arguments[0], sourceFile),
          literals: messageLiterals(node.arguments[0]),
        })
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return { coded, plain, classGuards }
}
