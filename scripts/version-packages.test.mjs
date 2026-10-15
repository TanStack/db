import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  versionDuringRc,
  versionForRcRelease,
  versionOnRcExit,
} from './version-packages.mjs'

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function packageVersion(root, directory) {
  return JSON.parse(
    readFileSync(join(root, 'packages', directory, 'package.json'), 'utf8'),
  ).version
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
    },
    'offline-transactions': {
      name: '@tanstack/offline-transactions',
      version: '1.1.2',
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

  addChangeset(root, 'patch-three', { '@tanstack/db': 'patch' })
  addChangeset(root, 'minor-one', { '@tanstack/db': 'minor' })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.2')

  addChangeset(root, 'patch-four', { '@tanstack/db': 'patch' })
  await versionDuringRc(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0-rc.2.1')

  const preStatePath = join(root, '.changeset', 'pre.json')
  const preState = JSON.parse(readFileSync(preStatePath, 'utf8'))
  writeJson(preStatePath, { ...preState, mode: 'exit' })
  await versionOnRcExit(root)
  assert.equal(packageVersion(root, 'db'), '1.0.0')
  assert.equal(packageVersion(root, 'react-db'), '1.0.0')
  assert.equal(packageVersion(root, 'query-db-collection'), '1.4.6')
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
})
