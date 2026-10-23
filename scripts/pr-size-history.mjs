#!/usr/bin/env node
/**
 * Rank recently merged pull requests by the bytes they added to a package.
 *
 * The Compressed size check comments on each pull request with a table of
 * changed `packages/<package>/dist/esm/*.js` files, and edits that comment
 * in place, so it holds the final numbers. This script sums one package's
 * rows per pull request and prints the pull requests by net bytes added.
 *
 * Those numbers are the library's `dist/esm` files before an app's build, so
 * they include development-only code that production builds strip. Use them
 * to find where code was added; measure production weight with
 * `pnpm size:compare --base <commit>^ --exact-base` at the merge commit.
 *
 * Usage:
 *   node scripts/pr-size-history.mjs [--count 300] [--package db] [--json out.json]
 */
import { execFile } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const args = process.argv.slice(2)
// An option present without an operand is an error, not its default.
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index === -1) return fallback
  const value = args[index + 1]
  if (value === undefined || value.startsWith(`--`)) {
    console.error(`--${name} needs a value`)
    process.exit(1)
  }
  return value
}
const count = Number(option(`count`, `300`))
if (!Number.isInteger(count) || count < 1) {
  console.error(`--count needs a positive integer`)
  process.exit(1)
}
const pkg = option(`package`, `db`)
const repo = option(`repo`, `TanStack/db`)
const units = { B: 1, kB: 1000, MB: 1000_000 }
const row = new RegExp(
  `^\\|\\s*\`packages/${pkg}/dist/esm/([^\`]+)\`\\s*\\|[^|]*\\|\\s*([+-]?[\\d.]+)\\s*(B|kB|MB)\\b`,
)

const gh = async (path, { paginate = false } = {}) => {
  const { stdout } = await run(
    `gh`,
    [`api`, ...(paginate ? [`--paginate`, `--slurp`] : []), path],
    { maxBuffer: 64 * 1024 * 1024 },
  )
  // `--slurp` wraps each page's array in an outer array.
  return paginate ? JSON.parse(stdout).flat() : JSON.parse(stdout)
}

// Pages come newest-updated first, and a pull request's update time is never
// earlier than its merge time. So once a page's oldest update is earlier than
// the count-th newest merge already collected, no later page can hold a newer
// merge, and paging can stop.
async function mergedPullRequests() {
  const merged = []
  for (let page = 1; ; page++) {
    const batch = await gh(
      `repos/${repo}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=100&page=${page}`,
    )
    if (batch.length === 0) break
    for (const pr of batch)
      if (pr.merged_at)
        merged.push({
          number: pr.number,
          title: pr.title,
          mergedAt: pr.merged_at,
        })
    const oldestUpdate = batch.at(-1).updated_at
    const newestMerges = merged
      .map(({ mergedAt }) => mergedAt)
      .sort()
      .reverse()
    if (newestMerges.length >= count && oldestUpdate < newestMerges[count - 1])
      break
  }
  return merged
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    .slice(0, count)
}

// The package's changed files and their byte deltas, from the size comment.
async function sizeChange(number) {
  const comments = await gh(
    `repos/${repo}/issues/${number}/comments?per_page=100`,
    { paginate: true },
  )
  const comment = comments.findLast(
    (c) =>
      c.user.login === `github-actions[bot]` &&
      c.body.includes(`**Size Change:**`),
  )
  if (!comment) return undefined
  // Only the "View Changed" table has a change column.
  const files = comment.body
    .split(`View Unchanged`)[0]
    .split(`\n`)
    .map((line) => line.match(row))
    .filter(Boolean)
    .map(([, file, value, unit]) => ({
      file,
      bytes: Math.round(Number(value) * units[unit]),
    }))
    .sort((a, b) => Math.abs(b.bytes) - Math.abs(a.bytes))
  return {
    bytes: files.reduce((sum, { bytes }) => sum + bytes, 0),
    added: files.reduce((sum, { bytes }) => sum + Math.max(bytes, 0), 0),
    files,
  }
}

async function inBatches(items, size, task) {
  const results = []
  for (let i = 0; i < items.length; i += size)
    results.push(...(await Promise.all(items.slice(i, i + size).map(task))))
  return results
}

const prs = await mergedPullRequests()
const sizes = await inBatches(prs, 8, (pr) => sizeChange(pr.number))
const rows = prs
  .map((pr, i) => ({ ...pr, ...sizes[i] }))
  .filter((pr) => pr.files?.length)
  .sort((a, b) => b.bytes - a.bytes)
const json = option(`json`)
if (json) writeFileSync(json, JSON.stringify(rows, null, 2))

const signed = (n) => (n > 0 ? `+${n}` : `${n}`)
console.log(
  `${prs.length} merged pull requests, ${rows.length} change packages/${pkg}, ${
    sizes.filter((size) => size === undefined).length
  } without a size comment\n`,
)
console.log(`  net B   added  PR      title`)
for (const pr of rows) {
  console.log(
    `${signed(pr.bytes).padStart(7)} ${String(pr.added).padStart(7)}  #${String(
      pr.number,
    ).padEnd(5)} ${pr.title.slice(0, 64)}`,
  )
  console.log(
    `${``.padStart(24)}${pr.files
      .slice(0, 3)
      .map(({ file, bytes }) => `${file} ${signed(bytes)}`)
      .join(`, `)}`,
  )
}
