/**
 * Release notifications belong to the exact published version's changelog
 * section. The shared action's README promises one comment per contributing PR
 * and linked issue, aggregating their packages. The maintainer chose a local
 * copy on 2026-11-06 while upstream's prerelease parser is repaired.
 *
 * This owner judges selection and aggregation at the gh command boundary. All
 * Comment operations succeed. Earlier release comments suppress new posts. Lookup
 * failures must warn without suppressing unrelated notifications. It does not
 * establish GitHub authentication, delivery, linked-issue pagination beyond ten,
 * retries, or concurrent releases. Per the maintainer's 2026-11-06 decision,
 * failed existing-comment checks warn with recipient/cause and attempt posting
 * anyway. Duplicates after a failed check are allowed. The version/publish
 * ledger has a separate owner.
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
// The source repository and each package's published version can differ across
// histories. Issue lookup answers belong to the requested source repository.
// Authored references can include incidental foreign PRs or misleading labels;
// only source-repository PR URL identities contribute to the release ledger.
// Only unique, plain ## version headings are legal; bracketed headings remain
// outside this grammar.
/** Author a semantic version and its base GitHub heading anchor. */
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

/** Supply neighboring stable, prerelease and build versions for a numeric core. */
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

/** Author package sections and issue edges for one selected version. */
function history(core, target, reverse, linked) {
  const sections = versions(core).map((version, index) => ({
    ...version,
    prs: [200 + index, 200 + index, 300 + index],
  }))
  const selected = sections[target]
  return {
    repository: 'TanStack/db',
    existingComments: {},
    failedCommentChecks: [],
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

// Keep prior replay indexes stable. A second source repository distinguishes
// authored repository identity from a hardcoded default. Mixed publications
// distinguish each package's selected release from the first package's version.
for (const target of [0, 5]) {
  for (const reverse of [false, true]) {
    for (const routing of ['disjoint', 'foreign']) {
      const input = routedHistory([1, 0, 0], target, reverse, routing)
      input.repository = 'TanStack/query'
      histories.push(input)
    }
  }
}
for (const repository of ['TanStack/db', 'TanStack/query']) {
  for (const reverse of [false, true]) {
    for (const target of [0, 5]) {
      const input = routedHistory([1, 0, 0], target, reverse, 'foreign')
      input.repository = repository
      const other = history([2, 9, 10], target === 0 ? 2 : 0, reverse, false)
      const contributions = input.packages[1].sections.find(
        (section) => section.name === input.version,
      ).prs
      input.packages[1] = {
        ...other.packages[1],
        version: other.version,
        sections: other.packages[1].sections.map((section) => ({
          ...section,
          prs: section.name === other.version ? contributions : section.prs,
        })),
      }
      histories.push(input)
    }
  }
}

// Changeset text can mention another repository or display an arbitrary label.
// The ledger records actual source contributions; serialization adds references
// that must not create unrelated local recipients. Existing-comment pages vary
// independently for PR and issue recipients, including later-page matches.
for (const repository of ['TanStack/db', 'TanStack/query']) {
  for (const reverse of [false, true]) {
    for (const form of [
      'foreign alongside local',
      'label mismatch',
      'foreign only',
    ]) {
      const input = routedHistory([1, 0, 0], 0, reverse, 'foreign')
      input.repository = repository
      input.referenceForm = form
      input.packages = input.packages.map((pkg) => ({
        ...pkg,
        sections: pkg.sections.map((section) =>
          section.name !== input.version
            ? section
            : {
                ...section,
                prs: form === 'foreign only' ? [] : section.prs,
                references: [
                  ...(form === 'foreign only'
                    ? []
                    : section.prs.map((number) => ({
                        repository,
                        number,
                        label:
                          form === 'label mismatch' ? number + 1000 : number,
                      }))),
                  {
                    repository:
                      repository === 'TanStack/db'
                        ? 'TanStack/query'
                        : 'TanStack/db',
                    number: 200,
                    label: form === 'foreign only' ? 200 : 999,
                  },
                ],
              },
        ),
      }))
      histories.push(input)
    }
  }
  for (const kind of ['pr', 'issue']) {
    for (const pages of [[1], [0, 1], [0, 0, 1], [0, 0]]) {
      const input = routedHistory([1, 0, 0], 0, false, 'foreign')
      input.repository = repository
      const target =
        kind === 'pr'
          ? `https://github.com/${repository}/issues/200`
          : 'https://github.com/TanStack/db/issues/700'
      input.existingComments = { [target]: pages }
      histories.push(input)
    }
  }
}

// The maintainer chose to attempt posting after a failed duplicate check.
// Cross PR/issue failures with both repositories and partial page responses.
// A neighboring successful check still suppresses its existing notification.
for (const repository of ['TanStack/db', 'TanStack/query']) {
  for (const kind of ['pr', 'issue']) {
    for (const partialResponse of [false, true]) {
      const input = routedHistory([1, 0, 0], 0, false, 'foreign')
      input.repository = repository
      const pr = `https://github.com/${repository}/issues/200`
      const linked = 'https://github.com/TanStack/db/issues/700'
      const failed = kind === 'pr' ? pr : linked
      const sibling = kind === 'pr' ? linked : pr
      input.failedCommentChecks = [failed]
      input.partialCommentResponse = partialResponse
      input.existingComments = {
        [failed]: partialResponse ? [0, 1] : [0],
        [sibling]: [1],
      }
      histories.push(input)
    }
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
    const version = pkg.version ?? input.version
    const used = []
    for (const [position, section] of pkg.sections.entries()) {
      const anchor = Array.from(
        { length: position + 1 },
        (_, suffix) => section.anchor + (suffix ? `-${suffix}` : ''),
      ).find((candidate) => !used.includes(candidate))
      used.push(anchor)
      if (section.name !== version) continue
      collision ||= anchor !== section.anchor
      const link = `[${pkg.name}@${section.name}](https://github.com/${input.repository}/blob/main/packages/${pkg.name.slice('@tanstack/'.length)}/CHANGELOG.md#${anchor})`
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
  const contributions = [
    ...[...prs].map(([number, links]) => ({
      kind: 'pr',
      target: `https://github.com/${input.repository}/pull/${number}`,
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
          .map((pr) => `https://github.com/${input.repository}/pull/${pr}`)
          .sort(),
      }
    }),
  ]
  const commentCheckFailures = contributions
    .map((comment) => comment.target.replace('/pull/', '/issues/'))
    .filter((target) => input.failedCommentChecks.includes(target))
    .sort()
  const comments = contributions
    .filter(
      (comment) =>
        commentCheckFailures.includes(
          comment.target.replace('/pull/', '/issues/'),
        ) ||
        !(
          input.existingComments[
            comment.target.replace('/pull/', '/issues/')
          ] ?? []
        ).some((count) => count > 0),
    )
    .sort(orderNotifications)
  return {
    comments,
    lookupFailures: [...prs.keys()]
      .filter((pr) => input.failedLookups.includes(pr))
      .sort((a, b) => a - b),
    collision,
    prCount: prs.size,
    commentCheckFailures,
  }
}

/** Ignore notification ordering, which the release contract does not constrain. */
function orderNotifications(a, b) {
  return a.kind.localeCompare(b.kind) || a.target.localeCompare(b.target)
}

function checkNotifications(input, calls, stderr) {
  const expected = expectedNotifications(input)
  const actual = calls
    .filter((args) => args[1] === 'comment')
    .map((args) => {
      const body = args[args.indexOf('--body') + 1]
      // gh resolves a numeric recipient in --repo/-R when supplied, otherwise
      // in the checkout's repository. Retain explicit overrides in observations.
      const repositoryFlag = args.findIndex(
        (arg) => arg === '--repo' || arg === '-R',
      )
      const explicitRepository =
        repositoryFlag >= 0
          ? args[repositoryFlag + 1]
          : (args.find((arg) => arg.startsWith('--repo='))?.slice(7) ??
            args.find((arg) => arg.startsWith('-R'))?.slice(2))
      const recipientRepository = explicitRepository ?? input.repository
      const target = args[2].startsWith('https://')
        ? args[2]
        : `https://github.com/${recipientRepository}/${args[0] === 'pr' ? 'pull' : 'issues'}/${args[2]}`
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
  const failedChecks = [
    ...stderr.matchAll(
      /Warning: Could not check existing comments for (https:\/\/github\.com\/[^\s;]+); attempting to post anyway:/g,
    ),
  ]
    .map((match) => match[1])
    .sort()
  assert.deepEqual(
    failedChecks,
    expected.commentCheckFailures,
    'existing-comment failure diagnostics after the script exits',
  )
  if (failedChecks.length)
    assert.ok(
      stderr.includes('controlled existing-comment lookup failure'),
      'existing-comment diagnostic retains the error cause',
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
    'alternate source repository',
    'independent package versions',
    'foreign changelog reference',
    'label disagrees with PR URL',
    'existing release comment',
    'release comment on later page',
    'failed PR comment check',
    'failed issue comment check',
    'partial comment response before failure',
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
                (
                  s.references ??
                  s.prs.map((number) => ({
                    number,
                    label: number,
                    repository: input.repository,
                  }))
                )
                  .map(
                    (ref) =>
                      `- Fix ([#${ref.label}](https://github.com/${ref.repository}/pull/${ref.number}))\n`,
                  )
                  .join(''),
            )
            .join('\n') +
          `\n## Archive\n\n[#999](https://github.com/${input.repository}/pull/999)\n`,
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
  const owner = args.find((arg) => arg.startsWith('owner=')).slice(6)
  const repo = args.find((arg) => arg.startsWith('repo=')).slice(5)
  const sourceMatches = owner + '/' + repo === process.env.RELEASE_COMMENT_REPOSITORY
  if (sourceMatches && JSON.parse(process.env.RELEASE_COMMENT_FAILURES).includes(pr)) {
    console.error('controlled lookup failure')
    process.exit(1)
  }
  const linked = sourceMatches ? JSON.parse(process.env.RELEASE_COMMENT_EDGES)[pr] ?? [] : []
  const projection = args[args.indexOf('--jq') + 1]
  if (projection.endsWith('nodes[].number')) console.log(linked.map((i) => i.number).join('\\n'))
  else if (projection.endsWith('nodes[].url')) console.log(linked.map((i) => 'https://github.com/' + i.repository + '/issues/' + i.number).join('\\n'))
  else throw Error('Unexpected GraphQL projection')
} else if (args[0] === 'api' && args[1].endsWith('/comments')) {
  const target = 'https://github.com/' + args[1].slice('repos/'.length, -'/comments'.length)
  const pages = JSON.parse(process.env.RELEASE_COMMENT_EXISTING)[target] ?? [0]
  if (JSON.parse(process.env.RELEASE_COMMENT_CHECK_FAILURES).includes(target)) {
    if (process.env.RELEASE_COMMENT_PARTIAL_RESPONSE === 'true') console.log(pages[0])
    console.error('controlled existing-comment lookup failure')
    process.exit(1)
  }
  console.log((args.includes('--paginate') ? pages : pages.slice(0, 1)).join('\\n'))
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
          input.packages.map(({ name, version }) => ({
            name,
            version: version ?? input.version,
          })),
        ),
        REPOSITORY: input.repository,
        GITHUB_REPOSITORY: input.repository,
        RELEASE_COMMENT_REPOSITORY: input.repository,
        RELEASE_COMMENT_EXISTING: JSON.stringify(input.existingComments),
        RELEASE_COMMENT_CHECK_FAILURES: JSON.stringify(
          input.failedCommentChecks,
        ),
        RELEASE_COMMENT_PARTIAL_RESPONSE: String(
          input.partialCommentResponse ?? false,
        ),
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
    const selectedVersions = input.packages.length
      ? input.packages.map((pkg) => pkg.version ?? input.version)
      : [input.version]
    const expected = expectedNotifications(input)
    const states = []
    if (expected.comments.some((comment) => comment.kind === 'issue'))
      states.push('linked issues')
    else if (!Object.values(input.edges).some((edges) => edges.length))
      states.push('no linked issues')
    if (selectedVersions.some((version) => version.includes('-')))
      states.push('prerelease')
    if (selectedVersions.some((version) => !version.includes('-')))
      states.push('stable')
    if (selectedVersions.some((version) => version.includes('+')))
      states.push('build metadata')
    if (input.reverse) states.push('reversed sections')
    if (expected.prCount === 0) states.push('no matching PRs')
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
    if (
      expected.comments.some(
        (c) =>
          c.kind === 'issue' &&
          !c.target.startsWith(
            `https://github.com/${input.repository}/issues/`,
          ),
      )
    )
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
    if (input.repository !== 'TanStack/db')
      states.push('alternate source repository')
    if (
      new Set(input.packages.map((pkg) => pkg.version ?? input.version)).size >
      1
    )
      states.push('independent package versions')
    if (input.referenceForm) states.push('foreign changelog reference')
    if (input.referenceForm === 'label mismatch')
      states.push('label disagrees with PR URL')
    if (
      Object.values(input.existingComments).some((pages) =>
        pages.some((count) => count > 0),
      )
    )
      states.push('existing release comment')
    if (
      Object.values(input.existingComments).some(
        (pages) => pages[0] === 0 && pages.slice(1).some((count) => count > 0),
      )
    )
      states.push('release comment on later page')
    if (expected.commentCheckFailures.length) {
      states.push(
        input.failedCommentChecks[0] ===
          `https://github.com/${input.repository}/issues/200`
          ? 'failed PR comment check'
          : 'failed issue comment check',
      )
      if (input.partialCommentResponse)
        states.push('partial comment response before failure')
    }
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
