// Breadth survey + a partial plan-dependency oracle, not full-stack row coverage.
// Run only against the disposable Kitchen test container's separate scratch DB.
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import pg from 'pg'
import { Evidence } from './evidence.mjs'
import {
  inspectSqlEffects,
  analyzeSqlEffects,
  queryDependencies,
} from '../../sql-effects.mjs'

const replay = process.argv[2] === '--replay'
const packet = JSON.parse(await readFile(process.argv[replay ? 3 : 2], 'utf8'))
const input = replay
  ? {
      format: 1,
      generator: 'saved-case',
      schemas: [(packet.reduced ?? packet.original).input.program],
    }
  : packet
assert.equal(input.format, 1)
const output = resolve(
  process.env.ENDPOINT_ORACLE_OUTPUT ?? 'evidence/pg-corpus',
)
const url = 'postgresql://postgres@127.0.0.1:55480/endpoints_generated'
const client = new pg.Client({ connectionString: url })
const evidence = new Evidence('endpoints.pg-plan-dependencies')
evidence.artifact('corpus', JSON.stringify(input))
const report = {
  ok: false,
  generator: input.generator,
  version: input.version,
  seed: input.seed,
  schemas: [],
  queries: 0,
  validPlans: 0,
  analyzable: 0,
  fallbacks: 0,
  errors: 0,
  limits: [
    'External generator has its own finite grammar; no full PostgreSQL coverage claim.',
    'Plan scans provide a partial missing-dependency oracle, not exact semantic dependencies.',
    'No browser, optimistic values, query execution, mutation histories or shrinking in this breadth survey. Raw schema/query seeds and inputs are retained.',
  ],
}
const quote = (name) => '"' + name.replaceAll('"', '""') + '"'
function planRelations(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found
  if (value['Relation Name'] && value.Schema)
    found.add(JSON.stringify([value.Schema, value['Relation Name']]))
  for (const child of Object.values(value)) planRelations(child, found)
  return found
}
async function execute(programs) {
  for (const [index, program] of programs.entries()) {
    const schema = `corpus_${index}`,
      result = {
        seed: program.seed,
        complexity: program.complexity,
        queries: [],
      }
    report.schemas.push(result)
    result.dataLoaded = false
    if (program.dataError) {
      result.dataError = program.dataError
      report.errors++
    }
    if (program.generationError) {
      result.generationError = program.generationError
      report.errors++
      continue
    }
    await evidence.run({ program }, async () => {
      await client.query(`CREATE SCHEMA ${quote(schema)}`)
      try {
        const setup = `SET search_path TO ${quote(schema)};\n${program.ddl}\n${program.data ?? ''}`
        try {
          execFileSync(
            '/opt/homebrew/opt/libpq/bin/psql',
            [url, '-X', '-v', 'ON_ERROR_STOP=1'],
            { input: setup, stdio: ['pipe', 'pipe', 'pipe'] },
          )
        } catch (error) {
          result.setupError = String(error.stderr ?? error)
          report.errors++
          return
        }
        result.dataLoaded = !program.dataError
        await client.query(`SET search_path TO ${quote(schema)}`)
        await client.query("SET statement_timeout='2s'")
        const snapshot = await inspectSqlEffects(
          (sql) => client.query(sql),
          'corpus',
        )
        evidence.artifact('schema:' + index, JSON.stringify(snapshot))
        for (const query of program.queries) {
          const observed = { seed: query.seed }
          result.queries.push(observed)
          report.queries++
          if (query.generationError) {
            observed.generationError = query.generationError
            report.errors++
            continue
          }
          evidence.at({ operation: 'explain', step: query.seed })
          evidence.record({ type: 'query', ...query })
          let plan
          await client.query('BEGIN READ ONLY')
          try {
            plan = (
              await client.query('EXPLAIN (VERBOSE, FORMAT JSON) ' + query.sql)
            ).rows[0]['QUERY PLAN']
          } catch (error) {
            observed.postgresError = {
              code: error.code,
              message: error.message,
            }
            report.errors++
          } finally {
            await client.query('ROLLBACK')
          }
          if (!plan) continue
          report.validPlans++
          const summary = analyzeSqlEffects(query.sql, snapshot)
          const dependencies = queryDependencies(summary)
          observed.dependencies = dependencies
          observed.unknown = summary.unknown
          observed.planRelations = [...planRelations(plan)]
          if (dependencies === null) report.fallbacks++
          else {
            report.analyzable++
            const known = new Set(dependencies)
            if (
              process.env.ENDPOINT_ORACLE_TEST_FAULT === 'omit-plan-relation' &&
              observed.planRelations.some((id) => known.has(id))
            ) {
              known.delete(observed.planRelations.find((id) => known.has(id)))
              evidence.fault('omit-plan-relation')
            }
            evidence.check(
              'planned-relations-covered',
              observed.planRelations.filter((id) => !known.has(id)),
              [],
              { checkpoint: 'plan' },
            )
          }
        }
      } finally {
        await evidence.cleanup('schema', () =>
          client.query(`DROP SCHEMA ${quote(schema)} CASCADE`),
        )
      }
    })
  }
}
try {
  await client.connect()
  report.engine = (
    await client.query('SELECT version() AS version')
  ).rows[0].version
  if (replay) await evidence.replay(packet, ({ program }) => execute([program]))
  else {
    await execute(input.schemas)
    assert.ok(
      report.validPlans > 0 && report.analyzable > 0 && report.fallbacks > 0,
      'both analysis and fallback must be reached',
    )
  }
  report.generationClean = report.errors === 0
  report.ok = true
} catch (error) {
  report.error = String(error.stack ?? error)
} finally {
  await evidence.cleanup('pg', () => client.end())
  await mkdir(output, { recursive: true })
  await writeFile(
    resolve(output, 'corpus.json'),
    JSON.stringify(input, null, 2) + '\n',
  )
  await evidence.finish(report, output)
}
console.log(
  JSON.stringify({
    ok: report.ok,
    validPlans: report.validPlans,
    analyzable: report.analyzable,
    fallbacks: report.fallbacks,
    errors: report.errors,
  }),
)
