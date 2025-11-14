import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { extractSchemaMetadata, loadSchema } from "../utils/introspection"
import { generateTypes } from "../generators/types"
import { generateCollections } from "../generators/collections"
import { generateIndexFile } from "../generators/index-file"
import type { GraphQLDialect, SyncMode } from "@tanstack/graphql-db-collection"

/**
 * Build command configuration
 */
export interface BuildConfig {
  /** Schema source (file path or URL) */
  schema: string
  /** Output directory */
  out: string
  /** GraphQL endpoint (for runtime) */
  endpoint?: string
  /** Dialect to use */
  dialect?: GraphQLDialect
  /** Sync mode configuration */
  syncMode?: string
  /** Namespace for generated code */
  namespace?: string
  /** Headers for introspection */
  headers?: Record<string, string>
}

/**
 * Parse sync mode configuration
 *
 * Format: "default=on-demand,Post=progressive,User=eager"
 */
function parseSyncMode(syncMode?: string): {
  default: SyncMode
  perType: Record<string, SyncMode>
} {
  const result: { default: SyncMode; perType: Record<string, SyncMode> } = {
    default: `on-demand`,
    perType: {},
  }

  if (!syncMode) {
    return result
  }

  const parts = syncMode.split(`,`)
  for (const part of parts) {
    const [key, value] = part.split(`=`)
    if (!key || !value) continue

    if (key === `default`) {
      result.default = value as SyncMode
    } else {
      result.perType[key] = value as SyncMode
    }
  }

  return result
}

/**
 * Build the GraphQL client
 */
export async function build(config: BuildConfig): Promise<void> {
  console.log(`🔍 Loading GraphQL schema...`)

  // Load and introspect the schema
  const schema = await loadSchema({
    schema: config.schema,
    headers: config.headers,
  })

  console.log(`✓ Schema loaded`)

  // Extract metadata
  console.log(`📊 Extracting schema metadata...`)
  const metadata = extractSchemaMetadata(schema)

  console.log(`✓ Found ${metadata.size} types`)

  // Parse sync mode configuration
  const { default: defaultSyncMode, perType: perTypeSyncMode } = parseSyncMode(
    config.syncMode
  )

  const dialect = config.dialect || `hasura`
  const namespace = config.namespace || `GraphQL`

  // Create output directories
  const outDir = config.out
  const dirs = [
    outDir,
    join(outDir, `schema`),
    join(outDir, `collections`),
    join(outDir, `runtime`),
  ]

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  console.log(`📝 Generating TypeScript types...`)

  // Generate TypeScript types
  const typesCode = generateTypes(metadata)
  writeFileSync(join(outDir, `schema`, `types.ts`), typesCode, `utf-8`)

  console.log(`✓ Types generated`)

  // Generate collections
  console.log(`📦 Generating collections...`)
  const collections = generateCollections(
    metadata,
    dialect,
    defaultSyncMode,
    perTypeSyncMode
  )

  for (const [typeName, code] of collections) {
    writeFileSync(
      join(outDir, `collections`, `${typeName}.collection.ts`),
      code,
      `utf-8`
    )
  }

  console.log(`✓ Generated ${collections.size} collections`)

  // Generate index file
  console.log(`🔧 Generating index file...`)
  const indexCode = generateIndexFile({
    metadata,
    dialect,
    defaultSyncMode,
    perTypeSyncMode,
    namespace,
  })

  writeFileSync(join(outDir, `index.ts`), indexCode, `utf-8`)

  console.log(`✓ Index file generated`)

  // Generate README
  const readmeContent = generateReadme(
    namespace,
    config.endpoint || `YOUR_ENDPOINT`
  )
  writeFileSync(join(outDir, `README.md`), readmeContent, `utf-8`)

  console.log(`\n✅ Build complete!`)
  console.log(`\n📁 Generated files in: ${outDir}`)
  console.log(`\nUsage:`)
  console.log(`  import { create${namespace}Db } from '${outDir}'`)
  console.log(`\n  const db = create${namespace}Db({`)
  console.log(`    queryClient,`)
  console.log(
    `    endpoint: '${config.endpoint || `https://api.example.com/graphql`}',`
  )
  console.log(`  })`)
}

/**
 * Generate a README for the generated code
 */
function generateReadme(namespace: string, endpoint: string): string {
  return `# Generated GraphQL DB Client

This directory contains auto-generated code from your GraphQL schema.

## Usage

\`\`\`typescript
import { QueryClient } from '@tanstack/query-core'
import { create${namespace}Db } from '.'

const queryClient = new QueryClient()

const db = create${namespace}Db({
  queryClient,
  endpoint: '${endpoint}',
})

// Use in a live query
const { data } = useLiveQuery((q) =>
  q.from({ p: db.collections.Post })
   .where(({ p }) => eq(p.published, true))
   .orderBy(({ p }) => desc(p.createdAt))
   .limit(20)
)

// Optimistic mutations
await db.collections.Post.insert({
  title: 'New Post',
  content: 'Hello, world!',
})
\`\`\`

## Regenerating

To regenerate this code after schema changes:

\`\`\`bash
npx db-graphql build --schema <schema-path> --out <output-dir>
\`\`\`

## Structure

- \`index.ts\` - Main entry point, exports create${namespace}Db
- \`schema/types.ts\` - TypeScript types from GraphQL schema
- \`collections/\` - One collection file per GraphQL type
- \`README.md\` - This file

**Do not edit manually** - changes will be overwritten on next build.
`
}
