import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  seedFirstCandidate,
  versionDuringRc,
  versionForRcRelease,
  versionOnRcExit,
} from './version-packages.mjs'

test('stable packages keep their release line and require a compatible DB API', () => {
  const firstRc = readFileSync(
    new URL('../.changeset/first-rc.md', import.meta.url),
    'utf8',
  )
  for (const [directory, bump, peer] of [
    ['query-db-collection', 'minor', '^0.15.0 || ^1.0.0-rc.0'],
    ['offline-transactions', 'minor', '^1.0.0-rc.0'],
  ]) {
    const manifest = JSON.parse(
      readFileSync(
        new URL(`../packages/${directory}/package.json`, import.meta.url),
        'utf8',
      ),
    )
    assert.equal(manifest.dependencies?.['@tanstack/db'], undefined)
    assert.equal(manifest.peerDependencies['@tanstack/db'], peer)
    assert.match(firstRc, new RegExp(`'${manifest.name}': ${bump}`))
  }
})

test('the first RC changeset covers the current public package inventory', () => {
  const packages = new URL('../packages/', import.meta.url)
  const entries = [
    ...readFileSync(
      new URL('../.changeset/first-rc.md', import.meta.url),
      'utf8',
    ).matchAll(/^'([^']+)': (major|minor|patch)$/gm),
  ]
  const publicPackages = readdirSync(packages).flatMap((directory) => {
    const path = new URL(`${directory}/package.json`, packages)
    if (!existsSync(path)) return []
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    return manifest.private ? [] : [manifest]
  })
  assert.deepEqual(
    entries.map((entry) => entry[1]).sort(),
    publicPackages.map((manifest) => manifest.name).sort(),
  )
  for (const manifest of publicPackages) {
    const bump = entries.find((entry) => entry[1] === manifest.name)[2]
    assert.equal(bump, manifest.version.startsWith('0.') ? 'major' : 'minor')
  }
})

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function packageVersion(root, directory) {
  return JSON.parse(
    readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
  ).version
}

function packageManifest(root, directory) {
  return JSON.parse(
    readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
  )
}

function addChangeset(root, id, releases) {
  const frontmatter = Object.entries(releases)
    .map(([name, type]) => `'${name}': ${type}`)
    .join('\n')
  writeFileSync(
    join(root, '.changeset', `${id}.md`),
    `---\n${frontmatter}\n---\n\nFixture change.\n`,
  )
}

function createRcWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'tanstack-db-rc-test-'))
  mkdirSync(join(root, '.changeset'))
  mkdirSync(join(root, 'examples', 'app'), { recursive: true })
  mkdirSync(join(root, 'examples', 'no-version'), { recursive: true })
  writeJson(join(root, 'package.json'), {
    name: 'release-fixture',
    private: true,
    packageManager: 'pnpm@11.1.0',
  })
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n  - examples/*\n',
  )
  writeJson(join(root, '.changeset', 'config.json'), {
    changelog: false,
    commit: false,
    access: 'public',
    baseBranch: 'main',
    updateInternalDependencies: 'patch',
    fixed: [],
    linked: [],
    ignore: [],
    ___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH: {
      onlyUpdatePeerDependentsWhenOutOfRange: true,
    },
  })

  const packages = {
    db: { name: '@tanstack/db', version: '1.0.0-rc.1' },
    'react-db': {
      name: '@tanstack/react-db',
      version: '1.0.0-rc.1',
      dependencies: { '@tanstack/db': 'workspace:*' },
    },
    'query-db-collection': {
      name: '@tanstack/query-db-collection',
      version: '1.4.5',
      peerDependencies: { '@tanstack/db': '^0.15.0 || ^1.0.0-rc.0' },
    },
    'offline-transactions': {
      name: '@tanstack/offline-transactions',
      version: '1.1.2',
      peerDependencies: { '@tanstack/db': '^0.15.0 || ^1.0.0-rc.0' },
    },
  }
  for (const [directory, manifest] of Object.entries(packages)) {
    mkdirSync(join(root, 'packages', directory), { recursive: true })
    writeJson(join(root, 'packages', directory, 'package.json'), manifest)
  }
  writeJson(join(root, 'examples', 'app', 'package.json'), {
    name: 'release-fixture-app',
    version: '0.1.0',
    private: true,
    dependencies: { '@tanstack/db': 'workspace:*' },
  })
  writeJson(join(root, 'examples', 'no-version', 'package.json'), {
    name: 'release-fixture-no-version',
    private: true,
  })
  writeJson(join(root, '.changeset', 'pre.json'), {
    mode: 'pre',
    tag: 'rc',
    initialVersions: {
      'release-fixture-app': '0.1.0',
      '@tanstack/db': '1.0.0-rc.0',
      '@tanstack/react-db': '1.0.0-rc.0',
      '@tanstack/query-db-collection': '1.4.5',
      '@tanstack/offline-transactions': '1.1.2',
    },
    changesets: ['first-rc'],
  })
  addChangeset(root, 'first-rc', {
    '@tanstack/db': 'major',
    '@tanstack/react-db': 'major',
  })
  return root
}

function createFirstCandidateWorkspace() {
  const root = createRcWorkspace()
  unlinkSync(join(root, '.changeset', 'pre.json'))
  for (const [directory, version] of [
    ['db', '0.15.0'],
    ['react-db', '0.5.10'],
  ]) {
    const path = join(root, 'packages', directory, 'package.json')
    writeJson(path, { ...packageManifest(root, directory), version })
  }
  addChangeset(root, 'first-rc', {
    '@tanstack/db': 'major',
    '@tanstack/react-db': 'major',
    '@tanstack/query-db-collection': 'minor',
    '@tanstack/offline-transactions': 'patch',
  })
  return root
}

function enterFixturePreMode(root) {
  writeJson(join(root, '.changeset', 'pre.json'), {
    mode: 'pre',
    tag: 'rc',
    initialVersions: {
      '@tanstack/db': '1.0.0-rc.0',
      '@tanstack/react-db': '1.0.0-rc.0',
      '@tanstack/query-db-collection': '1.4.5',
      '@tanstack/offline-transactions': '1.1.2',
    },
    changesets: [],
  })
}

test('the first RC versions mixed and stable-only changesets without changing stable major lines', async (t) => {
  const root = createFirstCandidateWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  addChangeset(root, 'mixed', {
    '@tanstack/db': 'patch',
    '@tanstack/query-db-collection': 'patch',
  })
  addChangeset(root, 'stable-only', {
    '@tanstack/offline-transactions': 'patch',
  })

  await seedFirstCandidate(root, () => enterFixturePreMode(root))

  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.1')
  assert.equal(packageVersion(root, 'react-db'), '1.0.0-rc.1')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.5.0')
  assert.equal(packageVersion(root, 'offline-transactions'), '1.1.3')
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, '.changeset', 'pre.json'))).changesets,
    ['first-rc', 'mixed', 'stable-only'],
  )
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, '.changeset', 'config.json'))).ignore,
    [],
  )
})

test('the first RC rejects a major bump for an already-1.x package before changing files', async (t) => {
  const root = createFirstCandidateWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, '.changeset', 'first-rc.md')
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace(
      "'@tanstack/query-db-collection': minor",
      "'@tanstack/query-db-collection': major",
    ),
  )
  await assert.rejects(seedFirstCandidate(root), /patch or minor/)
  assert.equal(packageVersion(root, 'db'), '0.15.0')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.5')
  assert.equal(existsSync(join(root, '.changeset', 'pre.json')), false)
})

test('a failed first RC restores versions, config, changelogs, and pre-state', async (t) => {
  const root = createFirstCandidateWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  addChangeset(root, 'bad-package', { '@tanstack/not-in-workspace': 'patch' })
  const paths = [
    join(root, '.changeset', 'config.json'),
    ...['db', 'react-db', 'query-db-collection', 'offline-transactions'].map(
      (directory) => join(root, 'packages', directory, 'package.json'),
    ),
  ]
  const originalFiles = paths.map((path) => readFileSync(path, 'utf8'))

  await assert.rejects(
    seedFirstCandidate(root, () => enterFixturePreMode(root)),
    /not in the workspace/,
  )
  assert.deepEqual(
    paths.map((path) => readFileSync(path, 'utf8')),
    originalFiles,
  )
  assert.equal(existsSync(join(root, '.changeset', 'pre.json')), false)
  assert.equal(existsSync(join(root, 'packages', 'db', 'CHANGELOG.md')), false)
})

test('RC exit retains a dependent bump when a stable package pins db directly', async (t) => {
  const root = createRcWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const path = join(root, 'packages', 'query-db-collection', 'package.json')
  const manifest = packageManifest(root, 'query-db-collection')
  delete manifest.peerDependencies
  manifest.dependencies = { '@tanstack/db': 'workspace:*' }
  writeJson(path, manifest)
  const preStatePath = join(root, '.changeset', 'pre.json')
  writeJson(preStatePath, {
    ...JSON.parse(readFileSync(preStatePath, 'utf8')),
    mode: 'exit',
  })

  await versionOnRcExit(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.6')
})

test('RC exit applies only pending stable changesets after a consumed minor', async (t) => {
  const root = createRcWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  addChangeset(root, 'consumed-minor', {
    '@tanstack/query-db-collection': 'minor',
  })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'query-db-collection'), '1.5.0')

  addChangeset(root, 'pending-patch', {
    '@tanstack/query-db-collection': 'patch',
  })
  const preStatePath = join(root, '.changeset', 'pre.json')
  writeJson(preStatePath, {
    ...JSON.parse(readFileSync(preStatePath, 'utf8')),
    mode: 'exit',
  })
  await versionOnRcExit(root)
  assert.equal(packageVersion(root, 'query-db-collection'), '1.5.1')
  assert.equal(existsSync(join(root, '.changeset', 'consumed-minor.md')), false)
  assert.equal(existsSync(join(root, '.changeset', 'pending-patch.md')), false)
})

test('RC version numbers follow the Changeset release type', () => {
  const version = (oldVersion, type, newVersion = '1.0.0-rc.2') =>
    versionForRcRelease({
      name: '@tanstack/db',
      oldVersion,
      newVersion,
      type,
    })

  assert.equal(version('1.0.0-rc.1', 'patch'), '1.0.0-rc.1.1')
  assert.equal(version('1.0.0-rc.1.1', 'patch'), '1.0.0-rc.1.2')
  assert.equal(version('1.0.0-rc.1.2', 'minor'), '1.0.0-rc.2')
  assert.equal(version('1.0.0-rc.2', 'patch'), '1.0.0-rc.2.1')
  assert.equal(version('1.0.0-rc.2.1', 'major'), '1.0.0-rc.3')
  assert.equal(version('1.4.5', 'patch', '1.4.6-rc.0'), '1.4.6')
  assert.equal(version('1.1.2', 'minor', '1.2.0-rc.0'), '1.2.0')
  assert.throws(
    () => version('0.9.0', 'patch'),
    /Cannot calculate an RC version/,
  )
})

test('RC versioning consumes Changesets while preserving stable and private packages', async (t) => {
  const root = createRcWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))

  addChangeset(root, 'patch-one', {
    '@tanstack/db': 'patch',
    '@tanstack/query-db-collection': 'patch',
    '@tanstack/offline-transactions': 'patch',
  })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.1.1')
  assert.equal(packageVersion(root, 'react-db'), '1.0.0-rc.1.1')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.6')
  assert.equal(packageVersion(root, 'offline-transactions'), '1.1.3')
  assert.equal(
    JSON.parse(readFileSync(join(root, 'examples', 'app', 'package.json')))
      .version,
    '0.1.0',
  )

  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.1.1')
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, '.changeset', 'pre.json'))).changesets,
    ['first-rc', 'patch-one'],
  )

  addChangeset(root, 'patch-two', { '@tanstack/db': 'patch' })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.1.2')
  assert.equal(packageVersion(root, 'react-db'), '1.0.0-rc.1.2')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.6')
  assert.equal(packageVersion(root, 'offline-transactions'), '1.1.3')

  addChangeset(root, 'patch-three', { '@tanstack/db': 'patch' })
  addChangeset(root, 'minor-one', { '@tanstack/db': 'minor' })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.2')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.6')

  addChangeset(root, 'patch-four', { '@tanstack/db': 'patch' })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.2.1')

  addChangeset(root, 'stable-on-exit', {
    '@tanstack/query-db-collection': 'patch',
  })
  const preStatePath = join(root, '.changeset', 'pre.json')
  const preState = JSON.parse(readFileSync(preStatePath, 'utf8'))
  writeJson(preStatePath, { ...preState, mode: 'exit' })
  await versionOnRcExit(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0')
  assert.equal(packageVersion(root, 'react-db'), '1.0.0')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.7')
  assert.equal(packageVersion(root, 'offline-transactions'), '1.1.3')
  assert.equal(
    JSON.parse(
      readFileSync(join(root, 'examples', 'no-version', 'package.json')),
    ).version,
    undefined,
  )
  assert.equal(existsSync(preStatePath), false)
  assert.equal(existsSync(join(root, '.changeset', 'first-rc.md')), false)
  assert.equal(existsSync(join(root, '.changeset', 'patch-one.md')), false)
  assert.equal(existsSync(join(root, '.changeset', 'stable-on-exit.md')), false)
})
