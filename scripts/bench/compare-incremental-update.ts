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
  // Older reports may lack cold hydrate data.
  coldHydrateMs?: number
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

/**
 * A per-case timing that the report compares. Writes use the per-write median
 * of many samples. Cold hydrate is one sample per case, so same-code runs vary
 * by up to about ±50% on small cases; its flags need a larger relative change
 * and a larger absolute floor.
 */
type Metric = {
  label: string
  floorMs: number
  minRelativeThreshold: number
  value: (result: RunResult) => number | undefined
}

// Relative change below which a result is considered noise, and an absolute
// floor so sub-hundredth-of-a-ms jitter never counts as a change.
const defaultThreshold = 0.2
const absoluteFloorMs = 0.05
const coldAbsoluteFloorMs = 5
const coldRelativeThreshold = 0.5

const writeMetric: Metric = {
  label: `median write time`,
  floorMs: absoluteFloorMs,
  minRelativeThreshold: 0,
  value: (result) => result.writeSummary.medianMs,
}
const coldMetric: Metric = {
  label: `cold hydrate time`,
  floorMs: coldAbsoluteFloorMs,
  minRelativeThreshold: coldRelativeThreshold,
  value: (result) => result.coldHydrateMs,
}

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
  floorMs: number,
): boolean {
  const relativeChange = Math.abs(ratio(baseMs, candidateMs) - 1)
  const absoluteChange = Math.abs(candidateMs - baseMs)
  return relativeChange > threshold && absoluteChange > floorMs
}

/** The candidate/base ratio of a metric, or undefined when a side lacks it. */
function metricRatio(
  comparison: Comparison,
  metric: Metric,
): number | undefined {
  const baseMs = metric.value(comparison.base)
  const candidateMs = metric.value(comparison.candidate)
  if (baseMs === undefined || candidateMs === undefined) return undefined
  return ratio(baseMs, candidateMs)
}

function changeDirection(
  comparison: Comparison,
  threshold: number,
  metric: Metric,
): -1 | 0 | 1 {
  const baseMs = metric.value(comparison.base)
  const candidateMs = metric.value(comparison.candidate)
  if (baseMs === undefined || candidateMs === undefined) return 0
  const relative = Math.max(threshold, metric.minRelativeThreshold)
  if (!isSignificant(baseMs, candidateMs, relative, metric.floorMs)) return 0
  return candidateMs > baseMs ? 1 : -1
}

function isRegression(
  comparison: Comparison,
  threshold: number,
  metric: Metric = writeMetric,
): boolean {
  return changeDirection(comparison, threshold, metric) === 1
}

function isImprovement(
  comparison: Comparison,
  threshold: number,
  metric: Metric = writeMetric,
): boolean {
  return changeDirection(comparison, threshold, metric) === -1
}

function marker(
  comparison: Comparison,
  threshold: number,
  metric: Metric = writeMetric,
): string {
  if (isRegression(comparison, threshold, metric)) return `🔴`
  if (isImprovement(comparison, threshold, metric)) return `🟢`
  return ``
}

// Individual rows are noisy at sub-ms timings, but a consistent shift across
// many rows is a real change even when no single row clears the per-row
// significance bar — the geometric mean of the ratios captures that.
function geomeanRatio(
  group: Array<Comparison>,
  metric: Metric = writeMetric,
): number {
  const finite = group
    .map((comparison) => metricRatio(comparison, metric))
    .filter(
      (value): value is number =>
        value !== undefined && Number.isFinite(value) && value > 0,
    )
  if (finite.length === 0) return 1
  return Math.exp(
    finite.reduce((sum, value) => sum + Math.log(value), 0) / finite.length,
  )
}

function formatRatio(value: number): string {
  return `${value.toFixed(2)}×`
}

function formatMarkdown(
  baseReport: Report,
  candidateReport: Report,
  allComparisons: Array<Comparison>,
  threshold: number,
): string {
  const lines: Array<string> = []
  const coldComparisons = allComparisons.filter(
    (comparison) => metricRatio(comparison, coldMetric) !== undefined,
  )

  lines.push(`## Incremental update benchmark`)
  lines.push(``)
  lines.push(
    `Comparing \`${candidateReport.metadata.gitSha}\` (this PR) against \`${baseReport.metadata.gitSha}\` (base). ` +
      `Write times are per-write medians over ${candidateReport.metadata.iterations} iterations ` +
      `(${candidateReport.metadata.warmup} warmup writes). Cold hydrate is one timed first load of each query.`,
  )
  lines.push(``)
  const coldSummary =
    coldComparisons.length > 0
      ? ` · cold hydrate time: **${formatRatio(
          geomeanRatio(coldComparisons, coldMetric),
        )}**`
      : ` · cold hydrate time: n/a (a report has no cold data)`
  lines.push(
    `Overall median write time vs base: **${formatRatio(
      geomeanRatio(allComparisons),
    )}**${coldSummary} (geometric mean of per-case ratios; lower is faster).`,
  )
  lines.push(``)
  lines.push(
    formatFlagSummary(`Writes`, allComparisons, threshold, writeMetric),
  )
  if (coldComparisons.length > 0) {
    lines.push(``)
    lines.push(
      formatFlagSummary(`Cold hydrate`, coldComparisons, threshold, coldMetric),
    )
  }
  lines.push(``)
  lines.push(
    `<sub>Per-case flags are noisy on shared runners. Read the geometric means first.</sub>`,
  )
  lines.push(``)

  const byQuery = new Map<string, Array<Comparison>>()
  for (const comparison of allComparisons) {
    const group = byQuery.get(comparison.query) ?? []
    group.push(comparison)
    byQuery.set(comparison.query, group)
  }

  lines.push(`### Writes`)
  lines.push(``)
  pushQueryRollup(lines, byQuery, threshold, writeMetric)
  lines.push(``)
  if (coldComparisons.length > 0) {
    lines.push(`### Cold hydrate`)
    lines.push(``)
    pushQueryRollup(lines, byQuery, threshold, coldMetric)
    lines.push(``)
  }
  lines.push(
    `Each row aggregates the ${allComparisons.length / byQuery.size || 0} ` +
      `scale/index/write-mode configurations of that query; per-configuration ` +
      `tables below.`,
  )
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
      (comparison) =>
        marker(comparison, threshold) !== `` ||
        marker(comparison, threshold, coldMetric) !== ``,
    ).length
    const changedSuffix = changed > 0 ? `, ${changed} change(s)` : ``
    const coldSuffix = group.some(
      (comparison) => metricRatio(comparison, coldMetric) !== undefined,
    )
      ? `, cold ${formatRatio(geomeanRatio(group, coldMetric))}`
      : ``
    lines.push(
      `<summary><b>${groupKey}</b> — geomean ${formatRatio(
        geomeanRatio(group),
      )}${coldSuffix}${changedSuffix}</summary>`,
    )
    lines.push(``)
    lines.push(
      `| Query | Base median | PR median | Δ median | Base p95 | PR p95 | Δ p95 | | Base cold | PR cold | Δ cold | |`,
    )
    lines.push(
      `| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | --- |`,
    )
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
        )} | ${formatOptionalMs(comparison.base.coldHydrateMs)} | ${formatOptionalMs(
          comparison.candidate.coldHydrateMs,
        )} | ${formatDelta(
          metricRatio(comparison, coldMetric) ?? Number.NaN,
        )} | ${marker(comparison, threshold, coldMetric)} |`,
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

function formatFlagSummary(
  label: string,
  group: Array<Comparison>,
  threshold: number,
  metric: Metric,
): string {
  const regressed = group.filter((comparison) =>
    isRegression(comparison, threshold, metric),
  ).length
  const improved = group.filter((comparison) =>
    isImprovement(comparison, threshold, metric),
  ).length
  const relative = Math.max(threshold, metric.minRelativeThreshold)
  const rule = `threshold: ±${Math.round(relative * 100)}% and >${metric.floorMs}ms`
  if (regressed === 0 && improved === 0) {
    return `${label}: **No significant changes** (${rule}).`
  }
  return `${label}: **${regressed} regression(s), ${improved} improvement(s)** (${rule}).`
}

function pushQueryRollup(
  lines: Array<string>,
  byQuery: Map<string, Array<Comparison>>,
  threshold: number,
  metric: Metric,
): void {
  lines.push(
    `| Query | Δ ${metric.label} (geomean) | Best case | Worst case | Flags |`,
  )
  lines.push(`| --- | ---: | ---: | ---: | :-- |`)
  for (const [query, group] of byQuery) {
    const ratios = group
      .map((comparison) => metricRatio(comparison, metric))
      .filter(
        (value): value is number =>
          value !== undefined && Number.isFinite(value),
      )
    if (ratios.length === 0) continue
    const redCount = group.filter((comparison) =>
      isRegression(comparison, threshold, metric),
    ).length
    const greenCount = group.filter((comparison) =>
      isImprovement(comparison, threshold, metric),
    ).length
    const flags =
      [
        redCount > 0 ? `${redCount} 🔴` : ``,
        greenCount > 0 ? `${greenCount} 🟢` : ``,
      ]
        .filter(Boolean)
        .join(` `) || `—`
    lines.push(
      `| ${query} | ${formatDelta(geomeanRatio(group, metric))} | ${formatDelta(
        Math.min(...ratios),
      )} | ${formatDelta(Math.max(...ratios))} | ${flags} |`,
    )
  }
}

function formatOptionalMs(value: number | undefined): string {
  return value === undefined ? `n/a` : formatMs(value)
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
