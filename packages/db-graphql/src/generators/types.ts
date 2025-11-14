import type { FieldMetadata, TypeMetadata } from "../utils/introspection"

/**
 * Generate TypeScript types from GraphQL schema metadata
 */

export function generateTypes(metadata: Map<string, TypeMetadata>): string {
  const types: Array<string> = []

  // Add header
  types.push(`/**
 * Generated TypeScript types from GraphQL schema
 * Do not edit manually - regenerate with db-graphql build
 */
`)

  // Generate each type
  for (const [_typeName, typeMeta] of metadata) {
    types.push(generateTypeInterface(typeMeta))
  }

  return types.join(`\n\n`)
}

/**
 * Generate a TypeScript interface for a GraphQL type
 */
function generateTypeInterface(metadata: TypeMetadata): string {
  const { name, fields, description } = metadata

  let output = ``

  // Add description as JSDoc comment
  if (description) {
    output += `/**\n * ${description}\n */\n`
  }

  output += `export interface ${name} {\n`

  for (const field of fields) {
    output += generateField(field)
  }

  output += `}\n`

  // Generate input type for mutations
  output += `\n`
  output += generateInputType(metadata)

  return output
}

/**
 * Generate a field in a TypeScript interface
 */
function generateField(field: FieldMetadata): string {
  const { name, type, isScalar, isList, isRequired, description } = field

  let output = ``

  // Add field description
  if (description) {
    output += `  /** ${description} */\n`
  }

  // Map GraphQL types to TypeScript types
  let tsType = mapGraphQLTypeToTypeScript(type, isScalar)

  if (isList) {
    tsType = `Array<${tsType}>`
  }

  const optional = isRequired ? `` : `?`

  output += `  ${name}${optional}: ${tsType}\n`

  return output
}

/**
 * Map GraphQL types to TypeScript types
 */
function mapGraphQLTypeToTypeScript(
  graphqlType: string,
  isScalar: boolean
): string {
  if (!isScalar) {
    return graphqlType
  }

  switch (graphqlType) {
    case `String`:
      return `string`
    case `Int`:
    case `Float`:
      return `number`
    case `Boolean`:
      return `boolean`
    case `ID`:
      return `string | number`
    case `DateTime`:
    case `Date`:
    case `Time`:
      return `string`
    case `JSON`:
      return `Record<string, unknown>`
    default:
      return `unknown`
  }
}

/**
 * Generate an input type for mutations
 */
function generateInputType(metadata: TypeMetadata): string {
  const { name, fields } = metadata

  let output = `export interface ${name}Input {\n`

  for (const field of fields) {
    // Skip relation fields and __typename in input types
    if (field.isRelation || field.name === `__typename`) {
      continue
    }

    // All fields are optional in input types (for partial updates)
    const tsType = mapGraphQLTypeToTypeScript(field.type, field.isScalar)
    const finalType = field.isList ? `Array<${tsType}>` : tsType

    if (field.description) {
      output += `  /** ${field.description} */\n`
    }

    output += `  ${field.name}?: ${finalType}\n`
  }

  output += `}\n`

  return output
}
