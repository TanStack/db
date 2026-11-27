import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL(`..`, import.meta.url))

const packageGroup = (name, script = `test:oracles`) => ({
  name: `${name}:${script}`,
  args: [`--filter`, `@tanstack/${name}`, `run`, script],
})

// Keep the inexpensive local adapter owners separate from the core portfolio.
const localStores = [
  `local-storage-eager-reload-oracle.property.test.ts`,
  `local-only-direct-write-oracle.test.ts`,
  `local-storage-order-oracle.test.ts`,
  `local-storage-write-order-oracle.test.ts`,
  `local-storage-peers-oracle.test.ts`,
  `local-storage-value-fidelity-oracle.property.test.ts`,
]

export const nodeGroups = [
  {
    name: `local-stores`,
    args: [
      `--filter`,
      `@tanstack/db`,
      `exec`,
      `vitest`,
      `run`,
      `--coverage.enabled=false`,
      ...localStores.map((file) => `tests/${file}`),
    ],
  },
  ...[
    `db-adapter-conformance`,
    `query-db-collection`,
    `convex-db-collection`,
    `electric-db-collection`,
    `rxdb-db-collection`,
    `powersync-db-collection`,
    `powersync-direct-db-collection`,
    `trailbase-db-collection`,
  ].map((name) => packageGroup(name)),
  packageGroup(`db-adapter-conformance`, `test:oracles:neon`),
]

export const browserGroups = [
  {
    name: `local-stores:chromium`,
    args: [
      `--filter`,
      `@tanstack/db`,
      `exec`,
      `vitest`,
      `run`,
      `--config`,
      `vitest.local-stores.config.ts`,
    ],
  },
  packageGroup(`electric-db-collection`, `test:oracles:browser`),
  packageGroup(`rxdb-db-collection`, `test:oracles:browser`),
  packageGroup(
    `browser-db-sqlite-persistence`,
    `test:oracles:adapters-browser`,
  ),
  packageGroup(`db-adapter-conformance`, `test:oracles:neon-browser`),
]

export function pnpmCommand(environment = process.env) {
  // npm_execpath is supplied by pnpm when this runner is a package script.
  // Direct invocation falls back to the installed pnpm executable.
  const cli = environment.npm_execpath
  if (cli && basename(cli).includes(`pnpm`) && existsSync(cli))
    return { command: process.execPath, prefix: [cli] }
  return {
    command: process.platform === `win32` ? `pnpm.cmd` : `pnpm`,
    prefix: [],
  }
}

export function runGroups(
  groups,
  {
    spawn = spawnSync,
    write = (text) => process.stdout.write(text),
    command = pnpmCommand(),
  } = {},
) {
  let failed = false
  for (const group of groups) {
    write(`\nCollection adapter oracles: ${group.name}\n`)
    try {
      const result = spawn(
        command.command,
        [...command.prefix, ...group.args],
        {
          cwd: root,
          stdio: `inherit`,
          shell:
            process.platform === `win32` && command.command.endsWith(`.cmd`),
        },
      )
      if (result.error || result.signal || result.status !== 0) {
        failed = true
        write(
          `Failed ${group.name}: ${result.error?.message ?? result.signal ?? result.status ?? `no exit status`}\n`,
        )
      }
    } catch (error) {
      failed = true
      write(`Failed ${group.name}: ${String(error)}\n`)
    }
  }
  return failed ? 1 : 0
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== `--browser` && arg !== `--list`)) {
    process.stderr.write(
      `Usage: node scripts/run-collection-adapter-oracles.mjs [--browser] [--list]\n`,
    )
    process.exitCode = 1
  } else {
    const groups = args.includes(`--browser`) ? browserGroups : nodeGroups
    if (args.includes(`--list`))
      process.stdout.write(`${JSON.stringify(groups, null, 2)}\n`)
    else process.exitCode = runGroups(groups)
  }
}
