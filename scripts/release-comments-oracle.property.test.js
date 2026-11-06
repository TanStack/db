/**
 * Release notifications belong to the exact published version's changelog
 * section. The shared action's README promises one comment per contributing PR
 * and linked issue, aggregating their packages. The maintainer chose a local
 * copy on 2026-11-06 while upstream's prerelease parser is repaired.
 *
 * This owner judges selection and aggregation at the gh command boundary. All
 * GitHub operations succeed and no earlier release comment exists. It does not
 * establish GitHub authentication, delivery, pagination, retries, or concurrent
 * release behavior. The version/publish ledger has a separate release owner.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, test } from 'vitest'
import { declareOracle } from '../packages/db/tests/oracle-declaration.js'

// The grammar authors structured releases before serializing Markdown. Removing
// version suffixes loses the reported RC witness; removing neighboring sections
// loses prefix/section-boundary witnesses. Reverse order distinguishes a target
// before and after its neighbors. Two packages and repeated links distinguish
// grouping from duplicate comments; linked/no-linked forms distinguish routing.
// Numeric tuples span single/multiple digits. Only unique, plain ## version
// headings and same-repository PR links are legal; bracketed headings and remote
// repository links are outside this bounded grammar.
function versions(core) {
  return [
    [[], []],
    [['rc', '1', '3'], []],
    [['rc', '1', '4'], []],
    [['rc', '1', '40'], []],
    [['beta', '2'], []],
    [
      ['rc', '1', '4'],
      ['build', '7'],
    ],
    [[], ['build', '7']],
    [[], ['BUILD', '7']],
  ].map(([pre, build]) => ({
    name:
      core.join('.') +
      (pre.length ? `-${pre.join('.')}` : '') +
      (build.length ? `+${build.join('.')}` : ''),
    // GitHub headings discard dots/plus and lowercase letters. Derive the
    // expected anchor from semantic tokens, without parsing production text.
    anchor:
      core.join('') +
      (pre.length ? `-${pre.join('').toLowerCase()}` : '') +
      build.join('').toLowerCase(),
    pre: pre.length > 0,
    build: build.length > 0,
  }))
}

function history(core, target, reverse, linked) {
  const sections = versions(core).map((version, index) => ({
    ...version,
    prs: [200 + index, 200 + index, 300 + index],
  }))
  const selected = sections[target]
  return {
    version: selected?.name ?? '9.9.9-rc.1',
    pre: selected?.pre ?? false,
    build: selected?.build ?? false,
    reverse,
    issues: linked ? [700, 701] : [],
    packages: ['@tanstack/db', '@tanstack/react-db'].map((name) => ({
      name,
      sections: reverse ? [...sections].reverse() : sections,
    })),
  }
}

const histories = [
  [1, 0, 0],
  [2, 9, 10],
].flatMap((core) =>
  Array.from({ length: 8 }, (_, target) => target).flatMap((target) =>
    [false, true].flatMap((reverse) =>
      [false, true].map((linked) => history(core, target, reverse, linked)),
    ),
  ),
)
histories.push(history([1, 0, 0], -1, false, true))
const empty = history([1, 0, 0], 2, false, true)
empty.packages = empty.packages.map((pkg) => ({
  ...pkg,
  sections: pkg.sections.map((section) => ({ ...section, prs: [] })),
}))
histories.push(empty, { ...empty, packages: [] })

// The independent ledger joins published versions to authored release records.
// It never scans Markdown or imports the action's parser/aggregation helpers.
// Sets collapse repeated references, but the actual recorder retains every
// command so a duplicate or extra notification remains observable.
function expectedNotifications(input) {
  const prs = new Map()
  for (const pkg of input.packages) {
    for (const section of pkg.sections.filter(
      (s) => s.name === input.version,
    )) {
      const link = `[${pkg.name}@${section.name}](https://github.com/TanStack/db/blob/main/packages/${pkg.name.slice('@tanstack/'.length)}/CHANGELOG.md#${section.anchor})`
      for (const pr of section.prs) {
        if (!prs.has(pr)) prs.set(pr, new Set())
        prs.get(pr).add(link)
      }
    }
  }
  const packages = [
    ...new Set([...prs.values()].flatMap((links) => [...links])),
  ].sort()
  return [
    ...[...prs].map(([number, links]) => ({
      kind: 'pr',
      number,
      packages: [...links].sort(),
      prs: [],
    })),
    ...input.issues
      .filter(() => prs.size > 0)
      .map((number) => ({
        kind: 'issue',
        number,
        packages,
        prs: [...prs.keys()].sort((a, b) => a - b),
      })),
  ].sort(orderNotifications)
}

function orderNotifications(a, b) {
  return a.kind.localeCompare(b.kind) || a.number - b.number
}

function checkNotifications(input, calls) {
  const actual = calls
    .filter((args) => args[1] === 'comment')
    .map((args) => {
      const body = args[args.indexOf('--body') + 1]
      return {
        kind: args[0],
        number: Number(args[2]),
        packages: [...body.matchAll(/\[@tanstack\/[^\]]+\]\([^\n]+?\)/g)]
          .map((m) => m[0])
          .sort(),
        prs:
          args[0] === 'issue'
            ? [...body.split('\n')[0].matchAll(/#(\d+)/g)]
                .map((m) => Number(m[1]))
                .sort((a, b) => a - b)
            : [],
      }
    })
    .sort(orderNotifications)
  assert.deepEqual(
    actual,
    expectedNotifications(input),
    'release notifications after the script exits',
  )
}

const reach = new Map(
  [
    'stable',
    'prerelease',
    'build metadata',
    'reversed sections',
    'linked issues',
    'no linked issues',
    'no matching PRs',
  ].map((state) => [state, 0]),
)
const script =
  process.env.TANSTACK_DB_RELEASE_COMMENT_SCRIPT ??
  fileURLToPath(new URL('./comment-on-release.ts', import.meta.url))

// Run the actual executable in a disposable workspace. The fake gh supplies
// successful API answers and records full argv for PR/issue comment commands.
// No network call or real comment is made. Compare before cleanup; retain the
// primary failure if removing the workspace fails too.
function exercise(input) {
  const root = mkdtempSync(join(tmpdir(), 'db-release-comments-'))
  const failures = []
  try {
    const bin = join(root, 'bin')
    const calls = join(root, 'calls.jsonl')
    mkdirSync(bin)
    writeFileSync(calls, '')
    for (const pkg of input.packages) {
      const directory = join(
        root,
        'packages',
        pkg.name.slice('@tanstack/'.length),
      )
      mkdirSync(directory, { recursive: true })
      writeFileSync(
        join(directory, 'CHANGELOG.md'),
        `# ${pkg.name}\n\n` +
          pkg.sections
            .map(
              (s) =>
                `## ${s.name}\n\n### Patch Changes\n\n` +
                s.prs
                  .map(
                    (pr) =>
                      `- Fix ([#${pr}](https://github.com/TanStack/db/pull/${pr}))\n`,
                  )
                  .join(''),
            )
            .join('\n') +
          '\n## Archive\n\n[#999](https://github.com/TanStack/db/pull/999)\n',
      )
    }
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env node
const { appendFileSync } = require('node:fs')
const args = process.argv.slice(2)
appendFileSync(process.env.RELEASE_COMMENT_CALLS, JSON.stringify(args) + '\\n')
if (args[0] === 'api' && args[1] === 'graphql') {
  console.log(JSON.parse(process.env.RELEASE_COMMENT_ISSUES).join('\\n'))
} else if (args[0] === 'api' && args[1].endsWith('/comments')) {
  console.log('0')
} else if ((args[0] === 'pr' || args[0] === 'issue') && args[1] === 'comment') {
} else {
  console.error('Unexpected gh call:', args)
  process.exit(1)
}
`,
      { mode: 0o755 },
    )
    const result = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30_000,
      env: {
        ...process.env,
        PATH: [bin, process.env.PATH].join(delimiter),
        PUBLISHED_PACKAGES: JSON.stringify(
          input.packages.map(({ name }) => ({ name, version: input.version })),
        ),
        REPOSITORY: 'TanStack/db',
        GITHUB_REPOSITORY: 'TanStack/db',
        RELEASE_COMMENT_CALLS: calls,
        RELEASE_COMMENT_ISSUES: JSON.stringify(input.issues),
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const recorded = readFileSync(calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const states = [
      input.pre ? 'prerelease' : 'stable',
      input.issues.length ? 'linked issues' : 'no linked issues',
    ]
    if (input.build) states.push('build metadata')
    if (input.reverse) states.push('reversed sections')
    if (expectedNotifications(input).length === 0)
      states.push('no matching PRs')
    for (const state of states) reach.set(state, reach.get(state) + 1)
    checkNotifications(input, recorded)
  } catch (error) {
    failures.push(error)
  }
  try {
    rmSync(root, { recursive: true, force: true })
  } catch (cleanup) {
    failures.push(cleanup)
  }
  if (failures.length > 1)
    throw new AggregateError(
      failures,
      'release comparison and cleanup failed',
      {
        cause: failures[0],
      },
    )
  if (failures.length === 1) throw failures[0]
}

declareOracle({
  model: [expectedNotifications],
  check: [checkNotifications],
  grammar: [histories],
})
const replay = process.env.TANSTACK_DB_RELEASE_COMMENT_CASE
if (
  replay !== undefined &&
  (!/^\d+$/.test(replay) || Number(replay) >= histories.length)
)
  throw new Error(
    'TANSTACK_DB_RELEASE_COMMENT_CASE must name an existing history index',
  )
for (const [index, input] of histories.entries()) {
  if (replay !== undefined && Number(replay) !== index) continue
  test(`release-comments case ${index}: ${input.version}, reverse ${input.reverse}, issues ${input.issues.length}, packages ${input.packages.length}`, () =>
    exercise(input))
}
afterAll(() => {
  process.stdout.write(
    `release-comments reach ${JSON.stringify(Object.fromEntries(reach))}\n`,
  )
  if (replay === undefined)
    for (const [state, count] of reach)
      assert.ok(count > 0, `unreached: ${state}`)
})
