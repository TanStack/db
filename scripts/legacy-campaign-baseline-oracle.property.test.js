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
 * base. It excludes duplicate entries and malformed settings, which the lint
 * plugin owns. It does not judge the lint rule's legacy-use classifier or
 * changes to an entry's reason.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const historyArbitrary = fc.record({
  adopted: fc.boolean(),
  enforced: fc.boolean(),
  base: fc.uniqueArray(fc.constantFrom(...files)),
  head: fc.uniqueArray(fc.constantFrom(...files)),
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
  return { status: added.length > 0 ? 1 : 0, added }
}

function settings(entries) {
  return `export const oracleLintSettings = { oracles: {${entries === undefined ? `` : `legacyCampaigns: ${JSON.stringify(entries.map((file) => ({ file, reason: `migration` })))}`} } }\n`
}

function drive(history, observe) {
  const directory = mkdtempSync(join(tmpdir(), `oracle-campaign-baseline-`))
  const git = (...args) =>
    execFileSync(`git`, args, { cwd: directory, stdio: `pipe` })
  const settingsFile = join(directory, `scripts/oracle-lint-settings.mjs`)
  try {
    mkdirSync(join(directory, `scripts`))
    git(`init`, `-q`)
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
      `commit`,
      `-qm`,
      `base`,
    )
    writeFileSync(settingsFile, settings(history.head))
    const result = spawnSync(process.execPath, [gate, `--base`, `HEAD`], {
      cwd: directory,
      encoding: `utf8`,
      timeout: 10_000,
    })
    if (result.error) throw result.error
    observe(`completed`, {
      status: result.status,
      ...JSON.parse(result.stdout),
    })
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
  for (const { checkpoint, value } of trace) {
    if (checkpoint === `completed`)
      return differs(checkpoint, `only shrinks`, value, expected) ?? pass
  }
  return violation(`completed`, `the gate did not complete`, `only shrinks`)
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
    ],
    fixed: [
      {
        name: `removed baseline stays closed`,
        history: { adopted: false, enforced: true, base: [], head: [files[0]] },
      },
    ],
  },
  model: expectedReport,
  driver: drive,
  check: checkReport,
  calibrations: [
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
