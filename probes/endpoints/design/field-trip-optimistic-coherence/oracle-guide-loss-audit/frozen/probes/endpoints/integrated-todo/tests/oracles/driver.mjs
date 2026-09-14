import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  cp,
  mkdtemp,
  symlink,
  writeFile,
  readFile,
  readdir,
  rm,
  mkdir,
} from 'node:fs/promises'
import { resolve, join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import {
  renderProgram,
  browserProbe,
  databaseFixture,
  markers,
} from './program.mjs'
import { Reference } from './reference.mjs'

const base = resolve(import.meta.dirname, '../..')
const turn = () => new Promise((resolve) => setTimeout(resolve, 20))
async function freePort() {
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}
async function files(dir) {
  return (
    await Promise.all(
      (await readdir(dir, { withFileTypes: true })).map((entry) =>
        entry.isDirectory()
          ? files(join(dir, entry.name))
          : [join(dir, entry.name)],
      ),
    )
  ).flat()
}
function replaceOnce(source, before, after) {
  assert.equal(
    source.split(before).length,
    2,
    'Oracle strategy/mutant must replace exactly one expression',
  )
  return source.replace(before, after)
}
async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) =>
      setTimeout(() => {
        child.kill('SIGKILL')
        resolve()
      }, 3000),
    ),
  ])
}
export class Driver {
  constructor(adapter = {}) {
    this.adapter = adapter
  }
  buildCache = new Set()
  extraModules = new Set()
  counts = {
    programsBuilt: 0,
    sequences: 0,
    operations: 0,
    checkpoints: 0,
    clientArtifacts: 0,
    transitions: {},
    wire: [],
  }
  async init() {
    this.dir = await mkdtemp(resolve(base, '../.oracle-run-'))
    for (const path of [
      'src',
      'tests',
      'package.json',
      'vite.config.ts',
      'transform.mjs',
      'bound-transform.mjs',
      'scalar-query.mjs',
      'handler-dependencies.mjs',
      'function-dependencies.mjs',
      'compiled-dependencies.mjs',
      'schema-snapshot.mjs',
      'query-registry.mjs',
      'tsconfig.json',
    ])
      await cp(join(base, path), join(this.dir, path), { recursive: true })
    await symlink(
      resolve(base, 'node_modules'),
      join(this.dir, 'node_modules'),
      'dir',
    )
    await writeFile(join(this.dir, 'src/database.server.ts'), databaseFixture)
    await writeFile(join(this.dir, 'src/oracle-probe.ts'), browserProbe)
    if (process.env.ENDPOINT_ORACLE_STRATEGY === 'client-refetch') {
      const path = join(this.dir, 'src/runtime.ts')
      let source = await readFile(path, 'utf8')
      source = replaceOnce(
        source,
        'reads: requests',
        'reads: []',
      )
      source = replaceOnce(
        source,
        "    if (response.kind === 'read-error') {",
        "    await Promise.all(targets.map(([,collection])=>collection.utils.refetch({throwOnError:true})))\n    if(response.handler.kind==='error')throw Error(response.handler.message)\n    return\n    if (response.kind === 'read-error') {",
      )
      await writeFile(path, source)
    }
    const encoding =
      this.adapter.snapshotEncoding ??
      process.env.ENDPOINT_ORACLE_SNAPSHOT_ENCODING
    if (encoding) {
      assert.ok(['full', 'adaptive'].includes(encoding))
      const path = join(this.dir, 'src/refresh.server.ts')
      const source = await readFile(path, 'utf8')
      await writeFile(
        path,
        replaceOnce(
          source,
          "encodeSnapshots(snapshots, 'adaptive', groups)",
          `encodeSnapshots(snapshots, '${encoding}', groups)`,
        ),
      )
    }
    const mutant = process.env.ENDPOINT_ORACLE_MUTANT
    if (mutant) {
      const edits = {
        'accept-overlapping-inline': [
          'operation.alone &&',
          'true || operation.alone &&',
        ],
        'omit-publication-batch': [
          'this.core._batch(() => {\n      this.invalidateReads()\n      this.wake()',
          ';((publish: () => void) => publish())(() => {\n      this.invalidateReads()\n      this.wake()',
        ],
        'optimistic-recipients-only': [
          'const targets = retained\n',
          'const targets = retained.filter(([,c])=>transaction.mutations.some(m=>m.collection.id===c.id))\n',
        ],
        'misroute-relations': [
          'model.relation !== sourceModel.relation ||',
          'false ||',
        ],
        'omit-fanout': [
          'if (endpoint.inline) this.propagate(transaction)',
          'if (false) this.propagate(transaction)',
        ],
        'omit-order': [
          'return this.collection(makeQuery(id, rpc), model.order)',
          'return this.collection(makeQuery(id, rpc), [])',
        ],
        'early-settlement': [
          'await this.persist(endpoint, input, transaction, retained)',
          'void this.persist(endpoint, input, transaction, retained)',
        ],
      }
      assert.ok(
        Object.hasOwn(edits, mutant),
        `Unknown oracle mutant: ${mutant}`,
      )
      const path = join(this.dir, 'src/runtime.ts'),
        source = await readFile(path, 'utf8')
      const [before, after] = edits[mutant]
      assert.equal(
        source.split(before).length,
        2,
        'Mutant must replace exactly one runtime expression',
      )
      await writeFile(path, source.replace(before, after))
    }
    this.port = await freePort()
    this.url = `http://127.0.0.1:${this.port}`
    this.browser = await chromium.launch({
      headless: true,
      executablePath:
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    })
    this.reference = this.adapter.reference ?? new Reference()
    await this.reference.init()
  }
  async process(args) {
    const child = spawn(process.execPath, args, {
      cwd: this.dir,
      env: { ...process.env, TODO_DB_PATH: 'memory://' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let log = ''
    child.stdout.on('data', (data) => (log += data))
    child.stderr.on('data', (data) => (log += data))
    const deadline = setTimeout(() => child.kill('SIGKILL'), 120000)
    let code
    try {
      code = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', resolve)
      })
    } finally {
      clearTimeout(deadline)
    }
    return { code, log }
  }
  async prepare(program) {
    const source = (this.adapter.renderProgram ?? renderProgram)(program)
    const database = this.adapter.renderDatabase?.(program) ?? databaseFixture
    const schemaSnapshot = await this.adapter.schemaSnapshot?.(program)
    const extraModules = Object.entries(
      this.adapter.extraModules?.(program) ?? {},
    ).sort(([a], [b]) => a.localeCompare(b))
    for (const [name] of extraModules)
      assert.match(name, /^(?:[a-z0-9-]+\/)*[a-z0-9-]+\.(?:endpoint|server)\.tsx?$/i)
    this.lastSource = source
    const key = createHash('sha256')
      .update(source)
      .update(database)
      .update(JSON.stringify(schemaSnapshot ?? null))
      .update(JSON.stringify(extraModules))
      .digest('hex')
    if (this.currentKey !== key) {
      // A new program gets a fresh server module graph, not an HMR transition.
      await stop(this.server)
      this.server = undefined
      for (const name of this.extraModules)
        if (!extraModules.some(([current]) => current === name))
          await rm(join(this.dir, 'src', name))
      for (const [name, source] of extraModules) {
        const path = join(this.dir, 'src', name)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, source)
      }
      this.extraModules = new Set(extraModules.map(([name]) => name))
      await writeFile(join(this.dir, 'src/endpoint.tsx'), source)
      await writeFile(join(this.dir, 'src/database.server.ts'), database)
      if (schemaSnapshot) {
        await mkdir(join(this.dir, '.endpoints'), { recursive: true })
        await writeFile(join(this.dir, '.endpoints/schema.json'), JSON.stringify(schemaSnapshot))
      } else await rm(join(this.dir, '.endpoints/schema.json'), { force: true })
      this.currentKey = key
    }
    if (!this.buildCache.has(key)) {
      const built = await this.process([
        'node_modules/vite/bin/vite.js',
        'build',
      ])
      assert.equal(
        built.code,
        0,
        `Generated program build failed:\n${built.log}`,
      )
      const clientFiles = await files(join(this.dir, 'dist/client'))
      for (const path of clientFiles) {
        if (!/\.(js|map|html)$/.test(path)) continue
        const body = await readFile(path, 'utf8')
        this.assertNoServer(body, `client artifact ${path}`)
        if (path.endsWith('.map')) {
          const map = JSON.parse(body)
          assert.ok(
            !map.sourcesContent?.some(Boolean),
            `client map contains source bodies: ${path}`,
          )
          assert.ok(
            !map.sources?.some((s) =>
              /\.server|drizzle-orm|electric-sql/.test(s),
            ),
            `server module in client source graph: ${path}`,
          )
        }
        this.counts.clientArtifacts++
      }
      const server = await files(join(this.dir, 'dist/server'))
      const bodies = (
        await Promise.all(
          server
            .filter((p) => /\.(js|map)$/.test(p))
            .map((p) => readFile(p, 'utf8')),
        )
      ).join('\n')
      for (const marker of markers)
        assert.ok(
          bodies.includes(marker),
          `positive control: server witness missing ${marker}`,
        )
      this.buildCache.add(key)
      this.counts.programsBuilt++
    }
    if (!this.server) {
      this.server = spawn(
        process.execPath,
        [
          'node_modules/vite/bin/vite.js',
          '--host',
          '127.0.0.1',
          '--port',
          String(this.port),
          '--strictPort',
        ],
        {
          cwd: this.dir,
          env: { ...process.env, TODO_DB_PATH: 'memory://' },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      this.serverLog = ''
      this.server.stdout.on('data', (d) => (this.serverLog += d))
      this.server.stderr.on('data', (d) => (this.serverLog += d))
    }
    for (let i = 0; i < 500; i++) {
      try {
        const response = await fetch(this.url + '/probe-control')
        if (response.ok) return
      } catch {}
      if (this.server.exitCode !== null) throw Error(this.serverLog)
      await turn()
    }
    throw Error('Oracle server startup deadline\n' + this.serverLog)
  }
  assertNoServer(body, label) {
    for (const marker of markers)
      assert.ok(!body.includes(marker), `${label} exposes ${marker}`)
    for (const match of body.matchAll(
      /sourceMappingURL=data:application\/json[^,]*;base64,([^\s]+)/g,
    )) {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8')
      const map = JSON.parse(decoded)
      for (const marker of markers)
        assert.ok(
          !decoded.includes(marker),
          `${label} source map exposes ${marker}`,
        )
      assert.ok(
        !map.sourcesContent?.some(Boolean),
        `${label} inline map contains source bodies`,
      )
      assert.ok(
        !map.sources?.some((source) =>
          /\.server|drizzle-orm|electric-sql/.test(source),
        ),
        `${label} inline map contains server modules`,
      )
    }
  }
  async control(data) {
    const response = await fetch(this.url + '/probe-control', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
    assert.equal(
      response.status,
      200,
      response.ok ? undefined : await response.text(),
    )
    return response.json()
  }
  async until(fn, label) {
    for (let i = 0; i < 250; i++) {
      if (await fn()) return
      await turn()
    }
    throw Error(`Oracle gate deadline: ${label}`)
  }
  async checkpoint(page, program, label, immediate) {
    const expected = await this.reference.expected(program)
    const actual =
      immediate ?? (await page.evaluate(() => window.endpointOracle.snapshot()))
    this.counts.checkpoints++
    assert.deepEqual(
      actual,
      expected,
      `${label}: every active collection must equal reference PG`,
    )
    // Observe React after a publication turn, without polling until it matches.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    )
    const consumers = await page
      .locator('[data-query]')
      .evaluateAll((sections) =>
        sections.map((section) =>
          [...section.querySelectorAll('[data-row]')].map(
            (row) => row.dataset.row,
          ),
        ),
      )
    assert.deepEqual(
      consumers,
      expected.flatMap((rows, i) =>
        program.unsubscribed?.includes(i) || program.gced?.includes(i)
          ? []
          : [rows.map((row) => row.id)],
      ),
      `${label}: rendered consumers`,
    )
  }
  async run(program, steps) {
    if (process.env.ENDPOINT_ORACLE_DEBUG)
      console.log('sequence', JSON.stringify({ program, steps }))
    this.counts.sequences++
    await this.control({ command: 'reset', rows: program.initial })
    await this.reference.reset(program.initial)
    const context = await this.browser.newContext()
    const page = await context.newPage()
    const injectedDelayMs = Number(
      process.env.ENDPOINT_ORACLE_REQUEST_DELAY_MS ?? 0,
    )
    assert.ok(
      Number.isFinite(injectedDelayMs) &&
        injectedDelayMs >= 0 &&
        injectedDelayMs <= 1000,
    )
    if (injectedDelayMs)
      await page.route('**/*', async (route) => {
        if (
          route.request().method() === 'POST' &&
          route.request().resourceType() === 'fetch'
        )
          await new Promise((resolve) => setTimeout(resolve, injectedDelayMs))
        await route.continue()
      })
    page.setDefaultTimeout(10000)
    const errors = []
    const responses = []
    const wire = []
    const wirePending = []
    page.on('response', (response) => {
      if (
        response.request().method() === 'POST' &&
        response.request().resourceType() === 'fetch'
      ) {
        wirePending.push(
          response
            .body()
            .then((body) =>
              wire.push({
                responseBytes: body.byteLength,
                requestBytes: Buffer.byteLength(
                  response.request().postData() ?? '',
                ),
              }),
            )
            .catch(() => {}),
        )
      }
    })
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('response', (response) => {
      if (
        ['script', 'document'].includes(response.request().resourceType()) &&
        !(response.status() >= 300 && response.status() < 400)
      )
        responses.push(
          response
            .text()
            .then((body) =>
              this.assertNoServer(body, `dev response ${response.url()}`),
            )
            .catch((error) => errors.push(error.message)),
        )
    })
    let armed
    try {
      await page.goto(this.url + `/?scope=${program.scope}`)
      await page.waitForFunction(() => window.endpointOracle)
      await page.evaluate(() =>
        Promise.race([
          window.endpointOracle.ready(),
          new Promise((_, reject) =>
            setTimeout(() => reject(Error('initial readiness deadline')), 5000),
          ),
        ]),
      )
      await this.checkpoint(page, program, 'initial')
      const subscribers = await page.evaluate(() =>
        window.endpointOracle.subscriberCounts(),
      )
      for (const index of [
        ...(program.unsubscribed ?? []),
        ...(program.gced ?? []),
      ])
        assert.equal(
          subscribers[index],
          0,
          'retained fixture must truly have no subscribers',
        )
      for (const [index, step] of steps.entries()) {
        if (process.env.ENDPOINT_ORACLE_DEBUG)
          console.log('operation', index, step.kind)
        const operation = await this.reference.operation(program, step, index)
        const { kind, input, target, outcome } = operation
        await Promise.all(wirePending)
        const wireStart = wire.length
        const started = performance.now()
        armed = input.token
        await this.control({ command: 'arm', token: armed })
        await this.reference.apply('visible', operation)
        const returned = await page.evaluate(
          ({ name, input }) => window.endpointOracle.invoke(name, input),
          { name: kind + target, input },
        )
        assert.equal(returned.isPromise, false)
        assert.equal(returned.hasPersistence, true)
        this.counts.operations++
        const transition = `${program.orders.length} queries / ${kind} / ${outcome}`
        this.counts.transitions[transition] =
          (this.counts.transitions[transition] ?? 0) + 1
        await this.checkpoint(
          page,
          program,
          `operation ${index} ${kind}: optimistic`,
          returned.rows,
        )
        await this.until(
          async () =>
            (await this.control({})).events.includes('write:waiting:' + armed),
          'write waiting',
        )
        await this.control({
          command: 'write',
          token: armed,
          reject: outcome === 'reject',
        })
        {
          if (outcome !== 'reject')
            await this.reference.apply('confirmed', operation)
          await this.until(
            async () =>
              (await this.control({})).events.includes('read:waiting'),
            'refetch waiting',
          )
          const pending = await page.evaluate(
            (token) => window.endpointOracle.outcomes[token],
            armed,
          )
          assert.equal(
            pending.result,
            'pending',
            'persistence cannot settle before held reconciliation',
          )
          await this.checkpoint(
            page,
            program,
            `operation ${index}: committed, read held`,
          )
          const failures =
            outcome === 'read-failure'
              ? 4
              : outcome === 'read-retry'
                ? (step.retryFailures ?? 1)
                : 0
          for (let attempt = 0; attempt < failures; attempt++) {
            const willRetry = attempt < 3
            const released = Date.now()
            await this.control({
              command: 'read',
              reject: true,
              next: willRetry,
            })
            if (willRetry) {
              await this.until(
                async () => {
                  const result = await page.evaluate(
                    (token) => window.endpointOracle.outcomes[token],
                    armed,
                  )
                  assert.equal(
                    result.result,
                    'pending',
                    'transient read failure must preserve the pending transaction',
                  )
                  return (
                    (await this.control({})).events.filter(
                      (event) => event === 'read:waiting',
                    ).length ===
                    attempt + 2
                  )
                },
                `read retry ${attempt + 1}`,
              )
              assert.ok(
                Date.now() - released >= 900 * 2 ** attempt,
                'read retry must use exponential backoff',
              )
              await this.checkpoint(
                page,
                program,
                `operation ${index}: retry ${attempt + 1} held`,
              )
            }
          }
          if (outcome !== 'read-failure')
            await this.control({ command: 'read' })
          assert.equal(
            (await this.control({})).events.filter(
              (event) => event === 'write:released:' + armed,
            ).length,
            outcome === 'reject' ? 0 : 1,
            'read retries must not repeat the write',
          )
        }
        await page.waitForFunction(
          (token) =>
            window.endpointOracle.outcomes[token]?.result !== 'pending',
          armed,
        )
        const result = await page.evaluate(
          (token) => window.endpointOracle.outcomes[token],
          armed,
        )
        assert.equal(
          result.result,
          ['success', 'read-retry'].includes(outcome) &&
            !input.failAfterCommit &&
            !operation.serverError
            ? 'fulfilled'
            : 'rejected',
        )
        await this.reference.restore()
        if (outcome === 'read-failure') {
          assert.ok(
            (await page.evaluate(() => window.endpointOracle.errors())).every(
              (error) =>
                error.includes('authoritative reads exhausted retries'),
            ),
          )
          assert.ok(
            (await page.evaluate(() => window.endpointOracle.errors())).length >
              0,
            'exhausted reads must be surfaced',
          )
          // The server committed. A fresh read repairs the stale confirmed client
          // baseline; failure is not an oracle claim that the write rolled back.
          await page.reload()
          await page.waitForFunction(() => window.endpointOracle)
          await page.evaluate(() => window.endpointOracle.ready())
        }
        await this.checkpoint(page, program, `operation ${index}: ${outcome}`)
        await Promise.all(wirePending)
        const samples = wire.slice(wireStart)
        if (
          outcome === 'success' &&
          process.env.ENDPOINT_ORACLE_STRATEGY !== 'client-refetch'
        )
          assert.equal(
            samples.length,
            1,
            'inline reconciliation must use one client mutation request',
          )
        if (
          outcome === 'success' &&
          process.env.ENDPOINT_ORACLE_STRATEGY === 'client-refetch'
        )
          assert.equal(
            samples.length,
            1 + program.orders.length - (program.gced?.length ?? 0),
            'comparison must actually refetch each retained query',
          )
        this.counts.wire.push({
          injectedDelayMs,
          queries: program.orders.length,
          kind,
          outcome,
          strategy: process.env.ENDPOINT_ORACLE_STRATEGY ?? 'inline',
          requests: samples.length,
          requestBytes: samples.reduce((n, s) => n + s.requestBytes, 0),
          responseBytes: samples.reduce((n, s) => n + s.responseBytes, 0),
          elapsedMs: performance.now() - started,
        })
        armed = undefined
      }
      if (program.externalWrite) {
        const text = 'later external write'
        await this.control({ command: 'external', scope: program.scope, text })
        await this.reference.externalWrite(program.scope, text)
        // No notification channel exists yet. Prove that a settled receipt does
        // not promise knowledge of future commits, then supply a refresh signal.
        await this.checkpoint(
          page,
          program,
          'later write without a signal preserves prior snapshot',
        )
        await this.reference.restore()
        assert.notDeepEqual(
          await page.evaluate(() => window.endpointOracle.snapshot()),
          await this.reference.expected(program),
          'external write must actually change the expected rows',
        )
        await page.evaluate(() => window.endpointOracle.refresh())
        await this.checkpoint(
          page,
          program,
          'explicit signal repairs later external write',
        )
        this.counts.externalWriteBoundaries =
          (this.counts.externalWriteBoundaries ?? 0) + 1
      }
      // Direct/raw requests must reject without echoing server bodies or source maps.
      for (const [path, code] of [
        ...['', '?raw', '?url'].map((suffix) => [
          '/src/database.server.ts' + suffix,
          'ENDPOINT_SERVER_IMPORT_IN_CLIENT',
        ]),
        ...['endpoint.tsx', ...this.extraModules].flatMap((name) =>
          ['?raw', '?url'].map((suffix) => [
            '/src/' + name + suffix,
            'ENDPOINT_UNSUPPORTED_GRAMMAR',
          ]),
        ),
      ]) {
        const response = await context.request.get(this.url + path)
        const body = await response.text()
        assert.equal(response.status(), 500)
        assert.ok(body.includes(code))
        this.assertNoServer(body, 'dev rejected source response')
      }
      await Promise.all(responses)
      assert.deepEqual(errors, [])
    } finally {
      if (armed) {
        await this.control({
          command: 'write',
          token: armed,
          reject: true,
        }).catch(() => {})
        await this.control({ command: 'read' }).catch(() => {})
      }
      await context.close()
      await Promise.allSettled(responses)
    }
  }
  async negativeBoundary(program) {
    await writeFile(
      join(this.dir, 'src/secret.server.ts'),
      `export const serverSecret='${markers[0]}'`,
    )
    const unsafe = (this.adapter.renderProgram ?? renderProgram)(program)
      .replace(
        'export function TodoApp(){',
        "import {serverSecret} from './secret.server'\nexport function TodoApp(){",
      )
      .replace('<main>', '<main><span>{serverSecret}</span>')
    await writeFile(join(this.dir, 'src/endpoint.tsx'), unsafe)
    const built = await this.process(['node_modules/vite/bin/vite.js', 'build'])
    assert.notEqual(built.code, 0)
    assert.match(built.log, /ENDPOINT_SERVER_IMPORT_IN_CLIENT/)
    await writeFile(
      join(this.dir, 'src/endpoint.tsx'),
      (this.adapter.renderProgram ?? renderProgram)(program),
    )
    this.currentKey = undefined
    return { retainedServerImport: 'rejected by server boundary' }
  }
  async saveFailure(path, data) {
    await mkdir(path, { recursive: true })
    await writeFile(
      join(path, 'replay.json'),
      JSON.stringify(data, null, 2) + '\n',
    )
    await writeFile(
      join(path, 'sequence.json'),
      JSON.stringify(
        {
          scenario: {
            program: data.scenario.program,
            sequences: [data.scenario.sequences[data.failedSequence]],
          },
        },
        null,
        2,
      ) + '\n',
    )
    await writeFile(
      join(path, 'endpoint.tsx'),
      (this.adapter.renderProgram ?? renderProgram)(data.scenario.program),
    )
  }
  async close() {
    await this.browser?.close()
    await stop(this.server)
    await this.reference?.close()
    if (this.dir) await rm(this.dir, { recursive: true, force: true })
  }
}
