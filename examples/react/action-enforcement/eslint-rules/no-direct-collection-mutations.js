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
  if (
    !memberExpression.computed &&
    memberExpression.property.type === 'Identifier'
  ) {
    return memberExpression.property.name
  }

  if (
    memberExpression.computed &&
    memberExpression.property.type === 'Literal' &&
    typeof memberExpression.property.value === 'string'
  ) {
    return memberExpression.property.value
  }

  return null
}

function getRootIdentifierName(node) {
  const expression = unwrapExpression(node)

  if (!expression) {
    return null
  }

  if (expression.type === 'Identifier') {
    return expression.name
  }

  if (expression.type === 'MemberExpression') {
    return getRootIdentifierName(expression.object)
  }

  return null
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
    const trackedCollectionIdentifiers = new Set()

    function trackImportedIdentifier(localName) {
      trackedCollectionIdentifiers.add(localName)
    }

    function trackAlias(aliasName, sourceExpression) {
      const sourceRootName = getRootIdentifierName(sourceExpression)

      if (sourceRootName && trackedCollectionIdentifiers.has(sourceRootName)) {
        trackedCollectionIdentifiers.add(aliasName)
      }
    }

    return {
      ImportDeclaration(node) {
        if (
          typeof node.source.value !== 'string' ||
          !importPatterns.some((pattern) => pattern.test(node.source.value))
        ) {
          return
        }

        for (const specifier of node.specifiers) {
          trackImportedIdentifier(specifier.local.name)
        }
      },
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier' || !node.init) {
          return
        }

        trackAlias(node.id.name, node.init)
      },
      AssignmentExpression(node) {
        if (node.operator !== '=' || node.left.type !== 'Identifier') {
          return
        }

        trackAlias(node.left.name, node.right)
      },
      CallExpression(node) {
        const callee = unwrapExpression(node.callee)

        if (!callee || callee.type !== 'MemberExpression') {
          return
        }

        const methodName = getPropertyName(callee)
        if (!methodName || !mutationMethods.has(methodName)) {
          return
        }

        const rootIdentifierName = getRootIdentifierName(callee.object)
        if (
          !rootIdentifierName ||
          !trackedCollectionIdentifiers.has(rootIdentifierName)
        ) {
          return
        }

        context.report({
          node: callee.property,
          messageId: 'noDirectMutation',
          data: {
            method: methodName,
            collection: rootIdentifierName,
          },
        })
      },
    }
  },
}
