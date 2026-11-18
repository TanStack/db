import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Compare inputs, not branch names: a release PR with a runtime change must
// still run the benchmark. Local workspace specifiers do not change the code
// that the installed link supplies; external resolutions remain significant.
export function normalizeBenchmarkInput(path, content) {
  if (content === null) return null
  if (path.endsWith('/CHANGELOG.md')) return ''
  if (path.endsWith('package.json')) {
    const { version: _version, ...manifest } = JSON.parse(content)
    return JSON.stringify(manifest)
  }
  if (path === 'pnpm-lock.yaml')
    return content.replace(
      /^( +)specifier: .*\n\1version: (link:.*)$/gm,
      '$1specifier: workspace\n$1version: $2',
    )
  return content
}

export function changedBenchmarkInputs(base, head) {
  const paths = execFileSync(
    'git',
    [
      'diff',
      '--name-only',
      '-z',
      base,
      head,
      '--',
      'packages/db',
      'packages/db-ivm',
      'scripts/bench',
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.npmrc',
      'patches',
      '.github/workflows/benchmark.yml',
      ':(glob)*config*',
    ],
    { encoding: 'utf8' },
  )
    .split('\0')
    .filter(Boolean)
  const read = (ref, path) => {
    const result = spawnSync('git', ['show', `${ref}:${path}`], {
      encoding: 'utf8',
    })
    if (result.status === 0) return result.stdout
    if (
      result.status === 128 &&
      /does not exist|exists on disk, but not in/.test(result.stderr)
    )
      return null
    throw new Error(`Cannot read ${ref}:${path}: ${result.stderr}`)
  }
  return paths.filter(
    (path) =>
      normalizeBenchmarkInput(path, read(base, path)) !==
      normalizeBenchmarkInput(path, read(head, path)),
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [base, head] = process.argv.slice(2)
  if (!base || !head) throw new Error('Usage: inputs-changed.mjs BASE HEAD')
  const changed = changedBenchmarkInputs(base, head)
  console.log(`changed=${changed.length > 0}`)
  console.error(
    changed.length > 0
      ? `Benchmark inputs changed: ${changed.join(', ')}`
      : 'Benchmark inputs are unchanged; no latency comparison is needed.',
  )
}
