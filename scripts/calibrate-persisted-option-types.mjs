/** Run compiler-host mutants without changing production files on disk. */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const [mutation = `none`, ownerRef] = process.argv.slice(2)
const root = process.cwd()
const packageRoot = resolve(root, `packages/db-sqlite-persistence-core`)
const ownerPath = `packages/db-sqlite-persistence-core/tests/persisted-options-type-oracle.ts`
let source = ownerRef
  ? execFileSync(`git`, [`show`, `${ownerRef}:${ownerPath}`], {
      encoding: `utf8`,
    })
  : readFileSync(ownerPath, `utf8`)
const mutations = {
  none: ``,
  get parent() {
    const parent = execFileSync(
      `git`,
      [
        `show`,
        `d2935d0fcac164163adc231c6a796b8a4c234d9b:packages/db-sqlite-persistence-core/src/persisted.ts`,
      ],
      { encoding: `utf8` },
    )
    return `if (name === resolve(packageRoot, 'src/persisted.ts')) {
      source = ts.createSourceFile(name, ${JSON.stringify(parent)}, languageVersion, true);
    }`
  },
  'local-utils': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    const start = source.text.indexOf('type PersistedLocalOnlyOptionsResult<');
    const end = source.text.indexOf('const REQUIRED_COORDINATOR_METHODS', start);
    const section = source.text.slice(start, end).replaceAll('TUtils & PersistedCollectionUtils', 'TUtils');
    source = ts.createSourceFile(name, source.text.slice(0,start) + section + source.text.slice(end), languageVersion, true);
  }`,
  'query-status': `if (name.endsWith('/query-db-collection/src/query.ts')) {
    source = ts.createSourceFile(name, source.text.replace('  isLoading: boolean', '  isLoading: any'), languageVersion, true);
  }`,
  'query-refetch': `if (name.endsWith('/query-db-collection/src/query.ts')) {
    source = ts.createSourceFile(name, source.text.replace('throwOnError?: boolean', 'throwOnError?: any'), languageVersion, true);
  }`,
  'query-namespace': `if (name.endsWith('/query-db-collection/src/query.ts')) {
    source = ts.createSourceFile(name, source.text.replace('  refetch: RefetchFn', '  awaitTxId?: (id: number) => Promise<void>\\n  refetch: RefetchFn'), languageVersion, true);
  }`,
  'schema-version': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    source = ts.createSourceFile(name, source.text.replaceAll('schemaVersion?: number', 'schemaVersion?: any'), languageVersion, true);
  }`,
  'initial-render': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    source = ts.createSourceFile(name, source.text.replace('strategy: \`network-first\`', 'strategy: any'), languageVersion, true);
  }`,
  'sync-mode': `if (name.endsWith('/db/src/types.ts')) {
    source = ts.createSourceFile(name, source.text.replace('syncMode?: SyncMode', 'syncMode?: any'), languageVersion, true);
  }`,
  'contextual-sync': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    source = ts.createSourceFile(name, source.text.replace('sync: SyncConfig<T, TKey>\\n  persistence:', 'sync: { sync: (params: any) => void }\\n  persistence:'), languageVersion, true);
  }`,
  'declaration-error': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    source = ts.createSourceFile(name, source.text + '\\nexport const __oracle_declaration_error = class { private secret = 1 };\\n', languageVersion, true);
  }`,
  'source-error': `if (name === resolve(packageRoot, 'src/persisted.ts')) {
    source = ts.createSourceFile(name, source.text + '\\nconst __oracle_source_error: number = "wrong";\\n', languageVersion, true);
  }`,
}
// Earlier calibration controls remain reproducible after follow-up commits.
const syncResult = `): PersistedSyncOptionsResult<T, TKey, never, TUtils>`
const localResult = `): PersistedLocalOnlyOptionsResult<T, TKey, never, TUtils>`
for (const [name, transform] of Object.entries({
  'sync-regression': (text) =>
    text.replace(syncResult, syncResult.replace(`never`, `TSchema`)),
  'local-regression': (text) =>
    text.replace(localResult, localResult.replace(`never`, `TSchema`)),
  'widened-key': (text) =>
    [syncResult, localResult].reduce(
      (result, target) =>
        result.replace(
          target,
          target.replace(
            `TKey, never`,
            `TKey extends string ? string : number, never`,
          ),
        ),
      text,
    ),
  'erased-utils': (text) =>
    [syncResult, localResult].reduce(
      (result, target) =>
        result.replace(
          target,
          target.replace(`never, TUtils`, `never, UtilsRecord`),
        ),
      text,
    ),
  'blanket-never': (text) =>
    text.replace(
      /(\): Persisted(?:Sync|LocalOnly)OptionsResult<\n  InferSchemaOutput<TSchema>,\n  TKey,\n  )TSchema,/g,
      `$1never,`,
    ),
  'contextual-key': (text) =>
    text.replaceAll(
      `schema: TSchema\n  },`,
      `schema: TSchema\n    getKey: (row: any) => TKey\n  },`,
    ),
})) {
  if (name !== mutation) continue
  const original = readFileSync(
    resolve(packageRoot, `src/persisted.ts`),
    `utf8`,
  )
  const altered = transform(original)
  if (original === altered) throw new Error(`Missing mutation target: ${name}`)
  mutations[name] =
    `if (name === resolve(packageRoot, 'src/persisted.ts')) { source = ts.createSourceFile(name, ${JSON.stringify(altered)}, languageVersion, true); }`
}
for (const [name, transform] of Object.entries({
  'missing-undefined': (text) =>
    text
      .replace(
        `public get(key: TKey): WithVirtualProps<TOutput, TKey> | undefined {`,
        `public get(key: TKey): WithVirtualProps<TOutput, TKey> {`,
      )
      .replace(
        `return this._state.getWithVirtualProps(key)`,
        `return this._state.getWithVirtualProps(key)!`,
      ),
  'extra-read-field': (text) =>
    text
      .replace(
        `public get(key: TKey): WithVirtualProps<TOutput, TKey> | undefined {`,
        `public get(key: TKey): (WithVirtualProps<TOutput, TKey> & { leaked: boolean }) | undefined {`,
      )
      .replace(
        `return this._state.getWithVirtualProps(key)`,
        `return this._state.getWithVirtualProps(key) as (WithVirtualProps<TOutput, TKey> & { leaked: boolean }) | undefined`,
      ),
})) {
  if (name !== mutation) continue
  const original = readFileSync(
    resolve(root, `packages/db/src/collection/index.ts`),
    `utf8`,
  )
  const altered = transform(original)
  if (original === altered) throw new Error(`Missing mutation target: ${name}`)
  mutations[name] =
    `if (name.endsWith('/db/src/collection/index.ts')) { source = ts.createSourceFile(name, ${JSON.stringify(altered)}, languageVersion, true); }`
}
const admission = `if (name === resolve(packageRoot, 'src/persisted.ts')) {
  source = ts.createSourceFile(name, source.text.replace('export function persistedCollectionOptions<', ${JSON.stringify(`export function persistedCollectionOptions<
  T extends object, TKey extends string | number, TUtils extends UtilsRecord = UtilsRecord,
>(options: PersistedLocalOnlyOptions<T, TKey, never, TUtils> & { sync: undefined }): PersistedLocalOnlyOptionsResult<T, TKey, never, TUtils>
export function persistedCollectionOptions<`)}), languageVersion, true);
}`
mutations['undefined-sync'] = admission
mutations['collateral-sync'] = admission
if (!(mutation in mutations)) throw new Error(`Unknown mutant: ${mutation}`)
const receiver =
  process.env.ORACLE_RECEIVER ??
  (mutation.startsWith(`query-`) ? `browser` : `core`)
if (![`core`, `browser`].includes(receiver))
  throw new Error(`Unknown receiver: ${receiver}`)
source = source.replace(
  "import { it } from 'vitest'",
  `const callbacks: Array<{name: string; fn: () => Promise<void>; timeout: number}> = [];
const it = Object.assign((name: string, fn: () => Promise<void>, timeout: number) => callbacks.push({name, fn, timeout}), {skip: () => {}});`,
)
for (const name of [`oracle-config`, `oracle-reach`]) {
  source = source.replace(
    `'../../db/tests/${name}.js'`,
    JSON.stringify(resolve(root, `packages/db/tests/${name}.ts`)),
  )
}
source = source.replace(
  'const packageRoot = fileURLToPath(new URL(`../`, import.meta.url))',
  `const packageRoot = ${JSON.stringify(packageRoot)}`,
)
const oldInsertion = `      if (source) files.set(name, source)`
const newInsertion = `      if (source) {\n        Object.assign(source, { version: \`0\` })`
if (source.includes(oldInsertion)) {
  source = source.replace(
    oldInsertion,
    `      if (source) { ${mutations[mutation]} }\n${oldInsertion}`,
  )
} else if (source.includes(newInsertion)) {
  source = source.replace(
    newInsertion,
    `      if (source) { ${mutations[mutation]}\n        Object.assign(source, { version: \`0\` })`,
  )
} else throw new Error(`Compiler-host calibration seam changed`)
if (mutation === `collateral-sync`) {
  source = source.replace(
    '    generated = source',
    `    source = source.replaceAll(
    'const rejectedSyncOptions = { ...options, persistence, sync: undefined };',
    'const rejectedSyncOptions = { ...options, persistence, sync: undefined, getKey: 42 };'
  ).replaceAll(
    'persistedCollectionOptions({ ...options, persistence, sync: undefined });',
    'persistedCollectionOptions({ ...options, persistence, sync: undefined, getKey: 42 });'
  );\n    generated = source`,
  )
}
if (process.env.ORACLE_COMPILER_WORK === `1`) {
  source = source.replace(
    `    const diagnostics = [`,
    `    let affectedFiles = 0;
    while (program.getSemanticDiagnosticsOfNextAffectedFile()) affectedFiles++;
    const diagnostics = [`,
  )
  source = source.replace(
    `    // Each expected error`,
    `    console.info('COMPILER_WORK', revision, affectedFiles);
    // Each expected error`,
  )
}
source += `\nregisterPersistedOptionsTypeOracle(${JSON.stringify(receiver)});
const selected = callbacks.find(({name}) => name.endsWith('(replay)') || name.endsWith('(fixed)'));
if (!selected) throw new Error('Missing calibration campaign');
if (process.env.ORACLE_REGISTRATION_ONLY === '1') {
  const multiplier = readOracleRunConfig().multiplier;
  console.info(JSON.stringify({multiplier, runs: oracleRuns(12), timeouts: callbacks.map(({timeout}) => timeout)}));
  if (callbacks.some(({timeout}) => timeout !== 120_000 * multiplier)) throw new Error('Timeout does not scale with campaign budget');
} else {
  let beats = 0;
  const heartbeat = setInterval(() => beats++, 1);
  try {
    for (const campaign of process.env.ORACLE_ALL_CAMPAIGNS === '1' ? callbacks : [selected]) await campaign.fn();
  } finally { clearInterval(heartbeat); }
  if (process.env.ORACLE_COMPILER_WORK === '1') console.info('WORKER_HEARTBEATS', beats);
}
console.info('CALIBRATION ACCEPTED: ${mutation}');\n`
mkdirSync(`.context`, { recursive: true })
const filename = resolve(root, `.context/calibrate-persisted-${mutation}.ts`)
writeFileSync(filename, source)
const result = spawnSync(resolve(root, `node_modules/.bin/tsx`), [filename], {
  stdio: `inherit`,
  env: {
    ...process.env,
    TANSTACK_DB_ORACLE_SEED: `2259`,
    ...(process.env.TANSTACK_DB_ORACLE_PATH
      ? { TANSTACK_DB_ORACLE_PROPERTY: `persisted-options.types.${receiver}` }
      : {}),
  },
})
if (result.error) throw result.error
process.exitCode = result.status ?? 1
