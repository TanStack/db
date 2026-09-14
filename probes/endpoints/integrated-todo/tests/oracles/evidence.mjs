import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function frozen(value) {
  try {
    return structuredClone(value)
  } catch {
    return String(value)
  }
}
function difference(actual, expected, path = []) {
  if (Object.is(actual, expected)) return null
  if (
    actual &&
    expected &&
    typeof actual === 'object' &&
    typeof expected === 'object'
  ) {
    for (const key of new Set([
      ...Object.keys(actual),
      ...Object.keys(expected),
    ])) {
      const found = difference(actual[key], expected[key], [...path, key])
      if (found) return found
    }
    return null
  }
  return path
}
export function failureIdentity(failure) {
  const path =
    failure.difference ?? difference(failure.actual, failure.expected)
  const nested =
    Array.isArray(failure.actual?.[0]) || Array.isArray(failure.expected?.[0])
  const actual = nested ? failure.actual?.[path?.[0]] : failure.actual
  const expected = nested ? failure.expected?.[path?.[0]] : failure.expected
  let rowMeaning
  if (
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    [...actual, ...expected].every(
      (row) => row && typeof row === 'object' && Object.hasOwn(row, 'id'),
    )
  ) {
    const a = actual.map((row) => row.id),
      b = expected.map((row) => row.id)
    rowMeaning =
      a.length !== b.length ||
      a.some((id) => !b.includes(id)) ||
      b.some((id) => !a.includes(id))
        ? 'membership'
        : a.some((id, i) => id !== b[i])
          ? 'order'
          : 'fields'
  }
  const vector =
    Array.isArray(actual) &&
    Array.isArray(expected) &&
    [...actual, ...expected].every(
      (value) => value === null || typeof value !== 'object',
    )
  return JSON.stringify([
    failure.law,
    failure.checkpoint,
    failure.operation ?? failure.step?.kind,
    failure.collection ?? (nested || vector ? path?.[0] : undefined),
    rowMeaning,
    // Keep semantic fields, not row positions that change during legal shrinking.
    path?.map((part, index) =>
      /^\d+$/.test(part) ? (nested && index === 0 ? part : '[]') : part,
    ),
  ])
}

const controlVariables = [
  'ENDPOINT_ORACLE_TEST_FAULT',
  'ENDPOINT_ORACLE_MUTANT',
  'ENDPOINT_COMPILED_MUTANT',
  'ENDPOINT_FUNCTION_MUTANT',
  'ENDPOINT_DEPENDENCY_MUTANT',
  'ENDPOINT_EFFECT_MUTANT',
]
const expectedLaws = {
  'omit-plan-relation': ['planned-relations-covered'],
  'compiled-row': ['settled-rows'],
  'preload-cold': ['cold-baseline'],
  'bad-baseline': ['reference-baseline'],
  'immediate-snapshot': ['collection-rows'],
  'rendered-text': ['rendered-values'],
  'omit-order': ['collection-rows'],
  'early-settlement': ['persistence-pending'],
  'omit-fanout': ['collection-rows'],
  'optimistic-recipients-only': ['collection-rows'],
  'misroute-relations': ['collection-rows'],
  'accept-overlapping-inline': [
    'notification-rows',
    'collection-rows',
    'persistence-pending',
  ],
  'omit-publication-batch': ['notification-rows', 'event-materialization'],
  'omit-routine-body': ['settled-rows', 'read-obligation'],
  'ignore-triggers': ['settled-rows', 'read-obligation'],
  'omit-helper': ['settled-rows', 'read-obligation'],
  'omit-fk': ['settled-rows'],
  'omit-trigger': ['settled-rows', 'read-obligation'],
  'omit-write': ['settled-rows', 'values', 'read-obligation'],
  'omit-body-read': ['values'],
  'needless-index-fallback': ['read-obligation'],
}
function provenance() {
  const base = fileURLToPath(new URL('.', import.meta.url)),
    app = resolve(base, '../..'),
    repo = resolve(app, '../../..')
  const paths = []
  function walk(dir, recursive = true) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory() && recursive) walk(path)
      else if (entry.isFile() && /\.(mjs|ts|tsx|json|py)$/.test(entry.name))
        paths.push(path)
    }
  }
  walk(base)
  walk(app, false)
  walk(join(app, 'src'))
  walk(join(app, 'tests/fixtures'))
  for (const name of ['db', 'db-ivm', 'query-db-collection', 'react-db']) {
    walk(join(repo, 'packages', name, 'src'))
    paths.push(join(repo, 'packages', name, 'package.json'))
  }
  paths.push(join(repo, 'packages/db/tests/oracle-config.ts'))
  const sources = Object.fromEntries(
    paths.map((path) => [
      relative(base, path),
      createHash('sha256').update(readFileSync(path)).digest('hex'),
    ]),
  )
  const versions = Object.fromEntries(
    [
      'fast-check',
      '@electric-sql/pglite',
      'drizzle-orm',
      'playwright',
      'react',
      'react-dom',
      '@tanstack/react-start',
      '@tanstack/query-core',
      'vite',
      '@babel/parser',
      'pgsql-ast-parser',
    ].map((name) => [
      name,
      JSON.parse(
        readFileSync(join(app, 'node_modules', name, 'package.json'), 'utf8'),
      ).version,
    ]),
  )
  return { sources, versions }
}

// Shared evidence plumbing, not a shared reference model. Each runner owns its
// expected values, legal inputs, checkpoints and fault injection sites.
export class Evidence {
  constructor(name) {
    this.name = name
    this.provenance = provenance()
    this.requestedFaults = controlVariables.flatMap((variable) =>
      process.env[variable] ? [{ variable, point: process.env[variable] }] : [],
    )
  }
  witnesses = {}
  faults = []
  cleanupErrors = []
  rejectedShrinks = []
  cases = 0
  depth = 0
  phase = 'setup'
  context = {}
  trace = []
  artifacts = {}
  at(context) {
    this.context = frozen(context)
  }
  record(event) {
    this.trace.push(frozen(event))
  }
  artifact(name, contents) {
    this.artifacts[name] = createHash('sha256').update(contents).digest('hex')
  }
  track(work, pending) {
    pending.push(work)
    work.catch(() => {})
    return work
  }
  check(law, actual, expected, context = {}) {
    context = { ...this.context, ...context }
    const key = JSON.stringify([law, context.checkpoint, context.operation])
    this.witnesses[key] = (this.witnesses[key] ?? 0) + 1
    try {
      assert.deepEqual(actual, expected, law)
    } catch (error) {
      error.oracle = frozen({
        law,
        ...context,
        actual,
        expected,
        difference: difference(actual, expected),
        trace: this.trace,
        faults: this.faults.filter((event) => event.case === this.cases),
      })
      throw error
    }
  }
  fault(point, detail = {}) {
    this.faults.push(
      frozen({ point, stage: 'reached', case: this.cases, ...detail }),
    )
  }
  async cleanup(name, release) {
    try {
      await release()
      if (
        process.env.ENDPOINT_ORACLE_TEST_FAULT === 'cleanup' &&
        name === 'client'
      ) {
        this.fault('cleanup', { name })
        throw Error('Injected cleanup failure after release')
      }
    } catch (error) {
      this.cleanupErrors.push({ name, error: String(error.stack ?? error) })
    }
  }
  async settled(name, work) {
    const results = await Promise.allSettled(work)
    results.forEach((result, index) => {
      if (result.status === 'rejected')
        this.cleanupErrors.push({
          name: `${name}:${index}`,
          error: String(result.reason?.stack ?? result.reason),
        })
    })
  }
  async run(input, execute) {
    // Only the outer case accepts/rejects a shrink. A sequence nested inside a
    // scenario must propagate its first failure and stop the rest of that case.
    if (this.depth) return execute()
    this.depth++
    this.cases++
    this.phase = 'setup'
    this.context = {}
    this.trace = []
    try {
      return await execute()
    } catch (error) {
      const site = String(error.stack)
        .split('\n')
        .find((line) => /file:/.test(line))
        ?.trim()
      const failure = error.oracle ?? {
        law: /deadline|timeout/i.test(error.message)
          ? 'progress-timeout'
          : error.code === 'ERR_ASSERTION' && this.phase === 'execution'
            ? `legacy-assertion:${site}`
            : 'infrastructure',
        checkpoint: error.oracle ? undefined : site,
        actual: frozen(error.actual),
        expected: frozen(error.expected),
        message: String(error.stack ?? error),
        ...this.context,
        trace: frozen(this.trace),
        faults: frozen(
          this.faults.filter((event) => event.case === this.cases),
        ),
      }
      const record = frozen({ input, failure })
      this.original ??= record
      if (failureIdentity(failure) !== failureIdentity(this.original.failure)) {
        this.rejectedShrinks.push(record)
        return
      }
      this.reduced = record
      throw error
    } finally {
      this.depth--
    }
  }
  property(result) {
    this.generation = {
      seed: result.seed,
      path: result.counterexamplePath,
      runs: result.numRuns,
      shrinks: result.numShrinks,
    }
    if (result.failed) throw result.errorInstance ?? Error(result.error)
  }
  async replay(packet, execute) {
    const record = packet.reduced ?? packet.original
    if (!record) {
      this.replayVerdict = 'legacy-input-without-failure-identity'
      return execute(packet)
    }
    try {
      await execute(record.input)
      this.replayVerdict = 'passes'
    } catch (error) {
      this.replayVerdict =
        failureIdentity(this.reduced?.failure ?? {}) ===
        failureIdentity(record.failure)
          ? 'same-violation'
          : 'different-failure'
      throw error
    }
  }
  async finish(report, output, ok = report.ok === true) {
    const { sources, versions } = this.provenance
    report.evidence = {
      versions,
      name: this.name,
      cases: this.cases,
      witnesses: this.witnesses,
      faults: this.faults,
      cleanupErrors: this.cleanupErrors,
      rejectedShrinks: this.rejectedShrinks,
      generation: this.generation,
      replay: this.replayVerdict,
      sources,
      artifacts: this.artifacts,
      requestedFaults: this.requestedFaults,
      node: process.version,
      fault: process.env.ENDPOINT_ORACLE_TEST_FAULT ?? null,
    }
    const passed = ok && this.cleanupErrors.length === 0
    const fault = this.requestedFaults.length > 0
    report.ok = passed && !fault
    report.outcome = passed
      ? fault
        ? this.faults.some((event) => event.stage === 'reached')
          ? 'fault-survived'
          : 'fault-unreached'
        : 'passed'
      : this.original
        ? ['infrastructure', 'progress-timeout'].includes(
            this.original.failure.law,
          )
          ? this.original.failure.law
          : 'semantic-rejection'
        : this.cleanupErrors.length
          ? 'cleanup-failure'
          : 'unclassified-failure'
    report.controls = this.requestedFaults.map((control) => {
      const events = this.faults.filter(
        (event) => event.point === control.point,
      )
      const reached = events.some((event) => event.stage === 'reached')
      const intended =
        this.original?.failure.faults?.some(
          (event) => event.point === control.point && event.stage === 'reached',
        ) && expectedLaws[control.point]?.includes(this.original?.failure.law)
      return {
        ...control,
        applied: events.length > 0,
        reached,
        outcome: !reached
          ? 'unreached'
          : passed
            ? 'survived-or-equivalent'
            : intended
              ? 'intended-rejection'
              : 'collateral-failure',
      }
    })
    await mkdir(output, { recursive: true })
    if (this.original)
      await writeFile(
        resolve(output, 'replay.json'),
        JSON.stringify(
          {
            property: this.name,
            generation: this.generation,
            original: this.original,
            reduced: this.reduced,
          },
          null,
          2,
        ) + '\n',
      )
    await writeFile(
      resolve(output, 'report.json'),
      JSON.stringify(report, null, 2) + '\n',
    )
    if (!report.ok) process.exitCode = 1
  }
}
