import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const source = fileURLToPath(new URL('./', import.meta.url))
const kernel = await readFile(join(source, 'kernel.ts'), 'utf8')
const faults = [
  {
    name: 'one premise replaces all premises',
    pattern: "children.every((child) => child.status === 'supported')",
    replacement: "children.some((child) => child.status === 'supported')",
    test: 'generated cyclic and alternative arguments',
  },
  {
    name: 'cycle certifies itself',
    pattern: "reasons: ['Circular support'],",
    replacement: "status: 'supported', reasons: ['Circular support'],",
    test: 'generated cyclic and alternative arguments',
  },
  {
    name: 'old observations regain support after context changes',
    pattern: 'observation.epoch !== this.#epoch ||',
    replacement: '',
    test: 'generated context and failure histories',
  },
  {
    name: 'failure reporting loses counterexamples',
    pattern: 'if (!observation.passed) {',
    replacement: 'if (false) {',
    test: 'generated context and failure histories',
  },
  {
    name: 'assessment erases alternative route structure',
    pattern: 'return this.#assess(structuredClone(claim), new Set())',
    replacement:
      'return { ...this.#assess(structuredClone(claim), new Set()), routes: [] }',
    test: 'generated route explanations',
  },
  {
    name: 'expired repair evidence permanently clears a challenge',
    pattern: 'this.#observations.get(id)?.epoch === this.#epoch',
    replacement: 'this.#observations.has(id)',
    test: 'generated repairs retain',
  },
  {
    name: 'delivery order replaces causal replay eligibility',
    pattern: 'replay.startedAfterObservation < failed.id',
    replacement: 'replay.id <= failed.id',
    test: 'generated delivery permutations',
  },
]

// Each fault changes a temporary copy of production code. The unchanged oracle
// must fail at an assertion, not merely because compilation/imports crashed.
for (const fault of faults) {
  assert.equal(
    kernel.split(fault.pattern).length,
    2,
    `Unique mutation target: ${fault.name}`,
  )
  const directory = await mkdtemp(join(tmpdir(), 'evidence-fault-'))
  try {
    for (const name of ['kernel.test.mjs', 'endpoints.ts'])
      await copyFile(join(source, name), join(directory, name))
    await writeFile(join(directory, 'package.json'), '{"type":"module"}')
    await writeFile(
      join(directory, 'kernel.ts'),
      kernel.replace(fault.pattern, fault.replacement),
    )
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--test',
        `--test-name-pattern=${fault.test}`,
        join(directory, 'kernel.test.mjs'),
      ],
      { encoding: 'utf8' },
    )
    assert.equal(
      result.status,
      1,
      `Expected red oracle for ${fault.name}\n${result.stdout}\n${result.stderr}`,
    )
    assert.match(
      result.stdout,
      /ERR_ASSERTION/,
      `Expected assertion failure for ${fault.name}`,
    )
    console.log(`Detected: ${fault.name}`)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
