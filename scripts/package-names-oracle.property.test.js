/**
 * Every public package is checked and every applicable naming fault is
 * reported, including faults after one in the same or another package.
 * Authority: CONTRIBUTING.md, Package names; maintainer requests 2026-11-27.
 * The naming contract and offline-transactions exception remain unchanged.
 *
 * The grammar composes scope, spelling, directory and db edits across one to
 * four targets. A misplaced suffix applies only to collections. Removing db
 * and misplacing that suffix still owes one suffix diagnostic. Missing names
 * have no string to validate; private targets are outside the public law.
 * Stems have one to three words of at most twelve characters. They exclude
 * the reserved db word and standalone offline-transactions, which has its own
 * optional entry. Numeric prefixes distinguish targets in larger workspaces.
 * These prefixes also supply a leading word for the suffix rule. Healthy
 * peers are optional; nested/example manifests are always ignored.
 *
 * The model predicts the union of broken rules from authored edits, without
 * parsing rendered names. A stem can itself end in collection: the contract
 * follows the public name's shape, not its authored family. Stem position and
 * the presence of a leading word decide that extra obligation. Spelling edits
 * replace the final stem word; bare collection has no leading hyphen. The
 * model shares input rendering only for diagnostic paths. The
 * driver writes real manifests and runs the actual Node CLI. At process exit
 * it checks the full diagnostic multiset, public count and exit status.
 * Diagnostic order and message prose are not contractual.
 *
 * Reach is separate: a preload forwards actual production probe calls on fd 3
 * to the framework collector. The model and check never read those events.
 * predict derives entries from edits; every declared state has a randomized
 * construction and bound forced-true/false controls. No input label, summary,
 * or diagnostic code supplies reach. Limits: valid JSON and the described
 * edits; no registry, symlink, malformed-JSON, or adapter-runtime claim.
 */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import fc from 'fast-check'
import {
  differs,
  oracleProperty,
  pass,
} from '../packages/db/tests/oracle-config.js'

const script = fileURLToPath(
  new URL(`./check-package-names.mjs`, import.meta.url),
)
const bridge = fileURLToPath(
  new URL(`./package-names-probe-bridge.mjs`, import.meta.url),
)
const randomWord = fc
  .tuple(
    fc.constantFrom(...`abcdefghijklmnopqrstuvwxyz`),
    fc.array(fc.constantFrom(...`abcdefghijklmnopqrstuvwxyz0123456789`), {
      maxLength: 11,
    }),
  )
  .map(
    ([first, rest]) => first + rest.join(``),
    (value) => [value[0], value.slice(1).split(``)],
  )
// Give suffix-shaped words real sampling weight rather than relying on a
// character generator to spell a ten-letter contract keyword by chance.
const word = fc.oneof(
  { weight: 8, arbitrary: randomWord },
  { weight: 1, arbitrary: fc.constant(`collection`) },
  { weight: 1, arbitrary: fc.constant(`collections`) },
)
const stem = fc
  .array(word, { minLength: 1, maxLength: 3 })
  .map(
    (words) => words.join(`-`),
    (value) => value.split(`-`),
  )
  .filter(
    (value) =>
      !value.split(`-`).includes(`db`) && value !== `offline-transactions`,
  )
const edits = [`scope`, `folder`, `kebab`, `missing-db`]
const fields = {
  stem,
  kind: fc.constantFrom(`public`, `private`, `missing-name`),
}
const target = fc.oneof(
  fc.record({
    ...fields,
    family: fc.constantFrom(`binding`, `persistence`, `internal`),
    faults: fc.subarray(edits),
  }),
  fc.record({
    ...fields,
    family: fc.constant(`collection`),
    faults: fc.subarray([...edits, `collection-order`]),
  }),
)
const arbitrary = fc.record({
  packages: fc.array(target, { minLength: 1, maxLength: 4 }),
  healthyPeer: fc.boolean(),
  offline: fc.boolean(),
})

// Render inputs only. A directory fault changes the folder, leaving faults in
// the public name intact when edits compose.
function manifestOf(spec, index, total) {
  let value = total === 1 ? spec.stem : `p${index}-${spec.stem}`
  if (spec.faults.includes(`kebab`)) value += `_bad`
  let unscoped = {
    binding: `${value}-db`,
    collection: spec.faults.includes(`collection-order`)
      ? `${value}-db-direct-collection`
      : `${value}-db-collection`,
    persistence: `${value}-db-sqlite-persistence`,
    internal: `db-${value}`,
  }[spec.family]
  if (spec.faults.includes(`missing-db`))
    unscoped = unscoped
      .split(`-`)
      .filter((part) => part !== `db`)
      .join(`-`)
  const directory = spec.faults.includes(`folder`)
    ? `${unscoped}-other`
    : unscoped
  const manifest = {
    name: `${spec.faults.includes(`scope`) ? `@other` : `@tanstack`}/${unscoped}`,
  }
  if (spec.kind === `private`) manifest.private = true
  if (spec.kind === `missing-name`) delete manifest.name
  return { directory, manifest }
}

// The reference unions independent authored edits. A private or missing-name
// boundary determines whether there is a public string to judge at all.
function owedRules(spec, prefixed) {
  if (spec.kind === `private`) return []
  if (spec.kind === `missing-name`) return [`name`]
  const rules = spec.faults
    .filter((fault) => fault !== `collection-order`)
    .map(
      (fault) =>
        ({
          scope: `scope`,
          folder: `directory`,
          kebab: `kebab`,
          'missing-db': `db-segment`,
        })[fault],
    )
  const missingDb = spec.faults.includes(`missing-db`)
  const words = spec.stem.split(`-`)
  const stemAtEnd =
    spec.family === `internal` || (spec.family === `binding` && missingDb)
  const leadingWord =
    prefixed || words.length > 1 || (spec.family === `internal` && !missingDb)
  const incidentalCollection =
    stemAtEnd &&
    leadingWord &&
    words.at(-1) === `collection` &&
    !spec.faults.includes(`kebab`)
  if (
    incidentalCollection ||
    (spec.family === `collection` &&
      spec.faults.some((fault) =>
        [`missing-db`, `collection-order`].includes(fault),
      ))
  )
    rules.push(`collection-suffix`)
  return rules
}
function expectedNaming(history) {
  const errors = history.packages
    .flatMap((spec, index) =>
      owedRules(spec, history.packages.length > 1).map(
        (rule) =>
          `${manifestOf(spec, index, history.packages.length).directory}:${rule}`,
      ),
    )
    .sort()
  return {
    status: errors.length ? 1 : 0,
    checked:
      history.packages.filter((spec) => spec.kind !== `private`).length +
      Number(history.healthyPeer) +
      Number(history.offline),
    errors,
  }
}
function predictedBranches(history) {
  const rules = history.packages.map((spec) =>
    owedRules(spec, history.packages.length > 1),
  )
  const has = (rule) => rules.some((list) => list.includes(rule))
  return {
    valid:
      history.healthyPeer ||
      history.offline ||
      history.packages.some(
        (spec, index) => spec.kind !== `private` && rules[index].length === 0,
      ),
    'missing-db': has(`db-segment`),
    scope: has(`scope`),
    folder: has(`directory`),
    kebab: has(`kebab`),
    'collection-suffix': has(`collection-suffix`),
    offline: history.offline,
    private: history.packages.some((spec) => spec.kind === `private`),
    'missing-name': has(`name`),
    'multiple-invalid-packages':
      rules.filter((list) => list.length > 0).length > 1,
    'combined-faults': rules.some((list) => list.length > 1),
  }
}
function writeManifest(root, directory, manifest) {
  mkdirSync(join(root, directory), { recursive: true })
  writeFileSync(join(root, directory, `package.json`), JSON.stringify(manifest))
}
function driveNaming(history, observe, mutate) {
  const root = mkdtempSync(join(tmpdir(), `db-package-names-`))
  try {
    history.packages.forEach((spec, index) => {
      const { directory, manifest } = manifestOf(
        spec,
        index,
        history.packages.length,
      )
      writeManifest(root, `packages/${directory}`, manifest)
    })
    if (history.healthyPeer)
      writeManifest(root, `packages/db`, { name: `@tanstack/db` })
    if (history.offline)
      writeManifest(root, `packages/offline-transactions`, {
        name: `@tanstack/offline-transactions`,
      })
    writeManifest(root, `packages/db/e2e/app`, { name: `fixture` })
    writeManifest(root, `examples/demo`, { name: `example` })
    mkdirSync(join(root, `packages/.artifacts`))
    let entry = script
    if (mutate) {
      entry = join(root, `linter-mutant.mjs`)
      const source = readFileSync(script, `utf8`)
      if (source.split(mutate.find).length !== 2)
        throw new Error(`Mutant ${mutate.id} must match exactly once`)
      writeFileSync(entry, source.replace(mutate.find, mutate.replace))
    }
    const result = spawnSync(process.execPath, [`--import`, bridge, entry], {
      cwd: root,
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `pipe`, `pipe`],
      env: { ...process.env, NODE_ENV: `test` },
    })
    if (result.error) throw result.error
    // Forward true and false calls from the production decisions directly to
    // the collector, never to the public trace or expected result.
    for (const line of result.output[3].trim().split(`\n`).filter(Boolean)) {
      const [probe, entered] = JSON.parse(line)
      globalThis.__oracleProbe(probe, entered)
    }
    const count = /^Checked (\d+) public package names\.\n$/.exec(result.stdout)
    const errors =
      result.stderr.trim() === ``
        ? []
        : result.stderr
            .trim()
            .split(`\n`)
            .map((line) => {
              const match =
                /^\[([^\]]+)\] packages\/([^/]+)\/package.json: .+$/.exec(line)
              return match ? `${match[2]}:${match[1]}` : line
            })
            .sort()
    observe(`process exit`, {
      status: result.status,
      checked: count ? Number(count[1]) : null,
      errors,
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

// Retain the original construction names and append new dimensions. Builders
// splice a target into randomized workspaces rather than replacing the tails.
function changeFirst(history, changes) {
  return {
    ...history,
    packages: [
      { ...history.packages[0], ...changes },
      ...history.packages.slice(1),
    ],
  }
}
const constructions = [
  {
    name: `valid`,
    state: `valid`,
    build: (history) =>
      changeFirst(history, { kind: `public`, family: `binding`, faults: [] }),
  },
  ...[`missing-db`, `scope`, `folder`, `kebab`].map((fault) => ({
    name: fault,
    state: fault,
    build: (history) =>
      changeFirst(history, { kind: `public`, faults: [fault] }),
  })),
  {
    name: `collection-order`,
    state: `collection-suffix`,
    build: (history) =>
      changeFirst(history, {
        kind: `public`,
        family: `collection`,
        faults: [`collection-order`],
      }),
  },
  {
    name: `offline`,
    state: `offline`,
    build: (history) => ({ ...history, offline: true }),
  },
  {
    name: `private`,
    state: `private`,
    build: (history) => changeFirst(history, { kind: `private` }),
  },
  {
    name: `missing-name`,
    state: `missing-name`,
    build: (history) => changeFirst(history, { kind: `missing-name` }),
  },
  {
    name: `multiple-invalid-packages`,
    state: `multiple-invalid-packages`,
    build: (history) => ({
      ...history,
      packages: [
        { ...history.packages[0], kind: `public`, faults: [`scope`] },
        {
          ...(history.packages[1] ?? history.packages[0]),
          kind: `public`,
          faults: [`missing-db`],
        },
        ...history.packages.slice(2),
      ],
    }),
  },
  {
    name: `combined-faults`,
    state: `combined-faults`,
    build: (history) =>
      changeFirst(history, { kind: `public`, faults: [`scope`, `kebab`] }),
  },
  ...[
    [`internal-collection-tail`, `internal`, [], `collection-suffix`],
    [
      `internal-collection-tail-missing-db`,
      `internal`,
      [`missing-db`],
      `collection-suffix`,
    ],
    [
      `binding-collection-tail-missing-db`,
      `binding`,
      [`missing-db`],
      `collection-suffix`,
    ],
    [`internal-collection-tail-spelling`, `internal`, [`kebab`], `kebab`],
    [`internal-plural-collection-tail`, `internal`, [], `valid`],
  ].map(([name, family, faults, state]) => ({
    name,
    state,
    build: (history) =>
      changeFirst(history, {
        kind: `public`,
        family,
        faults,
        stem: [
          ...history.packages[0].stem.split(`-`).slice(0, 2),
          name === `internal-plural-collection-tail`
            ? `collections`
            : `collection`,
        ].join(`-`),
      }),
  })),
]
const states = [...new Set(constructions.map(({ state }) => state))]
const validWorkspace = {
  packages: [
    { stem: `healthy`, family: `binding`, kind: `public`, faults: [] },
  ],
  healthyPeer: false,
  offline: false,
}
const singleFailure = {
  ...validWorkspace,
  packages: [{ ...validWorkspace.packages[0], faults: [`scope`] }],
}
const legacy = {
  ...validWorkspace,
  healthyPeer: true,
  packages: [
    {
      stem: `powersync-direct`,
      family: `collection`,
      kind: `public`,
      faults: [`missing-db`],
    },
  ],
}

// Source mutants run a temporary copy of the real CLI through the same driver
// and comparison. A find must match exactly once, so stale controls fail.
const mutants = [
  {
    id: `suppress-later-invalid-packages`,
    history: { constructed: `multiple-invalid-packages` },
    law: `package naming`,
    find: `    const report = (rule, message) => {`,
    replace: `    const report = (rule, message) => {\n      if (errorsBefore > 0) return`,
  },
  {
    id: `skip-spelling-after-wrong-scope`,
    history: { constructed: `combined-faults` },
    law: `package naming`,
    find: `      if (wrongSpelling)`,
    replace: `      if (wrongSpelling && !wrongScope)`,
  },
  {
    id: `scope-probe-never-enters`,
    history: { constructed: `scope` },
    law: `reach agreement`,
    find: `globalThis.__oracleProbe?.('package-names#scope', true)`,
    replace: `globalThis.__oracleProbe?.('package-names#scope', false)`,
  },
  {
    id: `ignore-internal-collection-suffix`,
    history: { constructed: `internal-collection-tail` },
    law: `package naming`,
    find: `      if (wrongSuffix) {`,
    replace: `      if (wrongSuffix && !unscoped.startsWith('db-')) {`,
  },
  {
    id: `ignore-suffix-after-missing-db`,
    history: { constructed: `binding-collection-tail-missing-db` },
    law: `package naming`,
    find: `      if (wrongSuffix) {`,
    replace: `      if (wrongSuffix && !missingDb) {`,
  },
]

oracleProperty({
  id: `scripts.package-names`,
  owns: [`scripts/check-package-names.mjs`],
  law: {
    statement: `Every public package is checked and every applicable naming fault is reported, including combined faults and later invalid packages. Actual validation-branch entries agree with the independent naming model.`,
    authority: `CONTRIBUTING.md, Package names; maintainer requests 2026-11-27.`,
    limits: `One to four targets, four naming families, composed described edits, optional healthy/offline peers and ignored nested fixtures; no registry or adapter-runtime claim.`,
  },
  histories: {
    arbitrary,
    runs: 40,
    fixedSeeds: [27112026],
    states: states.map((state) => ({
      name: state,
      probe: `package-names#${state}`,
    })),
    constructed: constructions.map(({ name, state, build }) => ({
      name,
      enters: [state],
      build,
    })),
    fixed: [
      { name: `existing PowerSync package omits db`, history: legacy },
      { name: `valid workspace`, history: validWorkspace },
      { name: `one scope failure`, history: singleFailure },
      {
        name: `internal collection tail`,
        history: {
          ...validWorkspace,
          packages: [
            {
              stem: `task-collection`,
              family: `internal`,
              kind: `public`,
              faults: [],
            },
          ],
        },
      },
      {
        name: `binding collection tail without db`,
        history: {
          ...validWorkspace,
          packages: [
            {
              stem: `task-collection`,
              family: `binding`,
              kind: `public`,
              faults: [`missing-db`],
            },
          ],
        },
      },
      {
        name: `bare collection without a leading word`,
        history: {
          ...validWorkspace,
          packages: [
            {
              stem: `collection`,
              family: `binding`,
              kind: `public`,
              faults: [`missing-db`],
            },
          ],
        },
      },
      {
        name: `workspace prefix before bare collection`,
        history: {
          ...validWorkspace,
          packages: [
            validWorkspace.packages[0],
            {
              stem: `collection`,
              family: `binding`,
              kind: `public`,
              faults: [`missing-db`],
            },
          ],
        },
      },
    ],
  },
  model: expectedNaming,
  predict: predictedBranches,
  driver: (history, observe) => driveNaming(history, observe),
  check: (_history, trace, expected) =>
    differs(
      `process exit`,
      `package naming`,
      trace.find((entry) => entry.checkpoint === `process exit`)?.value,
      expected,
    ) ?? pass,
  probeHistories: Object.fromEntries(
    states.map((state) => [
      state,
      {
        entered: {
          constructed: constructions.find((entry) => entry.state === state)
            .name,
        },
        notEntered: {
          fixed:
            state === `valid` ||
            [`multiple-invalid-packages`, `combined-faults`].includes(state)
              ? `one scope failure`
              : `valid workspace`,
        },
      },
    ]),
  ),
  calibrations: [
    {
      name: `accepting a missing db word`,
      law: `package naming`,
      history: { fixed: `existing PowerSync package omits db` },
      corrupt: (trace) =>
        trace.map((entry) =>
          entry.checkpoint === `process exit`
            ? { ...entry, value: { status: 0, checked: 2, errors: [] } }
            : entry,
        ),
    },
    ...mutants.map((mutant) => ({
      name: mutant.id,
      law: mutant.law,
      history: mutant.history,
      driver: (history, observe) => driveNaming(history, observe, mutant),
    })),
  ],
})
