import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPackages } from '@manypkg/get-packages'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const candidateVersion = /^1\.0\.0-rc\.\d+(?:\.\d+)?$/
const stableVersion = /^\d+\.\d+\.\d+$/

function publishChangesets(rootDirectory, publication) {
  const flags = publication ? ['--tag', publication.tag] : []
  execFileSync('pnpm', ['exec', 'changeset', 'publish', ...flags], {
    cwd: rootDirectory,
    stdio: 'inherit',
    ...(publication
      ? {
          env: {
            ...process.env,
            npm_config_tag: publication.version,
            NPM_CONFIG_TAG: publication.version,
          },
        }
      : {}),
  })
}

async function publishWithHiddenPackages(
  rootDirectory,
  hiddenPackages,
  publication,
  publishCommand,
) {
  const originals = hiddenPackages.map(({ dir }) => {
    const path = join(dir, 'package.json')
    return { path, contents: readFileSync(path) }
  })
  const preStatePath = join(rootDirectory, '.changeset', 'pre.json')
  const preState = readFileSync(preStatePath)

  try {
    for (const { path, contents } of originals) {
      const manifest = JSON.parse(contents.toString())
      writeFileSync(
        path,
        `${JSON.stringify({ ...manifest, private: true }, null, 2)}\n`,
      )
    }
    unlinkSync(preStatePath)
    await publishCommand(rootDirectory, publication)
  } finally {
    for (const { path, contents } of originals) writeFileSync(path, contents)
    writeFileSync(preStatePath, preState)
  }
}

/**
 * Publish stable versions first, then candidates, grouped by exact version.
 * npm reads that exact version even when dist-tags are missing or stale.
 * Uploads use latest under the maintainer's RC policy (CONTRIBUTING.md),
 * independently of the exact-version metadata selector. Existing versions
 * are skipped; promoting their tags requires a separate npm dist-tag command.
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

  const versions = new Set(
    [...stable, ...candidates].map(({ packageJson }) => packageJson.version),
  )
  for (const version of versions) {
    await publishWithHiddenPackages(
      rootDirectory,
      publicPackages.filter(
        ({ packageJson }) => packageJson.version !== version,
      ),
      { version, tag: 'latest' },
      publishCommand,
    )
  }
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
