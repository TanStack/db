/**
 * Release notifications belong to the exact published version's changelog
 * section. The shared action's README promises one comment per contributing PR
 * and linked issue, aggregating their packages. The maintainer chose a local
 * copy on 2026-11-06 while upstream's prerelease parser is repaired.
 *
 * This owner judges selection and aggregation at the gh command boundary. All
 * Comment operations succeed and no earlier release comment exists. Lookup
 * failures must warn without suppressing unrelated notifications. It does not
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
// Numeric tuples span single/multiple digits. Added graphs distinguish shared,
// disjoint and absent issue edges, asymmetric package contributions and equal
// issue numbers in different repositories. Failed lookups remove only their
// own edges and produce a diagnostic. Heading collisions include generated
// suffixes that themselves collide with a later version heading.
// Only unique, plain ## version headings and same-repository PR links are legal;
// bracketed headings and foreign changelog PR links remain outside this grammar.
function versionRecord(core, pre = [], build = []) {
  return {
    name:
      core.join('.') +
      (pre.length ? `-${pre.join('.')}` : '') +
      (build.length ? `+${build.join('.')}` : ''),
    // Semantic tokens supply a base slug; the model assigns document-unique
    // anchors below. GitHub's rendered changelogs demonstrate suffix allocation.
    anchor:
      core.join('') +
      (pre.length ? `-${pre.join('').toLowerCase()}` : '') +
      build.join('').toLowerCase(),
    pre: pre.length > 0,
    build: build.length > 0,
  }
}

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
  ].map(([pre, build]) => versionRecord(core, pre, build))
}

const issue = (number, repository = 'TanStack/db') => ({ number, repository })
const issueUrl = ({ number, repository }) =>
  `https://github.com/${repository}/issues/${number}`

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
    edges: Object.fromEntries(
      sections.flatMap((section) =>
        section.prs.map((pr) => [pr, linked ? [issue(700), issue(701)] : []]),
      ),
    ),
    failedLookups: [],
    routing: linked ? 'shared' : 'none',
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

// Preserve every original history, then cross routing graphs with stable/build
// releases, both numeric cores and both section orders. Each graph has two
// package-specific PRs plus a PR shared by both packages.
function routedHistory(core, target, reverse, routing) {
  const input = history(core, target, reverse, false)
  const a = 200 + target
  const b = 300 + target
  const c = 400 + target
  input.routing = routing
  input.packages = input.packages.map((pkg, index) => ({
    ...pkg,
    sections: pkg.sections.map((section) => ({
      ...section,
      prs:
        section.name === input.version
          ? [index ? b : a, index ? b : a, c]
          : section.prs,
    })),
  }))
  input.edges = {
    [a]: [issue(700)],
    [b]:
      routing === 'disjoint'
        ? [issue(701)]
        : routing === 'shared'
          ? [issue(700), issue(701)]
          : [issue(700, 'TanStack/query')],
    [c]:
      routing === 'disjoint'
        ? [issue(702)]
        : routing === 'shared'
          ? []
          : [issue(700), issue(701, 'TanStack/query')],
  }
  return input
}
for (const core of [
  [1, 0, 0],
  [2, 9, 10],
]) {
  for (const target of [0, 5]) {
    for (const reverse of [false, true]) {
      for (const routing of ['disjoint', 'shared', 'foreign'])
        histories.push(routedHistory(core, target, reverse, routing))
    }
  }
  for (const failed of [202, 302, 402]) {
    const input = routedHistory(core, 2, false, 'shared')
    input.failedLookups = [failed]
    histories.push(input)
  }
}
// Two numeric releases collide, and their allocated suffix collides with a
// later prerelease's natural slug. Both orders and every selected position run.
const collidingVersions = [
  versionRecord([0, 11, 0]),
  versionRecord([0, 1, 10]),
  versionRecord([0, 11, 0], ['1']),
  versionRecord([0, 1, 10], ['1']),
]
for (const selected of collidingVersions) {
  for (const reverse of [false, true]) {
    const input = history([1, 0, 0], 0, reverse, true)
    input.version = selected.name
    input.pre = selected.pre
    input.build = selected.build
    input.packages = input.packages.map((pkg) => ({
      ...pkg,
      sections: (reverse
        ? [...collidingVersions].reverse()
        : collidingVersions
      ).map((v) => ({ ...v, prs: [200, 200, 300] })),
    }))
    histories.push(input)
  }
}

// Independent ledger judgment: authored releases determine PR contributions;
// authored per-PR edges determine each issue's union. Recipient identity is its
// repository plus number. Expected results never parse production Markdown or
// use production helpers. Anchor allocation chooses the first unused candidate
// from a finite list, rather than mirroring the production parser's loop.
function expectedNotifications(input) {
  const prs = new Map()
  let collision = false
  for (const pkg of input.packages) {
    const used = []
    for (const [position, section] of pkg.sections.entries()) {
      const anchor = Array.from(
        { length: position + 1 },
        (_, suffix) => section.anchor + (suffix ? `-${suffix}` : ''),
      ).find((candidate) => !used.includes(candidate))
      used.push(anchor)
      if (section.name !== input.version) continue
      collision ||= anchor !== section.anchor
      const link = `[${pkg.name}@${section.name}](https://github.com/TanStack/db/blob/main/packages/${pkg.name.slice('@tanstack/'.length)}/CHANGELOG.md#${anchor})`
      for (const pr of section.prs) {
        if (!prs.has(pr)) prs.set(pr, new Set())
        prs.get(pr).add(link)
      }
    }
  }
  const issueTargets = [
    ...new Set(
      [...prs.keys()]
        .filter((pr) => !input.failedLookups.includes(pr))
        .flatMap((pr) => (input.edges[pr] ?? []).map(issueUrl)),
    ),
  ]
  const comments = [
    ...[...prs].map(([number, links]) => ({
      kind: 'pr',
      target: `https://github.com/TanStack/db/pull/${number}`,
      packages: [...links].sort(),
      prs: [],
    })),
    ...issueTargets.map((target) => {
      const contributors = [...prs.keys()].filter(
        (pr) =>
          !input.failedLookups.includes(pr) &&
          (input.edges[pr] ?? []).some((linked) => issueUrl(linked) === target),
      )
      return {
        kind: 'issue',
        target,
        packages: [
          ...new Set(contributors.flatMap((pr) => [...prs.get(pr)])),
        ].sort(),
        prs: contributors
          .map((pr) => `https://github.com/TanStack/db/pull/${pr}`)
          .sort(),
      }
    }),
  ].sort(orderNotifications)
  return {
    comments,
    lookupFailures: [...prs.keys()]
      .filter((pr) => input.failedLookups.includes(pr))
      .sort((a, b) => a - b),
    collision,
  }
}

function orderNotifications(a, b) {
  return a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target)
}

function checkNotifications(input, calls, stderr) {
  const expected = expectedNotifications(input)
  const actual = calls
    .filter((args) => args[1] === 'comment')
    .map((args) => {
      const body = args[args.indexOf('--body') + 1]
      const target = args[2].startsWith('https://')
        ? args[2]
        : `https://github.com/TanStack/db/${args[0] === 'pr' ? 'pull' : 'issues'}/${args[2]}`
      const repository = new URL(target).pathname
        .split('/')
        .slice(1, 3)
        .join('/')
      return {
        kind: args[0],
        target,
        packages: [...body.matchAll(/\[@tanstack\/[^\]]+\]\([^\n]+?\)/g)]
          .map((m) => m[0])
          .sort(),
        prs:
          args[0] === 'issue'
            ? [
                ...body
                  .split('\n')[0]
                  .matchAll(
                    /https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+|#\d+/g,
                  ),
              ]
                .map(([ref]) =>
                  ref.startsWith('#')
                    ? `https://github.com/${repository}/pull/${ref.slice(1)}`
                    : ref,
                )
                .sort()
            : [],
      }
    })
    .sort(orderNotifications)
  // Keep both comparisons at the same exit checkpoint. The recorder preserves
  // duplicates, wrong targets and wrong package/PR unions; it sorts only order.
  // A bare #PR is relative to the receiving issue, so foreign issues require
  // a source-repository link rather than an ambiguous number.
  assert.deepEqual(
    actual,
    expected.comments,
    'release notifications after the script exits',
  )
  const diagnostics = [
    ...stderr.matchAll(/Warning: Could not find linked issues for PR #(\d+):/g),
  ]
    .map((match) => Number(match[1]))
    .sort((a, b) => a - b)
  assert.deepEqual(
    diagnostics,
    expected.lookupFailures,
    'lookup failure diagnostics after the script exits',
  )
  if (diagnostics.length)
    assert.ok(
      stderr.includes('controlled lookup failure'),
      'diagnostic retains the lookup cause',
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
    'asymmetric contributions',
    'disjoint issue edges',
    'shared issue edges',
    'foreign issue targets',
    'same-number foreign issues',
    'lookup failure',
    'colliding heading anchor',
  ].map((state) => [state, 0]),
)
const script =
  process.env.TANSTACK_DB_RELEASE_COMMENT_SCRIPT ??
  fileURLToPath(new URL('./comment-on-release.ts', import.meta.url))

// Run the actual executable in a disposable workspace. The fake gh supplies
// per-PR API answers or selected lookup failures and records full argv.
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
  const pr = Number(args.find((arg) => arg.startsWith('pr=')).slice(3))
  if (JSON.parse(process.env.RELEASE_COMMENT_FAILURES).includes(pr)) {
    console.error('controlled lookup failure')
    process.exit(1)
  }
  const linked = JSON.parse(process.env.RELEASE_COMMENT_EDGES)[pr] ?? []
  const projection = args[args.indexOf('--jq') + 1]
  if (projection.endsWith('nodes[].number')) console.log(linked.map((i) => i.number).join('\\n'))
  else if (projection.endsWith('nodes[].url')) console.log(linked.map((i) => 'https://github.com/' + i.repository + '/issues/' + i.number).join('\\n'))
  else throw Error('Unexpected GraphQL projection')
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
        RELEASE_COMMENT_EDGES: JSON.stringify(input.edges),
        RELEASE_COMMENT_FAILURES: JSON.stringify(input.failedLookups),
      },
    })
    assert.equal(result.status, 0, result.stderr)
    const recorded = readFileSync(calls, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const states = [
      input.pre ? 'prerelease' : 'stable',
      Object.values(input.edges).some((edges) => edges.length)
        ? 'linked issues'
        : 'no linked issues',
    ]
    if (input.build) states.push('build metadata')
    if (input.reverse) states.push('reversed sections')
    const expected = expectedNotifications(input)
    if (expected.comments.length === 0) states.push('no matching PRs')
    if (input.routing === 'disjoint') states.push('disjoint issue edges')
    if (
      input.routing === 'shared' &&
      expected.comments.some((c) => c.kind === 'issue')
    )
      states.push('shared issue edges')
    if (
      ['disjoint', 'shared', 'foreign'].includes(input.routing) &&
      expected.comments.some((c) => c.kind === 'pr' && c.packages.length === 1)
    )
      states.push('asymmetric contributions')
    if (expected.comments.some((c) => c.target.includes('TanStack/query/')))
      states.push('foreign issue targets')
    if (
      expected.comments.some((c) =>
        c.target.endsWith('TanStack/db/issues/700'),
      ) &&
      expected.comments.some((c) =>
        c.target.endsWith('TanStack/query/issues/700'),
      )
    )
      states.push('same-number foreign issues')
    if (expected.lookupFailures.length) states.push('lookup failure')
    if (expected.collision) states.push('colliding heading anchor')
    for (const state of states) reach.set(state, reach.get(state) + 1)
    checkNotifications(input, recorded, result.stderr)
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
  test(`release-comments case ${index}: ${input.version}, reverse ${input.reverse}, issues ${Object.keys(input.edges).length}, packages ${input.packages.length}`, () =>
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
