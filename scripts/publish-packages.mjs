import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPackages } from '@manypkg/get-packages'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidateVersion = /^1\.0\.0-rc\.\d+(?:\.\d+)?$/
const stableVersion = /^\d+\.\d+\.\d+$/

function publishChangesets(rootDirectory) {
  execFileSync('pnpm', ['exec', 'changeset', 'publish'], {
    cwd: rootDirectory,
    stdio: 'inherit',
  })
}

async function publishWithHiddenPackages(
  rootDirectory,
  hiddenPackages,
  hidePreState,
  publishCommand,
) {
  const originals = hiddenPackages.map(({ dir }) => {
    const path = join(dir, 'package.json')
    return { path, contents: readFileSync(path) }
  })
  const preStatePath = join(rootDirectory, '.changeset', 'pre.json')
  const preState = hidePreState ? readFileSync(preStatePath) : undefined

  try {
    for (const { path, contents } of originals) {
      const manifest = JSON.parse(contents.toString())
      writeFileSync(
        path,
        `${JSON.stringify({ ...manifest, private: true }, null, 2)}\n`,
      )
    }
    if (hidePreState) unlinkSync(preStatePath)
    await publishCommand(rootDirectory)
  } finally {
    for (const { path, contents } of originals) writeFileSync(path, contents)
    if (preState !== undefined) writeFileSync(preStatePath, preState)
  }
}

/**
 * Changesets uses the `rc` npm tag for every package while pre mode is active.
 * Publish stable compatibility patches first, then publish candidates.
 */
export async function publishDuringRc(
  rootDirectory = root,
  publishCommand = publishChangesets,
) {
  const { packages } = await getPackages(rootDirectory)
  const publicPackages = packages.filter(
    ({ packageJson }) => !packageJson.private,
  )
  const candidates = publicPackages.filter(({ packageJson }) =>
    candidateVersion.test(packageJson.version),
  )
  const stable = publicPackages.filter(({ packageJson }) =>
    stableVersion.test(packageJson.version),
  )
  if (
    candidates.length === 0 ||
    candidates.length + stable.length !== publicPackages.length
  ) {
    throw new Error(
      'RC publishing found a public package with an unexpected version.',
    )
  }

  if (stable.length > 0) {
    await publishWithHiddenPackages(
      rootDirectory,
      candidates,
      true,
      publishCommand,
    )
  }
  await publishWithHiddenPackages(rootDirectory, stable, false, publishCommand)
}

async function main() {
  const preStatePath = join(root, '.changeset', 'pre.json')
  const preState = existsSync(preStatePath)
    ? JSON.parse(readFileSync(preStatePath, 'utf8'))
    : undefined
  if (preState?.mode === 'pre' && preState.tag === 'rc') {
    await publishDuringRc()
  } else {
    publishChangesets(root)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main()
