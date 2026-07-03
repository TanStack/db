// Interleaved A/B benchmark comparison: baseline (main) vs candidate (this worktree).
// Alternates full bench runs per side to cancel thermal/background drift, then
// reports per-query MIN across rounds for each side.
//
//   node .tmp/bench/ab-compare.mjs [abRounds]
//   env: SCALE, ROUNDS, PAIRS, IROUNDS, ONLY passed through to bench.mjs
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const AB_ROUNDS = Number(process.argv[2] ?? 3)

const BASELINE_DB = new URL(
  `../../../perf-baseline/packages/db/dist/esm/index.js`,
  import.meta.url,
).href
const CANDIDATE_DB = new URL(
  `../../packages/db/dist/esm/index.js`,
  import.meta.url,
).href
const BENCH = new URL(`./bench.mjs`, import.meta.url).pathname

function runOnce(dbPath) {
  const res = spawnSync(
    `node`,
    [`--expose-gc`, BENCH],
    {
      env: { ...process.env, DB_PATH: dbPath },
      encoding: `utf8`,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (res.status !== 0) {
    throw new Error(`bench failed: ${res.stderr}\n${res.stdout}`)
  }
  const line = res.stdout.split(`\n`).find((l) => l.startsWith(`JSON:`))
  if (!line) throw new Error(`no JSON line in output:\n${res.stdout}`)
  return JSON.parse(line.slice(5))
}

function mergeMin(acc, run) {
  for (const section of [`views`, `full`]) {
    for (const row of run[section]) {
      const key = `${section}:${row.name}`
      const cur = acc.get(key)
      if (!cur) {
        acc.set(key, { ...row, section })
      } else {
        cur.hydrateMs = Math.min(cur.hydrateMs, row.hydrateMs)
        cur.incrMs = Math.min(cur.incrMs, row.incrMs)
      }
    }
  }
}

const baseAcc = new Map()
const candAcc = new Map()

for (let r = 0; r < AB_ROUNDS; r++) {
  process.stdout.write(`round ${r + 1}/${AB_ROUNDS}: baseline… `)
  mergeMin(baseAcc, runOnce(BASELINE_DB))
  process.stdout.write(`candidate…\n`)
  mergeMin(candAcc, runOnce(CANDIDATE_DB))
}

const rows = []
for (const [key, base] of baseAcc) {
  const cand = candAcc.get(key)
  if (!cand) continue
  rows.push({
    key,
    label: base.label,
    baseHydrate: base.hydrateMs,
    candHydrate: cand.hydrateMs,
    hydrateSpeedup: base.hydrateMs / cand.hydrateMs,
    baseIncr: base.incrMs,
    candIncr: cand.incrMs,
    incrSpeedup: base.incrMs / cand.incrMs,
  })
}

const fmt = (n) => (n >= 100 ? n.toFixed(1) : n >= 1 ? n.toFixed(2) : n.toFixed(4))
console.log(`\n${`Query`.padEnd(28)} ${`base hyd`.padStart(10)} ${`cand hyd`.padStart(10)} ${`speedup`.padStart(8)}   ${`base incr`.padStart(10)} ${`cand incr`.padStart(10)} ${`speedup`.padStart(8)}`)
let geoH = 0
let geoI = 0
for (const r of rows) {
  geoH += Math.log(r.hydrateSpeedup)
  geoI += Math.log(r.incrSpeedup)
  console.log(
    `${r.label.padEnd(28)} ${fmt(r.baseHydrate).padStart(10)} ${fmt(r.candHydrate).padStart(10)} ${(r.hydrateSpeedup.toFixed(2) + `×`).padStart(8)}   ${fmt(r.baseIncr).padStart(10)} ${fmt(r.candIncr).padStart(10)} ${(r.incrSpeedup.toFixed(2) + `×`).padStart(8)}`,
  )
}
console.log(
  `\ngeomean hydrate speedup: ${Math.exp(geoH / rows.length).toFixed(3)}× · geomean incr speedup: ${Math.exp(geoI / rows.length).toFixed(3)}×`,
)

if (process.env.OUT_TSV) {
  const tsv = [
    `key\tlabel\tbase_hydrate_ms\tcand_hydrate_ms\thydrate_speedup\tbase_incr_ms\tcand_incr_ms\tincr_speedup`,
    ...rows.map((r) =>
      [r.key, r.label, r.baseHydrate, r.candHydrate, r.hydrateSpeedup, r.baseIncr, r.candIncr, r.incrSpeedup].join(`\t`),
    ),
  ].join(`\n`)
  writeFileSync(process.env.OUT_TSV, tsv)
  console.log(`wrote ${process.env.OUT_TSV}`)
}
