/**
 * Finds every error message that `src` builds from library text outside the
 * error classes in `src/errors.ts`. The production error message oracle uses
 * it to check that each such message is coded.
 *
 * - A **coded site** is any `devBuild() && NODE_ENV !== 'production' ? dev :
 *   codedMessage(code, values)` expression, wherever the message goes.
 * - A **plain site** is an `Error`, `TypeError`, or `RangeError` message, or an
 *   `AggregateError` message, that contains a string or template literal and
 *   is not coded. A message built only from a caller's value, such as
 *   `new Error(String(error))`, is the caller's text and is not a site.
 *
 * Messages are compared as templates: literal text with each interpolated
 * expression written `${...}` in a canonical token form. Reformatting the
 * source does not change a template; changing its text, a literal inside an
 * interpolation, or an interpolated expression does.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

export type CodedSite = {
  file: string
  code: number
  /** The development message as a template. */
  template: string
  /**
   * For each interpolation, its expression and every sub-expression, without
   * whitespace. A value passed to `codedMessage` covers the interpolation when
   * it is one of these.
   */
  interpolations: Array<{ expression: string; parts: Array<string> }>
  /** Value expressions passed to `codedMessage`, without whitespace. */
  values: Array<string>
}

export type PlainSite = {
  file: string
  line: number
  template: string
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

function hasLibraryText(node: ts.Node): boolean {
  if (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
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

/** Expressions a message interpolates, with their sub-expressions. */
function interpolations(node: ts.Expression, sourceFile: ts.SourceFile) {
  const found: CodedSite[`interpolations`] = []
  const parts = (expression: ts.Node): Array<string> => {
    const all = [compact(expression, sourceFile)]
    ts.forEachChild(expression, (child) => {
      // A property name is not a value: `materialized.id` does not pass `id`.
      if (ts.isPropertyAccessExpression(expression) && child === expression.name)
        return
      if (ts.isExpression(child)) all.push(...parts(child))
    })
    return all
  }
  const visit = (child: ts.Node) => {
    if (ts.isTemplateSpan(child))
      found.push({
        expression: compact(child.expression, sourceFile),
        parts: parts(child.expression),
      })
    ts.forEachChild(child, visit)
  }
  visit(node)
  return found
}

function codedValues(
  values: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): Array<string> {
  if (!values || !ts.isObjectLiteralExpression(values)) return []
  return values.properties.map((property) =>
    ts.isShorthandPropertyAssignment(property)
      ? property.name.text
      : ts.isPropertyAssignment(property)
        ? compact(property.initializer, sourceFile)
        : compact(property, sourceFile),
  )
}

/** Every coded and plain error site under `sourceRoot`. */
export function findErrorSites(sourceRoot: string): {
  coded: Array<CodedSite>
  plain: Array<PlainSite>
} {
  const coded: Array<CodedSite> = []
  const plain: Array<PlainSite> = []
  for (const path of sourceFiles(sourceRoot).sort()) {
    const file = relative(sourceRoot, path)
    if (file === `errors.ts`) continue
    const sourceFile = ts.createSourceFile(
      path,
      readFileSync(path, `utf8`),
      ts.ScriptTarget.Latest,
      true,
    )
    const isCoded = (node: ts.Node): node is ts.ConditionalExpression =>
      ts.isConditionalExpression(node) &&
      compact(node.condition, sourceFile) === guard &&
      ts.isCallExpression(node.whenFalse) &&
      node.whenFalse.expression.getText(sourceFile) === `codedMessage`
    const visit = (node: ts.Node) => {
      if (isCoded(node)) {
        const call = node.whenFalse as ts.CallExpression
        coded.push({
          file,
          code: Number(call.arguments[0]!.getText(sourceFile)),
          template: messageTemplate(node.whenTrue, sourceFile),
          interpolations: interpolations(node.whenTrue, sourceFile),
          values: codedValues(call.arguments[1], sourceFile),
        })
      } else if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        messagePosition.has(node.expression.text)
      ) {
        const message =
          node.arguments?.[messagePosition.get(node.expression.text)!]
        if (message && !isCoded(message) && hasLibraryText(message))
          plain.push({
            file,
            line:
              sourceFile.getLineAndCharacterOfPosition(message.getStart())
                .line + 1,
            template: messageTemplate(message, sourceFile),
          })
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return { coded, plain }
}
