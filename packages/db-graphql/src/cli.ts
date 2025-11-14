#!/usr/bin/env node

import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Command } from "commander"
import { build } from "./commands/build"

// Get package version
const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson = JSON.parse(
  readFileSync(join(__dirname, `../package.json`), `utf-8`)
)

const program = new Command()

program
  .name(`db-graphql`)
  .description(`GraphQL schema compiler for TanStack DB`)
  .version(packageJson.version)

program
  .command(`build`)
  .description(`Generate TanStack DB collections from a GraphQL schema`)
  .requiredOption(`--schema <path>`, `GraphQL schema file or endpoint URL`)
  .requiredOption(`--out <dir>`, `Output directory for generated code`)
  .option(`--endpoint <url>`, `GraphQL endpoint URL (for runtime config)`)
  .option(
    `--dialect <dialect>`,
    `GraphQL server dialect (hasura|postgraphile|prisma|generic)`,
    `hasura`
  )
  .option(
    `--sync-mode <mode>`,
    `Sync mode config (e.g., "default=on-demand,Post=progressive")`,
    `default=on-demand`
  )
  .option(`--namespace <name>`, `Namespace for generated code`, `GraphQL`)
  .option(
    `--header <header>`,
    `HTTP header for introspection (can be repeated)`,
    (value, previous: Array<string> = []) => [...previous, value],
    []
  )
  .action(async (options) => {
    try {
      // Parse headers
      const headers: Record<string, string> = {}
      for (const header of options.header || []) {
        const [key, value] = header.split(`:`)
        if (key && value) {
          headers[key.trim()] = value.trim()
        }
      }

      await build({
        schema: options.schema,
        out: options.out,
        endpoint: options.endpoint,
        dialect: options.dialect,
        syncMode: options.syncMode,
        namespace: options.namespace,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })
    } catch (error) {
      console.error(`\n❌ Build failed:`, error)
      process.exit(1)
    }
  })

program.parse(process.argv)
