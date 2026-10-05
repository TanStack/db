const DEFAULT_IMPORT_PATTERNS = ['^@/db/collections/']
const DEFAULT_MUTATION_METHODS = ['insert', 'update', 'delete', 'upsert']

function unwrapExpression(node) {
  let current = node

  while (current) {
    if (
      current.type === 'TSAsExpression' ||
      current.type === 'TSTypeAssertion' ||
      current.type === 'TSNonNullExpression' ||
      current.type === 'ChainExpression' ||
      current.type === 'ParenthesizedExpression'
    ) {
      current = current.expression
      continue
    }

    return current
  }

  return current
}

function getPropertyName(memberExpression) {
  const property = memberExpression.property
  const name = memberExpression.computed ? property.value : property.name
  return typeof name === 'string' ? name : null
}

function getRootIdentifier(node) {
  let current = unwrapExpression(node)
  while (current?.type === 'MemberExpression') {
    current = unwrapExpression(current.object)
  }
  return current?.type === 'Identifier' ? current : null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow direct TanStack DB collection mutations in feature modules',
    },
    schema: [
      {
        type: 'object',
        additionalProperties: false,
        properties: {
          collectionImportPatterns: {
            type: 'array',
            items: {
              type: 'string',
            },
            minItems: 1,
          },
          mutationMethods: {
            type: 'array',
            items: {
              type: 'string',
            },
            minItems: 1,
          },
        },
      },
    ],
    messages: {
      noDirectMutation:
        "Direct collection mutation '{{method}}' on '{{collection}}' is not allowed in feature code.",
    },
  },
  create(context) {
    const options = context.options[0] ?? {}
    const configuredImportPatterns =
      options.collectionImportPatterns ?? DEFAULT_IMPORT_PATTERNS
    const importPatterns = configuredImportPatterns.map(
      (pattern) => new RegExp(pattern),
    )
    const mutationMethods = new Set(
      options.mutationMethods ?? DEFAULT_MUTATION_METHODS,
    )
    const sourceCode = context.sourceCode
    const calls = []

    function resolveVariable(expression) {
      const identifier = getRootIdentifier(expression)
      if (!identifier) return null
      for (
        let scope = sourceCode.getScope(identifier);
        scope;
        scope = scope.upper
      ) {
        const variable = scope.set.get(identifier.name)
        if (variable) return variable
      }
      return null
    }

    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee)
        if (
          callee?.type === 'MemberExpression' &&
          mutationMethods.has(getPropertyName(callee))
        ) {
          calls.push(callee)
        }
      },
      'Program:exit'() {
        const collections = new Set()
        const aliases = new Map()
        for (const scope of sourceCode.scopeManager.scopes) {
          for (const variable of scope.variables) {
            if (
              variable.defs.some(
                ({ type, parent }) =>
                  type === 'ImportBinding' &&
                  importPatterns.some((pattern) =>
                    pattern.test(parent.source.value),
                  ),
              )
            ) {
              collections.add(variable)
            }
            // ESLint supplies write expressions for both simple and destructured
            // bindings. Edges use lexical variables, never their spelling.
            for (const reference of variable.references) {
              const source = resolveVariable(reference.writeExpr)
              if (!source) continue
              if (!aliases.has(source)) aliases.set(source, new Set())
              aliases.get(source).add(variable)
            }
          }
        }

        // Resolve the full graph before reporting. Each binding is visited once,
        // including cycles and aliases assigned inside later function bodies.
        const pending = [...collections]
        for (const source of pending) {
          for (const alias of aliases.get(source) ?? []) {
            if (collections.has(alias)) continue
            collections.add(alias)
            pending.push(alias)
          }
        }
        for (const callee of calls) {
          const variable = resolveVariable(callee.object)
          if (collections.has(variable)) {
            context.report({
              node: callee.property,
              messageId: 'noDirectMutation',
              data: {
                method: getPropertyName(callee),
                collection: variable.name,
              },
            })
          }
        }
      },
    }
  },
}
