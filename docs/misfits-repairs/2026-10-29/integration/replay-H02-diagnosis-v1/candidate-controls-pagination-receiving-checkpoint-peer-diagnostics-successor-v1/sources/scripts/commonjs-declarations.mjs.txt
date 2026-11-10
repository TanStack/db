import ts from 'typescript'

// @tanstack/vite-config adds extensions to extensionless declaration imports,
// but leaves explicit .js specifiers unchanged in its .d.cts output. Use its
// pre-write hook to fix only module specifiers; string-literal types and
// package imports must keep their meaning. The hook runs before .d.ts renaming.
/**
 * @param {string} filePath
 * @param {string} content
 * @returns {string}
 */
export function commonJsDeclarations(filePath, content) {
  if (!/[/\\]dist[/\\]cjs[/\\]/.test(filePath)) return content

  const source = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
  )
  const result = ts.transform(source, [
    (context) => {
      /** @type {ts.Visitor} */
      const visit = (node) => {
        if (
          ts.isStringLiteral(node) &&
          /^\.\.?\/.+\.js$/.test(node.text) &&
          (ts.isImportDeclaration(node.parent) ||
            ts.isExportDeclaration(node.parent) ||
            ts.isExternalModuleReference(node.parent) ||
            ts.isModuleDeclaration(node.parent) ||
            (ts.isLiteralTypeNode(node.parent) &&
              ts.isImportTypeNode(node.parent.parent) &&
              node.parent.parent.argument === node.parent))
        ) {
          return ts.factory.createStringLiteral(`${node.text.slice(0, -3)}.cjs`)
        }
        return ts.visitEachChild(node, visit, context)
      }
      return (file) => ts.visitEachChild(file, visit, context)
    },
  ])
  try {
    return ts
      .createPrinter()
      .printFile(/** @type {ts.SourceFile} */ (result.transformed[0]))
  } finally {
    result.dispose()
  }
}
