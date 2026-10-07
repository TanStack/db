/**
 * Finds every `Error`, `TypeError`, and `RangeError` that `src` constructs with
 * library text, outside the error classes in `src/errors.ts`. The production
 * error message oracle uses it to check that each such site is coded.
 *
 * A site has library text when its message expression contains a string or
 * template literal. A message built only from a caller's value, such as
 * `new Error(String(error))`, is the caller's text and is not a site.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/** A site whose message is `devBuild() && NODE_ENV !== 'production' ? dev : coded`. */
export type CodedSite = {
  file: string
  code: number
  /** Source text of the development message expression. */
  development: string
  /** Template-span expressions in the development message. */
  interpolations: Array<string>
  /** Value expressions passed to `codedMessage`. */
  values: Array<string>
}

/** A site that still builds library text in every build. */
export type PlainSite = {
  file: string
  line: number
  /** Source text of the message expression. */
  message: string
}

const errorConstructors = new Set([`Error`, `TypeError`, `RangeError`])
const guard = `devBuild() && process.env.NODE_ENV !== \`production\``

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

function interpolations(node: ts.Node, sourceFile: ts.SourceFile) {
  const spans: Array<string> = []
  const visit = (child: ts.Node) => {
    if (ts.isTemplateSpan(child))
      spans.push(child.expression.getText(sourceFile))
    ts.forEachChild(child, visit)
  }
  visit(node)
  return spans
}

/** Every error site under `sourceRoot`, coded or plain. */
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
    const visit = (node: ts.Node) => {
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        errorConstructors.has(node.expression.text) &&
        node.arguments?.[0]
      ) {
        const message = node.arguments[0]
        if (
          ts.isConditionalExpression(message) &&
          message.condition.getText(sourceFile) === guard &&
          ts.isCallExpression(message.whenFalse) &&
          message.whenFalse.expression.getText(sourceFile) === `codedMessage`
        ) {
          const [code, values] = message.whenFalse.arguments
          coded.push({
            file,
            code: Number(code!.getText(sourceFile)),
            development: message.whenTrue.getText(sourceFile),
            interpolations: interpolations(message.whenTrue, sourceFile),
            values:
              values && ts.isObjectLiteralExpression(values)
                ? values.properties.map((property) =>
                    ts.isShorthandPropertyAssignment(property)
                      ? property.name.text
                      : ts.isPropertyAssignment(property)
                        ? property.initializer.getText(sourceFile)
                        : property.getText(sourceFile),
                  )
                : [],
          })
        } else if (hasLibraryText(message)) {
          plain.push({
            file,
            line:
              sourceFile.getLineAndCharacterOfPosition(message.getStart())
                .line + 1,
            message: message.getText(sourceFile),
          })
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
  return { coded, plain }
}
