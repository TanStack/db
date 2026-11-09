import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// Exercise the actual CI command and its report artifact. These controls make
// report corruption and cold-only regressions visible independently of writes.
function result(query = 'documents', scale = 100) {
  return {
    query,
    scenario: 'update',
    scale: {
      label: String(scale),
      issueCount: scale,
      userCount: scale,
      commentCount: scale,
    },
    sourceIndexMode: 'none',
    mutationMode: 'synced',
    coldHydrateMs: 100,
    coldHydrateSamplesMs: [99, 100, 101],
    writeMedianSamplesMs: [0.099, 0.1, 0.101],
    writeSummary: {
      iterations: 100,
      medianMs: 0.1,
      p75Ms: 0.1,
      p95Ms: 0.1,
      minMs: 0.1,
      maxMs: 0.1,
      stddevMs: 0,
    },
  }
}
function report(results = [result()]) {
  return {
    metadata: {
      gitSha: 'fixture',
      node: 'test',
      platform: 'test',
      cpu: 'test',
      iterations: 100,
      warmup: 20,
      repetitions: 3,
    },
    results,
  }
}
function compare(base, candidate) {
  const dir = mkdtempSync(join(tmpdir(), 'benchmark-gate-'))
  try {
    writeFileSync(join(dir, 'base.json'), JSON.stringify(base))
    writeFileSync(join(dir, 'candidate.json'), JSON.stringify(candidate))
    const outFile = join(dir, 'comparison.md')
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/bench/compare-incremental-update.ts',
        `--base=${dir}/base.json`,
        `--candidate=${dir}/candidate.json`,
        `--outFile=${outFile}`,
        '--failOnRegression=true',
      ],
      { encoding: 'utf8' },
    )
    return {
      ...run,
      markdown: run.stdout.includes('## Incremental')
        ? readFileSync(outFile, 'utf8')
        : '',
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
function scaleMetric(row, metric, factor) {
  if (metric === 'write') {
    row.writeSummary.medianMs *= factor
    row.writeMedianSamplesMs = row.writeMedianSamplesMs.map(
      (value) => value * factor,
    )
  } else {
    row.coldHydrateMs *= factor
    row.coldHydrateSamplesMs = row.coldHydrateSamplesMs.map(
      (value) => value * factor,
    )
  }
}

test('unchanged results and one transient spike pass', () => {
  const base = report(),
    candidate = structuredClone(base)
  candidate.results[0].coldHydrateSamplesMs[2] = 1000
  candidate.results[0].writeMedianSamplesMs[2] = 10
  const run = compare(base, candidate)
  assert.equal(run.status, 0, run.stderr)
  assert.match(run.markdown, /CI regression gate: \*\*PASS\*\*/)
})
for (const [metric, threshold] of [
  ['write', 0.3],
  ['cold', 0.5],
]) {
  for (const delta of [-0.001, 0.001]) {
    test(`${metric} query gate distinguishes the threshold ${delta > 0 ? 'above' : 'below'}`, () => {
      const base = report(),
        candidate = structuredClone(base)
      scaleMetric(candidate.results[0], metric, 1 + threshold + delta)
      const run = compare(base, candidate)
      assert.equal(run.status, delta > 0 ? 1 : 0, run.stderr)
      if (delta > 0)
        assert.match(run.markdown, /CI regression gate: \*\*FAIL\*\*/)
    })
  }
  test(`${metric} query regression cannot be cancelled by another query's improvement`, () => {
    const base = report([result(), result('flat')]),
      candidate = structuredClone(base)
    scaleMetric(candidate.results[0], metric, 2)
    scaleMetric(candidate.results[1], metric, 0.1)
    assert.equal(compare(base, candidate).status, 1)
  })
  test(`${metric} sustained isolated regression fails when query geomean is small`, () => {
    const base = report(
        Array.from({ length: 12 }, (_, i) => result('documents', i + 1)),
      ),
      candidate = structuredClone(base)
    scaleMetric(candidate.results[0], metric, 2)
    const run = compare(base, candidate)
    assert.equal(run.status, 1, run.stderr)
    assert.match(run.stderr, /every .* repetition/)
  })
}
for (const corruption of [
  'empty',
  'missing-case',
  'new-case',
  'duplicate',
  'invalid-write',
  'invalid-cold',
  'missing-cold',
  'missing-repetitions',
  'invalid-repetitions',
]) {
  test(`invalid ${corruption} reports cannot produce a green gate`, () => {
    const base = report(),
      candidate = structuredClone(base)
    switch (corruption) {
      case 'empty':
        candidate.results = []
        break
      case 'missing-case':
        base.results.push(result('omitted'))
        break
      case 'new-case':
        candidate.results.push(result('added'))
        break
      case 'duplicate':
        candidate.results.push(candidate.results[0])
        break
      case 'invalid-write':
        candidate.results[0].writeSummary.medianMs = null
        break
      case 'invalid-cold':
        candidate.results[0].coldHydrateSamplesMs[0] = -1
        break
      case 'missing-cold':
        delete base.results[0].coldHydrateMs
        delete candidate.results[0].coldHydrateMs
        break
      case 'missing-repetitions':
        delete candidate.results[0].writeMedianSamplesMs
        break
      case 'invalid-repetitions':
        candidate.metadata.repetitions = 0
        break
    }
    assert.equal(compare(base, candidate).status, 1)
  })
}

test('a regression from zero cannot disappear from the geometric mean', () => {
  const base = report([result(), result('flat')]),
    candidate = structuredClone(base)
  base.results[0].writeSummary.medianMs = 0
  base.results[0].writeMedianSamplesMs = [0, 0, 0]
  scaleMetric(candidate.results[1], 'write', 0.1)
  assert.equal(compare(base, candidate).status, 1)
})
