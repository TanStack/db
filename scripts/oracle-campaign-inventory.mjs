// Survey the shrinking migration baseline using the package's own classifier.
// Shape and fixed-history flags are planning hints; conversion still reads
// each law, grammar, driver, comparison, and its gap reports.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { Linter } from 'eslint'
import parser from '@typescript-eslint/parser'
import rule from '@tanstack/eslint-plugin-oracles/rules/oracle-property-only'
import { oracleLintSettings } from './oracle-lint-settings.mjs'

const linter = new Linter()
const settings = {
  oracles: { ...oracleLintSettings.oracles, legacyCampaigns: [] },
}
const paths = execFileSync(
  `git`,
  [`ls-files`, `--cached`, `--others`, `--exclude-standard`, `-z`],
  { encoding: `utf8` },
)
  .split(`\0`)
  .filter(
    (file) =>
      basename(file).includes(`oracle`) &&
      /\.(ts|tsx|js|jsx|mjs)$/.test(file) &&
      existsSync(file),
  )
const files = []
for (const file of new Set(paths)) {
  const source = readFileSync(file, `utf8`)
  const messages = linter.verify(
    source,
    [
      {
        files: [`**/*.{ts,tsx,js,jsx,mjs}`],
        languageOptions: { parser },
        plugins: { oracle: { rules: { 'oracle-property-only': rule } } },
        rules: { 'oracle/oracle-property-only': `error` },
        settings,
      },
    ],
    { filename: file },
  )
  if (messages.some((message) => message.fatal))
    throw new Error(JSON.stringify({ file, messages }))
  const legacy = messages.filter(
    (message) => message.ruleId === `oracle/oracle-property-only`,
  )
  if (legacy.length === 0) continue
  const imports = legacy.filter(
    (message) => message.messageId === `legacyImport`,
  )
  files.push({
    file,
    shape: imports.some((message) =>
      message.message.includes(`runOracleCampaign`),
    )
      ? `campaign helper`
      : imports.some((message) => message.message.includes(`createOracleReach`))
        ? `manual reach`
        : `raw campaign`,
    rawCalls: legacy.filter(
      (message) =>
        message.messageId === `rawCampaign` ||
        message.messageId === `rawProperty`,
    ).length,
    fixedHistoryCandidate:
      /\bexamples\s*:|\bfixedHistories\s*:|\bfixed\s*:\s*true/.test(source),
    oraclePropertyCandidate: /\boracleProperty\s*\(/.test(source),
  })
}
files.sort((left, right) => left.file.localeCompare(right.file))
const counts = (key) =>
  Object.fromEntries(
    [...new Set(files.map(key))]
      .sort()
      .map((value) => [
        value,
        files.filter((file) => key(file) === value).length,
      ]),
  )
console.log(
  JSON.stringify(
    {
      summary: {
        files: files.length,
        shapes: counts((file) => file.shape),
        packages: counts(({ file }) =>
          file.startsWith(`packages/`) ? file.split(`/`)[1] : `scripts`,
        ),
        fixedHistoryCandidates: files.filter(
          (file) => file.fixedHistoryCandidate,
        ).length,
        singleRawCall: files.filter((file) => file.rawCalls === 1).length,
        mixedOracleProperty: files.filter(
          (file) => file.oraclePropertyCandidate,
        ).length,
      },
      files,
    },
    null,
    2,
  ),
)
