import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

const [sourcePath, beforePath, outputPath] = process.argv.slice(2)
const source = readFileSync(sourcePath, 'utf8')
const before = readFileSync(beforePath, 'utf8')
const digest = (text) => createHash('sha256').update(text).digest('hex')
const between = (text, start, end) => {
  const a = text.indexOf(start)
  const b = text.indexOf(end, a + start.length)
  assert(a >= 0 && b > a)
  return text.slice(a, b)
}

// Evaluate only the exact driver helper/branch text. Erase three explicit
// parameter/return annotations; import no product, test, compiler or fixture.
function extract(text) {
  const pending = between(text, '  const pending =', '  const selectedRequest =')
    .replace('(): Array<CompletionProviderRequest>', '()')
  const selected = between(text, '  const selectedRequest =', '  const waitFor =')
    .replace(/\(\s*plan: CompletionBaselineProgram\[`answerScopes`\]\[keyof CompletionBaselineProgram\[`answerScopes`\]\],\s*\)/, '(plan)')
  const wait = between(text, '  const waitFor =', '  const boundOutputs =')
    .replace('premise: () => boolean', 'premise')
  const loads = between(text, '  const establishingLoads =', '  const releaseAnswers =')
    .replace('request: CompletionProviderRequest', 'request')
  const branch = between(text, '    if (action.type === `request-window`) {', '    if (action.type === `request-initial`) {')
  const snippets = [pending, selected, wait, loads, branch]
  assert(snippets.every((part) => !part.includes('import ')))
  const factory = new Function(
    'fixture', 'program', 'hostTurn', 'callWindow', 'isDeepStrictEqual', 'need',
    `${snippets.slice(0, 4).join('\n')}\nreturn async (action) => { ${branch} }`,
  )
  return { factory, snippets: snippets.map(digest) }
}

const current = extract(source)
const original = extract(before)
assert(source.includes('setWindow can return before they enter.'))
assert.equal(current.snippets.slice(0, 4).join(), original.snippets.slice(0, 4).join())
const stop = new Error('offline pending-premise control stopped')
const need = (value, name) => {
  if (value === undefined) throw new Error(`completion receiving premise missing: ${name}`)
  return value
}

function makeLoad(sourceName) {
  let outcome
  const load = {
    id: 1, source: sourceName, generation: 1, enteredAt: 10,
    queryKey: [sourceName, 3], options: { signal: { aborted: false } },
    receipt: new Promise(() => {}), read: () => outcome,
    setOutcome: (value) => { outcome = value },
  }
  return load
}
function scene() {
  const records = { roots: [], marked: [], children: [] }
  const loads = { roots: [], marked: [], children: [] }
  const requests = ['marked', 'children'].map((sourceName, index) => {
    const load = makeLoad(sourceName)
    loads[sourceName].push(load)
    const request = {
      id: index + 1, source: sourceName, requested: [3], answered: false,
      appliedLoad: load, queryKey: [sourceName, 3],
      cancelled: () => load.options.signal.aborted,
    }
    records[sourceName].push(request)
    return request
  })
  const fixture = {
    providers: Object.fromEntries(['roots', 'marked', 'children'].map((name) => [
      name, { requests: () => records[name], loads: () => loads[name] },
    ])),
  }
  const program = {
    gate: 'source-failed-peer',
    answerScopes: {
      failure: { source: 'marked', scope: [3] },
      peer: { source: 'children', scope: [3] },
    },
  }
  return { records, loads, requests, fixture, program }
}

async function run(spec, implementation = current) {
  const state = scene()
  let turns = 0
  let calls = 0
  let observed = false
  const schedule = []
  spec.prepare?.(state, schedule)
  const action = implementation.factory(
    state.fixture, state.program,
    async () => {
      turns++
      if (turns > 3) throw stop
      schedule.shift()?.()
    },
    () => { calls++ }, isDeepStrictEqual, need,
  )
  let error
  try {
    await action({ type: 'request-window', operation: 'offline', options: {} })
    observed = true
  } catch (caught) {
    error = caught === stop ? 'pending-premise' : caught.message
  }
  assert.equal(calls, 1)
  if (spec.accept) {
    assert.equal(error, undefined, spec.name)
    assert.equal(observed, true, spec.name)
    assert.equal(turns, spec.turns ?? 0, spec.name)
  } else {
    assert.equal(observed, false, `${spec.name}: premature held observation`)
    assert.equal(typeof error, 'string', spec.name)
  }
  return { name: spec.name, admitted: observed, hostTurns: turns, rejection: error }
}

const cases = [
  { name: 'both exact pending original receipts', accept: true },
  {
    name: 'both exact requests arrive on separate host turns', accept: true, turns: 2,
    prepare(state, schedule) {
      const [failure, peer] = state.requests
      state.records.marked = []; state.records.children = []
      schedule.push(() => state.records.marked.push(failure), () => state.records.children.push(peer))
    },
  },
  { name: 'missing failed request', prepare: (s) => { s.records.marked = [] } },
  { name: 'missing peer request', prepare: (s) => { s.records.children = [] } },
  { name: 'wrong failed scope', prepare: (s) => { s.requests[0].requested = [4] } },
  { name: 'wrong peer scope', prepare: (s) => { s.requests[1].requested = [4] } },
  { name: 'answered request', prepare: (s) => { s.requests[0].answered = true } },
  { name: 'cancelled original load', prepare: (s) => { s.requests[1].appliedLoad.options.signal.aborted = true } },
  { name: 'missing original load', prepare: (s) => { s.requests[0].appliedLoad = undefined } },
  { name: 'before original receipt returned', prepare: (s) => { s.requests[1].appliedLoad.receipt = undefined } },
  { name: 'literal true original receipt', prepare: (s) => { s.requests[0].appliedLoad.receipt = true } },
  { name: 'already fulfilled original receipt', prepare: (s) => { s.requests[0].appliedLoad.setOutcome({ state: 'fulfilled' }) } },
  { name: 'already rejected original receipt', prepare: (s) => { s.requests[1].appliedLoad.setOutcome({ state: 'rejected', error: 'offline' }) } },
  { name: 'recorded settlement without outcome', prepare: (s) => { s.requests[0].appliedLoad.settledAt = 20 } },
  { name: 'wrong original source', prepare: (s) => { s.requests[0].appliedLoad.source = 'children' } },
  { name: 'wrong original query key', prepare: (s) => { s.requests[1].appliedLoad.queryKey = ['children', 4] } },
  { name: 'original absent from acquisitions', prepare: (s) => { s.loads.marked = [] } },
  {
    name: 'associated receipt already fulfilled',
    prepare(s) { const extra = makeLoad('marked'); extra.enteredAt++; extra.setOutcome({ state: 'fulfilled' }); s.loads.marked.push(extra) },
  },
  {
    name: 'associated receipt already rejected',
    prepare(s) { const extra = makeLoad('children'); extra.enteredAt++; extra.setOutcome({ state: 'rejected', error: 'offline' }); s.loads.children.push(extra) },
  },
  {
    name: 'associated original receipt aborted',
    prepare(s) { const extra = makeLoad('marked'); extra.enteredAt++; extra.options.signal.aborted = true; s.loads.marked.push(extra) },
  },
  {
    name: 'later associated pending original receipt', accept: true,
    prepare(s) { const extra = makeLoad('children'); extra.enteredAt++; s.loads.children.push(extra) },
  },
  {
    name: 'unrelated generation does not broaden acquisition binding', accept: true,
    prepare(s) { const extra = makeLoad('marked'); extra.generation++; extra.receipt = true; s.loads.marked.push(extra) },
  },
  {
    name: 'other gate keeps immediate request-window cut', accept: true,
    prepare(s) { s.program.gate = 'held-window'; s.records.marked = []; s.records.children = [] },
  },
]
const results = []
for (const spec of cases) results.push(await run(spec))

// The preserved original branch returns with one exact request missing. Feed
// that result through the same offline no-premature-observation judgment.
let originalRejected = false
try {
  await run(cases.find(({ name }) => name === 'missing peer request'), original)
} catch (error) {
  originalRejected = error.code === 'ERR_ASSERTION' && error.message.includes('premature held observation')
}
assert(originalRejected)
const report = {
  scope: 'offline exact driver-source extraction; no product or native execution',
  sourcePath, sourceSha256: digest(source), beforePath, beforeSha256: digest(before),
  helperSourceHashesUnchanged: true,
  sourceSnippetHashes: current.snippets,
  accepted: results.filter(({ admitted }) => admitted).length,
  rejected: results.filter(({ admitted }) => !admitted).length,
  cases: results,
  preservedOriginalPrematureCutRejected: originalRejected,
  productImports: 0, fixtureConstructions: 0, testCollection: 0,
  productRED: false, productGREEN: false, receiving: 0,
  limit: 'Synthetic records exercise the exact helper predicate and host-turn loop only. Native reach remains unrun and unsupported premises remain unreached.',
}
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify({ accepted: report.accepted, rejected: report.rejected, preservedOriginalPrematureCutRejected: originalRejected, sourceSha256: report.sourceSha256 }))
