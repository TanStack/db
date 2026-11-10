/**
 * The migration baseline may only shrink after adoption (AGENTS.md, "The
 * oracle migration and gap ratchet"). Its file names are exact identities.
 * Only the initial gate adoption has no baseline to grow. Once adopted, an
 * empty or removed list still forbids every addition. Reordering and removals
 * remain legal.
 *
 * The model classifies each file in a finite universe by membership at base
 * and head. The driver writes those lists into a real temporary Git checkout,
 * commits base, and runs the gate on the uncommitted head. It compares the
 * exact added files and exit status at process completion. The grammar varies
 * both sets, their order, the setting's presence, and the gate's presence at
 * base. An inherited pre-commit or prepare-commit-msg hook would block the
 * fixture commit; both must leave the gate's completed report unchanged.
 * The grammar also crosses those hooks with plain and strict CRLF global
 * configuration. Neither developer setting may decide fixture setup or the
 * gate report, including histories with no inherited hook. Every constructed
 * output also owes its declared state observations. The shared comparison
 * enforces them for seeded, generated, and shrunk builder outputs.
 * It excludes duplicate entries and malformed settings, which the lint plugin
 * owns. It does not judge the lint rule's legacy-use classifier or changes to
 * an entry's reason.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
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
  violation,
} from '../packages/db/tests/oracle-config.js'

const gate = fileURLToPath(
  new URL(`./check-legacy-oracle-campaigns.mjs`, import.meta.url),
)
const files = [
  `packages/db/tests/a-oracle.test.ts`,
  `packages/db/tests/a-oracle.test.tsx`,
  `packages/db/tests/b-oracle.test.ts`,
  `packages/react-db/tests/a-oracle.test.tsx`,
]
// The pinned framework associates only seeded constructions with their state
// requirements. Record declarations on every builder call, including generated
// and shrunk outputs. Fresh objects keep the association unambiguous; the
// driver independently reports which states the actual CLI history entered.
const constructionStates = new WeakMap()
const historyArbitrary = fc.record({
  adopted: fc.boolean(),
  enforced: fc.boolean(),
  base: fc.uniqueArray(fc.constantFrom(...files)),
  head: fc.uniqueArray(fc.constantFrom(...files)),
  hook: fc.constantFrom(`none`, `pre-commit`, `prepare-commit-msg`),
  globalConfig: fc.constantFrom(`plain`, `strict CRLF`),
})

// `adopted` maps to the setting's presence and `enforced` to the gate's presence
// at base. Either means adoption already happened; absent settings then mean
// no allowed files. A file contributes precisely when head contains it and
// the adopted base does not. Membership predicts rejection and the full report.
function expectedReport(history) {
  const added =
    history.adopted || history.enforced
      ? files
          .filter(
            (file) =>
              history.head.includes(file) &&
              !(history.adopted ? history.base : []).includes(file),
          )
          .sort()
      : []
  return {
    status: added.length > 0 ? 1 : 0,
    added,
    requiredStates: constructionStates.get(history) ?? [],
  }
}

function settings(entries) {
  return `export const oracleLintSettings = { oracles: {${entries === undefined ? `` : `legacyCampaigns: ${JSON.stringify(entries.map((file) => ({ file, reason: `migration` })))}`} } }\n`
}

function drive(history, observe) {
  const directory = mkdtempSync(join(tmpdir(), `oracle-campaign-baseline-`))
  const globalConfig = join(directory, `global.gitconfig`)
  const inheritedConfig = join(directory, `inherited.gitconfig`)
  const inheritedEnvironment = {
    ...process.env,
    GIT_CONFIG_GLOBAL: inheritedConfig,
  }
  const fixtureEnvironment = {
    ...inheritedEnvironment,
    GIT_CONFIG_GLOBAL: globalConfig,
  }
  const git = (...args) =>
    execFileSync(`git`, args, {
      cwd: directory,
      stdio: `pipe`,
      env: fixtureEnvironment,
    })
  const settingsFile = join(directory, `scripts/oracle-lint-settings.mjs`)
  try {
    writeFileSync(
      inheritedConfig,
      history.globalConfig === `strict CRLF`
        ? `[core]\n\tautocrlf = true\n\tsafecrlf = true\n`
        : ``,
    )
    mkdirSync(join(directory, `scripts`))
    git(`init`, `-q`)
    if (history.hook !== `none`) {
      const hookDirectory = join(directory, `inherited-hooks`)
      mkdirSync(hookDirectory)
      const hook = join(hookDirectory, history.hook)
      writeFileSync(
        hook,
        `#!/bin/sh\necho "blocking inherited hook" >&2\nexit 1\n`,
      )
      chmodSync(hook, 0o755)
      git(`config`, `--file`, globalConfig, `core.hooksPath`, hookDirectory)
    }
    writeFileSync(
      settingsFile,
      settings(history.adopted ? history.base : undefined),
    )
    if (history.enforced)
      writeFileSync(
        join(directory, `scripts/check-legacy-oracle-campaigns.mjs`),
        `// Previous gate exists.\n`,
      )
    git(`add`, `.`)
    git(
      `-c`,
      `user.name=Oracle`,
      `-c`,
      `user.email=oracle@example.com`,
      `-c`,
      `commit.gpgsign=false`,
      // This temporary commit establishes input data, so no developer hook
      // may decide whether the gate's production path runs.
      `-c`,
      `core.hooksPath=${join(directory, `.no-hooks`)}`,
      `commit`,
      `-qm`,
      `base`,
    )
    writeFileSync(settingsFile, settings(history.head))
    const result = spawnSync(process.execPath, [gate, `--base`, `HEAD`], {
      cwd: directory,
      encoding: `utf8`,
      timeout: 10_000,
      env: fixtureEnvironment,
    })
    if (result.error) throw result.error
    observe(`completed`, {
      status: result.status,
      ...JSON.parse(result.stdout),
    })
    if (history.hook !== `none`)
      observe(`reach`, `inherited ${history.hook} hook`)
    if (history.hook === `none` && history.globalConfig === `strict CRLF`)
      observe(`reach`, `strict global config without hooks`)
    if (
      history.adopted &&
      history.head.some(
        (file) => !(history.adopted ? history.base : []).includes(file),
      )
    )
      observe(`reach`, `addition`)
    if (
      history.adopted &&
      history.base.some((file) => !history.head.includes(file)) &&
      history.head.every((file) => history.base.includes(file))
    )
      observe(`reach`, `removal`)
    if (history.adopted && history.base.length === 0 && history.head.length > 0)
      observe(`reach`, `empty baseline addition`)
    if (!history.adopted && !history.enforced) observe(`reach`, `adoption`)
    if (!history.adopted && history.enforced && history.head.length > 0)
      observe(`reach`, `retired baseline addition`)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function checkReport(_history, trace, expected) {
  const completed = trace.find(({ checkpoint }) => checkpoint === `completed`)
  if (!completed)
    return violation(`completed`, `the gate did not complete`, `only shrinks`)
  const mismatch = differs(`completed`, `only shrinks`, completed.value, {
    status: expected.status,
    added: expected.added,
  })
  if (mismatch) return mismatch
  const reached = new Set(
    trace
      .filter(({ checkpoint }) => checkpoint === `reach`)
      .map(({ value }) => value),
  )
  const missing = expected.requiredStates.filter((state) => !reached.has(state))
  // Completeness is known only after the driver returns. An unrecorded
  // checkpoint keeps a driver failure primary when it cuts this trace short.
  return missing.length > 0
    ? violation(
        `constructed states`,
        `constructed history did not enter ${missing.join(`, `)}`,
        `constructed reach`,
      )
    : pass
}

oracleProperty({
  id: `scripts.legacy-campaign-baseline`,
  law: {
    statement: `After adoption, the legacy campaign baseline only shrinks by exact file identity.`,
    authority: `AGENTS.md: The oracle migration and gap ratchet; maintainer decision 2026-11-10 (handoff).`,
    limits: `Four file names, including a shared stem and cross-package names; valid unique entries; no reason changes or lint classification.`,
    owner: `Small structures and test mechanics`,
  },
  histories: {
    arbitrary: historyArbitrary,
    runs: 20,
    fixedSeeds: [20261110],
    states: [
      `addition`,
      `empty baseline addition`,
      `retired baseline addition`,
      `removal`,
      `adoption`,
      `inherited pre-commit hook`,
      `inherited prepare-commit-msg hook`,
      `strict global config without hooks`,
    ],
    constructed: [
      {
        name: `cannot restart a removed baseline`,
        enters: [`retired baseline addition`],
        build: (h) => ({
          ...h,
          adopted: false,
          enforced: true,
          head: [files[0], ...h.head.filter((file) => file !== files[0])],
        }),
      },
      {
        name: `adds after the last conversion`,
        enters: [`addition`, `empty baseline addition`],
        build: (h) => ({
          ...h,
          adopted: true,
          base: [],
          head: [files[0], ...h.head.filter((file) => file !== files[0])],
        }),
      },
      {
        name: `adds a new file`,
        enters: [`addition`],
        build: (h) => ({
          ...h,
          adopted: true,
          base: h.base.filter((file) => file !== files[0]),
          head: [files[0], ...h.head.filter((file) => file !== files[0])],
        }),
      },
      {
        name: `removes a file`,
        enters: [`removal`],
        build: (h) => ({
          ...h,
          adopted: true,
          base: [files[0], ...h.base.filter((file) => file !== files[0])],
          head: h.head.filter(
            (file) => file !== files[0] && h.base.includes(file),
          ),
        }),
      },
      {
        name: `initial adoption`,
        enters: [`adoption`],
        build: (h) => ({ ...h, adopted: false, enforced: false }),
      },
      {
        name: `strict global config without hooks`,
        enters: [`strict global config without hooks`],
        build: (h) => ({ ...h, hook: `none`, globalConfig: `strict CRLF` }),
      },
      ...[`pre-commit`, `prepare-commit-msg`].map((hook) => ({
        name: `inherited ${hook} hook`,
        enters: [`inherited ${hook} hook`],
        build: (h) => ({ ...h, hook }),
      })),
    ].map((construction) => ({
      ...construction,
      build: (history) => {
        const built = construction.build(history)
        constructionStates.set(built, construction.enters)
        return built
      },
    })),
    fixed: [
      {
        name: `removed baseline stays closed`,
        history: {
          adopted: false,
          enforced: true,
          base: [],
          head: [files[0]],
          hook: `none`,
          globalConfig: `plain`,
        },
      },
    ],
  },
  model: expectedReport,
  driver: drive,
  check: checkReport,
  calibrations: [
    {
      name: `omits a constructed history's required state`,
      law: `constructed reach`,
      corrupt: (trace, history) => {
        const [required] = constructionStates.get(history) ?? []
        return required === undefined
          ? undefined
          : trace.filter(
              ({ checkpoint, value }) =>
                checkpoint !== `reach` || value !== required,
            )
      },
    },
    {
      name: `accepts an added legacy campaign`,
      law: `only shrinks`,
      corrupt: (trace) =>
        trace.some(
          ({ checkpoint, value }) =>
            checkpoint === `completed` && value.added.length > 0,
        )
          ? trace.map((entry) =>
              entry.checkpoint === `completed`
                ? { ...entry, value: { status: 0, added: [] } }
                : entry,
            )
          : undefined,
    },
  ],
})
