import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { readFileSync, writeFileSync } from "node:fs"
import { generateReferenceDocs } from "@tanstack/config/typedoc"

import fg from "fast-glob"

const __dirname = fileURLToPath(new URL(`.`, import.meta.url))

/** @type {import('@tanstack/config/typedoc').Package[]} */
const packages = [
  {
    name: `db`,
    entryPoints: [resolve(__dirname, `../packages/db/src/index.ts`)],
    tsconfig: resolve(__dirname, `../packages/db/tsconfig.docs.json`),
    outputDir: resolve(__dirname, `../docs/reference`),
  },
  {
    name: `electric-db-collection`,
    entryPoints: [
      resolve(__dirname, `../packages/electric-db-collection/src/index.ts`),
    ],
    tsconfig: resolve(
      __dirname,
      `../packages/electric-db-collection/tsconfig.docs.json`
    ),
    outputDir: resolve(__dirname, `../docs/reference/electric-db-collection`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `query-db-collection`,
    entryPoints: [
      resolve(__dirname, `../packages/query-db-collection/src/index.ts`),
    ],
    tsconfig: resolve(
      __dirname,
      `../packages/query-db-collection/tsconfig.docs.json`
    ),
    outputDir: resolve(__dirname, `../docs/reference/query-db-collection`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `react-db`,
    entryPoints: [resolve(__dirname, `../packages/react-db/src/index.ts`)],
    tsconfig: resolve(__dirname, `../packages/react-db/tsconfig.docs.json`),
    outputDir: resolve(__dirname, `../docs/framework/react/reference`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `solid-db`,
    entryPoints: [resolve(__dirname, `../packages/solid-db/src/index.ts`)],
    tsconfig: resolve(__dirname, `../packages/solid-db/tsconfig.docs.json`),
    outputDir: resolve(__dirname, `../docs/framework/solid/reference`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `svelte-db`,
    entryPoints: [resolve(__dirname, `../packages/svelte-db/src/index.ts`)],
    tsconfig: resolve(__dirname, `../packages/svelte-db/tsconfig.docs.json`),
    outputDir: resolve(__dirname, `../docs/framework/svelte/reference`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `trailbase-db-collection`,
    entryPoints: [
      resolve(__dirname, `../packages/trailbase-db-collection/src/index.ts`),
    ],
    tsconfig: resolve(
      __dirname,
      `../packages/trailbase-db-collection/tsconfig.docs.json`
    ),
    outputDir: resolve(__dirname, `../docs/reference/trailbase-db-collection`),
    exclude: [`packages/db/**/*`],
  },
  {
    name: `vue-db`,
    entryPoints: [resolve(__dirname, `../packages/vue-db/src/index.ts`)],
    tsconfig: resolve(__dirname, `../packages/vue-db/tsconfig.docs.json`),
    outputDir: resolve(__dirname, `../docs/framework/vue/reference`),
    exclude: [`packages/db/**/*`],
  },
]

await generateReferenceDocs({ packages })

// Find all markdown files matching the pattern
const markdownFiles = [
  ...(await fg(`docs/reference/**/*.md`)),
  ...(await fg(`docs/framework/*/reference/**/*.md`)),
]

console.log(`Found ${markdownFiles.length} markdown files to process\n`)

// Process each markdown file
markdownFiles.forEach((file) => {
  const content = readFileSync(file, `utf-8`)
  let updatedContent = content
  updatedContent = updatedContent.replaceAll(/\]\(\.\.\//gm, `](../../`)
  // updatedContent = content.replaceAll(/\]\(\.\//gm, '](../')
  updatedContent = updatedContent.replaceAll(
    /\]\((?!https?:\/\/|\/\/|\/|\.\/|\.\.\/|#)([^)]+)\)/gm,
    (match, p1) => `](../${p1})`
  )

  // Write the updated content back to the file
  if (updatedContent !== content) {
    writeFileSync(file, updatedContent, `utf-8`)
    console.log(`Processed file: ${file}`)
  }
})

console.log(`\n✅ All markdown files have been processed!`)

process.exit(0)
