#!/usr/bin/env node
/**
 * Compare the shipped size of packages with their merge-base on a base branch.
 *
 * Code weight is what users download and parse, so this measures minified
 * bundle bytes after gzip and brotli, not source lines: comments, names, and
 * formatting do not count. It builds each package with the same
 * `vite build --minify` that the Compressed size CI check uses, then compares
 * every `dist/esm` file.
 *
 * Usage:
 *   pnpm size:compare [--base origin/main] [--exact-base]
 *                     [--packages db,react-db,...] [--files] [--rebuild]
 *
 * The baseline is the merge-base with `--base` (as CI compares), built once in
 * a cached worktree under the OS temp directory. The working tree is rebuilt
 * in parallel, and a package whose sources did not change since its last
 * build is not rebuilt. The bytes include development-only error messages,
 * which production builds remove, so they overstate the shipped cost.
 */
import { execFile, execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { availableParallelism, tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { promisify } from 'node:util'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'

const run = promisify(execFile)
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1]
}
const flag = (name) => args.includes(`--${name}`)

const DEFAULT_PACKAGES = [
  `db`,
  `react-db`,
  `query-db-collection`,
  `electric-db-collection`,
  `powersync-db-collection`,
  `trailbase-db-collection`,
  `rxdb-db-collection`,
  `db-sqlite-persistence-core`,
]
// Built first, in order: the other packages resolve their types while their
// declarations build.
const PREREQUISITES = [`db-ivm`, `db`]

const root = execSync(`git rev-parse --show-toplevel`, {
  encoding: `utf8`,
}).trim()
const baseRef = option(`base`, `origin/main`)
const packages = option(`packages`, DEFAULT_PACKAGES.join(`,`)).split(`,`)
const git = (command) =>
  execSync(`git ${command}`, { cwd: root, encoding: `utf8` }).trim()
const baseSha = flag(`exact-base`)
  ? git(`rev-parse ${baseRef}`)
  : git(`merge-base HEAD ${baseRef}`)
const baseDir = join(
  tmpdir(),
  `tanstack-db-size-baseline-${baseSha.slice(0, 9)}`,
)

function walk(dir, keep, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, keep, out)
    else if (keep(name)) out.push(path)
  }
  return out
}

// A package's dist depends on its own sources and build config only: its
// dependencies are external to the bundle.
function sourceHash(dir, pkg) {
  const pkgDir = join(dir, `packages`, pkg)
  const hash = createHash(`sha256`)
  const files = [
    ...walk(join(pkgDir, `src`), () => true),
    ...[`vite.config.ts`, `package.json`, `tsconfig.json`]
      .map((name) => join(pkgDir, name))
      .filter(existsSync),
  ].sort()
  for (const file of files) {
    hash.update(relative(pkgDir, file))
    hash.update(readFileSync(file))
  }
  return hash.digest(`hex`)
}

async function buildPackage(dir, pkg, force) {
  const pkgDir = join(dir, `packages`, pkg)
  if (!existsSync(pkgDir)) return `missing`
  const stamp = join(pkgDir, `dist`, `.size-compare-hash`)
  const hash = sourceHash(dir, pkg)
  if (!force && existsSync(stamp) && readFileSync(stamp, `utf8`) === hash)
    return `cached`
  try {
    await run(`npx`, [`vite`, `build`, `--minify`], {
      cwd: pkgDir,
      maxBuffer: 1 << 28,
    })
  } catch (error) {
    const output = `${error.stderr ?? ``}${error.stdout ?? ``}`
    throw new Error(
      `vite build failed in packages/${pkg}:\n${output.split(`\n`).slice(0, 20).join(`\n`)}`,
    )
  }
  writeFileSync(stamp, hash)
  return `built`
}

async function build(dir, label, force) {
  const started = Date.now()
  const prerequisiteResults = {}
  for (const pkg of PREREQUISITES)
    prerequisiteResults[pkg] = await buildPackage(dir, pkg, force)
  // Packages build independently, so run them in parallel.
  const limit = Math.max(1, Math.floor(availableParallelism() / 2))
  const queue = packages.filter((pkg) => !PREREQUISITES.includes(pkg))
  const results = {}
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (let pkg = queue.shift(); pkg; pkg = queue.shift())
        results[pkg] = await buildPackage(dir, pkg, force)
    }),
  )
  for (const pkg of packages.filter((pkg) => PREREQUISITES.includes(pkg)))
    results[pkg] = prerequisiteResults[pkg]
  const built = Object.values(results).filter((r) => r === `built`).length
  process.stderr.write(
    `${label}: built ${built} of ${packages.length} packages in ${(
      (Date.now() - started) /
      1000
    ).toFixed(1)}s\n`,
  )
}

if (!existsSync(baseDir)) {
  process.stderr.write(`creating baseline worktree at ${baseSha.slice(0, 9)}\n`)
  git(`worktree add --detach ${baseDir} ${baseSha}`)
  execSync(`pnpm install --frozen-lockfile --prefer-offline`, {
    cwd: baseDir,
    stdio: `ignore`,
  })
}
await build(baseDir, `baseline ${baseSha.slice(0, 9)}`, false)
await build(root, `working tree`, flag(`rebuild`))

const sizes = (buffer) => ({
  gzip: gzipSync(buffer, { level: 9 }).length,
  brotli: brotliCompressSync(buffer, {
    params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length,
})
function measure(dir, pkg) {
  const esm = join(dir, `packages`, pkg, `dist`, `esm`)
  return new Map(
    walk(esm, (name) => /\.m?js$/.test(name)).map((file) => [
      relative(esm, file),
      sizes(readFileSync(file)),
    ]),
  )
}
const signed = (n) => (n > 0 ? `+${n}` : `${n}`)
const percent = (delta, base) =>
  base ? ` (${signed(Math.round((delta / base) * 1000) / 10)}%)` : ``
const total = (map, key) =>
  [...map.values()].reduce((sum, size) => sum + size[key], 0)

console.log(
  `merge-base ${baseSha.slice(0, 9)} (${baseRef}) vs working tree: minified dist/esm, gzip -9 and brotli -11 bytes\n`,
)
console.log(
  [`package`, `base gzip`, `head gzip`, `Δ gzip`, `Δ brotli`].join(`\t`),
)
const sum = { base: 0, head: 0, baseBrotli: 0, headBrotli: 0 }
for (const pkg of packages) {
  const base = measure(baseDir, pkg)
  const head = measure(root, pkg)
  const baseGzip = total(base, `gzip`)
  const headGzip = total(head, `gzip`)
  sum.base += baseGzip
  sum.head += headGzip
  sum.baseBrotli += total(base, `brotli`)
  sum.headBrotli += total(head, `brotli`)
  console.log(
    [
      pkg,
      baseGzip,
      headGzip,
      signed(headGzip - baseGzip) + percent(headGzip - baseGzip, baseGzip),
      signed(total(head, `brotli`) - total(base, `brotli`)),
    ].join(`\t`),
  )
  if (!flag(`files`)) continue
  const changed = [...new Set([...base.keys(), ...head.keys()])]
    .map((file) => [
      file,
      (head.get(file)?.gzip ?? 0) - (base.get(file)?.gzip ?? 0),
    ])
    .filter(([, delta]) => delta !== 0)
    .sort((a, b) => b[1] - a[1])
  for (const [file, delta] of changed)
    console.log(`  ${file}\t\t\t${signed(delta)}`)
}
console.log(
  [
    `TOTAL`,
    sum.base,
    sum.head,
    signed(sum.head - sum.base) + percent(sum.head - sum.base, sum.base),
    signed(sum.headBrotli - sum.baseBrotli),
  ].join(`\t`),
)
