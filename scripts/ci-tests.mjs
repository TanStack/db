import { execFileSync } from 'node:child_process'
import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep package selection in one place for both builds and tests. A new package
// with a test script must be assigned here before CI can pass.
const groups = {
  db: [`@tanstack/db`],
  'ivm-offline': [`@tanstack/db-ivm`, `@tanstack/offline-transactions`],
  'sqlite-core': [`@tanstack/db-sqlite-persistence-core`],
  'sqlite-adapters': [
    `@tanstack/browser-db-sqlite-persistence`,
    `@tanstack/node-db-sqlite-persistence`,
    `@tanstack/electron-db-sqlite-persistence`,
    `@tanstack/cloudflare-durable-objects-db-sqlite-persistence`,
    `@tanstack/react-native-db-sqlite-persistence`,
    `@tanstack/expo-db-sqlite-persistence`,
    `@tanstack/capacitor-db-sqlite-persistence`,
    `@tanstack/tauri-db-sqlite-persistence`,
  ],
  frameworks: [
    `@tanstack/react-db`,
    `@tanstack/react-router-with-db`,
    `@tanstack/solid-db`,
    `@tanstack/vue-db`,
    `@tanstack/svelte-db`,
    `@tanstack/angular-db`,
  ],
  collections: [
    `@tanstack/electric-db-collection`,
    `@tanstack/query-db-collection`,
    `@tanstack/powersync-db-collection`,
    `@tanstack/rxdb-db-collection`,
    `@tanstack/trailbase-db-collection`,
    `@tanstack/db-collection-e2e`,
  ],
}

const root = fileURLToPath(new URL(`../`, import.meta.url))
const manifests = globSync(`packages/**/package.json`, {
  cwd: root,
  exclude: [`**/node_modules/**`, `**/dist/**`],
}).map((file) => JSON.parse(readFileSync(join(root, file), `utf8`)))
const testPackages = manifests.filter((manifest) => manifest.scripts?.test)
const assigned = Object.values(groups).flat()
for (const { name } of testPackages) {
  if (assigned.filter((candidate) => candidate === name).length !== 1) {
    throw new Error(`Assign ${name} to exactly one CI test group`)
  }
}
for (const name of assigned) {
  if (!testPackages.some((manifest) => manifest.name === name)) {
    throw new Error(
      `CI test group names a package without a test script: ${name}`,
    )
  }
}

const [command, group] = process.argv.slice(2)
if (command === `check`) {
  console.log(`CI groups cover all ${testPackages.length} package test scripts`)
} else {
  const dbShards = { 'db-1': `1/2`, 'db-2': `2/2`, 'db-replay': undefined }
  const isDb = Object.hasOwn(dbShards, group)
  const packages = groups[isDb ? `db` : group]
  if (!packages || ![`build`, `test`].includes(command)) {
    throw new Error(
      `Usage: node scripts/ci-tests.mjs <check|build|test> [group]`,
    )
  }
  let args
  if (command === `build`) {
    // pnpm skips packages without a build script, but still builds their
    // dependencies. Keep its topological order for all selected packages.
    args = [
      ...packages.flatMap((name) => [`--filter`, `${name}...`]),
      `run`,
      `build`,
    ]
  } else if (isDb) {
    const selection =
      group === `db-replay`
        ? [`tests/oracle-replay.test.ts`]
        : [`--exclude=**/oracle-replay.test.ts`, `--shard=${dbShards[group]}`]
    args = [
      `--filter`,
      `@tanstack/db`,
      `run`,
      `test`,
      ...selection,
      `--maxWorkers=2`,
      `--reporter=default`,
      `--reporter=blob`,
      `--outputFile.blob=.vitest-reports/${group}.json`,
    ]
  } else {
    // Builds are complete: test suites need not wait for dependency suites.
    // Bound both package and Vitest concurrency on the four-core CI runner.
    args = [
      `--no-sort`,
      `--workspace-concurrency=2`,
      ...packages.flatMap((name) => [`--filter`, name]),
      `run`,
      `test`,
      `--maxWorkers=2`,
    ]
  }
  execFileSync(`pnpm`, args, { cwd: root, stdio: `inherit` })
  if (command === `test` && group === `db-1`) {
    // The group build is complete. Verify published declarations after runtime
    // suites finish, without rebuilding a dependency they could still read.
    execFileSync(
      `pnpm`,
      [
        `--filter`,
        `@tanstack/db`,
        `exec`,
        `vitest`,
        `run`,
        `--config`,
        `vitest.indexed-db.package.config.ts`,
        `--maxWorkers=2`,
      ],
      { cwd: root, stdio: `inherit` },
    )
  }
}
