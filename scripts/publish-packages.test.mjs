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
import { publishDuringRc } from './publish-packages.mjs'

function createWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'tanstack-db-publish-test-'))
  mkdirSync(join(root, '.changeset'))
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'release-fixture', private: true }),
  )
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
  writeFileSync(
    join(root, '.changeset', 'pre.json'),
    JSON.stringify({ mode: 'pre', tag: 'rc' }),
  )
  const manifests = [
    { name: '@tanstack/db', version: '1.0.0-rc.2' },
    { name: '@tanstack/query-db-collection', version: '1.4.6' },
    { name: '@tanstack/offline-transactions', version: '1.1.3' },
    { name: 'private-fixture', version: '0.1.0', private: true },
  ]
  for (const [index, manifest] of manifests.entries()) {
    const directory = join(root, 'packages', String(index))
    mkdirSync(directory, { recursive: true })
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
  }
  return root
}

function packageState(root) {
  return [0, 1, 2, 3].map((index) =>
    JSON.parse(
      readFileSync(join(root, 'packages', String(index), 'package.json')),
    ),
  )
}

test('RC publishing gives candidate and stable packages their own npm tags', async (t) => {
  const root = createWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const before = packageState(root)
  const phases = []

  await publishDuringRc(root, (_, publication) => {
    phases.push({
      publicNames: packageState(root)
        .filter((pkg) => !pkg.private)
        .map((pkg) => pkg.name),
      preMode: existsSync(join(root, '.changeset', 'pre.json')),
      ...publication,
    })
  })

  assert.deepEqual(phases, [
    {
      publicNames: ['@tanstack/query-db-collection'],
      preMode: false,
      version: '1.4.6',
      tag: 'latest',
    },
    {
      publicNames: ['@tanstack/offline-transactions'],
      preMode: false,
      version: '1.1.3',
      tag: 'latest',
    },
    {
      publicNames: ['@tanstack/db'],
      preMode: false,
      version: '1.0.0-rc.2',
      tag: 'rc',
    },
  ])
  assert.deepEqual(packageState(root), before)
  assert.equal(existsSync(join(root, '.changeset', 'pre.json')), true)
})

test('failed candidate publishing restores package manifests and prerelease state', async (t) => {
  const root = createWorkspace()
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const before = packageState(root)
  let phase = 0

  await assert.rejects(
    publishDuringRc(root, (_, publication) => {
      phase++
      if (publication.tag === 'rc') throw new Error('publish failed')
    }),
    /publish failed/,
  )
  assert.equal(phase, 3)
  assert.deepEqual(packageState(root), before)
  assert.equal(existsSync(join(root, '.changeset', 'pre.json')), true)
})
