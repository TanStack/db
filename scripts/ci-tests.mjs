import { execFileSync, spawn } from 'node:child_process'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Keep package selection in one place for both builds and tests. A new package
// with a test script must be assigned here before CI can pass.
//
// Each package job runs its entries as separate Vitest processes with one
// worker each, at most four at a time on the four-core runner, in the order
// listed: list the longest entries first. An entry is one of
//
// - `{ package }`: the package's test files that no other entry names;
// - `{ package, file }`: one test file;
// - `{ package, file, part }`: one part of an oracle file, by unit kind:
//   `fixed` runs its fixed-seed units, `random` its random-seed units, and
//   `other` every other test (determinism, calibrations, fixed and
//   enumerated histories). An oracle file whose units alone outlast a job is
//   split this way, in all three parts.
//
// An entry with `config` in place of `package` runs the repository scripts'
// oracles under that Vitest config, from the repository root.
//
// Every package with a test script, and every config, has exactly one entry
// without a file, so a new test file runs without an edit here. Each test runs
// exactly once. The times beside the jobs are the entries' seconds on CI
// (TanStack/db runs 44593906345 and 44597915696), with four entries at a
// time; they vary
// with what runs beside them.
const testParts = {
  fixed: `fixed seed `,
  random: `^(?!.*fixed seed ).*random seed`,
  other: `^(?!.*(?:fixed seed |random seed))`,
}
const pkg = (name, file, part) => ({ package: name, file, part })
const parts = (name, file) =>
  Object.keys(testParts).map((part) => pkg(name, file, part))
const scripts = (file, part) => ({
  config: `scripts/oracle-scripts.vitest.config.mjs`,
  file,
  part,
})
const powersync = `@tanstack/powersync-db-collection`
const electric = `@tanstack/electric-db-collection`
const conformance = `@tanstack/db-adapter-conformance`
const query = `@tanstack/query-db-collection`
const sqliteCore = `@tanstack/db-sqlite-persistence-core`
const browserSqlite = `@tanstack/browser-db-sqlite-persistence`
const reload = `tests/eager-reload-conformance-oracle.property.test.ts`
const baseline = `tests/persisted-baseline-lifecycle-oracle.test.ts`
const liveSource = `tests/eager-live-source-conformance-oracle.property.test.ts`
const startup = `tests/persisted-startup-conformance-oracle.property.test.ts`
const reference = `tests/reference-adapter-oracle.property.test.ts`
const lintScope = `lint-scope-oracle.property.test.js`
const packageJobs = {
  'ivm-offline': [
    pkg(`@tanstack/offline-transactions`),
    pkg(`@tanstack/db-ivm`),
  ],
  'sqlite-core': [
    ...parts(
      sqliteCore,
      `tests/sync-metadata-session-persisted-oracle.test.ts`,
    ),
    pkg(sqliteCore, `tests/persisted-demand-coverage-campaign-oracle.test.ts`),
    pkg(sqliteCore),
    pkg(sqliteCore, `tests/sync-metadata-missing-row-oracle.test.ts`),
    pkg(sqliteCore, `tests/persisted-options.test.ts`),
  ],
  'sqlite-adapters': [
    pkg(browserSqlite, `tests/multi-tab-electric-oracle.test.ts`),
    pkg(browserSqlite, `tests/persisted-options.test.ts`),
    pkg(browserSqlite),
    pkg(`@tanstack/electron-db-sqlite-persistence`),
    pkg(`@tanstack/tauri-db-sqlite-persistence`),
    pkg(`@tanstack/node-db-sqlite-persistence`),
    pkg(`@tanstack/capacitor-db-sqlite-persistence`),
    pkg(`@tanstack/react-native-db-sqlite-persistence`),
    pkg(`@tanstack/expo-db-sqlite-persistence`),
    pkg(`@tanstack/cloudflare-durable-objects-db-sqlite-persistence`),
  ],
  frameworks: [
    pkg(`@tanstack/react-db`),
    pkg(`@tanstack/angular-db`),
    pkg(`@tanstack/svelte-db`),
    pkg(`@tanstack/solid-db`),
    pkg(`@tanstack/vue-db`),
    pkg(`@tanstack/preact-db`),
    pkg(`@tanstack/react-router-with-db`),
  ],
  // About 1,100 to 1,350 entry-seconds each, no entry above about 400.
  'collections-1': [
    pkg(conformance, reference, `other`), // 462
    pkg(powersync, liveSource, `random`), // 288
    pkg(powersync, liveSource, `other`), // 194
    pkg(electric, liveSource, `fixed`), // 166
    pkg(powersync, startup, `random`), // 161
    pkg(`@tanstack/db-collection-e2e`), // 1
  ],
  'collections-2': [
    pkg(conformance, reference, `random`), // 386
    pkg(powersync, liveSource, `fixed`), // 364
    pkg(powersync, reload, `other`), // 360
    pkg(powersync, reload, `random`), // 135
    pkg(conformance), // 58
  ],
  'collections-3': [
    pkg(`@tanstack/convex-db-collection`, liveSource), // 253
    pkg(`@tanstack/trailbase-db-collection`), // 195
    pkg(powersync, baseline, `other`), // 189
    pkg(electric, liveSource, `random`), // 170
    pkg(`@tanstack/rxdb-db-collection`), // 131
    pkg(powersync, startup, `fixed`), // 114
    pkg(powersync, reload, `fixed`), // 70
    pkg(`@tanstack/convex-db-collection`), // 68
    pkg(electric, liveSource, `other`), // 25
  ],
  'collections-4': [
    pkg(powersync, startup, `other`), // 284
    pkg(conformance, reference, `fixed`), // 261
    pkg(powersync), // 232
    pkg(query), // 220
    pkg(query, `tests/refetch-ordered-prefix-oracle.test.ts`), // 172
    pkg(electric), // 150
    pkg(powersync, baseline, `fixed`), // 48
    pkg(powersync, baseline, `random`), // 40
  ],
  // Direct is a new package on this branch. Keep its eager campaigns in
  // separate processes, as the other costly collection receivers do.
  'collections-5': [
    ...parts(`@tanstack/powersync-direct-db-collection`, liveSource),
    pkg(`@tanstack/powersync-direct-db-collection`),
  ],
  // The repository scripts' oracles, which the lint job ran before. Their
  // histories run ESLint and Node in child processes. lint-scope runs whole
  // in a job of its own: its file-wide reach ledger (an afterAll minimum over
  // both campaigns) counts only the histories of its own process.
  'lint-rules': [scripts(`publish-http-oracle.property.test.js`), scripts()],
  'lint-scope': [scripts(lintScope)],
}

const root = fileURLToPath(new URL(`../`, import.meta.url))
const manifests = new Map(
  globSync(`packages/**/package.json`, {
    cwd: root,
    exclude: [`**/node_modules/**`, `**/dist/**`],
  }).map((file) => {
    const manifest = JSON.parse(readFileSync(join(root, file), `utf8`))
    return [manifest.name, { manifest, directory: dirname(file) }]
  }),
)
const testPackages = [...manifests.values()]
  .map(({ manifest }) => manifest)
  .filter((manifest) => manifest.scripts?.test)
const entries = Object.values(packageJobs).flat()
// An entry's owner: its package, or the scripts config that it runs under.
const owner = (entry) => entry.package ?? entry.config
const assigned = [
  `@tanstack/db`,
  ...entries.filter((entry) => entry.package).map((entry) => entry.package),
]
for (const name of [
  ...testPackages.map((manifest) => manifest.name),
  ...new Set(entries.filter((entry) => entry.config).map(owner)),
]) {
  if (
    name !== `@tanstack/db` &&
    !entries.some((entry) => owner(entry) === name)
  )
    throw new Error(`Assign ${name} to a CI test group`)
  const rest = entries.filter(
    (entry) => owner(entry) === name && entry.file === undefined,
  )
  if (name !== `@tanstack/db` && rest.length !== 1)
    throw new Error(
      `${name} needs exactly one CI entry for the test files that no other entry names`,
    )
}
for (const name of new Set(assigned)) {
  if (!testPackages.some((manifest) => manifest.name === name)) {
    throw new Error(
      `CI test group names a package without a test script: ${name}`,
    )
  }
}
// The directory whose files an entry names: its package, or its config's.
const entryDirectory = (entry) =>
  entry.package === undefined
    ? dirname(entry.config)
    : manifests.get(entry.package).directory
// A named file is excluded from its owner's other entry by its own name, so
// that name must be unique there. A file runs whole once, or in each of the
// three parts once. A named file is never a type-test file (`*.test-d.ts`):
// those stay with the entry that runs Vitest's typecheck.
for (const entry of entries.filter((candidate) => candidate.file)) {
  const named = globSync(`**/${basename(entry.file)}`, {
    cwd: join(root, entryDirectory(entry)),
    exclude: [`**/node_modules/**`, `**/dist/**`],
  })
  if (
    named.length !== 1 ||
    named[0] !== join(entry.file) ||
    /\.test-d\./.test(entry.file)
  )
    throw new Error(
      `CI entry ${owner(entry)} ${entry.file} must name exactly one runtime test file, by a name no other file there has`,
    )
  const same = entries.filter(
    (other) => owner(other) === owner(entry) && other.file === entry.file,
  )
  const whole = same.length === 1 && same[0].part === undefined
  const split =
    same.length === 3 &&
    Object.keys(testParts).every((part) =>
      same.some((other) => other.part === part),
    )
  if (!whole && !split)
    throw new Error(
      `CI entries for ${owner(entry)} ${entry.file} must run it whole once, or once in each part (${Object.keys(testParts).join(`, `)})`,
    )
}

// The DB package's type-level oracles each compile generated consumers, and
// the framework's determinism test compiles its replayed histories again, so
// one of them alone outlasts a shard's other files. They run in their own
// group, db-3, and the two file shards run every other test file. With
// db-replay, the groups run each DB test file exactly once.
const dbTypeOracles = [
  `tests/query/virtual-row-fields-types-oracle.test.ts`,
  `tests/mutation-handler-types-oracle.test.ts`,
]

// A listed file that no longer exists would leave db-3 short while its
// renamed successor fell back into a file shard, so every run checks them.
const missingTypeOracles = dbTypeOracles.filter(
  (file) => !existsSync(join(root, `packages/db`, file)),
)
if (missingTypeOracles.length > 0)
  throw new Error(
    `db-3 names missing test files: ${missingTypeOracles.join(`, `)}`,
  )

const entryLabel = (entry) =>
  [
    (entry.package ?? `scripts`).replace(`@tanstack/`, ``),
    entry.file && basename(entry.file),
    entry.part,
  ]
    .filter(Boolean)
    .join(` `)

/** The pnpm arguments that run one package-job entry. */
function entryArgs(entry) {
  const named = entries
    .filter((other) => owner(other) === owner(entry) && other.file)
    .map((other) => other.file)
  const selection =
    entry.file === undefined
      ? // Vitest matches an exclusion by the file's own name; the check above
        // keeps each named file's name unique in its package.
        [...new Set(named)].map((file) => `--exclude=**/${basename(file)}`)
      : [
          entry.file,
          ...(entry.part === undefined
            ? []
            : [`--testNamePattern=${testParts[entry.part]}`]),
          // Vitest's typecheck writes one temporary tsconfig beside the
          // package's tsconfig, so two processes of one package that both
          // typecheck overwrite each other's. It checks the package's type
          // tests, which a named file never is, so only the entry without a
          // file runs it.
          `--typecheck.enabled=false`,
        ]
  if (entry.config !== undefined)
    return [
      `exec`,
      `vitest`,
      `run`,
      `--config`,
      entry.config,
      ...selection,
      `--maxWorkers=1`,
    ]
  // Concurrent entries of one package must not share a coverage directory:
  // Vitest refuses a directory that another process holds.
  const coverage = entryLabel(entry).replace(/[^a-z0-9]+/gi, `-`)
  return [
    `--filter`,
    entry.package,
    `run`,
    `test`,
    ...selection,
    `--maxWorkers=1`,
    `--coverage.reportsDirectory=coverage/ci-${coverage}`,
  ]
}

/**
 * Run one entry, prefixing each output line with its label so that the
 * concurrent entries' logs stay readable. Resolves with its exit code.
 */
function runEntry(entry) {
  const label = entryLabel(entry)
  const start = Date.now()
  console.log(`[${label}] start: pnpm ${entryArgs(entry).join(` `)}`)
  const child = spawn(`pnpm`, entryArgs(entry), {
    cwd: root,
    stdio: [`ignore`, `pipe`, `pipe`],
  })
  for (const stream of [child.stdout, child.stderr])
    createInterface({ input: stream }).on(`line`, (line) =>
      console.log(`[${label}] ${line}`),
    )
  return new Promise((resolve) => {
    child.on(`close`, (code, signal) => {
      const seconds = Math.round((Date.now() - start) / 1000)
      console.log(
        `[${label}] end: ${signal ?? `exit ${code}`} after ${seconds}s`,
      )
      resolve({ label, ok: code === 0, seconds })
    })
  })
}

/** Run a job's entries in their listed order, at most `slots` at a time. */
async function runEntries(jobEntries, slots) {
  const queue = [...jobEntries]
  const results = []
  await Promise.all(
    Array.from({ length: slots }, async () => {
      while (queue.length > 0) results.push(await runEntry(queue.shift()))
    }),
  )
  for (const { label, ok, seconds } of results)
    console.log(`${ok ? `pass` : `FAIL`} ${seconds}s ${label}`)
  if (results.some(({ ok }) => !ok)) process.exitCode = 1
}

const [command, group] = process.argv.slice(2)
const dbShards = {
  'db-1': `1/2`,
  'db-2': `2/2`,
  'db-3': undefined,
  'db-replay': undefined,
}
const isDb = Object.hasOwn(dbShards, group)
if (command === `check`) {
  console.log(`CI groups cover all ${testPackages.length} package test scripts`)
} else if (
  ![`build`, `test`].includes(command) ||
  !(isDb || Object.hasOwn(packageJobs, group))
) {
  throw new Error(`Usage: node scripts/ci-tests.mjs <check|build|test> [group]`)
} else if (command === `build`) {
  // pnpm skips packages without a build script, but still builds their
  // dependencies. Keep its topological order for all selected packages.
  //
  // The jobs of one family (`collections-1` to `collections-5`) build every
  // package of the family. A test type-checks against its workspace
  // dependencies' built declarations, including those of a package that it
  // reaches only through another package's test helpers.
  const family = group.replace(/-\d+$/, ``)
  const packages = isDb
    ? [`@tanstack/db`]
    : [
        ...new Set(
          Object.entries(packageJobs)
            .filter(([name]) => name.replace(/-\d+$/, ``) === family)
            .flatMap(([, jobEntries]) =>
              jobEntries.flatMap((entry) => entry.package ?? []),
            ),
        ),
      ]
  // A job of scripts' oracles alone builds nothing: pnpm with no filter
  // would build every package.
  if (packages.length > 0)
    execFileSync(
      `pnpm`,
      [
        ...packages.flatMap((name) => [`--filter`, `${name}...`]),
        `run`,
        `build`,
      ],
      { cwd: root, stdio: `inherit` },
    )
} else if (isDb) {
  const selection =
    group === `db-replay`
      ? [`tests/oracle-replay.test.ts`]
      : group === `db-3`
        ? dbTypeOracles
        : [
            `--exclude=**/oracle-replay.test.ts`,
            // Vitest matches an exclusion by the file's own name; the
            // names are unique in the package.
            ...dbTypeOracles.map(
              (file) => `--exclude=**/${file.split(`/`).pop()}`,
            ),
            `--shard=${dbShards[group]}`,
          ]
  execFileSync(
    `pnpm`,
    [
      `--filter`,
      `@tanstack/db`,
      `run`,
      `test`,
      ...selection,
      `--maxWorkers=2`,
      `--reporter=default`,
      `--reporter=blob`,
      `--outputFile.blob=.vitest-reports/${group}.json`,
    ],
    { cwd: root, stdio: `inherit` },
  )
  if (group === `db-1`) {
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
} else {
  // Builds are complete: test suites need not wait for dependency suites.
  // Four one-worker processes bound Vitest to the four-core CI runner.
  await runEntries(packageJobs[group], 4)
}
