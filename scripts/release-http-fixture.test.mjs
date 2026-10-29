// Ordinary fixture controls. These check the release receiver's process and
// protocol mechanics; product tag judgments remain in the shared oracle.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { withReleaseWorkspace } from './release-fixture.js'
import {
  runReleaseToolTree,
  withHttpPublishReceiver,
} from './release-http-fixture.js'

async function stopped(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error.code === 'ESRCH') return
      throw error
    }
    // A reparented zombie has terminated but can await its host's reaper.
    try {
      const state = execFileSync('ps', ['-p', String(pid), '-o', 'stat='], {
        encoding: 'utf8',
      }).trim()
      if (state.startsWith('Z')) return
    } catch (error) {
      if (error.status === 1) return
      throw error
    }
    await delay(10)
  }
  assert.fail(`release descendant ${pid} still runs after group cleanup`)
}

for (const outcome of ['fulfilled', 'timed-out'])
  test(`release tool ${outcome} terminates its descendant`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'release-tool-control-'))
    const receipt = join(root, 'descendant.json')
    let pid
    try {
      const descendant = `require('node:fs').writeFileSync(${JSON.stringify(receipt)}, JSON.stringify({ pid: process.pid, group: process.ppid })); setInterval(() => {}, 1000)`
      const parent = `
        const fs = require('node:fs')
        require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore' })
        const timer = setInterval(() => {
          if (!fs.existsSync(${JSON.stringify(receipt)})) return
          process.stdout.write('descendant-started\\n')
          clearInterval(timer)
          ${outcome === 'fulfilled' ? 'process.exit(0)' : 'setInterval(() => {}, 1000)'}
        }, 10)
      `
      const result = await runReleaseToolTree(
        process.execPath,
        ['-e', parent],
        {
          cwd: root,
          env: { PATH: process.env.PATH },
          timeout: 1500,
        },
      )
      pid = JSON.parse(readFileSync(receipt, 'utf8')).pid
      assert.match(result.stdout, /descendant-started/)
      if (outcome === 'fulfilled') {
        assert.equal(result.status, 0)
        assert.equal(result.error, undefined)
      } else {
        assert.match(result.error?.message ?? '', /timed out/)
        assert.equal(result.signal, 'SIGKILL')
      }
      await stopped(pid)
    } finally {
      if (pid !== undefined) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      rmSync(root, { recursive: true, force: true })
    }
  })

test('release tool preserves executable startup failure', async () => {
  const result = await runReleaseToolTree('/no-such-release-oracle-tool', [], {
    env: { PATH: process.env.PATH },
    timeout: 1500,
  })
  assert.equal(result.error?.code, 'ENOENT')
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, '')
})

test('release tool rejects output beyond its bound without replacing it with timeout', async () => {
  const result = await runReleaseToolTree(
    process.execPath,
    [
      '-e',
      "process.stdout.write('x'.repeat(17 * 1024 * 1024)); setInterval(() => {}, 1000)",
    ],
    { env: { PATH: process.env.PATH }, timeout: 3000 },
  )
  assert.match(result.error?.message ?? '', /output exceeds fixture bound/)
  assert(result.stdout.length <= 16 * 1024 * 1024)
})

test('release tool retains timeout and group termination failure separately', () => {
  // The isolated process replaces only its own group signal. A direct-child
  // signal remains available, so this fault cannot leave our test child alive.
  const helper = new URL('./release-http-fixture.js', import.meta.url).href
  const probe = `
    const { runReleaseToolTree } = await import(${JSON.stringify(helper)})
    const realKill = process.kill
    process.kill = function(pid, signal) {
      if (pid < 0) throw Object.assign(new Error('termination sentinel'), { code: 'EPERM' })
      return realKill.call(process, pid, signal)
    }
    const result = await runReleaseToolTree(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      env: { PATH: process.env.PATH }, timeout: 75,
    })
    console.log(JSON.stringify({
      primary: result.error?.cause?.message,
      secondary: result.error?.errors?.map((error) => error?.message),
      signal: result.signal,
    }))
  `
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', probe],
    {
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env },
    },
  )
  assert.equal(result.error, undefined)
  assert.equal(result.status, 0, result.stderr)
  const observed = JSON.parse(result.stdout)
  assert.equal(observed.primary, 'Real release command timed out')
  assert(observed.secondary.includes('termination sentinel'))
  assert.equal(observed.signal, 'SIGKILL')
})

const history = {
  candidate: '1.0.0-rc.1.10',
  registry: 'stable-history',
  failure: 'none',
  tagShape: 'ordinary',
}
for (const outcome of ['error', 'undefined'])
  test(`HTTP receiver preserves callback throwing ${outcome}`, async () => {
    const primary =
      outcome === 'undefined' ? undefined : new Error('comparison sentinel')
    let rejected = false
    try {
      await withReleaseWorkspace(async ({ root }) =>
        withHttpPublishReceiver(root, history, () => {
          throw primary
        }),
      )
    } catch (error) {
      rejected = true
      assert.equal(error, primary)
    }
    assert.equal(rejected, true)
  })

test('HTTP receiver rejects and records unsupported scoped routes', async () => {
  await withReleaseWorkspace(async ({ root }) =>
    withHttpPublishReceiver(root, history, async (receiver) => {
      const path = '/%40tanstack%2Fnot-a-fixture-package'
      const response = await fetch(receiver.origin + path)
      assert.equal(response.status, 422)
      const state = receiver.readState()
      assert.equal(state.requests.length, 1)
      assert.equal(state.requests[0].type, 'protocol-error')
      assert.equal(state.requests[0].path, path)
      assert.equal(state.requests[0].registry, receiver.origin)
      assert.match(state.requests[0].error, /known public package route/)
      assert.deepEqual(state.packages, receiver.initialRegistry)
    }),
  )
})
