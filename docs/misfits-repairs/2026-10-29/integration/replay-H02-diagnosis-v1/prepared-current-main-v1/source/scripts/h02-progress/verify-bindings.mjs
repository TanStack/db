import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Run only after a root-admitted witness. This is a provenance gate, separate
 * from the progress/value checker. Missing binding evidence is setup failure,
 * never an oracle RED. It reads actual runner registry metadata, runtime V8
 * sources and all raw key callbacks; plugin transforms alone cannot pass it.
 */
const [directory, freezePath] = process.argv.slice(2)
if (!directory || !freezePath)
  throw new Error(`usage: verify-bindings.mjs RUN_DIR SOURCE_FREEZE`)
const hash = (bytes) => createHash(`sha256`).update(bytes).digest(`hex`)
const freeze = JSON.parse(readFileSync(freezePath, `utf8`))
const root = freeze.worktree
const failures = []
const jsonLines = (name) =>
  readFileSync(resolve(directory, name), `utf8`)
    .split(`\n`)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const raw = readFileSync(resolve(directory, `worker.log`), `utf8`)
  .split(`\n`)
  .flatMap((line) =>
    line.startsWith(`{"h02":true,`) ? [JSON.parse(line)] : [],
  )
const emptyCalls = raw.filter(
  (event) => event.phase === `query-key-callback` && event.emptyOptions,
)
const queryCase =
  raw.find((event) => event.phase === `worker-start`)?.history?.kind === `query`
if (queryCase && emptyCalls.length === 0)
  failures.push(`actual empty-options key callback missing`)
const base = emptyCalls[0]?.key
let actualKeyCount = 0
for (const event of raw) {
  if (event.phase !== `actual-key-prefix`) continue
  actualKeyCount++
  const key = event.key
  if (
    !Array.isArray(base) ||
    !Array.isArray(key) ||
    key.length < base.length ||
    base.some(
      (part, index) => JSON.stringify(part) !== JSON.stringify(key[index]),
    )
  )
    failures.push(`actual prefix violation at ${event.boundary}`)
}
if (queryCase && actualKeyCount === 0)
  failures.push(`no actual key observations`)
if (raw.some((event) => event.phase === `warning`))
  failures.push(`receiving warning`)
for (const [path, expected] of Object.entries({
  ...freeze.productionFiles,
  ...freeze.instrumentFiles,
  ...freeze.sharedInstrumentFiles,
})) {
  if (hash(readFileSync(resolve(root, path))) !== expected)
    failures.push(`changed frozen source: ${path}`)
}
for (const metadata of Object.values(freeze.packages)) {
  for (const [path, expected] of Object.entries(
    metadata.regularPayloadFilesMap,
  )) {
    if (hash(readFileSync(resolve(metadata.resolved, path))) !== expected)
      failures.push(`changed material dependency: ${metadata.resolved}/${path}`)
  }
}
if (hash(readFileSync(freeze.node.executable)) !== freeze.node.sha256)
  failures.push(`changed selected Node executable`)
const inventories = readdirSync(directory).filter((name) =>
  /^evaluated-.*\.json$/.test(name),
)
if (!inventories.includes(`evaluated-driver-start.json`))
  failures.push(`actual evaluated-module startup inventory missing`)
const v8 = jsonLines(`v8-binding.jsonl`)
const scripts = v8.filter((entry) => entry.phase === `v8-compiled-script`)
const bindings = []
for (const name of inventories) {
  const { inventory, selectedRoot } = JSON.parse(
    readFileSync(resolve(directory, name), `utf8`),
  )
  if (selectedRoot !== root)
    failures.push(`wrong inventory root: ${selectedRoot}`)
  for (const module of inventory) {
    if (
      !/\/packages\/(?:db|db-ivm|query-db-collection)\//.test(
        module.file ?? module.id,
      )
    )
      continue
    const file = module.file?.replace(/\?.*$/, ``)
    if (!file?.startsWith(root + `/`) || !file.includes(`/src/`)) {
      failures.push(
        `outside/stale production module: ${module.file ?? module.id}`,
      )
      continue
    }
    const relative = file.slice(root.length + 1)
    if (freeze.productionFiles[relative] !== module.sourceSha256)
      failures.push(`wrong actual original bytes: ${relative}`)
    if (!module.evaluated || !module.codeSha256)
      failures.push(
        `production module lacks evaluated/code witness: ${relative}`,
      )
    if (!module.codeSha256) continue
    const transformed = readFileSync(
      resolve(directory, `evaluated-sources`, `${module.codeSha256}.txt`),
      `utf8`,
    )
    if (hash(transformed) !== module.codeSha256)
      failures.push(`wrong retained transformed bytes: ${relative}`)
    const matches = scripts.filter((script) => {
      if (!(
        script.url === file ||
        script.url === `file://${file}` ||
        script.url === module.url
      ))
        return false
      const executed = readFileSync(
        resolve(directory, `v8-sources`, `${script.sourceSha256}.txt`),
        `utf8`,
      )
      if (hash(executed) !== script.sourceSha256)
        failures.push(`wrong retained V8 bytes: ${relative}`)
      // Vite/Vitest add an evaluator function wrapper. The entire exact loader
      // code must occur within the actual V8 script, not merely a path label.
      return executed.includes(transformed)
    })
    if (matches.length === 0)
      failures.push(`no exact transformed-to-V8 binding: ${relative}`)
    bindings.push({
      inventory: name,
      relative,
      codeSha256: module.codeSha256,
      scripts: matches.map(({ scriptId, sourceSha256 }) => ({
        scriptId,
        sourceSha256,
      })),
    })
  }
}
for (const required of [
  `packages/db/src/index.ts`,
  `packages/db-ivm/src/index.ts`,
  `packages/query-db-collection/src/query.ts`,
]) {
  if (!bindings.some(({ relative }) => relative === required))
    failures.push(`required receiving source missing: ${required}`)
}
const stacks = raw
  .filter((event) => event.phase === `source-stack`)
  .map(({ stack }) => String(stack))
if (
  queryCase &&
  !stacks.some(
    (stack) =>
      stack.includes(`/packages/db/src/`) &&
      stack.includes(`/packages/db-ivm/src/`),
  )
)
  failures.push(`positive current DB/db-ivm source stack missing`)
const result = {
  status: failures.length ? `binding-unresolved` : `bound`,
  actualKeyCount,
  emptyCallbacks: emptyCalls.length,
  bindings,
  failures,
  limits: `V8 compiled inventory can include unused scripts; evaluated registry and positive stacks supply separate execution evidence. Final coverage is credited only if reached.`,
}
writeFileSync(
  resolve(directory, `binding-verification.json`),
  JSON.stringify(result, null, 2),
)
if (failures.length) throw new Error(failures.join(`\n`))
