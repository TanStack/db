import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import applyReleasePlan from '@changesets/apply-release-plan'
import { read as readChangesetsConfig } from '@changesets/config'
import getReleasePlan from '@changesets/get-release-plan'
import { getPackages } from '@manypkg/get-packages'

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

/**
 * Changesets tracks which changesets were consumed and determines dependent
 * releases. Its prerelease counter does not distinguish patch from minor, so
 * replace only the planned version for each package during the RC window.
 */
export function versionForRcRelease(release) {
  if (release.type === 'none') return release.oldVersion

  const candidate = /^1\.0\.0-rc\.(\d+)(?:\.(\d+))?$/.exec(release.oldVersion)
  if (candidate) {
    const generation = Number(candidate[1])
    if (release.type === 'patch') {
      const patch = Number(candidate[2] ?? 0) + 1
      return `1.0.0-rc.${generation}.${patch}`
    }
    if (release.type === 'minor' || release.type === 'major') {
      return `1.0.0-rc.${generation + 1}`
    }
  }

  if (/^\d+\.\d+\.\d+$/.test(release.oldVersion)) {
    const stableVersion = release.newVersion.replace(/-rc\.0$/, '')
    if (/^\d+\.\d+\.\d+$/.test(stableVersion)) return stableVersion
  }

  throw new Error(
    `Cannot calculate an RC version for ${release.name}: ${release.oldVersion} (${release.type}).`,
  )
}

async function rcReleasePlan(rootDirectory) {
  const packages = await getPackages(rootDirectory)
  const config = await readChangesetsConfig(rootDirectory, packages)
  const releaseConfig = {
    ...config,
    privatePackages: { version: false, tag: false },
  }
  const plan = await getReleasePlan(rootDirectory, undefined, releaseConfig)
  return { packages, releaseConfig, plan }
}

export async function versionDuringRc(rootDirectory = root) {
  const { packages, releaseConfig, plan } = await rcReleasePlan(rootDirectory)
  if (plan.releases.length === 0) return

  for (const release of plan.releases) {
    release.newVersion = versionForRcRelease(release)
  }
  await applyReleasePlan(
    plan,
    packages,
    releaseConfig,
    undefined,
    rootDirectory,
  )
}

export async function versionOnRcExit(rootDirectory = root) {
  const { packages, releaseConfig, plan } = await rcReleasePlan(rootDirectory)
  // The release plan includes newly pending Changesets in its pre-state.
  // The saved pre-state identifies which Changesets were already versioned.
  const preState = JSON.parse(
    readFileSync(join(rootDirectory, '.changeset', 'pre.json'), 'utf8'),
  )
  const privatePackages = new Set(
    packages.packages
      .filter(({ packageJson }) => packageJson.private)
      .map(({ packageJson }) => packageJson.name),
  )
  const consumedChangesets = new Set(preState.changesets)
  const pendingStableNames = new Set(
    plan.changesets
      .filter(({ id }) => !consumedChangesets.has(id))
      .flatMap(({ releases }) =>
        releases.filter(({ type }) => type !== 'none').map(({ name }) => name),
      ),
  )
  plan.releases = plan.releases.filter((release) => {
    if (privatePackages.has(release.name)) return false
    if (/^1\.0\.0-rc\.\d+(?:\.\d+)?$/.test(release.oldVersion)) {
      release.newVersion = '1.0.0'
      return true
    }
    if (/^\d+\.\d+\.\d+$/.test(release.oldVersion)) {
      if (!pendingStableNames.has(release.name)) return false
      release.newVersion = versionForRcRelease(release)
      return true
    }
    throw new Error(
      `Cannot exit RC mode for ${release.name}: ${release.oldVersion}.`,
    )
  })
  if (plan.releases.length === 0) {
    throw new Error('No 1.0 RC packages found while exiting prerelease mode.')
  }
  await applyReleasePlan(
    plan,
    packages,
    releaseConfig,
    undefined,
    rootDirectory,
  )
}

async function main() {
  const preStatePath = join(root, '.changeset', 'pre.json')
  const preState = existsSync(preStatePath)
    ? JSON.parse(readFileSync(preStatePath, 'utf8'))
    : undefined
  if (existsSync(changesetPath) && preState === undefined) {
    seedFirstCandidate()
  } else if (preState?.mode === 'pre' && preState.tag === 'rc') {
    await versionDuringRc()
  } else if (preState?.mode === 'exit' && preState.tag === 'rc') {
    await versionOnRcExit()
  } else {
    run('pnpm', ['exec', 'changeset', 'version'])
  }

  run('pnpm', ['exec', 'tsx', 'scripts/update-example-deps.ts'])
  run('pnpm', ['install', '--no-frozen-lockfile'])
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
