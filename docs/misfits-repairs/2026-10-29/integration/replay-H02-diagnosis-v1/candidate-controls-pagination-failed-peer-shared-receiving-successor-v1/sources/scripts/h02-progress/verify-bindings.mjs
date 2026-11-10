import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  checkReceiptWriter,
  createReceiptReader,
} from './receipt-transport.mjs'

/**
 * Run only after a root-admitted witness. This is a provenance gate, separate
 * from the progress/value checker. Missing binding evidence is setup failure,
 * never an oracle RED. It reads actual runner registry metadata, runtime V8
 * sources and all raw key callbacks; plugin transforms alone cannot pass it.
 */
const [directory, freezePath, bindingProfile = `progress-v1`] = process.argv.slice(2)
if (!directory || !freezePath)
  throw new Error(`usage: verify-bindings.mjs RUN_DIR SOURCE_FREEZE [progress-v1|completion-baseline-v1]`)
const hash = (bytes) => createHash(`sha256`).update(bytes).digest(`hex`)
const freeze = JSON.parse(readFileSync(freezePath, `utf8`))
const root = freeze.worktree
const approvedInstruments = {
  ...freeze.instrumentFiles,
  ...freeze.sharedInstrumentFiles,
}
const failures = []
const jsonLines = (name) =>
  readFileSync(resolve(directory, name), `utf8`)
    .split(`\n`)
    .filter(Boolean)
    .map((line) => JSON.parse(line))
const receiptPath = resolve(directory, `receipts.jsonl`)
/** @type {Array<import('./receipt-transport.mjs').Receipt>} */
const raw = []
const receiptReader = createReceiptReader(receiptPath, (receipt) =>
  raw.push(receipt),
)
let receiptTransportError
try {
  receiptReader.drain(true)
  checkReceiptWriter(receiptPath)
} catch (error) {
  receiptTransportError = String(error)
  failures.push(`receipt transport: ${String(error)}`)
} finally {
  try {
    receiptReader.close()
  } catch (error) {
    receiptTransportError ??= String(error)
    failures.push(`receipt transport close: ${String(error)}`)
  }
}
// The frozen caller selects the receiving profile. Receipt identity must agree;
// an unrecognized selector cannot waive either profile's provenance boundary.
const completionProfile = bindingProfile === `completion-baseline-v1`
if (![`progress-v1`, `completion-baseline-v1`].includes(bindingProfile))
  failures.push(`unknown binding profile: ${bindingProfile}`)
const starts = raw.filter((event) => event.phase === `worker-start`)
if (starts.length !== 1)
  failures.push(`binding profile requires exactly one worker-start`)
const start = starts[0]
if (
  completionProfile
    ? start?.mode !== `baseline-constituent` || start?.history !== undefined
    : start?.mode !== undefined ||
      ![`query`, `sync-initial`, `sync-mutation`].includes(start?.history?.kind)
)
  failures.push(`binding profile does not match worker-start: ${bindingProfile}`)
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
const startupInventory = completionProfile
  ? `evaluated-pre-history.json`
  : `evaluated-driver-start.json`
if (!inventories.includes(startupInventory))
  failures.push(`actual evaluated-module startup inventory missing: ${startupInventory}`)
const v8 = jsonLines(`v8-binding.jsonl`)
const scripts = v8.filter((entry) => entry.phase === `v8-compiled-script`)
let seal
try {
  seal = JSON.parse(
    readFileSync(resolve(directory, `binding-seal.json`), `utf8`),
  )
  const methods = v8.filter((entry) => entry.phase === `inspector-ack`)
  const skipIndex = v8.findIndex(
    (entry) =>
      entry.phase === `inspector-ack` &&
      entry.method === `Debugger.setSkipAllPauses`,
  )
  const disableIndex = v8.findIndex(
    (entry) =>
      entry.phase === `inspector-ack` && entry.method === `Debugger.disable`,
  )
  const disconnectIndex = v8.findIndex(
    (entry) => entry.phase === `inspector-disconnected-before-history`,
  )
  if (
    seal.selectedRoot !== root ||
    seal.sealed !== true ||
    seal.skipAllPausesAcknowledged !== true ||
    seal.debuggerDisableAcknowledged !== true ||
    seal.inspectorDisconnectedBeforeHistory !== true ||
    seal.inventorySha256 !==
      hash(readFileSync(resolve(directory, `evaluated-pre-history.json`))) ||
    JSON.stringify(methods.map(({ method }) => method)) !==
      JSON.stringify([
        `Debugger.setSkipAllPauses`,
        `Debugger.enable`,
        `Debugger.disable`,
      ]) ||
    methods.some(({ error }) => error !== undefined) ||
    v8.some(({ phase }) => phase === `v8-source-error`) ||
    disconnectIndex <= disableIndex ||
    v8.some(
      (entry, index) =>
        entry.phase === `v8-compiled-script` &&
        (index <= skipIndex || index >= disableIndex),
    )
  )
    failures.push(`startup source seal or inspector acknowledgements invalid`)
} catch (error) {
  failures.push(`startup source seal missing or unreadable: ${String(error)}`)
}
const bindings = []
for (const name of inventories) {
  const { inventory, selectedRoot } = JSON.parse(
    readFileSync(resolve(directory, name), `utf8`),
  )
  if (selectedRoot !== root)
    failures.push(`wrong inventory root: ${selectedRoot}`)
  for (const module of inventory) {
    const file = module.file && resolve(module.file.replace(/\?.*$/, ``))
    const relative = file?.startsWith(root + `/`)
      ? file.slice(root.length + 1)
      : undefined
    const packageModule =
      /\/packages\/(?:db|db-ivm|query-db-collection)\//.test(file ?? module.id)
    const production =
      packageModule &&
      /\/packages\/(?:db|db-ivm|query-db-collection)\/src\//.test(file ?? ``)
    const instrument =
      relative !== undefined && approvedInstruments[relative] !== undefined
    const instrumentModule = /\/scripts\/h02-progress\//.test(file ?? module.id)
    if (!packageModule && !instrument && !instrumentModule) continue
    if (relative === undefined || (!production && !instrument)) {
      failures.push(
        `outside/stale or unapproved package module: ${module.file ?? module.id}`,
      )
      continue
    }
    const kind = production ? `production` : `instrument`
    const expected = production
      ? freeze.receivingProductionFiles[relative]
      : approvedInstruments[relative]
    if (expected === undefined || expected !== module.sourceSha256)
      failures.push(`wrong actual original bytes: ${relative}`)
    // A registry node can still be evaluating at one cut. Retain that fact;
    // compiled binding alone receives no evaluated/executed path credit.
    if (!module.codeSha256)
      failures.push(`${kind} module lacks code witness: ${relative}`)
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
    const sealed =
      Array.isArray(seal?.bindings) &&
      seal.bindings.find(
        (entry) =>
          entry.file === file && entry.codeSha256 === module.codeSha256,
      )
    if (
      !sealed ||
      !Array.isArray(sealed.scripts) ||
      !matches.some((match) =>
        sealed.scripts.some(
          (script) =>
            script.scriptId === match.scriptId &&
            script.sourceSha256 === match.sourceSha256,
        ),
      )
    )
      failures.push(
        `receiving module lacks sealed startup binding: ${relative}`,
      )
    bindings.push({
      inventory: name,
      relative,
      kind,
      evaluated: module.evaluated === true,
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
  if (
    !bindings.some(
      ({ relative, evaluated }) => relative === required && evaluated,
    )
  )
    failures.push(`required evaluated receiving source missing: ${required}`)
}
// The completion receiver awaits its dynamic driver import before sealing.
// This exact receiver's operational premise is therefore evaluated startup
// closure. It does not impose a product rule on general module scheduling.
const completionInstruments = [
  `packages/query-db-collection/tests/queued-answer-completion.receiving.test.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-driver.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-baseline-driver.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-attachments.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-fixture.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-baseline-history-oracle.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-history-oracle.ts`,
  `packages/query-db-collection/tests/queued-answer-completion-oracle.ts`,
  `scripts/h02-progress/candidate-controls.ts`,
  `packages/db/tests/oracle-reach.ts`,
  `packages/db/tests/oracle-config.ts`,
  `packages/db/tests/oracle-replay-witness.ts`,
  `packages/db/tests/oracle-declaration.ts`,
  `packages/db/tests/reference-expression-oracle.ts`,
  `scripts/h02-progress/source-binding.setup.ts`,
  `scripts/h02-progress/receipt-transport.mjs`,
  `scripts/h02-progress/startup-inspector.mjs`,
]
const progressInstruments = [
  `packages/query-db-collection/tests/queued-answer-progress.receiving.test.ts`,
  `packages/query-db-collection/tests/queued-answer-progress-driver.ts`,
  `packages/query-db-collection/tests/queued-answer-progress-oracle.ts`,
  `packages/db/tests/query/load-subset-retained-publication-oracle.ts`,
  `packages/db/tests/reference-expression-oracle.ts`,
  `scripts/h02-progress/source-binding.setup.ts`,
  `scripts/h02-progress/receipt-transport.mjs`,
  `scripts/h02-progress/startup-inspector.mjs`,
  `scripts/h02-progress/witness-premise.ts`,
]
for (const required of completionProfile ? [] : progressInstruments) {
  if (
    !bindings.some(
      ({ relative, evaluated }) => relative === required && evaluated,
    )
  )
    failures.push(
      `required evaluated receiving instrument missing: ${required}`,
    )
}
if (completionProfile) {
  for (const required of [
    `packages/db/src/index.ts`,
    `packages/db-ivm/src/index.ts`,
    `packages/query-db-collection/src/query.ts`,
    ...completionInstruments,
  ]) {
    if (!bindings.some(
      ({ inventory, relative, evaluated }) =>
        inventory === `evaluated-pre-history.json` &&
        relative === required && evaluated,
    ))
      failures.push(`required evaluated completion startup module missing: ${required}`)
  }
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
  bindingProfile,
  actualKeyCount,
  receiptTransport: {
    path: receiptPath,
    count: raw.length,
    error: receiptTransportError,
  },
  emptyCallbacks: emptyCalls.length,
  bindings,
  failures,
  limits: `Startup V8 compiled inventory can include unused scripts. The inspector disconnects before the receiving history; no precise runtime coverage is collected. Evaluated registry cuts and positive callback stacks supply separate path evidence. Later observed modules must match the sealed startup binding. Child oracle-module evaluation does not prove parent checker invocation.`,
}
writeFileSync(
  resolve(directory, `binding-verification.json`),
  JSON.stringify(result, null, 2),
)
if (failures.length) throw new Error(failures.join(`\n`))
