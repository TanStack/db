import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  classifyOwnershipCommand,
  hashOwnershipFile,
  ownershipCut,
  ownershipGroupRows,
  ownershipLimits,
  validateOwnershipRecipe,
  verifyOwnershipIdentity,
} from './ownership-parent.mjs'

// Pure instrument checks. Importing the parent never invokes its runner, a DB
// history, a QueryClient, a host receiving witness, or a generated campaign.
const facts = {
  heap: false,
  identityMatched: true,
  remainingGroup: 0,
  cleanupErrors: 0,
  exitCode: 0,
  signal: null,
}
const freeze = {
  worktree: '/tmp/selected-worktree',
  node: { executable: '/tmp/selected-node' },
  packages: { vitest: { resolved: '/tmp/selected-vitest' } },
}
const recipe = {
  kind: 'h02-ownership-neighbor',
  worktree: freeze.worktree,
  executable: freeze.node.executable,
  args: [
    '--max-old-space-size=384',
    '/tmp/selected-vitest/vitest.mjs',
    'run',
    '--config',
    'scripts/h02-progress/ownership-neighbor.config.ts',
    'packages/query-db-collection/tests/ownership-lifecycle.oracle.test.ts',
    '-t',
    "keeps a reacquired lease's result",
  ],
  limits: ownershipLimits,
  outputDirectory: '/tmp/unique-output',
}

test('selects only the original group and preserves child RSS', () => {
  assert.deepEqual(
    ownershipGroupRows(
      ['10 10 12 parent', '11 10 25 worker', '12 12 999 foreign'].join('\n'),
      10,
    ).map(({ pid, pgid, rssBytes }) => ({ pid, pgid, rssBytes })),
    [
      { pid: 10, pgid: 10, rssBytes: 12 * 1024 },
      { pid: 11, pgid: 10, rssBytes: 25 * 1024 },
    ],
  )
})
test('rejects invalid original groups and malformed matching rows', () => {
  for (const pgid of [0, -1, 1.5, NaN])
    assert.throws(() => ownershipGroupRows('', pgid))
  assert.throws(() => ownershipGroupRows('11 10 not-rss bad', 10))
})
test('keeps exact 60-second and sampled RSS boundaries', () => {
  assert.equal(
    ownershipCut(59999, ownershipLimits.groupRssBytes, false),
    undefined,
  )
  assert.equal(ownershipCut(60000, 0, false), 'wall')
  assert.equal(ownershipCut(0, ownershipLimits.groupRssBytes + 1, false), 'rss')
  assert.equal(
    ownershipCut(60000, ownershipLimits.groupRssBytes + 1, true),
    'heap',
  )
})
test('admits only the exact finite frozen command', () => {
  assert.deepEqual(validateOwnershipRecipe(recipe, freeze).args, recipe.args)
})
test('rejects broadened command and resource recipes', () => {
  const changes = [
    { kind: 'other' },
    { executable: '/tmp/other-node' },
    { worktree: '/tmp/other' },
    { args: [...recipe.args, '--no-file-parallelism'] },
    { args: ['--max-old-space-size=1536', ...recipe.args.slice(1)] },
    { args: [...recipe.args.slice(0, -1), 'all tests'] },
    ...Object.keys(ownershipLimits).map((key) => ({
      limits: { ...ownershipLimits, [key]: ownershipLimits[key] + 1 },
    })),
  ]
  for (const change of changes)
    assert.throws(() =>
      validateOwnershipRecipe({ ...recipe, ...change }, freeze),
    )
})
test('distinguishes normal assertion exits from operational failure', () => {
  assert.match(classifyOwnershipCommand(facts), /^finite test command passed/)
  assert.match(
    classifyOwnershipCommand({ ...facts, exitCode: 1 }),
    /^finite test command failed/,
  )
})
for (const [label, change] of [
  ['first wall trigger', { trigger: 'wall' }],
  [
    'late heap diagnostic after first wall trigger',
    { trigger: 'wall', heap: true },
  ],
  ['RSS trigger', { trigger: 'rss' }],
  ['observation failure', { observationError: 'recording failed' }],
  ['identity mismatch', { identityMatched: false }],
  ['remaining group', { remainingGroup: 1 }],
  ['leader exit with descendants even after cleanup', { cleanupErrors: 1 }],
  ['signal', { signal: 'SIGKILL' }],
  ['missing exit', { exitCode: null }],
]) {
  test('preserves operational failure: ' + label, () => {
    assert.equal(
      classifyOwnershipCommand({ ...facts, ...change }),
      'operational failure; no product verdict',
    )
  })
}
test('hashes exact bytes and verifies source, payload, locks, Node and reuse links', () => {
  const directory = realpathSync(
    mkdtempSync(join(tmpdir(), 'h02-ownership-pure-')),
  )
  try {
    const payload = join(directory, 'payload')
    const worktree = join(directory, 'worktree')
    mkdirSync(payload)
    mkdirSync(join(worktree, 'node_modules', '.pnpm'), { recursive: true })
    const files = {
      'production.ts': 'immutable production',
      'instrument.ts': 'successor instrumentation',
      'shared.ts': 'shared comparison',
      node: 'selected node bytes',
      'pnpm-lock.yaml': 'repository lock',
      'node_modules/.pnpm/lock.yaml': 'installed lock',
    }
    const hash = (value) => createHash('sha256').update(value).digest('hex')
    for (const [name, value] of Object.entries(files))
      writeFileSync(join(worktree, name), value)
    writeFileSync(join(payload, 'index.mjs'), 'frozen payload')
    symlinkSync(payload, join(worktree, 'node_modules', 'reused'), 'dir')
    assert.equal(
      hashOwnershipFile(join(worktree, 'production.ts')),
      hash(files['production.ts']),
    )
    const identity = {
      worktree,
      productionFiles: { 'production.ts': hash(files['production.ts']) },
      instrumentFiles: { 'instrument.ts': hash(files['instrument.ts']) },
      sharedInstrumentFiles: { 'shared.ts': hash(files['shared.ts']) },
      node: { executable: join(worktree, 'node'), sha256: hash(files.node) },
      lockfiles: {
        repoPnpmLock: hash(files['pnpm-lock.yaml']),
        installedPnpmLock: hash(files['node_modules/.pnpm/lock.yaml']),
      },
      dependencyReuseLinks: {
        'node_modules/reused': { isSymlink: true, resolved: payload },
      },
      packages: {
        fixture: {
          resolved: payload,
          regularPayloadFilesMap: { 'index.mjs': hash('frozen payload') },
        },
      },
    }
    assert.deepEqual(verifyOwnershipIdentity(identity), {
      diskSourcesMatched: 3,
      payloadFilesMatched: 1,
      nodeAndLocksAndLinksMatched: true,
    })
    writeFileSync(join(worktree, 'instrument.ts'), 'changed')
    assert.throws(
      () => verifyOwnershipIdentity(identity),
      /source identity differs/,
    )
    writeFileSync(join(worktree, 'instrument.ts'), files['instrument.ts'])
    writeFileSync(join(payload, 'index.mjs'), 'changed')
    assert.throws(
      () => verifyOwnershipIdentity(identity),
      /dependency payload differs/,
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
