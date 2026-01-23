import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateReferenceDocs } from '@tanstack/typedoc-config'

const __dirname = fileURLToPath(new URL(`.`, import.meta.url))

await generateReferenceDocs({
  packages: [
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
        `../packages/electric-db-collection/tsconfig.docs.json`,
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
        `../packages/query-db-collection/tsconfig.docs.json`,
      ),
      outputDir: resolve(__dirname, `../docs/reference/query-db-collection`),
      exclude: [`packages/db/**/*`],
    },
    {
      name: `powersync-db-collection`,
      entryPoints: [
        resolve(__dirname, `../packages/powersync-db-collection/src/index.ts`),
      ],
      tsconfig: resolve(
        __dirname,
        `../packages/powersync-db-collection/tsconfig.docs.json`,
      ),
      outputDir: resolve(
        __dirname,
        `../docs/reference/powersync-db-collection`,
      ),
      exclude: [`packages/db/**/*`],
    },
    {
      name: `rxdb-db-collection`,
      entryPoints: [
        resolve(__dirname, `../packages/rxdb-db-collection/src/index.ts`),
      ],
      tsconfig: resolve(
        __dirname,
        `../packages/rxdb-db-collection/tsconfig.docs.json`,
      ),
      outputDir: resolve(
        __dirname,
        `../docs/reference/rxdb-db-collection`,
      ),
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
        `../packages/trailbase-db-collection/tsconfig.docs.json`,
      ),
      outputDir: resolve(
        __dirname,
        `../docs/reference/trailbase-db-collection`,
      ),
      exclude: [`packages/db/**/*`],
    },
    {
      name: `vue-db`,
      entryPoints: [resolve(__dirname, `../packages/vue-db/src/index.ts`)],
      tsconfig: resolve(__dirname, `../packages/vue-db/tsconfig.docs.json`),
      outputDir: resolve(__dirname, `../docs/framework/vue/reference`),
      exclude: [`packages/db/**/*`],
    },
    {
      name: `angular-db`,
      entryPoints: [resolve(__dirname, `../packages/angular-db/src/index.ts`)],
      tsconfig: resolve(__dirname, `../packages/angular-db/tsconfig.docs.json`),
      outputDir: resolve(__dirname, `../docs/framework/angular/reference`),
      exclude: [`packages/db/**/*`],
    },
  ],
})

console.log(`\n✅ All markdown files have been processed!`)

process.exit(0)
