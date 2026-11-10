import { strict as assert } from 'node:assert'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * Authored provenance records exercise only the offline verifier. Fake source
 * files are byte strings, never imported or evaluated. A fixture's bound result
 * is calibration, not effective-source evidence for a real receiving run.
 */
const verifier = fileURLToPath(
  new URL(`./verify-bindings.mjs`, import.meta.url),
)
const hash = (bytes) => createHash(`sha256`).update(bytes).digest(`hex`)
const production = [
  `packages/db/src/index.ts`,
  `packages/db-ivm/src/index.ts`,
  `packages/query-db-collection/src/query.ts`,
]
const instruments = [
  `packages/query-db-collection/tests/queued-answer-progress.receiving.test.ts`,
  `packages/query-db-collection/tests/queued-answer-progress-driver.ts`,
  `packages/query-db-collection/tests/queued-answer-progress-oracle.ts`,
  `packages/db/tests/query/load-subset-retained-publication-oracle.ts`,
  `packages/db/tests/reference-expression-oracle.ts`,
  `scripts/h02-progress/source-binding.setup.ts`,
  `packages/db/tests/optional-calibration-helper.ts`,
]
function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), `h02-verifier-calibration-`))
  const root = resolve(directory, `authored-source`)
  const run = resolve(directory, `authored-run`)
  mkdirSync(resolve(run, `evaluated-sources`), { recursive: true })
  mkdirSync(resolve(run, `v8-sources`), { recursive: true })
  const freeze = {
    worktree: root,
    productionFiles: {},
    receivingProductionFiles: {},
    instrumentFiles: {},
    sharedInstrumentFiles: {},
    packages: {},
    node: {
      executable: process.execPath,
      sha256: hash(readFileSync(process.execPath)),
    },
  }
  const inventory = []
  const scripts = []
  for (const [index, path] of [...production, ...instruments].entries()) {
    const file = resolve(root, path)
    const source = `authored original ${index}`
    const code = `authored loader ${index}`
    const executed = `authored wrapper { ${code} }`
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, source)
    const sourceSha256 = hash(source)
    const codeSha256 = hash(code)
    if (production.includes(path)) {
      freeze.productionFiles[path] = sourceSha256
      freeze.receivingProductionFiles[path] = sourceSha256
    } else freeze.instrumentFiles[path] = sourceSha256
    inventory.push({
      id: file,
      file,
      url: file,
      evaluated: true,
      sourceSha256,
      codeSha256,
    })
    writeFileSync(resolve(run, `evaluated-sources`, `${codeSha256}.txt`), code)
    const script = {
      phase: `v8-compiled-script`,
      scriptId: String(index),
      url: file,
      sourceSha256: hash(executed),
    }
    scripts.push(script)
    writeFileSync(
      resolve(run, `v8-sources`, `${script.sourceSha256}.txt`),
      executed,
    )
  }
  const raw = [
    { phase: `worker-start`, history: { kind: `query` } },
    { phase: `query-key-callback`, emptyOptions: true, key: [`authored`] },
    { phase: `actual-key-prefix`, boundary: `authored`, key: [`authored`, 1] },
    {
      phase: `source-stack`,
      stack: `${root}/packages/db/src/a.ts\n${root}/packages/db-ivm/src/b.ts`,
    },
  ]
  writeFileSync(
    resolve(run, `worker.log`),
    raw.map((event) => JSON.stringify({ h02: true, ...event })).join(`\n`),
  )
  return { directory, root, run, freeze, inventory, scripts }
}
function verify(input, extraInventory) {
  const { directory, root, run, freeze, inventory, scripts } = input
  const freezePath = resolve(directory, `source-freeze.json`)
  writeFileSync(freezePath, JSON.stringify(freeze))
  writeFileSync(
    resolve(run, `evaluated-driver-start.json`),
    JSON.stringify({ selectedRoot: root, inventory }),
  )
  if (extraInventory)
    writeFileSync(
      resolve(run, `evaluated-after-all.json`),
      JSON.stringify({ selectedRoot: root, inventory: extraInventory }),
    )
  writeFileSync(
    resolve(run, `v8-binding.jsonl`),
    scripts.map((entry) => JSON.stringify(entry)).join(`\n`),
  )
  const child = spawnSync(
    process.execPath,
    [`--max-old-space-size=384`, verifier, run, freezePath],
    {
      encoding: `utf8`,
      timeout: 20_000,
    },
  )
  assert.equal(child.error, undefined)
  const result = JSON.parse(
    readFileSync(resolve(run, `binding-verification.json`), `utf8`),
  )
  return { child, result }
}
function calibration(name, mutate, expected, after) {
  test(name, () => {
    const input = fixture()
    try {
      const extra = mutate(input)
      const { child, result } = verify(input, extra)
      if (expected === undefined) {
        assert.equal(child.status, 0, child.stderr)
        assert.equal(result.status, `bound`)
      } else {
        assert.notEqual(child.status, 0)
        assert.equal(result.status, `binding-unresolved`)
        assert.ok(
          result.failures.some((failure) => failure.includes(expected)),
          JSON.stringify(result.failures),
        )
      }
      after?.(result)
      console.info(
        JSON.stringify({
          calibration: name,
          authoredInputsOnly: true,
          exitCode: child.status,
          status: result.status,
          failures: result.failures,
        }),
      )
    } finally {
      rmSync(input.directory, { recursive: true, force: true })
    }
  })
}
calibration(
  `accepts exact approved production and instrument bindings`,
  () => {},
)
calibration(
  `retains unevaluated optional instrument without execution credit`,
  ({ inventory }) => {
    inventory.at(-1).evaluated = false
  },
  undefined,
  ({ bindings }) => {
    assert.equal(
      bindings.find(({ relative }) =>
        relative.endsWith(`optional-calibration-helper.ts`),
      ).evaluated,
      false,
    )
  },
)
calibration(
  `accepts required module evaluated at a later inventory cut`,
  ({ inventory }) => {
    const later = structuredClone(inventory)
    inventory[3].evaluated = false
    return later
  },
)
calibration(
  `rejects outside-root production`,
  ({ inventory }) => {
    inventory[0].file = `/authored-outside/packages/db/src/index.ts`
  },
  `outside/stale or unapproved package module`,
)
calibration(
  `rejects stale dist substitution`,
  ({ root, inventory }) => {
    inventory[0].file = resolve(root, `packages/db/dist/index.js`)
  },
  `outside/stale or unapproved package module`,
)
calibration(
  `rejects an unapproved package helper`,
  ({ root, inventory }) => {
    inventory.at(-1).file = resolve(
      root,
      `packages/db/tests/unapproved-helper.ts`,
    )
  },
  `outside/stale or unapproved package module`,
)
calibration(
  `rejects changed frozen original bytes`,
  ({ root }) => {
    writeFileSync(resolve(root, production[0]), `changed original`)
  },
  `changed frozen source`,
)
calibration(
  `rejects wrong actual original-byte metadata`,
  ({ inventory }) => {
    inventory[3].sourceSha256 = `wrong`
  },
  `wrong actual original bytes`,
)
calibration(
  `rejects changed retained loader bytes`,
  ({ run, inventory }) => {
    writeFileSync(
      resolve(run, `evaluated-sources`, `${inventory[3].codeSha256}.txt`),
      `changed loader`,
    )
  },
  `wrong retained transformed bytes`,
)
calibration(
  `rejects V8 bytes without exact loader body`,
  ({ run, scripts }) => {
    const source = `unrelated authored V8 body`
    scripts[3].sourceSha256 = hash(source)
    writeFileSync(
      resolve(run, `v8-sources`, `${scripts[3].sourceSha256}.txt`),
      source,
    )
  },
  `no exact transformed-to-V8 binding`,
)
calibration(
  `rejects a required path that never evaluated`,
  ({ inventory }) => {
    inventory[3].evaluated = false
  },
  `required evaluated receiving instrument missing`,
)
calibration(
  `rejects transform-only evidence without actual registry bindings`,
  ({ run, inventory }) => {
    inventory.length = 0
    writeFileSync(
      resolve(run, `loader-binding.jsonl`),
      JSON.stringify({ phase: `plugin-transform`, authored: true }),
    )
  },
  `required evaluated receiving source missing`,
)
