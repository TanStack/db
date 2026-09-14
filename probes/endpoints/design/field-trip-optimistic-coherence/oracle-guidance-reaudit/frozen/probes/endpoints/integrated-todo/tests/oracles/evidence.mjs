import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
function signature(failure) {
  return JSON.stringify([
    failure.law,
    failure.checkpoint,
    failure.operation,
    failure.collection,
    failure.difference?.slice(0, 2),
  ])
}

function provenance() {
  const names = [
    'evidence.mjs',
    'driver.mjs',
    'program.mjs',
    'compiled-dependencies.mjs',
    'dependencies.mjs',
    'concurrent.mjs',
    'sql.mjs',
    'e2e.mjs',
    'registry.mjs',
    'loading.mjs',
    'compiled-browser.mjs',
    '../../src/runtime.ts',
    '../../src/registry.server.ts',
    '../../src/dependencies.server.ts',
    '../../bound-transform.mjs',
  ]
  const sources = Object.fromEntries(
    names.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL(name, import.meta.url)))
        .digest('hex'),
    ]),
  )
  const versions = Object.fromEntries(
    ['fast-check', '@electric-sql/pglite', 'drizzle-orm', 'playwright'].map(
      (name) => [
        name,
        JSON.parse(
          readFileSync(
            new URL(
              '../../node_modules/' + name + '/package.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ).version,
      ],
    ),
  )
  return { sources, versions }
}

// Shared evidence plumbing, not a shared reference model. Each runner owns its
// expected values, legal inputs, checkpoints and fault injection sites.
export class Evidence {
  constructor(name) {
    this.name = name
    this.provenance = provenance()
  }
  witnesses = {}
  faults = []
  cleanupErrors = []
  rejectedShrinks = []
  cases = 0
  depth = 0
  phase = 'setup'
  check(law, actual, expected, context = {}) {
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
      })
      throw error
    }
  }
  fault(point, detail = {}) {
    this.faults.push(frozen({ point, ...detail }))
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
      }
      const record = frozen({ input, failure })
      this.original ??= record
      if (signature(failure) !== signature(this.original.failure)) {
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
        signature(this.reduced?.failure ?? {}) === signature(record.failure)
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
      node: process.version,
      fault: process.env.ENDPOINT_ORACLE_TEST_FAULT ?? null,
    }
    const passed = ok && this.cleanupErrors.length === 0
    const fault = process.env.ENDPOINT_ORACLE_TEST_FAULT
    report.ok = passed && !fault
    report.outcome = passed
      ? fault
        ? this.faults.length
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
