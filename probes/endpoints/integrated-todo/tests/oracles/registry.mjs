import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Driver } from './driver.mjs'
import { SchemaReference } from './schema-reference.mjs'
import { controls } from './schema-cases.mjs'
import { renderSchemaDatabase } from './schema-program.mjs'
import {
  registryProgram,
  renderRegistryProgram,
  registryFiles,
} from './registry-program.mjs'
const program = registryProgram(controls.program)
const reference = new SchemaReference()
const driver = new Driver({
  reference,
  renderProgram: (program) => renderRegistryProgram(program).main,
  extraModules: registryFiles,
  renderDatabase: renderSchemaDatabase,
})
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/query-registry',
)
const report = {
  ok: false,
  scope:
    'Compiled cross-module parameterized collections through real browser/server and independent PG',
  limits: [
    'Two sibling endpoint modules; boolean filter instances.',
    'String/integer input validation has focused contracts; no arbitrary nested/optional parameter grammar.',
    'Scope authorization remains the existing Alice/Bob test fixture, not production authentication.',
  ],
}
try {
  await driver.init()
  await reference.configure(program)
  await driver.prepare(program)
  const cases = [
    ...controls.sequences[0],
    {
      kind: 'complete',
      target: 0,
      slot: 0,
      text: '',
      rank: 1,
      outcome: 'success',
    },
  ]
  for (const scope of ['alice', 'bob']) {
    const scoped = { ...program, scope, nested: scope === 'bob' }
    await reference.configure(scoped)
    await driver.prepare(scoped)
    await driver.run(scoped, cases)
  }
  // Registry snapshots all retained instances, including false/true instances of
  // each peer definition. PG checks optimistic entry/exit and final sync for all.
  assert.equal(driver.counts.operations, cases.length * 2)
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
  report.serverLog = driver.serverLog?.slice(-14000)
  console.error(report.error)
  process.exitCode = 1
} finally {
  report.executed = driver.counts
  await driver.close()
  await driver.evidence.finish(report, output)
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, 'program.json'),
    JSON.stringify(program, null, 2) + '\n',
  )
}
