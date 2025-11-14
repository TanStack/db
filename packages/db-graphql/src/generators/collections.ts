import { getScalarFields } from "../utils/introspection"
import type { TypeMetadata } from "../utils/introspection"
import type { GraphQLDialect, SyncMode } from "@tanstack/graphql-db-collection"

/**
 * Generate collection files for each GraphQL type
 */

export interface CollectionGeneratorConfig {
  metadata: TypeMetadata
  dialect: GraphQLDialect
  syncMode: SyncMode
  namespace?: string
}

export function generateCollection(config: CollectionGeneratorConfig): string {
  const { metadata, dialect, syncMode, namespace = `GraphQL` } = config
  const { name } = metadata

  const scalarFields = getScalarFields(metadata)
  const selectionSet = [...new Set([`id`, `__typename`, ...scalarFields])].join(
    `\n      `
  )

  return `/**
 * Generated collection for ${name}
 * Do not edit manually - regenerate with db-graphql build
 */

import { createCollection } from '@tanstack/db'
import { graphqlCollectionOptions } from '@tanstack/graphql-db-collection'
import type { ${name}, ${name}Input } from '../schema/types'
import type { GraphQLDbContext } from '../index'

/**
 * Create the ${name} collection
 */
export function create${name}Collection(context: GraphQLDbContext) {
  const { queryClient, link, planner, dialect } = context

  return createCollection(
    graphqlCollectionOptions<${name}, string | number>({
      id: '${name}',
      getKey: (item) => item.id,
      queryClient,
      link,
      planner,
      dialect: '${dialect}',
      syncMode: '${syncMode}',
      selectionSet: \`
      ${selectionSet}
      \`,
      typeInfo: {
        name: '${name}',
        scalarFields: ${JSON.stringify(scalarFields)},
        relationFields: ${JSON.stringify(metadata.fields.filter((f) => f.isRelation).map((f) => f.name))},
        hasConnection: false, // TODO: detect from schema
        hasList: true,
      },
    })
  )
}
`
}

/**
 * Generate all collections
 */
export function generateCollections(
  metadata: Map<string, TypeMetadata>,
  dialect: GraphQLDialect,
  defaultSyncMode: SyncMode,
  perTypeSyncMode: Record<string, SyncMode>
): Map<string, string> {
  const collections = new Map<string, string>()

  for (const [typeName, typeMeta] of metadata) {
    // Skip types without an id field
    if (!typeMeta.hasId) {
      continue
    }

    const syncMode = perTypeSyncMode[typeName] || defaultSyncMode

    const code = generateCollection({
      metadata: typeMeta,
      dialect,
      syncMode,
    })

    collections.set(typeName, code)
  }

  return collections
}
