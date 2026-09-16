/**
 * Law: an external inferred factory can emit declarations using package-root
 * public types only. A temporary consumer imports the built packages by their
 * published names, emits its own declaration, and rejects internal helper or
 * workspace paths. Successful compilation is the path-reach witness.
 */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), `..`)
const workspaceRoot = resolve(packageRoot, `../..`)

function run(command: string, args: Array<string>, cwd: string) {
  return spawnSync(command, args, {
    cwd,
    encoding: `utf8`,
    env: { ...process.env, NO_COLOR: `1` },
  })
}

function expectSuccess(result: ReturnType<typeof run>) {
  expect({
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }).toMatchObject({ status: 0 })
}

it(`emits portable declarations for an external inferred collection factory`, () => {
  const vite = resolve(workspaceRoot, `node_modules/.bin/vite`)
  expectSuccess(run(vite, [`build`], resolve(packageRoot, `../db`)))
  expectSuccess(run(vite, [`build`], packageRoot))

  const consumerRoot = mkdtempSync(
    join(tmpdir(), `powersync-portable-declarations-`),
  )
  try {
    const scope = join(consumerRoot, `node_modules`, `@tanstack`)
    mkdirSync(scope, { recursive: true })
    symlinkSync(packageRoot, join(scope, `powersync-db-collection`), `dir`)
    symlinkSync(resolve(packageRoot, `../db`), join(scope, `db`), `dir`)
    const powerSyncScope = join(consumerRoot, `node_modules`, `@powersync`)
    mkdirSync(powerSyncScope, { recursive: true })
    symlinkSync(
      resolve(packageRoot, `node_modules/@powersync/common`),
      join(powerSyncScope, `common`),
      `dir`,
    )

    writeFileSync(
      join(consumerRoot, `index.ts`),
      `import { Schema, Table, column } from '@powersync/common'
import { createCollection } from '@tanstack/db'
import { powerSyncCollectionOptions } from '@tanstack/powersync-db-collection'
import type { CommonPowerSyncDatabase } from '@powersync/common'

const schema = new Schema({
  items: new Table({ name: column.text }),
})

export const createTanstackCollection = (db: CommonPowerSyncDatabase) =>
  createCollection(
    powerSyncCollectionOptions({ database: db, table: schema.props.items }),
  )
`,
    )
    writeFileSync(
      join(consumerRoot, `tsconfig.json`),
      JSON.stringify({
        compilerOptions: {
          target: `ES2022`,
          module: `ESNext`,
          moduleResolution: `Bundler`,
          strict: true,
          skipLibCheck: true,
          declaration: true,
          emitDeclarationOnly: true,
          outDir: `dist`,
        },
        include: [`index.ts`],
      }),
    )

    const compile = run(
      resolve(workspaceRoot, `node_modules/.bin/tsc`),
      [`--project`, `tsconfig.json`, `--pretty`, `false`],
      consumerRoot,
    )
    expectSuccess(compile)

    const declaration = readFileSync(
      join(consumerRoot, `dist`, `index.d.ts`),
      `utf8`,
    )
    expect(declaration).toContain(`@tanstack/powersync-db-collection`)
    expect(declaration).not.toMatch(
      /(?:dist\/esm|src)\/helpers|\.worktrees|\/Users\//,
    )
  } finally {
    rmSync(consumerRoot, { recursive: true, force: true })
  }
}, 120_000)
