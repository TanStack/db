// A migration baseline may only shrink after its initial adoption. Compare
// file identities with the merge-base; each file's lint pass checks its use.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'

const { values } = parseArgs({ options: { base: { type: `string` } } })
const root = process.cwd()
const git = (...args) =>
  execFileSync(`git`, args, { cwd: root, encoding: `utf8` }).trim()
const base = values.base ?? git(`merge-base`, `origin/main`, `HEAD`)
const file = `scripts/oracle-lint-settings.mjs`
const readSettings = async (source) =>
  (
    await import(
      `data:text/javascript;base64,${Buffer.from(source).toString(`base64`)}`
    )
  ).oracleLintSettings.oracles
const previous = await readSettings(git(`show`, `${base}:${file}`))
const current = await readSettings(readFileSync(resolve(root, file), `utf8`))

// Only the first gate commit may adopt a baseline. Removing the setting after
// the last conversion leaves an empty allowed set, so it cannot be restarted.
const gateExisted =
  git(
    `ls-tree`,
    `--name-only`,
    base,
    `--`,
    `scripts/check-legacy-oracle-campaigns.mjs`,
  ) !== ``
const allowed =
  previous?.legacyCampaigns === undefined && !gateExisted
    ? undefined
    : new Set((previous?.legacyCampaigns ?? []).map(({ file }) => file))
const added =
  allowed === undefined
    ? []
    : [...new Set((current.legacyCampaigns ?? []).map(({ file }) => file))]
        .filter((file) => !allowed.has(file))
        .sort()
console.log(JSON.stringify({ added }))
if (added.length > 0) {
  console.error(`Legacy oracle campaigns may only shrink: ${added.join(`, `)}`)
  process.exitCode = 1
}
