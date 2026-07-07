/**
 * Compares two JSON reports produced by `scripts/bench/incremental-update.ts`
 * and prints a markdown summary of the differences.
 *
 * Usage:
 *   tsx scripts/bench/compare-incremental-update.ts \
 *     --base=.tmp/perf/base.json \
 *     --candidate=.tmp/perf/candidate.json \
 *     [--outFile=.tmp/perf/comparison.md] \
 *     [--threshold=0.20] \
 *     [--failOnRegression=false]
 */
import { readFileSync, writeFileSync } from 'node:fs'

type Summary = {
  iterations: number
  medianMs: number
  p75Ms: number
  p95Ms: number
  minMs: number
  maxMs: number
  stddevMs: number
}

type FixtureScale = {
  label: string
  issueCount: number
  userCount: number
  commentCount: number
}

type RunResult = {
  query: string
  scenario: string
  scale: FixtureScale
  sourceIndexMode: string
  mutationMode: string
  coldHydrateMs: number
  writeSummary: Summary
}

type Report = {
  metadata: {
    node: string
    platform: string
    cpu: string
    gitSha: string
    iterations: number
    warmup: number
  }
  results: Array<RunResult>
}

type Comparison = {
  key: string
  query: string
  scenario: string
  scale: FixtureScale
  sourceIndexMode: string
  mutationMode: string
  base: RunResult
  candidate: RunResult
  medianRatio: number
  p95Ratio: number
}

// Relative change below which a result is considered noise, and an absolute
// floor so sub-hundredth-of-a-ms jitter never counts as a change.
const defaultThreshold = 0.2
const absoluteFloorMs = 0.05

const args = parseArgs(process.argv.slice(2))

const base = readReport(args.base)
const candidate = readReport(args.candidate)

const comparisons = compareReports(base, candidate)
const markdown = formatMarkdown(base, candidate, comparisons, args.threshold)

if (args.outFile) {
  writeFileSync(args.outFile, markdown)
}
console.log(markdown)

const regressions = comparisons.filter((comparison) =>
  isRegression(comparison, args.threshold),
)
if (args.failOnRegression && regressions.length > 0) {
  console.error(`\n${regressions.length} benchmark regression(s) found`)
  process.exit(1)
}

function readReport(path: string): Report {
  return JSON.parse(readFileSync(path, `utf8`)) as Report
}

function resultKey(result: RunResult): string {
  return [
    result.query,
    result.scenario,
    result.scale.label,
    result.scale.issueCount,
    result.scale.userCount,
    result.scale.commentCount,
    result.sourceIndexMode,
    result.mutationMode,
  ].join(`|`)
}

function compareReports(
  baseReport: Report,
  candidateReport: Report,
): Array<Comparison> {
  const baseByKey = new Map(
    baseReport.results.map((result) => [resultKey(result), result]),
  )

  const matched: Array<Comparison> = []
  for (const result of candidateReport.results) {
    const key = resultKey(result)
    const baseResult = baseByKey.get(key)
    if (!baseResult) continue

    matched.push({
      key,
      query: result.query,
      scenario: result.scenario,
      scale: result.scale,
      sourceIndexMode: result.sourceIndexMode,
      mutationMode: result.mutationMode,
      base: baseResult,
      candidate: result,
      medianRatio: ratio(
        baseResult.writeSummary.medianMs,
        result.writeSummary.medianMs,
      ),
      p95Ratio: ratio(baseResult.writeSummary.p95Ms, result.writeSummary.p95Ms),
    })
  }

  return matched
}

function ratio(baseMs: number, candidateMs: number): number {
  if (baseMs <= 0) return candidateMs <= 0 ? 1 : Number.POSITIVE_INFINITY
  return candidateMs / baseMs
}

function isSignificant(
  baseMs: number,
  candidateMs: number,
  threshold: number,
): boolean {
  const relativeChange = Math.abs(ratio(baseMs, candidateMs) - 1)
  const absoluteChange = Math.abs(candidateMs - baseMs)
  return relativeChange > threshold && absoluteChange > absoluteFloorMs
}

function isRegression(comparison: Comparison, threshold: number): boolean {
  return (
    comparison.medianRatio > 1 &&
    isSignificant(
      comparison.base.writeSummary.medianMs,
      comparison.candidate.writeSummary.medianMs,
      threshold,
    )
  )
}

function isImprovement(comparison: Comparison, threshold: number): boolean {
  return (
    comparison.medianRatio < 1 &&
    isSignificant(
      comparison.base.writeSummary.medianMs,
      comparison.candidate.writeSummary.medianMs,
      threshold,
    )
  )
}

function marker(comparison: Comparison, threshold: number): string {
  if (isRegression(comparison, threshold)) return `🔴`
  if (isImprovement(comparison, threshold)) return `🟢`
  return ``
}

function formatMarkdown(
  baseReport: Report,
  candidateReport: Report,
  allComparisons: Array<Comparison>,
  threshold: number,
): string {
  const lines: Array<string> = []
  const regressed = allComparisons.filter((comparison) =>
    isRegression(comparison, threshold),
  )
  const improved = allComparisons.filter((comparison) =>
    isImprovement(comparison, threshold),
  )

  lines.push(`## Incremental update benchmark`)
  lines.push(``)
  lines.push(
    `Comparing \`${candidateReport.metadata.gitSha}\` (this PR) against \`${baseReport.metadata.gitSha}\` (base). ` +
      `Times are per-write medians over ${candidateReport.metadata.iterations} iterations ` +
      `(${candidateReport.metadata.warmup} warmup writes).`,
  )
  lines.push(``)

  if (regressed.length === 0 && improved.length === 0) {
    lines.push(
      `**No significant changes** (threshold: ±${Math.round(threshold * 100)}% and >${absoluteFloorMs}ms).`,
    )
  } else {
    lines.push(
      `**${regressed.length} regression(s), ${improved.length} improvement(s)** ` +
        `(threshold: ±${Math.round(threshold * 100)}% and >${absoluteFloorMs}ms).`,
    )
  }
  lines.push(``)

  const groups = new Map<string, Array<Comparison>>()
  for (const comparison of allComparisons) {
    const groupKey = `${formatScale(comparison.scale)} | source indexes: ${
      comparison.sourceIndexMode
    } | ${comparison.mutationMode} writes`
    const group = groups.get(groupKey) ?? []
    group.push(comparison)
    groups.set(groupKey, group)
  }

  for (const [groupKey, group] of groups) {
    lines.push(`<details>`)
    const changed = group.filter(
      (comparison) => marker(comparison, threshold) !== ``,
    ).length
    const summarySuffix = changed > 0 ? ` — ${changed} change(s)` : ``
    lines.push(`<summary><b>${groupKey}</b>${summarySuffix}</summary>`)
    lines.push(``)
    lines.push(
      `| Query | Base median | PR median | Δ median | Base p95 | PR p95 | Δ p95 | |`,
    )
    lines.push(`| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |`)
    for (const comparison of group) {
      lines.push(
        `| ${comparison.query} | ${formatMs(
          comparison.base.writeSummary.medianMs,
        )} | ${formatMs(comparison.candidate.writeSummary.medianMs)} | ${formatDelta(
          comparison.medianRatio,
        )} | ${formatMs(comparison.base.writeSummary.p95Ms)} | ${formatMs(
          comparison.candidate.writeSummary.p95Ms,
        )} | ${formatDelta(comparison.p95Ratio)} | ${marker(
          comparison,
          threshold,
        )} |`,
      )
    }
    lines.push(``)
    lines.push(`</details>`)
    lines.push(``)
  }

  lines.push(
    `<sub>Runner: node ${candidate.metadata.node}, ${candidate.metadata.platform}, ${candidate.metadata.cpu}. ` +
      `Timings on shared CI runners are noisy; treat small deltas as indicative only.</sub>`,
  )

  return lines.join(`\n`)
}

function formatScale(scale: FixtureScale): string {
  if (
    scale.issueCount === scale.userCount &&
    scale.userCount === scale.commentCount
  ) {
    return `${scale.issueCount.toLocaleString(`en-US`)} rows/collection`
  }
  return `issues:${scale.issueCount} users:${scale.userCount} comments:${scale.commentCount}`
}

function formatMs(value: number): string {
  return `${value.toFixed(3)}ms`
}

function formatDelta(value: number): string {
  if (!Number.isFinite(value)) return `n/a`
  const percent = (value - 1) * 100
  const sign = percent > 0 ? `+` : ``
  return `${sign}${percent.toFixed(1)}%`
}

function parseArgs(argv: Array<string>): {
  base: string
  candidate: string
  outFile?: string
  threshold: number
  failOnRegression: boolean
} {
  let basePath: string | undefined
  let candidatePath: string | undefined
  let outFile: string | undefined
  let threshold = defaultThreshold
  let failOnRegression = false

  for (const arg of argv) {
    const [name, value] = arg.replace(/^--/, ``).split(`=`)
    if (!name || value === undefined) continue

    switch (name) {
      case `base`:
        basePath = value
        break
      case `candidate`:
        candidatePath = value
        break
      case `outFile`:
        outFile = value
        break
      case `threshold`: {
        const parsed = Number(value)
        if (!Number.isFinite(parsed) || parsed <= 0) {
          throw new Error(`--threshold must be a positive number`)
        }
        threshold = parsed
        break
      }
      case `failOnRegression`:
        failOnRegression = value === `true`
        break
    }
  }

  if (!basePath || !candidatePath) {
    throw new Error(`--base and --candidate report paths are required`)
  }

  return {
    base: basePath,
    candidate: candidatePath,
    outFile,
    threshold,
    failOnRegression,
  }
}
