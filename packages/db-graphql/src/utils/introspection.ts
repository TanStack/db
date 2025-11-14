import { readFileSync } from "node:fs"
import { join } from "node:path"
import { buildClientSchema, getIntrospectionQuery, printSchema } from "graphql"
import type { GraphQLSchema, IntrospectionQuery } from "graphql"

/**
 * Introspection utilities for GraphQL schemas
 */

export interface IntrospectionOptions {
  /** Schema source: file path, URL, or introspection JSON */
  schema: string
  /** Optional headers for remote introspection */
  headers?: Record<string, string>
}

/**
 * Load a GraphQL schema from various sources
 *
 * Supports:
 * - Remote endpoints (HTTP introspection)
 * - Local SDL files (.graphql, .gql)
 * - Introspection JSON files (.json)
 */
export async function loadSchema(
  options: IntrospectionOptions
): Promise<GraphQLSchema> {
  const { schema: source, headers = {} } = options

  // Check if it's a URL
  if (source.startsWith(`http://`) || source.startsWith(`https://`)) {
    return await introspectRemoteSchema(source, headers)
  }

  // Check if it's a file
  if (source.endsWith(`.json`)) {
    return loadSchemaFromIntrospectionFile(source)
  }

  if (source.endsWith(`.graphql`) || source.endsWith(`.gql`)) {
    return loadSchemaFromSDL(source)
  }

  throw new Error(
    `Unsupported schema source: ${source}. Must be a URL, .json, .graphql, or .gql file`
  )
}

/**
 * Introspect a remote GraphQL endpoint
 */
async function introspectRemoteSchema(
  endpoint: string,
  headers: Record<string, string>
): Promise<GraphQLSchema> {
  const introspectionQuery = getIntrospectionQuery()

  const response = await fetch(endpoint, {
    method: `POST`,
    headers: {
      "Content-Type": `application/json`,
      ...headers,
    },
    body: JSON.stringify({
      query: introspectionQuery,
    }),
  })

  if (!response.ok) {
    throw new Error(
      `Failed to introspect schema: ${response.status} ${response.statusText}`
    )
  }

  const result = await response.json()

  if (result.errors) {
    throw new Error(
      `GraphQL errors during introspection: ${JSON.stringify(result.errors)}`
    )
  }

  return buildClientSchema(result.data as IntrospectionQuery)
}

/**
 * Load schema from an introspection JSON file
 */
function loadSchemaFromIntrospectionFile(filePath: string): GraphQLSchema {
  const content = readFileSync(filePath, `utf-8`)
  const introspection = JSON.parse(content)

  // Handle both { data: IntrospectionQuery } and IntrospectionQuery formats
  const data = introspection.data || introspection

  return buildClientSchema(data as IntrospectionQuery)
}

/**
 * Load schema from an SDL file
 */
function loadSchemaFromSDL(filePath: string): GraphQLSchema {
  const content = readFileSync(filePath, `utf-8`)
  const { buildSchema } = require(`graphql`)
  return buildSchema(content)
}

/**
 * Extract type information from a schema
 */
export interface TypeMetadata {
  name: string
  fields: Array<FieldMetadata>
  isObjectType: boolean
  isInterfaceType: boolean
  hasId: boolean
  description?: string
}

export interface FieldMetadata {
  name: string
  type: string
  isScalar: boolean
  isRelation: boolean
  isList: boolean
  isRequired: boolean
  description?: string
}

/**
 * Extract metadata from a GraphQL schema
 */
export function extractSchemaMetadata(
  schema: GraphQLSchema
): Map<string, TypeMetadata> {
  const typeMap = schema.getTypeMap()
  const metadata = new Map<string, TypeMetadata>()

  for (const [typeName, type] of Object.entries(typeMap)) {
    // Skip built-in types
    if (typeName.startsWith(`__`)) continue

    // Only process object types
    if (!(`getFields` in type)) continue
    if (
      typeName === `Query` ||
      typeName === `Mutation` ||
      typeName === `Subscription`
    )
      continue

    const fields = (type as any).getFields()
    const fieldMetadata: Array<FieldMetadata> = []

    for (const [fieldName, field] of Object.entries(fields)) {
      const fieldType = (field as any).type
      const isScalar = isScalarType(unwrapType(fieldType))
      const isList = isListType(fieldType)
      const isRequired = isNonNullType(fieldType)

      fieldMetadata.push({
        name: fieldName,
        type: unwrapType(fieldType).toString(),
        isScalar,
        isRelation: !isScalar,
        isList,
        isRequired,
        description: (field as any).description,
      })
    }

    const hasId = fieldMetadata.some((f) => f.name === `id`)

    metadata.set(typeName, {
      name: typeName,
      fields: fieldMetadata,
      isObjectType: type.constructor.name === `GraphQLObjectType`,
      isInterfaceType: type.constructor.name === `GraphQLInterfaceType`,
      hasId,
      description: (type as any).description,
    })
  }

  return metadata
}

/**
 * Unwrap a GraphQL type to its base type
 */
function unwrapType(type: any): any {
  if (type.ofType) {
    return unwrapType(type.ofType)
  }
  return type
}

/**
 * Check if a type is a scalar type
 */
function isScalarType(type: any): boolean {
  const scalarTypes = [
    `String`,
    `Int`,
    `Float`,
    `Boolean`,
    `ID`,
    `DateTime`,
    `Date`,
    `Time`,
    `JSON`,
  ]
  return (
    scalarTypes.includes(type.name) ||
    type.constructor.name === `GraphQLScalarType`
  )
}

/**
 * Check if a type is a list type
 */
function isListType(type: any): boolean {
  if (type.constructor.name === `GraphQLList`) {
    return true
  }
  if (type.ofType) {
    return isListType(type.ofType)
  }
  return false
}

/**
 * Check if a type is a non-null type
 */
function isNonNullType(type: any): boolean {
  return type.constructor.name === `GraphQLNonNull`
}

/**
 * Get scalar fields from type metadata
 */
export function getScalarFields(metadata: TypeMetadata): Array<string> {
  return metadata.fields
    .filter((f) => f.isScalar && !f.isList)
    .map((f) => f.name)
}

/**
 * Get relation fields from type metadata
 */
export function getRelationFields(
  metadata: TypeMetadata
): Array<FieldMetadata> {
  return metadata.fields.filter((f) => f.isRelation)
}
