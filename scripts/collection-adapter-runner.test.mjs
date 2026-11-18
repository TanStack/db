import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { runGroups } from './run-collection-adapter-oracles.mjs'

const groups = [`first`, `second`, `third`].map((name) => ({
  name,
  args: [name],
}))

function runWith(results) {
  const attempted = []
  const messages = []
  const status = runGroups(groups, {
    command: { command: `test-pnpm`, prefix: [] },
    write: (text) => messages.push(text),
    spawn: (_command, args) => {
      attempted.push(args[0])
      const result = results[attempted.length - 1]
      if (result instanceof Error) throw result
      return result
    },
  })
  return { status, attempted, messages: messages.join(``) }
}

test(`attempts later groups and fails when an earlier campaign fails`, () => {
  const result = runWith([{ status: 2 }, { status: 0 }, { status: 0 }])
  assert.deepEqual(result.attempted, [`first`, `second`, `third`])
  assert.equal(result.status, 1)
  assert.match(result.messages, /Failed first: 2/)
})

test(`reports success only after all groups succeed`, () => {
  const result = runWith(groups.map(() => ({ status: 0 })))
  assert.deepEqual(result.attempted, [`first`, `second`, `third`])
  assert.equal(result.status, 0)
})

test(`signals and setup failures remain failures without skipping later groups`, () => {
  for (const failure of [
    { status: null, signal: `SIGTERM` },
    { status: null, error: new Error(`executable unavailable`) },
    new Error(`spawn threw`),
    { status: null },
  ]) {
    const result = runWith([failure, { status: 0 }, { status: 0 }])
    assert.deepEqual(result.attempted, [`first`, `second`, `third`])
    assert.equal(result.status, 1)
    assert.match(result.messages, /Failed first:/)
  }
})

test(`lists separate Node and actual browser command manifests without running them`, () => {
  for (const [args, count] of [
    [[], 10],
    [[`--browser`], 5],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL(`./run-collection-adapter-oracles.mjs`, import.meta.url),
        ),
        ...args,
        `--list`,
      ],
      { encoding: `utf8` },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.equal(JSON.parse(result.stdout).length, count)
  }
})

test(`rejects unknown arguments before starting any campaign`, () => {
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL(`./run-collection-adapter-oracles.mjs`, import.meta.url),
      ),
      `--unsupported`,
    ],
    { encoding: `utf8` },
  )
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Usage:/)
  assert.equal(result.stdout, ``)
})
