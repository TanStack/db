import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const changesetPath = join(root, '.changeset', 'first-rc.md')
const configPath = join(root, '.changeset', 'config.json')

function run(command, args) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit' })
}

function packageManifests() {
  return readdirSync(join(root, 'packages')).flatMap((directory) => {
    const path = join(root, 'packages', directory, 'package.json')
    return existsSync(path)
      ? [{ path, value: JSON.parse(readFileSync(path, 'utf8')) }]
      : []
  })
}

function privateWorkspaceNames(directory) {
  const names = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (
      entry.isDirectory() &&
      !['node_modules', 'dist', 'build', '.next', '.output'].includes(
        entry.name,
      )
    ) {
      names.push(...privateWorkspaceNames(path))
    } else if (entry.isFile() && entry.name === 'package.json') {
      const manifest = JSON.parse(readFileSync(path, 'utf8'))
      if (manifest.private && typeof manifest.name === 'string') {
        names.push(manifest.name)
      }
    }
  }
  return names
}

function seedFirstCandidate() {
  const changeset = readFileSync(changesetPath, 'utf8')
  const releaseEntries = [
    ...changeset.matchAll(/^'([^']+)': (major|minor|patch)$/gm),
  ]
  const releaseNames = new Set(releaseEntries.map((match) => match[1]))
  const manifests = packageManifests()
  const preOne = manifests.filter(
    ({ value }) => !value.private && /^0\./.test(value.version),
  )
  const alreadyOne = manifests
    .filter(({ value }) => !value.private && /^1\./.test(value.version))
    .map(({ value }) => value.name)
  const expectedNames = new Set(preOne.map(({ value }) => value.name))
  if (
    releaseNames.size !== expectedNames.size ||
    releaseEntries.length !== releaseNames.size ||
    releaseEntries.some((match) => match[2] !== 'major') ||
    [...releaseNames].some((name) => !expectedNames.has(name))
  ) {
    throw new Error(
      'The first RC changeset must list every public pre-1.0 package exactly once.',
    )
  }

  const originalConfig = readFileSync(configPath, 'utf8')
  const config = JSON.parse(originalConfig)
  const ignored = new Set([
    ...config.ignore,
    ...alreadyOne,
    ...privateWorkspaceNames(join(root, 'packages')),
    ...privateWorkspaceNames(join(root, 'examples')),
  ])
  config.ignore = [...ignored]
  config.privatePackages = { version: false, tag: false }
  const removedDependencies = []

  for (const { path, value } of preOne) {
    // Changesets increments the existing prerelease counter to rc.1.
    value.version = '1.0.0-rc.0'
    // Changesets requires a package that depends on an ignored package to be
    // ignored too. Hide those edges only while calculating this RC release.
    for (const field of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const [index, [name, range]] of Object.entries(
        value[field] ?? {},
      ).entries()) {
        if (ignored.has(name)) {
          removedDependencies.push({ path, field, name, range, index })
          delete value[field][name]
        }
      }
    }
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)

  try {
    run('pnpm', ['exec', 'changeset', 'pre', 'enter', 'rc'])
    run('pnpm', ['exec', 'changeset', 'version'])
  } finally {
    writeFileSync(configPath, originalConfig)
    for (const { path, field, name, range, index } of removedDependencies) {
      const value = JSON.parse(readFileSync(path, 'utf8'))
      const entries = Object.entries(value[field])
      entries.splice(index, 0, [name, range])
      value[field] = Object.fromEntries(entries)
      writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
    }
  }
}

if (
  existsSync(changesetPath) &&
  !existsSync(join(root, '.changeset', 'pre.json'))
)
  seedFirstCandidate()
else run('pnpm', ['exec', 'changeset', 'version'])

run('pnpm', ['exec', 'tsx', 'scripts/update-example-deps.ts'])
run('pnpm', ['install', '--no-frozen-lockfile'])
