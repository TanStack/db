import assert from 'node:assert/strict'
import fc from 'fast-check'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Driver } from './driver.mjs'
import { SchemaReference } from './schema-reference.mjs'
import { renderSchemaProgram, renderSchemaDatabase } from './schema-program.mjs'
import { schemaScenario, controls } from './schema-cases.mjs'
import { SqlManifest } from './sql-manifest.mjs'
import { endpointsProbe } from '../../transform.mjs'
import {
  effectControls,
  effectScenario,
  renderEffectDatabase,
} from './effect-program.mjs'
import { EffectReference } from './effect-reference.mjs'
const effects = process.env.ENDPOINT_ORACLE_EFFECTS === '1'
const positive = (name, fallback) => {
  const n = Number(process.env[name] ?? fallback)
  assert.ok(Number.isSafeInteger(n) && n > 0)
  return n
}
const N = positive('ENDPOINT_ORACLE_SCENARIOS', 2),
  X = positive('ENDPOINT_ORACLE_SEQUENCES', 2),
  steps = positive('ENDPOINT_ORACLE_STEPS', 5)
const seed = positive('ENDPOINT_ORACLE_SEED', 911027)
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ??
    new URL('../../evidence/sql-coverage', import.meta.url).pathname,
)
await mkdir(output, { recursive: true })
const reference = effects ? new EffectReference() : new SchemaReference(),
  manifest = new SqlManifest()
const driver = new Driver({
  reference,
  renderProgram: renderSchemaProgram,
  renderDatabase: effects ? renderEffectDatabase : renderSchemaDatabase,
})
const evidence = driver.evidence
evidence.name = effects ? 'endpoints.sql-effects' : 'endpoints.sql'
const report = {
  settings: { N, X, steps, seed, effects },
  limits: [
    'Generated scalar columns extend required id/text/completed/createdAt/scope fields; not arbitrary PostgreSQL schemas.',
    'Fixed text primary keys; nullable foreign keys use ON DELETE SET NULL.',
    'Ascending timestamp/id ordering; predicates use scalar comparisons and NULL logic.',
    'Sequential mutation sequences here; concurrent waves retain their separate campaign.',
    'Auth and imported table/type bindings are trusted fixture assumptions.',
    'No schema/type proof for arbitrary application modules, no subset loading, no LSN manifests.',
  ],
}
let last,
  failed = false,
  executions = 0
async function execute(scenario) {
  return evidence.run(scenario, async () => {
    last = scenario
    await reference.configure(scenario.program)
    await driver.prepare(scenario.program)
    const witness = 'scenario-' + executions++
    await mkdir(resolve(output, witness), { recursive: true })
    await writeFile(
      resolve(output, witness, 'program.json'),
      JSON.stringify(scenario, null, 2),
    )
    for (const [index, sequence] of scenario.sequences.entries()) {
      reference.operations = []
      await driver.run(scenario.program, sequence)
      manifest.record(
        scenario.program,
        reference.operations,
        witness + '/program.json#/sequences/' + index,
      )
    }
  })
}
try {
  await driver.init()
  report.engine = reference.engine
  // Negative compilation cells are observed, not inferred from the grammar.
  const source = renderSchemaProgram(controls.program)
  for (const [cell, before, after] of [
    ['query.limit', '.orderBy(', '.limit(1).orderBy('],
    [
      'query.join',
      '.where(',
      '.leftJoin(relation_1_1,eq(relation_0_0.id,relation_1_1.id)).where(',
    ],
  ]) {
    assert.throws(
      () =>
        endpointsProbe().transform(
          source.replace(before, after),
          '/test/endpoint.tsx',
        ),
      /ENDPOINT_BOUND_UNSUPPORTED/,
    )
    manifest.rejected.set(cell, 'Generated compiler rejection control')
  }
  const replay = process.argv.indexOf('--replay')
  if (replay >= 0)
    await evidence.replay(
      JSON.parse(await readFile(process.argv[replay + 1], 'utf8')),
      execute,
    )
  else {
    for (const control of effects ? effectControls : [controls])
      await execute(control)
    const result = await fc.check(
      fc.asyncProperty(
        (effects ? effectScenario : schemaScenario)(X, steps),
        execute,
      ),
      { numRuns: N, seed, endOnFailure: !!process.env.ENDPOINT_ORACLE_DEBUG },
    )
    report.property = {
      seed: result.seed,
      path: result.counterexamplePath,
      runs: result.numRuns,
      shrinks: result.numShrinks,
    }
    evidence.generation = report.property
    if (result.failed) {
      last = result.counterexample[0]
      throw result.errorInstance ?? Error(result.error)
    }
  }
  report.ok = true
} catch (error) {
  failed = true
  report.ok = false
  report.error = String(error.stack ?? error)
  report.serverLog = driver.serverLog?.slice(-12000)
  console.error(report.error)
} finally {
  report.coverage = manifest.report()
  report.executed = driver.counts
  await driver.close()
  await evidence.finish(report, output, !failed)
}
if (failed) process.exitCode = 1
